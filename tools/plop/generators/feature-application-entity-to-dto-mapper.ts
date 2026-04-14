import fs from "node:fs";
import path from "node:path";
import type { ActionType, NodePlopAPI } from "node-plop";
import type { Answers } from "inquirer";
import { appendApplicationEntityMapperWorkflow } from "../lib/application-entity-mapper-workflow.ts";
import { getDomainEntitySelectChoices } from "../lib/domain-entity-vo-fields.ts";
import { applicationPackageRelFromDomainRel } from "../lib/repo-application-from-domain.ts";
import { getRepoDomainPackageChoices } from "../lib/repo-domain-packages.ts";
import { getRepoRoot } from "../lib/repo-root.ts";

const repoRoot = getRepoRoot();

export default function registerFeatureApplicationEntityToDtoMapperGenerator(plop: NodePlopAPI) {
  plop.setGenerator("feature-application-entity-to-dto-mapper", {
    description:
      "DTO type alias (`Plain<Entity>`) + mapXToDTO + test from a domain entity (@features/*-application). Updates `mappers/index.ts` with a `{FeaturePascal}Mappers` barrel object. Use overwrite to re-sync; default refuses if files already exist.",
    prompts: [
      {
        type: "list",
        name: "domainPackageRel",
        message: "Select @features/*-domain package (entity source):",
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
        type: "confirm",
        name: "overwrite",
        default: true,
        message:
          "Overwrite existing DTO / mapper / test if present? (No = abort when any file already exists; Yes = full re-sync from entity)",
      },
    ],
    actions: (data?: Answers) => {
      if (!data) return [];
      const { domainPackageRel, entityName, overwrite } = data;
      const rel = String(domainPackageRel ?? "");
      const applicationRel = applicationPackageRelFromDomainRel(rel);
      const appPkgJson = path.join(repoRoot, ...applicationRel.split("/"), "package.json");
      if (!fs.existsSync(appPkgJson)) {
        throw new Error(
          `No application package at ${applicationRel}. Create it with feature-core (domain + application) for this feature first.`
        );
      }

      const actions: (ActionType | (() => string))[] = [];
      appendApplicationEntityMapperWorkflow(actions, {
        repoRoot,
        domainPackageRel: rel,
        entityName: String(entityName ?? ""),
        allowOverwrite: overwrite === true,
      });
      return actions;
    },
  });
}
