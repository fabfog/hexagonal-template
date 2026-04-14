import type { ActionType, NodePlopAPI } from "node-plop";
import type { Answers } from "inquirer";
import { appendDomainValueObjectActionsForRepoPackage } from "../lib/append-domain-value-object.ts";
import { ensureZodDependencyInPackage } from "../lib/ensure-zod-in-package.ts";
import { getRepoDomainPackageChoices } from "../lib/repo-domain-packages.ts";
import { getRepoRoot } from "../lib/repo-root.ts";

const repoRoot = getRepoRoot();

export default function registerFeatureDomainValueObjectGenerator(plop: NodePlopAPI) {
  plop.setGenerator("feature-domain-value-object", {
    description:
      "Add a value object (single-value or composite) under an existing @features/*-domain package (features/*/domain/)",
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
        name: "valueObjectName",
        message:
          "Value object base name (e.g. UserId, EmailAddress). Class name matches this exactly; file will be `<kebab>.vo.ts`.",
        validate: (value: unknown) =>
          String(value ?? "").trim().length > 0 || "Name cannot be empty",
      },
      {
        type: "list",
        name: "valueObjectKind",
        message: "VO shape:",
        choices: [
          {
            name: "Single value VO — wraps one primitive value (`value`)",
            value: "single-value",
          },
          {
            name: "Composite VO — object props + `getProps()` + default deep equals",
            value: "composite",
          },
        ],
        default: "single-value",
      },
      {
        type: "list",
        name: "singleValuePrimitive",
        message: "Single value primitive type:",
        choices: ["string", "boolean", "number", "Date"],
        default: "string",
        when: (answers: Answers) => answers.valueObjectKind === "single-value",
      },
    ],
    actions: (data?: Answers) => {
      if (!data) return [];
      const { domainPackageRel, valueObjectName, valueObjectKind, singleValuePrimitive } = data;
      const rel = String(domainPackageRel ?? "");
      const actions: (ActionType | (() => string))[] = [];
      appendDomainValueObjectActionsForRepoPackage(actions, {
        repoRoot,
        domainPackageRel: rel,
        valueObjectName: String(valueObjectName ?? "").trim(),
        valueObjectKind: valueObjectKind === "composite" ? "composite" : "single-value",
        singleValuePrimitive: singleValuePrimitive as
          | "string"
          | "boolean"
          | "number"
          | "Date"
          | undefined,
      });
      actions.push(() => {
        ensureZodDependencyInPackage(repoRoot, rel);
        return "";
      });
      return actions;
    },
  });
}
