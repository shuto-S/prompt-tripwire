import { ControllerError } from "./errors.js";

export async function withTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeoutError = new ControllerError("OPERATION_TIMEOUT", "operation timed out");
  const running = operation(controller.signal);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      running,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort(timeoutError);
          reject(timeoutError);
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error !== timeoutError) throw error;
    try {
      await running;
    } catch {
      // The timeout remains authoritative after cooperative cancellation settles.
    }
    throw timeoutError;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
