import type { ActionType, NodePlopAPI } from "node-plop";
import type { Answers } from "inquirer";
import { getDomainEntitySelectChoices } from "../lib/domain-entity-vo-fields.ts";
import {
  getRepoDomainPackageChoices,
  readDomainPackageJsonName,
} from "../lib/repo-domain-packages.ts";
import { getRepoDrivenInfrastructurePackageChoices } from "../lib/repo-infrastructure-driven-packages.ts";
import { getRepoRoot } from "../lib/repo-root.ts";
import { resolveWorkspaceDependencyVersion } from "../lib/workspace-dependency-version.ts";
import {
  appendDrivenRootIndexExport,
  stripRepositoriesSubpathExport,
} from "../lib/driven-root-index-exports.ts";
import { toKebabCase, toPascalCase } from "../lib/casing.ts";

const repoRoot = getRepoRoot();

export default function registerFeatureInfrastructureRawToDomainEntityMapperGenerator(
  plop: NodePlopAPI
) {
  plop.setGenerator("feature-infrastructure-raw-to-domain-entity-mapper", {
    description:
      "Add a raw→domain-entity mapper scaffold (+ test) as flat files at the root of a `driven-*` package (re-exported from `index.ts`).",
    prompts: [
      {
        type: "list",
        name: "domainPackageRel",
        message: "Select @features/*-domain package (entity source):",
        choices: () => {
          const c = getRepoDomainPackageChoices(repoRoot);
          if (!c.length) {
            throw new Error(
              'No @features/*-domain packages found. Add features/<slug>/domain/package.json with "name": "@features/<slug>-domain".'
            );
          }
          return c;
        },
      },
      {
        type: "list",
        name: "entityName",
        message: "Select domain entity:",
        choices: (answers: Answers) =>
          getDomainEntitySelectChoices(repoRoot, String(answers.domainPackageRel ?? "")),
      },
      {
        type: "list",
        name: "drivenPackageRel",
        message:
          "Select driven-* infrastructure package (mapper files are added flat at package root):",
        choices: () => {
          const c = getRepoDrivenInfrastructurePackageChoices(repoRoot, {
            excludeFeaturesSharedInfrastructure: true,
          });
          if (!c.length) {
            throw new Error(
              "No feature-scoped driven-* packages under features/*/infrastructure/. Run feature-infrastructure-driven-package first (shared infra uses lib-* only)."
            );
          }
          return c;
        },
      },
      {
        type: "input",
        name: "rawName",
        message:
          "Raw label for file + function name (CASE-SENSITIVE Pascal segment, e.g. PersistenceLineItemRow → mapPersistenceLineItemRowTo…; kebab file name). The mapper parameter type is always `unknown` — add a concrete type/import yourself when wiring an SDK row type.",
        validate: (value: unknown) =>
          String(value ?? "").trim().length > 0 || "Name cannot be empty",
        filter: (value: unknown) => String(value ?? "").trim(),
      },
    ],
    actions: (data?: Answers): ActionType[] => {
      if (!data) return [];
      const domainPackageRel = String(data.domainPackageRel ?? "");
      const entityName = String(data.entityName ?? "");
      const drivenPackageRel = String(data.drivenPackageRel ?? "");
      const rawName = String(data.rawName ?? "").trim();
      if (!domainPackageRel || !entityName || !drivenPackageRel || !rawName) {
        throw new Error("Missing answers for mapper generation.");
      }

      const rawNamePascal = toPascalCase(rawName);
      const rawNameKebab = toKebabCase(rawName);
      const entityClassName = `${entityName}Entity`;
      const mapperFileBase = `${rawNameKebab}-to-${toKebabCase(entityName)}`;
      const domainNpmName = readDomainPackageJsonName(repoRoot, domainPackageRel);
      const entitiesImport = `${domainNpmName}/entities`;

      const base = `../../${drivenPackageRel}`;
      const mapperModuleBase = `${mapperFileBase}.mapper`;

      return [
        {
          type: "add",
          path: `${base}/${mapperFileBase}.mapper.ts`,
          template: `import { ${entityClassName} } from "${entitiesImport}";

export function map${rawNamePascal}To${entityClassName}(raw: unknown): ${entityClassName} {
  // TODO: narrow/assert \`raw\` (e.g. import row type from your SDK) and map to ${entityClassName}
  throw new Error("Not implemented!");
}
`,
        },
        {
          type: "add",
          path: `${base}/${mapperFileBase}.mapper.test.ts`,
          template: `import { describe, it } from "vitest";
import { map${rawNamePascal}To${entityClassName} } from "./${mapperFileBase}.mapper";

/**
 * Deliberately failing scaffold: replace after implementing ./${mapperFileBase}.mapper.ts
 */
describe("map${rawNamePascal}To${entityClassName}", () => {
  it("fails until you implement the mapper and real tests", () => {
    throw new Error(
      "Generator scaffold: implement map${rawNamePascal}To${entityClassName} (narrow \`unknown\` → ${entityClassName}), then delete this test and add real cases.",
    );
  });
});
`,
        },
        {
          type: "modify",
          path: `${base}/index.ts`,
          transform: (file: string) => appendDrivenRootIndexExport(file, mapperModuleBase),
        },
        {
          type: "modify",
          path: `${base}/package.json`,
          transform: (file: string) => {
            const pkg = JSON.parse(file) as {
              dependencies?: Record<string, string>;
              devDependencies?: Record<string, string>;
              scripts?: Record<string, string>;
              exports?: Record<string, unknown>;
            };
            stripRepositoriesSubpathExport(pkg);
            pkg.dependencies = pkg.dependencies || {};
            if (!pkg.dependencies[domainNpmName]) {
              pkg.dependencies[domainNpmName] = "workspace:*";
            }
            pkg.devDependencies = pkg.devDependencies || {};
            if (!pkg.devDependencies.vitest) {
              pkg.devDependencies.vitest =
                resolveWorkspaceDependencyVersion(repoRoot, "vitest") || "^4.1.0";
            }
            pkg.scripts = pkg.scripts || {};
            if (!pkg.scripts.test || String(pkg.scripts.test).includes("No tests yet")) {
              pkg.scripts.test = "vitest run";
            }
            return `${JSON.stringify(pkg, null, 2)}\n`;
          },
        },
      ];
    },
  });
}
