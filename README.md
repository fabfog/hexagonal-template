## hexagonal-monorepo-template

pnpm-based monorepo designed for a hexagonal architecture (Domain / Application / Infrastructure / UI) with shared configuration for TypeScript, ESLint, and Prettier.

### Requirements

- Node.js >=25, <26
- pnpm 9.x (see `packageManager` in `package.json`)

### Setup

```bash
pnpm install
```

### Dependency updates (Renovate)

[Renovate](https://github.com/renovatebot/renovate) opens PRs/MRs to keep npm dependencies and `pnpm-lock.yaml` current. This repo includes a root [`renovate.json`](./renovate.json) tuned for a **pnpm workspace** (single lockfile, all packages discovered automatically).

**Enable it on your forge** (same config file everywhere):

- **GitHub**: [Renovate GitHub App](https://github.com/apps/renovate)
- **GitLab**: [Renovate for GitLab](https://docs.renovatebot.com/modules/platform/gitlab/)
- **Bitbucket** (Cloud / Server): [Bitbucket](https://docs.renovatebot.com/modules/platform/bitbucket/) · [Bitbucket Server](https://docs.renovatebot.com/modules/platform/bitbucket-server/)
- **Other / air-gapped**: [self-hosted](https://docs.renovatebot.com/getting-started/running/) (Docker, CLI, or pipeline job) with the same `renovate.json`

Optional: validate config locally with `npx -p renovate renovate-config-validator renovate.json` (downloads the `renovate` package on first run).

### Root scripts

- `pnpm lint` – Run ESLint on the whole monorepo (with architectural constraints)
- `pnpm lint:fix` – ESLint with auto-fix where possible
- `pnpm format` – Format the whole codebase with Prettier
- `pnpm format:check` – Check formatting without modifying files
- `pnpm test` – Run the Vitest suite
- `pnpm test:watch` – Run Vitest in watch mode
- `pnpm test:coverage` – Run Vitest with V8 coverage
- `pnpm deps:renovate` – Validate `renovate.json` locally

---

## Monorepo structure

The pnpm workspace is defined in `pnpm-workspace.yaml`. Layout is **feature-first**: each capability lives under `features/<slug>/` with workspace packages for domain, application, optional composition, and infrastructure.

- **`features/<slug>/…`** — `@features/<slug>-domain`, `@features/<slug>-application`, `@features/<slug>-composition-<app>` (optional), and `@features/<slug>-infrastructure-*` (see below).
- **`features/shared/…`** — shared domain/application and **`features/shared/infrastructure/lib-*`** (`@features/shared-infra-lib-*`).
- **Apps** (`apps/*`) — runnable entrypoints (Next.js, Nest, etc.).
- **Tooling** (`configs/*`, `tools/*`) — shared TypeScript / ESLint / Vitest presets and Plop generators.

### Feature packages (flat package roots)

Sources and barrels live at the **package root** (e.g. `entities/`, `use-cases/`, `index.ts`); there is no `src/` layer under feature packages.

- **`features/<slug>/domain`**: entities, value objects, domain errors, services; no DB/API/UI.
- **`features/<slug>/application`**: ports, use cases, DTOs, mappers; subpath `exports` in `package.json` (no root `"."` barrel).
- **`features/<slug>/composition/<app>`**: wiring hub (`index.ts`, `types.ts`); instantiates use cases and adapters for that surface.
- **`features/<slug>/infrastructure/driven-*`**: outbound adapters as flat `*.ts` files, re-exported from `index.ts`.
- **`features/shared/infrastructure/lib-*`**: reusable infra libraries (HTTP client, DataLoader, Immer-backed store, etc.).

**`@features/shared-infra-lib-react-immer-store`** (under `features/shared/infrastructure/lib-react-immer-store`) provides `createImmerStore` / `ExternalStore<T>` on the main export and `useImmerStore` on `@features/shared-infra-lib-react-immer-store/client` for React `useSyncExternalStore`. InteractionPort adapters in feature `driven-*` packages depend on it; domain/application stay free of React.

**`apps/*`** may import only the workspace packages allowed by ESLint (see below): feature **composition** packages, plus selected application slices; composition is the assembly layer.

### `configs/` folder

This is where **shared configuration packages** live, used by other packages/apps but containing no domain logic.

- **`configs/config-typescript`** (`@features/config-typescript`)
  - Contains:
    - TS preset `base.json` with common options: target, strictness, `noEmit`, etc.
  - Typical usage: extended by `tsconfig.repo.json` at the root, which is then extended by packages/apps.

- **`configs/config-eslint`** (`@features/config-eslint`)
  - Contains:
    - ESLint flat config (v9) with:
      - `@eslint/js` + `typescript-eslint` (base + stylistic rules)
      - `eslint-plugin-boundaries` for architectural constraints
      - TypeScript resolver (`eslint-import-resolver-typescript`) configured against `tsconfig.repo.json`
    - Architectural rules enabled via `boundaries/dependencies` (e.g. domain must not import application/infrastructure). For **`features/*/infrastructure/driven-*`** (not under **`features/shared/`**), adapter code may import **domain entities** as well as errors, value-objects, application DTOs/ports, and infra libs. **`features/shared/infrastructure/`** is **`lib-*` only** (generic utilities); the **shared-infrastructure** boundary has no domain entities.
  - It is consumed by `eslint.config.cjs` at the root of the monorepo.

- **`configs/config-vitest`** (`@features/config-vitest`)
  - Contains:
    - a shared Vitest helper (`defineBaseVitestConfig`) re-exported from the package entry
    - default test settings such as `environment: "node"` and `include: ["features/**/*.test.ts"]`
  - It can be imported by packages/apps that want a shared Vitest baseline with local overrides.

Other config packages that can live here in the future:

- `config-prettier`
- `config-jest`
- `config-stylelint`

---

## TypeScript configuration

The global TS configuration lives in `tsconfig.repo.json` and is meant to:

- avoid `.js` file extensions in imports
- allow NestJS or other Node/FE apps to compile package sources directly

The shared base options live in `configs/config-typescript/base.json`, while `tsconfig.repo.json` adds repo-level overrides such as `baseUrl`, `module: "ESNext"`, and `moduleResolution: "bundler"`.

Each package defines its own `tsconfig.json` extending `tsconfig.repo.json`.

---

## ESLint configuration

The main ESLint config lives in `configs/config-eslint` and is exposed from the root via `eslint.config.cjs`:

Key aspects of the shared config:

- uses `@eslint/js` + `typescript-eslint` (flat config)
- defines architectural layers via `eslint-plugin-boundaries`
- `eslint-plugin-boundaries`: layers are split into **explicit element types** (no broad `application` / `domain` / `infrastructure` catch-alls): e.g. **`application-dtos`**, **`application-use-cases`** (includes `*.interactive.use-case.ts` under `application/use-cases/`), **`application-modules`**, **`application-interaction-ports`** (`*.interaction.port.*`), **`application-ports`**, **`application-mappers`**, **`application-other`**; **`domain-errors`**, **`domain-value-objects`**, **`domain-entities`**, **`domain-services`**, **`domain-utils`**, **`domain-other`**; for **`features/*/infrastructure/`**: **`shared-infrastructure`** (first-match for `features/shared/infrastructure/lib-*/**`), **`infrastructure-lib`** (same `lib-*` layout under a feature slug; stricter rules apply under shared via the previous type), **`infrastructure-driven`** (`driven-*/**` outside `features/shared/`, may use domain entities among other allowed deps), **`infrastructure-other`**. Key boundary rules:
  - **Domain** must not import anything above itself (no application / infrastructure / composition / UI / apps).
  - **Application orchestration** (`use-cases`, `modules`) must not import each other; they are independent and composed externally. `mappers` are logic (not orchestration) and may be imported by use-cases.
  - **Infrastructure** must not import application logic (`use-cases`, `modules`, `mappers`); feature-scoped **`features/.../infrastructure/driven-*`** may import domain entities (and errors, value-objects, DTOs, ports, infra libs). **`no-restricted-imports`** still blocks raw repo path imports such as `features/**` (use workspace package names from each `package.json`). **`driven-*`** must not live under **`features/shared/infrastructure/`** (ESLint `no-restricted-syntax` on that path).
  - **Composition** (`features/*/composition/**`) may import anything except `apps` and `ui`; it is the only place that assembles use cases, adapters, and infra for a delivery surface.
  - **Apps** may import only **`composition`** (those feature composition packages), **`application-dtos`** (use-case result shapes) and **`application-interaction-ports`** (`*.interaction.port.*` — `InteractionPort` types for interactive use cases); plain ports, orchestration, and all other application/domain/infrastructure layers are forbidden.
  - **UI** must not import any application slice (including DTOs), domain, or infrastructure; all data reaches the UI through composition.

### Lint scripts

- **Root**:
  - `pnpm lint` – ESLint on the whole monorepo (`.`)
  - `pnpm lint:fix` – ESLint with fixes
- **A workspace package** (example paths):
  - `pnpm -C features/shared/domain lint`
  - `pnpm -C features/plop-demo/domain lint:fix`

Thanks to the root `eslint.config.cjs`, you don’t need a separate ESLint config per package unless you need overrides.

---

## Code generators (Plop)

This repo uses [Plop](https://plopjs.com) to scaffold **`features/<slug>/…`** workspace packages: domain, application, infrastructure, and feature-local composition. Generators are split by layer under `tools/plop/plopfile-<layer>.ts`; `pnpm plop` opens a menu that runs Plop with the chosen plopfile.

- **How to run**

  ```bash
  pnpm plop
  ```

- **Shared utilities** (`tools/plop/lib/`): TypeScript helpers (casing, workspace package discovery, `ts-morph` wiring/merges for composition and adapters) used by `tools/plop/generators/`.

- **Generators** (names match the Plop menu). All paths follow the **feature layout** (flat package roots under `features/`, no `src/` wrapper).

  **Feature shell**
  - **`feature-core`** — Create `features/<kebab>/` and add `@features/<kebab>-domain` and/or `@features/<kebab>-application` if missing (`package.json`, `tsconfig.json`, slice folders).

  **Domain** (`@features/<slug>-domain`)
  - **`feature-domain-entity`** — Add an entity (`entities/`, barrel).
  - **`feature-domain-value-object`** — Add a value object (`value-objects/`, barrel).
  - **`feature-domain-error`** — Add a domain error (`errors/`, barrel).
  - **`feature-domain-service`** — Add a domain service (`services/`, barrel).
  - **`feature-domain-entity-add-vo-field`** — Add one VO-backed field to an existing entity.

  **Application** (`@features/<slug>-application`)
  - **`feature-application-port`** — Add a port (`ports/`, barrel).
  - **`feature-application-use-case`** — Add a standard `*.use-case.ts` or interactive `*.interactive.use-case.ts` + `*.interaction.port.ts`; constructor deps are wired from the **feature composition** package (optional `application/modules` remains available for special cases but is not the default wiring path documented here).
  - **`feature-application-add-dependency-to-use-case`** — Add a normal port field to a use case deps interface.
  - **`feature-application-entity-to-dto-mapper`** — DTO + mapper + test under `dtos/` / `mappers/`.

  **Infrastructure**
  - **`feature-infrastructure-lib-package`** — New `features/<slug|shared>/infrastructure/lib-<name>/` (`@features/shared-infra-lib-*` when under `shared`).
  - **`feature-infrastructure-driven-package`** — New `features/<slug>/infrastructure/driven-<name>/` (flat `*.ts`, `index.ts`).
  - **`feature-infrastructure-driven-port-adapter`** — Create or merge `*.adapter.ts` for a normal port from `@features/…-application` (excludes repository + interaction ports).
  - **`feature-infrastructure-driven-immer-interaction-adapter`** — Create or merge `immer-*.interaction-adapter.ts` for an `InteractionPort`.
  - **`feature-infrastructure-driven-repository-port-adapter`** — Same merge style for `*.repository.port.ts`.
  - **`feature-infrastructure-raw-to-domain-entity-mapper`** — Raw-to-entity mapper (+ test) on a `driven-*` package.

  **Composition** (`features/<slug>/composition/<app>/`, `@features/<slug>-composition-<app>`)
  - **`feature-composition-app`** — Hub package: `index.ts` (`infrastructureProvider`, `get…UseCases`), `types.ts` (`RequestContext`), exports `.` and `./types`.
  - **`feature-composition-wire-dataloader-registry`** — Request-scoped `DataLoaderRegistry` on the hub (`@features/shared-infra-lib-dataloader`).
  - **`feature-composition-wire-http-client`** — Request-scoped `HttpClient` on the hub (`@features/shared-infra-lib-http`; leaves `FIXME`s for real URLs/headers).
  - **`feature-composition-wire-use-case`** — Wire a use case’s constructor deps and adapters into the hub via AST merge.

Generators stay minimal: folders, barrels, and stubs/TODOs—business logic and mappings are intentional edits.

**Infrastructure wiring notes**

- `@features/shared-infra-lib-http` is optional; use it when you want correlation/header helpers. SDK-only adapters can skip it.
- `HttpContext` stays separate from `RequestContext`; the composition layer maps between them.
- `@features/shared-infra-lib-dataloader` defaults to `createDataLoaderRegistry()` (request-scoped). `createIdleDataLoader()` is opt-in for long-lived runtimes.
