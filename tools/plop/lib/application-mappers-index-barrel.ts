import { toKebabCase, toPascalCase } from "./casing.ts";

/** `features/.../<kebab>/application` folder segment → `PlopDemoMappers`. */
export function applicationMappersBarrelConstName(featureFolderKebab: string): string {
  return `${toPascalCase(featureFolderKebab)}Mappers`;
}

/** `line-item` → `mapLineItemToDTO`; `line-item-summary` → `mapLineItemSummaryToDTO`. */
export function mapperExportNameFromModuleKebab(mapperModuleKebab: string): string {
  return `map${toPascalCase(mapperModuleKebab)}ToDTO`;
}

function mapperFnNameToModuleKebab(fn: string): string {
  const inner = fn.replace(/^map/, "").replace(/ToDTO$/, "");
  return toKebabCase(inner);
}

const EXPORT_STAR = /export\s*\*\s*from\s*["']\.\/([^"']+)\.mapper["']\s*;?\s*/g;

const IMPORT_LINE = /import\s*\{\s*([^}]+)\s*\}\s*from\s*["']\.\/([^"']+)\.mapper["']\s*;?\s*/g;

function parseBarrelObjectKeys(body: string): string[] {
  const keys: string[] = [];
  for (const part of body.split(",")) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^(\w+)$/);
    if (m?.[1]) keys.push(m[1]);
  }
  return keys;
}

function parseExistingConst(file: string): { name: string; body: string } | null {
  const m = file.match(/export\s+const\s+(\w+)\s*=\s*\{([\s\S]*)\}\s*;?\s*$/m);
  if (!m?.[1] || m[2] === undefined) return null;
  return { name: m[1], body: m[2] };
}

export interface MappersIndexEntry {
  /** File base without `.mapper`, e.g. `line-item` or `line-item-custom`. */
  mapperModuleKebab: string;
}

/**
 * Collect mapper modules already declared in `mappers/index.ts` (barrel object, imports, or legacy `export *`).
 */
export function parseApplicationMappersIndexEntries(file: string): MappersIndexEntry[] {
  const byModule = new Map<string, MappersIndexEntry>();

  for (const m of file.matchAll(EXPORT_STAR)) {
    const mod = m[1];
    if (mod) byModule.set(mod, { mapperModuleKebab: mod });
  }

  for (const m of file.matchAll(IMPORT_LINE)) {
    const pathMod = m[2];
    if (pathMod) byModule.set(pathMod, { mapperModuleKebab: pathMod });
  }

  const constBlock = parseExistingConst(file);
  if (constBlock) {
    for (const fn of parseBarrelObjectKeys(constBlock.body)) {
      const mod = mapperFnNameToModuleKebab(fn);
      byModule.set(mod, { mapperModuleKebab: mod });
    }
  }

  return [...byModule.values()];
}

export function resolveApplicationMappersBarrelConstName(
  file: string,
  defaultName: string
): string {
  const constBlock = parseExistingConst(file);
  if (constBlock) return constBlock.name;
  return defaultName;
}

export function formatApplicationMappersIndexBarrel(
  entries: MappersIndexEntry[],
  constName: string
): string {
  const sorted = [...entries].sort((a, b) =>
    a.mapperModuleKebab.localeCompare(b.mapperModuleKebab)
  );
  const importLines = sorted.map((e) => {
    const fn = mapperExportNameFromModuleKebab(e.mapperModuleKebab);
    return `import { ${fn} } from './${e.mapperModuleKebab}.mapper';`;
  });
  const props = sorted.map((e) => {
    const fn = mapperExportNameFromModuleKebab(e.mapperModuleKebab);
    return `  ${fn},`;
  });
  return `${importLines.join("\n")}\n\nexport const ${constName} = {\n${props.join("\n")}\n};\n`;
}

/**
 * Merge a new entity mapper into `mappers/index.ts`, migrating legacy `export *` to the barrel object.
 */
export function syncApplicationMappersIndexBarrel(
  file: string,
  opts: { defaultConstName: string; mapperModuleKebab: string }
): string {
  const cleaned = file.replace(/^export\s*{\s*}\s*;?\s*$/m, "").trimEnd();
  const base = cleaned.length > 0 ? cleaned : "";
  const entries = parseApplicationMappersIndexEntries(base);
  const byModule = new Map(entries.map((e) => [e.mapperModuleKebab, e]));
  byModule.set(opts.mapperModuleKebab, { mapperModuleKebab: opts.mapperModuleKebab });
  const constName = resolveApplicationMappersBarrelConstName(base, opts.defaultConstName);
  return formatApplicationMappersIndexBarrel([...byModule.values()], constName);
}
