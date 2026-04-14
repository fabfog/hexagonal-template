import { describe, expect, it } from "vitest";
import {
  applicationMappersBarrelConstName,
  formatApplicationMappersIndexBarrel,
  mapperExportNameFromModuleKebab,
  parseApplicationMappersIndexEntries,
  syncApplicationMappersIndexBarrel,
} from "./application-mappers-index-barrel.ts";

describe("applicationMappersBarrelConstName", () => {
  it("Pascal-cases the feature folder segment", () => {
    expect(applicationMappersBarrelConstName("plop-demo")).toBe("PlopDemoMappers");
  });
});

describe("mapperExportNameFromModuleKebab", () => {
  it("default entity module matches legacy naming", () => {
    expect(mapperExportNameFromModuleKebab("line-item")).toBe("mapLineItemToDTO");
  });

  it("supports variant suffix in module kebab", () => {
    expect(mapperExportNameFromModuleKebab("line-item-custom")).toBe("mapLineItemCustomToDTO");
  });
});

describe("syncApplicationMappersIndexBarrel", () => {
  it("creates a barrel from an empty export", () => {
    const out = syncApplicationMappersIndexBarrel("export {};\n", {
      defaultConstName: "PlopDemoMappers",
      mapperModuleKebab: "line-item",
    });
    expect(out).toContain("import { mapLineItemToDTO } from './line-item.mapper';");
    expect(out).toContain("export const PlopDemoMappers = {");
    expect(out).toContain("  mapLineItemToDTO,");
  });

  it("migrates legacy export * and adds a mapper", () => {
    const input = `export * from './line-item.mapper';\n`;
    const out = syncApplicationMappersIndexBarrel(input, {
      defaultConstName: "PlopDemoMappers",
      mapperModuleKebab: "order",
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
      mapperModuleKebab: "invoice",
    });
    expect(out).toContain("export const CustomMappers = {");
    expect(out).toContain("mapInvoiceToDTO");
    expect(out).not.toContain("PlopDemoMappers");
  });

  it("is idempotent for the same module", () => {
    const once = syncApplicationMappersIndexBarrel("export {};\n", {
      defaultConstName: "FooMappers",
      mapperModuleKebab: "a",
    });
    const twice = syncApplicationMappersIndexBarrel(once, {
      defaultConstName: "FooMappers",
      mapperModuleKebab: "a",
    });
    expect(twice).toBe(once);
  });
});

describe("formatApplicationMappersIndexBarrel", () => {
  it("sorts entries by mapper module kebab", () => {
    const out = formatApplicationMappersIndexBarrel(
      [{ mapperModuleKebab: "zebra" }, { mapperModuleKebab: "apple" }],
      "XMappers"
    );
    expect(out.indexOf("apple")).toBeLessThan(out.indexOf("zebra"));
  });
});
