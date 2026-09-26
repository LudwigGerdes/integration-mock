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
| `routes/00-overrides.json` | Your fixes. It sorts first, so it wins |

To edit a shipped pack, copy it into your project first:

```bash
integration-mock packs eject slack
```

Downloaded specs are cached under `~/.integration-mock/vendor-specs/`, so a rebuild works offline.
