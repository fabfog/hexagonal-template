import fs from "node:fs";
import path from "node:path";
import { toPascalCase } from "./casing.ts";

const UNIFIED_SLICE_VALUE_SEP = "|";

/**
 * All standard + interactive use cases in one list. `value` is `standard|Pascal` or `interactive|Pascal`
 * (see {@link decodeUnifiedUseCaseSliceChoice} in `add-port-to-repo-application-slice.ts`).
 */
export function getRepoApplicationUnifiedUseCaseSliceChoices(
  repoRoot: string,
  applicationPackageRel: string
): { name: string; value: string }[] {
  const useCasesDir = path.join(repoRoot, ...applicationPackageRel.split("/"), "use-cases");
  if (!fs.existsSync(useCasesDir)) {
    throw new Error(`No use-cases folder for "${applicationPackageRel}". Create a use case first.`);
  }
  /** @type {{ name: string; value: string }[]} */
  const out: { name: string; value: string }[] = [];
  for (const entry of fs.readdirSync(useCasesDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".use-case.ts") && !entry.name.endsWith(".interactive.use-case.ts")) {
      const base = entry.name.replace(/\.use-case.ts$/, "");
      const pascal = toPascalCase(base);
      out.push({
        name: `${pascal}UseCase (${entry.name})`,
        value: `standard${UNIFIED_SLICE_VALUE_SEP}${pascal}`,
      });
    } else if (entry.name.endsWith(".interactive.use-case.ts")) {
      const base = entry.name.replace(/\.interactive.use-case.ts$/, "");
      const pascal = toPascalCase(base);
      out.push({
        name: `${pascal}InteractiveUseCase (${entry.name})`,
        value: `interactive${UNIFIED_SLICE_VALUE_SEP}${pascal}`,
      });
    }
  }
  if (!out.length) {
    throw new Error(
      `No use cases in "${applicationPackageRel}". Add one with feature-application-use-case.`
    );
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
