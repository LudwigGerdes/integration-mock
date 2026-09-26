# Snapshots, credentials and verify

These commands talk to your n8n instance. Save it once:

```bash
integration-mock instances add sandbox https://your-n8n.example <API_KEY> --default
```

The URL and API key are stored in plain text in `~/.integration-mock/config.json`.

## Snapshot and retry

Run a workflow once for real, then keep working on it against that run.

```bash
integration-mock start
integration-mock ca install          # set the printed variables where n8n runs, then restart n8n

# run the workflow once for real in n8n, then:
integration-mock snapshot latest --workflow <id>

# edit the workflow in n8n and click Execute: it now runs against the snapshot
integration-mock log --follow
integration-mock diff
```

### What `snapshot` does

- Builds mocks from one execution and activates them.
- Prints which services it mocked and how many routes each got.
- Prints a `⚠` line for every node it could not fully turn into a mock. Warnings never stop a snapshot.
- Writes `./.integration-mock/snapshots/<workflowId>/<executionId>.json`. The folder is gitignored; `--commit` keeps one as a fixture.
- Redacts credential headers, token-shaped strings and the paths in your project config's `redact` list before writing.

### How each node is handled

| Node | Result |
|---|---|
| HTTP Request with a literal URL | Routes from its URL, method, query and output |
| HTTP Request with an expression URL | A warning. Nothing is mocked |
| Slack, Google Sheets, Airtable, HubSpot, OpenAI | The service's response is rebuilt from the node's output |
| Other nodes that call a service | A warning. The shipped pack answers, if there is one |
| Nodes that call nothing | They run again as normal |

### What `diff` shows

`diff` compares the active snapshot with a later execution and the calls the mock saw.

| Finding | Meaning |
|---|---|
| Changed nodes | Parameters that differ. Canvas position is ignored |
| Changed output | Item counts and changed paths per node |
| `missing` | A call in the snapshot that was not made this time |
| `added` | A new call |
| `changed` | The same call with a different request |
| `unmatched` | A call no route answered |

## Placeholder credentials

n8n refuses to run a workflow whose credential does not exist, before it makes any call. `creds push` creates a credential with placeholder values, shaped by n8n's own schema for that type.

```bash
integration-mock creds push httpHeaderAuth --name "Acme (mock)"
integration-mock creds push httpHeaderAuth --dry-run          # show the payload first
integration-mock creds push httpHeaderAuth --field name=X-Api-Key --field value=placeholder
```

`--field key=value` sets any field. Use it to point a credential's base URL at the mock.

## Pointing a workflow file at the mock

```bash
integration-mock creds swap workflow.json                 # preview
integration-mock creds swap workflow.json --in-place      # apply
integration-mock creds swap workflow.json --real --in-place   # back to the real URLs
```

- Only literal URLs are rewritten. Expression URLs are left alone and listed.
- A pack that declares only wildcard domains can be swapped to, but not back. That is reported too.

## Verify a pack against the real service

Once you have access to the real service, check the mock against it.

```bash
integration-mock verify salesforce \
  --base-url https://acme.my.salesforce.com \
  --header "Authorization: Bearer $TOKEN"
```

It compares the shape of each response, never the values.

| Finding | Meaning |
|---|---|
| `invented` | A field the pack has and the real service does not |
| `missing` | A field the real service has and the pack does not |
| `type` | The same field with a different type |
| `status` | A different HTTP status |
| `unreachable` | The call failed |

| Flag | Effect |
|---|---|
| `--param name=value` | Fill a `:name` segment in a path |
| `--patch` | Rewrite the pack's response bodies from what the service returned, for review as a `git diff` |
| `--unsafe` | Also run methods that change data |
| `--fail-on <kinds>` | Which findings exit 1: `status`, `shape`, `unreachable`, `skipped`, or `none`. Default `status,shape,unreachable` |

The report is always printed. With the default `--fail-on`, any difference or an unreachable service exits 1, so a scheduled `verify` fails the job when a vendor changes something a workflow relies on. Skipped routes never fail on their own.

> [!CAUTION]
> Without `--unsafe`, only GET, HEAD and OPTIONS run. With it, a Slack pack would post real messages.
