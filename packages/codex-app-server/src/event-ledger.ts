import { canonicalJson, sha256 } from "@prompt-tripwire/domain";

import { AppServerError } from "./errors.js";
import {
  ItemNotificationParamsSchema,
  TurnDiffParamsSchema,
  TurnNotificationParamsSchema,
  parseThreadItem,
  type ParsedThreadItem,
} from "./protocol.js";
import type { NormalizedAppServerEvent } from "./types.js";

interface LedgerResult {
  readonly duplicate: boolean;
  readonly event: NormalizedAppServerEvent | null;
  readonly item: ParsedThreadItem | null;
  readonly diff: string | null;
}

function protocolError(message: string): never {
  throw new AppServerError("PROTOCOL_CORRUPTION", message);
}

export class ProtocolEventLedger {
  private readonly identities = new Set<string>();
  private readonly lifecycle = new Map<string, string>();
  private readonly startedTurns = new Set<string>();
  private readonly completedTurns = new Set<string>();
  private readonly startedItems = new Map<string, string>();
  private readonly completedItems = new Set<string>();

  accept(method: string, params: unknown): LedgerResult {
    const identity = canonicalJson({ method, params }, { omitKeys: new Set() });
    if (this.identities.has(identity)) {
      return { duplicate: true, event: null, item: null, diff: null };
    }

    let threadId: string | null = null;
    let turnId: string | null = null;
    let item: ParsedThreadItem | null = null;
    let status: string | null = null;
    let diff: string | null = null;

    if (method === "turn/started" || method === "turn/completed") {
      const parsed = TurnNotificationParamsSchema.parse(params);
      threadId = parsed.threadId;
      turnId = parsed.turn.id;
      status = parsed.turn.status;
      const turnKey = `${threadId}:${turnId}`;
      const lifecycleKey = `${method}:${turnKey}`;
      this.rejectConflictingLifecycle(lifecycleKey, identity);
      if (method === "turn/started") {
        if (this.completedTurns.has(turnKey)) protocolError("turn started after completion");
        this.startedTurns.add(turnKey);
      } else {
        if (!this.startedTurns.has(turnKey)) protocolError("turn completed before start");
        if (
          [...this.startedItems.entries()].some(
            ([itemKey]) => itemKey.startsWith(`${turnKey}:`) && !this.completedItems.has(itemKey),
          )
        ) {
          protocolError("turn completed with an in-progress item");
        }
        this.completedTurns.add(turnKey);
      }
    } else if (method === "item/started" || method === "item/completed") {
      const parsed = ItemNotificationParamsSchema.parse(params);
      threadId = parsed.threadId;
      turnId = parsed.turnId;
      item = parseThreadItem(parsed.item);
      status = "status" in item && typeof item.status === "string" ? item.status : null;
      const turnKey = `${threadId}:${turnId}`;
      const itemKey = `${turnKey}:${item.id}`;
      const lifecycleKey = `${method}:${itemKey}`;
      this.rejectConflictingLifecycle(lifecycleKey, identity);
      if (!this.startedTurns.has(turnKey) || this.completedTurns.has(turnKey)) {
        protocolError(
          `item ${method.endsWith("started") ? "started" : "completed"} outside active turn`,
        );
      }
      if (method === "item/started") {
        if (this.startedItems.has(itemKey) || this.completedItems.has(itemKey)) {
          protocolError("item started more than once");
        }
        this.startedItems.set(itemKey, item.type);
      } else {
        if (!this.startedItems.has(itemKey)) protocolError("item completed before start");
        if (this.startedItems.get(itemKey) !== item.type) {
          protocolError("item type changed before completion");
        }
        this.completedItems.add(itemKey);
      }
    } else if (method === "turn/diff/updated") {
      const parsed = TurnDiffParamsSchema.parse(params);
      threadId = parsed.threadId;
      turnId = parsed.turnId;
      diff = parsed.diff;
      const turnKey = `${threadId}:${turnId}`;
      if (!this.startedTurns.has(turnKey) || this.completedTurns.has(turnKey)) {
        protocolError("diff update arrived outside active turn");
      }
    } else {
      const record =
        params !== null && typeof params === "object" ? (params as Record<string, unknown>) : {};
      threadId = typeof record.threadId === "string" ? record.threadId : null;
      turnId = typeof record.turnId === "string" ? record.turnId : null;
    }

    this.identities.add(identity);
    const event: NormalizedAppServerEvent = {
      eventId: `app_event_${sha256(identity).slice(0, 24)}`,
      method,
      threadId,
      turnId,
      itemId: item?.id ?? null,
      itemType: item?.type ?? null,
      status,
    };
    return { duplicate: false, event, item, diff };
  }

  private rejectConflictingLifecycle(key: string, identity: string): void {
    const prior = this.lifecycle.get(key);
    if (prior !== undefined && prior !== identity) protocolError("conflicting lifecycle event");
    this.lifecycle.set(key, identity);
  }
}
