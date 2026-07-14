export type ControllerErrorCode =
  | "CONTROLLER_NOT_STARTED"
  | "EXECUTION_NOT_CONFIGURED"
  | "INSPECTION_NOT_CONFIGURED"
  | "OPERATION_TIMEOUT";

export class ControllerError extends Error {
  readonly code: ControllerErrorCode;

  constructor(code: ControllerErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ControllerError";
    this.code = code;
  }
}
