# Packs

A pack is the mock of one service. It holds the routes the service answers and the response for each.

## Shipped and available packs

```bash
integration-mock packs list
integration-mock packs install notion
integration-mock packs enable notion
```

- The npm package ships eight packs: `generic-rest`, `gmail`, `google-drive`, `google-sheets`, `hubspot`, `openai`, `salesforce` and `slack`.
- `packs list` also shows the packs you can download, marked `available`.
- `packs install` downloads a pack into `~/.integration-mock/packs/`. It is the only `packs` command besides `build --fetch`, `update` and `audit` that uses the network.
- Every file it downloads is checked against the sha256 the release's index recorded for it; a file that differs is refused and nothing is installed. `--ref <other>` installs from another git ref without the check and says so; `--no-verify` skips it.
- `INTEGRATION_MOCK_PACK_INDEX_URL=https://packs.example.internal/integration-mock` downloads from a mirror instead of GitHub: files are fetched at `<url>/<pack id>/<file>` and checked the same way.
- Only enabled packs answer calls.

## Pack metadata

`pack.json` may name who owns a pack and which version it is, for a team that publishes and pins its own packs:

```json
{
  "id": "erp",
  "domains": ["erp.example.internal"],
  "prefix": "/erp",
  "source": "authored",
  "version": "1.4.0",
  "owner": "integration-platform@example.com",
  "description": "The ERP order and invoice endpoints the fulfilment workflows call",
  "license": "internal"
}
```

`packs validate` accepts all four; `packs list` shows the version and owner when a pack has them. A recorded pack also carries `provenance` (when, by which release, redacted).

## Which pack answers a call

When several packs have the same id, the most specific one wins.

| Order | Layer | Where it lives |
|---|---|---|
| 1 | Snapshot | Mocks built from one real execution. Active until cleared |
| 2 | Project | `./.integration-mock/packs/` |
| 3 | User | `~/.integration-mock/packs/` |
| 4 | Library | Shipped in the package |

If no route matches, the mock answers `501` with a hint. It never calls the real service and never returns empty data.

```json
{
  "error": "integration-mock: no route",
  "service": "slack",
  "method": "GET",
  "path": "/nope",
  "hint": "run `integration-mock record` or add to ./.integration-mock/packs/slack"
}
```

## Writing a pack by hand

Use this for a service that has no pack and publishes no OpenAPI file.

```bash
integration-mock packs init acme --domain api.acme.com
integration-mock packs validate acme
integration-mock packs enable acme
curl http://127.0.0.1:8080/acme/example
```

![Writing a pack in four commands: init, the generated routes file, validate, curl](https://raw.githubusercontent.com/LudwigGerdes/integration-mock/main/docs/images/integration-mock-final-1.png)

`packs init` writes a working route and a 404 route, so both shapes are there to copy. A pack created while the mock is running is served as soon as you enable it.

This creates:

```text
.integration-mock/
└── packs/
    └── acme/
        ├── pack.json          id, domains, prefix, source
        └── routes/
            └── main.json      routes; files in routes/ are merged in file-name order
```

### With an AI agent

[`skills/integration-mock-author-pack/SKILL.md`](https://github.com/LudwigGerdes/integration-mock/blob/main/skills/integration-mock-author-pack/SKILL.md) is an agent skill that writes a pack from a service's documentation. The agent writes the files and `packs validate --json` tells it what is wrong. integration-mock itself never calls a model.

## Responses that change

A static body cannot test a workflow that creates a record and then reads it back. Two additions to a route cover most of that.

`sequence` answers each call in turn — the first call gets the first response, the second the second — and past the end `respond` answers (or, without one, the last entry repeats). Counts reset with `packs reset`.

```json
{
  "id": "create-order",
  "match": { "method": "POST", "path": "/orders" },
  "sequence": [
    { "status": 201, "body": { "id": "o_1" } },
    { "status": 429, "body": { "error": "rate limited" } }
  ],
  "respond": { "status": 201, "body": { "id": "o_n" } }
}
```

`template: true` renders placeholders in the body and headers from the request:

```json
{
  "id": "get-order",
  "match": { "method": "GET", "path": "/orders/:id" },
  "respond": {
    "status": 200,
    "template": true,
    "body": { "id": "{{request.params.id}}", "customer": "{{request.body.customer}}", "seen": "{{counter}}", "at": "{{now}}" }
  }
}
```

| Placeholder | Value |
|---|---|
| `request.body.<path>`, `request.query.<key>`, `request.params.<name>`, `request.headers.<name>` | From the request. A string that is only a placeholder yields the value itself, so an object is echoed as an object |
| `request.path`, `request.method` | The request line |
| `uuid` | A fresh v4 id |
| `now`, `timestamp` | ISO time, epoch seconds |
| `counter` | How many times this route has answered, from 1 |

Templating is off unless the route asks for it, so a recorded body that happens to contain `{{…}}` replays as it was. An unknown placeholder is left as written.

## Stateful routes

A route with a `store` block reads and writes the mock's records instead of answering a fixed body, so a workflow that creates a record can read it back, list it, page through it and delete it. Its `respond` is rendered with `template: true` and these names:

| Name | Holds |
|---|---|
| `record` | The record a `create`, `get`, `update` or `delete` acted on |
| `records` | The current page of a `list` |
| `page` | Paging values (below) |

```json
{
  "id": "acme:create-order",
  "match": { "method": "POST", "path": "/orders" },
  "store": {
    "op": "create",
    "collection": "orders",
    "id": { "field": "id", "format": "ord_{{seq:6}}" },
    "stamp": { "object": "order", "created": "{{timestamp}}" },
    "idempotency": { "header": "Idempotency-Key" }
  },
  "respond": { "status": 201, "template": true, "body": "{{record}}" }
}
```

| Key | Meaning |
|---|---|
| `op` | `create`, `get`, `update`, `delete` or `list` |
| `collection` | Which records. Seeded from `seed` in `pack.json` |
| `idParam` | The path param holding the id. Needed only when the path has more than one param |
| `id` | `field` holds the id (default `id`); `format` mints new ones: literal text plus `{{seq:N}}` (a counter, zero-padded to N) or `{{uuid}}` |
| `stamp` | Fields added to a new record, rendered as a template (`{{record.id}}`, `{{now}}`, `{{timestamp}}`) |
| `update` | `merge` (default; nested objects merge key by key) or `replace` |
| `coerce` | Fields to turn from form-encoded strings into the type the vendor returns: `{ "amount": "number", "paid": "boolean" }` |
| `notFound`, `badRequest`, `conflict` | The vendor's own error responses. `{{error}}` holds the reason |

A JSON body must be an object. A form-encoded body (`application/x-www-form-urlencoded`) is read with brackets: `metadata[plan]=pro` is `{ "metadata": { "plan": "pro" } }`.

### Paging

```json
"pagination": { "style": "cursor", "cursorParam": "after", "limitParam": "limit", "defaultLimit": 10, "maxLimit": 100 }
```

| `style` | Reads | `page` holds |
|---|---|---|
| `cursor` | `cursorParam`: the id of the last record served | `next` (empty on the last page), `hasMore`, `total` |
| `offset` | `offsetParam` | `offset`, `nextOffset` (`null` on the last page), `hasMore`, `total` |
| `page` | `pageParam`, from 1 | `number`, `nextNumber`, `totalPages`, `hasMore`, `total` |
| `nextUrl` | a token in a URL the mock issued | `nextUrl` (empty when done), `done`, `total` |

`in: "body"` reads the params from a JSON body, for search endpoints. A `nextUrl` route sets `nextUrlTemplate` (with `{{token}}`), and the route that serves the next page sets `tokenParam`. A cursor naming a record that no longer exists, `limit=0` and non-numeric values answer `400`.

### Filtering

```json
"filters": [
  { "from": "query.email", "field": "email" },
  { "from": "query.created[gte]", "field": "created", "op": "gte" },
  { "from": "body.filterGroups", "style": "hubspot" },
  { "from": "query.q", "style": "soql" }
]
```

`from` is `query.<name>`, `body.<path>` or `params.<name>`; a filter whose input is absent or empty is skipped. A filter the mock does not implement can be declared `{ "from": "body.query", "style": "unsupported" }`: sending it answers `400` instead of returning everything. A SOQL `FROM` naming an object the pack does not model answers `400` too. `op` is `eq` (default), `ne`, `gt`, `gte`, `lt`, `lte`, `contains` or `in` (comma-separated). Two vendor styles:

- `hubspot` reads `filterGroups` (groups OR'd, filters within a group AND'd) with `EQ`, `NEQ`, `GT`, `GTE`, `LT`, `LTE` and `CONTAINS_TOKEN` on `properties.<name>`.
- `soql` reads `SELECT … FROM <Type> [WHERE a = 'x' AND b > 5] [ORDER BY f DESC] [LIMIT n]`. `FROM` picks the collection, so one route serves every object. `OR`, parentheses, functions, relationship fields and `IN` answer `400` naming the construct.

### Idempotency

`"idempotency": { "header": "Idempotency-Key" }` on a `create` or `update`: the same key with the same body returns the first response again; with a different body it answers `conflict` (`409`). `packs reset` clears records, counters, page tokens and keys. The mock keeps at most 1,000 page tokens and 10,000 idempotency keys per service, dropping the oldest.

Salesforce (Opportunity, Account, Contact), HubSpot (contacts, companies, deals) and Stripe (customers, charges) ship with stateful routes. `verify` compares only the status of a stateful route, since its body is computed.

## Generating a pack from OpenAPI

```bash
integration-mock packs build acme --spec ./acme-openapi.json   # OpenAPI 3.x or Swagger 2
integration-mock packs build stripe --fetch                    # download the spec listed in sources.yaml
```

- Every operation becomes a route.
- Response bodies come from the spec's `example`, then a named `examples` entry, then a generated value.
- Generated values are deterministic, so building twice gives identical files and a real upstream change stands out in the diff.
- A broken `$ref` costs one response body, not the build. Everything skipped is named in the report.

### Editing a generated pack

| File | Purpose |
|---|---|
| `routes/10-generated.json` | Written by `packs build`. Do not edit it |
| `routes/00-overrides.json` | Your fixes. It sorts first, so it wins: a route there replaces the generated route with the same method and path |

To edit a shipped pack, copy it into your project first:

```bash
integration-mock packs eject slack
```

Downloaded specs are cached under `~/.integration-mock/vendor-specs/`, so a rebuild works offline.
