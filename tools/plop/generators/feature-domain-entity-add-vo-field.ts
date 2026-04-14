import fs from "node:fs";
import path from "node:path";
import type { ActionType, NodePlopAPI } from "node-plop";
import type { Answers } from "inquirer";
import {
  appendVoFieldToEntitySource,
  getDomainEntitySelectChoices,
  getVoFieldChoicesForFeatureDomain,
} from "../lib/domain-entity-vo-fields.ts";
import { ensureZodDependencyInPackage } from "../lib/ensure-zod-in-package.ts";
import { getRepoDomainPackageChoices } from "../lib/repo-domain-packages.ts";
import { getRepoRoot } from "../lib/repo-root.ts";
import { toKebabCase, toPascalCase } from "../lib/casing.ts";

const repoRoot = getRepoRoot();

export default function registerFeatureDomainEntityAddVoFieldGenerator(plop: NodePlopAPI) {
  plop.setGenerator("feature-domain-entity-add-vo-field", {
    description:
      "Add one entity property wired to the VO's Zod schema only (existing VO → pass .value / plain input; VOs from this package and/or @features/shared-domain only)",
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
        name: "entityName",
        message: "Select entity:",
        choices: (answers: Answers) =>
          getDomainEntitySelectChoices(repoRoot, String(answers.domainPackageRel ?? "")),
      },
      {
        type: "input",
        name: "propName",
        message: "Property name (camelCase, e.g. email, homePage):",
        validate: (value: unknown) =>
          /^[a-z][a-zA-Z0-9]*$/.test(String(value ?? "").trim()) ||
          "Use camelCase starting with a lowercase letter.",
        filter: (v: unknown) => String(v ?? "").trim(),
      },
      {
        type: "list",
        name: "voSelection",
        message: "Select value object type:",
        choices: (answers: Answers) => {
          const list = getVoFieldChoicesForFeatureDomain(
            repoRoot,
            String(answers.domainPackageRel ?? "")
          );
          if (list.length === 0) {
            throw new Error(
              "No value objects found in this domain package or @features/shared-domain. Create VOs first."
            );
          }
          return list;
        },
      },
    ],
    actions: (data?: Answers) => {
      if (!data) return [];
      const { domainPackageRel, entityName, propName, voSelection } = data;
      const rel = String(domainPackageRel ?? "");
      const vo = voSelection as { voClass: string; source: "shared" | "local" };
      const entityPascal = toPascalCase(String(entityName ?? "").trim());
      const kebab = toKebabCase(entityName);
      const entityPath = path.join(repoRoot, ...rel.split("/"), "entities", `${kebab}.entity.ts`);
      if (!fs.existsSync(entityPath)) {
        throw new Error(`Entity file not found: ${entityPath}`);
      }
      const field = {
        prop: String(propName ?? "").trim(),
        voClass: vo.voClass,
        source: vo.source,
      };
      const actions: (ActionType | (() => string))[] = [];
      actions.push({
        type: "modify",
        path: "../../{{domainPackageRel}}/entities/{{kebabCase entityName}}.entity.ts",
        transform: (file: string) => {
          try {
            return appendVoFieldToEntitySource(file, entityPascal, field);
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            throw new Error(`Could not patch entity: ${err.message}`);
          }
        },
      });
      actions.push(() => {
        ensureZodDependencyInPackage(repoRoot, rel);
        return "";
      });
      return actions;
    },
  });
}
