/**
 * Interactive layer picker, then spawns Plop with the matching plopfile (clean TTY; no nested generators).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import inquirer from "inquirer";

const toolsPlopDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolsPlopDir, "../..");
/** Avoid `pnpm exec` (extra process + resolution); same toolchain as `pnpm plop`. */
const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const plopCli = path.join(repoRoot, "node_modules", "plop", "bin", "plop.js");

const LAYERS = [
  { name: "Feature — workspace packages (feature-core)", value: "plopfile-feature.ts" },
  { name: "Domain — entity, VO, error, service, add VO field", value: "plopfile-domain.ts" },
  { name: "Application — mapper, port, use case, use-case deps", value: "plopfile-application.ts" },
  {
    name: "Infrastructure — driven/lib packages, adapters, mappers",
    value: "plopfile-infrastructure.ts",
  },
  {
    name: "Composition — app package, wires (DataLoader, HTTP, use case)",
    value: "plopfile-composition.ts",
  },
] as const;

async function main() {
  const { plopfile } = await inquirer.prompt<{ plopfile: string }>([
    {
      type: "list",
      name: "plopfile",
      message: "Which layer do you want to run Plop for?",
      choices: [...LAYERS],
    },
  ]);

  const plopfileAbs = path.join(repoRoot, "tools", "plop", plopfile);
  const menuIdx = process.argv.findIndex((a) => a.endsWith("plop-menu.ts"));
  const forwarded = menuIdx >= 0 ? process.argv.slice(menuIdx + 1) : [];

  const result = spawnSync(
    process.execPath,
    [tsxCli, plopCli, "--plopfile", plopfileAbs, ...forwarded],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: process.env,
    }
  );

  if (result.error) {
    throw result.error;
  }
  process.exit(result.status === null ? 1 : result.status);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
