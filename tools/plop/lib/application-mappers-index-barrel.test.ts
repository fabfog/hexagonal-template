import { describe, expect, it } from "vitest";
import {
  applicationMappersBarrelConstName,
  entityKebabToMapperFnName,
  formatApplicationMappersIndexBarrel,
  parseApplicationMappersIndexEntries,
  syncApplicationMappersIndexBarrel,
} from "./application-mappers-index-barrel.ts";

describe("applicationMappersBarrelConstName", () => {
  it("Pascal-cases the feature folder segment", () => {
    expect(applicationMappersBarrelConstName("plop-demo")).toBe("PlopDemoMappers");
  });
});

describe("entityKebabToMapperFnName", () => {
  it("matches codegen naming", () => {
    expect(entityKebabToMapperFnName("line-item")).toBe("mapLineItemToDTO");
  });
});

describe("syncApplicationMappersIndexBarrel", () => {
  it("creates a barrel from an empty export", () => {
    const out = syncApplicationMappersIndexBarrel("export {};\n", {
      defaultConstName: "PlopDemoMappers",
      entityKebab: "line-item",
    });
    expect(out).toContain("import { mapLineItemToDTO } from './line-item.mapper';");
    expect(out).toContain("export const PlopDemoMappers = {");
    expect(out).toContain("  mapLineItemToDTO,");
  });

  it("migrates legacy export * and adds a mapper", () => {
    const input = `export * from './line-item.mapper';\n`;
    const out = syncApplicationMappersIndexBarrel(input, {
      defaultConstName: "PlopDemoMappers",
      entityKebab: "order",
    });
    expect(out).toContain("import { mapLineItemToDTO } from './line-item.mapper';");
    expect(out).toContain("import { mapOrderToDTO } from './order.mapper';");
    expect(parseApplicationMappersIndexEntries(out)).toHaveLength(2);
  });

  it("merges into an existing barrel and preserves const name", () => {
    const input = `import { mapLineItemToDTO } from './line-item.mapper';

export const CustomMappers = {
  mapLineItemToDTO,
};
`;
    const out = syncApplicationMappersIndexBarrel(input, {
      defaultConstName: "PlopDemoMappers",
      entityKebab: "invoice",
    });
    expect(out).toContain("export const CustomMappers = {");
    expect(out).toContain("mapInvoiceToDTO");
    expect(out).not.toContain("PlopDemoMappers");
  });

  it("is idempotent for the same entity", () => {
    const once = syncApplicationMappersIndexBarrel("export {};\n", {
      defaultConstName: "FooMappers",
      entityKebab: "a",
    });
    const twice = syncApplicationMappersIndexBarrel(once, {
      defaultConstName: "FooMappers",
      entityKebab: "a",
    });
    expect(twice).toBe(once);
  });
});

describe("formatApplicationMappersIndexBarrel", () => {
  it("sorts entries by entity kebab", () => {
    const out = formatApplicationMappersIndexBarrel(
      [{ entityKebab: "zebra" }, { entityKebab: "apple" }],
      "XMappers"
    );
    expect(out.indexOf("apple")).toBeLessThan(out.indexOf("zebra"));
  });
});
