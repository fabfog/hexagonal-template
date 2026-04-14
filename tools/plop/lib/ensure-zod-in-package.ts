import fs from "node:fs";
import path from "node:path";
import { resolveWorkspaceDependencyVersion } from "./workspace-dependency-version.ts";

/**
 * Ensure `zod` is listed in `dependencies` for a package at `repoRoot/pkgRel` (posix rel path).
 */
export function ensureZodDependencyInPackage(repoRoot: string, pkgRel: string): string {
  const pkgPath = path.join(repoRoot, ...pkgRel.split("/"), "package.json");
  if (!fs.existsSync(pkgPath)) return "package.json not found, skipped zod dependency";
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
  pkg.dependencies = (pkg.dependencies as Record<string, string> | undefined) || {};
  const deps = pkg.dependencies as Record<string, string>;
  if (!deps.zod) {
    deps.zod = resolveWorkspaceDependencyVersion(repoRoot, "zod") || "^3.23.8";
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
    return "Added zod dependency to domain package";
  }
  return "zod already present in domain package dependencies";
}
