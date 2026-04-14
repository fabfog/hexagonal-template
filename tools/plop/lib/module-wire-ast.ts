import fs from "node:fs";
import type { ClassDeclaration, SourceFile } from "ts-morph";
import { Node, SyntaxKind } from "ts-morph";
import { toKebabCase, toCamelCase } from "./casing.ts";
import { createPlopMorphProject } from "./ts-morph-project.ts";

const morphProject = createPlopMorphProject({ useInMemoryFileSystem: true });

/** Property types that are a single identifier (e.g. `ClockPort`) — used to pull `import type` from wired files. */
const SINGLE_IDENTIFIER_TYPE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/**
 * Flow deps satisfied by an app-scoped "interaction" handle (store, UI bridge, etc.) — not on module Infra.
 * Heuristic: property name `interactionPort` or a single-identifier type ending with `InteractionPort`.
 * @param {{ name: string, typeText: string }} dep
 */
function isFlowInteractionDep(dep: { name: string; typeText: string }) {
  const t = dep.typeText.trim();
  if (dep.name === "interactionPort") return true;
  if (SINGLE_IDENTIFIER_TYPE.test(t) && t.endsWith("InteractionPort")) return true;
  return false;
}
/**
 * Type names to import for module file (Infra props + flow getter parameters).
 * @param {ReturnType<typeof extractWireSpec>} spec
 * @returns {string[]}
 */
function typeIdentifiersNeededForSpec(spec: ReturnType<typeof extractWireSpec>) {
  const ids: string[] = [];
  if (spec.kind === "flow") {
    for (const dep of spec.deps) {
      if (!isFlowInteractionDep(dep)) continue;
      const t = dep.typeText.trim();
      if (SINGLE_IDENTIFIER_TYPE.test(t)) ids.push(t);
    }
  }
  return ids;
}
function findExportedClassDeclaration(sf: SourceFile, className: string) {
  return sf.getClasses().find((decl) => decl.isExported() && decl.getName() === className);
}
function getConstructorFirstParameterTypeName(classDecl: ClassDeclaration) {
  const ctor = classDecl.getConstructors()[0];
  const p0 = ctor?.getParameters()[0];
  const tn = p0?.getTypeNode();
  if (!tn || !Node.isTypeReference(tn)) return null;
  const typeName = tn.getTypeName();
  if (Node.isIdentifier(typeName)) return typeName.getText();
  return null;
}
function getInterfacePropertySignatures(sf: SourceFile, interfaceName: string) {
  const out: { name: string; typeText: string }[] = [];
  sf.forEachDescendant((node) => {
    if (!Node.isInterfaceDeclaration(node) || node.getName() !== interfaceName) return;
    for (const member of node.getMembers()) {
      if (!Node.isPropertySignature(member)) continue;
      const typeNode = member.getTypeNode();
      if (!typeNode) continue;
      out.push({
        name: member.getName(),
        typeText: typeNode.getText().trim(),
      });
    }
  });
  return out;
}
/**
 * @param {string} absPath
 * @param {"use-case" | "flow"} kind
 * @param {string} pascalBase e.g. `UpdateTitle` for `UpdateTitleUseCase`
 */
function extractWireSpec(absPath: string, kind: "use-case" | "flow", pascalBase: string) {
  if (!fs.existsSync(absPath)) {
    throw new Error(`Expected file at ${absPath}`);
  }
  const sourceText = fs.readFileSync(absPath, "utf8");
  const sf = morphProject.createSourceFile(absPath, sourceText, { overwrite: true });
  const suffix = kind === "use-case" ? "UseCase" : "Flow";
  const className = `${pascalBase}${suffix}`;
  const classDecl = findExportedClassDeclaration(sf, className);
  if (!classDecl) {
    throw new Error(`No exported class "${className}" in ${absPath}`);
  }
  const depsInterfaceName = getConstructorFirstParameterTypeName(classDecl);
  if (!depsInterfaceName) {
    throw new Error(
      `Could not read constructor deps type (expected first parameter: TypeReference) for "${className}" in ${absPath}`
    );
  }
  const deps = getInterfacePropertySignatures(sf, depsInterfaceName);
  const kebab = toKebabCase(pascalBase);
  const relImport =
    kind === "use-case" ? `../use-cases/${kebab}.use-case` : `../flows/${kebab}.flow`;
  return {
    kind,
    pascalBase,
    className,
    depsInterfaceName,
    deps,
    relImport,
    fieldName: toCamelCase(pascalBase),
    absPath,
  };
}

type WireSpec = ReturnType<typeof extractWireSpec>;

/**
 * Map local type binding name -> module specifier for type-only (or `import { type X }`) imports.
 * @param {string} absPath
 * @returns {Map<string, { specifier: string, isTypeOnly: boolean }>}
 */
function collectTypeBindingImportsFromFile(absPath: string) {
  const sourceText = fs.readFileSync(absPath, "utf8");
  const sf = morphProject.createSourceFile(absPath, sourceText, { overwrite: true });
  const map = new Map<string, { specifier: string; isTypeOnly: boolean }>();
  for (const decl of sf.getImportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue();
    if (!specifier) continue;
    const named = decl.getNamedImports();
    if (named.length === 0) continue;
    const clauseTypeOnly = decl.isTypeOnly();
    for (const el of named) {
      const bindingName = el.getName();
      const typeOnly = clauseTypeOnly || el.isTypeOnly();
      if (!typeOnly) continue;
      const prev = map.get(bindingName);
      if (prev && prev.specifier !== specifier) {
        throw new Error(
          `Type "${bindingName}" is imported from conflicting modules in ${absPath} (${prev.specifier} vs ${specifier}).`
        );
      }
      map.set(bindingName, { specifier, isTypeOnly: true });
    }
  }
  return map;
}
/**
 * @param {string[]} absPaths
 */
function mergeTypeBindingImportMaps(absPaths: string[]) {
  const merged = new Map<string, { specifier: string; isTypeOnly: boolean }>();
  for (const p of absPaths) {
    const m = collectTypeBindingImportsFromFile(p);
    for (const [name, v] of m) {
      const prev = merged.get(name);
      if (prev && prev.specifier !== v.specifier) {
        throw new Error(
          `Type "${name}" is imported from conflicting modules across wired slices (${prev.specifier} vs ${v.specifier}).`
        );
      }
      merged.set(name, v);
    }
  }
  return merged;
}
/**
 * @param {{ name: string, typeText: string }[]} infraProps
 * @returns {string[]}
 */
function listInfraTypeIdentifiers(infraProps: { name: string; typeText: string }[]) {
  const ids = new Set<string>();
  for (const { typeText } of infraProps) {
    const t = typeText.trim();
    if (SINGLE_IDENTIFIER_TYPE.test(t)) ids.add(t);
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}
/**
 * @param {Map<string, { specifier: string, isTypeOnly: boolean }>} bindingToSpec
 * @param {string[]} neededIdentifiers
 * @returns {string[]}
 */
function formatTypeImportLines(
  bindingToSpec: Map<string, { specifier: string; isTypeOnly: boolean }>,
  neededIdentifiers: string[]
) {
  const bySpecifier = new Map<string, string[]>();
  for (const id of neededIdentifiers) {
    const hit = bindingToSpec.get(id);
    if (!hit) {
      throw new Error(
        `Could not find \`import type { ${id} }\` (or \`import { type ${id} }\`) in any wired use-case/flow file. Add it so the module Infra interface can reference ${id}.`
      );
    }
    const list = bySpecifier.get(hit.specifier) || [];
    list.push(id);
    bySpecifier.set(hit.specifier, list);
  }
  return [...bySpecifier.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([spec, names]) => {
      const sorted = [...new Set(names)].sort((a, b) => a.localeCompare(b));
      return `import type { ${sorted.join(", ")} } from "${spec}";`;
    });
}
function mergeInfraProperties(specs: WireSpec[]) {
  const map = new Map<string, string>();
  for (const spec of specs) {
    for (const { name, typeText } of spec.deps) {
      if (spec.kind === "flow" && isFlowInteractionDep({ name, typeText })) {
        continue;
      }
      const prev = map.get(name);
      if (prev !== undefined && prev !== typeText) {
        throw new Error(
          `Conflicting infra property "${name}": types differ (${prev} vs ${typeText}). Align dependency interfaces or wire manually.`
        );
      }
      map.set(name, typeText);
    }
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, typeText]) => ({ name, typeText }));
}
/**
 * @param {ReturnType<typeof extractWireSpec>} spec
 */
function emitSliceGetter(spec: WireSpec) {
  if (spec.kind === "use-case") {
    const inner =
      spec.deps.length === 0
        ? "{}"
        : `{\n${spec.deps.map((d) => `      ${d.name}: this.infra.${d.name},`).join("\n")}\n    }`;
    return `  public ${spec.fieldName}(): ${spec.className} {
    return new ${spec.className}(${inner});
  }`;
  }
  const interaction = spec.deps.filter(isFlowInteractionDep);
  const params = interaction.map((d) => `${d.name}: ${d.typeText}`).join(", ");
  const objLines =
    spec.deps.length === 0
      ? ""
      : spec.deps
          .map((d) =>
            isFlowInteractionDep(d) ? `      ${d.name},` : `      ${d.name}: this.infra.${d.name},`
          )
          .join("\n");
  const arg = spec.deps.length === 0 ? "{}" : `{\n${objLines}\n    }`;
  return `  public ${spec.fieldName}(${params}): ${spec.className} {
    return new ${spec.className}(${arg});
  }`;
}
/**
 * @param {{ modulePascal: string, specs: ReturnType<typeof extractWireSpec>[] }} opts
 */
function buildWiredModuleSource(opts: { modulePascal: string; specs: WireSpec[] }) {
  const { modulePascal, specs } = opts;
  const infraName = `${modulePascal}Infra`;
  const className = `${modulePascal}Module`;
  const infraProps = mergeInfraProperties(specs);
  const bindingMap = mergeTypeBindingImportMaps(specs.map((s) => s.absPath));
  const infraTypeIds = listInfraTypeIdentifiers(infraProps);
  const interactionTypeIds: string[] = specs.flatMap((s) => typeIdentifiersNeededForSpec(s));
  const allTypeIds: string[] = [...new Set<string>([...infraTypeIds, ...interactionTypeIds])].sort(
    (a, b) => a.localeCompare(b)
  );
  const typeImportLines = formatTypeImportLines(bindingMap, allTypeIds);
  const classImportLines = [...specs]
    .sort((a: WireSpec, b: WireSpec) => a.className.localeCompare(b.className))
    .map((s: WireSpec) => `import { ${s.className} } from "${s.relImport}";`);
  const importLines = [...typeImportLines, ...classImportLines];
  const infraBody =
    infraProps.length === 0
      ? ""
      : `\n${infraProps.map((p) => `  ${p.name}: ${p.typeText};`).join("\n")}\n`;
  const getterMethods = [...specs]
    .sort((a: WireSpec, b: WireSpec) => a.fieldName.localeCompare(b.fieldName))
    .map((s: WireSpec) => emitSliceGetter(s));
  return `${importLines.join("\n")}

export interface ${infraName} {${infraBody}}

export class ${className} {
  constructor(private readonly infra: ${infraName}) {}

  ${getterMethods.join("\n\n")}
}
`;
}
/**
 * @param {string} modulePascal
 */
function buildEmptyModuleSource(modulePascal: string) {
  const infraName = `${modulePascal}Infra`;
  const className = `${modulePascal}Module`;
  return `export interface ${infraName} {
  // Define infrastructure port dependencies that this module's use-cases and flows need to receive
  // from the composition root (semantic adapters implementing application ports).
  // Flow "interaction" deps are passed into get<Flow>() at call site, not listed here.
}

export class ${className} {
  constructor(private readonly infra: ${infraName}) {}

  // Use-cases: add public camelCaseName() methods that return new XxxUseCase({ ...this.infra }).
  // Flows: add public camelCaseName(interactionPort, ...) that return new XxxFlow({ ... }).
}
`;
}
/**
 * @param {string} text
 * @param {number} openBraceIdx index of `{` to match
 */
function indexOfMatchingBrace(text: string, openBraceIdx: number) {
  let depth = 0;
  for (let i = openBraceIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
function findExportedModuleClass(sf: SourceFile) {
  return sf
    .getClasses()
    .find((decl) => decl.isExported() && (decl.getName() ?? "").endsWith("Module"));
}
function findExportedInterfaceDeclaration(sf: SourceFile, name: string) {
  return sf.getInterfaces().find((decl) => decl.isExported() && decl.getName() === name);
}
function collectSliceClassNamesFromMethodBodies(cls: ClassDeclaration) {
  const out = new Set<string>();
  for (const m of cls.getMembers()) {
    if (!Node.isMethodDeclaration(m)) continue;
    const body = m.getBody();
    if (!body) continue;
    body.forEachDescendant((node) => {
      if (!Node.isNewExpression(node)) return;
      const expr = node.getExpression();
      if (!Node.isIdentifier(expr)) return;
      const tn = expr.getText();
      if (tn.endsWith("UseCase") || tn.endsWith("Flow")) {
        out.add(tn);
      }
    });
  }
  return out;
}
/**
 * Class names of already-wired use-cases / flows (getter bodies or `public readonly x: FooUseCase` fields).
 * @param {string} absPath
 * @returns {Set<string>}
 */
function getWiredSliceClassNamesFromModule(absPath: string) {
  if (!fs.existsSync(absPath)) {
    return new Set();
  }
  const text = fs.readFileSync(absPath, "utf8");
  const sf = morphProject.createSourceFile(absPath, text, { overwrite: true });
  const cls = findExportedModuleClass(sf);
  if (!cls) {
    return new Set();
  }
  const out = collectSliceClassNamesFromMethodBodies(cls);
  for (const m of cls.getMembers()) {
    if (!Node.isPropertyDeclaration(m)) continue;
    if (!m.hasModifier(SyntaxKind.PublicKeyword)) continue;
    if (!m.hasModifier(SyntaxKind.ReadonlyKeyword)) continue;
    const typeNode = m.getTypeNode();
    if (!typeNode || !Node.isTypeReference(typeNode)) continue;
    const typeName = typeNode.getTypeName();
    if (!Node.isIdentifier(typeName)) continue;
    const tn = typeName.getText();
    if (tn.endsWith("UseCase") || tn.endsWith("Flow")) {
      out.add(tn);
    }
  }
  return out;
}
function moduleUsesPublicSliceFields(cls: ClassDeclaration) {
  for (const m of cls.getMembers()) {
    if (!Node.isPropertyDeclaration(m)) continue;
    if (!m.hasModifier(SyntaxKind.PublicKeyword)) continue;
    if (!m.hasModifier(SyntaxKind.ReadonlyKeyword)) continue;
    const typeNode = m.getTypeNode();
    if (!typeNode || !Node.isTypeReference(typeNode)) continue;
    const typeName = typeNode.getTypeName();
    if (!Node.isIdentifier(typeName)) continue;
    const tn = typeName.getText();
    if (tn.endsWith("UseCase") || tn.endsWith("Flow")) {
      return true;
    }
  }
  return false;
}
function collectAllImportedBindingNames(sf: SourceFile) {
  const names = new Set<string>();
  for (const decl of sf.getImportDeclarations()) {
    for (const el of decl.getNamedImports()) {
      names.add(el.getName());
    }
  }
  return names;
}
/**
 * @param {string} line
 * @returns {string[]}
 */
function extractBindingsFromImportLine(line: string) {
  const trimmed = line.trim();
  const typeMatch = trimmed.match(/^import\s+type\s*\{([^}]*)\}\s*from\s*["'][^"']+["']\s*;?$/);
  const valMatch = trimmed.match(/^import\s+\{([^}]*)\}\s*from\s*["'][^"']+["']\s*;?$/);
  const raw = typeMatch ? typeMatch[1] : valMatch ? valMatch[1] : null;
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((s: string) => {
      const part = s
        .trim()
        .replace(/^\s*type\s+/, "")
        .split(/\s+as\s+/)[0];
      return (part ?? "").trim();
    })
    .filter(Boolean);
}
function lastImportEndIndex(sf: SourceFile) {
  const imports = sf.getImportDeclarations();
  return imports.length > 0 ? imports[imports.length - 1]!.getEnd() : 0;
}
/**
 * @param {string} text
 * @param {string[]} lines
 */
function appendImportsIfMissing(text: string, lines: string[]) {
  if (!lines.length) {
    return text;
  }
  const sf = morphProject.createSourceFile("_module.ts", text, { overwrite: true });
  const names = collectAllImportedBindingNames(sf);
  const toAdd: string[] = [];
  for (const line of lines) {
    const bindings = extractBindingsFromImportLine(line);
    if (!bindings.length) {
      continue;
    }
    if (bindings.some((b) => !names.has(b))) {
      toAdd.push(line);
      bindings.forEach((b) => names.add(b));
    }
  }
  if (!toAdd.length) {
    return text;
  }
  const end = lastImportEndIndex(sf);
  const prefix = end > 0 ? "\n" : "";
  let block = prefix + toAdd.join("\n");
  if (!block.endsWith("\n")) {
    block += "\n";
  }
  const afterImports = text.slice(end);
  let rest = afterImports.replace(/^\n+/, "");
  if (rest.length > 0) {
    rest = /^export\s/.test(rest) ? `\n\n${rest}` : `\n${rest}`;
  }
  return text.slice(0, end) + block + rest;
}
function appendInfraProperties(
  text: string,
  sf: SourceFile,
  ifaceName: string,
  newProps: { name: string; typeText: string }[]
) {
  if (!newProps.length) {
    return text;
  }
  const iface = findExportedInterfaceDeclaration(sf, ifaceName);
  if (!iface) {
    throw new Error(`Could not find export interface ${ifaceName} in module file.`);
  }
  const block = newProps.map((p) => `  ${p.name}: ${p.typeText};`).join("\n");
  const props = iface.getMembers().filter(Node.isPropertySignature);
  if (props.length === 0) {
    const openBrace = text.indexOf("{", iface.getNameNode().getEnd());
    if (openBrace === -1) {
      throw new Error(`Could not find opening "{" for ${ifaceName}.`);
    }
    const closeBrace = indexOfMatchingBrace(text, openBrace);
    if (closeBrace === -1) {
      throw new Error(`Could not find closing "}" for ${ifaceName}.`);
    }
    return text.slice(0, openBrace + 1) + `\n${block}\n` + text.slice(closeBrace);
  }
  const last = props[props.length - 1]!;
  const pos = last.getEnd();
  return text.slice(0, pos) + `\n${block}` + text.slice(pos);
}
/**
 * Append new slice getters immediately before the class closing `}` (after constructor and any existing members).
 * @param {string} text
 * @param {SourceFile} sf
 * @param {string} modulePascal
 * @param {ReturnType<typeof extractWireSpec>[]} toWire
 */
function appendModuleGetterMethodsBeforeClassClose(
  text: string,
  sf: SourceFile,
  modulePascal: string,
  toWire: WireSpec[]
) {
  const className = `${modulePascal}Module`;
  const cls = findExportedClassDeclaration(sf, className);
  if (!cls) {
    throw new Error(`Could not find export class ${className} in module file.`);
  }
  const getters = [...toWire]
    .sort((a: WireSpec, b: WireSpec) => a.fieldName.localeCompare(b.fieldName))
    .map((s: WireSpec) => emitSliceGetter(s))
    .join("\n\n");
  for (const child of cls.getChildren()) {
    if (child.getKind() === SyntaxKind.CloseBraceToken) {
      const closeStart = child.getStart();
      return `${text.slice(0, closeStart)}\n${getters}\n${text.slice(closeStart)}`;
    }
  }
  throw new Error(`Could not find closing "}" for ${className}.`);
}
/**
 * Promote `constructor(infra: InfraName)` to `constructor(private readonly infra: InfraName)` when needed.
 * @param {string} text
 * @param {SourceFile} sf
 * @param {string} modulePascal
 * @param {string} infraName
 */
function ensureConstructorPrivateReadonlyInfra(
  text: string,
  sf: SourceFile,
  modulePascal: string,
  infraName: string
) {
  const className = `${modulePascal}Module`;
  const cls = findExportedClassDeclaration(sf, className);
  const ctor = cls?.getConstructors()[0];
  if (!ctor) {
    return text;
  }
  const params = ctor.getParameters();
  if (params.length === 0) {
    return text;
  }
  const p = params[0]!;
  if (p.getName() !== "infra") {
    return text;
  }
  const hasPrivate = p.hasModifier(SyntaxKind.PrivateKeyword);
  if (hasPrivate) {
    return text;
  }
  const typeStr = p.getTypeNode()?.getText() ?? infraName;
  const start = p.getStart();
  const end = p.getEnd();
  return `${text.slice(0, start)}private readonly infra: ${typeStr}${text.slice(end)}`;
}
/**
 * Progressive wiring: add imports, Infra props, getter methods (before class `}`), promote constructor param.
 * @param {string} absPath
 * @param {ReturnType<typeof extractWireSpec>[]} newSpecs
 */
function wireAdditionalSlicesIntoModuleFile(absPath: string, newSpecs: WireSpec[]) {
  if (!newSpecs.length) {
    throw new Error("No use-cases or flows selected to wire.");
  }
  let text = fs.readFileSync(absPath, "utf8");
  const sf0 = morphProject.createSourceFile(absPath, text, { overwrite: true });
  const moduleClass0 = findExportedModuleClass(sf0);
  if (!moduleClass0?.getName()) {
    throw new Error(`No exported *Module class found in ${absPath}`);
  }
  if (moduleUsesPublicSliceFields(moduleClass0)) {
    throw new Error(
      `Module ${absPath} uses public readonly use-case/flow fields. Use camelCase slice methods before running application-wire-module.`
    );
  }
  const modulePascal = moduleClass0.getName()!.replace(/Module$/, "");
  const infraName = `${modulePascal}Infra`;
  const wired = getWiredSliceClassNamesFromModule(absPath);
  const toWire = newSpecs.filter((s) => !wired.has(s.className));
  if (!toWire.length) {
    throw new Error(
      "Selected slices are already wired in this module (same use-case/flow classes)."
    );
  }
  const existingInfraProps = getInterfacePropertySignatures(sf0, infraName);
  const existingInfra: Record<string, string> = Object.fromEntries(
    existingInfraProps.map((p) => [p.name, p.typeText])
  );
  const newInfraMerged = mergeInfraProperties(toWire);
  for (const { name, typeText } of newInfraMerged) {
    if (existingInfra[name] !== undefined && existingInfra[name] !== typeText) {
      throw new Error(
        `Infra property "${name}" already exists with type "${existingInfra[name]}"; cannot add conflicting "${typeText}".`
      );
    }
  }
  const newInfraOnly = newInfraMerged.filter((p) => existingInfra[p.name] === undefined);
  const bindingMap = mergeTypeBindingImportMaps(toWire.map((s) => s.absPath));
  const newTypeIds: string[] = [
    ...listInfraTypeIdentifiers(newInfraOnly),
    ...toWire.flatMap((s) => typeIdentifiersNeededForSpec(s)),
  ];
  const uniqueNewTypeIds: string[] = [...new Set<string>(newTypeIds)].sort((a, b) =>
    a.localeCompare(b)
  );
  const typeImportLines =
    uniqueNewTypeIds.length === 0 ? [] : formatTypeImportLines(bindingMap, uniqueNewTypeIds);
  const classImportLines = [...toWire]
    .sort((a: WireSpec, b: WireSpec) => a.className.localeCompare(b.className))
    .map((s: WireSpec) => `import { ${s.className} } from "${s.relImport}";`);
  text = appendImportsIfMissing(text, [...typeImportLines, ...classImportLines]);
  let sf = morphProject.createSourceFile(absPath, text, { overwrite: true });
  text = appendInfraProperties(text, sf, infraName, newInfraOnly);
  sf = morphProject.createSourceFile(absPath, text, { overwrite: true });
  text = appendModuleGetterMethodsBeforeClassClose(text, sf, modulePascal, toWire);
  sf = morphProject.createSourceFile(absPath, text, { overwrite: true });
  text = ensureConstructorPrivateReadonlyInfra(text, sf, modulePascal, infraName);
  fs.writeFileSync(absPath, `${text.replace(/\n+$/, "")}\n`, "utf8");
}
export {
  extractWireSpec,
  mergeInfraProperties,
  buildWiredModuleSource,
  buildEmptyModuleSource,
  getWiredSliceClassNamesFromModule,
  wireAdditionalSlicesIntoModuleFile,
  appendImportsIfMissing,
};
