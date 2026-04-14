const isObject = (value: unknown): value is Record<PropertyKey, unknown> =>
  typeof value === "object" && value !== null;

export const deepEqual = (
  left: unknown,
  right: unknown,
  seen: WeakMap<object, object> = new WeakMap()
): boolean => {
  if (Object.is(left, right)) return true;

  if (!isObject(left) || !isObject(right)) return false;

  if (seen.get(left) === right) return true;
  seen.set(left, right);

  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
      if (!deepEqual(left[i], right[i], seen)) return false;
    }
    return true;
  }

  const leftKeys = Reflect.ownKeys(left);
  const rightKeys = Reflect.ownKeys(right);
  if (leftKeys.length !== rightKeys.length) return false;

  for (const key of leftKeys) {
    if (!rightKeys.includes(key)) return false;
    if (!deepEqual(left[key], right[key], seen)) return false;
  }

  return true;
};
