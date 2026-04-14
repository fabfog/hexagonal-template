import fs from "node:fs";
import path from "node:path";
import type { ActionType, NodePlopAPI } from "node-plop";
import type { Answers } from "inquirer";
import {
  appendDomainErrorsBarrelExport,
  getEntityNotFoundErrorSpec,
} from "../lib/entity-not-found-error.ts";
import { ensureRepoDomainPackageSlice } from "../lib/ensure-domain-package-slice.ts";
import { getRepoDomainPackageChoices } from "../lib/repo-domain-packages.ts";
import { getRepoRoot } from "../lib/repo-root.ts";
import { toKebabCase } from "../lib/casing.ts";

const repoRoot = getRepoRoot();

export default function registerFeatureDomainErrorGenerator(plop: NodePlopAPI) {
  plop.setGenerator("feature-domain-error", {
    description:
      "Add a DomainError subclass under an existing @features/*-domain package (features/*/domain/)",
    prompts: [
      {
        type: "list",
        name: "domainPackageRel",
        message: "Select @features/*-domain package:",
        choices: () => {
          const c = getRepoDomainPackageChoices(repoRoot);
          if (!c.length) {
            throw new Error(
              'No @features/*-domain packages found. Add features/<feature>/domain/package.json with "name": "@features/<slug>-domain".'
            );
          }
          return c;
        },
      },
      {
        type: "list",
        name: "errorKind",
        message: "Error kind:",
        choices: [
          {
            name: "Custom — custom name & message (template)",
            value: "custom",
          },
          {
            name: "Not found — entity id in message & metadata (e.g. UserNotFoundError)",
            value: "not-found",
          },
        ],
      },
      {
        type: "input",
        name: "entityPascal",
        message: "Entity name (PascalCase, e.g. User):",
        when: (answers: Answers) => answers.errorKind === "not-found",
        validate: (value: unknown) => {
          const v = String(value ?? "").trim();
          if (!v) return "Name cannot be empty";
          if (!/^[A-Z][a-zA-Z0-9]*$/.test(v)) {
            return "Use PascalCase (e.g. User, OrderLine)";
          }
          return true;
        },
        filter: (value: unknown) => String(value ?? "").trim(),
      },
      {
        type: "input",
        name: "errorName",
        message: "Error name (e.g. InvalidState, UserNotAuthorized):",
        when: (answers: Answers) => answers.errorKind === "custom",
        validate: (value: unknown) =>
          String(value ?? "").trim().length > 0 || "Name cannot be empty",
      },
    ],
    actions: (data?: Answers) => {
      if (!data) return [];
      const { domainPackageRel, errorKind } = data;
      const rel = String(domainPackageRel ?? "");
      const actions: (ActionType | (() => string))[] = [];

      actions.push(() => {
        ensureRepoDomainPackageSlice(repoRoot, rel, "errors");
        return "";
      });

      let exportFileKebab: string;

      if (errorKind === "not-found") {
        const entityPascal = String(data.entityPascal ?? "").trim();
        const spec = getEntityNotFoundErrorSpec(entityPascal);
        exportFileKebab = spec.fileKebab;
        const errorAbsPath = path.join(
          repoRoot,
          ...rel.split("/"),
          "errors",
          `${spec.fileKebab}.error.ts`
        );
        if (fs.existsSync(errorAbsPath)) {
          throw new Error(
            `Error file already exists: ${errorAbsPath}. Remove it or pick another entity.`
          );
        }
        actions.push({
          type: "add",
          path: "../../{{domainPackageRel}}/errors/{{notFoundFileKebab}}.error.ts",
          templateFile: "templates/domain-entity/entity-not-found.error.ts.hbs",
          data: {
            notFoundFileKebab: spec.fileKebab,
            notFoundClassName: spec.className,
            notFoundCode: spec.code,
            entityPascal,
          },
        });
      } else {
        exportFileKebab = toKebabCase(data.errorName);
        actions.push({
          type: "add",
          path: "../../{{domainPackageRel}}/errors/{{kebabCase errorName}}.error.ts",
          templateFile: "templates/domain-error/error.ts.hbs",
        });
      }

      actions.push({
        type: "modify",
        path: "../../{{domainPackageRel}}/errors/index.ts",
        transform: (file: string) => appendDomainErrorsBarrelExport(file, exportFileKebab),
      });

      return actions;
    },
  });
}
