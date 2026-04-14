import fs from "node:fs";
import path from "node:path";
import type { ActionType, NodePlopAPI } from "node-plop";
import type { Answers } from "inquirer";
import { mergeAdapterContent } from "../lib/merge-driven-port-adapter.ts";
import {
  parseExportedInterfaceName,
  parseInterfaceMethods,
  toKebabCase,
  toPascalCase,
} from "../lib/casing.ts";
import {
  appendEnsureFeatureEntityNotFoundErrorActions,
  buildRichRepositoryAdapterSource,
  DATALOADER_NPM,
  getBatchGetByIdKind,
  HTTP_LIB_NPM,
  parseFeatureRepositoryPortMetadata,
  parseRepositoryPortInterfaceNameFromSource,
  type PortMethodSig,
  usesGetByIdBatch,
} from "../lib/repository-port-adapter-feature-codegen.ts";
import {
  getRepoApplicationPackageChoices,
  getRepoRepositoryPortChoices,
  readApplicationPackageJsonName,
  readRepoApplicationPortSource,
} from "../lib/repo-application-packages.ts";
import {
  appendDrivenRootIndexExport,
  stripRepositoriesSubpathExport,
} from "../lib/driven-root-index-exports.ts";
import { getRepoDrivenInfrastructurePackageChoices } from "../lib/repo-infrastructure-driven-packages.ts";
import { getRepoRoot } from "../lib/repo-root.ts";

const repoRoot = getRepoRoot();

/** Imports before `export interface` on the port file (types for thin adapter signatures). */
function leadingFragmentBeforeExportedInterface(source: string): string {
  const m = source.match(/export\s+interface\s+\w+/);
  if (!m || m.index === undefined) {
    return "";
  }
  return source.slice(0, m.index).trimEnd();
}

function buildThinAdapterSource(opts: {
  headBlock: string;
  portImportSpecifier: string;
  interfaceName: string;
  className: string;
  methods: PortMethodSig[];
}): string {
  const { headBlock, portImportSpecifier, interfaceName, className, methods } = opts;
  let methodsCode = "";
  for (const { name, params, returnType } of methods) {
    methodsCode += `\n  ${name}(${params}): ${returnType} {\n    throw new Error("Not implemented!");\n  }\n`;
  }
  if (!methodsCode) {
    methodsCode =
      "\n  // Repository port has no methods yet — add stubs when the port contract grows.\n";
  }
  const portImport = `${headBlock}${headBlock ? "\n" : ""}import type { ${interfaceName} } from "${portImportSpecifier}";\n\n`;
  return `${portImport}export class ${className} implements ${interfaceName} {${methodsCode}}
`;
}

export default function registerFeatureInfrastructureDrivenRepositoryPortAdapterGenerator(
  plop: NodePlopAPI
) {
  plop.setGenerator("feature-infrastructure-driven-repository-port-adapter", {
    description:
      "Create or merge a repository adapter as a flat file under features/.../infrastructure/driven-*/ for *.repository.port.ts (barrel: index.ts). When the port has batchable getById (VO or string id), scaffolds DataLoader + optional Ky (shared lib-http) with the same DataLoader/Ky scaffold strategy used in this repo; otherwise thin stubs + merge.",
    prompts: [
      {
        type: "list",
        name: "applicationPackageRel",
        message: "Select @features/*-application (owns the repository port):",
        choices: () => {
          const c = getRepoApplicationPackageChoices(repoRoot);
          if (!c.length) {
            throw new Error(
              'No @features/*-application packages found. Add features/<slug>/application with "name": "@features/<slug>-application".'
            );
          }
          return c;
        },
      },
      {
        type: "list",
        name: "portFile",
        message: "Select repository port (*.repository.port.ts):",
        choices: (answers: Answers) => {
          const rel = String(answers.applicationPackageRel ?? "");
          const ports = getRepoRepositoryPortChoices(repoRoot, rel);
          if (!ports.length) {
            throw new Error(
              `No repository ports in ${rel}/ports. Add one with feature-application-port (repository kind).`
            );
          }
          return ports;
        },
      },
      {
        type: "list",
        name: "drivenPackageRel",
        message: "Select feature-scoped driven-* package (repository adapter target):",
        choices: () => {
          const c = getRepoDrivenInfrastructurePackageChoices(repoRoot, {
            excludeFeaturesSharedInfrastructure: true,
          });
          if (!c.length) {
            throw new Error(
              "No feature-scoped driven-* packages. Run feature-infrastructure-driven-package first."
            );
          }
          return c;
        },
      },
      {
        type: "confirm",
        name: "useKyHttpClient",
        default: true,
        message:
          "When batch getById is detected: include shared HttpClient (`@features/shared-infra-lib-http`) in adapter deps? Choose No if you will use an SDK only (fetchManyByIds stays TODO).",
      },
      {
        type: "input",
        name: "adapterBaseName",
        message:
          "Adapter base name (PascalCase, e.g. LineItemRepository → LineItemRepositoryAdapter). Leave empty to derive from the port interface:",
        filter: (value: unknown) => String(value ?? "").trim(),
      },
    ],
    actions: (data?: Answers): ActionType[] => {
      if (!data) return [];
      const applicationPackageRel = String(data.applicationPackageRel ?? "");
      const portFile = String(data.portFile ?? "");
      const drivenPackageRel = String(data.drivenPackageRel ?? "");
      const adapterBaseNameRaw = String(data.adapterBaseName ?? "").trim();
      const useKyHttpClient = data.useKyHttpClient !== false;
      if (!applicationPackageRel || !portFile || !drivenPackageRel) {
        throw new Error("Missing answers for driven repository port adapter.");
      }

      const portSource = readRepoApplicationPortSource(repoRoot, applicationPackageRel, portFile);
      const interfaceName =
        parseExportedInterfaceName(portSource) ??
        parseRepositoryPortInterfaceNameFromSource(portSource);
      const methods = parseInterfaceMethods(portSource, interfaceName);

      const meta = parseFeatureRepositoryPortMetadata(repoRoot, portSource);
      const batch = usesGetByIdBatch(methods, meta.entityClassName, meta.entityPascal);

      const defaultAdapterBase = interfaceName.replace(/Port$/u, "");
      const inferredBase = adapterBaseNameRaw || defaultAdapterBase;
      const classBase = toPascalCase(inferredBase);
      const className = `${classBase}Adapter`;
      const fileBase = `${toKebabCase(inferredBase)}.adapter`;

      const appNpm = readApplicationPackageJsonName(repoRoot, applicationPackageRel);
      const portImportSpecifier = `${appNpm}/ports`;

      const baseRel = `../../${drivenPackageRel}`;
      const adapterRelPath = `${baseRel}/${fileBase}.ts`;
      const adapterAbsPath = path.join(repoRoot, ...drivenPackageRel.split("/"), `${fileBase}.ts`);

      const actions: ActionType[] = [];

      if (batch) {
        appendEnsureFeatureEntityNotFoundErrorActions(actions, {
          repoRoot,
          domainPackageRel: meta.domainPackageRel,
          entityPascal: meta.entityPascal,
        });
      }

      if (fs.existsSync(adapterAbsPath) && batch) {
        throw new Error(
          `Repository adapter already exists: ${path.relative(repoRoot, adapterAbsPath)}. ` +
            "Remove it to generate the full DataLoader/HTTP scaffold, or use merge on a non-batch adapter only."
        );
      }

      if (!fs.existsSync(adapterAbsPath)) {
        if (batch) {
          const batchKind = getBatchGetByIdKind(methods, meta.entityClassName, meta.entityPascal);
          if (!batchKind) {
            throw new Error("Internal: batch getById expected but batch kind is null.");
          }
          const adapterSource = buildRichRepositoryAdapterSource({
            portImportSpecifier,
            interfaceName,
            className,
            domainNpmName: meta.domainNpmName,
            entityClassName: meta.entityClassName,
            entityPascal: meta.entityPascal,
            methods,
            useKyHttpClient,
          });
          actions.push({
            type: "add",
            path: adapterRelPath,
            template: adapterSource,
          });
        } else {
          const portHead = leadingFragmentBeforeExportedInterface(portSource);
          const headBlock = portHead ? `${portHead}\n` : "";
          actions.push({
            type: "add",
            path: adapterRelPath,
            template: buildThinAdapterSource({
              headBlock,
              portImportSpecifier,
              interfaceName,
              className,
              methods,
            }),
          });
        }
      } else {
        actions.push({
          type: "modify",
          path: adapterRelPath,
          transform: (content: string) =>
            mergeAdapterContent(content, { className, interfaceName, methods }),
        });
      }

      actions.push({
        type: "modify",
        path: `${baseRel}/index.ts`,
        transform: (file: string) => appendDrivenRootIndexExport(file, fileBase),
      });
      actions.push({
        type: "modify",
        path: `${baseRel}/package.json`,
        transform: (file: string) => {
          const pkg = JSON.parse(file) as {
            dependencies?: Record<string, string>;
            exports?: Record<string, unknown>;
          };
          stripRepositoriesSubpathExport(pkg);
          pkg.dependencies = pkg.dependencies || {};
          if (!pkg.dependencies[appNpm]) {
            pkg.dependencies[appNpm] = "workspace:*";
          }
          if (!pkg.dependencies[meta.domainNpmName]) {
            pkg.dependencies[meta.domainNpmName] = "workspace:*";
          }
          if (batch) {
            if (!pkg.dependencies[DATALOADER_NPM]) {
              pkg.dependencies[DATALOADER_NPM] = "workspace:*";
            }
            if (useKyHttpClient && !pkg.dependencies[HTTP_LIB_NPM]) {
              pkg.dependencies[HTTP_LIB_NPM] = "workspace:*";
            }
          }
          return `${JSON.stringify(pkg, null, 2)}\n`;
        },
      });

      return actions;
    },
  });
}
