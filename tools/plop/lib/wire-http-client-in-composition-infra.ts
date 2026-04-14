import fs from "node:fs";
import { appendImportsIfMissing } from "./module-wire-ast.ts";
import {
  ts,
  assertNoConflictingMembers,
  assertNoReturnPropertyConflict,
  loadCompositionInfrastructureAst,
  printUpdatedCompositionInfrastructure,
} from "./composition-infra-ast.ts";

function createHttpClientGetterMethod(getterName: string, ctxParamName: string) {
  return `private ${getterName}(${ctxParamName}: RequestContext): HttpClient {
    const httpContext = {
      correlationId: ${ctxParamName}?.getCorrelationId ? ${ctxParamName}.getCorrelationId() : undefined,
    };
    // FIXME: set the real prefixUrl and extend HttpContext mapping (auth, tenant, custom headers) if needed.
    return createHttpClientForContext(httpContext, {
      prefixUrl: "FIXME-base-url",
    });
  }`;
}

interface HttpClientWireOpts {
  propName: string;
}

function wireHttpClientIntoCompositionInfrastructure(
  compositionInfrastructurePath: string,
  opts: HttpClientWireOpts
) {
  const propName = opts.propName;
  const getterName = `get${propName.charAt(0).toUpperCase()}${propName.slice(1)}`;
  const importLines = [
    'import type { HttpClient } from "@features/shared-infra-lib-http";',
    'import { createHttpClientForContext } from "@features/shared-infra-lib-http";',
  ];
  let text = fs.readFileSync(compositionInfrastructurePath, "utf8");
  text = appendImportsIfMissing(text, importLines);
  fs.writeFileSync(compositionInfrastructurePath, text, "utf8");
  const ast = loadCompositionInfrastructureAst(compositionInfrastructurePath);
  assertNoConflictingMembers(ast.providerClass.getMembers(), [propName, getterName]);
  assertNoReturnPropertyConflict(ast.returnObject, propName);
  const getter = createHttpClientGetterMethod(getterName, ast.ctxParamName);
  return printUpdatedCompositionInfrastructure({
    ...ast,
    insertedMembers: [getter],
    appendedProperty: ts.makePropertyAssignmentText(
      propName,
      `this.${getterName}(${ast.ctxParamName})`
    ),
  });
}

function ensureCompositionDependsOnHttpLib(compositionPackageJsonPath: string) {
  const raw = fs.readFileSync(compositionPackageJsonPath, "utf8");
  const pkg = JSON.parse(raw) as {
    dependencies?: Record<string, string>;
  };
  if (!pkg.dependencies || typeof pkg.dependencies !== "object") {
    pkg.dependencies = {};
  }
  if (!pkg.dependencies["@features/shared-infra-lib-http"]) {
    pkg.dependencies["@features/shared-infra-lib-http"] = "workspace:*";
  }
  const keys = Object.keys(pkg.dependencies).sort();
  const sorted: Record<string, string> = {};
  for (const key of keys) sorted[key] = pkg.dependencies[key]!;
  pkg.dependencies = sorted;
  fs.writeFileSync(compositionPackageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

export { wireHttpClientIntoCompositionInfrastructure, ensureCompositionDependsOnHttpLib };
