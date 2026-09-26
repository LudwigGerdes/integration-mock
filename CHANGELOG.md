# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- `verify` exits 1 when it finds a difference or cannot reach the vendor, so contract drift fails a CI job. `--fail-on <kinds>` chooses which finding kinds count (`status,shape,unreachable` by default; `none` reports only). It used to exit 0 whatever it found.
- Recorded packs and `verify --patch` output are redacted before they are written. A `record` run used to write the vendor's response body and the request's query string as sent, so a `?token=…` or an `access_token` in a body landed in `./.integration-mock/packs`, a directory the docs say to commit.
- `integration-mock log` and the admin API's `GET /log` serve the redacted view, the same as the file on disk. The in-memory entries that recording and `diff` use are unchanged.
- Redaction recognises more credential shapes: JWTs, `Basic` credentials, the API-key headers vendors use (`X-Auth-Token`, `apikey`, `Api-Key`, `Private-Token`, `Ocp-Apim-Subscription-Key`, `X-Amz-Security-Token`, `Proxy-Authorization`) and credential query parameters by name (`token`, `access_token`, `refresh_token`, `api_key`, `client_secret`, …).

## 0.1.1 — 2026-09-21

### Fixed

- The weekly `packs-refresh` job failed: a bare `packs update` rebuilt every vendored source into the library, including `petstore-example`, a reference spec that is not a pack. It appeared as a 27th pack with no domains and failed the library tests. Sources can now be marked `reference: true`, and a bare `packs update` skips them; a test checks that everything it would refresh is already a library pack.
- The request log on disk (`~/.integration-mock/requests.jsonl`) no longer stores credentials as sent. Credential headers, token-shaped strings and the project config's `redact` paths are replaced with `[REDACTED]` before a line is written; the in-memory log that `log`, `diff` and recording read is unchanged.
- `packs enable` refuses an id that no layer holds instead of reporting it as enabled: a pack from the index that is not installed points at `packs install <id>`, anything else at `packs list`. Nothing is saved on refusal.
- `ca install` prints `NO_PROXY=localhost,127.0.0.1` in all three forms; without it n8n's task runner breaks behind the proxy.
- `ca install` defaults to the port the running mock listens on. It used to print `:8080` whatever the mock was started with.
- Every subcommand has a description in `--help`; twelve had none.

### Changed

- README cut down to description, installation, getting started and core usage; the reference moved to `docs/` (`cli.md`, `n8n.md`, `packs.md`, `snapshots.md`, `faq.md`).

## 0.1.0 — 2026-09-20

Initial public release.

### Fixed
- `up`: the host CLI could not control the Docker pair. The admin API inside the pair requires the
  bearer token the daemon mints into the container's volume, and `up` wrote the host's
  `proxy.json` without it, so `status`, `on`, `log` and `packs enable` all answered 401. `up` now
  reads the token from the mock container and stores it with owner-only permissions.
- `up` from an npm install: the image build failed with E404, because npm resolves a root
  project's devDependencies even under `--omit=dev` and those name the internal workspace
  libraries. `docker/Dockerfile.package` drops them before installing.
- Both Docker paths (checkout and npm install) are now verified end to end, including an HTTPS
  request from inside the n8n container that is intercepted and trusted under the mock's CA.
- `docker/README.md`: the n8n host port is 5690, not 5679.

### Fixed

- `integration-mock start` works from the npm tarball. It failed with
  `Cannot find module 'integration-mock-proxy/daemon'` because the CLI spawned
  the daemon through a workspace package name. The daemon is now its own entry
  point of the bundle (`dist/daemon.js`), found relative to the bundled CLI.
- `up` / `down` no longer look for the compose file through the
  `integration-mock-proxy` workspace package. The compose pair ships in the
  tarball; an installed package builds the mock image from itself
  (`docker/Dockerfile.package`) and mounts the project you ran it from.

### Added

- `pnpm smoke` (`scripts/smoke.sh [clone|npm|all]`): an install-level
  acceptance test that runs the README quickstart from a fresh clone and from
  the packed tarball installed into an empty project, with an isolated home
  and non-default ports. CI runs it on Linux and macOS, Node 20 and 22,
  together with publint and arethetypeswrong.
- `INTEGRATION_MOCK_DATA_DIR` overrides where the pack library, `sources.yaml`,
  the compose pair and the skills are read from.
- `up --help` prints the compose file it would use.
- The tarball ships sourcemaps, the compose pair and the authoring skill.

- A pack written while the daemon runs (`packs init`, `packs eject`, a
  hand-authored directory) is served as soon as it is enabled. The admin API
  re-reads the user and project pack layers before applying a new enabled
  list; previously `enable` reported success while `url` and the route itself
  said otherwise until `integration-mock stop && integration-mock start`.
- `packs eject <vendor>` and `packs list` from a checkout now see the whole
  shipped library. The bundled CLI resolved the library relative to its own
  `dist/`, where only a stale `prepack` copy (or nothing) lived, while the
  daemon served `packages/packs/packs/`.
- `packs build <vendor>` with no cached spec names the command that fetches
  it (`integration-mock packs build <vendor> --fetch`) instead of suggesting the vendor
  be added to `sources.yaml` when it already is. The bundle also reads the
  real `sources.yaml` now.
- `packs install` no longer crashes with `maxRedirections is not supported`;
  it follows redirects with Node's `fetch`, and a connection failure is one
  line naming the URL. `packs build --fetch` and `packs update` follow
  redirects through undici's interceptor for the same reason.

### Changed

- README rewritten: offline quickstart first, PATH guidance, Node/pnpm floor,
  pack lifecycle glossary, honest "Known issues".
- Community files added: CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, issue and
  PR templates. CI runs on Node 20 and 22.
- Package metadata prepared for publishing `integration-mock`; `integration-mock-*` stay
  private workspace packages bundled into the CLI. All versions set to 0.1.0.
