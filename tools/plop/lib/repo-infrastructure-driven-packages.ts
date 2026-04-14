import fs from "node:fs";
import path from "node:path";
import { readApplicationPackageJsonName } from "./repo-application-packages.ts";

function toPosixRel(repoRoot: string, absPath: string) {
  return path.relative(repoRoot, absPath).split(path.sep).join("/");
}

const DRIVEN_FOLDER = /^driven-/;

export interface DrivenInfrastructurePackageChoicesOptions {
  /**
   * When true, omit packages under `features/shared/infrastructure/` (shared infra is lib-* only;
   * no driven persistence slice).
   */
  excludeFeaturesSharedInfrastructure?: boolean;
}

/**
 * Workspace packages under `features/.../infrastructure/driven-` (repo-relative POSIX roots).
 * Repository adapters, mappers, and other outbound code are flat files at package root (alongside `index.ts`).
 */
export function getRepoDrivenInfrastructurePackageChoices(
  repoRoot: string,
  options?: DrivenInfrastructurePackageChoicesOptions
): { name: string; value: string }[] {
  const featuresDir = path.join(repoRoot, "features");
  if (!fs.existsSync(featuresDir)) {
    return [];
  }
  const out: { name: string; value: string }[] = [];
  for (const feat of fs.readdirSync(featuresDir, { withFileTypes: true })) {
    if (!feat.isDirectory()) continue;
    const infraRoot = path.join(featuresDir, feat.name, "infrastructure");
    if (!fs.existsSync(infraRoot)) continue;
    for (const sub of fs.readdirSync(infraRoot, { withFileTypes: true })) {
      if (!sub.isDirectory() || !DRIVEN_FOLDER.test(sub.name)) continue;
      const pkgRoot = path.join(infraRoot, sub.name);
      const pkgJsonPath = path.join(pkgRoot, "package.json");
      if (!fs.existsSync(pkgJsonPath)) continue;
      let pkgName = "";
      try {
        pkgName = readApplicationPackageJsonName(repoRoot, toPosixRel(repoRoot, pkgRoot));
      } catch {
        continue;
      }
      if (!pkgName) continue;
      const rel = toPosixRel(repoRoot, pkgRoot);
      if (options?.excludeFeaturesSharedInfrastructure && rel.startsWith("features/shared/")) {
        continue;
      }
      out.push({
        name: `${pkgName} - ${rel}`,
        value: rel,
      });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
