# Security

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: **Security → Report a
vulnerability** on this repository. Do not open a public issue for something
exploitable. There is no bug bounty. Expect a first response within about a
week.

## What integration-mock stores, and where

integration-mock runs locally and keeps its state under `~/.integration-mock/` (or `$INTEGRATION_MOCK_HOME`)
and `./.integration-mock/` in the project. Verified against the code at the time of
writing:

| Input | Command | Written to disk? |
|---|---|---|
| n8n API key | `integration-mock instances add <name> <url> <apiKey>` | **Yes** — plain text in `~/.integration-mock/config.json`, read back by `snapshot`, `diff`, `creds push` and `pnpm test:instance`. Remove an instance by editing that file. |
| Vendor auth header | `integration-mock verify <service> --header "Authorization: Bearer …"` | No — used for the run and discarded. |
| Traffic the mock serves | any mocked call, proxy or base-URL mode | **Yes, redacted** — every intercepted request is appended to `~/.integration-mock/requests.jsonl` with its headers and body. Before a line is written, credential headers (`Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`, `X-N8N-API-Key`), token-shaped strings and the paths in the project config's `redact` list are replaced with `[REDACTED]`. Request and response bodies can still hold personal data, so treat the log as sensitive and delete it when done. |
| Recorded responses | `integration-mock record start` | Yes — `./.integration-mock/packs/<service>/`, response bodies verbatim. |
| Executions | `integration-mock snapshot` | Yes — `./.integration-mock/snapshots/`, gitignored; `--commit` keeps one as a fixture. |

Credential values pushed with `creds push` are placeholders the mock never
checks; they exist only so n8n will run the workflow.

## Network exposure

- The mock port (`:8080`) has no authentication. Anything that can reach it can
  read your packs and request log.
- The admin API (`:8081`) is the only mutation path. On loopback it needs no
  token; bound to any other interface it refuses to start without one, and
  the daemon then generates a bearer token into `~/.integration-mock/proxy.json`. Never
  expose it publicly.
- The CA under `~/.integration-mock/ca.pem` / `ca-key.pem` signs leaf certificates for
  intercepted hosts. Anyone with the key can impersonate those hosts to a
  process that trusts the CA — keep it local and do not add it to a system
  trust store.
- Outbound network calls are confined to `packs build --fetch`, `packs update`,
  `packs audit`, `packs install`, `verify`, and the n8n instance you configure.
  Everything else works offline.
