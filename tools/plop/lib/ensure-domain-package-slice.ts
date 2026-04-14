import fs from "node:fs";
import path from "node:path";

/** Matches existing barrel templates (`export {};`). */
export const INITIAL_BARREL = "export {};\n";

export const DOMAIN_SLICES = ["entities", "value-objects", "errors", "services"] as const;

export type DomainSlice = (typeof DOMAIN_SLICES)[number];

function assertSlice(slice: string): asserts slice is DomainSlice {
  if (!DOMAIN_SLICES.includes(slice as DomainSlice)) {
    throw new Error(`Invalid slice "${slice}". Expected one of: ${DOMAIN_SLICES.join(", ")}`);
  }
}

function mergePackageExport(pkgDir: string, slice: string) {
  const pkgJsonPath = path.join(pkgDir, "package.json");
  const raw = fs.readFileSync(pkgJsonPath, "utf8");
  const pkg = JSON.parse(raw) as Record<string, unknown>;
  if (!pkg.exports || typeof pkg.exports !== "object" || Array.isArray(pkg.exports)) {
    pkg.exports = {};
  }
  const exportsObj = pkg.exports as Record<string, string>;
  const key = `./${slice}`;
  const rel = `./${slice}/index.ts`;
  if (!exportsObj[key]) {
    exportsObj[key] = rel;
  }
  fs.writeFileSync(pkgJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

/**
 * Ensure `<slice>/index.ts` and `package.json` export for a domain package rooted at `repoRoot/pkgRel`.
 */
export function ensureRepoDomainPackageSlice(repoRoot: string, pkgRel: string, slice: DomainSlice) {
  assertSlice(slice);
  const pkgDir = path.join(repoRoot, ...pkgRel.split("/"));
  const sliceDir = path.join(pkgDir, slice);
  const indexPath = path.join(sliceDir, "index.ts");
  fs.mkdirSync(sliceDir, { recursive: true });
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(indexPath, INITIAL_BARREL, "utf8");
  }
  mergePackageExport(pkgDir, slice);
}
