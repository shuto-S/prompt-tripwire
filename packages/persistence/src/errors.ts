export type PersistenceErrorCode =
  | "ARTIFACT_INTEGRITY_ERROR"
  | "CONFLICTING_IDEMPOTENCY_KEY"
  | "CONFLICTING_VERSION"
  | "DATABASE_CORRUPTION"
  | "NOT_FOUND"
  | "REDACTION_FAILED"
  | "RUN_NOT_DELETABLE"
  | "SQLITE_RUNTIME_UNSUPPORTED";

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;

  constructor(code: PersistenceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PersistenceError";
    this.code = code;
  }
}
