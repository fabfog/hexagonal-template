import fs from "node:fs";
import path from "node:path";
import type { NodePlopAPI } from "node-plop";
import { getRepoRoot } from "../lib/repo-root.ts";
import { toKebabCase } from "../lib/casing.ts";

/** Paths in actions are relative to the plopfile directory (`tools/plop/`). */
const FEATURE_CORE_TEMPLATE_PREFIX = "templates/feature-core";

function domainPackageJsonPath(featureKebab: string): string {
  return path.join(getRepoRoot(), "features", featureKebab, "domain", "package.json");
}

function applicationPackageJsonPath(featureKebab: string): string {
  return path.join(getRepoRoot(), "features", featureKebab, "application", "package.json");
}

export default function registerFeatureCoreGenerator(plop: NodePlopAPI) {
  plop.setGenerator("feature-core", {
    description:
      "Create features/<name>/ and idempotently add @features/<name>-domain and/or @features/<name>-application workspace packages",
    prompts: [
      {
        type: "input",
        name: "featureName",
        message: "Feature name (used as features/<kebab>/ and @features/<kebab>-…):",
        validate: (value: unknown) => {
          const raw = String(value ?? "").trim();
          if (!raw) return "Feature name cannot be empty";
          const kebab = toKebabCase(raw);
          if (!kebab) return "Could not derive a kebab-case slug from that name";
          if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(kebab)) {
            return "Use letters, numbers, and single hyphens (e.g. billing, user-profile)";
          }
          return true;
        },
      },
      {
        type: "checkbox",
        name: "packages",
        when: (answers: { featureName?: string }) => {
          const k = toKebabCase(answers.featureName ?? "");
          if (!k) return false;
          return (
            !fs.existsSync(domainPackageJsonPath(k)) ||
            !fs.existsSync(applicationPackageJsonPath(k))
          );
        },
        message: (answers: { featureName?: string }) => {
          const k = toKebabCase(answers.featureName ?? "");
          return `Add missing packages under features/${k}/ (only options not already on disk are shown):`;
        },
        choices: (answers: { featureName?: string }) => {
          const k = toKebabCase(answers.featureName ?? "");
          const choices: { name: string; value: string; checked: boolean }[] = [];
          if (!fs.existsSync(domainPackageJsonPath(k))) {
            choices.push({
              name: `Domain package (@features/${k}-domain) — entities, value objects, domain errors, services, utils…`,
              value: "domain",
              checked: true,
            });
          }
          if (!fs.existsSync(applicationPackageJsonPath(k))) {
            choices.push({
              name: `Application package (@features/${k}-application) — use cases (incl. interactive), DTOs, ports, mappers…`,
              value: "application",
              checked: true,
            });
          }
          return choices;
        },
      },
    ],
    actions: (data) => {
      const pkgs = (Array.isArray(data.packages) ? data.packages : []) as string[];
      const actions: (Record<string, unknown> | (() => string))[] = [];

      if (pkgs.includes("domain")) {
        actions.push(
          {
            type: "add",
            path: "../../features/{{kebabCase featureName}}/domain/package.json",
            templateFile: `${FEATURE_CORE_TEMPLATE_PREFIX}/domain-package.json.hbs`,
            skipIfExists: true,
          },
          {
            type: "add",
            path: "../../features/{{kebabCase featureName}}/domain/tsconfig.json",
            templateFile: `${FEATURE_CORE_TEMPLATE_PREFIX}/domain-tsconfig.json.hbs`,
            skipIfExists: true,
          }
        );
      }

      if (pkgs.includes("application")) {
        actions.push(
          {
            type: "add",
            path: "../../features/{{kebabCase featureName}}/application/package.json",
            templateFile: `${FEATURE_CORE_TEMPLATE_PREFIX}/application-package.json.hbs`,
            skipIfExists: true,
          },
          {
            type: "add",
            path: "../../features/{{kebabCase featureName}}/application/tsconfig.json",
            templateFile: `${FEATURE_CORE_TEMPLATE_PREFIX}/application-tsconfig.json.hbs`,
            skipIfExists: true,
          }
        );
      }

      if (pkgs.includes("domain") || pkgs.includes("application")) {
        actions.push(() => {
          const k = toKebabCase(String(data.featureName ?? ""));
          if (!k) return "";
          const rootKeep = path.join(getRepoRoot(), "features", k, ".gitkeep");
          if (fs.existsSync(rootKeep)) {
            fs.unlinkSync(rootKeep);
          }
          return "";
        });
      }

      return actions;
    },
  });
}
