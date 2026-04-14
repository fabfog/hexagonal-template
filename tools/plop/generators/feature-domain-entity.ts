import type { ActionType, NodePlopAPI } from "node-plop";
import type { Answers } from "inquirer";
import { appendDomainValueObjectActionsForRepoPackage } from "../lib/append-domain-value-object.ts";
import { appendEnsureEntityNotFoundErrorActionsForRepoPackage } from "../lib/entity-not-found-error.ts";
import { ensureRepoDomainPackageSlice } from "../lib/ensure-domain-package-slice.ts";
import { ensureZodDependencyInPackage } from "../lib/ensure-zod-in-package.ts";
import { getRepoDomainPackageChoices } from "../lib/repo-domain-packages.ts";
import { getRepoRoot } from "../lib/repo-root.ts";
import { toKebabCase, toPascalCase } from "../lib/casing.ts";

const repoRoot = getRepoRoot();

export default function registerFeatureDomainEntityGenerator(plop: NodePlopAPI) {
  plop.setGenerator("feature-domain-entity", {
    description:
      "Add a domain entity (+ Id value object) under an existing @features/*-domain package (features/*/domain/)",
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
        type: "input",
        name: "entityName",
        message:
          "Entity base name (e.g. Document, UserProfile). Do not include Entity in the name, it will be added automatically:",
        validate: (value: unknown) =>
          String(value ?? "").trim().length > 0 || "Name cannot be empty",
      },
      {
        type: "confirm",
        name: "addNotFoundError",
        default: true,
        message: (answers: Answers) => {
          const name = toPascalCase(String(answers.entityName ?? "").trim());
          return `Also create ${name}NotFoundError associated with ${name}?`;
        },
      },
    ],
    actions: (data?: Answers) => {
      if (!data) return [];
      const { domainPackageRel, entityName, addNotFoundError } = data;
      const rel = String(domainPackageRel ?? "");
      const entityPascal = toPascalCase(String(entityName ?? "").trim());
      const kebab = toKebabCase(entityName);
      const actions: (ActionType | (() => string))[] = [];

      appendDomainValueObjectActionsForRepoPackage(actions, {
        repoRoot,
        domainPackageRel: rel,
        valueObjectName: `${entityPascal}Id`,
        valueObjectKind: "single-value",
        singleValuePrimitive: "string",
      });

      actions.push(() => {
        ensureRepoDomainPackageSlice(repoRoot, rel, "entities");
        return "";
      });

      actions.push(
        {
          type: "add",
          path: "../../{{domainPackageRel}}/entities/{{kebabCase entityName}}.entity.ts",
          templateFile: "templates/domain-entity/entity.ts.hbs",
        },
        {
          type: "add",
          path: "../../{{domainPackageRel}}/entities/{{kebabCase entityName}}.entity.test.ts",
          templateFile: "templates/domain-entity/entity.test.ts.hbs",
        },
        {
          type: "modify",
          path: "../../{{domainPackageRel}}/entities/index.ts",
          transform: (file: string) => {
            const cleaned = file.replace(/^export\s*{\s*}\s*;?\s*$/m, "").trimEnd();
            const exportEntity = `export * from './${kebab}.entity';`;
            let next = cleaned;
            if (!next.includes(exportEntity)) {
              next = next.length > 0 ? `${next}\n${exportEntity}` : exportEntity;
            }
            return `${next}\n`;
          },
        },
        () => {
          ensureZodDependencyInPackage(repoRoot, rel);
          return "";
        }
      );

      if (addNotFoundError) {
        appendEnsureEntityNotFoundErrorActionsForRepoPackage(actions, {
          repoRoot,
          domainPackageRel: rel,
          entityPascal,
        });
      }

      return actions;
    },
  });
}
