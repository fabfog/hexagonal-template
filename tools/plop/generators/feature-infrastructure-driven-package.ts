import fs from "node:fs";
import path from "node:path";
import type { ActionType, NodePlopAPI } from "node-plop";
import type { Answers } from "inquirer";
import { featureSegmentFromApplicationPackageRel } from "../lib/repo-application-from-domain.ts";
import { getRepoApplicationPackageChoicesForFeatureUseCases } from "../lib/repo-application-packages.ts";
import { getRepoRoot } from "../lib/repo-root.ts";
import { toKebabCase } from "../lib/casing.ts";

const repoRoot = getRepoRoot();

const DRIVEN_SUFFIX_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const REPOSITORY_IN_NAME_MESSAGE =
  'Avoid the word "repository" in the driven-* suffix — keep the folder name capability- or technology-oriented (e.g. line-item, postgres); persistence and mappers live in the same package as flat *.ts files at package root.';

export default function registerFeatureInfrastructureDrivenPackageGenerator(plop: NodePlopAPI) {
  plop.setGenerator("feature-infrastructure-driven-package", {
    description:
      "Create @features/…-infra-driven-… under features/<feature>/infrastructure/driven-<name>/ (technology-specific adapters; feature-scoped only — use feature-infrastructure-lib-package under features/shared for generic libs).",
    prompts: [
      {
        type: "list",
        name: "applicationPackageRel",
        message: "Select @features/*-application (determines features/<slug>/):",
        choices: () => {
          const c = getRepoApplicationPackageChoicesForFeatureUseCases(repoRoot);
          if (!c.length) {
            throw new Error(
              'No feature @features/*-application packages found. Run feature-core with the "application" package for your feature first.'
            );
          }
          return c;
        },
      },
      {
        type: "input",
        name: "drivenSuffix",
        message:
          "Driven capability suffix (kebab-case, without the driven- prefix), e.g. clock → folder driven-clock and name …-infra-driven-clock:",
        validate: (value: unknown) => {
          const raw = String(value ?? "").trim();
          if (!raw) return "Name cannot be empty";
          if (/repository/i.test(raw)) {
            return REPOSITORY_IN_NAME_MESSAGE;
          }
          const drivenKebab = toKebabCase(raw).replace(/^driven-/u, "");
          if (!drivenKebab) return "Could not derive a kebab-case suffix";
          if (/repository/i.test(drivenKebab)) {
            return REPOSITORY_IN_NAME_MESSAGE;
          }
          if (!DRIVEN_SUFFIX_KEY.test(drivenKebab)) {
            return "Use lowercase letters, numbers, and single hyphens (e.g. clock, stripe-webhooks)";
          }
          return true;
        },
        filter: (value: unknown) => {
          const raw = String(value ?? "").trim();
          return toKebabCase(raw).replace(/^driven-/u, "");
        },
      },
    ],
    actions: (data?: Answers): ActionType[] => {
      if (!data) return [];
      const drivenKebab = String(data.drivenSuffix ?? "").trim();
      if (!drivenKebab || !DRIVEN_SUFFIX_KEY.test(drivenKebab)) {
        throw new Error("Invalid driven suffix after filter.");
      }

      const appRel = String(data.applicationPackageRel ?? "").trim();
      if (!appRel) {
        throw new Error("Select an application package for feature-scoped infrastructure.");
      }

      const featureKebab = featureSegmentFromApplicationPackageRel(appRel);

      const packageRel = `features/${featureKebab}/infrastructure/driven-${drivenKebab}`;
      const packageRootAbs = path.join(repoRoot, ...packageRel.split("/"));
      if (fs.existsSync(path.join(packageRootAbs, "package.json"))) {
        throw new Error(`Driven infrastructure package already exists: ${packageRel}`);
      }

      const templateData = {
        featureKebab,
        drivenKebab,
      };

      return [
        {
          type: "add",
          path: `../../${packageRel}/package.json`,
          templateFile: "templates/feature-infrastructure-driven-package/package.json.hbs",
          data: templateData,
        },
        {
          type: "add",
          path: `../../${packageRel}/tsconfig.json`,
          templateFile: "templates/feature-infrastructure-driven-package/tsconfig.json.hbs",
          data: templateData,
        },
        {
          type: "add",
          path: `../../${packageRel}/index.ts`,
          templateFile: "templates/feature-infrastructure-driven-package/index.ts.hbs",
          data: templateData,
        },
      ];
    },
  });
}
