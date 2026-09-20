# Contributing to integration-mock

Thanks for looking. integration-mock is maintained by one person; small, well-tested
changes land fastest.

## Prerequisites

- Node >= 20
- pnpm 10.22 (`corepack enable` installs it from the `packageManager` field)
- No n8n instance, API key or network is needed for the offline suite

## The dev loop

```bash
pnpm install
pnpm build && pnpm typecheck && pnpm test
```

Build first: `packages/cli` bundles the other packages with esbuild, and the
repo-level tests resolve them through `dist/`. `pnpm -r build` orders the
packages by workspace dependency (`core` → `proxy`, `packs` → `cli`).

Run the CLI from the checkout with `node packages/cli/dist/bin.js <verb>`.

Anything that touches packaging — `packages/cli/build.mjs`, `prepack.mjs`,
`files`, a new file read at runtime, a new spawned process — also needs
`pnpm smoke`. It clones the **committed** state and installs the packed
tarball into an empty project, so commit first. It uses a throwaway home and
ports 18180/18181, and needs the network only for `pnpm install`/`npm install`.
Locate runtime data through `dataPaths()` (`packages/packs/src/paths.ts`), and
never resolve a workspace package name at runtime.

## One package's tests

```bash
pnpm --filter integration-mock-core test
pnpm --filter integration-mock test -- test/packs-install.test.ts
```

`pnpm test:instance` runs the end-to-end loop against an n8n you configure
with `integration-mock instances add … --default`; it skips when none is.

## Adding things

- **A vendor pack** — a `sources.yaml` entry and one build command; the recipe
  is `docs/adding-a-vendor.md`. Generated routes go to `10-generated.json`;
  hand fixes go in `00-overrides.json` beside it, never in the generated file.
- **A hand-authored pack** — `integration-mock packs init <service> --domain <host>`,
  then `integration-mock packs validate <service>`. `skills/integration-mock-author-pack/SKILL.md` drives that loop
  with an agent.
- **A fixture** — small OpenAPI docs live in `packages/packs/test/fixtures/`;
  reverse-mapper fixtures are one `<node>.node-output.json` each. Fixtures come
  from throwaway containers and reserved `*.test` hostnames, never from a real
  instance.
- **A test** — vitest, next to the package in `packages/<pkg>/test/`, offline.
  `packages/packs/test/library.test.ts` walks every shipped pack, so a new pack
  needs no new test.

## Pull requests

- Failing test first, then the fix. Keep the suite green and offline.
- Strict TypeScript: no `any`, no `as` where a type guard will do.
- Conventional commit messages (`fix(cli): …`, `feat(packs): …`, `docs: …`).
- One logical change per PR; describe what a user sees differently.

`AGENTS.md` has the layout, conventions and the list of modules allowed to
touch the network — read it before changing anything under `packages/`.
