import type { InterfaceDeclaration, SourceFile } from "ts-morph";
import { createPlopMorphProject } from "./ts-morph-project.ts";

const morphProject = createPlopMorphProject({ useInMemoryFileSystem: true });

function getInterfaceDeclarationOrThrow(
  sf: SourceFile,
  interfaceName: string
): InterfaceDeclaration {
  const matches = sf.getInterfaces().filter((decl) => decl.getName() === interfaceName);
  if (matches.length === 0) {
    throw new Error(`Could not find interface "${interfaceName}" in file.`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple interfaces named "${interfaceName}" in file; expected a single declaration.`
    );
  }
  return matches[0]!;
}

function getInterfaceCloseBraceIndex(source: string, intf: InterfaceDeclaration) {
  const closeIdx = source.lastIndexOf("}", intf.getEnd());
  if (closeIdx === -1) {
    throw new Error(`Could not find closing "}" for interface "${intf.getName()}".`);
  }
  return closeIdx;
}

function inferIndentFromInterface(source: string, intf: InterfaceDeclaration) {
  for (const member of intf.getProperties()) {
    const nameStart = member.getNameNode().getStart();
    let lineStart = nameStart;
    while (lineStart > 0 && source[lineStart - 1] !== "\n") {
      lineStart--;
    }
    const prefix = source.slice(lineStart, nameStart);
    if (/^\s*$/.test(prefix)) {
      return prefix;
    }
  }
  return "  ";
}

export interface ParsedDepsInterfaceResult {
  body: string;
  closeIdx: number;
  properties: { name: string; type: string }[];
  indent: string;
}

/**
 * Parse `export interface <interfaceName> { ... }` via TypeScript AST.
 * Returns property names and full type text, plus `closeIdx` for inserting before the closing `}`.
 */
export function parseDependenciesInterface(
  source: string,
  interfaceName: string
): ParsedDepsInterfaceResult {
  const sf = morphProject.createSourceFile("slice-deps.ts", source, { overwrite: true });
  const intf = getInterfaceDeclarationOrThrow(sf, interfaceName);
  const properties: { name: string; type: string }[] = [];
  for (const member of intf.getProperties()) {
    const typeNode = member.getTypeNode();
    if (!typeNode) continue;
    properties.push({
      name: member.getName(),
      type: typeNode.getText().trim(),
    });
  }
  const closeIdx = getInterfaceCloseBraceIndex(source, intf);
  const indent = inferIndentFromInterface(source, intf);
  const body = source.slice(intf.getStart(), closeIdx);
  return { body, closeIdx, properties, indent };
}

export function insertAfterLastImport(src: string, importLine: string): string {
  const lines = src.split("\n");
  let lastImport = -1;
  for (let j = 0; j < lines.length; j++) {
    const line = lines[j];
    if (line !== undefined && /^\s*import\s+/.test(line)) lastImport = j;
  }
  if (lastImport >= 0) {
    lines.splice(lastImport + 1, 0, importLine, "");
  } else {
    lines.unshift(importLine, "");
  }
  return lines.join("\n");
}
