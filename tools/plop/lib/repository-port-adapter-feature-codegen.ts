import type { ActionType } from "node-plop";
import { toConstantCase, toKebabCase } from "./casing.ts";
import { ensureRepoDomainPackageSlice } from "./ensure-domain-package-slice.ts";
import { getRepoDomainPackageChoices, readDomainPackageJsonName } from "./repo-domain-packages.ts";

const DATALOADER_NPM = "@features/shared-infra-lib-dataloader";
const HTTP_LIB_NPM = "@features/shared-infra-lib-http";

export interface PortMethodSig {
  name: string;
  params: string;
  returnType: string;
}

export interface FeatureRepositoryPortMetadata {
  domainPackageRel: string;
  domainNpmName: string;
  entityClassName: string;
  entityPascal: string;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse entity import from a feature repository port (`@features/…-domain/entities`).
 */
export function parseFeatureRepositoryPortMetadata(
  repoRoot: string,
  portSource: string
): FeatureRepositoryPortMetadata {
  const m = portSource.match(
    /import\s+type\s+\{\s*(\w+)\s*\}\s+from\s+["'](@features\/[^/]+-domain)\/entities["']\s*;/u
  );
  if (!m?.[1] || !m[2]) {
    throw new Error(
      'Could not parse repository port: expected import type { XxxEntity } from "@features/<slug>-domain/entities";'
    );
  }
  const entityClassName = m[1];
  const domainNpmName = m[2];
  const entityPascal = entityClassName.endsWith("Entity")
    ? entityClassName.slice(0, -"Entity".length)
    : entityClassName;

  let domainPackageRel: string | null = null;
  for (const c of getRepoDomainPackageChoices(repoRoot)) {
    try {
      if (readDomainPackageJsonName(repoRoot, c.value) === domainNpmName) {
        domainPackageRel = c.value;
        break;
      }
    } catch {
      continue;
    }
  }
  if (!domainPackageRel) {
    throw new Error(
      `Could not resolve domain package path for npm name "${domainNpmName}" (features/*/domain).`
    );
  }

  return { domainPackageRel, domainNpmName, entityClassName, entityPascal };
}

export function parseRepositoryPortInterfaceNameFromSource(portSource: string): string {
  const all = [...portSource.matchAll(/export\s+interface\s+(\w+)\s*\{/gu)];
  if (all.length === 0) {
    throw new Error("Could not parse repository port: expected export interface Name { ... }");
  }
  const names = all.map((x) => x[1] as string);
  const withSuffix = names.find((n) => n.endsWith("RepositoryPort"));
  const chosen = withSuffix ?? names[0];
  if (!chosen) {
    throw new Error("Could not parse repository port interface names.");
  }
  return chosen;
}

export function isGetByIdWithVoId(
  method: PortMethodSig,
  entityClassName: string,
  entityPascal: string
) {
  if (method.name !== "getById") return false;
  const first = method.params.split(",")[0]?.trim() ?? "";
  const idTypePattern = new RegExp(`:\\s*${escapeRegExp(entityPascal)}Id\\s*$`);
  if (!idTypePattern.test(first)) return false;
  if (!method.returnType.includes("Promise")) return false;
  return method.returnType.includes(entityClassName);
}

export function isGetByIdWithStringId(method: PortMethodSig, entityClassName: string) {
  if (method.name !== "getById") return false;
  const first = method.params.split(",")[0]?.trim() ?? "";
  if (!/:\s*string\s*$/u.test(first)) return false;
  if (!method.returnType.includes("Promise")) return false;
  return method.returnType.includes(entityClassName);
}

export function usesGetByIdBatch(
  methods: PortMethodSig[],
  entityClassName: string,
  entityPascal: string
) {
  return methods.some(
    (m) =>
      isGetByIdWithVoId(m, entityClassName, entityPascal) ||
      isGetByIdWithStringId(m, entityClassName)
  );
}

export function getBatchGetByIdKind(
  methods: PortMethodSig[],
  entityClassName: string,
  entityPascal: string
): "vo" | "string" | null {
  if (methods.some((m) => isGetByIdWithVoId(m, entityClassName, entityPascal))) {
    return "vo";
  }
  if (methods.some((m) => isGetByIdWithStringId(m, entityClassName))) {
    return "string";
  }
  return null;
}

function firstParamName(params: string) {
  const first = params.split(",")[0]?.trim() ?? "";
  const m = first.match(/^(\w+)\s*:/u);
  return m ? m[1] : "id";
}

function buildCreateByIdLoaderMethod(
  kind: "vo" | "string",
  entityPascal: string,
  entityClassName: string
) {
  if (kind === "vo") {
    return `
  private createByIdLoader(): DataLoader<${entityPascal}Id, ${entityClassName}, string> {
    return new DataLoader<${entityPascal}Id, ${entityClassName}, string>(
      async (ids) => this.fetchManyByIds(ids.map((k) => k.value)),
      { cacheKeyFn: (key) => key.value }
    );
  }
`;
  }
  return `
  private createByIdLoader(): DataLoader<string, ${entityClassName}> {
    return new DataLoader<string, ${entityClassName}>(async (ids: string[]) => {
      return this.fetchManyByIds([...ids]);
    });
  }
`;
}

function buildMethodBodies(
  methods: PortMethodSig[],
  entityClassName: string,
  entityPascal: string,
  entityKebab: string,
  notFoundErrorClassName: string,
  useKyHttpClient: boolean
) {
  const usesBatchFetch = usesGetByIdBatch(methods, entityClassName, entityPascal);
  const getByIdKind = getBatchGetByIdKind(methods, entityClassName, entityPascal);
  let code = "";
  for (const method of methods) {
    if (isGetByIdWithVoId(method, entityClassName, entityPascal)) {
      const idParam = firstParamName(method.params);
      code += `
  async ${method.name}(${method.params}): ${method.returnType} {
    return this.byIdLoader.load(${idParam});
  }
`;
    } else if (isGetByIdWithStringId(method, entityClassName)) {
      const idParam = firstParamName(method.params);
      code += `
  async ${method.name}(${method.params}): ${method.returnType} {
    return this.byIdLoader.load(${idParam});
  }
`;
    } else {
      code += `
  ${method.name}(${method.params}): ${method.returnType} {
    throw new Error("Not implemented");
  }
`;
    }
  }
  if (usesBatchFetch && getByIdKind) {
    code += buildCreateByIdLoaderMethod(getByIdKind, entityPascal, entityClassName);
  }
  if (usesBatchFetch) {
    const fetchBlock = useKyHttpClient
      ? `    const raw = await this.deps.httpClient
      // FIXME replace with real fetch details (HTTP context should be applied by composition / ${HTTP_LIB_NPM}).
      .post("${entityKebab}", {
        json: { ids },
      })
      .json<unknown>();
`
      : `    // TODO: Batch-fetch \`ids\` via your SDK or data source.
    const raw: unknown = undefined;
`;
    code += `
  private async fetchManyByIds(
    ids: string[]
  ): Promise<(${entityClassName} | Error)[]> {
${fetchBlock}
    const entities = this.mapRawBatchToEntities(raw);
    const byId = new Map(
      entities.map((entity) => [entity.id, entity] as const)
    );

    return ids.map((id) => {
      const entity = byId.get(id);
      return entity ?? new ${notFoundErrorClassName}(id);
    });
  }

  private mapRawBatchToEntities(raw: unknown): ${entityClassName}[] {
    // TODO: narrow/assert \`raw\`, map rows to ${entityClassName} (use mappers under this package).
    return [];
  }
`;
  }
  return code;
}

export function getEntityNotFoundErrorSpec(entityPascal: string) {
  const stem = `${entityPascal}NotFound`;
  return {
    className: `${entityPascal}NotFoundError`,
    fileKebab: toKebabCase(stem),
    code: toConstantCase(stem),
  };
}

function renderFeatureEntityNotFoundErrorFile(entityPascal: string) {
  const spec = getEntityNotFoundErrorSpec(entityPascal);
  return `import { DomainError } from "@features/shared-domain/errors";

export class ${spec.className} extends DomainError {
  constructor(public readonly id: string) {
    super({
      code: "${spec.code}",
      message: \`${entityPascal} \${id} not found\`,
      metadata: { id },
      cause: undefined,
    });
  }
}
`;
}

function appendDomainErrorsBarrelExport(fileContents: string, fileKebab: string) {
  const cleaned = fileContents.replace(/^export\s*{\s*}\s*;?\s*$/m, "").trimEnd();
  const exportLine = `export * from './${fileKebab}.error';`;
  if (cleaned.includes(exportLine)) {
    return `${cleaned}\n`;
  }
  const base = cleaned.length > 0 ? `${cleaned}\n` : "";
  return `${base}${exportLine}\n`;
}

/**
 * Ensures `{Entity}NotFoundError` exists under a @features/*-domain package (same naming as domain-entity not-found).
 */
export function appendEnsureFeatureEntityNotFoundErrorActions(
  actions: ActionType[],
  opts: { repoRoot: string; domainPackageRel: string; entityPascal: string }
) {
  const { repoRoot, domainPackageRel, entityPascal } = opts;
  const nf = getEntityNotFoundErrorSpec(entityPascal);
  const errorRelPath = `../../${domainPackageRel}/errors/${nf.fileKebab}.error.ts`;
  const errorsIndexRel = `../../${domainPackageRel}/errors/index.ts`;

  const prefix: ActionType[] = [
    () => {
      ensureRepoDomainPackageSlice(repoRoot, domainPackageRel, "errors");
      return "";
    },
    {
      type: "add",
      path: errorRelPath,
      template: renderFeatureEntityNotFoundErrorFile(entityPascal),
      skipIfExists: true,
    },
    {
      type: "modify",
      path: errorsIndexRel,
      transform: (file: string) => appendDomainErrorsBarrelExport(file, nf.fileKebab),
    },
  ];
  actions.splice(0, 0, ...prefix);
}

export interface BuildRichRepositoryAdapterSourceOpts {
  portImportSpecifier: string;
  interfaceName: string;
  className: string;
  domainNpmName: string;
  entityClassName: string;
  entityPascal: string;
  methods: PortMethodSig[];
  useKyHttpClient: boolean;
}

export function buildRichRepositoryAdapterSource(
  opts: BuildRichRepositoryAdapterSourceOpts
): string {
  const {
    portImportSpecifier,
    interfaceName,
    className,
    domainNpmName,
    entityClassName,
    entityPascal,
    methods,
    useKyHttpClient,
  } = opts;
  const entityKebab = toKebabCase(entityPascal);
  const usesBatchFetch = usesGetByIdBatch(methods, entityClassName, entityPascal);
  const usesVoIdOnPort = methods.some((m) => isGetByIdWithVoId(m, entityClassName, entityPascal));
  const notFoundSpec = usesBatchFetch ? getEntityNotFoundErrorSpec(entityPascal) : null;
  const methodBodies = buildMethodBodies(
    methods,
    entityClassName,
    entityPascal,
    entityKebab,
    notFoundSpec ? notFoundSpec.className : "",
    useKyHttpClient
  );
  const notFoundImport = notFoundSpec
    ? `import { ${notFoundSpec.className} } from "${domainNpmName}/errors";\n`
    : "";
  const idVoImport = usesVoIdOnPort
    ? `import type { ${entityPascal}Id } from "${domainNpmName}/value-objects";\n`
    : "";
  const httpImport = useKyHttpClient ? `import type { HttpClient } from "${HTTP_LIB_NPM}";\n` : "";
  const depsHttpClient = useKyHttpClient ? `      httpClient: HttpClient;\n` : "";
  const batchKind = getBatchGetByIdKind(methods, entityClassName, entityPascal);
  const byIdHandleType =
    batchKind === "vo"
      ? `IdleDataLoaderHandle<${entityPascal}Id, ${entityClassName}, string>`
      : batchKind === "string"
        ? `IdleDataLoaderHandle<string, ${entityClassName}>`
        : "";
  const infraImports = usesBatchFetch
    ? `import {
  DataLoader,
  createIdleDataLoader,
  type DataLoaderRegistry,
  type IdleDataLoaderHandle,
} from "${DATALOADER_NPM}";
`
    : `import type { DataLoaderRegistry } from "${DATALOADER_NPM}";
`;
  const byIdLoaderKeyConst = usesBatchFetch
    ? `const BY_ID_LOADER_KEY = "${entityKebab}.byId";

`
    : "";
  const byIdLoaderField = usesBatchFetch
    ? `  private readonly byIdLoader: ${byIdHandleType};

`
    : "";
  const constructorBlock = usesBatchFetch
    ? `  constructor(
    private readonly deps: {
${depsHttpClient}      loaders: DataLoaderRegistry;
    }
  ) {
    this.byIdLoader = createIdleDataLoader({
      registry: this.deps.loaders,
      loaderKey: BY_ID_LOADER_KEY,
      factory: () => this.createByIdLoader(),
    });
  }
`
    : `  constructor(
    private readonly deps: {
${depsHttpClient}      loaders: DataLoaderRegistry;
    }
  ) {}
`;

  return `${infraImports}${httpImport ? `${httpImport}\n` : ""}import type { ${interfaceName} } from "${portImportSpecifier}";
import type { ${entityClassName} } from "${domainNpmName}/entities";
${idVoImport}${notFoundImport}
${byIdLoaderKeyConst}export class ${className} implements ${interfaceName} {
${byIdLoaderField}${constructorBlock}${methodBodies}}
`;
}

export { DATALOADER_NPM, HTTP_LIB_NPM };
