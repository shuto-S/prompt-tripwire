import {
  canonicalJson,
  PlanArtifactContentSchema,
  PlanArtifactSchema,
} from "@prompt-tripwire/domain";
import { z } from "zod";

import { AppServerError } from "./errors.js";
import { ProtocolEventLedger } from "./event-ledger.js";
import {
  CommandExecResponseSchema,
  InitializeResponseSchema,
  JsonRpcEnvelopeSchema,
  ModelListResponseSchema,
  ThreadStartResponseSchema,
  TurnStartResponseSchema,
  type ParsedThreadItem,
} from "./protocol.js";
import { decideProbeApproval, probeItemViolation } from "./probe-policy.js";
import type {
  ApprovalObservation,
  ContractExecutionInput,
  ContractExecutionResult,
  ExecutionPolicyHooks,
  JsonRpcId,
  JsonRpcTransport,
  ModelDescriptor,
  NormalizedAppServerEvent,
  PlanProbeInput,
  PlanProbeResult,
  SandboxedCommandResult,
} from "./types.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_PROBE_TIMEOUT_MS = 180_000;
const DEFAULT_EXECUTION_TIMEOUT_MS = 30 * 60_000;
const SANDBOXED_COMMAND_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";

const PROBE_DEVELOPER_INSTRUCTIONS = [
  "You are one independent PromptTripwire planning probe.",
  "Analyze the requested engineering task against the repository snapshot without changing any file.",
  "Use only static repository inspection. Do not use interpreters, package managers, builds, tests, network access, MCP/apps, subagents, or write tools.",
  "The working directory is already the repository root; never run pwd or sed. Issue only one static read command at a time. Use only ls, find, rg, cat, head, tail, or wc. Never use pipes, command chaining, shell control operators, or git commands.",
  "If a needed inspection cannot be represented by structured read, listFiles, or search command actions, record it as an unknown instead of running it.",
  "Do not expose chain-of-thought. Return only the schema-constrained plan content with concise evidence-backed fields.",
].join("\n");

interface PendingRequest {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

interface TurnWaiter {
  readonly resolve: (state: TurnState) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

interface TurnState {
  readonly threadId: string;
  readonly turnId: string;
  readonly events: NormalizedAppServerEvent[];
  readonly agentMessages: string[];
  readonly waiters: TurnWaiter[];
  status: "completed" | "interrupted" | "failed" | "inProgress" | null;
  error: AppServerError | null;
}

interface CachedServerRequest {
  readonly identity: string;
  readonly result: Promise<unknown>;
}

interface ExecutionThreadContext {
  readonly policy: ExecutionPolicyHooks;
}

function rpcKey(id: JsonRpcId): string {
  return `${typeof id}:${String(id)}`;
}

function appServerError(error: unknown, fallback: string): AppServerError {
  if (error instanceof AppServerError) return error;
  return new AppServerError("PROTOCOL_VALIDATION_FAILED", fallback, { cause: error });
}

function planPrompt(input: PlanProbeInput): string {
  return [
    "Plan the following task. Do not implement it.",
    "",
    "Task:",
    input.snapshot.task,
    "",
    `Repository snapshot SHA-256: ${input.snapshot.snapshotHash}`,
    `Task SHA-256: ${input.snapshot.taskHash}`,
    "",
    "Inspect only repository files needed to ground the plan. Return only the requested JSON object.",
  ].join("\n");
}

function planContentJsonSchema(): unknown {
  return z.toJSONSchema(PlanArtifactContentSchema, {
    target: "draft-7",
    unrepresentable: "throw",
  });
}

export class CodexAppServerClient {
  private readonly transport: JsonRpcTransport;
  private readonly ledger = new ProtocolEventLedger();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly completedResponses = new Map<string, string>();
  private readonly serverRequests = new Map<string, CachedServerRequest>();
  private readonly threadRoots = new Map<string, string>();
  private readonly threadApprovals = new Map<string, ApprovalObservation[]>();
  private readonly executionThreads = new Map<string, ExecutionThreadContext>();
  private readonly turns = new Map<string, TurnState>();
  private readonly interruptingTurns = new Set<string>();
  private nextId = 1;
  private initialized = false;
  private closing = false;
  private protocolFailure: AppServerError | null = null;

  constructor(transport: JsonRpcTransport) {
    this.transport = transport;
    transport.onMessage((message) => {
      this.receive(message);
    });
    transport.onClose((event) => {
      if (this.closing && event.expected) return;
      this.failProtocol(
        new AppServerError("APP_SERVER_DISCONNECTED", `App Server disconnected: ${event.code}`),
      );
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const response = await this.request("initialize", {
      clientInfo: {
        name: "prompt_tripwire",
        title: "PromptTripwire",
        version: "0.1.0",
      },
    });
    InitializeResponseSchema.parse(response);
    this.notify("initialized", {});
    this.initialized = true;
  }

  async listModels(): Promise<readonly ModelDescriptor[]> {
    this.assertInitialized();
    const models: ModelDescriptor[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const response = ModelListResponseSchema.parse(
        await this.request("model/list", { cursor, includeHidden: false, limit: 100 }),
      );
      for (const model of response.data) {
        models.push({
          id: model.id,
          model: model.model,
          isDefault: model.isDefault,
          defaultReasoningEffort: model.defaultReasoningEffort,
          supportedReasoningEfforts: model.supportedReasoningEfforts.map(
            (effort) => effort.reasoningEffort,
          ),
        });
      }
      cursor = response.nextCursor ?? null;
      if (cursor === null) return models;
    }
    throw new AppServerError("PROTOCOL_CORRUPTION", "model list pagination did not terminate");
  }

  async runPlanProbe(input: PlanProbeInput): Promise<PlanProbeResult> {
    this.assertInitialized();
    const thread = ThreadStartResponseSchema.parse(
      await this.request("thread/start", {
        cwd: input.cwd,
        approvalPolicy: "untrusted",
        approvalsReviewer: "user",
        developerInstructions: PROBE_DEVELOPER_INSTRUCTIONS,
        sandbox: "read-only",
        ephemeral: true,
        serviceName: "prompt_tripwire_probe",
        model: input.model,
      }),
    );
    if (thread.model !== input.model) {
      throw new AppServerError("PROTOCOL_VALIDATION_FAILED", "App Server changed probe model");
    }
    const threadId = thread.thread.id;
    this.threadRoots.set(threadId, input.cwd);
    this.threadApprovals.set(threadId, []);

    let turnId: string | null = null;
    try {
      const turn = TurnStartResponseSchema.parse(
        await this.request("turn/start", {
          threadId,
          input: [{ type: "text", text: planPrompt(input) }],
          cwd: input.cwd,
          approvalPolicy: "untrusted",
          approvalsReviewer: "user",
          sandboxPolicy: { type: "readOnly", networkAccess: false },
          model: input.model,
          effort: input.reasoningEffort,
          summary: "none",
          personality: "none",
          outputSchema: planContentJsonSchema(),
        }),
      );
      turnId = turn.turn.id;
      const wait = this.waitForTurn(threadId, turnId, input.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS);
      const state =
        input.signal === undefined
          ? await wait
          : await Promise.race([
              wait,
              new Promise<never>((_resolve, reject) => {
                if (input.signal?.aborted === true) {
                  reject(new AppServerError("PROBE_CANCELLED", "probe was cancelled"));
                  return;
                }
                input.signal?.addEventListener(
                  "abort",
                  () => {
                    reject(new AppServerError("PROBE_CANCELLED", "probe was cancelled"));
                  },
                  { once: true },
                );
              }),
            ]);
      if (state.status !== "completed") {
        throw new AppServerError(
          "INVALID_PLAN_ARTIFACT",
          `probe turn ended with status ${state.status ?? "unknown"}`,
        );
      }
      const finalMessage = state.agentMessages.at(-1);
      if (finalMessage === undefined) {
        throw new AppServerError("INVALID_PLAN_ARTIFACT", "probe produced no final agent message");
      }
      let output: unknown;
      try {
        output = JSON.parse(finalMessage) as unknown;
      } catch (error) {
        throw new AppServerError("INVALID_PLAN_ARTIFACT", "probe output was not JSON", {
          cause: error,
        });
      }
      const parsedContent = PlanArtifactContentSchema.safeParse(output);
      if (!parsedContent.success) {
        throw new AppServerError(
          "INVALID_PLAN_ARTIFACT",
          "probe output did not match the plan schema",
          { cause: parsedContent.error },
        );
      }
      const content = parsedContent.data;
      const artifact = PlanArtifactSchema.parse({
        probeId: input.probeId,
        threadId,
        snapshotHash: input.snapshot.snapshotHash,
        taskHash: input.snapshot.taskHash,
        ...content,
      });
      return {
        probeId: input.probeId,
        threadId,
        turnId,
        artifact,
        approvals: [...(this.threadApprovals.get(threadId) ?? [])],
        events: [...state.events],
      };
    } catch (error) {
      if (turnId !== null) {
        try {
          await this.request("turn/interrupt", { threadId, turnId }, 10_000);
        } catch {
          // The original probe failure remains authoritative.
        }
      }
      if (error instanceof AppServerError && error.code === "PROBE_TIMEOUT") throw error;
      throw appServerError(error, "probe failed protocol validation");
    }
  }

  async runContractExecution(input: ContractExecutionInput): Promise<ContractExecutionResult> {
    this.assertInitialized();
    const thread = ThreadStartResponseSchema.parse(
      await this.request("thread/start", {
        cwd: input.cwd,
        approvalPolicy: "untrusted",
        approvalsReviewer: "user",
        developerInstructions: input.developerInstructions,
        sandbox: "workspace-write",
        ephemeral: true,
        serviceName: "prompt_tripwire_execution",
        model: input.model,
      }),
    );
    if (thread.model !== input.model) {
      throw new AppServerError("PROTOCOL_VALIDATION_FAILED", "App Server changed execution model");
    }
    const threadId = thread.thread.id;
    this.threadRoots.set(threadId, input.cwd);
    this.executionThreads.set(threadId, { policy: input.policy });

    let turnId: string | null = null;
    try {
      const turn = TurnStartResponseSchema.parse(
        await this.request("turn/start", {
          threadId,
          input: [{ type: "text", text: input.prompt }],
          cwd: input.cwd,
          approvalPolicy: "untrusted",
          approvalsReviewer: "user",
          sandboxPolicy: {
            type: "workspaceWrite",
            writableRoots: [],
            networkAccess: false,
            excludeSlashTmp: true,
            excludeTmpdirEnvVar: true,
          },
          model: input.model,
          effort: input.reasoningEffort,
          summary: "none",
          personality: "none",
        }),
      );
      turnId = turn.turn.id;
      input.onSessionStarted?.(threadId, turnId);
      const state = await this.waitForExecutionTurn(
        threadId,
        turnId,
        input.timeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS,
        input.signal,
      );
      if (state.status === null || state.status === "inProgress") {
        throw new AppServerError(
          "PROTOCOL_CORRUPTION",
          "execution turn did not reach a terminal state",
        );
      }
      return {
        threadId,
        turnId,
        model: thread.model,
        status: state.status,
        events: [...state.events],
      };
    } catch (error) {
      if (turnId !== null) {
        try {
          await this.interrupt(threadId, turnId);
        } catch {
          // Preserve the original execution failure.
        }
      }
      throw appServerError(error, "execution failed protocol validation");
    }
  }

  async execSandboxedCommand(input: {
    readonly command: readonly string[];
    readonly cwd: string;
    readonly timeoutMs?: number;
  }): Promise<SandboxedCommandResult> {
    this.assertInitialized();
    const response = CommandExecResponseSchema.parse(
      await this.request(
        "command/exec",
        {
          command: [...input.command],
          cwd: input.cwd,
          env: { PATH: SANDBOXED_COMMAND_PATH },
          sandboxPolicy: {
            type: "workspaceWrite",
            writableRoots: [],
            networkAccess: false,
            excludeSlashTmp: true,
            excludeTmpdirEnvVar: true,
          },
          timeoutMs: input.timeoutMs ?? 10 * 60_000,
          outputBytesCap: 512 * 1024,
        },
        (input.timeoutMs ?? 10 * 60_000) + 5_000,
      ),
    );
    return { exitCode: response.exitCode };
  }

  async interrupt(threadId: string, turnId: string): Promise<void> {
    await this.request("turn/interrupt", { threadId, turnId }, 10_000);
  }

  async close(): Promise<void> {
    this.closing = true;
    await this.transport.close();
  }

  private request(
    method: string,
    params: unknown,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    if (this.protocolFailure !== null) return Promise.reject(this.protocolFailure);
    const id = this.nextId;
    this.nextId += 1;
    const key = rpcKey(id);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new AppServerError("PROBE_TIMEOUT", `${method} timed out`));
      }, timeoutMs);
      this.pending.set(key, { method, resolve, reject, timer });
      try {
        this.transport.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(key);
        reject(appServerError(error, `${method} could not be sent`));
      }
    });
  }

  private notify(method: string, params: unknown): void {
    this.transport.send({ method, params });
  }

  private receive(value: unknown): void {
    if (this.protocolFailure !== null) return;
    let message: z.infer<typeof JsonRpcEnvelopeSchema>;
    try {
      message = JsonRpcEnvelopeSchema.parse(value);
    } catch (error) {
      this.failProtocol(
        new AppServerError("PROTOCOL_VALIDATION_FAILED", "invalid JSON-RPC envelope", {
          cause: error,
        }),
      );
      return;
    }
    if (message.id !== undefined && message.method === undefined) {
      this.receiveResponse(message.id, message.result, message.error);
      return;
    }
    if (message.id !== undefined && message.method !== undefined) {
      this.receiveServerRequest(message.id, message.method, message.params);
      return;
    }
    if (message.id === undefined && message.method !== undefined) {
      this.receiveNotification(message.method, message.params);
      return;
    }
    this.failProtocol(new AppServerError("PROTOCOL_CORRUPTION", "unclassifiable JSON-RPC message"));
  }

  private receiveResponse(
    id: JsonRpcId,
    result: unknown,
    error: z.infer<typeof JsonRpcEnvelopeSchema>["error"],
  ): void {
    const key = rpcKey(id);
    const identity = canonicalJson(
      { id, result: result ?? null, error: error ?? null },
      { omitKeys: new Set() },
    );
    const prior = this.completedResponses.get(key);
    if (prior !== undefined) {
      if (prior !== identity) {
        this.failProtocol(new AppServerError("PROTOCOL_CORRUPTION", "conflicting RPC response"));
      }
      return;
    }
    const pending = this.pending.get(key);
    if (pending === undefined) {
      this.failProtocol(
        new AppServerError("PROTOCOL_CORRUPTION", "response had no pending request"),
      );
      return;
    }
    this.pending.delete(key);
    this.completedResponses.set(key, identity);
    clearTimeout(pending.timer);
    if (error !== undefined) {
      pending.reject(
        new AppServerError("JSON_RPC_ERROR", `${pending.method} failed (${String(error.code)})`),
      );
    } else {
      pending.resolve(result);
    }
  }

  private receiveServerRequest(id: JsonRpcId, method: string, params: unknown): void {
    const key = rpcKey(id);
    const identity = canonicalJson({ id, method, params: params ?? null }, { omitKeys: new Set() });
    const prior = this.serverRequests.get(key);
    if (prior !== undefined) {
      if (prior.identity !== identity) {
        this.failProtocol(
          new AppServerError("PROTOCOL_CORRUPTION", "conflicting duplicate server request"),
        );
        return;
      }
      void prior.result.then((result) => {
        this.transport.send({ id, result });
      });
      return;
    }

    const result = Promise.resolve().then(() => this.handleServerRequest(id, method, params));
    this.serverRequests.set(key, { identity, result });
    void result
      .then((response) => {
        this.transport.send({ id, result: response });
      })
      .catch((error: unknown) => {
        this.transport.send({
          id,
          error: { code: -32_000, message: "PromptTripwire rejected invalid server request" },
        });
        this.failProtocol(appServerError(error, "server request validation failed"));
      });
  }

  private handleServerRequest(id: JsonRpcId, method: string, params: unknown): unknown {
    const record =
      params !== null && typeof params === "object" ? (params as Record<string, unknown>) : {};
    const threadId = typeof record.threadId === "string" ? record.threadId : null;
    const root = threadId === null ? undefined : this.threadRoots.get(threadId);
    if (root === undefined) {
      throw new AppServerError("PROTOCOL_CORRUPTION", "approval request had no known thread");
    }
    const execution = threadId === null ? undefined : this.executionThreads.get(threadId);
    if (execution !== undefined) {
      if (threadId === null) {
        throw new AppServerError("PROTOCOL_CORRUPTION", "execution approval omitted thread id");
      }
      const decision = execution.policy.decideApproval(id, method, params);
      if (decision.pause) {
        const turnId =
          params !== null &&
          typeof params === "object" &&
          "turnId" in params &&
          typeof params.turnId === "string"
            ? params.turnId
            : null;
        if (turnId !== null) {
          setTimeout(() => {
            this.requestExecutionPause(threadId, turnId);
          }, 0);
        }
      }
      return decision.response;
    }
    const decision = decideProbeApproval(id, method, params, root);
    if (threadId !== null) this.threadApprovals.get(threadId)?.push(decision.observation);
    return decision.response;
  }

  private receiveNotification(method: string, params: unknown): void {
    if (
      !new Set([
        "thread/started",
        "turn/started",
        "item/started",
        "item/completed",
        "turn/diff/updated",
        "turn/completed",
      ]).has(method)
    ) {
      if (method === "error") {
        this.failProtocol(new AppServerError("JSON_RPC_ERROR", "App Server emitted an error"));
      }
      return;
    }
    try {
      const accepted = this.ledger.accept(method, params);
      if (accepted.duplicate || accepted.event === null) return;
      const event = accepted.event;
      if (event.turnId === null || event.threadId === null) return;
      const state = this.turnState(event.threadId, event.turnId);
      state.events.push(event);
      const execution = this.executionThreads.get(event.threadId);
      if (execution !== undefined) {
        let pause = false;
        if (accepted.item !== null && (method === "item/started" || method === "item/completed")) {
          pause = execution.policy.observeItem(accepted.item, method).pause || pause;
        }
        if (accepted.diff !== null) {
          pause = execution.policy.observeDiff(accepted.diff).pause || pause;
        }
        if (pause) this.requestExecutionPause(event.threadId, event.turnId);
      } else {
        if (accepted.item !== null) this.observeProbeItem(state, accepted.item, method);
        if (accepted.diff !== null && accepted.diff.trim().length > 0) {
          this.failTurn(
            state,
            new AppServerError("PROBE_CONTAINMENT_VIOLATION", "probe produced a repository diff"),
          );
        }
      }
      if (method === "turn/completed") {
        state.status = event.status as TurnState["status"];
        this.settleTurn(state);
      }
    } catch (error) {
      this.failProtocol(appServerError(error, "notification validation failed"));
    }
  }

  private observeProbeItem(state: TurnState, item: ParsedThreadItem, method: string): void {
    const root = this.threadRoots.get(state.threadId);
    if (root === undefined) {
      this.failTurn(
        state,
        new AppServerError("PROTOCOL_CORRUPTION", "item belonged to unknown thread"),
      );
      return;
    }
    const violation = probeItemViolation(item, root);
    if (violation !== null) {
      this.failTurn(state, new AppServerError("PROBE_CONTAINMENT_VIOLATION", violation));
      return;
    }
    if (
      method === "item/completed" &&
      item.type === "agentMessage" &&
      "text" in item &&
      typeof item.text === "string"
    ) {
      state.agentMessages.push(item.text);
    }
  }

  private waitForTurn(threadId: string, turnId: string, timeoutMs: number): Promise<TurnState> {
    if (this.protocolFailure !== null) return Promise.reject(this.protocolFailure);
    const state = this.turnState(threadId, turnId);
    if (state.error !== null) return Promise.reject(state.error);
    if (state.status !== null && state.status !== "inProgress") return Promise.resolve(state);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = state.waiters.findIndex((waiter) => waiter.resolve === resolve);
        if (index >= 0) state.waiters.splice(index, 1);
        reject(new AppServerError("PROBE_TIMEOUT", "probe turn timed out"));
      }, timeoutMs);
      state.waiters.push({ resolve, reject, timer });
    });
  }

  private async waitForExecutionTurn(
    threadId: string,
    turnId: string,
    timeoutMs: number,
    signal: AbortSignal | undefined,
  ): Promise<TurnState> {
    const wait = this.waitForTurn(threadId, turnId, timeoutMs);
    if (signal === undefined) {
      try {
        return await wait;
      } catch (error) {
        if (error instanceof AppServerError && error.code === "PROBE_TIMEOUT") {
          throw new AppServerError("EXECUTION_TIMEOUT", "execution turn timed out");
        }
        throw error;
      }
    }
    if (signal.aborted) {
      throw new AppServerError("EXECUTION_CANCELLED", "execution was cancelled");
    }
    let rejectAbort: ((error: Error) => void) | null = null;
    const listener = (): void => {
      rejectAbort?.(new AppServerError("EXECUTION_CANCELLED", "execution was cancelled"));
    };
    try {
      return await Promise.race([
        wait,
        new Promise<never>((_resolve, reject) => {
          rejectAbort = reject;
          signal.addEventListener("abort", listener, { once: true });
        }),
      ]);
    } catch (error) {
      if (error instanceof AppServerError && error.code === "PROBE_TIMEOUT") {
        throw new AppServerError("EXECUTION_TIMEOUT", "execution turn timed out");
      }
      throw error;
    } finally {
      signal.removeEventListener("abort", listener);
    }
  }

  private requestExecutionPause(threadId: string, turnId: string): void {
    const key = `${threadId}:${turnId}`;
    if (this.interruptingTurns.has(key)) return;
    this.interruptingTurns.add(key);
    const state = this.turnState(threadId, turnId);
    void this.interrupt(threadId, turnId)
      .catch(() => undefined)
      .finally(() => {
        if (state.status === null || state.status === "inProgress") state.status = "interrupted";
        this.settleTurn(state);
      });
  }

  private turnState(threadId: string, turnId: string): TurnState {
    const prior = this.turns.get(turnId);
    if (prior !== undefined) {
      if (prior.threadId !== threadId) {
        throw new AppServerError("PROTOCOL_CORRUPTION", "turn changed thread identity");
      }
      return prior;
    }
    const state: TurnState = {
      threadId,
      turnId,
      events: [],
      agentMessages: [],
      waiters: [],
      status: null,
      error: null,
    };
    this.turns.set(turnId, state);
    return state;
  }

  private failTurn(state: TurnState, error: AppServerError): void {
    if (state.error !== null) return;
    state.error = error;
    this.settleTurn(state);
  }

  private settleTurn(state: TurnState): void {
    if (state.error === null && (state.status === null || state.status === "inProgress")) return;
    for (const waiter of state.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      if (state.error !== null) waiter.reject(state.error);
      else waiter.resolve(state);
    }
  }

  private failProtocol(error: AppServerError): void {
    if (this.protocolFailure !== null) return;
    this.protocolFailure = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const state of this.turns.values()) this.failTurn(state, error);
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new AppServerError("PROTOCOL_CORRUPTION", "App Server client is not initialized");
    }
    if (this.protocolFailure !== null) throw this.protocolFailure;
  }
}
