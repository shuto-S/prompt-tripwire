import {
  canonicalJson,
  ComparisonCandidateContentSchema,
  PlanArtifactContentSchema,
  PlanArtifactSchema,
} from "@prompt-tripwire/domain";
import { z } from "zod";

import { AppServerComparisonError, AppServerError, type AppServerErrorCode } from "./errors.js";
import { ProtocolEventLedger } from "./event-ledger.js";
import {
  CommandExecResponseSchema,
  InitializeResponseSchema,
  JsonRpcEnvelopeSchema,
  ModelListResponseSchema,
  ThreadTokenUsageUpdatedParamsSchema,
  ThreadStartResponseSchema,
  TurnStartResponseSchema,
  type ParsedThreadItem,
} from "./protocol.js";
import {
  comparisonItemViolation,
  decideComparatorApproval,
  decideProbeApproval,
  probeItemViolation,
} from "./probe-policy.js";
import type {
  ApprovalObservation,
  ComparisonTurnInput,
  ComparisonTurnResult,
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
const DEFAULT_COMPARISON_TIMEOUT_MS = 5 * 60_000;
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

const COMPARISON_DEVELOPER_INSTRUCTIONS = [
  "You are the PromptTripwire structured plan comparator.",
  "Compare only the task and validated plan artifacts supplied in the user message.",
  "Return consensus, materially different alternatives, and unresolved unknowns only.",
  "Suppress naming, prose ordering, and equivalent implementation details.",
  "Use only repository evidence IDs and probe IDs present in the supplied plans.",
  "Do not claim that deterministic safety triggers are approved or safe.",
  "Do not inspect the filesystem, execute commands, change files, use network tools, MCP/apps, subagents, or request additional permissions.",
  "Do not expose chain-of-thought. Return only the requested JSON object.",
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
  readonly signal: AbortSignal | undefined;
  readonly abortListener: (() => void) | undefined;
}

interface TurnWaitOptions {
  readonly timeoutCode: AppServerErrorCode;
  readonly timeoutMessage: string;
  readonly signal: AbortSignal | undefined;
  readonly cancelledCode: AppServerErrorCode;
  readonly cancelledMessage: string;
}

interface TurnState {
  readonly threadId: string;
  readonly turnId: string;
  readonly events: NormalizedAppServerEvent[];
  readonly agentMessages: string[];
  readonly waiters: TurnWaiter[];
  usage: ComparisonTurnResult["usage"];
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

function comparisonPrompt(input: ComparisonTurnInput): string {
  return [
    "Compare the supplied independent engineering plans.",
    "Use no information outside this JSON input:",
    JSON.stringify({ task: input.task, plans: input.plans }),
    "Return only the requested JSON object.",
  ].join("\n\n");
}

function comparisonContentJsonSchema(): unknown {
  return z.toJSONSchema(ComparisonCandidateContentSchema, {
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
  private readonly comparisonThreads = new Set<string>();
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
      const state = await this.waitForTurn(
        threadId,
        turnId,
        input.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
        {
          timeoutCode: "PROBE_TIMEOUT",
          timeoutMessage: "probe turn timed out",
          signal: input.signal,
          cancelledCode: "PROBE_CANCELLED",
          cancelledMessage: "probe was cancelled",
        },
      );
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

  async runComparison(input: ComparisonTurnInput): Promise<ComparisonTurnResult> {
    this.assertInitialized();
    const thread = ThreadStartResponseSchema.parse(
      await this.request("thread/start", {
        cwd: input.cwd,
        approvalPolicy: "untrusted",
        approvalsReviewer: "user",
        developerInstructions: COMPARISON_DEVELOPER_INSTRUCTIONS,
        sandbox: "read-only",
        ephemeral: true,
        serviceName: "prompt_tripwire_comparator",
        model: input.model,
      }),
    );
    const threadId = thread.thread.id;
    this.threadRoots.set(threadId, input.cwd);
    this.threadApprovals.set(threadId, []);
    // Keep this role for the client lifetime: App Server requests can arrive after
    // the turn result settles and must never fall through to the probe allowlist.
    this.comparisonThreads.add(threadId);

    let turnId: string | null = null;
    try {
      if (thread.model !== input.model) {
        throw new AppServerError(
          "PROTOCOL_VALIDATION_FAILED",
          "App Server changed comparator model",
        );
      }
      const turn = TurnStartResponseSchema.parse(
        await this.request("turn/start", {
          threadId,
          input: [{ type: "text", text: comparisonPrompt(input) }],
          cwd: input.cwd,
          approvalPolicy: "untrusted",
          approvalsReviewer: "user",
          sandboxPolicy: { type: "readOnly", networkAccess: false },
          model: input.model,
          effort: input.reasoningEffort,
          summary: "none",
          personality: "none",
          outputSchema: comparisonContentJsonSchema(),
        }),
      );
      turnId = turn.turn.id;
      const state = await this.waitForTurn(
        threadId,
        turnId,
        input.timeoutMs ?? DEFAULT_COMPARISON_TIMEOUT_MS,
        {
          timeoutCode: "COMPARISON_TIMEOUT",
          timeoutMessage: "comparison turn timed out",
          signal: input.signal,
          cancelledCode: "COMPARISON_CANCELLED",
          cancelledMessage: "comparison was cancelled",
        },
      );
      if (state.status !== "completed") {
        throw new AppServerError(
          "INVALID_COMPARISON_ARTIFACT",
          `comparison turn ended with status ${state.status ?? "unknown"}`,
        );
      }
      const finalMessage = state.agentMessages.at(-1);
      if (finalMessage === undefined) {
        throw new AppServerError(
          "INVALID_COMPARISON_ARTIFACT",
          "comparison produced no final agent message",
        );
      }
      let output: unknown;
      try {
        output = JSON.parse(finalMessage) as unknown;
      } catch (error) {
        throw new AppServerError("INVALID_COMPARISON_ARTIFACT", "comparison output was not JSON", {
          cause: error,
        });
      }
      const parsed = ComparisonCandidateContentSchema.safeParse(output);
      if (!parsed.success) {
        throw new AppServerError(
          "INVALID_COMPARISON_ARTIFACT",
          "comparison output did not match the comparison schema",
          { cause: parsed.error },
        );
      }
      return {
        threadId,
        turnId,
        model: thread.model,
        output: parsed.data,
        usage: state.usage,
      };
    } catch (error) {
      if (turnId !== null) {
        try {
          await this.request("turn/interrupt", { threadId, turnId }, 10_000);
        } catch {
          // The original comparison failure remains authoritative.
        }
      }
      const failure = appServerError(error, "comparison failed protocol validation");
      const usage = turnId === null ? null : this.turnState(threadId, turnId).usage;
      throw new AppServerComparisonError(failure, {
        threadId,
        turnId,
        model: thread.model,
        usage,
      });
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
      const state = await this.waitForTurn(
        threadId,
        turnId,
        input.timeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS,
        {
          timeoutCode: "EXECUTION_TIMEOUT",
          timeoutMessage: "execution turn timed out",
          signal: input.signal,
          cancelledCode: "EXECUTION_CANCELLED",
          cancelledMessage: "execution was cancelled",
        },
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
    if (threadId !== null && this.comparisonThreads.has(threadId)) {
      const decision = decideComparatorApproval(id, method, params);
      this.threadApprovals.get(threadId)?.push(decision.observation);
      const turnId = typeof record.turnId === "string" ? record.turnId : null;
      if (turnId === null) {
        throw new AppServerError(
          "PROTOCOL_CORRUPTION",
          "comparison server request omitted turn id",
        );
      }
      this.failTurn(
        this.turnState(threadId, turnId),
        new AppServerError(
          "COMPARISON_TOOL_VIOLATION",
          "comparison requested a prohibited tool or permission",
        ),
      );
      return decision.response;
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
    if (method === "thread/tokenUsage/updated") {
      try {
        const parsed = ThreadTokenUsageUpdatedParamsSchema.parse(params);
        const state = this.turnState(parsed.threadId, parsed.turnId);
        state.usage = {
          inputTokens: parsed.tokenUsage.last.inputTokens,
          outputTokens: parsed.tokenUsage.last.outputTokens,
          totalTokens: parsed.tokenUsage.last.totalTokens,
          reasoningTokens: parsed.tokenUsage.last.reasoningOutputTokens,
        };
      } catch (error) {
        this.failProtocol(appServerError(error, "token usage notification validation failed"));
      }
      return;
    }
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
      } else if (this.comparisonThreads.has(event.threadId)) {
        if (accepted.item !== null) this.observeComparisonItem(state, accepted.item, method);
        if (accepted.diff !== null && accepted.diff.trim().length > 0) {
          this.failTurn(
            state,
            new AppServerError(
              "COMPARISON_TOOL_VIOLATION",
              "comparison produced a repository diff",
            ),
          );
        }
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

  private observeComparisonItem(state: TurnState, item: ParsedThreadItem, method: string): void {
    const violation = comparisonItemViolation(item);
    if (violation !== null) {
      this.failTurn(state, new AppServerError("COMPARISON_TOOL_VIOLATION", violation));
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

  private waitForTurn(
    threadId: string,
    turnId: string,
    timeoutMs: number,
    options: TurnWaitOptions,
  ): Promise<TurnState> {
    if (this.protocolFailure !== null) return Promise.reject(this.protocolFailure);
    const state = this.turnState(threadId, turnId);
    if (state.error !== null) return Promise.reject(state.error);
    if (state.status !== null && state.status !== "inProgress") return Promise.resolve(state);
    if (options.signal?.aborted === true) {
      return Promise.reject(new AppServerError(options.cancelledCode, options.cancelledMessage));
    }
    return new Promise((resolve, reject) => {
      const rejectAndRemove = (error: AppServerError): void => {
        const index = state.waiters.indexOf(waiter);
        if (index < 0) return;
        state.waiters.splice(index, 1);
        this.cleanupWaiter(waiter);
        reject(error);
      };
      const timer = setTimeout(() => {
        rejectAndRemove(new AppServerError(options.timeoutCode, options.timeoutMessage));
      }, timeoutMs);
      const abortListener =
        options.signal === undefined
          ? undefined
          : (): void => {
              rejectAndRemove(new AppServerError(options.cancelledCode, options.cancelledMessage));
            };
      const waiter: TurnWaiter = { resolve, reject, timer, signal: options.signal, abortListener };
      state.waiters.push(waiter);
      if (abortListener !== undefined) {
        options.signal?.addEventListener("abort", abortListener, { once: true });
        // Close the race between the initial aborted check and listener registration.
        if (options.signal?.aborted === true) abortListener();
      }
    });
  }

  private cleanupWaiter(waiter: TurnWaiter): void {
    clearTimeout(waiter.timer);
    if (waiter.signal !== undefined && waiter.abortListener !== undefined) {
      waiter.signal.removeEventListener("abort", waiter.abortListener);
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
      usage: null,
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
      this.cleanupWaiter(waiter);
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
