export type AppServerErrorCode =
  | "APP_SERVER_DISCONNECTED"
  | "CODEX_VERSION_MISMATCH"
  | "INSUFFICIENT_VALID_PROBES"
  | "INVALID_PLAN_ARTIFACT"
  | "JSON_RPC_ERROR"
  | "PROBE_CONTAINMENT_VIOLATION"
  | "PROBE_CANCELLED"
  | "PROBE_TIMEOUT"
  | "EXECUTION_CANCELLED"
  | "EXECUTION_TIMEOUT"
  | "PROTOCOL_CORRUPTION"
  | "PROTOCOL_VALIDATION_FAILED";

export class AppServerError extends Error {
  readonly code: AppServerErrorCode;

  constructor(code: AppServerErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AppServerError";
    this.code = code;
  }
}
