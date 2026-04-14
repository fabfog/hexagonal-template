import type { NodePlopAPI } from "node-plop";
import type { Answers } from "inquirer";
import {
  buildAddPortDependencyToRepoSliceActions,
  decodeUnifiedUseCaseSliceChoice,
  defaultRepoPortPropertyName,
  portChoicesNotYetInRepoSliceDeps,
  validateRepoPortPropertyName,
} from "../lib/add-port-to-repo-application-slice.ts";
import { getRepoApplicationPackageChoices } from "../lib/repo-application-packages.ts";
import { getRepoApplicationUnifiedUseCaseSliceChoices } from "../lib/repo-application-slice-choices.ts";
import { getRepoRoot } from "../lib/repo-root.ts";

const repoRoot = getRepoRoot();

export default function registerFeatureApplicationAddDependencyToUseCaseGenerator(
  plop: NodePlopAPI
) {
  plop.setGenerator("feature-application-add-dependency-to-use-case", {
    description:
      "Add a normal application port to a use case deps interface (standard or interactive). *.interaction.port.ts files are excluded — they ship with the interactive use case and are passed to execute(...).",
    prompts: [
      {
        type: "list",
        name: "applicationSliceRel",
        message: "Select @features/*-application package (slice lives here):",
        choices: () => {
          const c = getRepoApplicationPackageChoices(repoRoot);
          if (!c.length) {
            throw new Error(
              'No @features/*-application packages found. Add features/<feature>/application/package.json with "name": "@features/<slug>-application".'
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
            String(answers.applicationSliceRel ?? "")
          ),
      },
      {
        type: "list",
        name: "portApplicationRel",
        message: "Select package that owns the port:",
        choices: () => getRepoApplicationPackageChoices(repoRoot),
      },
      {
        type: "list",
        name: "portFileName",
        message: "Select port to inject:",
        choices: (answers: Answers) => {
          const sliceRel = String(answers.applicationSliceRel ?? "");
          const encoded = String(answers.useCaseSlice ?? "");
          const portRel = String(answers.portApplicationRel ?? "");
          if (!sliceRel || !encoded || !portRel) {
            return [];
          }
          try {
            const { sliceKind, sliceNamePascal } = decodeUnifiedUseCaseSliceChoice(encoded);
            return portChoicesNotYetInRepoSliceDeps(repoRoot, {
              applicationSliceRel: sliceRel,
              sliceKind,
              sliceNamePascal,
              portApplicationRel: portRel,
              allPortsPresentMessage:
                "All ports from that package are already listed on this slice's deps interface.",
            });
          } catch {
            return [];
          }
        },
      },
      {
        type: "input",
        name: "portPropertyName",
        message: "Dependency property name in deps (collision-safe):",
        default: (answers: Answers) =>
          defaultRepoPortPropertyName(
            repoRoot,
            String(answers.portApplicationRel ?? ""),
            String(answers.portFileName ?? "")
          ),
        validate: (value: unknown, answers: Answers) =>
          validateRepoPortPropertyName(value, answers, repoRoot),
        filter: (value: unknown) => String(value || "").trim(),
      },
    ],
    actions: (data?: Answers) => {
      if (!data) return [];
      const { sliceKind, sliceNamePascal } = decodeUnifiedUseCaseSliceChoice(
        String(data.useCaseSlice ?? "")
      );
      return buildAddPortDependencyToRepoSliceActions(repoRoot, {
        applicationSliceRel: String(data.applicationSliceRel ?? ""),
        sliceKind,
        sliceNamePascal,
        portApplicationRel: String(data.portApplicationRel ?? ""),
        portFileName: String(data.portFileName ?? ""),
        portPropertyName: String(data.portPropertyName ?? "").trim(),
      });
    },
  });
}
