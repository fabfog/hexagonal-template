import fs from "node:fs";
import path from "node:path";
import type { ActionType } from "node-plop";
import {
  applicationMappersBarrelConstName,
  syncApplicationMappersIndexBarrel,
} from "./application-mappers-index-barrel.ts";
import { toKebabCase } from "./casing.ts";
import { generateApplicationEntityMapperSources } from "./entity-to-dto-map-codegen.ts";
import { ensureRepoApplicationPackageSlice } from "./ensure-repo-application-package-slice.ts";
import {
  applicationPackageRelFromDomainRel,
  featureSegmentFromApplicationPackageRel,
} from "./repo-application-from-domain.ts";
import { readDomainPackageJsonName } from "./repo-domain-packages.ts";
import { resolveWorkspaceDependencyVersion } from "./workspace-dependency-version.ts";

export function isMapperCodegenUnresolvedDepsError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    (msg.includes("Could not infer properties") &&
      msg.includes("[SERIALIZE]()") &&
      msg.includes("any")) ||
    (msg.includes("pnpm install") && msg.includes("workspace"))
  );
}

export interface AppendApplicationEntityMapperWorkflowArgs {
  repoRoot: string;
  domainPackageRel: string;
  /** Same as entity generator input / mapper generator (PascalCase or free text; codegen normalizes). */
  entityName: string;
  allowOverwrite: boolean;
  /**
   * Optional kebab-case suffix: mapper files become `${entityKebab}-${variant}.mapper.ts`
   * and export `map${toPascalCase(`${entityKebab}-${variant}`)}ToDTO`. Empty = default single mapper per entity.
   */
  mapperVariantKebab?: string;
}

/**
 * Appends the same actions as `feature-application-entity-to-dto-mapper` (DTO + mapper + test + package.json + barrel exports).
 */
export function appendApplicationEntityMapperWorkflow(
  actions: (ActionType | (() => string))[],
  opts: AppendApplicationEntityMapperWorkflowArgs
) {
  const { repoRoot, domainPackageRel, entityName, allowOverwrite, mapperVariantKebab } = opts;
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
  const variant = String(mapperVariantKebab ?? "").trim();
  if (variant && !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(variant)) {
    throw new Error(
      `Mapper variant must be kebab-case (e.g. "summary", "audit-trail"); got "${variant}".`
    );
  }
  const mapperModuleKebab = variant ? `${entityKebab}-${variant}` : entityKebab;

  actions.push(() => {
    const dtosDir = path.join(repoRoot, ...applicationRel.split("/"), "dtos");
    const mappersDir = path.join(repoRoot, ...applicationRel.split("/"), "mappers");
    const dtoFile = path.join(dtosDir, `${entityKebab}.dto.ts`);
    const mapperFile = path.join(mappersDir, `${mapperModuleKebab}.mapper.ts`);
    const testFile = path.join(mappersDir, `${mapperModuleKebab}.mapper.test.ts`);
    const triple: [string, string][] = [
      [dtoFile, "DTO"],
      [mapperFile, "Mapper"],
      [testFile, "Mapper test"],
    ];
    if (!allowOverwrite) {
      const blocking = variant
        ? triple.filter(
            ([p, label]) => (label === "Mapper" || label === "Mapper test") && fs.existsSync(p)
          )
        : triple.filter(([p]) => fs.existsSync(p));
      if (blocking.length > 0) {
        const msg = blocking
          .map(([p, label]) => `${label}: ${path.relative(repoRoot, p)}`)
          .join("; ");
        throw new Error(`${msg}.\n` + "Re-run and allow overwrite, or delete those files first.");
      }
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
    const mapperFile = path.join(mappersDir, `${mapperModuleKebab}.mapper.ts`);
    const testFile = path.join(mappersDir, `${mapperModuleKebab}.mapper.test.ts`);
    const runCodegen = () =>
      generateApplicationEntityMapperSources({
        repoRoot,
        domainPackageRel: rel,
        domainNpmName,
        entityBasePascal: String(entityName ?? ""),
        mapperModuleKebab,
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
      const featureSeg = featureSegmentFromApplicationPackageRel(applicationRel);
      const defaultConstName = applicationMappersBarrelConstName(featureSeg);
      return syncApplicationMappersIndexBarrel(file, {
        defaultConstName,
        mapperModuleKebab,
      });
    },
  });
}
