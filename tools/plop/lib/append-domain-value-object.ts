import type { ActionType } from "node-plop";
import { toKebabCase } from "./casing.ts";
import { ensureRepoDomainPackageSlice } from "./ensure-domain-package-slice.ts";

export interface AppendDomainValueObjectForRepoPackageOpts {
  repoRoot: string;
  /** Repo-relative posix path, e.g. `features/shared/domain`. */
  domainPackageRel: string;
  valueObjectName: string;
  valueObjectKind?: "single-value" | "composite";
  singleValuePrimitive?: "string" | "boolean" | "number" | "Date";
}

/**
 * Legacy `domain-value-object` behaviour: add `*.vo.ts` + barrel export under `features/.../domain/value-objects/`.
 */
export function appendDomainValueObjectActionsForRepoPackage(
  actions: (ActionType | (() => string))[],
  opts: AppendDomainValueObjectForRepoPackageOpts
) {
  const { repoRoot, domainPackageRel, valueObjectName } = opts;
  const valueObjectKind = opts.valueObjectKind ?? "single-value";
  const kebab = toKebabCase(valueObjectName);

  let templateFile: string;
  let voData: Record<string, unknown>;

  if (valueObjectKind === "composite") {
    templateFile = "templates/domain-value-object/value-object-composite.ts.hbs";
    voData = { domainPackageRel, valueObjectName };
  } else {
    const singleValuePrimitive = opts.singleValuePrimitive ?? "string";
    const primitiveSchemaByType = {
      string: "z.string().min(1)",
      boolean: "z.boolean()",
      number: "z.number()",
      Date: "z.date()",
    };
    type Prim = keyof typeof primitiveSchemaByType;
    const equalsBodyByType: Record<Prim, string> = {
      string: "return other.value === this.value;",
      boolean: "return other.value === this.value;",
      number: "return other.value === this.value;",
      Date: "return other.value.getTime() === this.value.getTime();",
    };
    const prim = singleValuePrimitive as Prim;
    templateFile = "templates/domain-value-object/value-object-single-value.ts.hbs";
    voData = {
      domainPackageRel,
      valueObjectName,
      singleValuePrimitive,
      singleValueSchema: primitiveSchemaByType[prim],
      singleValueEqualsBody: equalsBodyByType[prim],
    };
  }

  actions.unshift(() => {
    ensureRepoDomainPackageSlice(repoRoot, domainPackageRel, "value-objects");
    return "";
  });
  actions.push(
    {
      type: "add",
      path: "../../{{domainPackageRel}}/value-objects/{{kebabCase valueObjectName}}.vo.ts",
      templateFile,
      data: voData,
    },
    {
      type: "modify",
      path: "../../{{domainPackageRel}}/value-objects/index.ts",
      transform: (file: string) => {
        const cleaned = file.replace(/^export\s*{\s*}\s*;?\s*$/m, "").trimEnd();
        const exportLine = `export * from './${kebab}.vo';`;
        if (cleaned.includes(exportLine)) {
          return `${cleaned}\n`;
        }
        const base = cleaned.length > 0 ? `${cleaned}\n` : "";
        return `${base}${exportLine}\n`;
      },
    }
  );
}
