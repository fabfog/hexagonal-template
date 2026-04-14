import type { ActionType, NodePlopAPI } from "node-plop";
import type { Answers } from "inquirer";
import {
  buildDomainServiceEntityImportLines,
  getDomainServiceEntityCheckboxChoices,
} from "../lib/domain-service-entity-choices.ts";
import { ensureRepoDomainPackageSlice } from "../lib/ensure-domain-package-slice.ts";
import {
  getSharedDomainPackageRel,
  getRepoDomainPackageChoices,
  readDomainPackageJsonName,
} from "../lib/repo-domain-packages.ts";
import { getRepoRoot } from "../lib/repo-root.ts";
import { toKebabCase } from "../lib/casing.ts";

const repoRoot = getRepoRoot();

export default function registerFeatureDomainServiceGenerator(plop: NodePlopAPI) {
  plop.setGenerator("feature-domain-service", {
    description:
      "Add a domain service under @features/*-domain, importing entities from this package and/or @features/shared-domain only",
    prompts: [
      {
        type: "list",
        name: "domainPackageRel",
        message: "Select @features/*-domain package (service is created here):",
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
        type: "checkbox",
        name: "selectedEntities",
        message:
          "Select entities this service uses (space to toggle). Only this domain + @features/shared-domain:",
        choices: (answers: Answers) =>
          getDomainServiceEntityCheckboxChoices(repoRoot, String(answers.domainPackageRel ?? "")),
        validate: (selected: unknown) =>
          Array.isArray(selected) && selected.length > 0 ? true : "Select at least one entity",
      },
      {
        type: "input",
        name: "serviceName",
        message:
          "Service base name (WITHOUT the 'Service' suffix). Prefer a specific capability, e.g. UserDiscountEligibility, OrderShippingWindow — avoid vague names like User or UserService:",
        validate: (value: unknown) => {
          const trimmed = String(value ?? "").trim();
          if (!trimmed) return "Name cannot be empty";
          return true;
        },
        filter: (value: unknown) =>
          String(value ?? "")
            .trim()
            .replace(/Service$/i, ""),
      },
    ],
    actions: (data?: Answers) => {
      if (!data) return [];
      const { domainPackageRel, serviceName, selectedEntities } = data;
      const rel = String(domainPackageRel ?? "");
      const tokens = (Array.isArray(selectedEntities) ? selectedEntities : []) as string[];
      const currentPackageName = readDomainPackageJsonName(repoRoot, rel);
      const sharedRel = getSharedDomainPackageRel(repoRoot);
      let sharedPackageName: string | null = null;
      if (sharedRel) {
        try {
          sharedPackageName = readDomainPackageJsonName(repoRoot, sharedRel);
        } catch {
          sharedPackageName = null;
        }
      }

      const entityImportLines = buildDomainServiceEntityImportLines(
        tokens,
        currentPackageName,
        sharedPackageName
      );
      const kebab = toKebabCase(serviceName);

      const actions: (ActionType | (() => string))[] = [];
      actions.push(() => {
        ensureRepoDomainPackageSlice(repoRoot, rel, "services");
        return "";
      });
      actions.push({
        type: "add",
        path: "../../{{domainPackageRel}}/services/{{kebabCase serviceName}}.service.ts",
        templateFile: "templates/domain-service/service.ts.hbs",
        data: {
          entityImportLines,
          serviceName,
        },
      });
      actions.push({
        type: "modify",
        path: "../../{{domainPackageRel}}/services/index.ts",
        transform: (file: string) => {
          const cleaned = file.replace(/^export\s*{\s*}\s*;?\s*$/m, "").trimEnd();
          const exportLine = `export * from './${kebab}.service';`;
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
