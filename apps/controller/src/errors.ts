export type ControllerErrorCode =
  | "CONTROLLER_NOT_STARTED"
  | "EXECUTION_NOT_CONFIGURED"
  | "CONTRACT_RUN_MISMATCH"
  | "INVALID_AMENDMENT_STATE"
  | "INSPECTION_NOT_CONFIGURED"
  | "CURRENT_SNAPSHOT_REQUIRED"
  | "OPERATION_TIMEOUT";

export class ControllerError extends Error {
  readonly code: ControllerErrorCode;

  constructor(code: ControllerErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ControllerError";
    this.code = code;
  }
}

const CANONICAL_INSPECTION_RUN_ID =
  /^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function isCanonicalInspectionRunId(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_INSPECTION_RUN_ID.test(value);
}

export class InspectionRunError extends Error {
  readonly code: string;
  readonly runId: string;

  constructor(runId: string, code: string, cause: unknown) {
    if (!isCanonicalInspectionRunId(runId)) {
      throw new TypeError("inspection run ID must be a canonical generated ID");
    }
    super("inspection failed", { cause });
    this.name = "InspectionRunError";
    this.code = code;
    this.runId = runId;
  }
}
