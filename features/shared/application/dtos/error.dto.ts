export type ErrorSeverity = "critical" | "error" | "warning";

export interface ErrorDTO {
  code: string;
  message: string;
  severity: ErrorSeverity;
  metadata: Record<string, unknown> | undefined;
}
