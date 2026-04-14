import fs from "node:fs";
import path from "node:path";
import { toPascalCase } from "./casing.ts";
import { domainPackageRelFromApplicationRel } from "./repo-application-from-domain.ts";
import { getSharedDomainPackageRel, readDomainPackageJsonName } from "./repo-domain-packages.ts";

export interface VoFieldChoiceValue {
  voClass: string;
  source: "shared" | "local";
}

export function listExportedVoClassesInRepoPackage(
  repoRoot: string,
  domainPackageRel: string
): { className: string; fileBase: string }[] {
  const voDir = path.join(repoRoot, ...domainPackageRel.split("/"), "value-objects");
  if (!fs.existsSync(voDir)) {
    return [];
  }
  const out: { className: string; fileBase: string }[] = [];
  for (const entry of fs.readdirSync(voDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".vo.ts") || entry.name.endsWith(".test.ts")) {
      continue;
    }
    const abs = path.join(voDir, entry.name);
    const text = fs.readFileSync(abs, "utf8");
    const m = text.match(/export class (\w+)/);
    if (!m?.[1]) continue;
    out.push({
      className: m[1],
      fileBase: entry.name.replace(/\.vo\.ts$/, ""),
    });
  }
  return out.sort((a, b) => a.className.localeCompare(b.className));
}

/**
 * VO list: value objects from the selected domain package + from `@features/shared-domain` (no other features).
 */
export function getVoFieldChoicesForFeatureDomain(
  repoRoot: string,
  domainPackageRel: string
): { name: string; value: VoFieldChoiceValue }[] {
  const sharedRel = getSharedDomainPackageRel(repoRoot);
  const localVos = listExportedVoClassesInRepoPackage(repoRoot, domainPackageRel);
  const localNames = new Set(localVos.map((v) => v.className));
  const choices: { name: string; value: VoFieldChoiceValue }[] = [];
  const localPkgName = readDomainPackageJsonName(repoRoot, domainPackageRel);

  for (const v of localVos) {
    choices.push({
      name: `${v.className} (${localPkgName})`,
      value: { voClass: v.className, source: "local" },
    });
  }

  if (sharedRel && sharedRel !== domainPackageRel) {
    const sharedPkgName = readDomainPackageJsonName(repoRoot, sharedRel);
    for (const v of listExportedVoClassesInRepoPackage(repoRoot, sharedRel)) {
      if (localNames.has(v.className)) continue;
      choices.push({
        name: `${v.className} (${sharedPkgName})`,
        value: { voClass: v.className, source: "shared" },
      });
    }
  }

  return choices.sort((a, b) => a.name.localeCompare(b.name));
}

function listEntityFilesInEntitiesDir(entitiesDir: string): { pascal: string; fileName: string }[] {
  if (!fs.existsSync(entitiesDir)) {
    return [];
  }
  const out: { pascal: string; fileName: string }[] = [];
  for (const entry of fs.readdirSync(entitiesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".entity.ts")) continue;
    const base = entry.name.replace(/\.entity\.ts$/, "");
    out.push({
      pascal: toPascalCase(base),
      fileName: entry.name,
    });
  }
  return out.sort((a, b) => a.pascal.localeCompare(b.pascal));
}

export function getDomainEntitySelectChoices(
  repoRoot: string,
  domainPackageRel: string
): { name: string; value: string }[] {
  const entitiesDir = path.join(repoRoot, ...domainPackageRel.split("/"), "entities");
  if (!fs.existsSync(entitiesDir)) {
    throw new Error(`No entities folder for ${domainPackageRel}.`);
  }
  const raw = listEntityFilesInEntitiesDir(entitiesDir);
  if (!raw.length) {
    throw new Error(`No .entity.ts files under ${domainPackageRel}/entities.`);
  }
  return raw.map((e) => ({
    name: `${e.pascal}Entity (${e.fileName})`,
    value: e.pascal,
  }));
}

export interface RepositoryPortEntityChoiceValue {
  entityPascal: string;
  /** Package root rel where the entity lives (`features/x/domain` or shared-domain). */
  entityDomainPackageRel: string;
}

/**
 * Entities from this feature's sibling domain plus `@features/shared-domain` (same Pascal name: local wins).
 */
export function getRepositoryPortEntitySelectChoices(
  repoRoot: string,
  applicationPackageRel: string
): { name: string; value: RepositoryPortEntityChoiceValue }[] {
  const domainRel = domainPackageRelFromApplicationRel(applicationPackageRel);
  const domainPkgJson = path.join(repoRoot, ...domainRel.split("/"), "package.json");
  if (!fs.existsSync(domainPkgJson)) {
    throw new Error(
      `Repository ports use the domain in the same feature only. Expected ${domainRel}/package.json (sibling of the selected application).`
    );
  }
  const localEntitiesDir = path.join(repoRoot, ...domainRel.split("/"), "entities");
  if (!fs.existsSync(localEntitiesDir)) {
    throw new Error(`No entities folder for ${domainRel}.`);
  }
  const choices: { name: string; value: RepositoryPortEntityChoiceValue }[] = [];
  const localPkg = readDomainPackageJsonName(repoRoot, domainRel);
  for (const e of listEntityFilesInEntitiesDir(localEntitiesDir)) {
    choices.push({
      name: `${e.pascal}Entity (${e.fileName}) — ${localPkg}`,
      value: { entityPascal: e.pascal, entityDomainPackageRel: domainRel },
    });
  }
  const localPascals = new Set(choices.map((c) => c.value.entityPascal));
  const sharedRel = getSharedDomainPackageRel(repoRoot);
  if (sharedRel && sharedRel !== domainRel) {
    const sharedEntitiesDir = path.join(repoRoot, ...sharedRel.split("/"), "entities");
    if (fs.existsSync(sharedEntitiesDir)) {
      const sharedPkg = readDomainPackageJsonName(repoRoot, sharedRel);
      for (const e of listEntityFilesInEntitiesDir(sharedEntitiesDir)) {
        if (localPascals.has(e.pascal)) continue;
        choices.push({
          name: `${e.pascal}Entity (${e.fileName}) — ${sharedPkg}`,
          value: { entityPascal: e.pascal, entityDomainPackageRel: sharedRel },
        });
      }
    }
  }
  if (!choices.length) {
    throw new Error(
      `No .entity.ts files under ${domainRel}/entities (or only duplicates vs shared-domain). Add an entity first.`
    );
  }
  return choices.sort((a, b) => a.name.localeCompare(b.name));
}

export function appendVoFieldToEntitySource(
  content: string,
  entityPascal: string,
  field: { prop: string; voClass: string; source: "shared" | "local" }
): string {
  const schemaConst = `${entityPascal}Schema`;
  const marker = `export const ${schemaConst} = z.object(`;
  const mi = content.indexOf(marker);
  if (mi === -1) {
    throw new Error(`Could not find ${schemaConst} = z.object(`);
  }
  let pos = mi + marker.length;
  while (pos < content.length && /\s/.test(content[pos]!)) pos++;
  if (pos >= content.length || content[pos] !== "{") {
    throw new Error(`Malformed schema: expected { after z.object(`);
  }
  let depth = 1;
  const bodyStart = pos + 1;
  pos++;
  while (pos < content.length && depth > 0) {
    const ch = content[pos];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    pos++;
  }
  if (depth !== 0) {
    throw new Error(`Unbalanced braces in ${schemaConst}`);
  }
  const bodyEnd = pos - 1;
  const body = content.slice(bodyStart, bodyEnd);
  const propNeedle = new RegExp(`\\b${field.prop}\\s*:`);
  if (propNeedle.test(body)) {
    throw new Error(`Property "${field.prop}" already exists in ${schemaConst}.`);
  }
  const fieldLine = `  ${field.prop}: ${field.voClass}Schema`;
  const hasSubstantiveField = /^\s*[a-zA-Z_][a-zA-Z0-9_]*\s*:/m.test(body);
  let newInner: string;
  if (!hasSubstantiveField) {
    newInner = `\n  ${fieldLine},\n  `;
  } else {
    const trimmed = body.trimEnd();
    const needsComma = trimmed.length > 0 && !trimmed.endsWith(",");
    newInner = `${trimmed}${needsComma ? "," : ""}\n  ${fieldLine},\n  `;
  }
  let next = `${content.slice(0, bodyStart)}${newInner}${content.slice(bodyEnd)}`;

  const sharedImportRe =
    /import\s*\{([^}]*)\}\s*from\s*['"]@features\/shared-domain\/value-objects['"]\s*;/;
  const localImportRe = /import\s*\{([^}]*)\}\s*from\s*['"]\.\.\/value-objects['"]\s*;/;

  const mergeNamed = (existing: string, additions: string[]) => {
    const set = new Set(
      existing
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );
    for (const a of additions) set.add(a);
    return [...set].sort().join(", ");
  };
  const addSymbols = [`${field.voClass}Schema`];

  if (field.source === "shared") {
    const m = next.match(sharedImportRe);
    if (m) {
      const merged = mergeNamed(m[1] ?? "", addSymbols);
      next = next.replace(
        sharedImportRe,
        `import { ${merged} } from '@features/shared-domain/value-objects';`
      );
    } else {
      const zImportIdx = next.indexOf("import { z }");
      const insertAt = zImportIdx === -1 ? 0 : next.indexOf("\n", zImportIdx) + 1;
      const line = `import { ${addSymbols.join(", ")} } from '@features/shared-domain/value-objects';\n`;
      next = next.slice(0, insertAt) + line + next.slice(insertAt);
    }
  } else {
    const m = next.match(localImportRe);
    if (m) {
      const merged = mergeNamed(m[1] ?? "", addSymbols);
      next = next.replace(localImportRe, `import { ${merged} } from '../value-objects';`);
    } else {
      const idImportRe = new RegExp(
        `(import\\s*\\{[^}]+}\\s*from\\s*['"]\\.\\./value-objects/[^'"]+['"]\\s*;\\s*\\n)`
      );
      const idm = next.match(idImportRe);
      const insertAt =
        idm !== null && idm.index !== undefined
          ? idm.index + idm[0].length
          : next.indexOf("\n") + 1;
      const line = `import { ${addSymbols.join(", ")} } from '../value-objects';\n`;
      next = next.slice(0, insertAt) + line + next.slice(insertAt);
    }
  }
  return next;
}
