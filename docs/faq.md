# FAQ and compatibility

## Compatibility

| | Supported |
|---|---|
| n8n | Tested against 2.38.3, in base-URL mode and proxy mode |
| Other n8n 2.x versions | Expected to work. The n8n API calls used are stable |
| n8n Cloud | Base-URL mode only. See [Using it from n8n](https://workflowtools.dev/integration-mock/n8n) |
| Node.js | 20 or newer |
| Docker | Only for `integration-mock up` |

## Questions

### Does it change my workflow?

No, unless you run `creds swap --in-place`. In base-URL mode you change a node's URL yourself. In proxy mode nothing in the workflow changes.

### Does it need my n8n instance?

Not for mocking. `start`, `packs`, `url`, `faults` and `log` need no instance, no API key and no network. `snapshot`, `diff` and `creds` need an instance you add with `instances add`.

### Why did my call get a 501?

No enabled pack has a route for that method and path. The `hint` in the response says what to do: record the call, or add a route to the pack in `./.integration-mock/packs/<service>/`.

### Does a call ever reach the real service?

Only when you ask for it.

| Command | Contacts |
|---|---|
| `record` | The real service, while recording |
| `verify` | The real service |
| `packs install`, `packs build --fetch`, `packs update`, `packs audit` | The source of the pack or OpenAPI file |
| `snapshot`, `diff`, `creds` | Your n8n instance |
| Everything else | Nothing |

### Do I have to restart the mock after adding a pack?

No. `packs enable` tells the running mock to re-read your packs.

### Where are my API key and the request log stored?

Both are plain text under `~/.integration-mock/`. Credential headers and query parameters, token-shaped strings, JWTs and Basic credentials are redacted in the log, in recorded packs and in `verify --patch` output. See [SECURITY.md](https://github.com/LudwigGerdes/integration-mock/blob/main/SECURITY.md).

## Alternatives

| Alternative | Use it instead when |
|---|---|
| Pinned data in n8n | You only need one node's output fixed while you work in the editor |
| Prism, WireMock or Mockoon | You already maintain OpenAPI mocks for your own services |
| A hand-written stub endpoint | You need one endpoint for one afternoon |
| The service's own sandbox account | The service offers one and you have access. `verify` can then check the mock against it |

## Limitations

- Identical repeated calls get the first matching route's answer. A node that posted three different messages replays the first response three times.
- Pagination is recorded as a single page, with a warning.
- The mock port has no authentication and serves plain HTTP. Do not expose it to the internet as it is.
