import type { NodePlopAPI } from "node-plop";
import { getRepoRoot } from "./lib/repo-root.ts";
import { resolveWorkspaceDependencyVersion } from "./lib/workspace-dependency-version.ts";
import registerScaffoldGenerator from "./generators/scaffold.ts";
import registerFeatureCoreGenerator from "./generators/feature-core.ts";
import registerFeatureDomainEntityGenerator from "./generators/feature-domain-entity.ts";
import registerFeatureDomainValueObjectGenerator from "./generators/feature-domain-value-object.ts";
import registerFeatureDomainErrorGenerator from "./generators/feature-domain-error.ts";
import registerFeatureDomainServiceGenerator from "./generators/feature-domain-service.ts";
import registerFeatureDomainEntityAddVoFieldGenerator from "./generators/feature-domain-entity-add-vo-field.ts";
import registerFeatureApplicationEntityToDtoMapperGenerator from "./generators/feature-application-entity-to-dto-mapper.ts";
import registerFeatureApplicationPortGenerator from "./generators/feature-application-port.ts";
import registerFeatureInfrastructureDrivenPackageGenerator from "./generators/feature-infrastructure-driven-package.ts";
import registerFeatureInfrastructureLibPackageGenerator from "./generators/feature-infrastructure-lib-package.ts";
import registerFeatureInfrastructureDrivenPortAdapterGenerator from "./generators/feature-infrastructure-driven-port-adapter.ts";
import registerFeatureInfrastructureDrivenImmerInteractionAdapterGenerator from "./generators/feature-infrastructure-driven-immer-interaction-adapter.ts";
import registerFeatureInfrastructureDrivenRepositoryPortAdapterGenerator from "./generators/feature-infrastructure-driven-repository-port-adapter.ts";
import registerFeatureInfrastructureRawToDomainEntityMapperGenerator from "./generators/feature-infrastructure-raw-to-domain-entity-mapper.ts";
import registerFeatureCompositionAppGenerator from "./generators/feature-composition-app.ts";
import registerFeatureCompositionWireDataLoaderRegistryGenerator from "./generators/feature-composition-wire-dataloader-registry.ts";
import registerFeatureCompositionWireHttpClientGenerator from "./generators/feature-composition-wire-http-client.ts";
import registerFeatureCompositionWireUseCaseGenerator from "./generators/feature-composition-wire-use-case.ts";
import registerFeatureApplicationUseCaseGenerator from "./generators/feature-application-use-case.ts";
import registerFeatureApplicationAddDependencyToUseCaseGenerator from "./generators/feature-application-add-dependency-to-use-case.ts";

export default function (plop: NodePlopAPI) {
  const repoRoot = getRepoRoot();
  plop.setHelper("workspaceDependencyVersion", (depName: unknown) => {
    const resolved = resolveWorkspaceDependencyVersion(repoRoot, String(depName));
    if (!resolved) {
      throw new Error(`Could not resolve a workspace version for dependency "${depName}"`);
    }
    return resolved;
  });
  registerScaffoldGenerator(plop);
  registerFeatureCoreGenerator(plop);
  registerFeatureDomainEntityGenerator(plop);
  registerFeatureDomainValueObjectGenerator(plop);
  registerFeatureDomainErrorGenerator(plop);
  registerFeatureDomainServiceGenerator(plop);
  registerFeatureDomainEntityAddVoFieldGenerator(plop);
  registerFeatureApplicationEntityToDtoMapperGenerator(plop);
  registerFeatureApplicationPortGenerator(plop);
  registerFeatureInfrastructureDrivenPackageGenerator(plop);
  registerFeatureInfrastructureLibPackageGenerator(plop);
  registerFeatureInfrastructureDrivenPortAdapterGenerator(plop);
  registerFeatureInfrastructureDrivenImmerInteractionAdapterGenerator(plop);
  registerFeatureInfrastructureDrivenRepositoryPortAdapterGenerator(plop);
  registerFeatureInfrastructureRawToDomainEntityMapperGenerator(plop);
  registerFeatureCompositionAppGenerator(plop);
  registerFeatureCompositionWireDataLoaderRegistryGenerator(plop);
  registerFeatureCompositionWireHttpClientGenerator(plop);
  registerFeatureCompositionWireUseCaseGenerator(plop);
  registerFeatureApplicationUseCaseGenerator(plop);
  registerFeatureApplicationAddDependencyToUseCaseGenerator(plop);
}
