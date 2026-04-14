import fs from "node:fs";
import path from "node:path";
import type { ActionType, NodePlopAPI } from "node-plop";
import type { Answers } from "inquirer";
import { generateApplicationEntityMapperSources } from "../lib/entity-to-dto-map-codegen.ts";
import { getDomainEntitySelectChoices } from "../lib/domain-entity-vo-fields.ts";
import { ensureRepoApplicationPackageSlice } from "../lib/ensure-repo-application-package-slice.ts";
import { applicationPackageRelFromDomainRel } from "../lib/repo-application-from-domain.ts";
import {
  getRepoDomainPackageChoices,
  readDomainPackageJsonName,
} from "../lib/repo-domain-packages.ts";
import { getRepoRoot } from "../lib/repo-root.ts";
import { resolveWorkspaceDependencyVersion } from "../lib/workspace-dependency-version.ts";
import { toKebabCase } from "../lib/casing.ts";

const repoRoot = getRepoRoot();

function isMapperCodegenUnresolvedDepsError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    (msg.includes("Could not infer properties") &&
      msg.includes("[SERIALIZE]()") &&
      msg.includes("any")) ||
    (msg.includes("pnpm install") && msg.includes("workspace"))
  );
}

export default function registerFeatureApplicationEntityToDtoMapperGenerator(plop: NodePlopAPI) {
  plop.setGenerator("feature-application-entity-to-dto-mapper", {
    description:
      "DTO type alias (`Plain<Entity>`) + mapXToDTO + test from a domain entity (@features/*-application). Use overwrite to re-sync; default refuses if files already exist.",
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

      const domainNpmName = readDomainPackageJsonName(repoRoot, rel);
      const entityKebab = toKebabCase(entityName);
      const allowOverwrite = overwrite === true;
      const actions: (ActionType | (() => string))[] = [];

      actions.push(() => {
        const dtosDir = path.join(repoRoot, ...applicationRel.split("/"), "dtos");
        const mappersDir = path.join(repoRoot, ...applicationRel.split("/"), "mappers");
        const dtoFile = path.join(dtosDir, `${entityKebab}.dto.ts`);
        const mapperFile = path.join(mappersDir, `${entityKebab}.mapper.ts`);
        const testFile = path.join(mappersDir, `${entityKebab}.mapper.test.ts`);
        const triple: [string, string][] = [
          [dtoFile, "DTO"],
          [mapperFile, "Mapper"],
          [testFile, "Mapper test"],
        ];
        const existing = triple.filter(([p]) => fs.existsSync(p));
        if (existing.length > 0 && !allowOverwrite) {
          const relPaths = existing.map(([p, label]) => `${label}: ${path.relative(repoRoot, p)}`);
          throw new Error(
            `${relPaths.join("; ")}.\n` +
              "Re-run this generator and answer Yes to overwrite, or delete those files first."
          );
        }
        return "";
      });

      actions.push(() => {
        ensureRepoApplicationPackageSlice(repoRoot, applicationRel, "dtos");
        ensureRepoApplicationPackageSlice(repoRoot, applicationRel, "mappers");
        return "";
      });

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
          if (!deps["@features/shared-domain"]) {
            deps["@features/shared-domain"] = "workspace:*";
          }
          pkg.devDependencies = (pkg.devDependencies as Record<string, string> | undefined) || {};
          const devDeps = pkg.devDependencies as Record<string, string>;
          if (!devDeps.vitest) {
            devDeps.vitest = resolveWorkspaceDependencyVersion(repoRoot, "vitest") || "^4.1.0";
          }
          pkg.scripts = (pkg.scripts as Record<string, string> | undefined) || {};
          const scripts = pkg.scripts as Record<string, string>;
          if (!scripts.test || String(scripts.test).includes("No tests yet")) {
            scripts.test = "vitest run";
          }
          return `${JSON.stringify(pkg, null, 2)}\n`;
        },
      });

      actions.push(() => {
        const dtosDir = path.join(repoRoot, ...applicationRel.split("/"), "dtos");
        const mappersDir = path.join(repoRoot, ...applicationRel.split("/"), "mappers");
        const dtoFile = path.join(dtosDir, `${entityKebab}.dto.ts`);
        const mapperFile = path.join(mappersDir, `${entityKebab}.mapper.ts`);
        const testFile = path.join(mappersDir, `${entityKebab}.mapper.test.ts`);
        const runCodegen = () =>
          generateApplicationEntityMapperSources({
            repoRoot,
            domainPackageRel: rel,
            domainNpmName,
            entityBasePascal: String(entityName ?? ""),
          });
        let bundle: ReturnType<typeof generateApplicationEntityMapperSources>;
        try {
          bundle = runCodegen();
        } catch (e) {
          if (!isMapperCodegenUnresolvedDepsError(e)) throw e;
          throw new Error(
            `${e instanceof Error ? e.message : String(e)}\n` +
              "Run `pnpm install` at the repo root so workspace packages and zod resolve, then run this generator again."
          );
        }
        fs.writeFileSync(dtoFile, bundle.dtoSource);
        fs.writeFileSync(mapperFile, bundle.mapperSource);
        fs.writeFileSync(testFile, bundle.testSource);
        return "";
      });

      actions.push({
        type: "modify",
        path: `../../${applicationRel}/dtos/index.ts`,
        transform: (file: string) => {
          const cleaned = file.replace(/^export\s*{\s*}\s*;?\s*$/m, "").trimEnd();
          const exportLine = `export * from './${entityKebab}.dto';`;
          if (cleaned.includes(exportLine)) {
            return `${cleaned}\n`;
          }
          const base = cleaned.length > 0 ? `${cleaned}\n` : "";
          return `${base}${exportLine}\n`;
        },
      });

      actions.push({
        type: "modify",
        path: `../../${applicationRel}/mappers/index.ts`,
        transform: (file: string) => {
          const cleaned = file.replace(/^export\s*{\s*}\s*;?\s*$/m, "").trimEnd();
          const exportLine = `export * from './${entityKebab}.mapper';`;
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
