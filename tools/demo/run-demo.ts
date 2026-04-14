/**
 * Non-interactive scaffold demo using `tools/plop` generators.
 *
 * Creates `features/plop-demo/` (domain + application), domain slices (incl. composite VO),
 * errors (custom + not-found), application DTO/mapper, all three port kinds, a feature-scoped
 * composition package (`features/plop-demo/composition/web`), then request-scoped **loaders** and
 * **httpClient** on that hub, driven infrastructure packages (`driven-demo-clock`,
 * `driven-line-item`), `DemoClockPort` + `LineItemRepositoryPort` adapters (Ky-backed repo),
 * raw-to-domain mapper, standard + interactive use cases, a manual patch to
 * `AcknowledgePlopDemoInteractionPort` plus an **Immer** adapter on `driven-demo-clock`, infra lib
 * package, add use-case port dependency, and non-interactive composition wiring for
 * `RecordLineItem` (27 steps; exercises every generator across the layer plopfiles in `tools/plop/`).
 *
 * Usage (from repo root):
 *   pnpm demo:scaffold
 *
 * Re-run: remove `features/plop-demo` or pass `--force` to delete it first.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodePlop from "node-plop";
import { applyCommonPlopSetup } from "../plop/plop-register-common.ts";
import { registerApplicationGenerators } from "../plop/plopfile-application.ts";
import { registerCompositionGenerators } from "../plop/plopfile-composition.ts";
import { registerDomainGenerators } from "../plop/plopfile-domain.ts";
import { registerFeatureGenerators } from "../plop/plopfile-feature.ts";
import { registerInfrastructureGenerators } from "../plop/plopfile-infrastructure.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const toolsPlopDir = path.join(repoRoot, "tools", "plop");

const DEMO_FEATURE_NAME = "Plop Demo";
const DEMO_DOMAIN_REL = "features/plop-demo/domain";
const DEMO_APPLICATION_REL = "features/plop-demo/application";
const DEMO_DRIVEN_LINE_ITEM_REL = "features/plop-demo/infrastructure/driven-line-item";
const DEMO_DRIVEN_DEMO_CLOCK_REL = "features/plop-demo/infrastructure/driven-demo-clock";
const DEMO_COMPOSITION_WEB_REL = "features/plop-demo/composition/web";
const demoFeatureDir = path.join(repoRoot, "features", "plop-demo");

async function runGenerator(
  plop: Awaited<ReturnType<typeof nodePlop>>,
  name: string,
  answers: Record<string, unknown>
): Promise<void> {
  const gen = plop.getGenerator(name);
  const { changes, failures } = await gen.runActions(answers);
  if (failures.length > 0) {
    const msg = failures.map((f) => `${f.type} ${f.path}: ${f.error}`).join("\n");
    throw new Error(`Generator "${name}" failed:\n${msg}`);
  }
  for (const c of changes) {
    if (c.type === "function") continue;
    console.log(`  [${name}] ${c.type} ${c.path}`);
  }
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  if (fs.existsSync(demoFeatureDir)) {
    if (!force) {
      console.error(
        "Demo folder features/plop-demo already exists. Remove it or run with --force to delete and recreate."
      );
      process.exit(1);
    }
    fs.rmSync(demoFeatureDir, { recursive: true, force: true });
    console.log("Removed existing features/plop-demo (--force).");
  }

  console.log("Loading Plop (all layer generators)…");
  const plop = await nodePlop("");
  plop.setPlopfilePath(toolsPlopDir);
  applyCommonPlopSetup(plop);
  registerFeatureGenerators(plop);
  registerDomainGenerators(plop);
  registerApplicationGenerators(plop);
  registerInfrastructureGenerators(plop);
  registerCompositionGenerators(plop);

  console.log("\n1/27 feature-core …");
  await runGenerator(plop, "feature-core", {
    featureName: DEMO_FEATURE_NAME,
    packages: ["domain", "application"],
  });

  console.log("\n2/27 feature-domain-entity …");
  await runGenerator(plop, "feature-domain-entity", {
    domainPackageRel: DEMO_DOMAIN_REL,
    entityName: "LineItem",
    addNotFoundError: true,
  });

  console.log("\n3/27 feature-domain-value-object (single-value) …");
  await runGenerator(plop, "feature-domain-value-object", {
    domainPackageRel: DEMO_DOMAIN_REL,
    valueObjectName: "TaxRate",
    valueObjectKind: "single-value",
    singleValuePrimitive: "string",
  });

  console.log("\n4/27 feature-domain-value-object (composite) …");
  await runGenerator(plop, "feature-domain-value-object", {
    domainPackageRel: DEMO_DOMAIN_REL,
    valueObjectName: "Money",
    valueObjectKind: "composite",
  });

  console.log("\n5/27 feature-domain-entity-add-vo-field …");
  await runGenerator(plop, "feature-domain-entity-add-vo-field", {
    domainPackageRel: DEMO_DOMAIN_REL,
    entityName: "LineItem",
    propName: "taxRate",
    voSelection: { voClass: "TaxRate", source: "local" },
  });

  console.log("\n6/27 feature-domain-error (custom) …");
  await runGenerator(plop, "feature-domain-error", {
    domainPackageRel: DEMO_DOMAIN_REL,
    errorKind: "custom",
    errorName: "InvalidQuantity",
  });

  console.log("\n7/27 feature-domain-error (not-found) …");
  await runGenerator(plop, "feature-domain-error", {
    domainPackageRel: DEMO_DOMAIN_REL,
    errorKind: "not-found",
    entityPascal: "Order",
  });

  console.log("\n8/27 feature-domain-service …");
  await runGenerator(plop, "feature-domain-service", {
    domainPackageRel: DEMO_DOMAIN_REL,
    selectedEntities: ["local:LineItem"],
    serviceName: "LineItemTotals",
  });

  console.log("\n9/27 feature-application-entity-to-dto-mapper …");
  await runGenerator(plop, "feature-application-entity-to-dto-mapper", {
    domainPackageRel: DEMO_DOMAIN_REL,
    entityName: "LineItem",
    overwrite: false,
  });

  console.log("\n10/27 feature-application-entity-to-dto-mapper (LineItem variant: custom) …");
  await runGenerator(plop, "feature-application-entity-to-dto-mapper", {
    domainPackageRel: DEMO_DOMAIN_REL,
    entityName: "LineItem",
    mapperVariantKebab: "custom",
    overwrite: false,
  });

  console.log("\n11/27 feature-application-port (repository) …");
  await runGenerator(plop, "feature-application-port", {
    applicationPackageRel: DEMO_APPLICATION_REL,
    portKind: "repository",
    repositoryPortEntity: {
      entityPascal: "LineItem",
      entityDomainPackageRel: DEMO_DOMAIN_REL,
    },
    repositoryBaseName: "",
    overwrite: false,
  });

  console.log("\n12/27 feature-application-port (interaction) …");
  await runGenerator(plop, "feature-application-port", {
    applicationPackageRel: DEMO_APPLICATION_REL,
    portKind: "interaction",
    portName: "PlopDemoPanel",
    overwrite: false,
  });

  console.log("\n13/27 feature-application-port (plain / other) …");
  await runGenerator(plop, "feature-application-port", {
    applicationPackageRel: DEMO_APPLICATION_REL,
    portKind: "other",
    portName: "DemoClock",
    overwrite: false,
  });

  console.log("\n14/27 feature-composition-app (web) …");
  await runGenerator(plop, "feature-composition-app", {
    applicationPackageRel: DEMO_APPLICATION_REL,
    compositionAppKebab: "web",
  });

  console.log("\n15/27 feature-composition-wire-dataloader-registry …");
  await runGenerator(plop, "feature-composition-wire-dataloader-registry", {
    compositionPackageRel: DEMO_COMPOSITION_WEB_REL,
    propName: "loaders",
  });

  console.log("\n16/27 feature-composition-wire-http-client …");
  await runGenerator(plop, "feature-composition-wire-http-client", {
    compositionPackageRel: DEMO_COMPOSITION_WEB_REL,
    propName: "httpClient",
  });

  console.log("\n17/27 feature-infrastructure-driven-package (demo-clock) …");
  await runGenerator(plop, "feature-infrastructure-driven-package", {
    applicationPackageRel: DEMO_APPLICATION_REL,
    drivenSuffix: "demo-clock",
  });

  console.log("\n18/27 feature-infrastructure-driven-package (line-item) …");
  await runGenerator(plop, "feature-infrastructure-driven-package", {
    applicationPackageRel: DEMO_APPLICATION_REL,
    drivenSuffix: "line-item",
  });

  console.log(
    "\n19/27 feature-infrastructure-driven-port-adapter (DemoClockPort → driven-demo-clock) …"
  );
  await runGenerator(plop, "feature-infrastructure-driven-port-adapter", {
    applicationPackageRel: DEMO_APPLICATION_REL,
    portFile: "demo-clock.port.ts",
    drivenPackageRel: DEMO_DRIVEN_DEMO_CLOCK_REL,
    adapterBaseName: "",
  });

  console.log(
    "\n20/27 feature-infrastructure-driven-repository-port-adapter (LineItemRepositoryPort → driven-line-item) …"
  );
  await runGenerator(plop, "feature-infrastructure-driven-repository-port-adapter", {
    applicationPackageRel: DEMO_APPLICATION_REL,
    portFile: "line-item.repository.port.ts",
    drivenPackageRel: DEMO_DRIVEN_LINE_ITEM_REL,
    useKyHttpClient: true,
    adapterBaseName: "",
  });

  console.log("\n21/27 feature-infrastructure-raw-to-domain-entity-mapper …");
  await runGenerator(plop, "feature-infrastructure-raw-to-domain-entity-mapper", {
    domainPackageRel: DEMO_DOMAIN_REL,
    entityName: "LineItem",
    drivenPackageRel: DEMO_DRIVEN_LINE_ITEM_REL,
    rawName: "PersistenceLineItemRow",
  });

  console.log("\n22/27 feature-application-use-case — standard …");
  await runGenerator(plop, "feature-application-use-case", {
    useCaseKind: "standard",
    applicationPackageRel: DEMO_APPLICATION_REL,
    useCaseName: "RecordLineItem",
  });

  console.log("\n23/27 feature-application-use-case — interactive …");
  await runGenerator(plop, "feature-application-use-case", {
    useCaseKind: "interactive",
    applicationPackageRel: DEMO_APPLICATION_REL,
    useCaseName: "AcknowledgePlopDemo",
  });

  console.log(
    "\n24/27 patch AcknowledgePlopDemo interaction port + feature-infrastructure-driven-immer-interaction-adapter …"
  );
  const acknowledgeInteractionPortPath = path.join(
    repoRoot,
    DEMO_APPLICATION_REL,
    "ports",
    "acknowledge-plop-demo.interaction.port.ts"
  );
  fs.writeFileSync(
    acknowledgeInteractionPortPath,
    `export interface AcknowledgePlopDemoInteractionPort {
  displayData(data: string): void;
  displayError(message: string): void;
}
`,
    "utf8"
  );
  console.log(`  [demo] wrote ${path.relative(repoRoot, acknowledgeInteractionPortPath)}`);

  await runGenerator(plop, "feature-infrastructure-driven-immer-interaction-adapter", {
    applicationPackageRel: DEMO_APPLICATION_REL,
    portFile: "acknowledge-plop-demo.interaction.port.ts",
    drivenPackageRel: DEMO_DRIVEN_DEMO_CLOCK_REL,
    adapterBaseName: "",
  });

  console.log("\n25/27 feature-infrastructure-lib-package …");
  await runGenerator(plop, "feature-infrastructure-lib-package", {
    infrastructureLibScope: "feature",
    applicationPackageRel: DEMO_APPLICATION_REL,
    libSuffix: "demo-formatting",
  });

  console.log("\n26/27 feature-application-add-dependency-to-use-case …");
  await runGenerator(plop, "feature-application-add-dependency-to-use-case", {
    applicationSliceRel: DEMO_APPLICATION_REL,
    useCaseSlice: "standard|RecordLineItem",
    portApplicationRel: DEMO_APPLICATION_REL,
    portFileName: "line-item.repository.port.ts",
    portPropertyName: "lineItemRepository",
  });

  console.log("\n27/27 feature-composition-wire-use-case (non-interactive) …");
  await runGenerator(plop, "feature-composition-wire-use-case", {
    applicationPackageRel: DEMO_APPLICATION_REL,
    useCaseSlice: "standard|RecordLineItem",
    compositionPackageRel: DEMO_COMPOSITION_WEB_REL,
    nonInteractiveCompositionWire: true,
  });

  console.log("\nRunning pnpm install (workspace links)…");
  const r = spawnSync("pnpm", ["install"], { cwd: repoRoot, stdio: "inherit" });
  if (r.status !== 0) {
    console.warn(
      "\npnpm install exited with a non-zero status (e.g. Node engines mismatch). New packages are on disk; run `pnpm install` when your environment satisfies package.json engines."
    );
  }

  console.log(
    "\nDemo scaffold done under features/plop-demo/ (all `tools/plop` generators: domain + application + composition + DataLoader/HTTP wires + driven + adapters + mapper + lib + use cases + composition wiring)."
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
