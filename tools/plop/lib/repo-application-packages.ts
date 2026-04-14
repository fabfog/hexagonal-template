import fs from "node:fs";
import path from "node:path";
import type { Dirent } from "node:fs";
import { toPascalCase } from "./casing.ts";

const APPLICATION_PKG_NAME = new RegExp("^@features/.+-application$");

/** Shared kernel package under `features/shared/application` — not a feature application slice. */
export const SHARED_APPLICATION_PACKAGE_NAME = "@features/shared-application";

function toPosixRel(repoRoot: string, absPath: string) {
  return path.relative(repoRoot, absPath).split(path.sep).join("/");
}

/**
 * Packages named like @features/…-application under features/{feature}/application/.
 */
export function getRepoApplicationPackageChoices(
  repoRoot: string
): { name: string; value: string }[] {
  const featuresDir = path.join(repoRoot, "features");
  if (!fs.existsSync(featuresDir)) {
    return [];
  }
  const out: { name: string; value: string }[] = [];
  for (const entry of fs.readdirSync(featuresDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgJsonPath = path.join(featuresDir, entry.name, "application", "package.json");
    if (!fs.existsSync(pkgJsonPath)) continue;
    let pkgName: string;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as { name?: string };
      pkgName = String(pkg.name ?? "");
    } catch {
      continue;
    }
    if (!APPLICATION_PKG_NAME.test(pkgName)) continue;
    const pkgRoot = path.dirname(pkgJsonPath);
    const rel = toPosixRel(repoRoot, pkgRoot);
    out.push({
      name: `${pkgName} - ${rel}`,
      value: rel,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Same as {@link getRepoApplicationPackageChoices} but omits {@link SHARED_APPLICATION_PACKAGE_NAME}
 * (use cases belong in feature application packages only).
 */
export function getRepoApplicationPackageChoicesForFeatureUseCases(
  repoRoot: string
): { name: string; value: string }[] {
  return getRepoApplicationPackageChoices(repoRoot).filter(
    (c) => readApplicationPackageJsonName(repoRoot, c.value) !== SHARED_APPLICATION_PACKAGE_NAME
  );
}

export function readApplicationPackageJsonName(repoRoot: string, pkgRel: string): string {
  const pkgJsonPath = path.join(repoRoot, ...pkgRel.split("/"), "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as { name?: string };
  return String(pkg.name ?? "");
}

/** `features/<slug>/application/ports` (repo-relative `applicationPackageRel`). */
export function repoApplicationPortsDir(repoRoot: string, applicationPackageRel: string) {
  return path.join(repoRoot, ...applicationPackageRel.split("/"), "ports");
}

/**
 * Normal ports only: `*.port.ts` excluding `*.interaction.port.ts` and `*.repository.port.ts`.
 */
export function getRepoNormalPortChoices(
  repoRoot: string,
  applicationPackageRel: string
): { name: string; value: string }[] {
  const portsDir = repoApplicationPortsDir(repoRoot, applicationPackageRel);
  if (!fs.existsSync(portsDir)) {
    return [];
  }
  return fs
    .readdirSync(portsDir, { withFileTypes: true })
    .filter(
      (entry: Dirent) =>
        entry.isFile() &&
        entry.name.endsWith(".port.ts") &&
        !entry.name.endsWith(".interaction.port.ts") &&
        !entry.name.endsWith(".repository.port.ts")
    )
    .map((entry: Dirent) => {
      const base = entry.name.replace(/\.port\.ts$/, "");
      const pascal = toPascalCase(base);
      const interfaceName = `${pascal}Port`;
      return {
        name: `${interfaceName} (${entry.name})`,
        value: entry.name,
      };
    });
}

/**
 * Repository ports only: `*.repository.port.ts`.
 */
export function getRepoRepositoryPortChoices(
  repoRoot: string,
  applicationPackageRel: string
): { name: string; value: string }[] {
  const portsDir = repoApplicationPortsDir(repoRoot, applicationPackageRel);
  if (!fs.existsSync(portsDir)) {
    return [];
  }
  return fs
    .readdirSync(portsDir, { withFileTypes: true })
    .filter((entry: Dirent) => entry.isFile() && entry.name.endsWith(".repository.port.ts"))
    .map((entry: Dirent) => {
      const slug = entry.name.replace(/\.repository\.port\.ts$/u, "");
      const pascal = toPascalCase(slug);
      const interfaceName = `${pascal}RepositoryPort`;
      return {
        name: `${interfaceName} (${entry.name})`,
        value: entry.name,
      };
    });
}

/**
 * Interaction ports only: `*.interaction.port.ts`.
 */
export function getRepoInteractionPortChoices(
  repoRoot: string,
  applicationPackageRel: string
): { name: string; value: string }[] {
  const portsDir = repoApplicationPortsDir(repoRoot, applicationPackageRel);
  if (!fs.existsSync(portsDir)) {
    return [];
  }
  return fs
    .readdirSync(portsDir, { withFileTypes: true })
    .filter((entry: Dirent) => entry.isFile() && entry.name.endsWith(".interaction.port.ts"))
    .map((entry: Dirent) => {
      const slug = entry.name.replace(/\.interaction\.port\.ts$/u, "");
      const pascal = toPascalCase(slug);
      const interfaceName = `${pascal}InteractionPort`;
      return {
        name: `${interfaceName} (${entry.name})`,
        value: entry.name,
      };
    });
}

export function readRepoApplicationPortSource(
  repoRoot: string,
  applicationPackageRel: string,
  portFileName: string
): string {
  const filePath = path.join(
    repoApplicationPortsDir(repoRoot, applicationPackageRel),
    portFileName
  );
  if (!fs.existsSync(filePath)) {
    throw new Error(`Port file not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}
