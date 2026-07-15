import type { ComparatorAttempt, ComparatorTransportResult } from "./types.js";

export type ComparatorErrorCode =
  | "COMPARATOR_CANCELLED"
  | "COMPARATOR_INPUT_INVALID"
  | "COMPARATOR_PARSE_FAILED"
  | "COMPARATOR_REFUSAL"
  | "COMPARATOR_RESPONSE_INVALID"
  | "COMPARATOR_TIMEOUT";

export class ComparatorError extends Error {
  readonly code: ComparatorErrorCode;

  constructor(code: ComparatorErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ComparatorError";
    this.code = code;
  }
}

export class ComparatorRunError extends ComparatorError {
  readonly attempts: readonly ComparatorAttempt[];

  constructor(error: ComparatorError, attempts: readonly ComparatorAttempt[]) {
    super(error.code, error.message, { cause: error });
    this.name = "ComparatorRunError";
    this.attempts = [...attempts];
  }
}

export class ComparatorTransportError extends Error {
  readonly result: ComparatorTransportResult;

  constructor(error: unknown, result: ComparatorTransportResult) {
    super("comparison transport failed", { cause: error });
    this.name = "ComparatorTransportError";
    this.result = result;
  }
}
