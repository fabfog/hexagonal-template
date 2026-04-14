import fs from "node:fs";
import path from "node:path";
import type { ActionType, NodePlopAPI } from "node-plop";
import type { Answers } from "inquirer";
import { ensureRepoApplicationPackageSlice } from "../lib/ensure-repo-application-package-slice.ts";
import {
  getRepositoryPortEntitySelectChoices,
  type RepositoryPortEntityChoiceValue,
} from "../lib/domain-entity-vo-fields.ts";
import { getRepoApplicationPackageChoices } from "../lib/repo-application-packages.ts";
import { readDomainPackageJsonName } from "../lib/repo-domain-packages.ts";
import { getRepoRoot } from "../lib/repo-root.ts";
import { toKebabCase } from "../lib/casing.ts";

const repoRoot = getRepoRoot();

export default function registerFeatureApplicationPortGenerator(plop: NodePlopAPI) {
  plop.setGenerator("feature-application-port", {
    description:
      "Add a Port, InteractionPort, or repository port under an existing @features/*-application package. Repository ports: getById entity from this feature's domain and/or @features/shared-domain.",
    prompts: [
      {
        type: "list",
        name: "applicationPackageRel",
        message: "Select @features/*-application package:",
        choices: () => {
          const c = getRepoApplicationPackageChoices(repoRoot);
          if (!c.length) {
            throw new Error(
              'No @features/*-application packages found. Add features/<feature>/application/package.json with "name": "@features/<slug>-application".'
            );
          }
          return c;
        },
      },
      {
        type: "list",
        name: "portKind",
        message: "What kind of port is this?",
        choices: [
          { name: "InteractionPort (UI / interaction contract)", value: "interaction" },
          { name: "Repository port (persistence; includes minimal getById)", value: "repository" },
          { name: "Other (normal Port, empty contract TODO)", value: "other" },
        ],
      },
      {
        type: "list",
        name: "repositoryPortEntity",
        message: "Entity for getById return type (this feature's domain + shared-domain):",
        choices: (answers: Answers) =>
          getRepositoryPortEntitySelectChoices(
            repoRoot,
            String(answers.applicationPackageRel ?? "")
          ),
        when: (answers: Answers) => answers.portKind === "repository",
      },
      {
        type: "input",
        name: "repositoryBaseName",
        message: (answers: Answers) => {
          const ent = answers.repositoryPortEntity as RepositoryPortEntityChoiceValue | undefined;
          const e = ent?.entityPascal || "Entity";
          const fileSlug = toKebabCase(e);
          return (
            `Repository base name (before the Port suffix, e.g. ${e}Repository → ${e}RepositoryPort). ` +
            `Leave empty to use default: ${e}Repository. ` +
            `File: ${fileSlug}.repository.port.ts`
          );
        },
        when: (answers: Answers) => answers.portKind === "repository",
      },
      {
        type: "input",
        name: "portName",
        message:
          "Port base name (e.g. PageRepository, UserNotification). Do not include Port/InteractionPort in the name, it will be added automatically:",
        when: (answers: Answers) => answers.portKind !== "repository",
        validate: (value: unknown) =>
          String(value || "").trim().length > 0 || "Name cannot be empty",
      },
      {
        type: "confirm",
        name: "overwrite",
        default: false,
        message:
          "Overwrite the port file if it already exists? (No = abort; Yes = replace and re-append barrel export if missing)",
      },
    ],
    actions: (data?: Answers) => {
      if (!data) return [];
      const applicationRel = String(data.applicationPackageRel ?? "");
      const { portKind, overwrite } = data;
      const repoEntity = data.repositoryPortEntity as RepositoryPortEntityChoiceValue | undefined;
      const entityPascalForDefault =
        portKind === "repository" ? String(repoEntity?.entityPascal ?? "").trim() : "";
      const rawRepositoryBase =
        portKind === "repository"
          ? String(data.repositoryBaseName || "").trim() || `${entityPascalForDefault}Repository`
          : "";
      const rawPortName =
        portKind === "repository" ? rawRepositoryBase : String(data.portName || "").trim();
      const baseName = rawPortName
        .replace(/Port$/i, "")
        .replace(/InteractionPort$/i, "")
        .replace(/Interaction$/i, "");
      const isInteractionPort = portKind === "interaction";
      const isRepositoryPort = portKind === "repository";
      const interfaceName = isInteractionPort ? `${baseName}InteractionPort` : `${baseName}Port`;
      const fileBase = isRepositoryPort
        ? toKebabCase(entityPascalForDefault)
        : toKebabCase(baseName);
      const fileSuffix = isInteractionPort
        ? ".interaction.port"
        : isRepositoryPort
          ? ".repository.port"
          : ".port";
      const relFile = `ports/${fileBase}${fileSuffix}.ts`;
      const portAbsPath = path.join(repoRoot, ...applicationRel.split("/"), relFile);
      const entityPascal = isRepositoryPort ? entityPascalForDefault : "";
      const getByIdReturnType = isRepositoryPort && entityPascal ? `${entityPascal}Entity` : "";
      const domainPackageForEntity = isRepositoryPort
        ? String(repoEntity?.entityDomainPackageRel ?? "").trim()
        : "";
      const domainNpmName = isRepositoryPort
        ? readDomainPackageJsonName(repoRoot, domainPackageForEntity)
        : "";
      const allowOverwrite = overwrite === true;

      const actions: (ActionType | (() => string))[] = [];

      actions.push(() => {
        if (fs.existsSync(portAbsPath) && !allowOverwrite) {
          throw new Error(
            `Port file already exists: ${path.relative(repoRoot, portAbsPath)}. ` +
              "Re-run with overwrite enabled, or delete the file first."
          );
        }
        if (fs.existsSync(portAbsPath) && allowOverwrite) {
          fs.unlinkSync(portAbsPath);
        }
        return "";
      });

      actions.push(() => {
        ensureRepoApplicationPackageSlice(repoRoot, applicationRel, "ports");
        return "";
      });

      actions.push({
        type: "add",
        path: `../../${applicationRel}/${relFile}`,
        templateFile: "templates/feature-application-port/port.ts.hbs",
        data: {
          interfaceName,
          isRepositoryPort,
          getByIdReturnType,
          domainNpmName,
          entityPascal,
        },
      });

      actions.push({
        type: "modify",
        path: `../../${applicationRel}/ports/index.ts`,
        transform: (file: string) => {
          const cleaned = file.replace(/^export\s*{\s*}\s*;?\s*$/m, "").trimEnd();
          const exportLine = `export * from './${fileBase}${fileSuffix}';`;
          if (cleaned.includes(exportLine)) {
            return `${cleaned}\n`;
          }
          const base = cleaned.length > 0 ? `${cleaned}\n` : "";
          return `${base}${exportLine}\n`;
        },
      });

      if (isRepositoryPort) {
        actions.push({
          type: "modify",
          path: `../../${applicationRel}/package.json`,
          transform: (file: string) => {
            const pkg = JSON.parse(file) as Record<string, unknown>;
            pkg.dependencies = (pkg.dependencies as Record<string, string> | undefined) || {};
            const deps = pkg.dependencies as Record<string, string>;
            if (!deps[domainNpmName]) {
              deps[domainNpmName] = "workspace:*";
            }
            return `${JSON.stringify(pkg, null, 2)}\n`;
          },
        });
      }

      return actions;
    },
  });
}
