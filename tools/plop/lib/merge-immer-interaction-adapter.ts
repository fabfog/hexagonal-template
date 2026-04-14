/**
 * @param {string} s
 */
function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/**
 * @param {string} paramsStr
 * @returns {{ name: string, rest: boolean }[]}
 */
interface ParsedParam {
  name: string;
  rest: boolean;
}
function parseParamNamesFromSignature(paramsStr: string): ParsedParam[] {
  const raw = paramsStr.trim();
  if (!raw) return [];
  const segments: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= raw.length; i++) {
    const ch = raw[i];
    if (ch === "<") depth++;
    else if (ch === ">") depth--;
    if (((ch === "," && depth === 0) || i === raw.length) && i >= start) {
      const seg = raw.slice(start, i === raw.length ? undefined : i).trim();
      if (seg) segments.push(seg);
      start = i + 1;
    }
  }
  return segments.map((seg) => {
    const rest = seg.match(/^\.\.\.\s*(\w+)$/);
    if (rest?.[1]) return { name: rest[1], rest: true };
    const namePart = (seg.split(":")[0] ?? "").trim();
    return { name: namePart, rest: false };
  });
}
/**
 * @param {string} returnType
 */
function extractPromiseInnerType(returnType: string) {
  const m = returnType.match(/^Promise\s*<\s*(.+)\s*>$/);
  if (!m?.[1]) {
    throw new Error(`Expected return type Promise<...>, got: ${returnType}`);
  }
  return m[1].trim();
}
/**
 * @param {string} content
 */
function parseImmerInteractionAdapterMeta(content: string) {
  const classMatch = content.match(/export class (\w+) implements (\w+)/);
  if (!classMatch) {
    throw new Error(
      'Could not find "export class … implements …" in the Immer interaction adapter file.'
    );
  }
  const storeMatch = content.match(/ExternalStore<\s*(\w+)\s*>/);
  if (!storeMatch) {
    throw new Error("Could not find ExternalStore<StateName> in the adapter file.");
  }
  return {
    className: classMatch[1] as string,
    interfaceName: classMatch[2] as string,
    stateInterfaceName: storeMatch[1] as string,
  };
}
/**
 * @param {string} source
 * @param {string} interfaceName
 * @returns {{ bodyStart: number, bodyEnd: number } | null}
 */
function findExportedInterfaceBodyRange(source: string, interfaceName: string) {
  const needle = `export interface ${interfaceName}`;
  const declStart = source.indexOf(needle);
  if (declStart === -1) return null;
  const braceOpen = source.indexOf("{", declStart + needle.length);
  if (braceOpen === -1) return null;
  let depth = 0;
  for (let i = braceOpen; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        return { bodyStart: braceOpen + 1, bodyEnd: i };
      }
    }
  }
  return null;
}
const CURRENT_INTERACTION_FIELD = `  /**
   * Pending UI interaction ("ask" pattern). \`type\` matches the InteractionPort method name.
   * Extra fields mirror method parameters for the UI layer.
   */
  currentInteraction:
    | null
    | ({
        type: string;
        resolve: (value: unknown) => void;
      } & Record<string, unknown>);`;
/**
 * @param {string} source
 * @param {string} stateInterfaceName
 * @returns {string}
 */
function ensureCurrentInteractionOnState(source: string, stateInterfaceName: string) {
  const range = findExportedInterfaceBodyRange(source, stateInterfaceName);
  if (!range) {
    throw new Error(`Could not find export interface ${stateInterfaceName} in adapter file.`);
  }
  const body = source.slice(range.bodyStart, range.bodyEnd);
  if (/\bcurrentInteraction\b/.test(body)) {
    return source;
  }
  const insert = `\n${CURRENT_INTERACTION_FIELD}\n`;
  const before = source.slice(0, range.bodyEnd);
  const after = source.slice(range.bodyEnd);
  return before + insert + after;
}
/**
 * @param {{ name: string, params: string, returnType: string }} method
 */
function renderStubMethodImplementation(method: {
  name: string;
  params: string;
  returnType: string;
}) {
  const fnParams = method.params || "";
  const ret = method.returnType || "void";
  return `\n  ${method.name}(${fnParams}): ${ret} {\n    this.store.update((draft) => {\n      throw new Error("Not implemented!");\n    });\n  }\n`;
}
/**
 * @param {{ name: string, params: string, returnType: string }} method
 */
function renderAskMethodImplementation(method: {
  name: string;
  params: string;
  returnType: string;
}) {
  if (!/^Promise\s*</.test(method.returnType)) {
    throw new Error(
      `Ask pattern requires Promise<…> return type (method ${method.name} has ${method.returnType}).`
    );
  }
  const promiseInner = extractPromiseInnerType(method.returnType);
  const isVoidPromise = promiseInner === "void";
  const paramNames = parseParamNamesFromSignature(method.params);
  const hasRest = paramNames.some((p) => p.rest);
  const simpleParams = paramNames.filter((p) => !p.rest).map((p) => p.name);
  const resolveCallback = isVoidPromise
    ? `resolve: () => {
            this.store.update((d) => {
              d.currentInteraction = null;
            });
            resolve();
          },`
    : `resolve: (value: ${promiseInner}) => {
            this.store.update((d) => {
              d.currentInteraction = null;
            });
            resolve(value);
          },`;
  const paramLines =
    simpleParams.length > 0 ? `${simpleParams.map((n) => `          ${n},`).join("\n")}\n` : "";
  const restTodo = hasRest
    ? "\n    // TODO: include rest parameter(s) on currentInteraction if the UI needs them.\n"
    : "";
  return `\n  ${method.name}(${method.params}): ${method.returnType} {${restTodo}
    return new Promise((resolve) => {
      this.store.update((draft) => {
        draft.currentInteraction = {
          type: "${method.name}",
${paramLines}          ${resolveCallback}
        };
      });
    });
  }\n`;
}
/**
 * @param {Set<string> | string[]} askMethodNames
 */
function isAskMethod(name: string, askMethodNames: Set<string> | string[]) {
  const set = askMethodNames instanceof Set ? askMethodNames : new Set(askMethodNames);
  return set.has(name);
}
/**
 * @param {{ name: string, params: string, returnType: string }} method
 * @param {Set<string> | string[]} askMethodNames
 */
function renderMethodImplementation(
  method: { name: string; params: string; returnType: string },
  askMethodNames: Set<string> | string[]
) {
  if (isAskMethod(method.name, askMethodNames)) {
    return renderAskMethodImplementation(method);
  }
  return renderStubMethodImplementation(method);
}
/**
 * Merges missing InteractionPort methods into an existing Immer adapter class.
 * Does not overwrite existing methods. Ask vs stub follows askMethodNames for newly added methods only.
 *
 * @param {string} existing
 * @param {{ className: string, interfaceName: string, methods: { name: string, params: string, returnType: string }[], askMethodNames: Set<string> | string[] }} params
 * @returns {string}
 */
interface MergeImmerMethodsParams {
  className: string;
  interfaceName: string;
  methods: { name: string; params: string; returnType: string }[];
  askMethodNames: Set<string> | string[];
}
function mergeImmerInteractionAdapterMethods(
  existing: string,
  { className, interfaceName, methods, askMethodNames }: MergeImmerMethodsParams
) {
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
  const toAdd: { name: string; params: string; returnType: string }[] = [];
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
    block += renderMethodImplementation(m, askMethodNames);
  }
  return existing.slice(0, closeIdx) + block + existing.slice(closeIdx);
}
/**
 * @param {string} stateInterfaceName
 * @param {boolean} hasAnyAskMethod
 * @returns {string} full interface declaration including export
 */
function buildStateInterfaceDeclaration(stateInterfaceName: string, hasAnyAskMethod: boolean) {
  if (!hasAnyAskMethod) {
    return `export interface ${stateInterfaceName} {}\n`;
  }
  return `export interface ${stateInterfaceName} {
${CURRENT_INTERACTION_FIELD}
}\n`;
}
interface MergeImmerInteractionAdapterParams {
  stateInterfaceName: string;
  className: string;
  interfaceName: string;
  methods: { name: string; params: string; returnType: string }[];
  askMethodNames: Set<string> | string[];
}

/** Apply state + class merge for an existing adapter file (second+ generator run). */
function mergeImmerInteractionAdapterFile(
  source: string,
  params: MergeImmerInteractionAdapterParams
) {
  const { stateInterfaceName, className, interfaceName, methods, askMethodNames } = params;
  const toAdd: { name: string; params: string; returnType: string }[] = [];
  const headerRe = new RegExp(
    `export\\s+class\\s+${escapeRegExp(className)}\\s+implements\\s+${escapeRegExp(interfaceName)}\\s*\\{`
  );
  const match = source.match(headerRe);
  if (!match || match.index === undefined) {
    throw new Error(
      `Existing adapter must match "export class ${className} implements ${interfaceName} {".`
    );
  }
  const openBraceIdx = match.index + match[0].length - 1;
  let depth = 0;
  let closeIdx = -1;
  for (let i = openBraceIdx; i < source.length; i++) {
    const c = source[i];
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
  const body = source.slice(openBraceIdx + 1, closeIdx);
  for (const m of methods) {
    const declRe = new RegExp(`\\b${escapeRegExp(m.name)}\\s*\\(`);
    if (!declRe.test(body)) toAdd.push(m);
  }
  const askSet = askMethodNames instanceof Set ? askMethodNames : new Set(askMethodNames);
  const needsInteractionField = toAdd.some((m) => askSet.has(m.name));
  let out = source;
  if (needsInteractionField) {
    out = ensureCurrentInteractionOnState(out, stateInterfaceName);
  }
  out = mergeImmerInteractionAdapterMethods(out, {
    className,
    interfaceName,
    methods,
    askMethodNames,
  });
  return out;
}
export {
  escapeRegExp,
  parseImmerInteractionAdapterMeta,
  ensureCurrentInteractionOnState,
  renderStubMethodImplementation,
  renderAskMethodImplementation,
  renderMethodImplementation,
  mergeImmerInteractionAdapterMethods,
  buildStateInterfaceDeclaration,
  mergeImmerInteractionAdapterFile,
};
