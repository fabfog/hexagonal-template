import fs from "node:fs";
import { Node } from "ts-morph";
import { createPlopMorphProject } from "./ts-morph-project.ts";

const morphProject = createPlopMorphProject({ useInMemoryFileSystem: true });

function findInfrastructureProviderClass(sf: import("ts-morph").SourceFile) {
  const matches = sf
    .getClasses()
    .filter((decl) => (decl.getName() ?? "").endsWith("InfrastructureProvider"));
  if (matches.length > 1) {
    throw new Error(
      `Multiple *InfrastructureProvider classes in ${sf.getFilePath()}; expected exactly one.`
    );
  }
  return matches[0];
}

function findGetForContextMethod(classDecl: import("ts-morph").ClassDeclaration) {
  return classDecl.getMethod("getForContext");
}

function findReturnObjectLiteral(body: import("ts-morph").Block) {
  const ret = body.getStatements().filter(Node.isReturnStatement).at(-1);
  const expression = ret?.getExpression();
  if (!ret || !expression || !Node.isObjectLiteralExpression(expression)) {
    throw new Error(
      "Expected getForContext to end with `return { ... }` (single object literal return)."
    );
  }
  return { retStmt: ret, obj: expression };
}

function assertNoConflictingMembers(
  members: import("ts-morph").ClassMemberTypes[],
  memberNames: string[]
) {
  const blocked = new Set(memberNames.filter(Boolean));
  for (const m of members) {
    if (
      !Node.isMethodDeclaration(m) &&
      !Node.isPropertyDeclaration(m) &&
      !Node.isGetAccessorDeclaration(m)
    ) {
      continue;
    }
    const t = m.getName();
    if (blocked.has(t)) {
      throw new Error(`Class already has a member named "${t}".`);
    }
  }
}

function assertNoReturnPropertyConflict(
  obj: import("ts-morph").ObjectLiteralExpression,
  propName: string
) {
  for (const p of obj.getProperties()) {
    if (Node.isPropertyAssignment(p) && p.getName() === propName) {
      throw new Error(`getForContext return object already has property "${propName}"`);
    }
  }
}

function loadCompositionInfrastructureAst(compositionInfrastructurePath: string) {
  const text = fs.readFileSync(compositionInfrastructurePath, "utf8");
  const sourceFile = morphProject.createSourceFile(compositionInfrastructurePath, text, {
    overwrite: true,
  });
  const providerClass = findInfrastructureProviderClass(sourceFile);
  if (!providerClass || !providerClass.getName()) {
    throw new Error(
      `No exported *InfrastructureProvider class in ${compositionInfrastructurePath}`
    );
  }
  const getForContext = findGetForContextMethod(providerClass);
  const getForContextBody = getForContext?.getBody();
  if (!getForContext || !getForContextBody || !Node.isBlock(getForContextBody)) {
    throw new Error(`getForContext must have a block body in ${compositionInfrastructurePath}`);
  }
  const ctxParamName = getForContext.getParameters()[0]?.getName() ?? "ctx";
  const { retStmt, obj } = findReturnObjectLiteral(getForContextBody);
  return {
    text,
    sourceFile,
    providerClass,
    getForContext,
    getForContextBody,
    retStmt,
    returnObject: obj,
    ctxParamName,
  };
}

type CompositionInfraPrintContext = ReturnType<typeof loadCompositionInfrastructureAst> & {
  insertedMembers?: string[];
  appendedProperty?: string;
};

function printUpdatedCompositionInfrastructure(ctx: CompositionInfraPrintContext) {
  const insertedMembers = ctx.insertedMembers ?? [];
  if (ctx.appendedProperty) {
    ctx.returnObject.addPropertyAssignment({
      name: ctx.appendedProperty.split(":")[0]!.trim(),
      initializer: ctx.appendedProperty.split(":").slice(1).join(":").trim(),
    });
  }
  if (insertedMembers.length > 0) {
    const insertIndex = ctx.providerClass.getMembers().findIndex((m) => m === ctx.getForContext);
    const snippets = insertedMembers.map((m) => m.trim()).join("\n\n");
    ctx.providerClass.insertMembers(insertIndex < 0 ? 0 : insertIndex, snippets);
  }
  return `${ctx.sourceFile.getFullText().replace(/\n+$/, "")}\n`;
}

const ts = {
  makePropertyAssignmentText(name: string, initializer: string) {
    return `${name}: ${initializer}`;
  },
};
export {
  ts,
  findInfrastructureProviderClass,
  findGetForContextMethod,
  findReturnObjectLiteral,
  assertNoConflictingMembers,
  assertNoReturnPropertyConflict,
  loadCompositionInfrastructureAst,
  printUpdatedCompositionInfrastructure,
};
