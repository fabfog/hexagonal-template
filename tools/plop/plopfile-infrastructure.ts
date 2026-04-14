import type { NodePlopAPI } from "node-plop";
import registerFeatureInfrastructureDrivenImmerInteractionAdapterGenerator from "./generators/feature-infrastructure-driven-immer-interaction-adapter.ts";
import registerFeatureInfrastructureDrivenPackageGenerator from "./generators/feature-infrastructure-driven-package.ts";
import registerFeatureInfrastructureDrivenPortAdapterGenerator from "./generators/feature-infrastructure-driven-port-adapter.ts";
import registerFeatureInfrastructureDrivenRepositoryPortAdapterGenerator from "./generators/feature-infrastructure-driven-repository-port-adapter.ts";
import registerFeatureInfrastructureLibPackageGenerator from "./generators/feature-infrastructure-lib-package.ts";
import registerFeatureInfrastructureRawToDomainEntityMapperGenerator from "./generators/feature-infrastructure-raw-to-domain-entity-mapper.ts";
import { applyCommonPlopSetup } from "./plop-register-common.ts";

export function registerInfrastructureGenerators(plop: NodePlopAPI) {
  registerFeatureInfrastructureDrivenPackageGenerator(plop);
  registerFeatureInfrastructureLibPackageGenerator(plop);
  registerFeatureInfrastructureDrivenPortAdapterGenerator(plop);
  registerFeatureInfrastructureDrivenImmerInteractionAdapterGenerator(plop);
  registerFeatureInfrastructureDrivenRepositoryPortAdapterGenerator(plop);
  registerFeatureInfrastructureRawToDomainEntityMapperGenerator(plop);
}

export default function (plop: NodePlopAPI) {
  applyCommonPlopSetup(plop);
  registerInfrastructureGenerators(plop);
}
