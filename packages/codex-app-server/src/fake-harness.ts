import type { PlanArtifactContent } from "@prompt-tripwire/domain";

import { MemoryJsonRpcTransport } from "./transport.js";
import type { JsonRpcId } from "./types.js";

export type FakeProbeOutcome =
  | "valid"
  | "invalid_output"
  | "duplicate_events"
  | "reordered_events"
  | "disconnect"
  | "timeout"
  | "static_read_approval"
  | "duplicate_static_read_approval"
  | "unsafe_command_approval"
  | "unsafe_command_observed"
  | "file_change_approval"
  | "permission_approval"
  | "nonempty_diff";

export interface FakeProbeScenario {
  readonly outcome: FakeProbeOutcome;
  readonly content?: PlanArtifactContent;
}

export interface FakeAppServerRequest {
  readonly id: JsonRpcId | null;
  readonly method: string;
  readonly params: unknown;
}

const DEFAULT_PLAN_CONTENT: PlanArtifactContent = {
  summary: "Implement the requested change with repository-grounded checks.",
  assumptions: [],
  intendedBehavior: ["The requested behavior is implemented."],
  filesToRead: ["README.md"],
  filesToChange: ["README.md"],
  components: ["documentation"],
  dataChanges: [],
  publicApiChanges: [],
  dependencyChanges: [],
  commands: ["npm test"],
  externalEffects: [],
  permissionChanges: [],
  compatibilityImpacts: [],
  reversibility: "reversible",
  verificationSteps: ["Run the relevant automated tests."],
  unknowns: [],
  repositoryEvidence: [
    {
      id: "evidence_readme",
      path: "README.md",
      startLine: 1,
      endLine: 1,
      description: "Repository entry point.",
    },
  ],
};

function rpcId(value: unknown): JsonRpcId | null {
  if (typeof value === "string" || typeof value === "number") return value;
  return null;
}

export class FakeAppServerHarness {
  readonly requests: FakeAppServerRequest[] = [];
  readonly clientResponses: unknown[] = [];
  private readonly transport: MemoryJsonRpcTransport;
  private readonly scenarios: FakeProbeScenario[];
  private nextThread = 1;
  private nextTurn = 1;
  private nextServerRequest = 10_000;
  private readonly approvalContinuations = new Map<JsonRpcId, () => void>();

  constructor(transport: MemoryJsonRpcTransport, scenarios: readonly FakeProbeScenario[]) {
    this.transport = transport;
    this.scenarios = [...scenarios];
    transport.onMessage((message) => {
      this.receive(message);
    });
  }

  private receive(value: unknown): void {
    if (value === null || typeof value !== "object") return;
    const message = value as Record<string, unknown>;
    const id = rpcId(message.id);
    if (typeof message.method !== "string") {
      this.clientResponses.push(structuredClone(value));
      if (id !== null) {
        const continuation = this.approvalContinuations.get(id);
        if (continuation !== undefined) {
          this.approvalContinuations.delete(id);
          queueMicrotask(continuation);
        }
      }
      return;
    }
    this.requests.push({ id, method: message.method, params: message.params });
    if (id === null) return;

    if (message.method === "initialize") {
      this.respond(id, { userAgent: "fake-app-server" });
      return;
    }
    if (message.method === "model/list") {
      this.respond(id, {
        data: [
          {
            id: "gpt-5.4",
            model: "gpt-5.4",
            isDefault: true,
            defaultReasoningEffort: "high",
            supportedReasoningEfforts: [{ reasoningEffort: "high" }],
          },
        ],
        nextCursor: null,
      });
      return;
    }
    if (message.method === "thread/start") {
      const threadId = `thread_fake_${String(this.nextThread)}`;
      this.nextThread += 1;
      const params = message.params as { model?: unknown };
      this.respond(id, {
        thread: { id: threadId },
        model: params.model,
        reasoningEffort: "high",
      });
      return;
    }
    if (message.method === "turn/start") {
      const params = message.params as { threadId: string; cwd: string };
      const turnId = `turn_fake_${String(this.nextTurn)}`;
      this.nextTurn += 1;
      const scenario = this.scenarios.shift() ?? { outcome: "valid" };
      this.respond(id, { turn: { id: turnId, status: "inProgress" } });
      queueMicrotask(() => {
        this.runScenario(params.threadId, turnId, params.cwd, scenario);
      });
      return;
    }
    if (message.method === "turn/interrupt") {
      this.respond(id, {});
      return;
    }
    this.respond(id, {});
  }

  private runScenario(
    threadId: string,
    turnId: string,
    cwd: string,
    scenario: FakeProbeScenario,
  ): void {
    if (scenario.outcome === "disconnect") {
      this.transport.disconnect();
      return;
    }
    if (scenario.outcome === "timeout") return;

    this.notify("turn/started", {
      threadId,
      turn: { id: turnId, status: "inProgress" },
    });
    if (
      scenario.outcome === "static_read_approval" ||
      scenario.outcome === "duplicate_static_read_approval"
    ) {
      this.requestApproval(
        "item/commandExecution/requestApproval",
        {
          threadId,
          turnId,
          itemId: `command_${turnId}`,
          cwd,
          commandActions: [
            {
              type: "read",
              command: "sed -n 1,80p README.md",
              path: `${cwd}/README.md`,
              name: "README.md",
            },
          ],
        },
        () => {
          this.completeScenario(threadId, turnId, scenario);
        },
        scenario.outcome === "duplicate_static_read_approval",
      );
      return;
    }
    if (scenario.outcome === "unsafe_command_approval") {
      this.requestApproval(
        "item/commandExecution/requestApproval",
        {
          threadId,
          turnId,
          itemId: `command_${turnId}`,
          cwd,
          commandActions: [{ type: "unknown", command: "npm test" }],
        },
        () => {
          this.completeScenario(threadId, turnId, scenario);
        },
      );
      return;
    }
    if (scenario.outcome === "file_change_approval") {
      this.requestApproval(
        "item/fileChange/requestApproval",
        {
          threadId,
          turnId,
          itemId: `file_${turnId}`,
        },
        () => {
          this.completeScenario(threadId, turnId, scenario);
        },
      );
      return;
    }
    if (scenario.outcome === "permission_approval") {
      this.requestApproval(
        "item/permissions/requestApproval",
        {
          threadId,
          turnId,
          itemId: `permission_${turnId}`,
          cwd,
          permissions: { network: { enabled: true } },
        },
        () => {
          this.completeScenario(threadId, turnId, scenario);
        },
      );
      return;
    }
    this.completeScenario(threadId, turnId, scenario, cwd);
  }

  private completeScenario(
    threadId: string,
    turnId: string,
    scenario: FakeProbeScenario,
    cwd = "/tmp/probe",
  ): void {
    const agentItem = {
      id: `agent_${turnId}`,
      type: "agentMessage",
      text:
        scenario.outcome === "invalid_output"
          ? "not-json"
          : JSON.stringify(scenario.content ?? DEFAULT_PLAN_CONTENT),
    };

    if (scenario.outcome === "reordered_events") {
      this.notify("item/completed", { threadId, turnId, item: agentItem });
      return;
    }
    if (scenario.outcome === "unsafe_command_observed") {
      const commandItem = {
        id: `command_${turnId}`,
        type: "commandExecution",
        status: "completed",
        command: "npm test",
        cwd,
        commandActions: [{ type: "unknown", command: "npm test" }],
      };
      this.notify("item/started", {
        threadId,
        turnId,
        item: { ...commandItem, status: "inProgress" },
      });
      this.notify("item/completed", { threadId, turnId, item: commandItem });
    }
    if (scenario.outcome === "nonempty_diff") {
      this.notify("turn/diff/updated", { threadId, turnId, diff: "+modified" });
    }

    this.notify("item/started", { threadId, turnId, item: agentItem });
    this.notify("item/completed", { threadId, turnId, item: agentItem });
    if (scenario.outcome === "duplicate_events") {
      this.notify("item/completed", { threadId, turnId, item: agentItem });
    }
    const completion = { threadId, turn: { id: turnId, status: "completed" } };
    this.notify("turn/completed", completion);
    if (scenario.outcome === "duplicate_events") this.notify("turn/completed", completion);
  }

  private requestApproval(
    method: string,
    params: unknown,
    continuation: () => void,
    duplicate = false,
  ): void {
    const id = this.nextServerRequest;
    this.nextServerRequest += 1;
    this.approvalContinuations.set(id, continuation);
    this.transport.send({ id, method, params });
    if (duplicate) this.transport.send({ id, method, params });
  }

  private respond(id: JsonRpcId, result: unknown): void {
    this.transport.send({ id, result });
  }

  private notify(method: string, params: unknown): void {
    this.transport.send({ method, params });
  }
}
