# Third-party notices

integration-mock itself is MIT licensed — see `LICENSE`. This file lists what it ships
or depends on that is someone else's work.

## Generated vendor packs

The service packs under `packages/packs/packs/` are generated from published
OpenAPI descriptions and carry route paths, field names and example values
originating in those documents. `NOTICE` records, per pack, the spec URL each
was generated from and the licence the spec states (Apache 2.0, MIT, CC-BY 3.0,
or none stated). Credential-shaped example values (PEM blocks, AWS key ids)
are replaced with labelled placeholders at generation time.

The packs are development mocks. They are not affiliated with, endorsed by, or
a substitute for the services they imitate, and the trademarks and service
names belong to their owners. A vendor that wants its pack removed or corrected
can open an issue.

## n8n

integration-mock is a tool for testing [n8n](https://n8n.io) workflows. It is not
affiliated with, endorsed by, or supported by n8n GmbH.

integration-mock bundles **no** n8n source, node descriptions or icons, and has no
runtime dependency on any n8n package. The conformance fixtures under
`conformance/executions/` are execution exports captured from a locally run
n8n 2.10.0 instance via its public API; they contain no n8n code.

## Direct dependencies

All direct runtime dependencies are under permissive licences:

| Package | Licence |
|---|---|
| `ajv` | MIT |
| `commander` | MIT |
| `nanoid` | MIT |
| `node-forge` | BSD-3-Clause or GPL-2.0 (used under BSD-3-Clause) |
| `picomatch` | MIT |
| `undici` | MIT |
| `yaml` | ISC |

They are not bundled: the CLI build marks them external, so they are installed
alongside integration-mock and their full licence texts sit in
`node_modules/<package>/LICENSE*`.
