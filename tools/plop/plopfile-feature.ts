import type { NodePlopAPI } from "node-plop";
import registerFeatureCoreGenerator from "./generators/feature-core.ts";
import { applyCommonPlopSetup } from "./plop-register-common.ts";

export function registerFeatureGenerators(plop: NodePlopAPI) {
  registerFeatureCoreGenerator(plop);
}

export default function (plop: NodePlopAPI) {
  applyCommonPlopSetup(plop);
  registerFeatureGenerators(plop);
}
