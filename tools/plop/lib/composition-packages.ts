import fs from "node:fs";
import path from "node:path";
import { featureSegmentFromApplicationPackageRel } from "./repo-application-from-domain.ts";

function toPosixRel(repoRoot: string, absPath: string) {
  return path.relative(repoRoot, absPath).split(path.sep).join("/");
}

/**
 * Composition workspace packages under `features/<same-feature>/composition/<app>/` for a given application package.
 */
export function getRepoCompositionPackageChoices(
  repoRoot: string,
  applicationPackageRel: string
): { name: string; value: string }[] {
  const feat = featureSegmentFromApplicationPackageRel(applicationPackageRel);
  const compRoot = path.join(repoRoot, "features", feat, "composition");
  if (!fs.existsSync(compRoot)) {
    return [];
  }
  const out: { name: string; value: string }[] = [];
  for (const entry of fs.readdirSync(compRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgJsonPath = path.join(compRoot, entry.name, "package.json");
    if (!fs.existsSync(pkgJsonPath)) continue;
    let pkgName = "";
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as { name?: string };
      pkgName = String(pkg.name ?? "");
    } catch {
      continue;
    }
    const pkgRoot = path.dirname(pkgJsonPath);
    const rel = toPosixRel(repoRoot, pkgRoot);
    out.push({
      name: pkgName ? `${pkgName} - ${rel}` : rel,
      value: rel,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Every feature-scoped composition app under `features/<slug>/composition/<app>/package.json`, for
 * generators that need to pick a composition root without an application package context first.
 */
export function getAllFeatureCompositionPackageChoices(
  repoRoot: string
): { name: string; value: string }[] {
  const featuresDir = path.join(repoRoot, "features");
  if (!fs.existsSync(featuresDir)) {
    return [];
  }
  const out: { name: string; value: string }[] = [];
  for (const feat of fs.readdirSync(featuresDir, { withFileTypes: true })) {
    if (!feat.isDirectory()) continue;
    const compRoot = path.join(featuresDir, feat.name, "composition");
    if (!fs.existsSync(compRoot)) continue;
    for (const app of fs.readdirSync(compRoot, { withFileTypes: true })) {
      if (!app.isDirectory()) continue;
      const pkgJsonPath = path.join(compRoot, app.name, "package.json");
      if (!fs.existsSync(pkgJsonPath)) continue;
      let pkgName = "";
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as { name?: string };
        pkgName = String(pkg.name ?? "");
      } catch {
        continue;
      }
      const pkgRoot = path.dirname(pkgJsonPath);
      const rel = toPosixRel(repoRoot, pkgRoot);
      out.push({
        name: pkgName ? `${pkgName} - ${rel}` : rel,
        value: rel,
      });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
