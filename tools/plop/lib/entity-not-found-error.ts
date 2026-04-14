import type { ActionType } from "node-plop";
import { toConstantCase, toKebabCase } from "./casing.ts";
import { ensureRepoDomainPackageSlice } from "./ensure-domain-package-slice.ts";

export interface AppendEntityNotFoundErrorForRepoPackageOpts {
  repoRoot: string;
  /** Repo-relative posix path, e.g. `features/foo/domain`. */
  domainPackageRel: string;
  entityPascal: string;
}

export function getEntityNotFoundErrorSpec(entityPascal: string) {
  const stem = `${entityPascal}NotFound`;
  return {
    className: `${entityPascal}NotFoundError`,
    fileKebab: toKebabCase(stem),
    code: toConstantCase(stem),
  };
}

export function appendDomainErrorsBarrelExport(fileContents: string, fileKebab: string) {
  const cleaned = fileContents.replace(/^export\s*{\s*}\s*;?\s*$/m, "").trimEnd();
  const exportLine = `export * from './${fileKebab}.error';`;
  if (cleaned.includes(exportLine)) {
    return `${cleaned}\n`;
  }
  const base = cleaned.length > 0 ? `${cleaned}\n` : "";
  return `${base}${exportLine}\n`;
}

/**
 * Add `{Entity}NotFoundError` under `features/.../domain/errors/` and merge `errors/index.ts`.
 */
export function appendEnsureEntityNotFoundErrorActionsForRepoPackage(
  actions: (ActionType | (() => string))[],
  opts: AppendEntityNotFoundErrorForRepoPackageOpts
) {
  const { repoRoot, domainPackageRel, entityPascal } = opts;
  const nf = getEntityNotFoundErrorSpec(entityPascal);

  actions.unshift(() => {
    ensureRepoDomainPackageSlice(repoRoot, domainPackageRel, "errors");
    return "";
  });

  actions.push({
    type: "add",
    path: "../../{{domainPackageRel}}/errors/{{notFoundFileKebab}}.error.ts",
    templateFile: "templates/domain-entity/entity-not-found.error.ts.hbs",
    data: {
      notFoundFileKebab: nf.fileKebab,
      notFoundClassName: nf.className,
      notFoundCode: nf.code,
      entityPascal,
    },
    skipIfExists: true,
  });

  actions.push({
    type: "modify",
    path: "../../{{domainPackageRel}}/errors/index.ts",
    transform: (file: string) => appendDomainErrorsBarrelExport(file, nf.fileKebab),
  });
}
