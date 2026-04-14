import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Answers } from "inquirer";
import nodePlop, { type NodePlopAPI } from "node-plop";

import { getStratifiedGeneratorChoices } from "../lib/stratified-generator-choices.ts";

const plopfileAbs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../plopfile.ts");

export default function registerScaffoldGenerator(plop: NodePlopAPI) {
  plop.setGenerator("scaffold", {
    description:
      "Stratified menu: pick Core → Domain → Application → Infrastructure → Composition (then run the selected generator)",
    prompts: [
      {
        type: "list",
        name: "targetGenerator",
        message: "Which scaffold do you want to run?",
        choices: getStratifiedGeneratorChoices,
      },
    ],
    actions: [
      async (answers: Answers) => {
        const target = String((answers as { targetGenerator?: string }).targetGenerator ?? "").trim();
        if (!target) {
          throw new Error("No generator selected.");
        }
        if (target === "scaffold") {
          throw new Error('Pick a concrete generator, not "scaffold".');
        }

        const engine = await nodePlop(plopfileAbs);
        const gen = engine.getGenerator(target);
        const subAnswers = await gen.runPrompts();
        const { failures } = await gen.runActions(subAnswers);
        if (failures.length > 0) {
          const msg = failures.map((f) => f.error || f.message).filter(Boolean).join("\n");
          throw new Error(msg || "One or more actions failed.");
        }
        return `Completed: ${target}`;
      },
    ],
  });
}
