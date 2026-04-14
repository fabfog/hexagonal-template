export type DomainErrorCode = string;

export class DomainError extends Error {
  public readonly code: DomainErrorCode;
  public readonly metadata: Record<string, unknown> | undefined;

  constructor(options: {
    code: DomainErrorCode;
    message: string;
    metadata?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(options.message);
    this.name = "DomainError";
    this.code = options.code;
    this.metadata = options.metadata;

    if (options.cause !== undefined) {
      (this as Error).cause = options.cause as Error["cause"];
    }

    Object.setPrototypeOf(this, new.target.prototype);
  }
}
