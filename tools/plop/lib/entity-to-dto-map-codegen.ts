import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { ts } from "ts-morph";
import { toKebabCase, toPascalCase } from "./casing.ts";
import { getRepoDomainPackageChoices, readDomainPackageJsonName } from "./repo-domain-packages.ts";
import { createPlopMorphProject, PLOP_MORPH_COMPILER_OPTIONS } from "./ts-morph-project.ts";

const nodeRequire = createRequire(import.meta.url);

export interface MapperCodegenField {
  name: string;
  optional: boolean;
  expectedLiteral: string;
}

interface BuildMapperSourceArgs {
  entityPascal: string;
  entityKebab: string;
  /** Full module id, e.g. `@features/foo-domain/entities`. */
  domainEntitiesModule: string;
}

interface BuildMapperTestField {
  name: string;
  expectedLiteral: string;
}

interface BuildMapperTestSourceArgs {
  entityPascal: string;
  entityKebab: string;
  fields: BuildMapperTestField[];
  importAcc: Map<string, Set<string>>;
  entityConstruction: string;
}

export interface GenerateApplicationEntityMapperSourcesOpts {
  repoRoot: string;
  /** e.g. `features/plop-demo/domain` */
  domainPackageRel: string;
  /** e.g. `@features/plop-demo-domain` */
  domainNpmName: string;
  entityBasePascal: string;
}
/**
 * @param {string} absDir
 * @returns {string[]}
 */
function collectTypeScriptSourceFiles(absDir: string) {
  if (!fs.existsSync(absDir)) {
    return [];
  }
  const out: string[] = [];
  function walk(d: string) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "dist") continue;
        walk(p);
      } else if (e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
        out.push(p);
      }
    }
  }
  walk(absDir);
  return out;
}
/**
 * `paths` + `baseUrl: repoRoot` so the checker resolves hoisted `zod` and workspace `@features/*-domain`
 * imports (Plop often runs before a package-local `node_modules` exists).
 */
function buildCompilerPathsForRepoDomainCodegen(
  repoRoot: string,
  domainPackageDirForZodResolve: string
) {
  const paths: Record<string, string[]> = {};
  for (const c of getRepoDomainPackageChoices(repoRoot)) {
    let npmName: string;
    try {
      npmName = readDomainPackageJsonName(repoRoot, c.value);
    } catch {
      continue;
    }
    const pkgRoot = path.join(repoRoot, ...c.value.split("/"));
    if (!fs.existsSync(pkgRoot)) continue;
    const rel = path.relative(repoRoot, pkgRoot).replace(/\\/g, "/");
    paths[`${npmName}/*`] = [`${rel}/*`];
  }
  try {
    const zodPkg = nodeRequire.resolve("zod/package.json", {
      paths: [domainPackageDirForZodResolve, repoRoot],
    });
    const zodRoot = path.dirname(zodPkg);
    const zrel = path.relative(repoRoot, zodRoot).replace(/\\/g, "/");
    paths.zod = [zrel, `${zrel}/*`];
  } catch {
    const fallback = path.join(repoRoot, "node_modules", "zod");
    if (fs.existsSync(fallback)) {
      const zrel = path.relative(repoRoot, fallback).replace(/\\/g, "/");
      paths.zod = [zrel, `${zrel}/*`];
    }
  }
  return paths;
}
/**
 * @param {ts.ClassDeclaration} classDecl
 * @returns {ts.MethodDeclaration | undefined}
 */
function findSerializeImplementation(classDecl: ts.ClassDeclaration) {
  /** @type {ts.MethodDeclaration | undefined} */
  let withBody;
  for (const member of classDecl.members) {
    if (!ts.isMethodDeclaration(member)) continue;
    const name = member.name;
    if (!ts.isComputedPropertyName(name)) continue;
    const expr = name.expression;
    if (!ts.isIdentifier(expr) || expr.text !== "SERIALIZE") continue;
    if (member.body) withBody = member;
  }
  return withBody;
}
/**
 * @param {ts.SourceFile} sf
 * @param {string} className
 * @returns {ts.ClassDeclaration | undefined}
 */
function findExportedClassDeclaration(sf: ts.SourceFile, className: string) {
  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt) || stmt.name?.text !== className) continue;
    const exported = stmt.modifiers?.some(
      (m: ts.ModifierLike) => m.kind === ts.SyntaxKind.ExportKeyword
    );
    if (exported) return stmt;
  }
  return undefined;
}
/**
 * @param {ts.ClassDeclaration} classDecl
 * @returns {ts.ConstructorDeclaration | undefined}
 */
function findConstructorDeclaration(classDecl: ts.ClassDeclaration) {
  for (const member of classDecl.members) {
    if (ts.isConstructorDeclaration(member)) return member;
  }
  return undefined;
}
/**
 * Type of the first constructor parameter (e.g. `TicketProps` on `constructor(props: TicketProps)`).
 * @param {ts.TypeChecker} checker
 * @param {ts.ClassDeclaration} classDecl
 * @returns {ts.Type | undefined}
 */
function getConstructorFirstParameterType(checker: ts.TypeChecker, classDecl: ts.ClassDeclaration) {
  const ctor = findConstructorDeclaration(classDecl);
  if (!ctor || ctor.parameters.length === 0) return undefined;
  const p0 = ctor.parameters[0];
  if (!p0?.type) return undefined;
  return checker.getTypeFromTypeNode(p0.type);
}
/**
 * @param {string} propName
 */
function defaultStringLiteralForProp(propName: string) {
  const n = String(propName).toLowerCase();
  if (n.includes("email")) return JSON.stringify("stub@example.com");
  if (n === "slug" || n.endsWith("slug")) return JSON.stringify("stub-slug");
  if (n.includes("url") || n.includes("href")) return JSON.stringify("https://example.test/stub");
  return JSON.stringify(`stub-${propName}`);
}
/**
 * @param {string} fieldName e.g. language, country
 */
function defaultStringForNestedObjectField(fieldName: string) {
  const n = fieldName.toLowerCase();
  if (n === "language") return JSON.stringify("en");
  if (n === "country") return JSON.stringify("US");
  return JSON.stringify(`stub-${fieldName}`);
}
/**
 * @param {ts.Symbol} symbol
 * @param {string} repoRoot
 * @returns {string} e.g. `@features/core-domain/value-objects`
 */
function workspaceImportModuleForSymbol(symbol: ts.Symbol, repoRoot: string) {
  const decl = symbol.valueDeclaration ?? symbol.declarations?.[0];
  if (!decl) {
    throw new Error(
      `Codegen: symbol "${symbol.name}" has no declaration for import path resolution.`
    );
  }
  const file = decl.getSourceFile().fileName.replace(/\\/g, "/");
  const normRoot = repoRoot.replace(/\\/g, "/");
  const rel = path.relative(normRoot, file).replace(/\\/g, "/");
  const m = rel.match(/^features\/([^/]+)\/domain\/(entities|value-objects)\//);
  if (!m) {
    throw new Error(
      `Codegen: declare "${symbol.name}" under features/<feature>/domain/entities or value-objects so the mapper test can import it (got "${rel}").`
    );
  }
  const featureSeg = m[1];
  const slice = m[2];
  const pkgRel = `features/${featureSeg}/domain`;
  const npmName = readDomainPackageJsonName(repoRoot, pkgRel);
  return `${npmName}/${slice}`;
}
/**
 * @param {Map<string, Set<string>>} acc
 * @param {string} module
 * @param {string} name
 */
function addImport(acc: Map<string, Set<string>>, module: string, name: string) {
  if (!acc.has(module)) acc.set(module, new Set());
  acc.get(module)!.add(name);
}
/**
 * @param {ts.Type} objType
 * @param {ts.TypeChecker} checker
 */
function buildPlainObjectLiteralForType(objType: ts.Type, checker: ts.TypeChecker) {
  const apparent = checker.getApparentType(objType);
  const props = checker.getPropertiesOfType(apparent);
  if (props.length === 0) {
    return "{}";
  }
  const parts: string[] = [];
  for (const p of props) {
    const n = p.getName();
    if (n.startsWith("__")) continue;
    const optional = (p.getFlags() & ts.SymbolFlags.Optional) !== 0;
    if (optional) continue;
    const pt = checker.getTypeOfSymbol(p);
    if (!pt) continue;
    const ps = checker.typeToString(pt);
    if (ps === "string") {
      parts.push(`${n}: ${defaultStringForNestedObjectField(n)}`);
    } else if (ps === "number") {
      parts.push(`${n}: 7`);
    } else if (ps === "boolean") {
      parts.push(`${n}: true`);
    } else {
      throw new Error(
        `Codegen: unsupported nested property "${n}" type "${ps}" in constructor arg object literal — use primitives or extend entity-to-dto-map-codegen.ts.`
      );
    }
  }
  return `{ ${parts.join(", ")} }`;
}
/**
 * @param {string} propName
 * @param {ts.Type} propType
 * @param {ts.TypeChecker} checker
 * @param {string} repoRoot
 * @param {Map<string, Set<string>>} importAcc
 * @returns {string}
 */
function buildConstructorArgExpression(
  propName: string,
  propType: ts.Type,
  checker: ts.TypeChecker,
  repoRoot: string,
  importAcc: Map<string, Set<string>>
) {
  const t = checker.getApparentType(propType);
  if (t.flags & ts.TypeFlags.Union) {
    const unionTypes = (t as ts.UnionType).types;
    const tryMember = (member: ts.Type) =>
      buildConstructorArgExpression(propName, member, checker, repoRoot, importAcc);
    for (const prim of ["string", "number", "boolean", "bigint"] as const) {
      for (const ut of unionTypes) {
        const app = checker.getApparentType(ut);
        const s = checker.typeToString(app).toLowerCase();
        if (prim === "string" && s === "string") {
          return defaultStringLiteralForProp(propName);
        }
        if (prim === "number" && s === "number") {
          return "42";
        }
        if (prim === "boolean" && s === "boolean") {
          return "true";
        }
        if (prim === "bigint" && s === "bigint") {
          return "9n";
        }
      }
    }
    for (const ut of unionTypes) {
      const app = checker.getApparentType(ut);
      const typeStr = checker.typeToString(app);
      if (typeStr === "Date" || typeStr.includes("Date")) {
        return "new Date('2020-01-01T00:00:00.000Z')";
      }
    }
    for (const ut of unionTypes) {
      try {
        return tryMember(ut);
      } catch {
        /* try next union member */
      }
    }
    throw new Error(
      `Codegen: cannot scaffold constructor arg for property "${propName}" (union "${checker.typeToString(t)}") — extend entity-to-dto-map-codegen.ts.`
    );
  }
  const typeStr = checker.typeToString(t);
  const norm = typeStr.toLowerCase();
  if (norm === "string") {
    return defaultStringLiteralForProp(propName);
  }
  if (norm === "number") {
    return "42";
  }
  if (norm === "boolean") {
    return "true";
  }
  if (norm === "bigint") {
    return "9n";
  }
  if (norm === "date" || typeStr.includes("Date")) {
    return "new Date('2020-01-01T00:00:00.000Z')";
  }
  let sigs = t.getConstructSignatures();
  if (sigs.length === 0 && t.symbol) {
    const ctorSide = checker.getTypeOfSymbol(t.symbol);
    if (ctorSide) {
      sigs = ctorSide.getConstructSignatures();
    }
  }
  if (sigs.length === 0) {
    throw new Error(
      `Codegen: cannot scaffold constructor arg for property "${propName}" (type "${typeStr}") — no construct signatures.`
    );
  }
  const sig = sigs[0]!;
  const decl = sig.declaration;
  if (
    !decl ||
    !ts.isConstructorDeclaration(decl) ||
    !ts.isClassDeclaration(decl.parent) ||
    !decl.parent.name
  ) {
    throw new Error(
      `Codegen: could not resolve class for constructor of "${propName}" (${typeStr}).`
    );
  }
  const classSym = checker.getSymbolAtLocation(decl.parent.name);
  if (!classSym) {
    throw new Error(`Codegen: missing class symbol for "${propName}" (${typeStr}).`);
  }
  const className = String(classSym.name);
  const ctorDecl = decl;
  if (ctorDecl.parameters.length === 0) {
    const mod = workspaceImportModuleForSymbol(classSym, repoRoot);
    addImport(importAcc, mod, className);
    return `new ${className}()`;
  }
  if (ctorDecl.parameters.length !== 1) {
    throw new Error(
      `Codegen: ${className} constructor must have 0 or 1 parameter to scaffold mapper tests (property "${propName}").`
    );
  }
  const p0 = ctorDecl.parameters[0]!;
  const paramType = checker.getTypeAtLocation(p0);
  const mod = workspaceImportModuleForSymbol(classSym, repoRoot);
  addImport(importAcc, mod, className);
  const paramStr = checker.typeToString(paramType);
  if (
    paramStr === "string" ||
    paramStr === "number" ||
    paramStr === "boolean" ||
    paramStr === "bigint"
  ) {
    if (paramStr === "string") return `new ${className}(${defaultStringLiteralForProp(propName)})`;
    if (paramStr === "number") return `new ${className}(42)`;
    if (paramStr === "boolean") return `new ${className}(true)`;
    return `new ${className}(9n)`;
  }
  if (paramStr === "Date" || paramStr.includes("Date")) {
    return `new ${className}(new Date('2020-01-01T00:00:00.000Z'))`;
  }
  const inner = buildPlainObjectLiteralForType(paramType, checker);
  return `new ${className}(${inner})`;
}
/**
 * @param {ts.TypeChecker} checker
 * @param {ts.ClassDeclaration} classDecl
 * @param {string} entityPascal
 * @param {string} entityClassName
 * @param {string[]} sortedFieldNames from `[SERIALIZE]()` / transport field order
 * @param {string} domainNpmName e.g. `@features/foo-domain`
 * @param {string} repoRoot
 * @returns {{ importAcc: Map<string, Set<string>>, entityConstruction: string }}
 */
function buildEntityTestConstruction(
  checker: ts.TypeChecker,
  classDecl: ts.ClassDeclaration,
  entityPascal: string,
  entityClassName: string,
  sortedFieldNames: string[],
  domainNpmName: string,
  repoRoot: string
) {
  /** @type {Map<string, Set<string>>} */
  const importAcc = new Map();
  const entitiesMod = `${domainNpmName}/entities`;
  addImport(importAcc, entitiesMod, entityClassName);
  const ctor = findConstructorDeclaration(classDecl);
  if (!ctor) {
    throw new Error(
      `Codegen: ${entityClassName} has no constructor — cannot scaffold a real entity in the mapper test.`
    );
  }
  if (ctor.parameters.length === 0) {
    if (sortedFieldNames.length > 0) {
      throw new Error(
        `Codegen: ${entityClassName} has a zero-arg constructor but [SERIALIZE]() exposes properties — add a constructor parameter typed as *Props.`
      );
    }
    return { importAcc, entityConstruction: `const entity = new ${entityClassName}();` };
  }
  const ctorPropsType = getConstructorFirstParameterType(checker, classDecl);
  if (!ctorPropsType) {
    throw new Error(
      `Codegen: add an explicit type to ${entityClassName}'s constructor first parameter (e.g. \`constructor(props: ${entityPascal}Props)\`) so the mapper test can call \`new ${entityClassName}({ ... })\` without type assertions.`
    );
  }
  const lines: string[] = [];
  for (const name of sortedFieldNames) {
    const sym = checker.getPropertyOfType(ctorPropsType, name);
    if (!sym) {
      throw new Error(
        `Codegen: property "${name}" appears on [SERIALIZE]() but not on the constructor parameter type — align ${entityPascal}Props (or the constructor annotation) with the serialized shape.`
      );
    }
    const optional = (sym.getFlags() & ts.SymbolFlags.Optional) !== 0;
    if (optional) {
      throw new Error(
        `Codegen: optional snapshot property "${name}" is not supported in generated mapper tests yet — make it required on ${entityPascal}Props or adjust the test manually.`
      );
    }
    const pt = checker.getTypeOfSymbol(sym);
    if (!pt) {
      throw new Error(`Codegen: could not resolve type for constructor prop "${name}".`);
    }
    const expr = buildConstructorArgExpression(name, pt, checker, repoRoot, importAcc);
    lines.push(`      ${name}: ${expr},`);
  }
  const objectBody = lines.length > 0 ? `\n${lines.join("\n")}\n    ` : "";
  const entityConstruction = `const entity = new ${entityClassName}({${objectBody}});`;
  return { importAcc, entityConstruction };
}
/**
 * @param {Map<string, Set<string>>} importAcc
 * @param {string} entityKebab
 * @param {string} fn mapXToDTO
 */
function formatTestImportLines(
  importAcc: Map<string, Set<string>>,
  entityKebab: string,
  fn: string
) {
  const out: string[] = [];
  out.push(`import { describe, it, expect } from "vitest";`);
  const mods = [...importAcc.keys()].sort((a: string, b: string) => a.localeCompare(b));
  for (const mod of mods) {
    const names = [...(importAcc.get(mod) ?? new Set<string>())].sort((a, b) => a.localeCompare(b));
    out.push(`import { ${names.join(", ")} } from "${mod}";`);
  }
  if (entityKebab && fn) {
    out.push(`import { ${fn} } from "./${entityKebab}.mapper";`);
  }
  return out;
}
/**
 * @param {ts.TypeChecker} checker
 * @param {ts.ClassDeclaration} classDecl
 * @param {string} entityClassName
 */
function buildEmptyEntityTestConstruction(
  checker: ts.TypeChecker,
  classDecl: ts.ClassDeclaration,
  entityClassName: string,
  domainNpmName: string
) {
  /** @type {Map<string, Set<string>>} */
  const importAcc = new Map();
  addImport(importAcc, `${domainNpmName}/entities`, entityClassName);
  const ctor = findConstructorDeclaration(classDecl);
  if (ctor && ctor.parameters.length === 0) {
    return {
      importAcc,
      entityConstruction: `const entity = new ${entityClassName}();`,
    };
  }
  const ctorPropsType = ctor ? getConstructorFirstParameterType(checker, classDecl) : undefined;
  if (ctorPropsType) {
    const props = checker
      .getPropertiesOfType(ctorPropsType)
      .filter((p: ts.Symbol) => !p.getName().startsWith("__"));
    const allOptional = props.every(
      (p: ts.Symbol) => (p.getFlags() & ts.SymbolFlags.Optional) !== 0
    );
    if (props.length === 0 || allOptional) {
      return {
        importAcc,
        entityConstruction: `const entity = new ${entityClassName}({});`,
      };
    }
  }
  throw new Error(
    `Codegen: empty [SERIALIZE]() but ${entityClassName} requires constructor arguments — cannot scaffold mapper test without \`as unknown\`; add optional props or a no-arg constructor.`
  );
}
/**
 * @param {ts.Type} t
 * @param {ts.TypeChecker} checker
 * @returns {ts.Type | undefined}
 */
function typeOfValueGetter(t: ts.Type, checker: ts.TypeChecker) {
  const apparent = checker.getApparentType(t);
  const sym = apparent.getProperty("value");
  if (!sym) return undefined;
  return checker.getTypeOfSymbol(sym);
}
/**
 * @param {ts.Type} t
 * @param {ts.TypeChecker} checker
 * @param {string} methodName
 * @returns {ts.Type | undefined}
 */
function returnTypeOfZeroArgMethod(t: ts.Type, checker: ts.TypeChecker, methodName: string) {
  const apparent = checker.getApparentType(t);
  const sym = apparent.getProperty(methodName);
  if (!sym) return undefined;
  const decl = sym.valueDeclaration ?? sym.declarations?.[0];
  if (!decl) return undefined;
  if (ts.isMethodDeclaration(decl) || ts.isMethodSignature(decl)) {
    const sig = checker.getSignatureFromDeclaration(decl);
    if (sig && sig.parameters.length === 0) {
      return checker.getReturnTypeOfSignature(sig);
    }
  }
  return undefined;
}
/**
 * Build expected object literal for mapper tests from a plain object type (e.g. VO `getProps()` shape).
 * @param {ts.Type} objectLike
 * @param {ts.TypeChecker} checker
 * @returns {{ expectedLiteral: string } | null}
 */
function objectLiteralStubForType(objectLike: ts.Type, checker: ts.TypeChecker) {
  const apparent = checker.getApparentType(objectLike);
  const props = checker.getPropertiesOfType(apparent);
  if (props.length === 0) {
    return {
      expectedLiteral: `{}`,
    };
  }
  const expParts: string[] = [];
  for (const p of props) {
    const n = p.getName();
    if (n.startsWith("__")) continue;
    const pt = checker.getTypeOfSymbol(p);
    if (!pt) continue;
    const ps = checker.typeToString(pt);
    let expVal;
    if (ps === "string") {
      expVal = defaultStringForNestedObjectField(n);
    } else if (ps === "number") {
      expVal = "7";
    } else if (ps === "boolean") {
      expVal = "true";
    } else {
      return null;
    }
    expParts.push(`${n}: ${expVal}`);
  }
  return {
    expectedLiteral: `{ ${expParts.join(", ")} }`,
  };
}
/**
 * @param {string} s
 */
function isPrimitiveTypeString(s: string) {
  return s === "string" || s === "number" || s === "boolean" || s === "bigint";
}
/**
 * Expected literal fragment for one field of `entity[SERIALIZE]()` in generated mapper tests.
 * @param {ts.Type} t
 * @param {ts.TypeChecker} checker
 * @param {string} propName
 */
function describePropertyMapping(t: ts.Type, checker: ts.TypeChecker, propName: string) {
  const typeStr = checker.typeToString(t);
  const valueT = typeOfValueGetter(t, checker);
  const valueStr = valueT ? checker.typeToString(valueT) : "";
  if (valueT && isPrimitiveTypeString(valueStr)) {
    if (valueStr === "number") {
      return { expectedLiteral: "7" };
    }
    if (valueStr === "boolean") {
      return { expectedLiteral: "true" };
    }
    const s = JSON.stringify(`stub-${propName}`);
    return { expectedLiteral: s };
  }
  const getPropsReturn = returnTypeOfZeroArgMethod(t, checker, "getProps");
  if (getPropsReturn) {
    const stubs = objectLiteralStubForType(getPropsReturn, checker);
    if (stubs) {
      return { expectedLiteral: stubs.expectedLiteral };
    }
  }
  const primNorm = typeStr.toLowerCase();
  if (
    primNorm === "string" ||
    primNorm === "number" ||
    primNorm === "boolean" ||
    primNorm === "bigint"
  ) {
    const lit =
      primNorm === "string"
        ? defaultStringLiteralForProp(propName)
        : primNorm === "number"
          ? "42"
          : primNorm === "boolean"
            ? "true"
            : "9n";
    return { expectedLiteral: lit };
  }
  if (typeStr === "Date" || typeStr.includes("Date")) {
    return { expectedLiteral: "new Date('2020-01-01T00:00:00.000Z')" };
  }
  return { expectedLiteral: "null" };
}
/**
 * @param {string} entityPascal
 * @param {string} domainEntitiesModule e.g. `@features/foo-domain/entities`
 */
function buildDtoTypeAliasSource(entityPascal: string, domainEntitiesModule: string) {
  const entityClass = `${entityPascal}Entity`;
  const name = `${entityPascal}DTO`;
  return `import type { ${entityClass} } from '${domainEntitiesModule}';
import type { Plain } from '@features/shared-domain/utils';

export type ${name} = Plain<${entityClass}>;
`;
}
/**
 * @param {{
 *   entityPascal: string,
 *   entityKebab: string,
 *   domainEntitiesModule: string,
 * }} args
 */
function buildMapperSource(args: BuildMapperSourceArgs) {
  const { entityPascal, entityKebab, domainEntitiesModule } = args;
  const entityClass = `${entityPascal}Entity`;
  const fn = `map${entityPascal}ToDTO`;
  const dtoType = `${entityPascal}DTO`;
  return `import type { ${entityClass} } from '${domainEntitiesModule}';
import type { ${dtoType} } from '../dtos/${entityKebab}.dto';
import { SERIALIZE } from '@features/shared-domain/utils';

export function ${fn}(entity: ${entityClass}): ${dtoType} {
  return entity[SERIALIZE]();
}
`;
}
/**
 * @param {{
 *   entityPascal: string,
 *   entityKebab: string,
 *   domainPackage: string,
 *   applicationPackage: string,
 *   fields: { name: string, expectedLiteral: string }[],
 *   importAcc: Map<string, Set<string>>,
 *   entityConstruction: string,
 * }} args
 */
function buildMapperTestSource(args: BuildMapperTestSourceArgs) {
  const { entityPascal, entityKebab, fields, importAcc, entityConstruction } = args;
  const fn = `map${entityPascal}ToDTO`;
  const importLines = formatTestImportLines(importAcc, entityKebab, fn);
  const expectedBody = fields.map((f) => `      ${f.name}: ${f.expectedLiteral},`).join("\n");
  const expectedInner = fields.length === 0 ? "" : `\n${expectedBody}\n    `;
  const itTitle = "maps entity fields to the DTO";
  return `${importLines.join("\n")}

describe("${fn}", () => {
  it("${itTitle}", () => {
    ${entityConstruction}
    expect(${fn}(entity)).toEqual({${expectedInner}});
  });
});
`;
}
/**
 * @param {{
 *   repoRoot: string,
 *   domainPackageRel: string,
 *   domainNpmName: string,
 *   entityBasePascal: string,
 * }} opts
 * @returns {{ dtoSource: string, mapperSource: string, testSource: string }}
 */
function generateApplicationEntityMapperSources(opts: GenerateApplicationEntityMapperSourcesOpts) {
  const { repoRoot, domainPackageRel, domainNpmName, entityBasePascal } = opts;
  const entityPascal = toPascalCase(String(entityBasePascal || "").trim());
  const entityKebab = toKebabCase(entityBasePascal);
  const entityClassName = `${entityPascal}Entity`;
  const domainPackageDir = path.join(repoRoot, ...domainPackageRel.split("/"));
  const entityPath = path.join(domainPackageDir, "entities", `${entityKebab}.entity.ts`);
  if (!fs.existsSync(entityPath)) {
    throw new Error(`Entity file not found: ${entityPath}`);
  }
  const rootNames = collectTypeScriptSourceFiles(domainPackageDir);
  if (rootNames.length === 0) {
    throw new Error(`No TypeScript sources under ${domainPackageDir}`);
  }
  const pathMapping = buildCompilerPathsForRepoDomainCodegen(repoRoot, domainPackageDir);
  const project = createPlopMorphProject({
    compilerOptions: {
      ...PLOP_MORPH_COMPILER_OPTIONS,
      baseUrl: repoRoot,
      paths: pathMapping,
    },
  });
  for (const filePath of rootNames) {
    project.addSourceFileAtPath(filePath);
  }
  const checker = project.getTypeChecker().compilerObject;
  const morphEntityFile = project.getSourceFile(entityPath);
  if (!morphEntityFile) {
    throw new Error(`TypeScript program did not load ${entityPath}`);
  }
  const sf = morphEntityFile.compilerNode;
  const classDecl = findExportedClassDeclaration(sf, entityClassName);
  if (!classDecl) {
    throw new Error(
      `Could not find exported class ${entityClassName} in ${path.relative(repoRoot, entityPath)}`
    );
  }
  const serializeMethod = findSerializeImplementation(classDecl);
  if (!serializeMethod) {
    throw new Error(
      `Could not find [SERIALIZE]() implementation on ${entityClassName} in ${path.relative(repoRoot, entityPath)}`
    );
  }
  const sig = checker.getSignatureFromDeclaration(serializeMethod);
  if (!sig) {
    throw new Error("Could not resolve [SERIALIZE]() type signature");
  }
  const returnType = checker.getReturnTypeOfSignature(sig);
  const props = checker.getPropertiesOfType(returnType);
  const returnTypeLabel = checker.typeToString(returnType);
  if (props.length === 0 && returnTypeLabel === "any") {
    throw new Error(
      `Could not infer properties from ${entityClassName}[SERIALIZE]() (return type is any). ` +
        "Run `pnpm install` at the repo root so dependencies like zod and workspace @features/*-domain resolve, then re-run this generator."
    );
  }
  interface OrderedProp {
    name: string;
    optional: boolean;
    order: number;
  }
  const ordered: OrderedProp[] = [];
  for (let i = 0; i < props.length; i++) {
    const p = props[i]!;
    const name = p.getName();
    if (name.startsWith("__@")) continue;
    const optional = (p.getFlags() & ts.SymbolFlags.Optional) !== 0;
    ordered.push({ name, optional, order: i });
  }
  ordered.sort((a, b) => {
    if (a.name === "id") return -1;
    if (b.name === "id") return 1;
    return a.name.localeCompare(b.name);
  });
  const fields: {
    name: string;
    optional: boolean;
    expectedLiteral: string;
  }[] = [];
  for (const { name, optional } of ordered) {
    const sym = returnType.getProperty(name);
    if (!sym) continue;
    const propType = checker.getTypeOfSymbol(sym);
    if (!propType) continue;
    const mapped = describePropertyMapping(propType, checker, name);
    fields.push({
      name,
      optional,
      expectedLiteral: mapped.expectedLiteral,
    });
  }
  const domainEntitiesModule = `${domainNpmName}/entities`;
  const dtoSource = buildDtoTypeAliasSource(entityPascal, domainEntitiesModule);
  const mapperSource = buildMapperSource({
    entityPascal,
    entityKebab,
    domainEntitiesModule,
  });
  let testConstruction;
  if (fields.length === 0) {
    testConstruction = buildEmptyEntityTestConstruction(
      checker,
      classDecl,
      entityClassName,
      domainNpmName
    );
  } else {
    testConstruction = buildEntityTestConstruction(
      checker,
      classDecl,
      entityPascal,
      entityClassName,
      fields.map((f: MapperCodegenField) => f.name),
      domainNpmName,
      repoRoot
    );
  }
  const testSource = buildMapperTestSource({
    entityPascal,
    entityKebab,
    fields,
    importAcc: testConstruction.importAcc,
    entityConstruction: testConstruction.entityConstruction,
  });
  return { dtoSource, mapperSource, testSource };
}
export { generateApplicationEntityMapperSources };
