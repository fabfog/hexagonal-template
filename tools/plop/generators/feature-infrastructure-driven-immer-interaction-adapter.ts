import fs from "node:fs";
import path from "node:path";
import type { ActionType, NodePlopAPI } from "node-plop";
import type { Answers } from "inquirer";

import { parseInterfaceMethods, toKebabCase, toPascalCase } from "../lib/casing.ts";
import {
  getRepoApplicationPackageChoicesForFeatureUseCases,
  getRepoInteractionPortChoices,
  readApplicationPackageJsonName,
  readRepoApplicationPortSource,
} from "../lib/repo-application-packages.ts";
import { appendDrivenRootIndexExport } from "../lib/driven-root-index-exports.ts";
import { getRepoDrivenInfrastructurePackageChoices } from "../lib/repo-infrastructure-driven-packages.ts";
import { getRepoRoot } from "../lib/repo-root.ts";
import {
  renderMethodImplementation,
  buildStateInterfaceDeclaration,
  mergeImmerInteractionAdapterFile,
  parseImmerInteractionAdapterMeta,
} from "../lib/merge-immer-interaction-adapter.ts";

const repoRoot = getRepoRoot();

const IMMER_STORE_NPM = "@features/shared-infra-lib-react-immer-store";

export default function registerFeatureInfrastructureDrivenImmerInteractionAdapterGenerator(
  plop: NodePlopAPI
) {
  plop.setGenerator("feature-infrastructure-driven-immer-interaction-adapter", {
    description:
      "Create or merge an Immer-based InteractionPort adapter as a flat file under features/.../infrastructure/driven-*/ (barrel: index.ts; merges missing methods; uses @features/shared-infra-lib-react-immer-store).",
    prompts: [
      {
        type: "list",
        name: "applicationPackageRel",
        message: "Select @features/*-application (source InteractionPort):",
        choices: () => {
          const c = getRepoApplicationPackageChoicesForFeatureUseCases(repoRoot);
          if (!c.length) {
            throw new Error(
              "No feature @features/*-application packages found. Add features/<slug>/application first."
            );
          }
          return c;
        },
      },
      {
        type: "list",
        name: "portFile",
        message: "Select InteractionPort (ports/*.interaction.port.ts):",
        choices: (answers: Answers) => {
          const rel = String(answers.applicationPackageRel ?? "");
          const ports = getRepoInteractionPortChoices(repoRoot, rel);
          if (!ports.length) {
            throw new Error(
              `No InteractionPort (*.interaction.port.ts) in ${rel}/ports. Add an interactive use case or feature-application-port (interaction kind).`
            );
          }
          return ports;
        },
      },
      {
        type: "list",
        name: "drivenPackageRel",
        message: "Select feature-scoped driven-* package (adapter target):",
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
        type: "input",
        name: "adapterBaseName",
        message:
          "Adapter base name (PascalCase, e.g. Editor). Leave empty to derive from the port file name:",
        filter: (value: unknown) => String(value ?? "").trim(),
      },
      {
        type: "checkbox",
        name: "askMethodNames",
        when: (answers: Answers) => {
          const rel = String(answers.applicationPackageRel ?? "");
          const portFile = String(answers.portFile ?? "");
          if (!rel || !portFile) return false;
          const portSource = readRepoApplicationPortSource(repoRoot, rel, portFile);
          const base = portFile.replace(/\.interaction\.port\.ts$/u, "");
          const interfaceName = `${toPascalCase(base)}InteractionPort`;
          const methods = parseInterfaceMethods(portSource, interfaceName);
          return methods.some((m) => /^Promise\s*</.test(m.returnType));
        },
        message:
          "Which port methods use the ask pattern (Promise + currentInteraction, type = method name)? Only Promise<…> methods are listed; others stay as Not implemented stubs.",
        choices: (answers: Answers) => {
          const rel = String(answers.applicationPackageRel ?? "");
          const portFile = String(answers.portFile ?? "");
          const portSource = readRepoApplicationPortSource(repoRoot, rel, portFile);
          const base = portFile.replace(/\.interaction\.port\.ts$/u, "");
          const interfaceName = `${toPascalCase(base)}InteractionPort`;
          const methods = parseInterfaceMethods(portSource, interfaceName);
          return methods
            .filter((m) => /^Promise\s*</.test(m.returnType))
            .map((m) => ({
              name: `${m.name}(${m.params}): ${m.returnType}`,
              value: m.name,
              checked: false,
            }));
        },
      },
    ],
    actions: (data?: Answers): ActionType[] => {
      if (!data) return [];
      const applicationPackageRel = String(data.applicationPackageRel ?? "");
      const portFile = String(data.portFile ?? "");
      const drivenPackageRel = String(data.drivenPackageRel ?? "");
      const adapterBaseNameRaw = String(data.adapterBaseName ?? "").trim();
      const askMethodNames = data.askMethodNames;
      if (!applicationPackageRel || !portFile || !drivenPackageRel) {
        throw new Error("Missing answers for Immer interaction adapter.");
      }

      const askSet = new Set(Array.isArray(askMethodNames) ? askMethodNames : []);
      const portSource = readRepoApplicationPortSource(repoRoot, applicationPackageRel, portFile);
      const base = portFile.replace(/\.interaction\.port\.ts$/u, "");
      const pascalBase = toPascalCase(base);
      const interfaceName = `${pascalBase}InteractionPort`;
      const methods = parseInterfaceMethods(portSource, interfaceName);
      if (!methods.length) {
        throw new Error(
          `No methods found in InteractionPort interface ${interfaceName} (file ${portFile}).`
        );
      }
      for (const name of askSet) {
        const m = methods.find((x) => x.name === name);
        if (!m || !/^Promise\s*</.test(m.returnType)) {
          throw new Error(
            `Invalid ask selection "${name}": must be a port method that returns Promise<…>.`
          );
        }
      }

      const inferredBase = adapterBaseNameRaw || pascalBase;
      const classBase = toPascalCase(inferredBase);
      const className = `Immer${classBase}InteractionAdapter`;
      const fileBase = `immer-${toKebabCase(inferredBase)}.interaction-adapter`;
      const hasAnyAsk = askSet.size > 0;
      const stateInterfaceName = `${classBase}State`;
      const storeTypeName = `${classBase}Store`;

      let methodsCode = "";
      for (const m of methods) {
        methodsCode += renderMethodImplementation(m, askSet);
      }
      const stateDecl = buildStateInterfaceDeclaration(stateInterfaceName, hasAnyAsk);

      const appNpm = readApplicationPackageJsonName(repoRoot, applicationPackageRel);
      const portImportSpecifier = `${appNpm}/ports`;

      const adapterSource = `import type { ${interfaceName} } from "${portImportSpecifier}";
import { createImmerStore, type ExternalStore } from "${IMMER_STORE_NPM}";

${stateDecl}
export type ${storeTypeName} = ExternalStore<${stateInterfaceName}>;

export function get${classBase}Store(initialState: ${stateInterfaceName}): ${storeTypeName} {
  return createImmerStore<${stateInterfaceName}>(initialState);
}

export class ${className} implements ${interfaceName} {
  constructor(public store: ${storeTypeName}) {}
${methodsCode}}
`;

      const baseRel = `../../${drivenPackageRel}`;
      const adapterRelPath = `${baseRel}/${fileBase}.ts`;
      const adapterAbsPath = path.join(repoRoot, ...drivenPackageRel.split("/"), `${fileBase}.ts`);

      const actions: ActionType[] = [];

      if (fs.existsSync(adapterAbsPath)) {
        actions.push({
          type: "modify",
          path: adapterRelPath,
          transform: (content: string) => {
            const meta = parseImmerInteractionAdapterMeta(content);
            if (meta.className !== className || meta.interfaceName !== interfaceName) {
              throw new Error(
                `Existing file declares ${meta.className} implements ${meta.interfaceName}, but this run targets ${className} / ${interfaceName}. Use the same adapter base name (and port) as when the file was created, or remove the file to regenerate.`
              );
            }
            return mergeImmerInteractionAdapterFile(content, {
              stateInterfaceName: meta.stateInterfaceName,
              className: meta.className,
              interfaceName: meta.interfaceName,
              methods,
              askMethodNames: askSet,
            });
          },
        });
      } else {
        actions.push({
          type: "add",
          path: adapterRelPath,
          template: adapterSource,
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
          };
          pkg.dependencies = pkg.dependencies || {};
          if (!pkg.dependencies[appNpm]) {
            pkg.dependencies[appNpm] = "workspace:*";
          }
          if (!pkg.dependencies[IMMER_STORE_NPM]) {
            pkg.dependencies[IMMER_STORE_NPM] = "workspace:*";
          }
          return `${JSON.stringify(pkg, null, 2)}\n`;
        },
      });

      return actions;
    },
  });
}
