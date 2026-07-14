import { z } from "zod";

export const IdSchema = z.string().min(1);
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
export const TimestampSchema = z.string().min(1);
export const RepositoryRelativePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("/"), "path must be repository-relative")
  .refine((value) => !value.split("/").includes(".."), "path must not contain a parent traversal");

export const ModelConfigurationSchema = z
  .object({
    id: z.string().min(1),
    reasoningEffort: z.string().min(1),
  })
  .strict();

export const RepositorySnapshotSchema = z
  .object({
    repositoryPath: z.string().min(1),
    commitSha: z.string().regex(/^[a-f0-9]{40,64}$/u),
    branch: z.string().min(1).nullable(),
    submodules: z.record(z.string(), z.string()),
    dirtyPatchHash: Sha256Schema.nullable(),
    instructionHash: Sha256Schema,
    configHash: Sha256Schema,
    task: z.string().min(1),
    taskHash: Sha256Schema,
    model: ModelConfigurationSchema,
    codexVersion: z.string().min(1),
    promptTripwireVersion: z.string().min(1),
    createdAt: TimestampSchema,
    snapshotHash: Sha256Schema,
  })
  .strict();

export const RepositorySnapshotInputSchema = RepositorySnapshotSchema.omit({
  snapshotHash: true,
  taskHash: true,
});

export const RepositoryEvidenceSchema = z
  .object({
    id: IdSchema,
    path: RepositoryRelativePathSchema,
    startLine: z.number().int().positive().nullable(),
    endLine: z.number().int().positive().nullable(),
    description: z.string().min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.startLine !== null && value.endLine !== null && value.endLine < value.startLine) {
      context.addIssue({
        code: "custom",
        message: "endLine must be greater than or equal to startLine",
        path: ["endLine"],
      });
    }
  });

export const ReversibilitySchema = z.enum(["reversible", "difficult", "irreversible", "unknown"]);

export const PlanArtifactSchema = z
  .object({
    probeId: IdSchema,
    threadId: IdSchema,
    snapshotHash: Sha256Schema,
    taskHash: Sha256Schema,
    summary: z.string().min(1),
    assumptions: z.array(z.string()),
    intendedBehavior: z.array(z.string()),
    filesToRead: z.array(RepositoryRelativePathSchema),
    filesToChange: z.array(RepositoryRelativePathSchema),
    components: z.array(z.string()),
    dataChanges: z.array(z.string()),
    publicApiChanges: z.array(z.string()),
    dependencyChanges: z.array(z.string()),
    commands: z.array(z.string()),
    externalEffects: z.array(z.string()),
    permissionChanges: z.array(z.string()),
    compatibilityImpacts: z.array(z.string()),
    reversibility: ReversibilitySchema,
    verificationSteps: z.array(z.string()),
    unknowns: z.array(z.string()),
    repositoryEvidence: z.array(RepositoryEvidenceSchema),
  })
  .strict();

export const PlanArtifactContentSchema = PlanArtifactSchema.omit({
  probeId: true,
  threadId: true,
  snapshotHash: true,
  taskHash: true,
});

export const ComparisonSubjectSchema = z
  .object({
    id: IdSchema,
    summary: z.string().min(1),
    affectedBehaviors: z.array(z.string()),
    affectedFiles: z.array(RepositoryRelativePathSchema),
    affectedData: z.array(z.string()),
    affectedApis: z.array(z.string()),
    affectedCommands: z.array(z.string()),
    affectedExternalSystems: z.array(z.string()),
    evidenceRefs: z.array(IdSchema),
  })
  .strict();

export const ComparisonAlternativeSchema = z
  .object({
    id: IdSchema,
    label: z.string().min(1),
    description: z.string().min(1),
    effects: z.array(z.string()),
    supportedByProbeIds: z.array(IdSchema),
    evidenceRefs: z.array(IdSchema),
    reversibility: ReversibilitySchema,
  })
  .strict();

export const ComparisonDivergenceSchema = z
  .object({
    subject: ComparisonSubjectSchema,
    alternatives: z.array(ComparisonAlternativeSchema).min(2).max(3),
    suggestedQuestion: z.string().min(1),
    recommendation: z.string().min(1).nullable(),
  })
  .strict();

export const ComparisonCandidateSchema = z
  .object({
    comparisonId: IdSchema,
    snapshotHash: Sha256Schema,
    taskHash: Sha256Schema,
    planIds: z.array(IdSchema).min(2).max(3),
    consensus: z.array(ComparisonSubjectSchema),
    divergences: z.array(ComparisonDivergenceSchema),
    unknowns: z.array(ComparisonSubjectSchema),
  })
  .strict();

export const DecisionCategorySchema = z.enum([
  "destructive",
  "production",
  "permission",
  "secret",
  "authentication",
  "billing",
  "network",
  "public_api",
  "persistent_data",
  "dependency",
  "compatibility",
  "behavior",
  "scope",
  "verification",
  "rollback",
  "unknown",
]);

export const DecisionOptionSchema = z
  .object({
    id: IdSchema,
    label: z.string().min(1),
    description: z.string().min(1),
    effects: z.array(z.string()),
    supportedByProbeIds: z.array(IdSchema),
    evidenceRefs: z.array(IdSchema),
  })
  .strict();

export const DecisionPointSchema = z
  .object({
    decisionId: IdSchema,
    category: DecisionCategorySchema,
    question: z.string().min(1),
    reason: z.string().min(1),
    impact: z.enum(["low", "medium", "high"]),
    options: z.array(DecisionOptionSchema).min(2).max(3),
    freeformAllowed: z.boolean(),
    defaultOptionId: IdSchema.nullable(),
    deterministicTriggers: z.array(z.string()),
    evidenceRefs: z.array(IdSchema),
    status: z.enum(["unresolved", "resolved", "deferred"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.impact === "high" && value.defaultOptionId !== null) {
      context.addIssue({
        code: "custom",
        message: "high-impact decisions cannot have a default option",
        path: ["defaultOptionId"],
      });
    }
    if (
      value.defaultOptionId !== null &&
      !value.options.some((option) => option.id === value.defaultOptionId)
    ) {
      context.addIssue({
        code: "custom",
        message: "defaultOptionId must reference an option",
        path: ["defaultOptionId"],
      });
    }
  });

export const HumanDecisionSchema = z
  .object({
    decisionId: IdSchema,
    selectedOptionId: IdSchema.nullable(),
    freeformOverride: z.string().min(1).nullable(),
    rationale: z.string().nullable(),
    expectedRunVersion: z.number().int().nonnegative(),
    decidedAt: TimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const answerCount =
      Number(value.selectedOptionId !== null) + Number(value.freeformOverride !== null);
    if (answerCount !== 1) {
      context.addIssue({
        code: "custom",
        message: "exactly one selected option or freeform override is required",
      });
    }
  });

export const NetworkPolicySchema = z
  .object({
    mode: z.enum(["deny", "allowlist"]),
    hosts: z.array(z.string().min(1)),
    actions: z.array(z.enum(["read", "write"])),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mode === "deny" && (value.hosts.length > 0 || value.actions.length > 0)) {
      context.addIssue({
        code: "custom",
        message: "deny mode cannot include hosts or actions",
      });
    }
  });

export const NamedPolicySchema = z
  .object({
    mode: z.enum(["deny", "allowlist"]),
    allowed: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mode === "deny" && value.allowed.length > 0) {
      context.addIssue({
        code: "custom",
        message: "deny mode cannot include allowed entries",
        path: ["allowed"],
      });
    }
  });

export const ModelVersionsSchema = z
  .object({
    codex: z.string().min(1),
    comparator: z.string().min(1),
    policy: z.string().min(1),
  })
  .strict();

export const ExecutionContractSchema = z
  .object({
    contractId: IdSchema,
    version: z.number().int().positive(),
    runId: IdSchema,
    snapshotHash: Sha256Schema,
    taskHash: Sha256Schema,
    approvedGoal: z.string().min(1),
    approvedBehaviors: z.array(z.string()),
    approvedAssumptions: z.array(z.string()),
    allowedComponents: z.array(z.string()),
    allowedPaths: z.array(RepositoryRelativePathSchema),
    protectedPaths: z.array(RepositoryRelativePathSchema),
    allowedCommandClasses: z.array(z.string()),
    deniedCommandClasses: z.array(z.string()),
    networkPolicy: NetworkPolicySchema,
    dependencyPolicy: NamedPolicySchema,
    dataPolicy: NamedPolicySchema,
    externalEffectPolicy: NamedPolicySchema,
    requiredChecks: z.array(z.string()),
    stopConditions: z.array(z.string()),
    humanDecisions: z.array(HumanDecisionSchema),
    unresolvedNonBlockingUnknowns: z.array(z.string()),
    modelVersions: ModelVersionsSchema,
    createdAt: TimestampSchema,
    approvedAt: TimestampSchema.nullable(),
    contentHash: Sha256Schema,
  })
  .strict();

export const ExecutionContractDraftSchema = ExecutionContractSchema.omit({
  contractId: true,
  contentHash: true,
});

export const RunStateSchema = z.enum([
  "created",
  "snapshotting",
  "probing",
  "comparing",
  "needs_review",
  "ready_for_approval",
  "approved",
  "running",
  "pausing",
  "paused",
  "completed",
  "failed",
  "cancelled",
  "stale",
]);

export const ProbeStateSchema = z.enum([
  "pending",
  "starting",
  "running",
  "completed",
  "failed",
  "timed_out",
  "cancelled",
]);

export const ExecutionStateSchema = z.enum([
  "not_started",
  "starting",
  "running",
  "pausing",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);

export const DeviationStateSchema = z.enum([
  "observed",
  "pausing",
  "paused",
  "rejected",
  "amendment_required",
  "resolved",
]);

export const RunRecordSchema = z
  .object({
    runId: IdSchema,
    state: RunStateSchema,
    version: z.number().int().nonnegative(),
    snapshotHash: Sha256Schema.nullable(),
    taskHash: Sha256Schema,
    activeContractId: IdSchema.nullable(),
    blockingDecisionIds: z.array(IdSchema),
    lastErrorCode: z.string().min(1).nullable(),
    updatedAt: TimestampSchema,
  })
  .strict();

export const ProbeRecordSchema = z
  .object({
    probeId: IdSchema,
    runId: IdSchema,
    threadId: IdSchema.nullable(),
    state: ProbeStateSchema,
    attempt: z.number().int().positive(),
    lastErrorCode: z.string().min(1).nullable(),
  })
  .strict();

export const ExecutionRecordSchema = z
  .object({
    executionId: IdSchema,
    runId: IdSchema,
    threadId: IdSchema.nullable(),
    contractId: IdSchema,
    state: ExecutionStateSchema,
    worktreeId: IdSchema,
    lastErrorCode: z.string().min(1).nullable(),
  })
  .strict();

export const DeviationRecordSchema = z
  .object({
    deviationId: IdSchema,
    runId: IdSchema,
    executionId: IdSchema,
    state: DeviationStateSchema,
    category: z.string().min(1),
    contractClause: z.string().min(1),
    evidenceRefs: z.array(IdSchema),
    observedAt: TimestampSchema,
  })
  .strict();

export const AuditActionOutcomeSchema = z.enum([
  "prevented",
  "declined_before_execution",
  "detected_after_contained_write",
  "completed",
  "failed",
  "not_observed",
]);

export const AuditActionSchema = z
  .object({
    actionId: IdSchema,
    kind: z.enum(["command", "file_change", "network", "permission", "external_effect", "check"]),
    summary: z.string().min(1),
    outcome: AuditActionOutcomeSchema,
    evidenceRefs: z.array(IdSchema),
  })
  .strict();

export const CheckOutcomeSchema = z.enum(["passed", "failed", "not_run"]);

export const AuditCheckSchema = z
  .object({
    checkId: IdSchema,
    command: z.string().min(1),
    outcome: CheckOutcomeSchema,
    exitCode: z.number().int().nullable(),
    reason: z.string().min(1).nullable(),
    evidenceRefs: z.array(IdSchema),
  })
  .strict();

export const AuditDeviationSchema = z
  .object({
    deviationId: IdSchema,
    category: z.string().min(1),
    summary: z.string().min(1),
    resolution: z.string().min(1).nullable(),
    evidenceRefs: z.array(IdSchema),
  })
  .strict();

export const AuditDiffSummarySchema = z
  .object({
    changedPaths: z.array(RepositoryRelativePathSchema),
    withinContract: z.boolean().nullable(),
    evidenceRefs: z.array(IdSchema),
  })
  .strict();

export const RunReportSchema = z
  .object({
    reportVersion: z.literal(1),
    runId: IdSchema,
    state: RunStateSchema,
    snapshotHash: Sha256Schema.nullable(),
    taskHash: Sha256Schema,
    contractId: IdSchema.nullable(),
    contractHash: Sha256Schema.nullable(),
    threadIds: z.array(IdSchema),
    modelIds: z.array(z.string().min(1)),
    decisions: z.array(HumanDecisionSchema),
    observedActions: z.array(AuditActionSchema),
    diffSummary: AuditDiffSummarySchema,
    checks: z.array(AuditCheckSchema),
    deviations: z.array(AuditDeviationSchema),
    remainingUnknowns: z.array(z.string()),
    generatedAt: TimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.contractId === null) !== (value.contractHash === null)) {
      context.addIssue({
        code: "custom",
        message: "contractId and contractHash must both be present or both be null",
        path: ["contractHash"],
      });
    }
  });

export type ModelConfiguration = z.infer<typeof ModelConfigurationSchema>;
export type RepositorySnapshot = z.infer<typeof RepositorySnapshotSchema>;
export type RepositorySnapshotInput = z.infer<typeof RepositorySnapshotInputSchema>;
export type RepositoryEvidence = z.infer<typeof RepositoryEvidenceSchema>;
export type PlanArtifact = z.infer<typeof PlanArtifactSchema>;
export type PlanArtifactContent = z.infer<typeof PlanArtifactContentSchema>;
export type ComparisonCandidate = z.infer<typeof ComparisonCandidateSchema>;
export type DecisionPoint = z.infer<typeof DecisionPointSchema>;
export type HumanDecision = z.infer<typeof HumanDecisionSchema>;
export type ExecutionContract = z.infer<typeof ExecutionContractSchema>;
export type ExecutionContractDraft = z.infer<typeof ExecutionContractDraftSchema>;
export type RunState = z.infer<typeof RunStateSchema>;
export type ProbeState = z.infer<typeof ProbeStateSchema>;
export type ExecutionState = z.infer<typeof ExecutionStateSchema>;
export type DeviationState = z.infer<typeof DeviationStateSchema>;
export type RunRecord = z.infer<typeof RunRecordSchema>;
export type ProbeRecord = z.infer<typeof ProbeRecordSchema>;
export type ExecutionRecord = z.infer<typeof ExecutionRecordSchema>;
export type DeviationRecord = z.infer<typeof DeviationRecordSchema>;
export type AuditActionOutcome = z.infer<typeof AuditActionOutcomeSchema>;
export type AuditAction = z.infer<typeof AuditActionSchema>;
export type CheckOutcome = z.infer<typeof CheckOutcomeSchema>;
export type AuditCheck = z.infer<typeof AuditCheckSchema>;
export type AuditDeviation = z.infer<typeof AuditDeviationSchema>;
export type AuditDiffSummary = z.infer<typeof AuditDiffSummarySchema>;
export type RunReport = z.infer<typeof RunReportSchema>;
