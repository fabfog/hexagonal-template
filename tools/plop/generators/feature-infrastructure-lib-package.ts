import fs from "node:fs";
import path from "node:path";
import type { ActionType, NodePlopAPI } from "node-plop";
import type { Answers } from "inquirer";
import { featureSegmentFromApplicationPackageRel } from "../lib/repo-application-from-domain.ts";
import { getRepoApplicationPackageChoicesForFeatureUseCases } from "../lib/repo-application-packages.ts";
import { getRepoRoot } from "../lib/repo-root.ts";
import { toKebabCase } from "../lib/casing.ts";

const repoRoot = getRepoRoot();

const LIB_SUFFIX_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export default function registerFeatureInfrastructureLibPackageGenerator(plop: NodePlopAPI) {
  plop.setGenerator("feature-infrastructure-lib-package", {
    description:
      "Create @features/…-infra-lib-… under features/<slug|shared>/infrastructure/lib-<name>/ (generic utilities only; driven-* stays feature-scoped).",
    prompts: [
      {
        type: "list",
        name: "infrastructureLibScope",
        message: "Where should this infrastructure lib package live?",
        choices: [
          {
            name: "Feature-scoped — features/<feature>/infrastructure/lib-… (pick an application package to fix the feature slug)",
            value: "feature",
          },
          {
            name: "Shared — features/shared/infrastructure/lib-… (@features/shared-infra-lib-…; generic helpers only)",
            value: "shared",
          },
        ],
      },
      {
        type: "list",
        name: "applicationPackageRel",
        message: "Select @features/*-application (determines features/<slug>/):",
        when: (answers: Answers) => answers.infrastructureLibScope === "feature",
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
        name: "libSuffix",
        message:
          "Lib capability suffix (kebab-case, without the lib- prefix), e.g. http-client → folder lib-http-client and name …-infra-lib-http-client:",
        validate: (value: unknown) => {
          const raw = String(value ?? "").trim();
          if (!raw) return "Name cannot be empty";
          const libKebab = toKebabCase(raw).replace(/^lib-/u, "");
          if (!libKebab) return "Could not derive a kebab-case suffix";
          if (!LIB_SUFFIX_KEY.test(libKebab)) {
            return "Use lowercase letters, numbers, and single hyphens (e.g. http-client, dataloader)";
          }
          return true;
        },
        filter: (value: unknown) => {
          const raw = String(value ?? "").trim();
          return toKebabCase(raw).replace(/^lib-/u, "");
        },
      },
    ],
    actions: (data?: Answers): ActionType[] => {
      if (!data) return [];
      const scope = String(data.infrastructureLibScope ?? "");
      const libKebab = String(data.libSuffix ?? "").trim();
      if (!libKebab || !LIB_SUFFIX_KEY.test(libKebab)) {
        throw new Error("Invalid lib suffix after filter.");
      }

      const appRel = String(data.applicationPackageRel ?? "").trim();
      if (scope === "feature" && !appRel) {
        throw new Error("Select an application package for feature-scoped infrastructure.");
      }

      const featureKebab =
        scope === "shared" ? "shared" : featureSegmentFromApplicationPackageRel(appRel);

      const packageRel = `features/${featureKebab}/infrastructure/lib-${libKebab}`;
      const packageRootAbs = path.join(repoRoot, ...packageRel.split("/"));
      if (fs.existsSync(path.join(packageRootAbs, "package.json"))) {
        throw new Error(`Infrastructure lib package already exists: ${packageRel}`);
      }

      const templateData = {
        featureKebab,
        libKebab,
      };

      return [
        {
          type: "add",
          path: `../../${packageRel}/package.json`,
          templateFile: "templates/feature-infrastructure-lib-package/package.json.hbs",
          data: templateData,
        },
        {
          type: "add",
          path: `../../${packageRel}/tsconfig.json`,
          templateFile: "templates/feature-infrastructure-lib-package/tsconfig.json.hbs",
          data: templateData,
        },
        {
          type: "add",
          path: `../../${packageRel}/index.ts`,
          templateFile: "templates/feature-infrastructure-lib-package/index.ts.hbs",
          data: templateData,
        },
      ];
    },
  });
}
