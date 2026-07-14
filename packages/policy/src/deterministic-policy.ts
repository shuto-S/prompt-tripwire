import { createHash } from "node:crypto";

import { isSecretLikePath } from "./path-policy.js";
import { redactText } from "./redaction.js";

export type DeterministicTrigger =
  | "destructive_data"
  | "migration"
  | "production"
  | "deploy_release_publish"
  | "remote_write"
  | "authentication"
  | "secret"
  | "permission"
  | "billing"
  | "network"
  | "persistent_data"
  | "dependency"
  | "breaking_api"
  | "compatibility"
  | "irreversible"
  | "scope_expansion"
  | "unknown";

export type PolicyDecisionCategory =
  | "destructive"
  | "production"
  | "permission"
  | "secret"
  | "authentication"
  | "billing"
  | "network"
  | "public_api"
  | "persistent_data"
  | "dependency"
  | "compatibility"
  | "scope"
  | "unknown";

export type DecisionOrderGroup =
  "critical_effects" | "privileged_external" | "data_compatibility" | "scope_behavior";

interface TriggerRule {
  readonly category: PolicyDecisionCategory;
  readonly impact: "medium" | "high";
  readonly orderGroup: DecisionOrderGroup;
  readonly question: string;
  readonly pattern: RegExp;
}

const TRIGGER_RULES: Readonly<Record<DeterministicTrigger, TriggerRule>> = {
  destructive_data: {
    category: "destructive",
    impact: "high",
    orderGroup: "critical_effects",
    question: "Allow the destructive data operation described by the plan?",
    pattern: /\b(?:delete|deletion|destroy|drop|truncate|erase|wipe|purge)\b|破壊|削除|消去/iu,
  },
  migration: {
    category: "destructive",
    impact: "high",
    orderGroup: "critical_effects",
    question: "Allow applying the proposed migration?",
    pattern:
      /\b(?:migration|migrate|alembic\s+upgrade|prisma\s+migrate|db:migrate)\b|マイグレーション/iu,
  },
  production: {
    category: "production",
    impact: "high",
    orderGroup: "critical_effects",
    question: "Allow a change to a production or shared environment?",
    pattern: /\b(?:prod(?:uction)?|shared[ -]environment)\b|本番|共有環境/iu,
  },
  deploy_release_publish: {
    category: "production",
    impact: "high",
    orderGroup: "critical_effects",
    question: "Allow the deploy, release, publish, or repository publication action?",
    pattern:
      /\b(?:deploy|release|publish|git\s+commit|gh\s+pr\s+create)\b|デプロイ|リリース|公開/iu,
  },
  remote_write: {
    category: "production",
    impact: "high",
    orderGroup: "critical_effects",
    question: "Allow writing to the named remote service?",
    pattern:
      /\b(?:remote[ -]write|git\s+push|gh\s+(?:api|issue|pr)\s+(?:comment|create|edit|close|merge|review)|github\s+(?:issue|pull request)\s+(?:comment|create|edit|close|merge|review)|curl\b[^\r\n]{0,500}(?:-X\s*(?:POST|PUT|PATCH|DELETE)|--data|--form|--json|--upload-file)|http\s+(?:post|put|patch|delete))\b|リモート書き込み/iu,
  },
  authentication: {
    category: "authentication",
    impact: "high",
    orderGroup: "privileged_external",
    question: "Allow the authentication, authorization, or identity change?",
    pattern: /\b(?:authentication|authorization|identity|oauth|login)\b|認証|認可|本人確認/iu,
  },
  secret: {
    category: "secret",
    impact: "high",
    orderGroup: "privileged_external",
    question: "Allow access to or modification of secret material?",
    pattern:
      /\b(?:secret|api[ _-]?key|access[ _-]?token|private[ _-]?key|password|credential)\b|秘密|機密|トークン/iu,
  },
  permission: {
    category: "permission",
    impact: "high",
    orderGroup: "privileged_external",
    question: "Allow the proposed permission or privilege change?",
    pattern: /\b(?:permission|privilege|chmod|chown|sudo|role)\b|権限|特権/iu,
  },
  billing: {
    category: "billing",
    impact: "high",
    orderGroup: "privileged_external",
    question: "Allow the billable or quota-affecting operation?",
    pattern: /\b(?:billing|payment|charge|paid|quota|cost)\b|課金|支払い|料金/iu,
  },
  network: {
    category: "network",
    impact: "high",
    orderGroup: "privileged_external",
    question: "Allow the proposed network access?",
    pattern: /\b(?:network|internet|http|https|curl|wget|webhook|socket)\b|ネットワーク|通信/iu,
  },
  persistent_data: {
    category: "persistent_data",
    impact: "medium",
    orderGroup: "data_compatibility",
    question: "Allow the proposed persistent data change?",
    pattern: /\b(?:persistent[ -]data|database|schema|record)\b|永続データ|データベース/iu,
  },
  dependency: {
    category: "dependency",
    impact: "medium",
    orderGroup: "data_compatibility",
    question: "Allow adding or changing the dependency?",
    pattern:
      /\b(?:dependency|dependencies|npm\s+(?:add|install)|pnpm\s+add|yarn\s+add|uv\s+add)\b|依存(?:関係|追加|更新)/iu,
  },
  breaking_api: {
    category: "public_api",
    impact: "high",
    orderGroup: "data_compatibility",
    question: "Allow the breaking public API or schema change?",
    pattern:
      /\b(?:breaking|backward[ -]incompatible|remove[sd]?\s+(?:public\s+)?api|public\s+api\s+break)\b|破壊的変更|後方互換性なし/iu,
  },
  compatibility: {
    category: "compatibility",
    impact: "medium",
    orderGroup: "data_compatibility",
    question: "Allow the stated compatibility impact?",
    pattern: /\bcompatibility\b|互換性/iu,
  },
  irreversible: {
    category: "destructive",
    impact: "high",
    orderGroup: "critical_effects",
    question: "Allow an irreversible or difficult-to-reverse operation?",
    pattern: /\b(?:irreversible|difficult[ -]to[ -]reverse)\b|不可逆|復旧困難/iu,
  },
  scope_expansion: {
    category: "scope",
    impact: "high",
    orderGroup: "scope_behavior",
    question: "Allow expanding work beyond the approved repository or writable roots?",
    pattern:
      /\b(?:scope[ -]expansion|outside\s+(?:the\s+)?repository|writable\s+root)\b|範囲拡大/iu,
  },
  unknown: {
    category: "unknown",
    impact: "high",
    orderGroup: "critical_effects",
    question: "Resolve the unclassified action before execution?",
    pattern: /\b(?:unknown|unclassified|uncertain|tbd|to be determined)\b|不明|未確認/iu,
  },
};

const ORDER_GROUPS: readonly DecisionOrderGroup[] = [
  "critical_effects",
  "privileged_external",
  "data_compatibility",
  "scope_behavior",
];

export interface PlanArtifactLike {
  readonly probeId: string;
  readonly summary: string;
  readonly assumptions: readonly string[];
  readonly intendedBehavior: readonly string[];
  readonly filesToChange: readonly string[];
  readonly components: readonly string[];
  readonly dataChanges: readonly string[];
  readonly publicApiChanges: readonly string[];
  readonly dependencyChanges: readonly string[];
  readonly commands: readonly string[];
  readonly externalEffects: readonly string[];
  readonly permissionChanges: readonly string[];
  readonly compatibilityImpacts: readonly string[];
  readonly reversibility: "reversible" | "difficult" | "irreversible" | "unknown";
  readonly unknowns: readonly string[];
}

export interface DeterministicPolicyInput {
  readonly plans: readonly PlanArtifactLike[];
  readonly modelConsensusSafe?: boolean;
  readonly knownSecrets?: readonly string[];
}

export interface PolicyBlocker {
  readonly blockerId: string;
  readonly trigger: DeterministicTrigger;
  readonly category: PolicyDecisionCategory;
  readonly impact: "medium" | "high";
  readonly orderGroup: DecisionOrderGroup;
  readonly question: string;
  readonly description: string;
  readonly affectedComponents: readonly string[];
  readonly evidenceRefs: readonly string[];
}

interface MutableBlocker {
  readonly trigger: DeterministicTrigger;
  readonly description: string;
  readonly affectedComponents: Set<string>;
  readonly evidenceRefs: Set<string>;
}

function blockerId(trigger: DeterministicTrigger, description: string): string {
  const digest = createHash("sha256").update(`${trigger}\0${description}`, "utf8").digest("hex");
  return `blocker_${digest.slice(0, 24)}`;
}

function positiveMatch(text: string, pattern: RegExp): boolean {
  const match = pattern.exec(text);
  if (match === null) return false;
  const prefix = text.slice(Math.max(0, match.index - 40), match.index).toLowerCase();
  return !/(?:\bno|\bnot|\bwithout|\bdeny|\bdenied|\bdisable|\bdisabled|\bprevent|\bavoid)\s+(?:\w+\s+){0,3}$/u.test(
    prefix,
  );
}

function matchingTriggers(text: string): DeterministicTrigger[] {
  return (Object.entries(TRIGGER_RULES) as [DeterministicTrigger, TriggerRule][])
    .filter(([, rule]) => positiveMatch(text, rule.pattern))
    .map(([trigger]) => trigger);
}

function isKnownSafePlannedCommand(command: string): boolean {
  return /^(?:npm\s+(?:test|run\s+(?:test|lint|typecheck|build|check)(?::[a-z0-9_-]+)?)|pnpm\s+(?:test|lint|typecheck|build)|pytest\b|ruff\b|tsc\b|make\s+(?:test|check|lint|build)\b|git\s+(?:status|diff|log|show|rev-parse)\b|rg\b|cat\b|sed\b)/iu.test(
    command.trim(),
  );
}

export function evaluateDeterministicPolicy(
  input: DeterministicPolicyInput,
): readonly PolicyBlocker[] {
  const blockers = new Map<string, MutableBlocker>();

  function add(
    trigger: DeterministicTrigger,
    value: string,
    plan: PlanArtifactLike,
    evidenceRef: string,
  ): void {
    const redacted =
      redactText(value, { knownSecrets: input.knownSecrets ?? [] }).text.trim() ||
      "[empty model value]";
    const key = `${trigger}\0${redacted}`;
    const existing = blockers.get(key);
    if (existing !== undefined) {
      for (const component of plan.components) existing.affectedComponents.add(component);
      existing.evidenceRefs.add(evidenceRef);
      return;
    }
    blockers.set(key, {
      trigger,
      description: redacted,
      affectedComponents: new Set(plan.components),
      evidenceRefs: new Set([evidenceRef]),
    });
  }

  function scan(
    value: string,
    plan: PlanArtifactLike,
    evidenceRef: string,
  ): DeterministicTrigger[] {
    const triggers = matchingTriggers(value);
    for (const trigger of triggers) add(trigger, value, plan, evidenceRef);
    return triggers;
  }

  if (input.plans.length === 0) {
    add(
      "unknown",
      "No validated plan artifacts were supplied.",
      {
        probeId: "policy",
        summary: "",
        assumptions: [],
        intendedBehavior: [],
        filesToChange: [],
        components: [],
        dataChanges: [],
        publicApiChanges: [],
        dependencyChanges: [],
        commands: [],
        externalEffects: [],
        permissionChanges: [],
        compatibilityImpacts: [],
        reversibility: "unknown",
        unknowns: [],
      },
      "policy:plans",
    );
  }

  for (const plan of input.plans) {
    scan(plan.summary, plan, `${plan.probeId}:summary`);
    plan.intendedBehavior.forEach((value, index) => {
      scan(value, plan, `${plan.probeId}:intendedBehavior:${String(index)}`);
    });
    plan.dataChanges.forEach((value, index) => {
      const evidenceRef = `${plan.probeId}:dataChanges:${String(index)}`;
      const triggers = scan(value, plan, evidenceRef);
      if (!triggers.includes("destructive_data") && !triggers.includes("migration")) {
        add("persistent_data", value, plan, evidenceRef);
      }
    });
    plan.permissionChanges.forEach((value, index) => {
      const evidenceRef = `${plan.probeId}:permissionChanges:${String(index)}`;
      const triggers = scan(value, plan, evidenceRef);
      if (
        !triggers.includes("authentication") &&
        !triggers.includes("secret") &&
        !triggers.includes("permission")
      ) {
        add("permission", value, plan, evidenceRef);
      }
    });
    plan.dependencyChanges.forEach((value, index) => {
      const evidenceRef = `${plan.probeId}:dependencyChanges:${String(index)}`;
      add("dependency", value, plan, evidenceRef);
    });
    plan.externalEffects.forEach((value, index) => {
      const evidenceRef = `${plan.probeId}:externalEffects:${String(index)}`;
      const triggers = scan(value, plan, evidenceRef);
      if (triggers.length === 0) add("unknown", value, plan, evidenceRef);
    });
    plan.publicApiChanges.forEach((value, index) => {
      scan(value, plan, `${plan.probeId}:publicApiChanges:${String(index)}`);
    });
    plan.compatibilityImpacts.forEach((value, index) => {
      const evidenceRef = `${plan.probeId}:compatibilityImpacts:${String(index)}`;
      add("compatibility", value, plan, evidenceRef);
    });
    plan.commands.forEach((value, index) => {
      const evidenceRef = `${plan.probeId}:commands:${String(index)}`;
      const triggers = scan(value, plan, evidenceRef);
      if (triggers.length === 0 && !isKnownSafePlannedCommand(value)) {
        add("unknown", value, plan, evidenceRef);
      }
    });
    plan.filesToChange.forEach((value, index) => {
      if (isSecretLikePath(value)) {
        add("secret", value, plan, `${plan.probeId}:filesToChange:${String(index)}`);
      }
    });
    plan.unknowns.forEach((value, index) => {
      add("unknown", value, plan, `${plan.probeId}:unknowns:${String(index)}`);
    });
    if (plan.reversibility === "difficult" || plan.reversibility === "irreversible") {
      add("irreversible", plan.reversibility, plan, `${plan.probeId}:reversibility`);
    } else if (plan.reversibility === "unknown") {
      add("unknown", plan.reversibility, plan, `${plan.probeId}:reversibility`);
    }
  }

  return [...blockers.values()]
    .map((blocker): PolicyBlocker => {
      const rule = TRIGGER_RULES[blocker.trigger];
      return {
        blockerId: blockerId(blocker.trigger, blocker.description),
        trigger: blocker.trigger,
        category: rule.category,
        impact: rule.impact,
        orderGroup: rule.orderGroup,
        question: rule.question,
        description: blocker.description,
        affectedComponents: [...blocker.affectedComponents].sort(),
        evidenceRefs: [...blocker.evidenceRefs].sort(),
      };
    })
    .sort(compareBlockers);
}

export interface DecisionRound {
  readonly blockers: readonly PolicyBlocker[];
  readonly remainingCount: number;
  readonly unresolvedCount: number;
  readonly executionAllowed: boolean;
}

function compareBlockers(left: PolicyBlocker, right: PolicyBlocker): number {
  const groupDifference =
    ORDER_GROUPS.indexOf(left.orderGroup) - ORDER_GROUPS.indexOf(right.orderGroup);
  if (groupDifference !== 0) return groupDifference;
  const componentDifference = right.affectedComponents.length - left.affectedComponents.length;
  if (componentDifference !== 0) return componentDifference;
  return left.blockerId.localeCompare(right.blockerId);
}

export function createDecisionRound(
  blockers: readonly PolicyBlocker[],
  resolvedBlockerIds: ReadonlySet<string> = new Set(),
): DecisionRound {
  const unresolved = blockers
    .filter((blocker) => !resolvedBlockerIds.has(blocker.blockerId))
    .sort(compareBlockers);
  return {
    blockers: unresolved.slice(0, 3),
    remainingCount: Math.max(0, unresolved.length - 3),
    unresolvedCount: unresolved.length,
    executionAllowed: unresolved.length === 0,
  };
}
