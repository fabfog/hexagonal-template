/**
 * Removes the scaffold produced by `pnpm demo:scaffold` (`features/plop-demo/` + `apps/demo-web/`).
 *
 * Usage (from repo root):
 *   pnpm demo:clear
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const demoDir = path.join(repoRoot, "features", "plop-demo");
const demoAppDir = path.join(repoRoot, "apps", "demo-web");

if (!fs.existsSync(demoDir) && !fs.existsSync(demoAppDir)) {
  console.log("Nothing to remove: features/plop-demo and apps/demo-web do not exist.");
  process.exit(0);
}

fs.rmSync(demoDir, { recursive: true, force: true });
fs.rmSync(demoAppDir, { recursive: true, force: true });
console.log(
  "Removed features/plop-demo and apps/demo-web. Run `pnpm install` if you want the lockfile/workspace graph refreshed."
);
