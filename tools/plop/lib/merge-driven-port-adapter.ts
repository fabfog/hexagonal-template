/**
 * @param {string} s
 */
function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface PortMethodSig {
  name: string;
  params: string;
  returnType: string;
}

interface MergeAdapterParams {
  className: string;
  interfaceName: string;
  methods: PortMethodSig[];
}

/**
 * Merges port methods into an existing adapter: appends stub implementations only for
 * methods not yet present in the class body (does not overwrite existing methods).
 */
export function mergeAdapterContent(
  existing: string,
  { className, interfaceName, methods }: MergeAdapterParams
): string {
  const headerRe = new RegExp(
    `export\\s+class\\s+${escapeRegExp(className)}\\s+implements\\s+${escapeRegExp(interfaceName)}\\s*\\{`
  );
  const match = existing.match(headerRe);
  if (!match || match.index === undefined) {
    throw new Error(
      `Existing adapter must match "export class ${className} implements ${interfaceName} {". ` +
        `Adjust the file or delete it to regenerate from scratch.`
    );
  }
  const openBraceIdx = match.index + match[0].length - 1;
  let depth = 0;
  let closeIdx = -1;
  for (let i = openBraceIdx; i < existing.length; i++) {
    const c = existing[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        closeIdx = i;
        break;
      }
    }
  }
  if (closeIdx === -1) {
    throw new Error(`Could not find closing brace for class ${className}`);
  }
  const body = existing.slice(openBraceIdx + 1, closeIdx);
  const toAdd: PortMethodSig[] = [];
  for (const m of methods) {
    const declRe = new RegExp(`\\b${escapeRegExp(m.name)}\\s*\\(`);
    if (declRe.test(body)) continue;
    toAdd.push(m);
  }
  if (toAdd.length === 0) {
    return existing;
  }
  let block = "";
  for (const m of toAdd) {
    block += `\n  ${m.name}(${m.params}): ${m.returnType} {\n    throw new Error("Not implemented!");\n  }\n`;
  }
  return existing.slice(0, closeIdx) + block + existing.slice(closeIdx);
}
