import type { NodePlopAPI } from "node-plop";
import registerFeatureApplicationAddDependencyToUseCaseGenerator from "./generators/feature-application-add-dependency-to-use-case.ts";
import registerFeatureApplicationEntityToDtoMapperGenerator from "./generators/feature-application-entity-to-dto-mapper.ts";
import registerFeatureApplicationPortGenerator from "./generators/feature-application-port.ts";
import registerFeatureApplicationUseCaseGenerator from "./generators/feature-application-use-case.ts";
import { applyCommonPlopSetup } from "./plop-register-common.ts";

export function registerApplicationGenerators(plop: NodePlopAPI) {
  registerFeatureApplicationEntityToDtoMapperGenerator(plop);
  registerFeatureApplicationPortGenerator(plop);
  registerFeatureApplicationUseCaseGenerator(plop);
  registerFeatureApplicationAddDependencyToUseCaseGenerator(plop);
}

export default function (plop: NodePlopAPI) {
  applyCommonPlopSetup(plop);
  registerApplicationGenerators(plop);
}
