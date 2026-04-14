import fs from "node:fs";
import path from "node:path";
import { toPascalCase } from "./casing.ts";
import { getSharedDomainPackageRel, readDomainPackageJsonName } from "./repo-domain-packages.ts";

export function listEntityPascalsInDomainPackage(repoRoot: string, pkgRel: string): string[] {
  const entitiesDir = path.join(repoRoot, ...pkgRel.split("/"), "entities");
  if (!fs.existsSync(entitiesDir)) {
    return [];
  }
  return fs
    .readdirSync(entitiesDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".entity.ts"))
    .map((e) => {
      const base = e.name.replace(/\.entity\.ts$/, "");
      return toPascalCase(base);
    });
}

export interface DomainServiceEntityImportLine {
  /** Comma-separated class names, e.g. `UserEntity, OrderEntity`. */
  entityClasses: string;
  importPath: string;
}

/**
 * Checkbox choices: entities from `@features/shared-domain` (if distinct from the selected package)
 * plus entities from the selected feature domain only. No other feature domains.
 */
export function getDomainServiceEntityCheckboxChoices(
  repoRoot: string,
  domainPackageRel: string
): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  const sharedRel = getSharedDomainPackageRel(repoRoot);
  let currentPkgName: string;
  try {
    currentPkgName = readDomainPackageJsonName(repoRoot, domainPackageRel);
  } catch {
    throw new Error(`Could not read package.json for ${domainPackageRel}`);
  }

  if (sharedRel && sharedRel !== domainPackageRel) {
    for (const pascal of listEntityPascalsInDomainPackage(repoRoot, sharedRel)) {
      out.push({
        name: `${pascal}Entity — @features/shared-domain`,
        value: `shared:${pascal}`,
      });
    }
  }

  for (const pascal of listEntityPascalsInDomainPackage(repoRoot, domainPackageRel)) {
    out.push({
      name: `${pascal}Entity — ${currentPkgName}`,
      value: `local:${pascal}`,
    });
  }

  if (!out.length) {
    throw new Error(
      "No entities found. Add entities under entities/ in this domain package and/or in @features/shared-domain."
    );
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function buildDomainServiceEntityImportLines(
  selectedTokens: string[],
  currentPackageName: string,
  sharedPackageName: string | null
): DomainServiceEntityImportLine[] {
  const rows = selectedTokens.map((token) => {
    const colon = token.indexOf(":");
    const source = colon === -1 ? "local" : token.slice(0, colon);
    const pascal = colon === -1 ? token : token.slice(colon + 1);
    const entityClass = `${pascal}Entity`;
    if (source === "shared") {
      if (!sharedPackageName) {
        throw new Error(
          "Invalid selection: shared entity without @features/shared-domain package."
        );
      }
      return { entityClass, importPath: `${sharedPackageName}/entities` };
    }
    if (source !== "local") {
      throw new Error(`Invalid entity token "${token}". Expected shared:… or local:….`);
    }
    return { entityClass, importPath: `${currentPackageName}/entities` };
  });

  const byPath = new Map<string, string[]>();
  for (const { entityClass, importPath } of rows) {
    const list = byPath.get(importPath) ?? [];
    list.push(entityClass);
    byPath.set(importPath, list);
  }
  return [...byPath.entries()].map(([importPath, classes]) => {
    classes.sort((a, b) => a.localeCompare(b));
    return {
      entityClasses: classes.join(", "),
      importPath,
    };
  });
}
