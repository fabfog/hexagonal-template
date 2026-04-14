import { describe, expect, it } from "vitest";

import { SERIALIZE, toPlain } from "./index";

describe("toPlain", () => {
  it("returns primitives and nullish as-is", () => {
    expect(toPlain(0)).toBe(0);
    expect(toPlain("x")).toBe("x");
    expect(toPlain(true)).toBe(true);
    expect(toPlain(undefined)).toBe(undefined);
    expect(toPlain(null)).toBe(null);
  });

  it("clones plain object shape recursively for plain records", () => {
    const input = { a: 1, b: { c: "d" } };
    const out = toPlain(input);
    expect(out).toEqual({ a: 1, b: { c: "d" } });
    expect(out).not.toBe(input);
    expect((out as { b: object }).b).not.toBe(input.b);
  });

  it("maps arrays element-wise", () => {
    expect(toPlain([1, 2, 3])).toEqual([1, 2, 3]);
    expect(toPlain([{ x: 1 }, { x: 2 }])).toEqual([{ x: 1 }, { x: 2 }]);
  });

  it("invokes [SERIALIZE]() and continues walking the result", () => {
    class Token {
      constructor(private readonly raw: string) {}
      [SERIALIZE]() {
        return this.raw;
      }
    }
    expect(toPlain(new Token("abc"))).toBe("abc");
  });

  it("handles nested plain objects that contain serializable values", () => {
    class Id {
      constructor(private readonly v: string) {}
      [SERIALIZE]() {
        return this.v;
      }
    }
    const input = { id: new Id("i-1"), meta: { n: 2 } };
    expect(toPlain(input)).toEqual({ id: "i-1", meta: { n: 2 } });
  });

  it("handles arrays of serializable values", () => {
    class Flag {
      constructor(private readonly on: boolean) {}
      [SERIALIZE]() {
        return this.on;
      }
    }
    expect(toPlain([new Flag(true), new Flag(false)])).toEqual([true, false]);
  });

  it("chains when [SERIALIZE]() returns another object with [SERIALIZE]()", () => {
    class Inner {
      [SERIALIZE]() {
        return 42;
      }
    }
    class Outer {
      constructor(private readonly inner: Inner) {}
      [SERIALIZE]() {
        return { x: this.inner };
      }
    }
    expect(toPlain(new Outer(new Inner()))).toEqual({ x: 42 });
  });

  it("leaves Date instances unchanged (non-plain prototype)", () => {
    const d = new Date("2020-01-01T00:00:00.000Z");
    expect(toPlain(d)).toBe(d);
  });

  it("leaves class instances without [SERIALIZE] unchanged", () => {
    class Noop {}
    const n = new Noop();
    expect(toPlain(n)).toBe(n);
  });

  it("treats empty plain objects and empty arrays", () => {
    expect(toPlain({})).toEqual({});
    expect(toPlain([])).toEqual([]);
  });
});
