import fs from "node:fs";
import path from "node:path";
import type { ActionType, NodePlopAPI } from "node-plop";
import type { Answers } from "inquirer";
import { ensureRepoApplicationPackageSlice } from "../lib/ensure-repo-application-package-slice.ts";
import { getRepoApplicationPackageChoicesForFeatureUseCases } from "../lib/repo-application-packages.ts";
import { getRepoRoot } from "../lib/repo-root.ts";
import { toKebabCase, toPascalCase } from "../lib/casing.ts";

const repoRoot = getRepoRoot();

type UseCaseKind = "standard" | "interactive";

function parseUseCaseKind(raw: unknown): UseCaseKind {
  return String(raw ?? "standard").trim() === "interactive" ? "interactive" : "standard";
}

export default function registerFeatureApplicationUseCaseGenerator(plop: NodePlopAPI) {
  plop.setGenerator("feature-application-use-case", {
    description:
      "Add a standard or interactive use case under @features/*-application. Wire constructor deps from the feature composition package (see feature-composition-app) — not from application modules.",
    prompts: [
      {
        type: "list",
        name: "useCaseKind",
        message: "Which kind of use case?",
        choices: [
          {
            name: "Standard — XyzUseCase (constructor deps supplied by the composition root)",
            value: "standard",
          },
          {
            name: "Interactive — XxxInteractiveUseCase + InteractionPort (call-site args)",
            value: "interactive",
          },
        ],
      },
      {
        type: "list",
        name: "applicationPackageRel",
        message: "Select @features/*-application package:",
        choices: () => {
          const c = getRepoApplicationPackageChoicesForFeatureUseCases(repoRoot);
          if (!c.length) {
            throw new Error(
              'No feature @features/*-application packages found (@features/shared-application is excluded). Add features/<your-feature>/application/package.json with "name": "@features/<slug>-application".'
            );
          }
          return c;
        },
      },
      {
        type: "input",
        name: "useCaseName",
        message: (answers: Answers) =>
          answers.useCaseKind === "interactive"
            ? "Interactive use case base name (e.g. UpdateUserPanel). Do not include InteractiveUseCase in the name, it will be added automatically:"
            : "Use case base name (e.g. CreatePage, UpdateUserProfile). Do not include UseCase in the name, it will be added automatically:",
        validate: (value: unknown) =>
          String(value || "").trim().length > 0 || "Name cannot be empty",
        filter: (value: unknown) => String(value || "").trim(),
      },
    ],
    actions: (data?: Answers) => {
      if (!data) return [];
      const kind = parseUseCaseKind(data.useCaseKind);
      const isInteractive = kind === "interactive";
      const applicationRel = String(data.applicationPackageRel ?? "");
      const useCaseName = String(data.useCaseName ?? "").trim();
      const kebab = toKebabCase(useCaseName);
      const useCasePascalBase = toPascalCase(useCaseName);
      const interactionInterfaceName = `${useCasePascalBase}InteractionPort`;

      const fileSuffix = isInteractive ? "interactive.use-case" : "use-case";
      const ucRelPath = `use-cases/${kebab}.${fileSuffix}.ts`;
      const ucAbsPath = path.join(repoRoot, ...applicationRel.split("/"), ucRelPath);
      const testAbsPath = path.join(
        repoRoot,
        ...applicationRel.split("/"),
        "use-cases",
        `${kebab}.${fileSuffix}.test.ts`
      );

      const actions: (ActionType | (() => string))[] = [];

      actions.push(() => {
        const label = isInteractive ? "Interactive use case" : "Use case";
        if (fs.existsSync(ucAbsPath)) {
          throw new Error(
            `${label} file already exists: ${path.relative(repoRoot, ucAbsPath)}. Remove it or pick another name.`
          );
        }
        if (fs.existsSync(testAbsPath)) {
          throw new Error(
            `${label} test already exists: ${path.relative(repoRoot, testAbsPath)}. Remove it or pick another name.`
          );
        }
        return "";
      });

      actions.push(() => {
        if (isInteractive) {
          ensureRepoApplicationPackageSlice(repoRoot, applicationRel, "ports");
        }
        ensureRepoApplicationPackageSlice(repoRoot, applicationRel, "use-cases");
        return "";
      });

      if (isInteractive) {
        actions.push({
          type: "add",
          path: `../../${applicationRel}/ports/${kebab}.interaction.port.ts`,
          templateFile: "templates/feature-application-port/port.ts.hbs",
          skipIfExists: true,
          data: {
            interfaceName: interactionInterfaceName,
            isRepositoryPort: false,
          },
        });

        actions.push({
          type: "modify",
          path: `../../${applicationRel}/ports/index.ts`,
          transform: (file: string) => {
            const cleaned = file.replace(/^export\s*{\s*}\s*;?\s*$/m, "").trimEnd();
            const exportLine = `export * from './${kebab}.interaction.port';`;
            if (cleaned.includes(exportLine)) {
              return `${cleaned}\n`;
            }
            const base = cleaned.length > 0 ? `${cleaned}\n` : "";
            return `${base}${exportLine}\n`;
          },
        });
      }

      actions.push({
        type: "add",
        path: `../../${applicationRel}/${ucRelPath}`,
        templateFile: isInteractive
          ? "templates/feature-application-interactive-use-case/interactive-use-case.ts.hbs"
          : "templates/feature-application-use-case/use-case.ts.hbs",
      });

      actions.push({
        type: "add",
        path: `../../${applicationRel}/use-cases/${kebab}.${fileSuffix}.test.ts`,
        templateFile: isInteractive
          ? "templates/feature-application-interactive-use-case/interactive-use-case.test.ts.hbs"
          : "templates/feature-application-use-case/use-case.test.ts.hbs",
      });

      actions.push({
        type: "modify",
        path: `../../${applicationRel}/use-cases/index.ts`,
        transform: (file: string) => {
          const cleaned = file.replace(/^export\s*{\s*}\s*;?\s*$/m, "").trimEnd();
          const exportLine = `export * from './${kebab}.${fileSuffix}';`;
          if (cleaned.includes(exportLine)) {
            return `${cleaned}\n`;
          }
          const base = cleaned.length > 0 ? `${cleaned}\n` : "";
          return `${base}${exportLine}\n`;
        },
      });

      return actions;
    },
  });
}
