import { describe, expect, it } from "vitest";
import { appendVoFieldToEntitySource } from "./domain-entity-vo-fields.ts";

const minimalEntity = `import { z } from 'zod';
import { SERIALIZE, toPlain, type Plain } from '@features/shared-domain/utils';

import {
  WidgetId,
  type WidgetIdInput,
} from '../value-objects/widget-id.vo';

export const WidgetSchema = z.object({
  // TODO
});

export type WidgetDataProps = z.infer<
  typeof WidgetSchema
>;

export type WidgetProps = { id: WidgetId } &
  WidgetDataProps;

export type WidgetCreateProps = {
  id: WidgetId | WidgetIdInput;
} & z.input<typeof WidgetSchema>;

export class WidgetEntity {
  private readonly _id: WidgetId;
  private readonly _props: WidgetDataProps;

  constructor({ id, ...data }: WidgetCreateProps) {
    this._id = id instanceof WidgetId ? id : new WidgetId(id);
    this._props = WidgetSchema.parse(data);
  }

  [SERIALIZE](): Plain<WidgetProps> {
    return toPlain({ id: this._id, ...this._props });
  }
}
`;

describe("appendVoFieldToEntitySource", () => {
  it("adds a field referencing the VO Zod schema only (pass primitives/plain input; use .value / plain if you have a VO)", () => {
    const out = appendVoFieldToEntitySource(minimalEntity, "Widget", {
      prop: "taxRate",
      voClass: "TaxRate",
      source: "local",
    });
    expect(out).toContain("taxRate: TaxRateSchema");
    expect(out).not.toContain("z.union");
    expect(out).toContain("TaxRateSchema");
  });
});
