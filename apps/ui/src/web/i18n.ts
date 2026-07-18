export type UiLocale = "en" | "ja";

const LOCALE_STORAGE_KEY = "prompt-tripwire.ui-locale";

export interface UiMessages {
  readonly documentTitle: string;
  readonly inboxTitle: string;
  readonly languageSelector: string;
  readonly loading: string;
  readonly loadingReview: string;
  readonly missingCapability: string;
  readonly reviewFailed: string;
  readonly refreshFailed: string;
  readonly eventStreamFailed: string;
  readonly recordedMutationDenied: string;
  readonly mutationFailed: string;
  readonly evidenceRequestFailed: string;
  readonly recordedTitle: string;
  readonly recordedDescription: string;
  readonly taskAndSnapshot: string;
  readonly repository: string;
  readonly notCaptured: string;
  readonly snapshot: string;
  readonly pending: string;
  readonly branch: string;
  readonly detached: string;
  readonly explicitChoices: string;
  readonly decisionsRequiringReview: string;
  readonly sourceTextNotice: string;
  readonly chooseDirection: string;
  readonly chooseOrEnter: string;
  readonly probeSupport: string;
  readonly none: string;
  readonly freeformDecision: string;
  readonly freeformPlaceholder: string;
  readonly recordDecision: string;
  readonly defer: string;
  readonly deferred: string;
  readonly evidenceAndTriggers: string;
  readonly repositoryEvidence: string;
  readonly noReferences: string;
  readonly deterministicTriggers: string;
  readonly consolidatedContract: string;
  readonly approveBoundedExecution: string;
  readonly allowedPaths: string;
  readonly requiredChecks: string;
  readonly stopConditions: string;
  readonly contractHash: string;
  readonly approveContract: string;
  readonly editDecisions: string;
  readonly planningEvidence: string;
  readonly openPlanArtifacts: string;
  readonly loadingEvidence: string;
  readonly loadPlanArtifacts: string;
  readonly probe: string;
  readonly observedDeviations: string;
  readonly resolutionRequired: string;
  readonly stopRun: string;
  readonly cancellationDescription: string;
  readonly cancelRun: string;
  readonly states: Readonly<Record<string, string>>;
  readonly impacts: Readonly<Record<string, string>>;
  readonly categories: Readonly<Record<string, string>>;
  readonly triggers: Readonly<Record<string, string>>;
  shownDecisions(shown: number, remaining: number): string;
  impactLabel(impact: string): string;
  requestFailed(kind: "review" | "event" | "evidence", status: number): string;
  mutationFailedWithCode(code: string): string;
}

const en: UiMessages = {
  documentTitle: "PromptTripwire Decision Inbox",
  inboxTitle: "Decision Inbox",
  languageSelector: "Display language",
  loading: "Loading",
  loadingReview: "Loading review",
  missingCapability: "This review link has no capability token.",
  reviewFailed: "Review failed",
  refreshFailed: "Refresh failed",
  eventStreamFailed: "Event stream failed",
  recordedMutationDenied: "Recorded replay is read-only. Run a live inspection to make decisions.",
  mutationFailed: "Mutation failed",
  evidenceRequestFailed: "Evidence request failed",
  recordedTitle: "Recorded replay · read-only",
  recordedDescription:
    "This sanitized example does not call Codex or execute code. Use the judge fixture for live verification.",
  taskAndSnapshot: "Task and snapshot",
  repository: "Repository",
  notCaptured: "Not captured",
  snapshot: "Snapshot",
  pending: "Pending",
  branch: "Branch",
  detached: "Detached",
  explicitChoices: "Explicit choices",
  decisionsRequiringReview: "Decisions requiring review",
  sourceTextNotice:
    "Task, decision, and evidence content is shown in its contract-bound source language.",
  chooseDirection: "Choose an explicit direction",
  chooseOrEnter: "Choose one option or enter a free-form decision.",
  probeSupport: "Probe support",
  none: "none",
  freeformDecision: "Free-form decision",
  freeformPlaceholder: "Describe the exact behavior you want",
  recordDecision: "Record decision",
  defer: "Defer",
  deferred: "Deferred",
  evidenceAndTriggers: "Evidence and policy triggers",
  repositoryEvidence: "Repository evidence",
  noReferences: "No references supplied",
  deterministicTriggers: "Deterministic triggers",
  consolidatedContract: "Consolidated contract",
  approveBoundedExecution: "Approve the bounded execution",
  allowedPaths: "Allowed paths",
  requiredChecks: "Required checks",
  stopConditions: "Stop conditions",
  contractHash: "Contract hash",
  approveContract: "Approve contract",
  editDecisions: "Edit decisions",
  planningEvidence: "Planning evidence",
  openPlanArtifacts: "Open full sanitized plan artifacts",
  loadingEvidence: "Loading evidence",
  loadPlanArtifacts: "Load plan artifacts",
  probe: "Probe",
  observedDeviations: "Observed deviations",
  resolutionRequired: "Resolution required",
  stopRun: "Stop this run",
  cancellationDescription: "Cancellation does not execute or modify the target repository.",
  cancelRun: "Cancel run",
  states: {
    created: "Created",
    snapshotting: "Capturing repository snapshot",
    probing: "Planning probes are running",
    comparing: "Comparing plans",
    needs_review: "Decisions require review",
    ready_for_approval: "Contract is ready for approval",
    approved: "Contract approved",
    running: "Execution is running",
    pausing: "Execution is pausing",
    paused: "Execution paused for review",
    completed: "Execution completed",
    failed: "Run failed",
    cancelled: "Run cancelled",
    stale: "Snapshot is stale",
  },
  impacts: { low: "low", medium: "medium", high: "high" },
  categories: {},
  triggers: {},
  shownDecisions: (shown, remaining) =>
    `${String(shown)} shown${remaining > 0 ? ` · ${String(remaining)} remaining after these` : ""}`,
  impactLabel: (impact) => `${impact} impact`,
  requestFailed: (kind, status) => {
    const label = kind === "review" ? "Review" : kind === "event" ? "Event stream" : "Evidence";
    return `${label} request failed (${String(status)})`;
  },
  mutationFailedWithCode: (code) => code,
};

const ja: UiMessages = {
  documentTitle: "PromptTripwire 意思決定インボックス",
  inboxTitle: "意思決定インボックス",
  languageSelector: "表示言語",
  loading: "読み込み中",
  loadingReview: "レビューを読み込み中",
  missingCapability: "このレビューリンクにはケイパビリティトークンがありません。",
  reviewFailed: "レビューの読み込みに失敗しました",
  refreshFailed: "レビューの更新に失敗しました",
  eventStreamFailed: "状態更新の受信に失敗しました",
  recordedMutationDenied:
    "記録済みリプレイは読み取り専用です。判断するにはライブ検査を実行してください。",
  mutationFailed: "操作に失敗しました",
  evidenceRequestFailed: "根拠の取得に失敗しました",
  recordedTitle: "記録済みリプレイ・読み取り専用",
  recordedDescription:
    "このサニタイズ済み例はCodexを呼び出さず、コードも実行しません。ライブ検証にはjudge fixtureを使用してください。",
  taskAndSnapshot: "タスクとスナップショット",
  repository: "リポジトリ",
  notCaptured: "未取得",
  snapshot: "スナップショット",
  pending: "未確定",
  branch: "ブランチ",
  detached: "デタッチ状態",
  explicitChoices: "明示的な選択",
  decisionsRequiringReview: "確認が必要な判断",
  sourceTextNotice:
    "タスク、判断内容、根拠は契約に結び付いた原文で表示します。PromptTripwireの定型文のみ表示言語に合わせます。",
  chooseDirection: "方針を明示してください",
  chooseOrEnter: "選択肢を1つ選ぶか、自由記述で判断を入力してください。",
  probeSupport: "支持するプローブ",
  none: "なし",
  freeformDecision: "自由記述の判断",
  freeformPlaceholder: "希望する正確な挙動を記述してください",
  recordDecision: "判断を記録",
  defer: "保留",
  deferred: "保留中",
  evidenceAndTriggers: "根拠とポリシートリガー",
  repositoryEvidence: "リポジトリの根拠",
  noReferences: "参照なし",
  deterministicTriggers: "決定論的トリガー",
  consolidatedContract: "統合された契約",
  approveBoundedExecution: "制約された実行を承認",
  allowedPaths: "許可されたパス",
  requiredChecks: "必須チェック",
  stopConditions: "停止条件",
  contractHash: "契約ハッシュ",
  approveContract: "契約を承認",
  editDecisions: "判断を編集",
  planningEvidence: "計画の根拠",
  openPlanArtifacts: "サニタイズ済み計画アーティファクトをすべて開く",
  loadingEvidence: "根拠を読み込み中",
  loadPlanArtifacts: "計画アーティファクトを読み込む",
  probe: "プローブ",
  observedDeviations: "検出された逸脱",
  resolutionRequired: "解決が必要です",
  stopRun: "この実行を停止",
  cancellationDescription: "キャンセルしても対象リポジトリの実行や変更は行いません。",
  cancelRun: "実行をキャンセル",
  states: {
    created: "作成済み",
    snapshotting: "リポジトリのスナップショットを取得中",
    probing: "計画プローブを実行中",
    comparing: "計画を比較中",
    needs_review: "判断が必要です",
    ready_for_approval: "契約を承認できます",
    approved: "契約を承認済み",
    running: "実装を実行中",
    pausing: "実行を一時停止しています",
    paused: "実行を一時停止し、確認待ちです",
    completed: "実行完了",
    failed: "実行失敗",
    cancelled: "実行をキャンセル済み",
    stale: "スナップショットが古くなっています",
  },
  impacts: { low: "低", medium: "中", high: "高" },
  categories: {
    destructive: "破壊的操作",
    production: "本番・外部操作",
    permission: "権限",
    secret: "機密情報",
    authentication: "認証・認可",
    billing: "課金・クォータ",
    network: "ネットワーク",
    public_api: "公開API",
    persistent_data: "永続データ",
    dependency: "依存関係",
    compatibility: "互換性",
    behavior: "挙動",
    scope: "作業範囲",
    verification: "検証",
    rollback: "ロールバック",
    unknown: "未分類",
  },
  triggers: {
    destructive_data: "破壊的データ操作",
    migration: "マイグレーション適用",
    production: "本番・共有環境",
    deploy_release_publish: "デプロイ・リリース・公開",
    remote_write: "リモート書き込み",
    authentication: "認証・認可",
    secret: "機密情報",
    permission: "権限変更",
    billing: "課金・クォータ",
    network: "ネットワークアクセス",
    persistent_data: "永続データ",
    dependency: "依存関係",
    breaking_api: "破壊的API変更",
    compatibility: "互換性",
    irreversible: "不可逆操作",
    scope_expansion: "範囲拡大",
    unknown: "未分類",
    degraded_probe_set: "縮退したプローブセット",
  },
  shownDecisions: (shown, remaining) =>
    `${String(shown)}件表示${remaining > 0 ? `・この後に残り${String(remaining)}件` : ""}`,
  impactLabel: (impact) => `影響：${ja.impacts[impact] ?? impact}`,
  requestFailed: (kind, status) => {
    const label = kind === "review" ? "レビュー" : kind === "event" ? "状態更新" : "根拠";
    return `${label}の取得に失敗しました（HTTP ${String(status)}）`;
  },
  mutationFailedWithCode: (code) => `操作に失敗しました（${code}）`,
};

export const uiMessages: Readonly<Record<UiLocale, UiMessages>> = { en, ja };

const japaneseProductText: Readonly<Record<string, string>> = {
  "Allow the destructive data operation described by the plan?":
    "計画に記載された破壊的なデータ操作を許可しますか？",
  "Allow applying the proposed migration?": "提案されたマイグレーションの適用を許可しますか？",
  "Allow a change to a production or shared environment?":
    "本番または共有環境への変更を許可しますか？",
  "Allow the deploy, release, publish, or repository publication action?":
    "デプロイ、リリース、公開、またはリポジトリ公開操作を許可しますか？",
  "Allow writing to the named remote service?":
    "指定されたリモートサービスへの書き込みを許可しますか？",
  "Allow the authentication, authorization, or identity change?":
    "認証、認可、または本人確認の変更を許可しますか？",
  "Allow access to or modification of secret material?":
    "機密情報へのアクセスまたは変更を許可しますか？",
  "Allow the proposed permission or privilege change?":
    "提案された権限または特権の変更を許可しますか？",
  "Allow the billable or quota-affecting operation?":
    "課金またはクォータに影響する操作を許可しますか？",
  "Allow the proposed network access?": "提案されたネットワークアクセスを許可しますか？",
  "Allow the proposed persistent data change?": "提案された永続データの変更を許可しますか？",
  "Allow adding or changing the dependency?": "依存関係の追加または変更を許可しますか？",
  "Allow the breaking public API or schema change?":
    "公開APIまたはスキーマの破壊的変更を許可しますか？",
  "Allow all disclosed compatibility impacts?": "開示された互換性への影響をすべて許可しますか？",
  "Allow an irreversible or difficult-to-reverse operation?":
    "不可逆または復旧困難な操作を許可しますか？",
  "Allow expanding work beyond the approved repository or writable roots?":
    "承認済みリポジトリまたは書き込み可能ルートを越える作業範囲の拡大を許可しますか？",
  "Resolve the unclassified action before execution?": "実行前に未分類の操作を解決しますか？",
  "Do not allow": "許可しない",
  "Keep this effect outside the execution contract.": "この影響を実行契約の対象外にします。",
  "Execution remains blocked for this effect.": "この影響に対する実行は引き続きブロックされます。",
  "Execution remains blocked for all disclosed effects.":
    "開示されたすべての影響に対する実行は引き続きブロックされます。",
  "Allow local implementation": "ローカル実装を許可",
  "Include every disclosed effect below in the execution contract. All other P0 runtime boundaries remain unchanged.":
    "以下に開示されたすべての影響を実行契約に含めます。その他のP0ランタイム境界は変更しません。",
  "Allow implementation only": "実装のみ許可",
  "Allow local code changes that prepare this disclosed effect. PromptTripwire will not perform the effect in P0; it remains denied and requires separate authorization.":
    "開示された影響を準備するローカルコード変更のみ許可します。PromptTripwireはP0で実操作を行わず、別途承認されるまで禁止を維持します。",
  "The runtime operation remains denied by the P0 execution boundary.":
    "実際のランタイム操作はP0実行境界によって引き続き禁止されます。",
  "The comparator could not establish one execution-safe interpretation.":
    "コンパレータは実行上安全な解釈を1つに確定できませんでした。",
  "Clarify scope": "範囲を明確にする",
  "Provide an explicit instruction before execution.": "実行前に明示的な指示を入力します。",
  "Cancel or narrow": "キャンセルまたは範囲を縮小",
  "Do not execute the ambiguous scope.": "曖昧な範囲は実行しません。",
  "No execution contract is approved for this unknown.":
    "この未確定事項について実行契約は承認されません。",
  "Continue after only two independent planning probes completed?":
    "独立した計画プローブが2件だけ完了した状態で続行しますか？",
  "One probe failed after its retry, so three-way agreement could not be established.":
    "1件のプローブが再試行後も失敗したため、3者の一致を確認できませんでした。",
  "Re-run inspection": "検査を再実行",
  "Do not approve this degraded comparison; obtain three fresh probes.":
    "この縮退した比較は承認せず、新しい3件のプローブを取得します。",
  "No execution contract is created from this review.":
    "このレビューから実行契約は作成されません。",
  "Review two-probe result": "2件のプローブ結果を確認",
  "Continue only after explicitly accepting reduced comparison coverage.":
    "比較範囲の縮小を明示的に受け入れた場合のみ続行します。",
  "The contract records that comparison coverage was degraded.":
    "比較範囲が縮退したことを契約に記録します。",
};

export function detectUiLocale(): UiLocale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "en" || stored === "ja") return stored;
  } catch {
    // Browser storage can be disabled; locale detection remains functional without it.
  }
  const preferred = window.navigator.languages[0] ?? window.navigator.language;
  return preferred.toLowerCase().startsWith("ja") ? "ja" : "en";
}

export function persistUiLocale(locale: UiLocale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // The selected locale still applies to the current page when storage is unavailable.
  }
}

export function displayLabel(labels: Readonly<Record<string, string>>, value: string): string {
  return labels[value] ?? value.replaceAll("_", " ");
}

export function displayProductText(value: string, locale: UiLocale): string {
  if (locale !== "ja") return value;
  const exact = japaneseProductText[value];
  if (exact !== undefined) return exact;
  const unknown = value.match(/^Resolve this unknown: (.+)$/u);
  if (unknown?.[1] !== undefined) return `この未確定事項を解決してください：${unknown[1]}`;
  const compatibility = value.match(
    /^(\d+) disclosed compatibility impacts require one explicit all-or-none choice\.$/u,
  );
  if (compatibility?.[1] !== undefined) {
    return `${compatibility[1]}件の互換性への影響について、すべて許可するかを明示的に選ぶ必要があります。`;
  }
  const policyDescriptions = value.match(
    /^(\d+) descriptions of this policy-relevant action require one explicit decision\.$/u,
  );
  if (policyDescriptions?.[1] !== undefined) {
    return `${policyDescriptions[1]}件のポリシー対象操作について、明示的な判断が必要です。`;
  }
  return value;
}
