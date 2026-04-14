import type { NodePlopAPI } from "node-plop";
import registerFeatureDomainEntityGenerator from "./generators/feature-domain-entity.ts";
import registerFeatureDomainEntityAddVoFieldGenerator from "./generators/feature-domain-entity-add-vo-field.ts";
import registerFeatureDomainErrorGenerator from "./generators/feature-domain-error.ts";
import registerFeatureDomainServiceGenerator from "./generators/feature-domain-service.ts";
import registerFeatureDomainValueObjectGenerator from "./generators/feature-domain-value-object.ts";
import { applyCommonPlopSetup } from "./plop-register-common.ts";

export function registerDomainGenerators(plop: NodePlopAPI) {
  registerFeatureDomainEntityGenerator(plop);
  registerFeatureDomainValueObjectGenerator(plop);
  registerFeatureDomainErrorGenerator(plop);
  registerFeatureDomainServiceGenerator(plop);
  registerFeatureDomainEntityAddVoFieldGenerator(plop);
}

export default function (plop: NodePlopAPI) {
  applyCommonPlopSetup(plop);
  registerDomainGenerators(plop);
}
