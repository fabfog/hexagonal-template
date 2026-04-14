import {
  IndentationText,
  NewLineKind,
  Project,
  QuoteKind,
  ts,
  type CompilerOptions,
  type ProjectOptions,
} from "ts-morph";

/**
 * Compiler options aligned with the repo TypeScript base (ESNext + Bundler, strict, no emit).
 * Uses ts-morph's `ts` namespace so enums match the compiler API bundled with ts-morph.
 *
 * For a raw `typescript` `createProgram` outside ts-morph, mirror these flags manually.
 */
export const PLOP_MORPH_COMPILER_OPTIONS: CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  lib: ["ES2022"],
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  esModuleInterop: true,
  forceConsistentCasingInFileNames: true,
  resolveJsonModule: true,
  isolatedModules: true,
  allowImportingTsExtensions: true,
  noUncheckedIndexedAccess: true,
  noImplicitOverride: true,
  exactOptionalPropertyTypes: true,
  declaration: false,
  declarationMap: false,
  sourceMap: false,
};

const DEFAULT_MANIPULATION_SETTINGS: NonNullable<ProjectOptions["manipulationSettings"]> = {
  indentationText: IndentationText.TwoSpaces,
  newLineKind: NewLineKind.LineFeed,
  quoteKind: QuoteKind.Double,
  useTrailingCommas: false,
  usePrefixAndSuffixTextForRename: true,
  insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: true,
};

export interface CreatePlopMorphProjectOptions {
  /**
   * Shallow merge over {@link PLOP_MORPH_COMPILER_OPTIONS}.
   */
  compilerOptions?: Partial<CompilerOptions>;
  /**
   * In-memory FS only; use in tests or when you never write to disk.
   */
  useInMemoryFileSystem?: boolean;
  /**
   * If set, ts-morph loads this tsconfig and merges with `compilerOptions` overrides.
   * Prefer either this or explicit `compilerOptions`, not both, unless you know the merge you want.
   */
  tsConfigFilePath?: string;
}

/**
 * Shared ts-morph `Project` for Plop AST work. Keeps compiler and formatting defaults consistent
 * across all generator AST operations.
 */
export function createPlopMorphProject(opts: CreatePlopMorphProjectOptions = {}): Project {
  const { compilerOptions: overrides, useInMemoryFileSystem = false, tsConfigFilePath } = opts;

  const compilerOptions: CompilerOptions = {
    ...PLOP_MORPH_COMPILER_OPTIONS,
    ...overrides,
  };

  const projectOptions: ProjectOptions = {
    compilerOptions,
    manipulationSettings: DEFAULT_MANIPULATION_SETTINGS,
    useInMemoryFileSystem,
  };

  if (tsConfigFilePath !== undefined) {
    projectOptions.tsConfigFilePath = tsConfigFilePath;
  }

  return new Project(projectOptions);
}
