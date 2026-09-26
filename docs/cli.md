# Command line

## The mock

| Command | What it does |
|---|---|
| `start [--port 8080] [--admin-port 8081] [--foreground]` | Start the mock |
| `stop` | Stop it |
| `status` | Show the mode, the enabled packs and the active snapshot |
| `url [service]` | Print the base URL to point a workflow at |
| `log [--service s] [--limit n] [--follow]` | Show the requests the mock received |
| `up` / `down` | Start or remove n8n and the mock together in Docker |

## Packs

| Command | What it does |
|---|---|
| `packs list [--installed]` | List shipped, installed and available packs |
| `packs enable <ids…>` / `packs disable <ids…>` | Choose which services are mocked |
| `packs install <ids…> [--ref r]` | Download a pack that is not shipped in the package |
| `packs init <service> --domain <host>` | Scaffold a pack to write by hand |
| `packs validate [service] [--json]` | Check hand-written packs |
| `packs build <service> [--spec f] [--fetch] [--domains a,b]` | Generate a pack from an OpenAPI file |
| `packs update [services…]` | Refresh the cached OpenAPI files and rebuild what changed |
| `packs eject <service> [--force]` | Copy a shipped pack into your project so you can edit it |
| `packs reset` | Reset stored resources to their seed data |
| `packs audit` | Download every source OpenAPI file and report on it |

## Faults

| Command | What it does |
|---|---|
| `faults set <service> [--status n] [--delay ms] [--empty] [--after n] [--once]` | Make calls to a service fail or slow down |
| `faults clear [service]` | Remove faults |

## Proxy mode and recording

| Command | What it does |
|---|---|
| `ca install [--host h] [--port n]` | Print the environment variables that point n8n at the proxy |
| `on` / `off` | Turn interception on (replay) or off |
| `record start` / `record stop` | Record real traffic into a pack |

## Your n8n instance

| Command | What it does |
|---|---|
| `instances add <name> <url> <apiKey> [--default]` | Save an n8n instance and its API key |
| `instances use <name>` / `instances list` | Pick the default instance, or list them |
| `snapshot <id\|latest> [--workflow id] [--no-activate] [--commit]` | Turn one execution into mocks and activate them |
| `diff [id]` | Compare a later execution against the active snapshot |
| `creds push <type> [--name n] [--field k=v] [--dry-run]` | Create a placeholder credential on the instance |
| `creds swap <workflow.json> [--in-place] [--real] [--via proxy]` | Point a workflow's URLs at the mock, or back at the real service |
| `verify <service> --base-url u [--header h] [--param k=v] [--unsafe] [--patch] [--fail-on kinds]` | Compare a pack against the real service. Exits 1 on a difference |

## Fault injection

```bash
integration-mock faults set slack --status 503 --once
```

![A 503 once, then a 200, and the log marking the fault](https://raw.githubusercontent.com/LudwigGerdes/integration-mock/main/docs/images/integration-mock-shot-3.png)

| Flag | Effect |
|---|---|
| `--status n` | Answer with this HTTP status |
| `--delay ms` | Wait before answering |
| `--empty` | Answer with an empty body |
| `--after n` | Let the first `n` calls through |
| `--once` | Remove the fault after it fires |

Faulted calls are marked `FAULT` in the log.

## The request log

```bash
integration-mock log --limit 3
```

Each line has the time, method, service, path, status and the route that answered. A call that no route matched shows `unmatched`.

## Where files live

| Path | Contents | Commit it? |
|---|---|---|
| `./.integration-mock/packs/` | Packs you wrote, recorded or ejected | Yes |
| `./.integration-mock/config.json` | Which packs are enabled | No. It is gitignored |
| `./.integration-mock/snapshots/` | Snapshots | No, unless you pass `--commit` |
| `~/.integration-mock/config.json` | Saved n8n instances and API keys, in plain text | |
| `~/.integration-mock/requests.jsonl` | The request log, in plain text | |
| `~/.integration-mock/ca.pem`, `ca-key.pem` | The local certificate authority for proxy mode. Created on first `start` | |

Set `INTEGRATION_MOCK_HOME` to move the `~/.integration-mock` folder.
