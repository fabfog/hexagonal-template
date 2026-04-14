import fs from "node:fs";
import path from "node:path";
import type { ActionType, NodePlopAPI } from "node-plop";
import type { Answers } from "inquirer";
import { mergeAdapterContent } from "../lib/merge-driven-port-adapter.ts";
import { parseInterfaceMethods, toKebabCase, toPascalCase } from "../lib/casing.ts";
import {
  getRepoApplicationPackageChoices,
  getRepoNormalPortChoices,
  readApplicationPackageJsonName,
  readRepoApplicationPortSource,
} from "../lib/repo-application-packages.ts";
import { appendDrivenRootIndexExport } from "../lib/driven-root-index-exports.ts";
import { getRepoDrivenInfrastructurePackageChoices } from "../lib/repo-infrastructure-driven-packages.ts";
import { getRepoRoot } from "../lib/repo-root.ts";

const repoRoot = getRepoRoot();

export default function registerFeatureInfrastructureDrivenPortAdapterGenerator(plop: NodePlopAPI) {
  plop.setGenerator("feature-infrastructure-driven-port-adapter", {
    description:
      "Create or merge a concrete adapter for a normal Port (not repository, not interaction) as a flat file under features/.../infrastructure/driven-*/ (barrel: index.ts).",
    prompts: [
      {
        type: "list",
        name: "applicationPackageRel",
        message: "Select @features/*-application (owns the port):",
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
        message:
          "Select Port (*.port.ts — excludes *.repository.port.ts and *.interaction.port.ts):",
        choices: (answers: Answers) => {
          const rel = String(answers.applicationPackageRel ?? "");
          const ports = getRepoNormalPortChoices(repoRoot, rel);
          if (!ports.length) {
            throw new Error(
              `No normal ports in ${rel}/ports. Add a port with feature-application-port (kind “other” or similar), not repository/interaction.`
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
          "Adapter base name (PascalCase, e.g. DemoClock). Leave empty to derive from the port file name:",
        filter: (value: unknown) => String(value ?? "").trim(),
      },
    ],
    actions: (data?: Answers): ActionType[] => {
      if (!data) return [];
      const applicationPackageRel = String(data.applicationPackageRel ?? "");
      const portFile = String(data.portFile ?? "");
      const drivenPackageRel = String(data.drivenPackageRel ?? "");
      const adapterBaseNameRaw = String(data.adapterBaseName ?? "").trim();
      if (!applicationPackageRel || !portFile || !drivenPackageRel) {
        throw new Error("Missing answers for driven port adapter.");
      }

      const portSource = readRepoApplicationPortSource(repoRoot, applicationPackageRel, portFile);
      const base = portFile.replace(/\.port\.ts$/u, "");
      const pascalBase = toPascalCase(base);
      const interfaceName = `${pascalBase}Port`;
      const methods = parseInterfaceMethods(portSource, interfaceName);

      const inferredBase = adapterBaseNameRaw || pascalBase;
      const classBase = toPascalCase(inferredBase);
      const className = `${classBase}Adapter`;
      const fileBase = `${toKebabCase(inferredBase)}.adapter`;

      let methodsCode = "";
      for (const { name, params, returnType } of methods) {
        methodsCode += `\n  ${name}(${params}): ${returnType} {\n    throw new Error("Not implemented!");\n  }\n`;
      }
      if (!methodsCode) {
        methodsCode = "\n  // Port has no methods yet — add method stubs when the port grows.\n";
      }

      const appNpm = readApplicationPackageJsonName(repoRoot, applicationPackageRel);
      const portImportSpecifier = `${appNpm}/ports`;
      const adapterSource = `import type { ${interfaceName} } from "${portImportSpecifier}";

export class ${className} implements ${interfaceName} {${methodsCode}}
`;

      const baseRel = `../../${drivenPackageRel}`;
      const adapterRelPath = `${baseRel}/${fileBase}.ts`;
      const adapterAbsPath = path.join(repoRoot, ...drivenPackageRel.split("/"), `${fileBase}.ts`);

      const actions: ActionType[] = [];
      if (fs.existsSync(adapterAbsPath)) {
        actions.push({
          type: "modify",
          path: adapterRelPath,
          transform: (content: string) =>
            mergeAdapterContent(content, { className, interfaceName, methods }),
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
          return `${JSON.stringify(pkg, null, 2)}\n`;
        },
      });

      return actions;
    },
  });
}
