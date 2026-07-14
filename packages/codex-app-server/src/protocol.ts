import { z } from "zod";

import { AppServerError } from "./errors.js";

export const JsonRpcIdSchema = z.union([z.string(), z.number().int()]);

export const JsonRpcErrorSchema = z
  .object({
    code: z.number().int(),
    message: z.string(),
    data: z.unknown().optional(),
  })
  .loose();

export const JsonRpcEnvelopeSchema = z
  .object({
    id: JsonRpcIdSchema.optional(),
    method: z.string().optional(),
    params: z.unknown().optional(),
    result: z.unknown().optional(),
    error: JsonRpcErrorSchema.optional(),
  })
  .loose();

export const InitializeResponseSchema = z.object({}).loose();

export const ThreadStartResponseSchema = z
  .object({
    thread: z.object({ id: z.string().min(1) }).loose(),
    model: z.string().min(1),
    reasoningEffort: z.string().min(1).nullable().optional(),
  })
  .loose();

export const TurnStartResponseSchema = z
  .object({
    turn: z.object({ id: z.string().min(1), status: z.string().optional() }).loose(),
  })
  .loose();

export const ModelListResponseSchema = z
  .object({
    data: z.array(
      z
        .object({
          id: z.string().min(1),
          model: z.string().min(1),
          isDefault: z.boolean(),
          defaultReasoningEffort: z.string().min(1),
          supportedReasoningEfforts: z.array(
            z.object({ reasoningEffort: z.string().min(1) }).loose(),
          ),
        })
        .loose(),
    ),
    nextCursor: z.string().nullable().optional(),
  })
  .loose();

export const CommandActionSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("read"), command: z.string(), path: z.string(), name: z.string() })
    .loose(),
  z
    .object({
      type: z.literal("listFiles"),
      command: z.string(),
      path: z.string().nullable().optional(),
    })
    .loose(),
  z
    .object({
      type: z.literal("search"),
      command: z.string(),
      path: z.string().nullable().optional(),
      query: z.string().nullable().optional(),
    })
    .loose(),
  z.object({ type: z.literal("unknown"), command: z.string() }).loose(),
]);

export type ProtocolCommandAction = z.infer<typeof CommandActionSchema>;

export const CommandApprovalParamsSchema = z
  .object({
    threadId: z.string().min(1),
    turnId: z.string().min(1),
    itemId: z.string().min(1),
    commandActions: z.array(CommandActionSchema).nullable().optional(),
    cwd: z.string().nullable().optional(),
    networkApprovalContext: z.unknown().nullable().optional(),
    proposedExecpolicyAmendment: z.array(z.string()).nullable().optional(),
    proposedNetworkPolicyAmendments: z.array(z.unknown()).nullable().optional(),
  })
  .loose();

export const FileApprovalParamsSchema = z
  .object({
    threadId: z.string().min(1),
    turnId: z.string().min(1),
    itemId: z.string().min(1),
  })
  .loose();

export const PermissionApprovalParamsSchema = z
  .object({
    threadId: z.string().min(1),
    turnId: z.string().min(1),
    itemId: z.string().min(1).optional(),
  })
  .loose();

const BaseItemSchema = z.object({ id: z.string().min(1), type: z.string().min(1) }).loose();

export const AgentMessageItemSchema = z
  .object({ id: z.string().min(1), type: z.literal("agentMessage"), text: z.string() })
  .loose();

export const CommandExecutionItemSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal("commandExecution"),
    status: z.enum(["inProgress", "completed", "failed", "declined"]),
    commandActions: z.array(CommandActionSchema),
    cwd: z.string(),
  })
  .loose();

export const FileChangeItemSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal("fileChange"),
    status: z.enum(["inProgress", "completed", "failed", "declined"]),
  })
  .loose();

export type ParsedThreadItem =
  | z.infer<typeof AgentMessageItemSchema>
  | z.infer<typeof CommandExecutionItemSchema>
  | z.infer<typeof FileChangeItemSchema>
  | z.infer<typeof BaseItemSchema>;

export function parseThreadItem(value: unknown): ParsedThreadItem {
  const base = BaseItemSchema.safeParse(value);
  if (!base.success) {
    throw new AppServerError("PROTOCOL_VALIDATION_FAILED", "thread item was invalid");
  }
  if (base.data.type === "agentMessage") return AgentMessageItemSchema.parse(value);
  if (base.data.type === "commandExecution") return CommandExecutionItemSchema.parse(value);
  if (base.data.type === "fileChange") return FileChangeItemSchema.parse(value);
  return base.data;
}

export const ItemNotificationParamsSchema = z
  .object({
    threadId: z.string().min(1),
    turnId: z.string().min(1),
    item: z.unknown(),
  })
  .loose();

export const TurnNotificationParamsSchema = z
  .object({
    threadId: z.string().min(1),
    turn: z
      .object({
        id: z.string().min(1),
        status: z.enum(["completed", "interrupted", "failed", "inProgress"]),
      })
      .loose(),
  })
  .loose();

export const TurnDiffParamsSchema = z
  .object({
    threadId: z.string().min(1),
    turnId: z.string().min(1),
    diff: z.string(),
  })
  .loose();
