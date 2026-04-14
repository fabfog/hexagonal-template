import fs from "node:fs";
import path from "node:path";
import type { Dirent } from "node:fs";
import type { Answers } from "inquirer";
import {
  parseDependenciesInterface,
  insertAfterLastImport,
} from "./parse-dependencies-interface.ts";
import { readApplicationPackageJsonName } from "./repo-application-packages.ts";
import { toCamelCase, toKebabCase, toPascalCase } from "./casing.ts";

export type RepoApplicationSliceKind = "use-case" | "interactive-use-case";

const UNIFIED_USE_CASE_SLICE_SEP = "|";

/**
 * Plop list `value` for a concrete slice: `standard|Foo` or `interactive|Bar` (Pascal base name).
 */
export function decodeUnifiedUseCaseSliceChoice(encoded: string): {
  sliceKind: RepoApplicationSliceKind;
  sliceNamePascal: string;
} {
  const i = encoded.indexOf(UNIFIED_USE_CASE_SLICE_SEP);
  if (i <= 0 || i >= encoded.length - 1) {
    throw new Error(`Invalid use case selection: ${encoded}`);
  }
  const prefix = encoded.slice(0, i);
  const pascal = encoded.slice(i + 1);
  if (prefix !== "standard" && prefix !== "interactive") {
    throw new Error(`Invalid use case selection: ${encoded}`);
  }
  return {
    sliceKind: prefix === "interactive" ? "interactive-use-case" : "use-case",
    sliceNamePascal: pascal,
  };
}

function sliceFileSpec(kind: RepoApplicationSliceKind) {
  if (kind === "use-case") {
    return {
      fileName: (kebab: string) => `${kebab}.use-case.ts`,
      depsInterfaceSuffix: "UseCaseDependencies" as const,
    };
  }
  return {
    fileName: (kebab: string) => `${kebab}.interactive.use-case.ts`,
    depsInterfaceSuffix: "InteractiveUseCaseDependencies" as const,
  };
}

function repoSliceAbsPath(
  repoRoot: string,
  applicationRel: string,
  kind: RepoApplicationSliceKind,
  sliceNamePascal: string
) {
  const kebab = toKebabCase(sliceNamePascal);
  const fileName = sliceFileSpec(kind).fileName(kebab);
  return path.join(repoRoot, ...applicationRel.split("/"), "use-cases", fileName);
}

function repoSliceDepsInterfaceName(kind: RepoApplicationSliceKind, sliceNamePascal: string) {
  const p = toPascalCase(sliceNamePascal);
  return `${p}${sliceFileSpec(kind).depsInterfaceSuffix}`;
}

function repoApplicationPortsDir(repoRoot: string, applicationRel: string) {
  return path.join(repoRoot, ...applicationRel.split("/"), "ports");
}

function extractPortInterfaceName(portSource: string) {
  const match = portSource.match(/export\s+interface\s+([A-Za-z0-9_]+)/);
  if (!match?.[1]) {
    throw new Error("Could not extract `export interface <Name>` from port file.");
  }
  return match[1];
}

function computeDefaultPortPropertyName(portFileName: string) {
  const base = String(portFileName).replace(/\.ts$/, "");
  const withoutPortSuffix = base.replace(/\.port$/, "");
  const normalized = withoutPortSuffix.replace(/\./g, "-");
  return toCamelCase(normalized);
}

export function listPortsForRepoApplication(repoRoot: string, applicationRel: string) {
  const portsDir = repoApplicationPortsDir(repoRoot, applicationRel);
  if (!fs.existsSync(portsDir)) return [];
  return fs
    .readdirSync(portsDir, { withFileTypes: true })
    .filter(
      (entry: Dirent) =>
        entry.isFile() &&
        entry.name.endsWith(".port.ts") &&
        entry.name !== "index.ts" &&
        !entry.name.endsWith(".test.ts")
    )
    .map((entry: Dirent) => {
      const portSource = fs.readFileSync(path.join(portsDir, entry.name), "utf8");
      const interfaceName = extractPortInterfaceName(portSource);
      const kind = entry.name.endsWith(".interaction.port.ts")
        ? "interaction"
        : entry.name.endsWith(".repository.port.ts")
          ? "repository"
          : "port";
      return {
        portFileName: entry.name,
        interfaceName,
        kind,
        defaultPropertyName: computeDefaultPortPropertyName(entry.name),
      };
    });
}

export interface PortChoicesNotYetInRepoSliceDepsOpts {
  applicationSliceRel: string;
  sliceKind: RepoApplicationSliceKind;
  sliceNamePascal: string;
  portApplicationRel: string;
  allPortsPresentMessage: string;
}

export function portChoicesNotYetInRepoSliceDeps(
  repoRoot: string,
  opts: PortChoicesNotYetInRepoSliceDepsOpts
) {
  const {
    applicationSliceRel,
    sliceKind,
    sliceNamePascal,
    portApplicationRel,
    allPortsPresentMessage,
  } = opts;
  const absPath = repoSliceAbsPath(repoRoot, applicationSliceRel, sliceKind, sliceNamePascal);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Slice file not found: ${absPath}`);
  }
  const depsName = repoSliceDepsInterfaceName(sliceKind, sliceNamePascal);
  const source = fs.readFileSync(absPath, "utf8");
  const { properties } = parseDependenciesInterface(source, depsName);
  const existingTypes = new Set(properties.map((p: { type: string }) => p.type));
  const ports = listPortsForRepoApplication(repoRoot, portApplicationRel);
  if (!ports.length) {
    throw new Error(`No port files in ports/ for "${portApplicationRel}".`);
  }
  // Interaction ports pair 1:1 with interactive use cases at creation; deps only list "normal" ports.
  const injectablePorts = ports.filter((p) => p.kind !== "interaction");
  if (!injectablePorts.length) {
    throw new Error(
      `No injectable application ports in ports/ for "${portApplicationRel}" (only *.interaction.port.ts — those are not added via this generator).`
    );
  }
  const filtered = injectablePorts.filter((p) => !existingTypes.has(p.interfaceName));
  if (!filtered.length) {
    throw new Error(allPortsPresentMessage);
  }
  return filtered.map((p) => ({
    name: `${p.interfaceName} (${p.portFileName})`,
    value: p.portFileName,
  }));
}

export function defaultRepoPortPropertyName(
  repoRoot: string,
  portApplicationRel: string,
  portFileName: string
) {
  const ports = listPortsForRepoApplication(repoRoot, portApplicationRel);
  const selected = ports.find((p) => p.portFileName === portFileName);
  return selected?.defaultPropertyName ?? "port";
}

export function validateRepoPortPropertyName(value: unknown, answers: Answers, repoRoot: string) {
  const encoded = String(answers.useCaseSlice ?? "");
  if (!encoded.includes(UNIFIED_USE_CASE_SLICE_SEP)) {
    return "Select a use case first.";
  }
  let sliceKind: RepoApplicationSliceKind;
  let sliceNamePascal: string;
  try {
    const d = decodeUnifiedUseCaseSliceChoice(encoded);
    sliceKind = d.sliceKind;
    sliceNamePascal = d.sliceNamePascal;
  } catch {
    return "Invalid use case selection.";
  }
  const v = String(value || "").trim();
  if (!v) return "Property name cannot be empty";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) return "Use a valid identifier";
  const applicationSliceRel = String(answers.applicationSliceRel ?? "");
  const absPath = repoSliceAbsPath(repoRoot, applicationSliceRel, sliceKind, sliceNamePascal);
  const depsName = repoSliceDepsInterfaceName(sliceKind, sliceNamePascal);
  const source = fs.readFileSync(absPath, "utf8");
  const { properties } = parseDependenciesInterface(source, depsName);
  const existingNames = new Set(properties.map((p: { name: string }) => p.name));
  if (existingNames.has(v)) return "Collision: pick another property name.";
  return true;
}

function buildPortImportLine(
  repoRoot: string,
  applicationSliceRel: string,
  portApplicationRel: string,
  portInterfaceName: string,
  portFileName: string
): string {
  const stem = portFileName.replace(/\.ts$/, "");
  if (applicationSliceRel === portApplicationRel) {
    return `import type { ${portInterfaceName} } from "../ports/${stem}";`;
  }
  const pkgName = readApplicationPackageJsonName(repoRoot, portApplicationRel);
  return `import type { ${portInterfaceName} } from "${pkgName}/ports";`;
}

export interface BuildAddPortDependencyToRepoSliceOpts {
  applicationSliceRel: string;
  sliceKind: RepoApplicationSliceKind;
  sliceNamePascal: string;
  portApplicationRel: string;
  portFileName: string;
  portPropertyName: string;
}

export function buildAddPortDependencyToRepoSliceActions(
  repoRoot: string,
  opts: BuildAddPortDependencyToRepoSliceOpts
) {
  const {
    applicationSliceRel,
    sliceKind,
    sliceNamePascal,
    portApplicationRel,
    portFileName,
    portPropertyName,
  } = opts;
  const kebab = toKebabCase(sliceNamePascal);
  const fileName = sliceFileSpec(sliceKind).fileName(kebab);
  const depsInterfaceNameResolved = repoSliceDepsInterfaceName(sliceKind, sliceNamePascal);
  const modifyPath = `../../${applicationSliceRel}/use-cases/${fileName}`;
  const absPath = repoSliceAbsPath(repoRoot, applicationSliceRel, sliceKind, sliceNamePascal);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Slice file not found: ${absPath}`);
  }
  const ports = listPortsForRepoApplication(repoRoot, portApplicationRel);
  const selectedPort = ports.find((p) => p.portFileName === portFileName);
  if (!selectedPort) {
    throw new Error("Selected port not found (unexpected).");
  }
  if (selectedPort.kind === "interaction") {
    throw new Error(
      "Interaction ports belong on execute(...), not on the deps interface; add normal ports only with this generator."
    );
  }
  const portInterfaceName = selectedPort.interfaceName;
  const importLine = buildPortImportLine(
    repoRoot,
    applicationSliceRel,
    portApplicationRel,
    portInterfaceName,
    portFileName
  );

  /** @type {import('node-plop').ActionType[]} */
  const actions: import("node-plop").ActionType[] = [];
  actions.push({
    type: "modify",
    path: modifyPath,
    transform: (file: string) => {
      let updated = file;
      if (!updated.includes(importLine)) {
        updated = insertAfterLastImport(updated, importLine);
      }
      const { closeIdx, properties, indent } = parseDependenciesInterface(
        updated,
        depsInterfaceNameResolved
      );
      const existingTypes = new Set(properties.map((p: { type: string }) => p.type));
      if (existingTypes.has(portInterfaceName)) {
        return updated;
      }
      const propertyLine = indent
        ? `${indent}${portPropertyName}: ${portInterfaceName};`
        : `  ${portPropertyName}: ${portInterfaceName};`;
      updated = updated.slice(0, closeIdx) + `${propertyLine}\n` + updated.slice(closeIdx);
      return updated;
    },
  });

  if (portApplicationRel !== applicationSliceRel) {
    const portPkgName = readApplicationPackageJsonName(repoRoot, portApplicationRel);
    actions.push({
      type: "modify",
      path: `../../${applicationSliceRel}/package.json`,
      transform: (file: string) => {
        const pkg = JSON.parse(file) as {
          dependencies?: Record<string, string>;
        };
        pkg.dependencies = pkg.dependencies || {};
        if (!pkg.dependencies[portPkgName]) {
          pkg.dependencies[portPkgName] = "workspace:*";
        }
        return `${JSON.stringify(pkg, null, 2)}\n`;
      },
    });
  }

  return actions;
}
