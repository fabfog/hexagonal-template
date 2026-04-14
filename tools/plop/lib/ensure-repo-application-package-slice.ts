import fs from "node:fs";
import path from "node:path";
import { INITIAL_BARREL } from "./ensure-domain-package-slice.ts";

export const APPLICATION_SLICES = ["ports", "use-cases", "dtos", "mappers"] as const;

export type ApplicationSlice = (typeof APPLICATION_SLICES)[number];

function assertSlice(slice: string): asserts slice is ApplicationSlice {
  if (!APPLICATION_SLICES.includes(slice as ApplicationSlice)) {
    throw new Error(`Invalid slice "${slice}". Expected one of: ${APPLICATION_SLICES.join(", ")}`);
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
 * Ensure `<slice>/index.ts` and `package.json` export for an application package under `features/.../application/`.
 */
export function ensureRepoApplicationPackageSlice(
  repoRoot: string,
  pkgRel: string,
  slice: ApplicationSlice
) {
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
