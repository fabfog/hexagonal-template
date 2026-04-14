import type { Plain } from "./types";
import { SERIALIZE } from "./types";

function isPlainRecord(x: object): x is Record<string, unknown> {
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

/**
 * Runtime counterpart of `Plain<T>`: walks plain object literals, arrays, and values that expose `[SERIALIZE]()`.
 * Non-plain objects (e.g. `Date`) are returned as-is.
 */
export function toPlain<T>(value: T): Plain<T> {
  if (value === undefined || value === null) {
    return value as Plain<T>;
  }
  if (typeof value !== "object") {
    return value as Plain<T>;
  }
  if (Array.isArray(value)) {
    return value.map((e) => toPlain(e)) as Plain<T>;
  }
  const withSerialize = value as { [SERIALIZE]?: () => unknown };
  if (typeof withSerialize[SERIALIZE] === "function") {
    return toPlain(withSerialize[SERIALIZE]()) as Plain<T>;
  }
  if (!isPlainRecord(value)) {
    return value as Plain<T>;
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>)) {
    out[k] = toPlain((value as Record<string, unknown>)[k]);
  }
  return out as Plain<T>;
}
