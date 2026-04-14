import { describe, it, expect } from "vitest";
import { z } from "zod";
import { DomainError } from "@features/shared-domain/errors";
import { mapErrorToDTO } from "./error.mapper";

describe("mapErrorToDTO", () => {
  it("maps DomainError to ErrorDTO preserving code, message and metadata", () => {
    const error = new DomainError({
      code: "DOCUMENT_NOT_FOUND",
      message: "Document 123 not found",
      metadata: { id: "123" },
    });

    const dto = mapErrorToDTO(error);

    expect(dto).toEqual({
      code: "DOCUMENT_NOT_FOUND",
      message: "Document 123 not found",
      severity: "error",
      metadata: { id: "123" },
    });
  });

  it("maps ZodError to VALIDATION_ERROR with issues in metadata", () => {
    let caught: unknown;
    try {
      z.string().parse(42);
    } catch (e) {
      caught = e;
    }

    const dto = mapErrorToDTO(caught);

    expect(dto.code).toBe("VALIDATION_ERROR");
    expect(dto.severity).toBe("error");
    expect(dto.metadata).toBeDefined();
    expect(Array.isArray(dto.metadata?.issues)).toBe(true);
  });

  it("maps generic Error to UNEXPECTED_FAILURE", () => {
    const error = new Error("Something went wrong");

    const dto = mapErrorToDTO(error);

    expect(dto.code).toBe("UNEXPECTED_FAILURE");
    expect(dto.message).toBe("Something went wrong");
    expect(dto.severity).toBe("error");
    expect(dto.metadata?.name).toBe("Error");
    expect(typeof dto.metadata?.stack).toBe("string");
  });

  it("maps string to UNKNOWN_ERROR", () => {
    const dto = mapErrorToDTO("plain error");

    expect(dto).toEqual({
      code: "UNKNOWN_ERROR",
      message: "plain error",
      severity: "error",
      metadata: undefined,
    });
  });

  it("maps arbitrary object to UNKNOWN_ERROR with JSON message", () => {
    const dto = mapErrorToDTO({ foo: "bar" });

    expect(dto.code).toBe("UNKNOWN_ERROR");
    expect(dto.severity).toBe("error");
    expect(dto.message).toBe(JSON.stringify({ foo: "bar" }));
    expect(dto.metadata).toBeUndefined();
  });
});
