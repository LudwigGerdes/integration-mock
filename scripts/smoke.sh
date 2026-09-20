#!/usr/bin/env bash
# Install-level acceptance test: does integration-mock work for someone who is
# not sitting in this workspace?
#
#   scripts/smoke.sh clone   fresh `git clone` of the COMMITTED state → install → build → quickstart
#   scripts/smoke.sh npm     `pnpm pack` the one published package → `npm install` the tarball
#                            into an empty project outside any workspace → the same quickstart
#   scripts/smoke.sh all     both (default)
#
# Safety. Every run works in a fresh `mktemp -d`, runs the tool with an isolated
# HOME and INTEGRATION_MOCK_HOME, uses non-default ports (never 8080/8081/5678),
# stops every daemon it starts and removes its temp dirs from a trap. It never
# writes to the working tree or to ~/.integration-mock. The package
# managers themselves (pnpm/npm install) keep the real HOME so they can use
# their download caches; the tool never does.
#
# Deliberately NOT covered, because they leave the machine:
#   - `up` / `down` need Docker. Only asserted: the compose file ships in the
#     tarball, resolves from the installed package, and `up --help` works.
#   - `packs install`, `packs build --fetch`, `packs update`, `packs audit`,
#     `verify`, `record` reach the network (a vendor or GitHub). Excluded.
#   - `snapshot`, `diff`, `creds push`, `instances` need a running n8n; those
#     live in `pnpm test:instance`.
#
# Never make this pass by asserting less. If a check cannot be satisfied, the
# packaging is wrong, not the check.
set -euo pipefail

MODE="${1:-all}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${SMOKE_PORT:-18180}"
ADMIN_PORT="${SMOKE_ADMIN_PORT:-18181}"

case "$PORT:$ADMIN_PORT" in
	*8080*|*8081*|*5678*) echo "smoke: refusing to use a default port ($PORT/$ADMIN_PORT)" >&2; exit 2 ;;
esac

TMP="$(mktemp -d "${TMPDIR:-/tmp}/integration-mock-smoke.XXXXXX")"
TMP="$(cd "$TMP" && pwd -P)" # canonical: macOS TMPDIR ends in "/" and lives behind the /private symlink
REAL_HOME="$HOME"
PASSES=0
FAILS=0
FAILED=()
DAEMON_HOMES=()

pass() { PASSES=$((PASSES + 1)); printf 'PASS  %s\n' "$1"; }
fail() {
	FAILS=$((FAILS + 1)); FAILED+=("$1"); printf 'FAIL  %s\n' "$1"
	if [ -n "${2:-}" ]; then printf '%s\n' "$2" | sed 's/^/        /' | head -20; fi
}

# Kill whatever daemon a mock home points at, by pid file; never by name or port.
kill_daemon() {
	local home="$1" pid
	[ -f "$home/proxy.json" ] || return 0
	pid="$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).pid||"")}catch{}' "$home/proxy.json")"
	if [ -n "$pid" ] && [ "$pid" != "0" ]; then kill "$pid" 2>/dev/null || true; fi
	rm -f "$home/proxy.json"
}

cleanup() {
	local code=$?
	for h in "${DAEMON_HOMES[@]:-}"; do [ -n "$h" ] && kill_daemon "$h"; done
	rm -rf "$TMP"
	exit "$code"
}
trap cleanup EXIT INT TERM

port_listening() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

wait_port_closed() {
	for _ in $(seq 1 25); do port_listening "$1" || return 0; sleep 0.2; done
	return 1
}

# expect_ok <name> <grep-pattern> <cmd…>: exit 0 AND output matches.
expect_ok() {
	local name="$1" pattern="$2" out code=0
	shift 2
	out="$("$@" 2>&1)" || code=$?
	if [ "$code" -ne 0 ]; then fail "$name (exit $code)" "$out"; return 0; fi
	if ! grep -Eq -- "$pattern" <<<"$out"; then fail "$name (output lacks /$pattern/)" "$out"; return 0; fi
	pass "$name"
}

# expect_http <name> <status> <grep-pattern> <curl args…>
expect_http() {
	local name="$1" want="$2" pattern="$3" body status
	shift 3
	body="$TMP/http-body.$$"
	status="$(curl -sS --max-time 10 --noproxy '*' -o "$body" -w '%{http_code}' "$@" 2>&1)" || true
	if [ "$status" != "$want" ]; then fail "$name (HTTP $status, wanted $want)" "$(cat "$body" 2>/dev/null)"; return 0; fi
	if ! grep -Eq -- "$pattern" "$body"; then fail "$name (body lacks /$pattern/)" "$(cat "$body")"; return 0; fi
	pass "$name"
}

# The quickstart the README promises, run through whatever invocation the
# caller documents. $1 = label, $2 = project dir (cwd; holds the weather pack),
# $3 = mock home, rest = the command that is `integration-mock`.
quickstart() {
	local label="$1" project="$2" mockhome="$3"
	shift 3
	local im=(env HOME="$TMP/home-$label" INTEGRATION_MOCK_HOME="$mockhome" "$@")
	mkdir -p "$TMP/home-$label" "$mockhome"
	DAEMON_HOMES+=("$mockhome")
	cd "$project"

	if port_listening "$PORT" || port_listening "$ADMIN_PORT"; then
		fail "$label: ports $PORT/$ADMIN_PORT are free before start"
		return 0
	fi

	expect_ok "$label: --version prints 0.1.0" '^0\.1\.0$' "${im[@]}" --version
	expect_ok "$label: --help lists the verbs" 'start.*' "${im[@]}" --help
	expect_ok "$label: packs list shows the library (slack)" '(^|[[:space:]])slack([[:space:]]|$)' "${im[@]}" packs list
	expect_ok "$label: packs list shows the library (generic-rest)" 'generic-rest' "${im[@]}" packs list

	expect_ok "$label: start reports the chosen ports" "proxy started on :$PORT \\(admin :$ADMIN_PORT\\)" \
		"${im[@]}" start --port "$PORT" --admin-port "$ADMIN_PORT"
	if ! port_listening "$PORT"; then
		fail "$label: daemon is listening on :$PORT after start"
		return 0
	fi
	pass "$label: daemon is listening on :$PORT after start"

	expect_ok "$label: packs enable weather slack" 'enabled: .*weather' "${im[@]}" packs enable weather slack
	expect_ok "$label: url weather" "^http://127\\.0\\.0\\.1:$PORT/weather\$" "${im[@]}" url weather
	expect_ok "$label: status shows both packs" 'packs.*(slack.*weather|weather.*slack)' "${im[@]}" status

	expect_http "$label: project pack answers 200 with the pack body" 200 '"city":"Evanston".*"source":"integration-mock"' \
		"http://127.0.0.1:$PORT/weather/dev/weather"
	expect_http "$label: library pack (slack) answers 200 from the shipped library" 200 'mock-access-token' \
		-X POST "http://127.0.0.1:$PORT/slack/api/oauth.access"
	expect_http "$label: unknown route answers 501 with the hint" 501 '"error":"integration-mock: no route".*"hint":' \
		"http://127.0.0.1:$PORT/weather/nope"

	expect_ok "$label: log shows the 200" 'GET[[:space:]]+weather[[:space:]]+/dev/weather[[:space:]]+200' "${im[@]}" log
	expect_ok "$label: log shows the 501 as unmatched" 'GET[[:space:]]+weather[[:space:]]+/nope[[:space:]]+501[[:space:]]+unmatched' "${im[@]}" log

	expect_ok "$label: faults set --once" 'fault set: weather \{"status":503,"once":true\}' \
		"${im[@]}" faults set weather --status 503 --once
	expect_http "$label: fault fires once: 503" 503 '' "http://127.0.0.1:$PORT/weather/dev/weather"
	expect_http "$label: fault retired: 200" 200 'Evanston' "http://127.0.0.1:$PORT/weather/dev/weather"
	expect_ok "$label: log marks the fault" '503.*FAULT' "${im[@]}" log

	expect_ok "$label: packs init acme" 'created .*acme' "${im[@]}" packs init acme --domain api.acme.test
	expect_ok "$label: packs validate acme" '^ok .+ 1 pack\(s\), no problems$' "${im[@]}" packs validate acme
	expect_ok "$label: packs enable acme (no restart)" 'enabled: .*acme' "${im[@]}" packs enable weather slack acme
	expect_http "$label: acme served without a restart" 200 '"replace":"me"' "http://127.0.0.1:$PORT/acme/example"

	expect_ok "$label: packs eject copies a library pack out of the package" 'slack' "${im[@]}" packs eject slack
	if [ -f "$project/.integration-mock/packs/slack/pack.json" ]; then
		pass "$label: ejected pack is on disk"
	else
		fail "$label: ejected pack is on disk"
	fi

	expect_ok "$label: ca install prints the proxy env and a CA under the isolated home" \
		"NODE_EXTRA_CA_CERTS=$mockhome" "${im[@]}" ca install --port "$PORT"
	expect_ok "$label: up --help (Docker itself is not exercised)" 'docker-compose' "${im[@]}" up --help
	local compose
	compose="$("${im[@]}" up --help | sed -n 's/^Compose file: //p')"
	if [ -n "$compose" ] && [ -f "$compose" ]; then
		pass "$label: the compose file up/down would use exists"
	else
		fail "$label: the compose file up/down would use exists" "$compose"
	fi
	if [ "$label" = npm ]; then
		case "$compose" in
			"$project/node_modules/integration-mock/docker/docker-compose.yml") pass "npm: compose file resolves inside the installed package" ;;
			*) fail "npm: compose file resolves inside the installed package" "$compose" ;;
		esac
	fi

	expect_ok "$label: stop" '^stopped$' "${im[@]}" stop
	if wait_port_closed "$PORT" && wait_port_closed "$ADMIN_PORT"; then
		pass "$label: no listener left on :$PORT/:$ADMIN_PORT"
	else
		fail "$label: no listener left on :$PORT/:$ADMIN_PORT"
		kill_daemon "$mockhome"
	fi
	if [ -e "$mockhome/proxy.json" ]; then fail "$label: proxy.json removed on stop"; else pass "$label: proxy.json removed on stop"; fi

	# --foreground takes a different code path (in-process import, not spawn).
	"${im[@]}" start --foreground --port "$PORT" --admin-port "$ADMIN_PORT" >"$TMP/fg-$label.log" 2>&1 &
	local fg=$!
	local up=1
	for _ in $(seq 1 25); do if port_listening "$PORT"; then up=0; break; fi; sleep 0.2; done
	if [ "$up" -eq 0 ]; then
		expect_http "$label: start --foreground serves the pack" 200 'Evanston' "http://127.0.0.1:$PORT/weather/dev/weather"
	else
		fail "$label: start --foreground serves the pack" "$(cat "$TMP/fg-$label.log")"
	fi
	kill "$fg" 2>/dev/null || true
	wait "$fg" 2>/dev/null || true
	rm -f "$mockhome/proxy.json"
	if wait_port_closed "$PORT"; then pass "$label: foreground daemon gone"; else fail "$label: foreground daemon gone"; fi

	cd "$ROOT"
}

run_clone() {
	echo "== clone path =="
	git clone --quiet "$ROOT" "$TMP/clone"
	(
		cd "$TMP/clone"
		pnpm install --frozen-lockfile >"$TMP/clone-install.log" 2>&1 || { cat "$TMP/clone-install.log"; exit 1; }
		pnpm build >"$TMP/clone-build.log" 2>&1 || { cat "$TMP/clone-build.log"; exit 1; }
	) && pass "clone: pnpm install --frozen-lockfile && pnpm build" \
		|| { fail "clone: pnpm install --frozen-lockfile && pnpm build"; return 0; }

	# The invocation the README documents for a checkout, from the repo root
	# (where the tracked example `weather` pack lives).
	quickstart clone "$TMP/clone" "$TMP/mockhome-clone" node "$TMP/clone/packages/cli/dist/bin.js"

	if [ -z "$(git -C "$TMP/clone" status --porcelain -- . ':!.integration-mock')" ]; then
		pass "clone: build and quickstart leave the checkout clean"
	else
		fail "clone: build and quickstart leave the checkout clean" "$(git -C "$TMP/clone" status --porcelain)"
	fi
}

run_npm() {
	echo "== npm path =="
	# Pack from a clone of the committed state, so the tarball is what a release
	# would publish and the working tree is never written to (prepack copies
	# files into the package dir).
	if [ ! -d "$TMP/clone/node_modules" ]; then
		git clone --quiet "$ROOT" "$TMP/clone"
		(cd "$TMP/clone" && pnpm install --frozen-lockfile >"$TMP/pack-install.log" 2>&1 && pnpm build >"$TMP/pack-build.log" 2>&1) \
			|| { fail "npm: install + build before packing" "$(tail -20 "$TMP"/pack-*.log)"; return 0; }
	fi
	mkdir -p "$TMP/tarball"
	(cd "$TMP/clone/packages/cli" && pnpm pack --pack-destination "$TMP/tarball" >"$TMP/pack.log" 2>&1) \
		|| { fail "npm: pnpm pack" "$(cat "$TMP/pack.log")"; return 0; }
	local tarball
	tarball="$(ls "$TMP"/tarball/integration-mock-*.tgz)"
	pass "npm: pnpm pack → $(basename "$tarball")"

	# Tarball contents.
	local listing="$TMP/tarball.list"
	tar -tzf "$tarball" >"$listing"
	local count size
	count="$(wc -l <"$listing" | tr -d ' ')"
	size="$(wc -c <"$tarball" | tr -d ' ')"
	echo "      tarball: $count files, $size bytes"
	for want in package/dist/bin.js package/dist/daemon.js package/docker/docker-compose.yml package/docker/Dockerfile.package \
		package/packs/slack/pack.json package/schema package/sources.yaml \
		package/skills/integration-mock-author-pack/SKILL.md \
		package/LICENSE package/NOTICE package/THIRD_PARTY_NOTICES.md package/README.md package/package.json; do
		if grep -q "^$want" "$listing"; then pass "npm: tarball ships ${want#package/}"; else fail "npm: tarball ships ${want#package/}"; fi
	done
	local junk
	junk="$(grep -E '^package/(src|test|tests|fixtures|node_modules)/|\.(test|spec)\.(ts|js|mjs|cjs)$|/fixtures/|tsconfig|\.tsbuildinfo|build\.mjs|prepack\.mjs' "$listing" || true)"
	if [ -z "$junk" ]; then pass "npm: tarball has no src/, tests, fixtures or build scripts"; else fail "npm: tarball has no src/, tests, fixtures or build scripts" "$junk"; fi
	local maps_orphan=""
	while read -r m; do grep -qx "${m%.map}" "$listing" || maps_orphan+="$m"$'\n'; done < <(grep '\.map$' "$listing" || true)
	if [ -z "$maps_orphan" ]; then pass "npm: every .map sits beside its file"; else fail "npm: every .map sits beside its file" "$maps_orphan"; fi
	if grep -q '^package/dist/bin.js.map$' "$listing"; then pass "npm: sourcemaps ship"; else fail "npm: sourcemaps ship"; fi
	if tar -xzOf "$tarball" package/package.json | grep -q 'workspace:'; then
		fail "npm: published package.json has no workspace: ranges"
	else
		pass "npm: published package.json has no workspace: ranges"
	fi
	if [ -z "$(git -C "$TMP/clone" status --porcelain -- . ':!.integration-mock')" ]; then
		pass "npm: packing leaves the checkout clean (postpack removed the copies)"
	else
		fail "npm: packing leaves the checkout clean (postpack removed the copies)" "$(git -C "$TMP/clone" status --porcelain)"
	fi

	# An empty project OUTSIDE any workspace.
	local app="$TMP/app"
	mkdir -p "$app"
	(cd "$app" && npm init -y >/dev/null 2>&1 && npm install --no-audit --no-fund "$tarball" >"$TMP/npm-install.log" 2>&1) \
		&& pass "npm: npm install <tarball> in an empty project" \
		|| { fail "npm: npm install <tarball> in an empty project" "$(tail -20 "$TMP/npm-install.log")"; return 0; }
	if ls "$app/node_modules" | grep -Eq '^integration-mock-(core|proxy|packs)$'; then
		fail "npm: no workspace-internal package was installed"
	else
		pass "npm: no workspace-internal package was installed"
	fi
	expect_ok "npm: npx --no-install integration-mock --version" '^0\.1\.0$' \
		env HOME="$TMP/home-npx" INTEGRATION_MOCK_HOME="$TMP/mockhome-npx" sh -c "mkdir -p '$TMP/home-npx' && cd '$app' && npx --no-install integration-mock --version"

	# The tracked example pack, as a user would author it in their own project.
	git -C "$ROOT" archive HEAD .integration-mock/packs/weather | tar -x -C "$app"

	quickstart npm "$app" "$TMP/mockhome-npm" "$app/node_modules/.bin/integration-mock"

	# Data must come FROM THE INSTALLED PACKAGE, not from this repo.
	local ejected="$app/.integration-mock/packs/slack/pack.json"
	if [ -f "$ejected" ] && cmp -s "$ejected" "$app/node_modules/integration-mock/packs/slack/pack.json"; then
		pass "npm: ejected pack is the copy shipped in node_modules/integration-mock"
	else
		fail "npm: ejected pack is the copy shipped in node_modules/integration-mock"
	fi
	# Remove the clone: anything still resolving into it would now break.
	rm -rf "$TMP/clone"
	expect_ok "npm: packs list still works with the checkout gone" 'slack' \
		env HOME="$TMP/home-npm" INTEGRATION_MOCK_HOME="$TMP/mockhome-npm" sh -c "cd '$app' && node_modules/.bin/integration-mock packs list"
	expect_ok "npm: packs build from a local spec, schema-validated, inside the installed package layout" 'petstore|built|routes' \
		env HOME="$TMP/home-npm" INTEGRATION_MOCK_HOME="$TMP/mockhome-npm" sh -c "cd '$app' && node_modules/.bin/integration-mock packs build petstore --spec '$ROOT/packages/packs/test/fixtures/petstore.json' --domains petstore.test"
}

case "$MODE" in
	clone) run_clone ;;
	npm) run_npm ;;
	all) run_clone; run_npm ;;
	*) echo "usage: scripts/smoke.sh [clone|npm|all]" >&2; exit 2 ;;
esac

echo
echo "smoke ($MODE): $PASSES passed, $FAILS failed"
if [ "$FAILS" -gt 0 ]; then
	printf '  - %s\n' "${FAILED[@]}"
	exit 1
fi
