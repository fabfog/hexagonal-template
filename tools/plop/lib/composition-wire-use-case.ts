import fs from "node:fs";
import path from "node:path";
import type { Block, ClassDeclaration, ObjectLiteralExpression, SourceFile } from "ts-morph";
import { Node, Scope, StructureKind, SyntaxKind } from "ts-morph";
import {
  parseDependenciesInterface,
  type ParsedDepsInterfaceResult,
} from "./parse-dependencies-interface.ts";
import { createPlopMorphProject } from "./ts-morph-project.ts";
import { readApplicationPackageJsonName } from "./repo-application-packages.ts";
import { toCamelCase, toKebabCase, toPascalCase } from "./casing.ts";
import type { RepoApplicationSliceKind } from "./add-port-to-repo-application-slice.ts";

const morphProject = createPlopMorphProject({ useInMemoryFileSystem: true });

export const ADAPTER_SKIP_VALUE = "__skip__";

export type CompositionPortScope = "app" | "request";

export interface AdapterPick {
  npmName: string;
  className: string;
  /** Relative repo path to adapter package root, e.g. features/foo/infrastructure/driven-clock */
  packageRel: string;
}

export interface PortWiringSelection {
  propName: string;
  typeName: string;
  /** Module specifier as in the use-case file (e.g. `../ports/x` or `@features/...`) */
  portTypeSpecifierFromUseCase: string;
  scope: CompositionPortScope;
  adapter: AdapterPick | typeof ADAPTER_SKIP_VALUE;
}

function useCaseFileAbs(
  repoRoot: string,
  applicationRel: string,
  sliceKind: RepoApplicationSliceKind,
  sliceNamePascal: string
) {
  const kebab = toKebabCase(sliceNamePascal);
  const ext = sliceKind === "interactive-use-case" ? "interactive.use-case" : "use-case";
  return path.join(repoRoot, ...applicationRel.split("/"), "use-cases", `${kebab}.${ext}.ts`);
}

function useCaseClassName(sliceKind: RepoApplicationSliceKind, sliceNamePascal: string) {
  const p = toPascalCase(sliceNamePascal);
  return sliceKind === "interactive-use-case" ? `${p}InteractiveUseCase` : `${p}UseCase`;
}

function isInteractionPortType(typeText: string) {
  return typeText.trim().endsWith("InteractionPort");
}

/**
 * Normal port deps from the use case constructor deps interface (excludes `*InteractionPort`).
 */
export function listNormalPortDepsFromUseCase(
  repoRoot: string,
  applicationRel: string,
  sliceKind: RepoApplicationSliceKind,
  sliceNamePascal: string
): { propName: string; typeName: string; portTypeSpecifierFromUseCase: string }[] {
  const abs = useCaseFileAbs(repoRoot, applicationRel, sliceKind, sliceNamePascal);
  if (!fs.existsSync(abs)) {
    throw new Error(`Use case file not found: ${abs}`);
  }
  const source = fs.readFileSync(abs, "utf8");
  const sf = morphProject.createSourceFile(abs, source, { overwrite: true });
  const className = useCaseClassName(sliceKind, sliceNamePascal);
  const cls = sf.getClasses().find((c) => c.isExported() && c.getName() === className);
  if (!cls) {
    throw new Error(`No exported class "${className}" in ${abs}`);
  }
  const ctor = cls.getConstructors()[0];
  const p0 = ctor?.getParameters()[0];
  const tn = p0?.getTypeNode();
  if (!tn || !Node.isTypeReference(tn)) {
    throw new Error(`Could not read constructor deps type for "${className}"`);
  }
  const typeNameNode = tn.getTypeName();
  const depsInterface = Node.isIdentifier(typeNameNode) ? typeNameNode.getText() : null;
  if (!depsInterface) {
    throw new Error(`Expected TypeReference deps interface name for "${className}"`);
  }
  const parsed: ParsedDepsInterfaceResult = parseDependenciesInterface(source, depsInterface);
  const { properties } = parsed;
  const out: { propName: string; typeName: string; portTypeSpecifierFromUseCase: string }[] = [];
  for (const prop of properties) {
    if (isInteractionPortType(prop.type)) continue;
    const spec = findNamedTypeImportSpecifier(sf, prop.type);
    if (!spec) {
      throw new Error(
        `Could not resolve import for deps property "${prop.name}: ${prop.type}" in ${path.relative(repoRoot, abs)}. Add an explicit import type for this port.`
      );
    }
    out.push({
      propName: prop.name,
      typeName: prop.type.trim(),
      portTypeSpecifierFromUseCase: spec,
    });
  }
  return out;
}

function findNamedTypeImportSpecifier(sf: SourceFile, typeName: string): string | null {
  const base = typeName.replace(/\s+/g, "").split(/[|&]/)[0]?.trim() ?? "";
  const simple = base.replace(/\[\]$/u, "");
  for (const decl of sf.getImportDeclarations()) {
    const spec = decl.getModuleSpecifierValue();
    if (!spec) continue;
    const clauseTypeOnly = decl.isTypeOnly();
    for (const el of decl.getNamedImports()) {
      const name = el.getName();
      const alias = el.getAliasNode()?.getText();
      const typeOnly = clauseTypeOnly || el.isTypeOnly();
      if (!typeOnly) continue;
      if (name === simple || alias === simple) {
        return spec;
      }
    }
  }
  return null;
}

function listInfraPackageRoots(repoRoot: string, featureKebab: string): string[] {
  const roots: string[] = [];
  const shared = path.join(repoRoot, "features", "shared", "infrastructure");
  if (fs.existsSync(shared)) {
    roots.push(shared);
  }
  const feat = path.join(repoRoot, "features", featureKebab, "infrastructure");
  if (fs.existsSync(feat)) {
    roots.push(feat);
  }
  return roots;
}

function walkTsSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "dist") continue;
        walk(p);
      } else if (e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
        out.push(p);
      }
    }
  };
  walk(dir);
  return out;
}

/**
 * Classes under feature + shared infrastructure that `implements` the given port interface name.
 */
export function findAdapterImplementations(
  repoRoot: string,
  featureKebab: string,
  portInterfaceName: string
): AdapterPick[] {
  const roots = listInfraPackageRoots(repoRoot, featureKebab);
  const out: AdapterPick[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgRoot = path.join(root, entry.name);
      const pkgJson = path.join(pkgRoot, "package.json");
      if (!fs.existsSync(pkgJson)) continue;
      let npmName = "";
      try {
        npmName = readApplicationPackageJsonName(repoRoot, path.relative(repoRoot, pkgRoot));
      } catch {
        continue;
      }
      for (const file of walkTsSourceFiles(pkgRoot)) {
        const text = fs.readFileSync(file, "utf8");
        const re = /export\s+class\s+(\w+)\s+implements\s+([^{]+)\{/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          const className = m[1]!;
          const implementsClause = m[2]!
            .split(/[,\n]/)
            .map((s) => s.trim())
            .filter(Boolean);
          if (
            !implementsClause.some(
              (t) => t === portInterfaceName || t.endsWith(`.${portInterfaceName}`)
            )
          ) {
            continue;
          }
          const key = `${npmName}#${className}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const pkgRel = path.relative(repoRoot, pkgRoot).split(path.sep).join("/");
          out.push({ npmName, className, packageRel: pkgRel });
        }
      }
    }
  }
  out.sort((a, b) => `${a.npmName}.${a.className}`.localeCompare(`${b.npmName}.${b.className}`));
  return out;
}

function importSpecifierFromCompositionTo(
  compositionSrcDir: string,
  targetAbsFile: string
): string {
  let rel = path.relative(compositionSrcDir, targetAbsFile).split(path.sep).join("/");
  if (!rel.startsWith(".")) {
    rel = `./${rel}`;
  }
  return rel.replace(/\.tsx?$/i, ".js");
}

function ensureValueImport(sf: SourceFile, moduleSpecifier: string, named: string) {
  for (const decl of sf.getImportDeclarations()) {
    if (decl.getModuleSpecifierValue() !== moduleSpecifier) continue;
    if (decl.getNamedImports().some((n) => n.getName() === named && !n.isTypeOnly())) {
      return;
    }
  }
  sf.addImportDeclaration({
    moduleSpecifier,
    namedImports: [{ name: named }],
  });
}

function findInfrastructureProviderClass(sf: SourceFile): ClassDeclaration | undefined {
  return sf.getClasses().find((c) => (c.getName() ?? "").endsWith("InfrastructureProvider"));
}

/** Re-resolve after `ensureValueImport` — those mutations forget prior node handles. */
function resolveInfrastructureWiringContext(sf: SourceFile) {
  const providerClass = findInfrastructureProviderClass(sf);
  if (!providerClass) {
    throw new Error("No *InfrastructureProvider class found in composition index.ts.");
  }
  const getForContextMethod = providerClass.getMethodOrThrow("getForContext");
  const getForCtxBody = getForContextMethod.getBodyOrThrow();
  if (!Node.isBlock(getForCtxBody)) {
    throw new Error("Expected getForContext to use a block body with `return { ... }`.");
  }
  const returnObj = getReturnObjectFromBlock(getForCtxBody);
  const getCtxParam = getForContextMethod.getParameters()[0]?.getName() ?? "ctx";
  return { providerClass, getForContextMethod, returnObj, getCtxParam };
}

function findGetUseCasesFunction(sf: SourceFile) {
  const candidates = sf
    .getFunctions()
    .filter((f) => f.isExported() && f.getName()?.startsWith("get"))
    .filter((f) => {
      const p0 = f.getParameters()[0];
      const t = p0?.getTypeNode()?.getText() ?? "";
      return t.includes("RequestContext");
    });
  if (candidates.length === 0) {
    return undefined;
  }
  const prefer = candidates.find((f) => (f.getName() ?? "").includes("UseCases"));
  return prefer ?? candidates[0];
}

function getReturnObjectFromBlock(block: Block): ObjectLiteralExpression {
  const ret = block.getStatementByKind(SyntaxKind.ReturnStatement);
  if (!ret || !Node.isReturnStatement(ret)) {
    throw new Error("Expected a return statement.");
  }
  const exp = ret.getExpression();
  if (!exp || !Node.isObjectLiteralExpression(exp)) {
    throw new Error("Expected `return { ... }` with an object literal.");
  }
  return exp;
}

/**
 * Property names already returned from `*InfrastructureProvider#getForContext` (idempotent wiring).
 */
export function readInfrastructureGetForContextReturnPropertyNames(
  repoRoot: string,
  compositionPackageRel: string
): Set<string> {
  const indexAbs = path.join(repoRoot, ...compositionPackageRel.split("/"), "index.ts");
  if (!fs.existsSync(indexAbs)) {
    return new Set();
  }
  const indexSource = fs.readFileSync(indexAbs, "utf8");
  const sf = morphProject.createSourceFile(indexAbs, indexSource, { overwrite: true });
  const providerClass = findInfrastructureProviderClass(sf);
  if (!providerClass) {
    return new Set();
  }
  const getForContextMethod = providerClass.getMethod("getForContext");
  const body = getForContextMethod?.getBody();
  if (!body || !Node.isBlock(body)) {
    return new Set();
  }
  try {
    const obj = getReturnObjectFromBlock(body);
    return collectPropertyNamesFromObjectLiteral(obj);
  } catch {
    return new Set();
  }
}

export function simplePortTypeName(typeName: string): string {
  return typeName.replace(/\s+/g, "").split(/[|&]/)[0]!.replace(/\[\]$/u, "");
}

/**
 * Expression typed as `never` (assignable to any port type) that throws at runtime — use instead of
 * `undefined` or type assertions when a port is not wired yet.
 */
function unwiredCompositionPortExpr(portProp: string, portTypeLabel: string): string {
  const message = `FIXME: composition — wire "${portProp}" (${portTypeLabel})`;
  return `((): never => { throw new Error(${JSON.stringify(message)}); })()`;
}

function collectPropertyNamesFromObjectLiteral(obj: ObjectLiteralExpression): Set<string> {
  const names = new Set<string>();
  for (const p of obj.getProperties()) {
    if (Node.isPropertyAssignment(p)) {
      const n = p.getNameNode();
      if (Node.isIdentifier(n) || Node.isStringLiteral(n)) {
        names.add(n.getText().replace(/^['"]|['"]$/gu, ""));
      }
    }
  }
  return names;
}

function resolveAdapterImportForComposition(
  compositionSrcDir: string,
  adapterPkgRootAbs: string,
  entryFile = "index.ts"
): string {
  const target = path.join(adapterPkgRootAbs, entryFile);
  if (fs.existsSync(target)) {
    return importSpecifierFromCompositionTo(compositionSrcDir, target);
  }
  const walk = walkTsSourceFiles(adapterPkgRootAbs);
  const withClass = walk.find((f) => /export\s+class\s+\w+/u.test(fs.readFileSync(f, "utf8")));
  return importSpecifierFromCompositionTo(
    compositionSrcDir,
    withClass ?? path.join(adapterPkgRootAbs, "index.ts")
  );
}

function ensureCompositionDependency(
  repoRoot: string,
  compositionPkgAbs: string,
  depNpmName: string
) {
  const pkgPath = path.join(compositionPkgAbs, "package.json");
  const raw = fs.readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw) as { dependencies?: Record<string, string> };
  pkg.dependencies = pkg.dependencies || {};
  if (!pkg.dependencies[depNpmName]) {
    pkg.dependencies[depNpmName] = "workspace:*";
  }
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

function privateGetterNameForRequestPort(propName: string, existing: Set<string>) {
  const base = `get${toPascalCase(propName)}`;
  let name = base;
  let i = 0;
  while (existing.has(name)) {
    i += 1;
    name = `${base}${i}`;
  }
  return name;
}

/**
 * Apply wiring selections to the composition `index.ts` (ts-morph) and update `package.json` deps.
 */
export function applyCompositionWireUseCase(opts: {
  repoRoot: string;
  compositionPackageRel: string;
  applicationPackageRel: string;
  sliceKind: RepoApplicationSliceKind;
  sliceNamePascal: string;
  wirings: PortWiringSelection[];
}): void {
  const {
    repoRoot,
    compositionPackageRel,
    applicationPackageRel,
    sliceKind,
    sliceNamePascal,
    wirings,
  } = opts;
  const indexAbs = path.join(repoRoot, ...compositionPackageRel.split("/"), "index.ts");
  if (!fs.existsSync(indexAbs)) {
    throw new Error(`Composition index not found: ${indexAbs}`);
  }
  const compositionPkgAbs = path.join(repoRoot, ...compositionPackageRel.split("/"));
  const compositionSrcDir = path.dirname(indexAbs);

  const useCaseAbs = useCaseFileAbs(repoRoot, applicationPackageRel, sliceKind, sliceNamePascal);

  const indexSource = fs.readFileSync(indexAbs, "utf8");
  const sf = morphProject.createSourceFile(indexAbs, indexSource, { overwrite: true });

  const useCaseClass = useCaseClassName(sliceKind, sliceNamePascal);
  const useCaseImportSpec = importSpecifierFromCompositionTo(compositionSrcDir, useCaseAbs);
  ensureValueImport(sf, useCaseImportSpec, useCaseClass);

  let { providerClass, getForContextMethod, returnObj, getCtxParam } =
    resolveInfrastructureWiringContext(sf);
  const existingReturnKeys = new Set(collectPropertyNamesFromObjectLiteral(returnObj));

  for (const w of wirings) {
    if (existingReturnKeys.has(w.propName)) {
      continue;
    }

    if (w.adapter !== ADAPTER_SKIP_VALUE) {
      ensureCompositionDependency(repoRoot, compositionPkgAbs, w.adapter.npmName);
      const adapterPkgAbs = path.join(repoRoot, ...w.adapter.packageRel.split("/"));
      const adapterSpec = resolveAdapterImportForComposition(compositionSrcDir, adapterPkgAbs);
      ensureValueImport(sf, adapterSpec, w.adapter.className);
    }
  }

  ({ providerClass, getForContextMethod, returnObj, getCtxParam } =
    resolveInfrastructureWiringContext(sf));

  for (const w of wirings) {
    if (existingReturnKeys.has(w.propName)) {
      continue;
    }

    ({ providerClass, getForContextMethod, returnObj, getCtxParam } =
      resolveInfrastructureWiringContext(sf));
    const existingPrivateMethodNames = new Set(
      providerClass
        .getMethods()
        .map((m) => m.getName())
        .filter(Boolean) as string[]
    );

    if (w.scope === "app" && w.adapter !== ADAPTER_SKIP_VALUE) {
      providerClass.addProperty({
        name: w.propName,
        type: w.typeName,
        scope: Scope.Private,
        isReadonly: true,
        initializer: `new ${w.adapter.className}()`,
      });
      returnObj.addPropertyAssignment({
        name: w.propName,
        initializer: `this.${w.propName}`,
      });
    } else if (w.scope === "app" && w.adapter === ADAPTER_SKIP_VALUE) {
      returnObj.addPropertyAssignment({
        name: w.propName,
        initializer: unwiredCompositionPortExpr(w.propName, simplePortTypeName(w.typeName)),
      });
    } else if (w.scope === "request" && w.adapter !== ADAPTER_SKIP_VALUE) {
      const methodName = privateGetterNameForRequestPort(w.propName, existingPrivateMethodNames);
      existingPrivateMethodNames.add(methodName);
      const insertBefore = providerClass.getMembers().indexOf(getForContextMethod);
      if (insertBefore < 0) {
        throw new Error("Could not locate getForContext on the infrastructure provider class.");
      }
      providerClass.insertMember(insertBefore, {
        kind: StructureKind.Method,
        name: methodName,
        parameters: [{ name: getCtxParam, type: "RequestContext" }],
        returnType: w.typeName,
        statements: [`return new ${w.adapter.className}();`],
      });
      returnObj.addPropertyAssignment({
        name: w.propName,
        initializer: `this.${methodName}(${getCtxParam})`,
      });
    } else {
      returnObj.addPropertyAssignment({
        name: w.propName,
        initializer: unwiredCompositionPortExpr(w.propName, simplePortTypeName(w.typeName)),
      });
    }
    existingReturnKeys.add(w.propName);
  }

  const allNormalDeps = listNormalPortDepsFromUseCase(
    repoRoot,
    applicationPackageRel,
    sliceKind,
    sliceNamePascal
  );

  ({ returnObj } = resolveInfrastructureWiringContext(sf));
  const returnKeysAfter = new Set(collectPropertyNamesFromObjectLiteral(returnObj));
  for (const d of allNormalDeps) {
    if (!returnKeysAfter.has(d.propName)) {
      returnObj.addPropertyAssignment({
        name: d.propName,
        initializer: unwiredCompositionPortExpr(d.propName, simplePortTypeName(d.typeName)),
      });
      returnKeysAfter.add(d.propName);
    }
  }

  const hubFn = findGetUseCasesFunction(sf);
  if (!hubFn) {
    throw new Error(
      `No exported get*(ctx: RequestContext) function found in ${path.relative(repoRoot, indexAbs)}. Add get…UseCases(ctx) per the scaffold.`
    );
  }
  const hubBodyRaw = hubFn.getBody();
  if (!Node.isBlock(hubBodyRaw)) {
    throw new Error(`Expected ${hubFn.getName()} to use a block body (brace form).`);
  }
  const hubBody = hubBodyRaw;
  const hubRet = hubBody.getStatementByKind(SyntaxKind.ReturnStatement);
  if (!hubRet || !Node.isReturnStatement(hubRet)) {
    throw new Error(`Expected return in ${hubFn.getName()}`);
  }
  const hubObj = hubRet.getExpression();
  if (!hubObj || !Node.isObjectLiteralExpression(hubObj)) {
    throw new Error(`Expected ${hubFn.getName()} to return an object literal`);
  }

  const useCaseFactoryKey = toCamelCase(sliceNamePascal);
  const infraVarName =
    hubBody
      .getVariableDeclarations()
      .find((v) => {
        const init = v.getInitializer()?.getText() ?? "";
        return init.includes("getForContext");
      })
      ?.getName() ?? "infrastructure";

  const depLines = allNormalDeps.map((d) => {
    if (returnKeysAfter.has(d.propName)) {
      return `      ${d.propName}: ${infraVarName}.${d.propName},`;
    }
    return `      ${d.propName}: ${unwiredCompositionPortExpr(d.propName, simplePortTypeName(d.typeName))},`;
  });
  const inner = `{\n${depLines.join("\n")}\n    }`;
  const factoryExpr = `() => new ${useCaseClass}(${inner})`;

  const existingProp = hubObj.getProperty(useCaseFactoryKey);
  if (existingProp && Node.isPropertyAssignment(existingProp)) {
    existingProp.setInitializer(factoryExpr);
  } else {
    hubObj.addPropertyAssignment({
      name: useCaseFactoryKey,
      initializer: factoryExpr,
    });
  }

  fs.writeFileSync(indexAbs, `${sf.getFullText().replace(/\s+$/, "")}\n`, "utf8");
}
