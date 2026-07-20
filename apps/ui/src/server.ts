import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { LocalController } from "@prompt-tripwire/controller";
import { sanitizeForExport } from "@prompt-tripwire/policy";

import type {
  DecisionCardDto,
  MutationResponseDto,
  RunEventDto,
  RunReviewDto,
} from "./api-types.js";

const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_STATIC_ROOT = fileURLToPath(new URL("../web-dist/", import.meta.url));
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1_000;
const DEFAULT_LIFECYCLE_POLL_MS = 500;
const DEFAULT_CLOSE_GRACE_MS = 500;
const DEFAULT_REQUEST_BODY_TIMEOUT_MS = 5_000;
const REVIEWABLE_STATES = new Set(["needs_review", "ready_for_approval", "paused"]);

export interface ReviewServerOptions {
  readonly controller: LocalController;
  readonly runId: string;
  readonly staticRoot?: string;
  readonly mode?: "live" | "recorded";
  readonly idleTimeoutMs?: number;
  readonly lifecyclePollMs?: number;
  readonly closeGraceMs?: number;
  readonly requestBodyTimeoutMs?: number;
}

export type ReviewServerCloseReason =
  "manual" | "terminal_state" | "archived" | "idle_timeout" | "run_unavailable" | "superseded";

export interface ReviewServerClose {
  readonly reason: ReviewServerCloseReason;
}

export interface ReviewServer {
  readonly origin: string;
  readonly url: string;
  readonly capabilityToken: string;
  readonly closed: Promise<ReviewServerClose>;
  close(): Promise<void>;
}

function positiveDuration(value: number | undefined, fallback: number, name: string): number {
  const duration = value ?? fallback;
  if (!Number.isSafeInteger(duration) || duration <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return duration;
}

function securityHeaders(): Readonly<Record<string, string>> {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    ...securityHeaders(),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(value)}\n`);
}

function errorCode(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return error instanceof SyntaxError || error instanceof TypeError ? "INVALID_REQUEST" : "FAILED";
}

function statusForError(code: string): number {
  if (code === "NOT_FOUND") return 404;
  if (code === "RUN_ARCHIVED" || code === "CAPABILITY_REVOKED") return 410;
  if (code === "CONFLICTING_VERSION" || code === "CONFLICTING_IDEMPOTENCY_KEY") return 409;
  if (code === "INVALID_REQUEST") return 400;
  return 422;
}

function requestToken(request: IncomingMessage): string | null {
  const value = request.headers.authorization;
  return value?.startsWith("Bearer ") === true ? value.slice("Bearer ".length) : null;
}

function validToken(actual: string | null, expectedDigest: Buffer): boolean {
  if (actual === null) return false;
  const digest = createHash("sha256").update(actual, "utf8").digest();
  return timingSafeEqual(digest, expectedDigest);
}

function header(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  return typeof value === "string" ? value : null;
}

function sameOriginMutation(request: IncomingMessage, origin: string): boolean {
  const fetchSite = header(request, "sec-fetch-site");
  return (
    header(request, "origin") === origin &&
    (fetchSite === null || fetchSite === "same-origin") &&
    request.headers["content-type"]?.split(";", 1)[0]?.trim() === "application/json"
  );
}

async function readJson(
  request: IncomingMessage,
  requestBodyTimeoutMs: number,
): Promise<Record<string, unknown>> {
  const body = (async (): Promise<Record<string, unknown>> => {
    let byteCount = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      byteCount += bytes.byteLength;
      if (byteCount > MAX_BODY_BYTES) throw new TypeError("request body is too large");
      chunks.push(bytes);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("request body must be a JSON object");
    }
    return value as Record<string, unknown>;
  })();
  const timedOut = Promise.withResolvers<never>();
  const timeout = setTimeout(() => {
    request.destroy();
    timedOut.reject(
      Object.assign(new Error("request body timed out"), {
        code: "REQUEST_BODY_TIMEOUT",
      }),
    );
  }, requestBodyTimeoutMs);
  timeout.unref();
  try {
    return await Promise.race([body, timedOut.promise]);
  } finally {
    clearTimeout(timeout);
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} is required`);
  return value;
}

function nullableString(value: unknown, name: string): string | null {
  if (value === null) return null;
  return requiredString(value, name);
}

function requiredVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError("expectedVersion must be a non-negative integer");
  }
  return value;
}

function mutationKey(request: IncomingMessage): string {
  return requiredString(header(request, "idempotency-key"), "Idempotency-Key");
}

function toReviewDto(
  controller: LocalController,
  runId: string,
  mode: "live" | "recorded",
): RunReviewDto {
  const review = controller.review(runId);
  const open = review.decisions.filter(
    (decision): decision is typeof decision & { status: "unresolved" | "deferred" } =>
      decision.status !== "resolved",
  );
  const decisions: DecisionCardDto[] = open.slice(0, 3).map((decision) => ({
    decisionId: decision.decisionId,
    category: decision.category,
    question: decision.question,
    reason: decision.reason,
    impact: decision.impact,
    options: decision.options,
    freeformAllowed: decision.freeformAllowed,
    defaultOptionId: decision.defaultOptionId,
    deterministicTriggers: decision.deterministicTriggers,
    evidenceRefs: decision.evidenceRefs,
    status: decision.status,
  }));
  const dto: RunReviewDto = {
    mode,
    runId: review.run.runId,
    state: review.run.state,
    version: review.run.version,
    updatedAt: review.run.updatedAt,
    lastErrorCode: review.run.lastErrorCode,
    snapshot:
      review.snapshot === null
        ? null
        : {
            repositoryPath: review.snapshot.repositoryPath,
            commitSha: review.snapshot.commitSha,
            branch: review.snapshot.branch,
            task: review.snapshot.task,
            modelId: review.snapshot.model.id,
          },
    decisions,
    remainingDecisionCount: Math.max(0, open.length - decisions.length),
    resolvedDecisionCount: review.decisions.length - open.length,
    contract:
      review.contract === null
        ? null
        : {
            contractId: review.contract.contractId,
            contentHash: review.contract.contentHash,
            approvedGoal: review.contract.approvedGoal,
            approvedBehaviors: review.contract.approvedBehaviors,
            allowedPaths: review.contract.allowedPaths,
            protectedPaths: review.contract.protectedPaths,
            requiredChecks: review.contract.requiredChecks,
            stopConditions: review.contract.stopConditions,
            approvedAt: review.contract.approvedAt,
          },
    deviations: review.report?.deviations ?? [],
    presentation:
      review.presentation === null
        ? null
        : {
            locale: review.presentation.locale,
            status: review.presentation.status,
            sourceHash: review.presentation.sourceHash,
            task: review.presentation.content?.task ?? null,
            decisions: review.presentation.content?.decisions ?? [],
          },
  };
  const sanitized = sanitizeForExport(dto);
  if (!sanitized.allowed) throw new TypeError("review response could not be sanitized");
  return sanitized.value as unknown as RunReviewDto;
}

function toEvent(controller: LocalController, runId: string): RunEventDto {
  const run = controller.status(runId).run;
  return {
    runId: run.runId,
    state: run.state,
    version: run.version,
    blockingDecisionCount: run.blockingDecisionIds.length,
    updatedAt: run.updatedAt,
  };
}

function mutationResponse(run: {
  runId: string;
  state: string;
  version: number;
}): MutationResponseDto {
  return { runId: run.runId, state: run.state, version: run.version };
}

function contentType(path: string): string {
  switch (extname(path)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function serveStatic(response: ServerResponse, pathname: string, staticRoot: string): void {
  const root = resolve(staticRoot);
  const relativePath = pathname.startsWith("/assets/") ? pathname.slice(1) : "index.html";
  const filePath = resolve(root, relativePath);
  if (
    !filePath.startsWith(`${root}${sep}`) ||
    !existsSync(filePath) ||
    !statSync(filePath).isFile()
  ) {
    writeJson(response, 404, { code: "NOT_FOUND" });
    return;
  }
  response.writeHead(200, {
    ...securityHeaders(),
    "Content-Type":
      relativePath === "index.html" ? "text/html; charset=utf-8" : contentType(filePath),
  });
  createReadStream(filePath).pipe(response);
}

export async function startReviewServer(options: ReviewServerOptions): Promise<ReviewServer> {
  const mode = options.mode ?? "live";
  const initialStatus = options.controller.status(options.runId);
  if (initialStatus.archived) {
    throw Object.assign(new Error("archived runs cannot open a Decision Inbox"), {
      code: "RUN_ARCHIVED",
    });
  }
  if (mode === "live" && !REVIEWABLE_STATES.has(initialStatus.run.state)) {
    throw Object.assign(new Error("this run is not reviewable"), {
      code: "RUN_NOT_REVIEWABLE",
    });
  }
  const capabilityToken = randomBytes(32).toString("base64url");
  const tokenDigest = createHash("sha256").update(capabilityToken, "utf8").digest();
  const staticRoot = options.staticRoot ?? DEFAULT_STATIC_ROOT;
  const idleTimeoutMs = positiveDuration(
    options.idleTimeoutMs,
    DEFAULT_IDLE_TIMEOUT_MS,
    "idleTimeoutMs",
  );
  const lifecyclePollMs = positiveDuration(
    options.lifecyclePollMs,
    DEFAULT_LIFECYCLE_POLL_MS,
    "lifecyclePollMs",
  );
  const closeGraceMs = positiveDuration(
    options.closeGraceMs,
    DEFAULT_CLOSE_GRACE_MS,
    "closeGraceMs",
  );
  const requestBodyTimeoutMs = positiveDuration(
    options.requestBodyTimeoutMs,
    DEFAULT_REQUEST_BODY_TIMEOUT_MS,
    "requestBodyTimeoutMs",
  );
  let origin = "";
  const streams = new Set<ServerResponse>();
  let lastAuthenticatedActivity = Date.now();
  let lifecycleTimer: ReturnType<typeof setInterval> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let closing: Promise<void> | null = null;
  let capabilityRevoked = false;
  let reviewCapabilityGeneration: number | null = null;
  let resolveClosed: ((event: ReviewServerClose) => void) | null = null;
  const closed = new Promise<ReviewServerClose>((resolvePromise) => {
    resolveClosed = resolvePromise;
  });

  const enforceRequestBoundary = (response: ServerResponse): boolean => {
    if (capabilityRevoked) {
      writeJson(response, 410, { code: "CAPABILITY_REVOKED" });
      return false;
    }
    try {
      const current = options.controller.status(options.runId);
      if (current.archived) {
        writeJson(response, 410, { code: "RUN_ARCHIVED" });
        scheduleClose("archived");
        return false;
      }
      if (mode === "live" && !REVIEWABLE_STATES.has(current.run.state)) {
        writeJson(response, 410, { code: "RUN_NOT_REVIEWABLE" });
        scheduleClose("terminal_state");
        return false;
      }
      if (
        mode === "live" &&
        (reviewCapabilityGeneration === null ||
          !options.controller.isReviewCapabilityCurrent(options.runId, reviewCapabilityGeneration))
      ) {
        writeJson(response, 410, { code: "CAPABILITY_REVOKED" });
        scheduleClose("superseded");
        return false;
      }
      return true;
    } catch {
      writeJson(response, 404, { code: "NOT_FOUND" });
      scheduleClose("run_unavailable");
      return false;
    }
  };

  const handleRequest = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    try {
      if (origin.length === 0 || header(request, "host") !== new URL(origin).host) {
        writeJson(response, 421, { code: "INVALID_HOST" });
        return;
      }
      const url = new URL(request.url ?? "/", origin);
      const runApi = url.pathname.match(/^\/api\/runs\/([^/]+)$/u);
      const eventsApi = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/u);
      const decisionsApi = url.pathname.match(/^\/api\/runs\/([^/]+)\/decisions$/u);
      const evidenceApi = url.pathname.match(/^\/api\/runs\/([^/]+)\/evidence$/u);
      const decisionApi = url.pathname.match(/^\/api\/runs\/([^/]+)\/decisions\/([^/]+)$/u);
      const currentContractApi = url.pathname.match(/^\/api\/runs\/([^/]+)\/contracts\/current$/u);
      const approveApi = url.pathname.match(/^\/api\/runs\/([^/]+)\/contracts\/approve$/u);
      const reopenApi = url.pathname.match(/^\/api\/runs\/([^/]+)\/contracts\/reopen$/u);
      const cancelApi = url.pathname.match(/^\/api\/runs\/([^/]+)\/cancel$/u);
      const isApi = url.pathname.startsWith("/api/");

      if (isApi && !validToken(requestToken(request), tokenDigest)) {
        writeJson(response, 401, { code: "UNAUTHORIZED" });
        return;
      }
      if (isApi) {
        lastAuthenticatedActivity = Date.now();
        if (!enforceRequestBoundary(response)) return;
      }
      const routeRunId =
        runApi?.[1] ??
        eventsApi?.[1] ??
        decisionsApi?.[1] ??
        evidenceApi?.[1] ??
        decisionApi?.[1] ??
        currentContractApi?.[1] ??
        approveApi?.[1] ??
        reopenApi?.[1] ??
        cancelApi?.[1];
      if (isApi && routeRunId !== undefined && decodeURIComponent(routeRunId) !== options.runId) {
        writeJson(response, 404, { code: "NOT_FOUND" });
        return;
      }
      if (isApi && request.method === "POST" && mode === "recorded") {
        writeJson(response, 405, { code: "RECORDED_REPLAY_READ_ONLY" });
        return;
      }
      if (isApi && request.method === "POST" && !sameOriginMutation(request, origin)) {
        writeJson(response, 403, { code: "CROSS_ORIGIN_MUTATION_DENIED" });
        return;
      }
      if (runApi !== null && request.method === "GET") {
        const runId = decodeURIComponent(requiredString(runApi[1], "runId"));
        writeJson(response, 200, toReviewDto(options.controller, runId, mode));
        return;
      }
      if (eventsApi !== null && request.method === "GET") {
        const runId = decodeURIComponent(requiredString(eventsApi[1], "runId"));
        if (runId !== options.runId) {
          writeJson(response, 404, { code: "NOT_FOUND" });
          return;
        }
        let initialEvent: RunEventDto;
        try {
          initialEvent = toEvent(options.controller, runId);
        } catch {
          writeJson(response, 404, { code: "NOT_FOUND" });
          scheduleClose("run_unavailable");
          return;
        }
        response.writeHead(200, {
          ...securityHeaders(),
          Connection: "keep-alive",
          "Content-Type": "text/event-stream; charset=utf-8",
        });
        streams.add(response);
        let previous = "";
        const writeEvent = (event: RunEventDto): void => {
          const serialized = JSON.stringify(event);
          if (serialized !== previous) {
            response.write(`event: run\ndata: ${serialized}\n\n`);
            previous = serialized;
          }
        };
        const send = (): void => {
          writeEvent(toEvent(options.controller, runId));
        };
        writeEvent(initialEvent);
        const timer = setInterval(() => {
          try {
            send();
          } catch {
            clearInterval(timer);
            streams.delete(response);
            response.end();
            scheduleClose("run_unavailable");
          }
        }, 750);
        request.on("close", () => {
          clearInterval(timer);
          streams.delete(response);
        });
        return;
      }
      if (decisionsApi !== null && request.method === "GET") {
        const runId = decodeURIComponent(requiredString(decisionsApi[1], "runId"));
        const review = toReviewDto(options.controller, runId, mode);
        writeJson(response, 200, {
          runId: review.runId,
          state: review.state,
          version: review.version,
          decisions: review.decisions,
          remainingDecisionCount: review.remainingDecisionCount,
          resolvedDecisionCount: review.resolvedDecisionCount,
        });
        return;
      }
      if (evidenceApi !== null && request.method === "GET") {
        const runId = decodeURIComponent(requiredString(evidenceApi[1], "runId"));
        writeJson(response, 200, options.controller.reviewEvidence(runId));
        return;
      }
      if (currentContractApi !== null && request.method === "GET") {
        const runId = decodeURIComponent(requiredString(currentContractApi[1], "runId"));
        const review = toReviewDto(options.controller, runId, mode);
        writeJson(response, 200, {
          runId: review.runId,
          state: review.state,
          version: review.version,
          contract: review.contract,
        });
        return;
      }
      if (decisionApi !== null && request.method === "POST") {
        const runId = decodeURIComponent(requiredString(decisionApi[1], "runId"));
        const decisionId = decodeURIComponent(requiredString(decisionApi[2], "decisionId"));
        const body = await readJson(request, requestBodyTimeoutMs);
        if (!enforceRequestBoundary(response)) return;
        if (!["select", "freeform", "defer"].includes(String(body.action))) {
          throw new TypeError("action must be select, freeform, or defer");
        }
        const expectedVersion = requiredVersion(body.expectedVersion);
        const key = mutationKey(request);
        const run =
          body.action === "defer"
            ? options.controller.defer({
                runId,
                decisionId,
                expectedVersion,
                idempotencyKey: key,
                requireUnpinned: true,
                ...(reviewCapabilityGeneration === null ? {} : { reviewCapabilityGeneration }),
              })
            : options.controller.decide({
                runId,
                decisionId,
                selectedOptionId:
                  body.action === "select"
                    ? requiredString(body.selectedOptionId, "selectedOptionId")
                    : null,
                freeformOverride:
                  body.action === "freeform"
                    ? requiredString(body.freeformOverride, "freeformOverride")
                    : null,
                rationale:
                  body.rationale === undefined ? null : nullableString(body.rationale, "rationale"),
                expectedVersion,
                idempotencyKey: key,
                requireUnpinned: true,
                ...(reviewCapabilityGeneration === null ? {} : { reviewCapabilityGeneration }),
              });
        writeJson(response, 200, mutationResponse(run));
        return;
      }
      if (approveApi !== null && request.method === "POST") {
        const runId = decodeURIComponent(requiredString(approveApi[1], "runId"));
        const body = await readJson(request, requestBodyTimeoutMs);
        if (!enforceRequestBoundary(response)) return;
        const run = await options.controller.approve({
          runId,
          contractId: requiredString(body.contractId, "contractId"),
          expectedVersion: requiredVersion(body.expectedVersion),
          idempotencyKey: mutationKey(request),
          requireUnpinned: true,
          ...(reviewCapabilityGeneration === null ? {} : { reviewCapabilityGeneration }),
        });
        writeJson(response, 200, mutationResponse(run));
        scheduleClose("terminal_state");
        return;
      }
      if (reopenApi !== null && request.method === "POST") {
        const runId = decodeURIComponent(requiredString(reopenApi[1], "runId"));
        const body = await readJson(request, requestBodyTimeoutMs);
        if (!enforceRequestBoundary(response)) return;
        const run = options.controller.reopenReview({
          runId,
          expectedVersion: requiredVersion(body.expectedVersion),
          idempotencyKey: mutationKey(request),
          requireUnpinned: true,
          ...(reviewCapabilityGeneration === null ? {} : { reviewCapabilityGeneration }),
        });
        writeJson(response, 200, mutationResponse(run));
        return;
      }
      if (cancelApi !== null && request.method === "POST") {
        const runId = decodeURIComponent(requiredString(cancelApi[1], "runId"));
        const body = await readJson(request, requestBodyTimeoutMs);
        if (!enforceRequestBoundary(response)) return;
        const run = await options.controller.cancelVersioned({
          runId,
          expectedVersion: requiredVersion(body.expectedVersion),
          idempotencyKey: mutationKey(request),
          requireUnpinned: true,
          ...(reviewCapabilityGeneration === null ? {} : { reviewCapabilityGeneration }),
        });
        writeJson(response, 200, mutationResponse(run));
        scheduleClose("terminal_state");
        return;
      }
      if (!isApi && (request.method === "GET" || request.method === "HEAD")) {
        serveStatic(response, url.pathname, staticRoot);
        return;
      }
      writeJson(response, 404, { code: "NOT_FOUND" });
    } catch (error) {
      if (response.destroyed) return;
      if (response.headersSent) {
        if (!response.writableEnded) response.end();
        return;
      }
      const code = errorCode(error);
      if (code === "CAPABILITY_REVOKED") scheduleClose("superseded");
      writeJson(response, statusForError(code), {
        code,
        message: "Request could not be completed.",
      });
    }
  };
  const server = createServer((request, response) => {
    void handleRequest(request, response).catch(() => {
      if (!response.destroyed) response.destroy();
    });
  });

  const closeServer = (reason: ReviewServerCloseReason): Promise<void> => {
    if (closing !== null) return closing;
    capabilityRevoked = true;
    if (lifecycleTimer !== null) clearInterval(lifecycleTimer);
    if (closeTimer !== null) clearTimeout(closeTimer);
    for (const stream of streams) stream.end();
    streams.clear();
    closing = new Promise<void>((resolveClose, reject) => {
      server.close((error) => {
        if (error === undefined) {
          resolveClosed?.({ reason });
          resolveClosed = null;
          resolveClose();
        } else {
          reject(error);
        }
      });
      server.closeAllConnections();
    });
    return closing;
  };

  function scheduleClose(reason: ReviewServerCloseReason): void {
    if (closing !== null || closeTimer !== null) return;
    capabilityRevoked = true;
    closeTimer = setTimeout(() => {
      closeTimer = null;
      void closeServer(reason);
    }, closeGraceMs);
    closeTimer.unref();
  }

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolveListen();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new TypeError("review server did not receive a TCP address");
  }
  origin = `http://127.0.0.1:${String(address.port)}`;
  let currentAfterBind: ReturnType<LocalController["status"]>;
  try {
    currentAfterBind = options.controller.status(options.runId);
  } catch (error) {
    await closeServer("run_unavailable");
    throw error;
  }
  if (currentAfterBind.archived) {
    await closeServer("archived");
    throw Object.assign(new Error("archived runs cannot open a Decision Inbox"), {
      code: "RUN_ARCHIVED",
    });
  }
  if (mode === "live" && !REVIEWABLE_STATES.has(currentAfterBind.run.state)) {
    await closeServer("terminal_state");
    throw Object.assign(new Error("this run is not reviewable"), {
      code: "RUN_NOT_REVIEWABLE",
    });
  }
  if (mode === "live") {
    try {
      reviewCapabilityGeneration = options.controller.claimReviewCapability(options.runId);
    } catch (error) {
      const code = errorCode(error);
      await closeServer(
        code === "RUN_ARCHIVED"
          ? "archived"
          : code === "RUN_NOT_REVIEWABLE"
            ? "terminal_state"
            : "run_unavailable",
      );
      throw error;
    }
  }
  lifecycleTimer = setInterval(() => {
    try {
      const current = options.controller.status(options.runId);
      if (!REVIEWABLE_STATES.has(current.run.state)) {
        scheduleClose("terminal_state");
        return;
      }
      if (current.archived) {
        scheduleClose("archived");
        return;
      }
      if (
        mode === "live" &&
        (reviewCapabilityGeneration === null ||
          !options.controller.isReviewCapabilityCurrent(options.runId, reviewCapabilityGeneration))
      ) {
        scheduleClose("superseded");
        return;
      }
      if (streams.size === 0 && Date.now() - lastAuthenticatedActivity >= idleTimeoutMs) {
        scheduleClose("idle_timeout");
      }
    } catch {
      scheduleClose("run_unavailable");
    }
  }, lifecyclePollMs);
  const url = `${origin}/runs/${encodeURIComponent(options.runId)}#token=${encodeURIComponent(capabilityToken)}`;
  return {
    origin,
    url,
    capabilityToken,
    closed,
    async close(): Promise<void> {
      await closeServer("manual");
    },
  };
}
