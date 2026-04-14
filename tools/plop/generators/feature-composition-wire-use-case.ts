import type { NodePlopAPI } from "node-plop";
import type { Answers } from "inquirer";
import inquirer from "inquirer";
import { decodeUnifiedUseCaseSliceChoice } from "../lib/add-port-to-repo-application-slice.ts";
import { getRepoCompositionPackageChoices } from "../lib/composition-packages.ts";
import {
  ADAPTER_SKIP_VALUE,
  applyCompositionWireUseCase,
  findAdapterImplementations,
  listNormalPortDepsFromUseCase,
  readInfrastructureGetForContextReturnPropertyNames,
  simplePortTypeName,
  type AdapterPick,
  type PortWiringSelection,
} from "../lib/composition-wire-use-case.ts";
import { featureSegmentFromApplicationPackageRel } from "../lib/repo-application-from-domain.ts";
import { getRepoApplicationPackageChoicesForFeatureUseCases } from "../lib/repo-application-packages.ts";
import { getRepoApplicationUnifiedUseCaseSliceChoices } from "../lib/repo-application-slice-choices.ts";
import { getRepoRoot } from "../lib/repo-root.ts";

const repoRoot = getRepoRoot();

function encodeAdapterPickForChoice(adapter: AdapterPick): string {
  return JSON.stringify(adapter);
}

function decodeAdapterChoice(raw: string): AdapterPick | typeof ADAPTER_SKIP_VALUE {
  if (raw === ADAPTER_SKIP_VALUE) {
    return ADAPTER_SKIP_VALUE;
  }
  return JSON.parse(raw) as AdapterPick;
}

export default function registerFeatureCompositionWireUseCaseGenerator(plop: NodePlopAPI) {
  plop.setGenerator("feature-composition-wire-use-case", {
    description:
      "Wire a standard or interactive use case into a feature composition package: prompts per normal port (app vs request scope, adapter or skip), updates getForContext and the use-case factory in composition index.ts. For scripts, pass answers.nonInteractiveCompositionWire === true to skip prompts (request-scoped + adapter skip: unwired ports throw at runtime with a FIXME message, no type assertions).",
    prompts: [
      {
        type: "list",
        name: "applicationPackageRel",
        message: "Select @features/*-application package (use case lives here):",
        choices: () => {
          const c = getRepoApplicationPackageChoicesForFeatureUseCases(repoRoot);
          if (!c.length) {
            throw new Error(
              'No feature @features/*-application packages found. Add features/<slug>/application/package.json with "name": "@features/<slug>-application".'
            );
          }
          return c;
        },
      },
      {
        type: "list",
        name: "useCaseSlice",
        message: "Select use case (standard or interactive):",
        choices: (answers: Answers) =>
          getRepoApplicationUnifiedUseCaseSliceChoices(
            repoRoot,
            String(answers.applicationPackageRel ?? "")
          ),
      },
      {
        type: "list",
        name: "compositionPackageRel",
        message: "Select composition package for this feature:",
        choices: (answers: Answers) => {
          const appRel = String(answers.applicationPackageRel ?? "");
          const c = getRepoCompositionPackageChoices(repoRoot, appRel);
          if (!c.length) {
            throw new Error(
              `No composition packages under features/<slug>/composition/ for "${appRel}". Run feature-composition-app first.`
            );
          }
          return c;
        },
      },
    ],
    actions: [
      async (answers: Answers) => {
        const applicationPackageRel = String(answers.applicationPackageRel ?? "");
        const compositionPackageRel = String(answers.compositionPackageRel ?? "");
        const encoded = String(answers.useCaseSlice ?? "");
        const { sliceKind, sliceNamePascal } = decodeUnifiedUseCaseSliceChoice(encoded);

        const featureKebab = featureSegmentFromApplicationPackageRel(applicationPackageRel);
        const existingReturn = readInfrastructureGetForContextReturnPropertyNames(
          repoRoot,
          compositionPackageRel
        );
        const deps = listNormalPortDepsFromUseCase(
          repoRoot,
          applicationPackageRel,
          sliceKind,
          sliceNamePascal
        );

        if (answers.nonInteractiveCompositionWire === true) {
          const wirings: PortWiringSelection[] = [];
          for (const dep of deps) {
            if (existingReturn.has(dep.propName)) {
              continue;
            }
            wirings.push({
              propName: dep.propName,
              typeName: dep.typeName,
              portTypeSpecifierFromUseCase: dep.portTypeSpecifierFromUseCase,
              scope: "request",
              adapter: ADAPTER_SKIP_VALUE,
            });
          }
          applyCompositionWireUseCase({
            repoRoot,
            compositionPackageRel,
            applicationPackageRel,
            sliceKind,
            sliceNamePascal,
            wirings,
          });
          if (wirings.length === 0) {
            return (
              "No new normal ports to wire (getForContext already exposes every non-interaction dep), " +
              "or use case has no normal ports."
            );
          }
          return `Non-interactive: wired ${wirings.length} port(s) into ${compositionPackageRel} (skipped adapters throw at runtime until wired).`;
        }

        const wirings: PortWiringSelection[] = [];

        for (const dep of deps) {
          if (existingReturn.has(dep.propName)) {
            continue;
          }

          const { scope } = await inquirer.prompt<{ scope: "app" | "request" }>([
            {
              type: "list",
              name: "scope",
              message: `Port "${dep.propName}" (${dep.typeName}): lifetime?`,
              choices: [
                {
                  name: "App-scoped (private field on provider + this.prop in getForContext)",
                  value: "app",
                },
                {
                  name: "Request-scoped (private get…(ctx) on provider + call from getForContext)",
                  value: "request",
                },
              ],
            },
          ]);

          const iface = simplePortTypeName(dep.typeName);
          const adapters = findAdapterImplementations(repoRoot, featureKebab, iface);
          const adapterChoices: { name: string; value: string }[] = [
            {
              name: "Skip — unwired stub (throws at runtime with FIXME until you wire an adapter)",
              value: ADAPTER_SKIP_VALUE,
            },
            ...adapters.map((a) => ({
              name: `${a.className} (${a.npmName})`,
              value: encodeAdapterPickForChoice(a),
            })),
          ];

          const { adapterRaw } = await inquirer.prompt<{ adapterRaw: string }>([
            {
              type: "list",
              name: "adapterRaw",
              message: `Adapter implementing ${iface} for "${dep.propName}":`,
              choices: adapterChoices,
            },
          ]);

          const adapter = decodeAdapterChoice(adapterRaw);

          wirings.push({
            propName: dep.propName,
            typeName: dep.typeName,
            portTypeSpecifierFromUseCase: dep.portTypeSpecifierFromUseCase,
            scope,
            adapter,
          });
        }

        applyCompositionWireUseCase({
          repoRoot,
          compositionPackageRel,
          applicationPackageRel,
          sliceKind,
          sliceNamePascal,
          wirings,
        });

        if (wirings.length === 0) {
          return "No new normal ports to wire (getForContext already exposes every non-interaction dep), or use case has no normal ports.";
        }
        return `Wired ${wirings.length} port(s) into ${compositionPackageRel}.`;
      },
    ],
  });
}
