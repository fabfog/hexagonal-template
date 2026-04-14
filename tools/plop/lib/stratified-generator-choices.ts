import inquirer from "inquirer";

/**
 * Ordered, grouped choices for `pnpm plop scaffold` (matches repo generator names).
 */
export function getStratifiedGeneratorChoices(): (
  | inquirer.Separator
  | { name: string; value: string }
)[] {
  const S = inquirer.Separator;
  return [
    new S("── Feature ──"),
    {
      name: "Feature workspace (domain + application packages)",
      value: "feature-core",
    },
    new S("── Domain ──"),
    {
      name: "Entity",
      value: "feature-domain-entity",
    },
    {
      name: "Value object",
      value: "feature-domain-value-object",
    },
    {
      name: "Domain error",
      value: "feature-domain-error",
    },
    {
      name: "Domain service",
      value: "feature-domain-service",
    },
    {
      name: "Add VO field to entity",
      value: "feature-domain-entity-add-vo-field",
    },
    new S("── Application ──"),
    {
      name: "Use case",
      value: "feature-application-use-case",
    },
    {
      name: "Add dependency to use case",
      value: "feature-application-add-dependency-to-use-case",
    },
    {
      name: "Port",
      value: "feature-application-port",
    },
    {
      name: "Entity → DTO mapper",
      value: "feature-application-entity-to-dto-mapper",
    },
    new S("── Infrastructure ──"),
    {
      name: "Driven package",
      value: "feature-infrastructure-driven-package",
    },
    {
      name: "Lib package",
      value: "feature-infrastructure-lib-package",
    },
    {
      name: "Driven port adapter",
      value: "feature-infrastructure-driven-port-adapter",
    },
    {
      name: "Driven repository port adapter",
      value: "feature-infrastructure-driven-repository-port-adapter",
    },
    {
      name: "Raw → domain entity mapper",
      value: "feature-infrastructure-raw-to-domain-entity-mapper",
    },
    {
      name: "Driven Immer interaction adapter",
      value: "feature-infrastructure-driven-immer-interaction-adapter",
    },
    new S("── Composition ──"),
    {
      name: "Composition app package",
      value: "feature-composition-app",
    },
    {
      name: "Wire use case",
      value: "feature-composition-wire-use-case",
    },
    {
      name: "Wire HTTP client",
      value: "feature-composition-wire-http-client",
    },
    {
      name: "Wire DataLoader registry",
      value: "feature-composition-wire-dataloader-registry",
    },
  ];
}
