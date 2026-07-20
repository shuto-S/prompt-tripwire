import { readFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalHash } from "@prompt-tripwire/domain";

import { AppServerError } from "./errors.js";

export const COMPATIBILITY_PROFILE_VERSION = 1;

export const CONSUMED_CLIENT_REQUESTS = Object.freeze({
  initialize: "InitializeParams",
  "model/list": "ModelListParams",
  "thread/start": "ThreadStartParams",
  "turn/start": "TurnStartParams",
  "turn/interrupt": "TurnInterruptParams",
  "command/exec": "CommandExecParams",
});

export const CONSUMED_CLIENT_NOTIFICATIONS = Object.freeze({
  initialized: null,
});

export const CONSUMED_NOTIFICATIONS = Object.freeze({
  "thread/started": "ThreadStartedNotification",
  "turn/started": "TurnStartedNotification",
  "item/started": "ItemStartedNotification",
  "item/completed": "ItemCompletedNotification",
  "turn/diff/updated": "TurnDiffUpdatedNotification",
  "turn/completed": "TurnCompletedNotification",
  "thread/tokenUsage/updated": "ThreadTokenUsageUpdatedNotification",
  error: "ErrorNotification",
});

export const HANDLED_SERVER_REQUESTS = Object.freeze({
  "item/commandExecution/requestApproval": "CommandExecutionRequestApprovalParams",
  "item/fileChange/requestApproval": "FileChangeRequestApprovalParams",
  "item/permissions/requestApproval": "PermissionsRequestApprovalParams",
  "item/tool/requestUserInput": "ToolRequestUserInputParams",
  "mcpServer/elicitation/request": "McpServerElicitationRequestParams",
  "item/tool/call": "DynamicToolCallParams",
});

export const KNOWN_PROTOCOL_ENUMS = Object.freeze({
  turnStatus: ["completed", "interrupted", "failed", "inProgress"] as const,
  commandStatus: ["inProgress", "completed", "failed", "declined"] as const,
  fileChangeStatus: ["inProgress", "completed", "failed", "declined"] as const,
  fileChangeKind: ["add", "delete", "update"] as const,
  commandActionType: ["read", "listFiles", "search", "unknown"] as const,
  networkProtocol: ["http", "https", "socks5Tcp", "socks5Udp"] as const,
});

type JsonSchema = Record<string, unknown>;
type JsonKind = "array" | "boolean" | "integer" | "null" | "number" | "object" | "string";

interface FieldProfile {
  readonly path: string;
  readonly types: readonly JsonKind[];
  readonly required: boolean;
  readonly enumIncludes?: readonly string[];
}

interface DefinitionProfile {
  readonly file: string;
  readonly fields: readonly FieldProfile[];
}

interface VariantProfile {
  readonly value: string;
  readonly fields: readonly FieldProfile[];
}

interface UnionProfile {
  readonly file: string;
  readonly definition: string;
  readonly discriminator: string;
  readonly variants: readonly VariantProfile[];
}

const DEFINITION_PROFILE: readonly DefinitionProfile[] = [
  {
    file: "v1/InitializeParams.json",
    fields: [
      { path: "clientInfo", types: ["object"], required: true },
      { path: "clientInfo.name", types: ["string"], required: true },
      { path: "clientInfo.title", types: ["null", "string"], required: false },
      { path: "clientInfo.version", types: ["string"], required: true },
    ],
  },
  {
    file: "v2/ModelListParams.json",
    fields: [
      { path: "cursor", types: ["null", "string"], required: false },
      { path: "includeHidden", types: ["boolean", "null"], required: false },
      { path: "limit", types: ["integer", "null"], required: false },
    ],
  },
  {
    file: "v2/ThreadStartResponse.json",
    fields: [
      { path: "thread", types: ["object"], required: true },
      { path: "thread.id", types: ["string"], required: true },
      { path: "model", types: ["string"], required: true },
      { path: "reasoningEffort", types: ["null", "string"], required: false },
    ],
  },
  {
    file: "v2/TurnStartResponse.json",
    fields: [
      { path: "turn", types: ["object"], required: true },
      { path: "turn.id", types: ["string"], required: true },
      { path: "turn.status", types: ["string"], required: true },
    ],
  },
  {
    file: "v2/ModelListResponse.json",
    fields: [
      { path: "data", types: ["array"], required: true },
      { path: "data[].id", types: ["string"], required: true },
      { path: "data[].model", types: ["string"], required: true },
      { path: "data[].isDefault", types: ["boolean"], required: true },
      { path: "data[].defaultReasoningEffort", types: ["string"], required: true },
      { path: "data[].supportedReasoningEfforts", types: ["array"], required: true },
      {
        path: "data[].supportedReasoningEfforts[].reasoningEffort",
        types: ["string"],
        required: true,
      },
      { path: "nextCursor", types: ["null", "string"], required: false },
    ],
  },
  {
    file: "v2/CommandExecResponse.json",
    fields: [
      { path: "exitCode", types: ["integer"], required: true },
      { path: "stdout", types: ["string"], required: true },
      { path: "stderr", types: ["string"], required: true },
    ],
  },
  {
    file: "v2/ThreadStartParams.json",
    fields: [
      { path: "cwd", types: ["null", "string"], required: false },
      {
        path: "approvalPolicy",
        types: ["null", "object", "string"],
        required: false,
        enumIncludes: ["untrusted"],
      },
      {
        path: "approvalsReviewer",
        types: ["null", "string"],
        required: false,
        enumIncludes: ["user"],
      },
      { path: "developerInstructions", types: ["null", "string"], required: false },
      {
        path: "sandbox",
        types: ["null", "string"],
        required: false,
        enumIncludes: ["read-only", "workspace-write"],
      },
      { path: "ephemeral", types: ["boolean", "null"], required: false },
      { path: "serviceName", types: ["null", "string"], required: false },
      { path: "model", types: ["null", "string"], required: false },
    ],
  },
  {
    file: "v2/TurnStartParams.json",
    fields: [
      { path: "threadId", types: ["string"], required: true },
      { path: "input", types: ["array"], required: true },
      { path: "cwd", types: ["null", "string"], required: false },
      {
        path: "approvalPolicy",
        types: ["null", "object", "string"],
        required: false,
        enumIncludes: ["untrusted"],
      },
      {
        path: "approvalsReviewer",
        types: ["null", "string"],
        required: false,
        enumIncludes: ["user"],
      },
      { path: "sandboxPolicy", types: ["null", "object"], required: false },
      { path: "model", types: ["null", "string"], required: false },
      { path: "effort", types: ["null", "string"], required: false },
      { path: "summary", types: ["null", "string"], required: false, enumIncludes: ["none"] },
      {
        path: "personality",
        types: ["null", "string"],
        required: false,
        enumIncludes: ["none"],
      },
      { path: "outputSchema", types: [], required: false },
    ],
  },
  {
    file: "v2/TurnInterruptParams.json",
    fields: [
      { path: "threadId", types: ["string"], required: true },
      { path: "turnId", types: ["string"], required: true },
    ],
  },
  {
    file: "v2/CommandExecParams.json",
    fields: [
      { path: "command", types: ["array"], required: true },
      { path: "command[]", types: ["string"], required: true },
      { path: "cwd", types: ["null", "string"], required: false },
      { path: "env", types: ["null", "object"], required: false },
      { path: "sandboxPolicy", types: ["null", "object"], required: false },
      { path: "timeoutMs", types: ["integer", "null"], required: false },
      { path: "outputBytesCap", types: ["integer", "null"], required: false },
    ],
  },
  {
    file: "v2/TurnCompletedNotification.json",
    fields: [
      { path: "threadId", types: ["string"], required: true },
      { path: "turn.id", types: ["string"], required: true },
      {
        path: "turn.status",
        types: ["string"],
        required: true,
        enumIncludes: KNOWN_PROTOCOL_ENUMS.turnStatus,
      },
    ],
  },
  {
    file: "v2/TurnStartedNotification.json",
    fields: [
      { path: "threadId", types: ["string"], required: true },
      { path: "turn.id", types: ["string"], required: true },
      {
        path: "turn.status",
        types: ["string"],
        required: true,
        enumIncludes: KNOWN_PROTOCOL_ENUMS.turnStatus,
      },
    ],
  },
  ...["v2/ItemStartedNotification.json", "v2/ItemCompletedNotification.json"].map(
    (file): DefinitionProfile => ({
      file,
      fields: [
        { path: "threadId", types: ["string"], required: true },
        { path: "turnId", types: ["string"], required: true },
        { path: "item", types: ["object"], required: true },
      ],
    }),
  ),
  {
    file: "v2/TurnDiffUpdatedNotification.json",
    fields: [
      { path: "threadId", types: ["string"], required: true },
      { path: "turnId", types: ["string"], required: true },
      { path: "diff", types: ["string"], required: true },
    ],
  },
  {
    file: "v2/ThreadTokenUsageUpdatedNotification.json",
    fields: [
      { path: "threadId", types: ["string"], required: true },
      { path: "turnId", types: ["string"], required: true },
      { path: "tokenUsage.last.inputTokens", types: ["integer"], required: true },
      { path: "tokenUsage.last.outputTokens", types: ["integer"], required: true },
      { path: "tokenUsage.last.totalTokens", types: ["integer"], required: true },
      { path: "tokenUsage.last.reasoningOutputTokens", types: ["integer"], required: true },
    ],
  },
  {
    file: "CommandExecutionRequestApprovalParams.json",
    fields: [
      { path: "threadId", types: ["string"], required: true },
      { path: "turnId", types: ["string"], required: true },
      { path: "itemId", types: ["string"], required: true },
      { path: "command", types: ["null", "string"], required: false },
      { path: "commandActions", types: ["array", "null"], required: false },
      { path: "cwd", types: ["null", "string"], required: false },
      { path: "networkApprovalContext", types: ["null", "object"], required: false },
      { path: "networkApprovalContext.host", types: ["string"], required: true },
      {
        path: "networkApprovalContext.protocol",
        types: ["string"],
        required: true,
        enumIncludes: KNOWN_PROTOCOL_ENUMS.networkProtocol,
      },
      { path: "proposedExecpolicyAmendment", types: ["array", "null"], required: false },
      {
        path: "proposedNetworkPolicyAmendments",
        types: ["array", "null"],
        required: false,
      },
    ],
  },
  {
    file: "FileChangeRequestApprovalParams.json",
    fields: [
      { path: "threadId", types: ["string"], required: true },
      { path: "turnId", types: ["string"], required: true },
      { path: "itemId", types: ["string"], required: true },
    ],
  },
  {
    file: "PermissionsRequestApprovalParams.json",
    fields: [
      { path: "threadId", types: ["string"], required: true },
      { path: "turnId", types: ["string"], required: true },
      { path: "itemId", types: ["string"], required: true },
      { path: "cwd", types: ["string"], required: true },
      { path: "permissions", types: ["object"], required: true },
      { path: "permissions.fileSystem", types: ["null", "object"], required: false },
      { path: "permissions.network", types: ["null", "object"], required: false },
    ],
  },
  {
    file: "DynamicToolCallParams.json",
    fields: [
      { path: "threadId", types: ["string"], required: true },
      { path: "turnId", types: ["string"], required: true },
      { path: "callId", types: ["string"], required: true },
      { path: "tool", types: ["string"], required: true },
      { path: "namespace", types: ["null", "string"], required: false },
      { path: "arguments", types: [], required: true },
    ],
  },
  {
    file: "ToolRequestUserInputParams.json",
    fields: [
      { path: "threadId", types: ["string"], required: true },
      { path: "turnId", types: ["string"], required: true },
      { path: "itemId", types: ["string"], required: true },
    ],
  },
  {
    file: "McpServerElicitationRequestParams.json",
    fields: [
      { path: "threadId", types: ["string"], required: true },
      { path: "turnId", types: ["null", "string"], required: false },
    ],
  },
  {
    file: "CommandExecutionRequestApprovalResponse.json",
    fields: [
      {
        path: "decision",
        types: ["object", "string"],
        required: true,
        enumIncludes: ["accept", "decline"],
      },
    ],
  },
  {
    file: "FileChangeRequestApprovalResponse.json",
    fields: [
      {
        path: "decision",
        types: ["string"],
        required: true,
        enumIncludes: ["accept", "decline"],
      },
    ],
  },
  {
    file: "PermissionsRequestApprovalResponse.json",
    fields: [
      { path: "permissions", types: ["object"], required: true },
      { path: "scope", types: ["string"], required: false, enumIncludes: ["turn"] },
      { path: "strictAutoReview", types: ["boolean", "null"], required: false },
    ],
  },
  {
    file: "DynamicToolCallResponse.json",
    fields: [
      { path: "success", types: ["boolean"], required: true },
      { path: "contentItems", types: ["array"], required: true },
    ],
  },
  {
    file: "McpServerElicitationRequestResponse.json",
    fields: [
      { path: "action", types: ["string"], required: true, enumIncludes: ["decline"] },
      { path: "content", types: [], required: false },
    ],
  },
  {
    file: "ToolRequestUserInputResponse.json",
    fields: [{ path: "answers", types: ["object"], required: true }],
  },
];

const THREAD_ITEM_VARIANTS: readonly VariantProfile[] = [
  {
    value: "agentMessage",
    fields: [
      { path: "id", types: ["string"], required: true },
      { path: "text", types: ["string"], required: true },
    ],
  },
  {
    value: "commandExecution",
    fields: [
      { path: "id", types: ["string"], required: true },
      { path: "command", types: ["string"], required: true },
      { path: "commandActions", types: ["array"], required: true },
      { path: "cwd", types: ["string"], required: true },
      {
        path: "status",
        types: ["string"],
        required: true,
        enumIncludes: KNOWN_PROTOCOL_ENUMS.commandStatus,
      },
    ],
  },
  {
    value: "fileChange",
    fields: [
      { path: "id", types: ["string"], required: true },
      { path: "changes", types: ["array"], required: true },
      { path: "changes[].path", types: ["string"], required: true },
      { path: "changes[].kind", types: ["object"], required: true },
      { path: "changes[].diff", types: ["string"], required: true },
      {
        path: "status",
        types: ["string"],
        required: true,
        enumIncludes: KNOWN_PROTOCOL_ENUMS.fileChangeStatus,
      },
    ],
  },
];

const COMMAND_ACTION_VARIANTS: readonly VariantProfile[] = [
  {
    value: "read",
    fields: [
      { path: "command", types: ["string"], required: true },
      { path: "path", types: ["string"], required: true },
      { path: "name", types: ["string"], required: true },
    ],
  },
  {
    value: "listFiles",
    fields: [
      { path: "command", types: ["string"], required: true },
      { path: "path", types: ["null", "string"], required: false },
    ],
  },
  {
    value: "search",
    fields: [
      { path: "command", types: ["string"], required: true },
      { path: "path", types: ["null", "string"], required: false },
      { path: "query", types: ["null", "string"], required: false },
    ],
  },
  {
    value: "unknown",
    fields: [{ path: "command", types: ["string"], required: true }],
  },
];

const PATCH_CHANGE_KIND_VARIANTS: readonly VariantProfile[] = [
  { value: "add", fields: [] },
  { value: "delete", fields: [] },
  {
    value: "update",
    fields: [{ path: "move_path", types: ["null", "string"], required: false }],
  },
];

const SANDBOX_POLICY_VARIANTS: readonly VariantProfile[] = [
  {
    value: "readOnly",
    fields: [{ path: "networkAccess", types: ["boolean"], required: false }],
  },
  {
    value: "workspaceWrite",
    fields: [
      { path: "networkAccess", types: ["boolean"], required: false },
      { path: "writableRoots", types: ["array"], required: false },
      { path: "excludeSlashTmp", types: ["boolean"], required: false },
      { path: "excludeTmpdirEnvVar", types: ["boolean"], required: false },
    ],
  },
];

const UNION_PROFILES: readonly UnionProfile[] = [
  ...["v2/TurnStartParams.json", "v2/CommandExecParams.json"].map((file): UnionProfile => ({
    file,
    definition: "SandboxPolicy",
    discriminator: "type",
    variants: SANDBOX_POLICY_VARIANTS,
  })),
  {
    file: "CommandExecutionRequestApprovalParams.json",
    definition: "CommandAction",
    discriminator: "type",
    variants: COMMAND_ACTION_VARIANTS,
  },
  ...["v2/ItemStartedNotification.json", "v2/ItemCompletedNotification.json"].flatMap(
    (file): readonly UnionProfile[] => [
      {
        file,
        definition: "CommandAction",
        discriminator: "type",
        variants: COMMAND_ACTION_VARIANTS,
      },
      {
        file,
        definition: "PatchChangeKind",
        discriminator: "type",
        variants: PATCH_CHANGE_KIND_VARIANTS,
      },
    ],
  ),
];

export const CODEX_COMPATIBILITY_PROFILE = Object.freeze({
  profileVersion: COMPATIBILITY_PROFILE_VERSION,
  clientRequests: CONSUMED_CLIENT_REQUESTS,
  clientNotifications: CONSUMED_CLIENT_NOTIFICATIONS,
  notifications: CONSUMED_NOTIFICATIONS,
  serverRequests: HANDLED_SERVER_REQUESTS,
  definitions: DEFINITION_PROFILE,
  threadItemVariants: THREAD_ITEM_VARIANTS,
  unionProfiles: UNION_PROFILES,
  canary: Object.freeze({
    model: "gpt-5.6-sol",
    reasoningEffort: "low",
    cwd: "private-temp",
    sandbox: "read-only",
    network: "deny",
    tools: "deny-all",
    output: "nonce-only-json",
  }),
});

function record(value: unknown, label: string): JsonSchema {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AppServerError("CODEX_COMPATIBILITY_FAILED", `${label} was not an object`);
  }
  return value as JsonSchema;
}

function schemaRecord(value: unknown, label: string): JsonSchema {
  if (value === true) return {};
  if (value === false) {
    throw new AppServerError("CODEX_COMPATIBILITY_FAILED", `${label} rejected every value`);
  }
  return record(value, label);
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function resolveReference(document: JsonSchema, value: JsonSchema): JsonSchema {
  const reference = value.$ref;
  if (typeof reference !== "string" || !reference.startsWith("#/definitions/")) return value;
  const name = reference.slice("#/definitions/".length);
  return record(record(document.definitions, "schema definitions")[name], `definition ${name}`);
}

function alternatives(document: JsonSchema, value: JsonSchema): readonly JsonSchema[] {
  const resolved = resolveReference(document, value);
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const entries = resolved[key];
    if (Array.isArray(entries)) {
      return entries.map((entry) =>
        resolveReference(document, schemaRecord(entry, `${key} entry`)),
      );
    }
  }
  return [resolved];
}

function leafSchemas(document: JsonSchema, value: JsonSchema): readonly JsonSchema[] {
  const resolved = resolveReference(document, value);
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const entries = resolved[key];
    if (Array.isArray(entries)) {
      return entries.flatMap((entry) =>
        leafSchemas(document, schemaRecord(entry, `${key} leaf entry`)),
      );
    }
  }
  return [resolved];
}

function propertySchemaWithParent(
  document: JsonSchema,
  value: JsonSchema,
  name: string,
): { readonly parent: JsonSchema; readonly schema: JsonSchema } | null {
  const resolved = resolveReference(document, value);
  const candidates = [
    resolved,
    ...alternatives(document, resolved).filter((item) => item !== resolved),
  ];
  for (const candidate of candidates) {
    const properties = candidate.properties;
    if (properties !== null && typeof properties === "object" && !Array.isArray(properties)) {
      const property = (properties as JsonSchema)[name];
      if (property !== undefined) {
        return { parent: candidate, schema: schemaRecord(property, `property ${name}`) };
      }
    }
  }
  return null;
}

function propertySchema(document: JsonSchema, value: JsonSchema, name: string): JsonSchema | null {
  return propertySchemaWithParent(document, value, name)?.schema ?? null;
}

function itemSchema(document: JsonSchema, value: JsonSchema): JsonSchema | null {
  for (const candidate of alternatives(document, value)) {
    if (candidate.items !== undefined) return schemaRecord(candidate.items, "array items");
  }
  return null;
}

function schemaKinds(document: JsonSchema, value: JsonSchema): readonly JsonKind[] {
  const result = new Set<JsonKind>();
  for (const candidate of leafSchemas(document, value)) {
    const type = candidate.type;
    const types = typeof type === "string" ? [type] : stringArray(type);
    for (const item of types) {
      if (
        new Set(["array", "boolean", "integer", "null", "number", "object", "string"]).has(item)
      ) {
        result.add(item as JsonKind);
      }
    }
    if (candidate.properties !== undefined) result.add("object");
    if (candidate.items !== undefined) result.add("array");
    const enumValues = candidate.enum;
    if (Array.isArray(enumValues)) {
      for (const enumValue of enumValues) {
        if (typeof enumValue === "string") result.add("string");
      }
    }
  }
  return [...result].sort();
}

function enumValues(document: JsonSchema, value: JsonSchema): readonly string[] {
  const result = new Set<string>();
  for (const candidate of leafSchemas(document, value)) {
    for (const entry of stringArray(candidate.enum)) result.add(entry);
  }
  return [...result].sort();
}

function observeField(document: JsonSchema, root: JsonSchema, profile: FieldProfile): unknown {
  let current = root;
  let parent: JsonSchema | null = null;
  let propertyName: string | null = null;
  for (const rawSegment of profile.path.split(".")) {
    const array = rawSegment.endsWith("[]");
    const name = array ? rawSegment.slice(0, -2) : rawSegment;
    if (name.length > 0) {
      propertyName = name;
      const property = propertySchemaWithParent(document, current, name);
      if (property === null) {
        throw new AppServerError(
          "CODEX_COMPATIBILITY_FAILED",
          `${profile.path} was missing from the generated schema`,
        );
      }
      parent = property.parent;
      current = property.schema;
    }
    if (array) {
      const items = itemSchema(document, current);
      if (items === null) {
        throw new AppServerError(
          "CODEX_COMPATIBILITY_FAILED",
          `${profile.path} was not an array in the generated schema`,
        );
      }
      current = items;
      parent = null;
      propertyName = null;
    }
  }
  if (parent !== null && propertyName !== null) {
    const required = stringArray(parent.required);
    if (required.includes(propertyName) !== profile.required) {
      throw new AppServerError(
        "CODEX_COMPATIBILITY_FAILED",
        `${profile.path} changed requiredness`,
      );
    }
  }
  const kinds = schemaKinds(document, current);
  if (
    profile.types.length > 0 &&
    (kinds.length !== profile.types.length || profile.types.some((type) => !kinds.includes(type)))
  ) {
    throw new AppServerError(
      "CODEX_COMPATIBILITY_FAILED",
      `${profile.path} changed type or nullability`,
    );
  }
  const enums = enumValues(document, current);
  if (profile.enumIncludes?.some((value) => !enums.includes(value)) === true) {
    throw new AppServerError(
      "CODEX_COMPATIBILITY_FAILED",
      `${profile.path} removed a required enum variant`,
    );
  }
  return {
    path: profile.path,
    required: profile.required,
    types: kinds,
    enumIncludes: profile.enumIncludes === undefined ? [] : [...profile.enumIncludes].sort(),
  };
}

function parseSchema(path: string): JsonSchema {
  try {
    return record(JSON.parse(readFileSync(path, "utf8")) as unknown, `schema ${path}`);
  } catch (error) {
    if (error instanceof AppServerError) throw error;
    throw new AppServerError("CODEX_COMPATIBILITY_FAILED", "Generated schema was not valid JSON", {
      cause: error,
    });
  }
}

function methodMap(path: string): ReadonlyMap<string, string | null> {
  const document = parseSchema(path);
  const variants = document.oneOf;
  if (!Array.isArray(variants)) {
    throw new AppServerError("CODEX_COMPATIBILITY_FAILED", "Method schema omitted oneOf");
  }
  const methods = new Map<string, string | null>();
  for (const entry of variants) {
    const variant = record(entry, "method variant");
    const properties = record(variant.properties, "method properties");
    const method = record(properties.method, "method discriminator");
    const values = stringArray(method.enum);
    const params = properties.params;
    const reference = params === undefined ? null : record(params, "method params").$ref;
    if (values.length === 1 && (reference === null || typeof reference === "string")) {
      methods.set(values[0] ?? "", reference === null ? null : (reference.split("/").at(-1) ?? ""));
    }
  }
  return methods;
}

function observeMethods(
  path: string,
  expected: Readonly<Record<string, string | null>>,
): readonly unknown[] {
  const observed = methodMap(path);
  return Object.entries(expected)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([method, params]) => {
      if (observed.get(method) !== params) {
        throw new AppServerError(
          "CODEX_COMPATIBILITY_FAILED",
          `${method} was missing or changed parameters`,
        );
      }
      return { method, params };
    });
}

function observeUnionVariants(
  document: JsonSchema,
  union: JsonSchema,
  discriminator: string,
  profiles: readonly VariantProfile[],
): readonly unknown[] {
  const variants = resolveReference(document, union).oneOf;
  if (!Array.isArray(variants)) {
    throw new AppServerError("CODEX_COMPATIBILITY_FAILED", "Consumed union omitted variants");
  }
  return profiles.map((profile) => {
    const variant = variants
      .map((entry) => schemaRecord(entry, "union variant"))
      .find((entry) => {
        const type = propertySchema(document, entry, discriminator);
        return type !== null && enumValues(document, type).includes(profile.value);
      });
    if (variant === undefined) {
      throw new AppServerError(
        "CODEX_COMPATIBILITY_FAILED",
        `Consumed union removed ${profile.value}`,
      );
    }
    return {
      variant: profile.value,
      discriminator,
      fields: profile.fields.map((field) => observeField(document, variant, field)),
    };
  });
}

export function validateGeneratedCompatibilitySchema(schemaDirectory: string): {
  readonly schemaFingerprint: string;
} {
  const observed: unknown[] = [
    ...observeMethods(join(schemaDirectory, "ClientRequest.json"), CONSUMED_CLIENT_REQUESTS),
    ...observeMethods(
      join(schemaDirectory, "ClientNotification.json"),
      CONSUMED_CLIENT_NOTIFICATIONS,
    ),
    ...observeMethods(join(schemaDirectory, "ServerNotification.json"), CONSUMED_NOTIFICATIONS),
    ...observeMethods(join(schemaDirectory, "ServerRequest.json"), HANDLED_SERVER_REQUESTS),
  ];
  for (const definition of DEFINITION_PROFILE) {
    const document = parseSchema(join(schemaDirectory, definition.file));
    try {
      observed.push({
        file: definition.file,
        fields: definition.fields.map((field) => observeField(document, document, field)),
      });
    } catch (error) {
      if (error instanceof AppServerError) {
        throw new AppServerError(
          "CODEX_COMPATIBILITY_FAILED",
          `${definition.file}: ${error.message}`,
          { cause: error },
        );
      }
      throw error;
    }
  }
  for (const file of ["v2/ItemStartedNotification.json", "v2/ItemCompletedNotification.json"]) {
    const threadItems = parseSchema(join(schemaDirectory, file));
    const threadItemDefinition = record(
      record(threadItems.definitions, `${file} ThreadItem definitions`).ThreadItem,
      `${file} ThreadItem definition`,
    );
    observed.push({
      file,
      threadItemVariants: observeUnionVariants(
        threadItems,
        threadItemDefinition,
        "type",
        THREAD_ITEM_VARIANTS,
      ),
    });
  }
  for (const profile of UNION_PROFILES) {
    const document = parseSchema(join(schemaDirectory, profile.file));
    const definition = record(
      record(document.definitions, `${profile.file} definitions`)[profile.definition],
      `${profile.file} ${profile.definition}`,
    );
    observed.push(
      ...observeUnionVariants(document, definition, profile.discriminator, profile.variants).map(
        (entry) => ({ file: profile.file, definition: profile.definition, entry }),
      ),
    );
  }
  return {
    schemaFingerprint: canonicalHash({
      profileVersion: COMPATIBILITY_PROFILE_VERSION,
      observed,
    }),
  };
}

export function canaryProfileFingerprint(): string {
  return canonicalHash(CODEX_COMPATIBILITY_PROFILE.canary);
}
