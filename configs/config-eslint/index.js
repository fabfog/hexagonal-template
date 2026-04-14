import path from "node:path";
import { fileURLToPath } from "node:url";
import eslint from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import prettierConfig from "eslint-config-prettier";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(dirname, "..", "..");

/** Domain slices (order matches `boundaries/elements`: specific before catch-all). */
const domainElementTypes = [
  "domain-errors",
  "domain-value-objects",
  "domain-entities",
  "domain-services",
  "domain-utils",
  "domain-other",
];

/**
 * Application slices that are NOT orchestration.
 * Used in allow rules: every application slice (orchestration or not) may import these,
 * but orchestration slices are excluded — they can only be composed externally.
 */
const applicationNonOrchestrationSlices = [
  "application-dtos",
  "application-interaction-ports",
  "application-ports",
  "application-mappers",
  "application-other",
];

/** All Application slices (specific paths before `application-other`).
 * NOTE: `application-interaction-ports` must come before `application-ports` so the
 * more-specific glob wins first-match in boundaries/elements. */
const applicationElementTypes = [
  "application-use-cases",
  "application-modules",
  ...applicationNonOrchestrationSlices,
];

/** What any application slice may import: full domain + non-orchestration application only. */
const applicationAllowTo = [
  ...domainElementTypes.map((t) => ({ type: t })),
  ...applicationNonOrchestrationSlices.map((t) => ({ type: t })),
];

/**
 * Feature infrastructure: driven-* (feature-scoped only), lib-* (per-feature or under `features/shared/infrastructure/`).
 * In boundaries/elements, list narrower patterns before catch-alls so the first match wins.
 */
const infrastructureElementTypes = [
  "infrastructure-driven",
  "shared-infrastructure",
  "infrastructure-lib",
  "infrastructure-other",
];

const infrastructureDrivenSurfaceAllowTo = [
  { type: "domain-errors" },
  { type: "domain-value-objects" },
  { type: "domain-entities" },
  { type: "application-dtos" },
  { type: "application-interaction-ports" },
  { type: "application-ports" },
  { type: "application-other" },
  { type: "infrastructure-driven" },
  { type: "infrastructure-lib" },
  { type: "shared-infrastructure" },
  { type: "infrastructure-other" },
];

/**
 * Shared generic libs only (`features/shared/infrastructure/lib-*`). No domain entities; no feature-scoped infra types.
 */
const infrastructureSharedInfrastructureAllowTo = [
  ...domainElementTypes.filter((t) => t !== "domain-entities").map((t) => ({ type: t })),
  { type: "application-dtos" },
  { type: "application-interaction-ports" },
  { type: "application-ports" },
  { type: "application-other" },
  { type: "shared-infrastructure" },
];

const infrastructureLibAllowTo = [
  ...domainElementTypes.map((t) => ({ type: t })),
  { type: "application-dtos" },
  { type: "application-interaction-ports" },
  { type: "application-ports" },
  { type: "application-other" },
  { type: "infrastructure-other" },
  { type: "infrastructure-lib" },
  { type: "shared-infrastructure" },
];

const infrastructureOtherAllowTo = [
  ...domainElementTypes.map((t) => ({ type: t })),
  { type: "application-dtos" },
  { type: "application-interaction-ports" },
  { type: "application-ports" },
  { type: "application-other" },
  { type: "infrastructure-other" },
  { type: "infrastructure-lib" },
  { type: "shared-infrastructure" },
];

/** @type {import('eslint').Linter.Config[]} */
const config = defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  tseslint.configs.stylistic,
  {
    languageOptions: {
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        require: "readonly",
        exports: "writable",
      },
    },
    plugins: {
      boundaries,
    },
    settings: {
      "boundaries/elements": [
        {
          type: "domain-errors",
          pattern: "features/*/domain/**/errors/**",
        },
        {
          type: "domain-value-objects",
          pattern: "features/*/domain/**/value-objects/**",
        },
        {
          type: "domain-entities",
          pattern: "features/*/domain/**/entities/**",
        },
        {
          type: "domain-services",
          pattern: "features/*/domain/**/services/**",
        },
        {
          type: "domain-utils",
          pattern: "features/*/domain/**/utils/**",
        },
        {
          type: "domain-other",
          pattern: "features/*/domain/**",
        },
        {
          type: "application-dtos",
          pattern: "features/*/application/**/dtos/**",
        },
        {
          type: "application-use-cases",
          pattern: "features/*/application/**/use-cases/**",
        },
        {
          type: "application-modules",
          pattern: "features/*/application/**/modules/**",
        },
        {
          type: "application-interaction-ports",
          pattern: "features/*/application/**/ports/*.interaction.port.*",
        },
        {
          type: "application-ports",
          pattern: "features/*/application/**/ports/**",
        },
        {
          type: "application-mappers",
          pattern: "features/*/application/**/mappers/**",
        },
        {
          type: "application-other",
          pattern: "features/*/application/**",
        },
        {
          type: "shared-infrastructure",
          pattern: "features/shared/infrastructure/lib-*/**",
        },
        {
          type: "infrastructure-driven",
          pattern: "features/!(shared)/infrastructure/driven-*/**",
        },
        {
          type: "infrastructure-lib",
          pattern: "features/*/infrastructure/lib-*/**",
        },
        {
          type: "infrastructure-other",
          pattern: "features/*/infrastructure/**",
        },
        {
          type: "composition",
          pattern: "features/*/composition/**",
        },
        {
          type: "apps",
          pattern: "apps/**",
        },
        {
          type: "ui",
          pattern: "features/*/ui/**",
        },
      ],
      "import/resolver": {
        typescript: {
          project: [path.join(repoRoot, "tsconfig.repo.json")],
        },
      },
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["features/**", "composition/**"],
              message:
                "Do not import from repo layout paths (`features/`, `composition/`). Use workspace package aliases/exports from each package's `package.json`.",
            },
          ],
        },
      ],
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          rules: [
            // ── Domain ──────────────────────────────────────────────────────
            // Domain is self-contained: any domain slice may import any other domain slice.
            ...domainElementTypes.map((type) => ({
              from: { type },
              allow: { to: domainElementTypes.map((t) => ({ type: t })) },
            })),

            // ── Application: use-cases (incl. interactive) and non-orchestration slices ──
            // May import: all domain types + non-orchestration application types
            // (dtos, ports, mappers, other).
            // Use-cases are intentionally absent from this list so they
            // cannot call each other directly — orchestration happens in feature composition packages (`features/*/composition/**`).
            ...applicationElementTypes
              .filter((t) => t !== "application-modules")
              .map((type) => ({
                from: { type },
                allow: { to: applicationAllowTo },
              })),

            // ── Application: modules (optional path under application) ─
            // If present, modules wire use-cases together. Prefer feature-scoped composition packages
            // (`features/*/composition/**`) for new wiring; they may NOT import other modules.
            {
              from: { type: "application-modules" },
              allow: {
                to: [...applicationAllowTo, { type: "application-use-cases" }],
              },
            },

            // ── Infrastructure: driven-* (flat package root; may import domain entities) ─
            {
              from: { type: "infrastructure-driven" },
              allow: { to: infrastructureDrivenSurfaceAllowTo },
            },

            // ── Infrastructure: lib-* (generic utilities; feature or shared path) ─
            {
              from: { type: "infrastructure-lib" },
              allow: { to: infrastructureLibAllowTo },
            },

            // ── Infrastructure: shared libs only (`features/shared/infrastructure/lib-*`) ─
            {
              from: { type: "shared-infrastructure" },
              allow: { to: infrastructureSharedInfrastructureAllowTo },
            },

            // ── Infrastructure: other packages (e.g. loose helpers under infrastructure/) ─
            {
              from: { type: "infrastructure-other" },
              allow: { to: infrastructureOtherAllowTo },
            },

            // ── Composition ──────────────────────────────────────────────────
            // The wiring layer: may import from any layer except apps and ui.
            {
              from: { type: "composition" },
              allow: {
                to: [
                  ...domainElementTypes.map((t) => ({ type: t })),
                  ...applicationElementTypes.map((t) => ({ type: t })),
                  ...infrastructureElementTypes.map((t) => ({ type: t })),
                ],
              },
            },

            // ── Apps ─────────────────────────────────────────────────────────
            // Runnable apps: only composition (wiring) + application DTOs and
            // interaction ports (InteractionPort types for UI-driven interactive use cases) + ui packages.
            {
              from: { type: "apps" },
              allow: {
                to: [
                  { type: "application-dtos" },
                  { type: "application-interaction-ports" },
                  { type: "composition" },
                  { type: "ui" },
                ],
              },
            },

            // ── UI ───────────────────────────────────────────────────────────
            // View packages: data reaches the UI through composition props; no direct layer imports.
            // Only exception: ui may import other ui packages (e.g. ui-icons → ui-react).
            {
              from: { type: "ui" },
              allow: { to: [{ type: "ui" }] },
            },
          ],
        },
      ],
    },
  },
  {
    files: ["features/!(shared)/infrastructure/driven-*/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["features/**", "composition/**"],
              message:
                "Do not import from repo layout paths (`features/`, `composition/`). Use workspace package aliases/exports from each package's `package.json`.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["features/shared/infrastructure/driven-*/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Program",
          message:
            "Do not place driven-* packages under features/shared/infrastructure/. Shared infra is lib-* only (generic utilities). Use feature-scoped driven-* for adapters and persistence.",
        },
      ],
    },
  },
  {
    files: [
      "features/*/domain/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
      "features/*/application/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
    ],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "process",
          message:
            "Do not use `process` in domain or application packages; inject Node/platform concerns from composition or infrastructure.",
        },
        {
          name: "globalThis",
          message:
            "Do not use `globalThis` in domain or application packages; keep code free of global runtime access.",
        },
      ],
    },
  },
  // Disable any formatting rules that could conflict with Prettier
  prettierConfig,
  {
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  }
);

export default config;
