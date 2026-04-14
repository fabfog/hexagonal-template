import fs from "node:fs";
import path from "node:path";
import type { NodePlopAPI } from "node-plop";
import type { Answers } from "inquirer";
import {
  ensureCompositionDependsOnDataLoaderLib,
  wireDataLoaderRegistryIntoCompositionInfrastructure,
} from "../lib/wire-dataloader-registry-in-composition-infra.ts";
import { getAllFeatureCompositionPackageChoices } from "../lib/composition-packages.ts";
import { getRepoRoot } from "../lib/repo-root.ts";

const repoRoot = getRepoRoot();

export default function registerFeatureCompositionWireDataLoaderRegistryGenerator(
  plop: NodePlopAPI
) {
  plop.setGenerator("feature-composition-wire-dataloader-registry", {
    description:
      "Wire a request-scoped DataLoaderRegistry into a feature composition package `index.ts` (*InfrastructureProvider#getForContext) using @features/shared-infra-lib-dataloader.",
    prompts: [
      {
        type: "list",
        name: "compositionPackageRel",
        message: "Composition package (features/<feature>/composition/<app>/):",
        choices: () => {
          const c = getAllFeatureCompositionPackageChoices(repoRoot);
          if (!c.length) {
            throw new Error(
              'No feature composition packages found. Run "feature-composition-app" for a feature first.'
            );
          }
          return c;
        },
      },
      {
        type: "input",
        name: "propName",
        message:
          "Property name on the object returned from getForContext (camelCase, e.g. loaders):",
        default: "loaders",
        validate: (value: unknown) => {
          const v = String(value ?? "").trim();
          if (!v) return "Property name is required";
          if (!/^[a-z][a-zA-Z0-9]*$/.test(v)) return "Use a valid camelCase identifier";
          return true;
        },
      },
    ],
    actions: [
      (data?: Answers) => {
        if (!data) return "";
        const compositionRel = String(data.compositionPackageRel ?? "").trim();
        const propName = String(data.propName ?? "").trim();
        if (!compositionRel || !propName) {
          throw new Error("Missing composition package or prop name.");
        }
        const indexPath = path.join(repoRoot, ...compositionRel.split("/"), "index.ts");
        if (!fs.existsSync(indexPath)) {
          throw new Error(
            `Missing ${path.relative(repoRoot, indexPath)}. Run feature-composition-app first.`
          );
        }
        const pkgJsonPath = path.join(repoRoot, ...compositionRel.split("/"), "package.json");
        ensureCompositionDependsOnDataLoaderLib(pkgJsonPath);
        const next = wireDataLoaderRegistryIntoCompositionInfrastructure(indexPath, {
          propName,
        });
        fs.writeFileSync(indexPath, next, "utf8");
        return `Wired request-scoped DataLoader registry in ${path.relative(repoRoot, indexPath)}`;
      },
    ],
  });
}
