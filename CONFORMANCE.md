# Conformance fixtures

Fixtures owned by **integration-mock** for the formats it shares with sibling tools that
consume n8n workflow and execution JSON (the seams are numbered S2–S4, S8
below). Consumers copy them verbatim into `test/conformance/integration-mock/` and run
them against their own implementation; a copy that drifts from these fails on
the consumer's side, which is the signal to sync.

**Version stamp:** captured against **n8n 2.10.0** (`SUPPORTED_N8N_VERSION`).

| Fixture | Seam | What it pins down |
|---|---|---|
| `../schema/integration-mock.test.schema.json` | S2 | Test file format, draft 2020-12. Both the `cases:` list and the single-case form; a file carrying both is invalid. |
| `suite.cases.yaml` | S2 | A test file exercising file-level defaults, per-case `given` override, both trigger forms, call assertions, `noUnmatched`, and `pinData` (S8). |
| `suite.cases.expected.json` | S2 | What a loader must produce from it: defaults merged per case, single-case form normalised to one case with id `default`. |
| `matchers.json` | S3 | 24 rows of `{actual, path, matcher, expected, result}`. Covers `equals` (default), `contains`, `matches`, `count`, `gte`, `lte`, plus dotted paths, `[n]` indexes and `*` globs. |
| `executions/success.json` | S4 | A clean run: every node once. |
| `executions/error.json` | S4 | A failed run: `status: error`, `finished: false`, `resultData.error` present, failing node with no output. |
| `executions/multi-run.json` | S4 | A node that ran **three times** inside a loop — the case that separates "several runs" from "several items in one run". A consumer reading only `runData[node][0]` is wrong, and this fixture is how it finds out. |

## Semantics worth stating

Two matcher rules are choices rather than defaults, and a twin implementation
has to make the same ones:

- A path selects **every** match, so callers can distinguish "matched nothing"
  from "matched a falsy value".
- Every matcher except `count` requires at least one selected value. An
  assertion against a renamed node therefore **fails** rather than passing
  vacuously.

## Running them

`pnpm test` in this repo runs all of the above:
`packages/core/test/conformance.test.ts` (S2), `assert.test.ts` (S3) and
`executions-conformance.test.ts` (S4).

## Regenerating the execution exports

They are real captures, not hand-authored. Recreate them against a pinned n8n:

```bash
docker run -d --name n8n-conformance -p 5681:5678 \
  -e N8N_SECURE_COOKIE=false n8nio/n8n:2.10.0
# owner setup -> cookie; POST /rest/api-keys (label required) -> public API key
# create + run each workflow via /rest, then capture verbatim from
# GET /api/v1/executions/:id?includeData=true
```

Note that n8n's **internal** `/rest` routes differ between releases (2.10.0 has
`/rest/api-keys`, not `/rest/me/api-key`), while the **public** `/api/v1` shape
above is the stable one — which is exactly why S4 names the public API as the
interchange format.
