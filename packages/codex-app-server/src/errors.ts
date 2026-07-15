export type AppServerErrorCode =
  | "APP_SERVER_DISCONNECTED"
  | "CODEX_VERSION_MISMATCH"
  | "INSUFFICIENT_VALID_PROBES"
  | "INVALID_PLAN_ARTIFACT"
  | "JSON_RPC_ERROR"
  | "PROBE_CONTAINMENT_VIOLATION"
  | "PROBE_CANCELLED"
  | "PROBE_TIMEOUT"
  | "COMPARISON_CANCELLED"
  | "COMPARISON_TIMEOUT"
  | "COMPARISON_TOOL_VIOLATION"
  | "INVALID_COMPARISON_ARTIFACT"
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

export interface AppServerComparisonFailureMetadata {
  readonly threadId: string;
  readonly turnId: string | null;
  readonly model: string;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly reasoningTokens: number;
  } | null;
}

export class AppServerComparisonError extends AppServerError {
  readonly metadata: AppServerComparisonFailureMetadata;

  constructor(error: AppServerError, metadata: AppServerComparisonFailureMetadata) {
    super(error.code, error.message, { cause: error });
    this.name = "AppServerComparisonError";
    this.metadata = metadata;
  }
}
