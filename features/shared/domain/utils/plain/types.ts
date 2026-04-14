export const SERIALIZE = Symbol("SERIALIZE");

/** Key type for `[SERIALIZE]()` on domain types (for conditional types such as `Plain<T>`). */
export type SerializeMethodKey = typeof SERIALIZE;

type UnwrapValue<T> = T extends { value: infer V } ? (keyof T extends "value" ? V : T) : T;

/**
 * Plain data shape derived from domain types that implement `[SERIALIZE]()`.
 * Recurses through arrays and object properties; unwraps single-key `{ value }` snapshots to `V`.
 */
export type Plain<T> = T extends { [K in SerializeMethodKey]: () => infer R }
  ? Plain<UnwrapValue<R>>
  : T extends readonly (infer U)[]
    ? Plain<U>[]
    : T extends object
      ? T extends (...args: never[]) => unknown
        ? T
        : { [K in keyof T]: Plain<T[K]> }
      : T;
