---
name: integration-mock-author-pack
description: Use when a vendor integration-mock must mock publishes no OpenAPI spec - build a service pack from prose API documentation, validating until clean.
---

# Authoring an integration-mock pack from documentation

`packs build` needs an OpenAPI spec. Roughly a quarter of the mainstream B2B
vendors already investigated publish none, and the proportion is worse outside
developer-facing tools. This is the path for those: read the documentation,
write the pack, let integration-mock judge it.

integration-mock never calls a model. You write the files; `packs validate` says what is
wrong. Iterate against it until it is clean.

## The loop

1. `integration-mock packs init <service> --domain <vendor-host>`
2. Read the vendor's documentation for the operations you need.
3. Edit `.integration-mock/packs/<service>/routes/main.json`.
4. `integration-mock packs validate <service> --json`
5. Fix every `error`. Consider every `warning`. Repeat from 4.
6. `integration-mock packs enable <service>`, then `integration-mock url <service>` and call one
   route to confirm it serves.
7. Report which operations you covered and — explicitly — which you did not.

## Three rules

**Cover the workflow surface, not the API.** A vendor with 400 endpoints needs
the eight an automation actually touches: the read that fetches records, the
write that creates one, the auth handshake if there is one, and the error each
can return. Completeness is the failure mode — it produces bulk, not fidelity.

**Never invent field names.** Use only fields the documentation shows. If a
response shape is undocumented, omit the field rather than guessing. A
plausible-but-wrong field passes silently in the mock and fails at cutover,
which is the exact moment the mock exists to protect.

**Order literal segments before captures.** The matcher supports `:name`,
`*` and `**`, so `/things/:id` will swallow `/things/describe` if it comes
first. `validate` catches this and names both routes, but it is cheaper to get
the order right than to debug the report: literals above captures, specific
query matches above general ones.

**Record provenance.** Put the doc URL and section in each route's id or
alongside it, so a later verification run has something to diff against and a
human has something to check.

## What the validator will tell you

| Code | Level | Meaning |
|---|---|---|
| `schema` | error | The pack does not match the published pack schema |
| `duplicate-route-id` | error | Two routes share an id |
| `shadowed-route` | error | A route can never serve: an earlier one matches first |
| `prefix-collision` / `domain-collision` | error | Another installed pack already claims it |
| `inert-route` | warning | Neither `respond` nor `handler` — it does nothing |
| `no-error-routes` | warning | Every route succeeds; failure handling is untestable |

`shadowed-route` sees through the pattern grammar, so it catches `/x/:id`
placed above `/x/describe`, not only outright duplicates.

`no-error-routes` is the one most worth heeding. A mock that can only succeed
cannot exercise the branch of the workflow that matters most under pressure.

## What good looks like

- Every route body traceable to a documented example
- At least one error route per resource
- Paths matching the vendor's real URL structure, since the pack replays
  against real workflow calls
- A short note of what you did not cover, so the gap is known rather than
  discovered at cutover
