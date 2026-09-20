# Adding a vendor to the library

Everything needed to add a vendor pack without reading the rest of the project.
Adding one touches **no code** in the normal case: a `sources.yaml` entry and one
build command. The shipped-pack test walks the packs directory, so a new pack is
picked up and served-checked automatically.

## Prerequisites

Network access (specs are fetched), and a built workspace:

```bash
pnpm install && pnpm -r build
```

## The recipe

1. **Find the spec.** Check the catalogue first — it is already downloaded by any
   previous audit run, and it indexes by *provider key*, not vendor name:

   ```bash
   curl -s https://api.apis.guru/v2/list.json -o /tmp/apis-guru.json
   python3 -c "import json;d=json.load(open('/tmp/apis-guru.json'));print([k for k in d if 'zendesk' in k.lower()])"
   ```

   Searching by common name misses entries: Google Sheets, Drive, Gmail and
   Microsoft Graph are all catalogued under `googleapis.com:sheets`,
   `microsoft.com:graph` and similar, and an earlier name-based pass reported all
   four as absent. If there is no entry, find the vendor's own published spec from
   their developer documentation.

2. **Verify the URL before recording it.** Fetch it and confirm it parses as a
   spec — not an HTML page, not a directory listing:

   ```bash
   curl -sL --max-time 45 -o /tmp/spec.json '<URL>'
   python3 -c "import json;d=json.load(open('/tmp/spec.json'));print(d.get('openapi') or d.get('swagger'), len(d.get('paths',{})),'paths')"
   ```

   YAML specs are fine — try `yaml.safe_load` if JSON parsing fails. **Never
   record a URL you have not fetched.** A guessed URL later reads as a dead
   vendor rather than a bad lookup, and costs someone an investigation.

3. **Add the entry** to `packages/packs/sources.yaml`:

   ```yaml
   zendesk:
     url: https://…/openapi.json
     license: "Apache 2.0"      # from the spec or the catalogue
     vendored: true             # only if the licence clearly permits redistribution
   ```

   `vendored: true` caches the bytes under `~/.integration-mock/vendor-specs/`; leave it
   false when the licence is unclear or the spec exceeds ~2 MB gzipped. The
   licence field is catalogue metadata, not a redistribution grant from the
   vendor — when in doubt, do not vendor.

   A vendor that publishes **one spec per API** uses a `urls` list instead; they
   are generated separately and merged, first `method:path` winning:

   ```yaml
   hubspot:
     url: <first url>           # kept for tooling that expects a single url
     urls: [<url1>, <url2>, <url3>]
   ```

4. **Build and check the report.**

   ```bash
   node packages/cli/dist/bin.js packs build zendesk --fetch
   ```

   Read the output rather than trusting the exit code. `routes 0` with a long
   skipped list means the spec did not survive generation — see the gaps below.

5. **Verify and record.**

   ```bash
   pnpm test                                                   # picks the new pack up automatically
   node packages/cli/dist/bin.js packs audit --out /tmp/a.md   # refresh the results table
   ```

   Paste the refreshed table under `## Results` in `docs/vendor-audit.md`, keeping
   the preamble above it.

## Gaps already hit — do not rediscover these

Roughly one vendor in four or five has forced a generator change. Each was found
by trying a real spec; none was caught by the fixtures.

| Symptom | Cause | Resolution |
|---|---|---|
| Build exhausts the heap and crashes | `$ref` graphs are diamonds, not chains: a schema referenced twice per level expands 2^depth. Stripe killed a 4 GB heap. | Fixed — `derefDeep` is depth-bounded and its `seen` set is path-scoped, not copied per ref. |
| Pack has no `domains` and no bodies | Swagger 2.0: no `servers`, and schemas hang off the response rather than `content[type]`. GitLab was 0 routes. | Fixed — `host`/`basePath` fallback and a direct `response.schema` read. |
| `routes 0` but the spec clearly has paths | Path items are `$ref`s to **separate remote documents**. Mailchimp is 181 of these. | We do not fetch remote refs; they are reported as skipped with the URL. The vendor stays unusable, honestly. |
| Vendor publishes many specs, none complete | One spec per API. HubSpot ships 117. | Use the `urls` list (step 3). |
| Routes land on dated or preview paths | Catalogue version arrays are ordered per API; `versions[0]` is not reliably the stable one. Companies was pinned to a preview while contacts and deals were stable. | Select by `stage == 'STABLE'`, never by array position. |

## Working in parallel

Sequential work is clean. If several people work at once, these are the
collision points, all of them single files or shared directories:

- `packages/packs/sources.yaml` — every vendor edits it
- `docs/vendor-audit.md` — regenerated wholesale
- `packages/packs/packs/` and `~/.integration-mock/vendor-specs/` — shared writes

Splitting by vendor and merging `sources.yaml` last avoids most of it.

## Still to do

None of these has a catalogue entry, so each needs its vendor's own published
spec found from their documentation:

Pipedrive, Close, Zendesk, Intercom, Freshdesk, PandaDoc, PagerDuty, Datadog,
Anthropic.

Confirmed unavailable, and **not** worth re-researching — the reasons are in
`docs/vendor-audit.md`: Linear and Monday (GraphQL-only, an explicit non-goal),
Airtable, QuickBooks, Supabase, Front, Salesforce, Mailchimp.
