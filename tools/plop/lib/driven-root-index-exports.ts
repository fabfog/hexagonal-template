/** Driven packages: adapters and mappers live as flat `*.ts` files at package root; barrel in `index.ts`. */
const ROOT_INDEX_EXPORT_LINES_TO_STRIP = new Set([
  "export * from './adapters';",
  'export * from "./adapters";',
  "export * from './interaction-adapters';",
  'export * from "./interaction-adapters";',
  "export * from './repositories';",
  'export * from "./repositories";',
  "export * from './mappers';",
  'export * from "./mappers";',
]);

/**
 * Append `export * from './<moduleBase>';` to a driven package `index.ts`, stripping `export {}`
 * and subfolder barrel lines that do not match the flat driven package layout.
 */
export function appendDrivenRootIndexExport(existing: string, moduleBase: string): string {
  const exportLine = `export * from './${moduleBase}';`;
  const withoutEmpty = existing.replace(/^export\s*{\s*}\s*;?\s*$/m, "").trimEnd();
  const stripped = withoutEmpty
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      return !ROOT_INDEX_EXPORT_LINES_TO_STRIP.has(t);
    })
    .join("\n")
    .trimEnd();
  if (stripped.includes(exportLine)) {
    return `${stripped}\n`;
  }
  const content = stripped.length > 0 ? `${stripped}\n` : "";
  return `${content}${exportLine}\n`;
}

/** Keep package.json exports aligned to the flat driven package layout. */
export function stripRepositoriesSubpathExport(pkg: {
  exports?: Record<string, unknown> | string;
}): void {
  const ex = pkg.exports;
  if (!ex || typeof ex !== "object" || Array.isArray(ex)) return;
  const map = ex as Record<string, unknown>;
  delete map["./repositories"];
}
