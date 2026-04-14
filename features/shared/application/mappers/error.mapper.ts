import { ZodError } from "zod";
import { DomainError } from "@features/shared-domain/errors";
import type { ErrorDTO } from "../dtos/error.dto";

export const mapErrorToDTO = (error: unknown): ErrorDTO => {
  // 1. Domain Error
  if (error instanceof DomainError) {
    return {
      code: error.code,
      message: error.message,
      severity: "error",
      metadata: error.metadata,
    };
  }

  // 2. Zod Validation Error
  if (error instanceof ZodError) {
    return {
      code: "VALIDATION_ERROR",
      message: error.message,
      severity: "error",
      metadata: { issues: error.issues },
    };
  }

  // 3. generic Error
  if (error instanceof Error) {
    const metadata: Record<string, unknown> = {
      name: error.name,
      stack: error.stack,
    };
    for (const key of Object.getOwnPropertyNames(error)) {
      if (key === "name" || key === "message" || key === "stack") continue;
      metadata[key] = (error as unknown as Record<string, unknown>)[key];
    }
    return {
      code: "UNEXPECTED_FAILURE",
      message: error.message,
      severity: "error",
      metadata,
    };
  }

  // 4. unconventional "raw" errors
  const unknownMessage = typeof error === "string" ? error : JSON.stringify(error);

  return {
    code: "UNKNOWN_ERROR",
    message: unknownMessage,
    severity: "error",
    metadata: undefined,
  };
};
