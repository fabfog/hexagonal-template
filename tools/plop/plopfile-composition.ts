import type { NodePlopAPI } from "node-plop";
import registerFeatureCompositionAppGenerator from "./generators/feature-composition-app.ts";
import registerFeatureCompositionWireDataLoaderRegistryGenerator from "./generators/feature-composition-wire-dataloader-registry.ts";
import registerFeatureCompositionWireHttpClientGenerator from "./generators/feature-composition-wire-http-client.ts";
import registerFeatureCompositionWireUseCaseGenerator from "./generators/feature-composition-wire-use-case.ts";
import { applyCommonPlopSetup } from "./plop-register-common.ts";

export function registerCompositionGenerators(plop: NodePlopAPI) {
  registerFeatureCompositionAppGenerator(plop);
  registerFeatureCompositionWireDataLoaderRegistryGenerator(plop);
  registerFeatureCompositionWireHttpClientGenerator(plop);
  registerFeatureCompositionWireUseCaseGenerator(plop);
}

export default function (plop: NodePlopAPI) {
  applyCommonPlopSetup(plop);
  registerCompositionGenerators(plop);
}
