# Working in this repo

integration-mock is a mock-API substrate and test harness for n8n workflows: it serves
generated or recorded vendor packs to n8n (as an HTTPS forward proxy or as a
plain base URL), snapshots real executions so a workflow can be retried against
them, and verifies packs against the real vendor. Everything here is about the
codebase; `README.md` is the user-facing manual.

## Layout

pnpm monorepo, TypeScript, ESM, strict.

| Package | Publishes as | What it is |
|---|---|---|
| `packages/core` | `integration-mock-core` (workspace-only) | Pure functions: pack model and schema, matcher, layered resolution, resource store, request log, faults, redaction, pack I/O and validation, config, snapshot build/diff, reverse-mapper registry, `N8nClient`, creds, verify |
| `packages/proxy` | `integration-mock-proxy` (workspace-only) | The daemon: CA + per-host leaf certs, CONNECT tunnelling, TLS termination, `MockEngine`, base-URL serving, the loopback admin API and its client |
| `packages/packs` | `integration-mock-packs` (workspace-only) | OpenAPI → pack generator, spec sourcing/vendoring, the library loader, the five native-node reverse-mappers, and the shipped packs under `packs/` |
| `packages/cli` | `integration-mock` | The `integration-mock` binary and the daemon entry point. esbuild bundles the three workspace packages in; third-party deps stay external |

`integration-mock-core`, `integration-mock-proxy` and `integration-mock-packs` stay `"private": true`
on purpose: they are compile-time inputs of the `integration-mock` bundle, listed as its
`devDependencies`, and are never published. Only `packages/cli` carries publish
metadata. Everything sits at one version (`0.2.0`); `packages/cli/src/version.ts`
must match `packages/cli/package.json` (`version.test.ts` checks).

Other top-level directories: `schema/` (JSON Schemas for pack and test files),
`conformance/` (fixtures shared with sibling tools — see `CONFORMANCE.md`),
`docker/` (the n8n + mock compose pair), `skills/` (an agent skill for authoring
a pack from prose docs), `test/` (repo-level tests: doc-link guard,
dependency guard, and the opt-in instance tests), `docs/` (contributor docs and
the generated vendor audit), `.integration-mock/packs/weather/` (a tracked example
project-layer pack used by the instance tests).

## Prerequisites

- Node >= 20 (`engines`); the instance tests need an n8n 2.38+, which itself
  needs Node >= 24 if run from npm
- pnpm 10.22 (`packageManager`; `corepack enable` gets it)

## Commands

```bash
pnpm install
pnpm build                 # pnpm -r build: core → proxy, packs → cli (topological)
pnpm typecheck             # tsc --noEmit in every package
pnpm test                  # vitest, every package + test/, fully offline
pnpm --filter integration-mock-core test      # one package
node packages/cli/dist/bin.js <verb> # run the CLI from the checkout
pnpm smoke                 # install-level: fresh clone + packed tarball, README quickstart (tests the COMMITTED state)
pnpm test:instance         # end-to-end against a configured n8n; skips if none
```

Build before typecheck and before the tests: `cli` and the repo-level tests
resolve the other packages through their `dist/`. Core, proxy and packs are
plain `tsc`; `cli` is `node build.mjs` (esbuild). `pnpm -r build` orders them
by workspace dependency, so the root command is enough.

## Packaging: one package, proven installable

`packages/cli` is the only thing published. `node build.mjs` (esbuild,
`splitting: true`, sourcemaps) emits two entry points plus shared chunks, all
flat in `packages/cli/dist/`:

- `dist/bin.js` — the CLI.
- `dist/daemon.js` — the proxy process `start` spawns. Anything loaded at
  runtime by path needs an entry point of its own; `daemonEntry()` in
  `packages/cli/src/commands/proxy.ts` finds it with
  `new URL('./daemon.js', import.meta.url)`. **Never resolve a workspace
  package name at runtime** (`createRequire().resolve('integration-mock-…')`):
  those packages do not exist once the tarball is installed.
  `packages/proxy/src/daemon-main.ts` is the same thing for the workspace
  Docker image; `daemon.ts` itself has no side effect on import.

**`dataPaths()` in `packages/packs/src/paths.ts` is the one function that
locates runtime data** — the pack library, `sources.yaml`, the compose file,
`skills/`. It picks among three layouts by what is on disk around the running
module: `INTEGRATION_MOCK_DATA_DIR` if set; the workspace (`packages/packs/`
plus `docker/` and `skills/` at the repo root) when
`packages/packs/sources.yaml` and `pnpm-workspace.yaml` are where a checkout
has them; otherwise the package root one level above `dist/`. Add a new data
file there, not with a fresh `import.meta.url` somewhere else. The pack JSON
Schema is inlined in `packages/core/src/pack-schema.ts`; `schema/` ships for
editors and sibling tools, nothing reads it at runtime.

`prepack` assembles the published layout in the package dir (eight core packs,
`schema/`, `sources.yaml`, `docker/docker-compose.yml` +
`docker/Dockerfile.package`, `skills/`, LICENSE, NOTICE, THIRD_PARTY_NOTICES,
README); the copies are gitignored and `postpack` removes them, so a checkout
stays clean and the bundle keeps reading the workspace's own data.

`pnpm smoke` (`scripts/smoke.sh [clone|npm|all]`) is the acceptance test for
all of this: a fresh `git clone` of the committed state, and `pnpm pack` →
`npm install <tarball>` in an empty project, each running the README
quickstart with an isolated `HOME`/`INTEGRATION_MOCK_HOME` on ports
18180/18181. It tests what is **committed**, so commit before running it.
Never make it pass by asserting less. `up`/`down` (Docker) and every networked
verb are excluded; the script says which.

## Tests and fixtures

- Unit tests live next to each package in `packages/<pkg>/test/`, vitest, no
  network. Proxy tests run against a local fake HTTPS origin.
- `packages/packs/test/fixtures/`: small OpenAPI docs (`petstore.json`,
  `swagger2.json`, `partial.json`) for the generator, and one
  `<node>.node-output.json` per reverse-mapper (hand-authored from documented
  node output shapes; each says so in `_note`).
- `packages/packs/test/library.test.ts` walks every shipped pack under
  `packages/packs/packs/` and checks it loads and serves — a new pack is picked
  up automatically.
- `conformance/` + `schema/`: fixtures other tools copy verbatim.
  `conformance.test.ts`, `assert.test.ts` and `executions-conformance.test.ts`
  in `packages/core/test/` run them here. The execution exports are real captures from an n8n
  2.10.0 container; `CONFORMANCE.md` says how to recapture them.
- `test/docs-links.test.ts` fails when `AGENTS.md`, `README.md`,
  `CONFORMANCE.md` or `docs/adding-a-vendor.md` cite a path that does not
  exist. `test/dist-deps.test.ts` fails when a built package imports something
  its `package.json` does not declare.
- `test/instance/`: the end-to-end loop (create workflow → publish → fire
  production webhook → assert the mock served it). Needs
  `integration-mock instances add … --default` and a running daemon; run with a
  throwaway `INTEGRATION_MOCK_HOME=$(mktemp -d)` if you want isolation.

## Regenerating packs

```bash
node packages/cli/dist/bin.js packs build <vendor>            # from the spec cached under ~/.integration-mock/vendor-specs (a fresh clone has none)
node packages/cli/dist/bin.js packs build <vendor> --fetch    # download the URL in packages/packs/sources.yaml
node packages/cli/dist/bin.js packs build <vendor> --spec f   # from any local OpenAPI file
node packages/cli/dist/bin.js packs update [vendor…]          # refresh vendored specs, rebuild what changed
node packages/cli/dist/bin.js packs audit --out docs/vendor-audit.md
```

Vendored specs are cached gzipped at `~/.integration-mock/vendor-specs/<vendor>/<version>/`
(`INTEGRATION_MOCK_HOME` overrides the root). Generation writes only
`10-generated.json` under a pack's `routes/`; hand fixes go in
`00-overrides.json` beside it, which sorts first and therefore wins. `.github/workflows/packs-refresh.yml` runs
`packs update` weekly and opens a PR.

Adding a vendor to the library is documented end-to-end in
`docs/adding-a-vendor.md`; in the normal case it is a `sources.yaml` entry and
one build command, no code.

## Conventions

- TDD with vitest. `core` stays pure; side effects live in `proxy` and `cli`.
- Strict TypeScript. No `any`; no `as` casts where a type guard will do.
- **The admin API is the only mutation path.** Runtime state (mode, enabled
  packs, active snapshot, faults) lives in the proxy process alone. The CLI is a
  stateless client that finds it through `~/.integration-mock/proxy.json`. Never add a
  second source of truth on disk.
- **`PUT /packs/enabled` re-reads the user and project layers** (`diskLayers`
  in `packages/proxy/src/daemon.ts` → `MockEngine.replaceLayers`) before
  applying the list, so a pack written after `start` — `packs init`, `eject`,
  a hand-authored directory — is served the moment it is enabled. Any verb that
  changes what is on disk or what is enabled goes through
  `syncPacksWithProxy()` in `packages/cli/src/commands/proxy.ts`.
- **Never pass `maxRedirections` to undici.** Under Node 24 the process-wide
  dispatcher is Node's own newer undici, which refuses the option. `fetch-spec.ts`
  composes the redirect interceptor on its own `Agent`; `packs-fetch.ts` uses
  the built-in `fetch`.
- `off` is always the default mode. In `off`, and for any host no enabled pack
  claims, traffic stays a raw TCP tunnel — no TLS termination, nothing logged.
- **Never let an unmocked call answer 200.** The resource store serves only
  collections a pack seeds; everything else falls through to the loud 501.
  Silent empty data is worse than a failure.
- **Generation is deterministic.** No `Math.random`, `Date.now` or unsorted
  key iteration in the generator: a pack must regenerate byte-identically or
  every refresh buries real upstream changes in churn. Credential-shaped
  example values (PEM private keys, AWS key ids) are replaced with labelled
  placeholders by `packages/packs/src/generate/sanitize.ts`.
- **`registerAllMappers()` must run before `buildSnapshot`**, or every native
  node falls through to a "no reverse-mapper" warning. The CLI does this at
  module load in `packages/cli/src/commands/snapshot.ts`; core tests that
  assert the unmapped path call `__resetMappersForTests()`.
- **Network I/O is confined to named modules, by category**, so "can this
  thing call out?" has a short answer:
  - Third parties: `packages/packs/src/fetch-spec.ts` (`packs build --fetch`,
    `packs update`), `packages/cli/src/commands/verify-fetch.ts` (`verify`),
    `packages/cli/src/commands/packs-fetch.ts` (`packs install`). Do not add a
    fourth without updating this list.
  - The user's own n8n: `packages/core/src/snapshot/n8n-client.ts`,
    `packages/cli/src/commands/creds-fetch.ts`.
  - Loopback to our own admin API: `AdminClient` in
    `packages/proxy/src/admin.ts`, and the health probe in
    `packages/cli/src/commands/proxy.ts`.
  - Traffic proxied on n8n's behalf: `packages/proxy/src/server.ts`.
- integration-mock consumes no n8n node descriptions and depends on no n8n package. The
  reverse-mappers work from recorded node *output*, not node definitions.
  `packages/core/src/version.ts` records the n8n version the tool targets.
- Pack layering, most specific first: active snapshot → project
  (`./.integration-mock/packs`) → user (`~/.integration-mock/packs`) → library.

## n8n API facts the code relies on (2.38)

- `/rest/*` authenticates by browser session cookie; an API key gets 401
  there while working on `/api/v1`. The public API has no run/execute
  endpoint, but it does ship `POST /api/v1/workflows/:id/publish` and
  `unpublish`. **create → publish → call the production webhook** is therefore
  the only API-key-only way to execute a workflow, and is what
  `test/instance/loop.test.ts` does.
- A workflow created via the public API starts unpublished; its production
  webhook does not register until it is published.
- API-key scopes are validated against the user's role: fetch
  `/rest/api-keys/scopes` and send what it returns rather than a hand-written
  list.
- n8n refuses a workflow whose credential id does not resolve *before* making
  any HTTP call, so the mock never sees the request. That is what
  `creds push` exists for.
- Proxy mode needs `NO_PROXY=localhost,127.0.0.1` alongside the two proxy
  variables, or n8n's task runner breaks.

## Do not

- Commit `.integration-mock/config.json` (local runtime state — gitignored) or anything
  under `.integration-mock/snapshots/`.
- Commit workflow or execution exports from a real instance. Fixtures come
  from throwaway containers and reserved test hostnames (`*.test`).
- Commit a vendored spec without a licence that clearly permits it; mark it
  `vendored: false` in `sources.yaml` so it is fetched on demand.
- Hand-edit a pack's `10-generated.json`; put fixes in `00-overrides.json` or
  fix the generator.
- Add network calls outside the modules listed above, or a test that needs
  the network, an API key or a running instance (those belong in
  `test/instance/`).
- Cite a path in a doc that does not exist; the link guard will fail.
