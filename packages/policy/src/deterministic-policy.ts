import { createHash } from "node:crypto";

import { classifyCommandAction, type CommandClass } from "./command-policy.js";
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
      /\b(?:add|install|update|upgrade|replace|remove|change)\s+(?:(?!(?:no|not|without)\b)[\w@./-]+\s+){0,3}(?:dependency|dependencies|packages?)\b|\b(?:npm\s+(?:add|install)|pnpm\s+add|yarn\s+add|uv\s+add)\b|依存(?:関係|パッケージ).{0,20}(?:追加|導入|更新|変更|削除)/iu,
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
    question: "Allow all disclosed compatibility impacts?",
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

const TASK_TRIGGER_PATTERNS: Readonly<Partial<Record<DeterministicTrigger, RegExp>>> = {
  destructive_data:
    /\b(?:delete|destroy|drop|truncate|erase|wipe|purge|remove|clear|empty|anonymize)\b.{0,80}?\b(?:all\s+|every\s+)?(?:data|records?|rows?|tables?|databases?|accounts?|files?|buckets?|resources?)\b|\b(?:delete\s+from|truncate\s+table|drop\s+(?:table|database))\b|(?:データ|レコード|全レコード|行|全行|テーブル|データベース|DB|アカウント|ファイル|バケット|リソース).{0,24}?(?:削除|消去|破棄|匿名化|消す|消して|空に(?:する|して))|(?:削除|消去|破棄|匿名化).{0,12}?(?:する|して|実行)/iu,
  migration:
    /\b(?:apply|run|execute)\b.{0,40}?\b(?:database\s+)?migrations?\b|\bmigrate\s+(?:the\s+)?(?:database|schema|data)\b|\b(?:alembic\s+upgrade|prisma\s+migrate|db:migrate)\b|マイグレーション.{0,16}?(?:適用|実行)|(?:データベース|スキーマ|データ).{0,16}?移行/iu,
  production:
    /\b(?:access|apply|change|modify|update|write|operate|run|start|stop|restart|promote|provision|roll\s+out|scale|backfill|deploy|release|publish|ship)\b.{0,60}?\b(?:prod(?:uction)?|shared[ -]environment)\b|(?:本番|共有環境|本番DB).{0,24}?(?:適用|反映|変更|更新|書き込み|操作|実行|デプロイ|リリース|公開|削除|消去|破棄|消す|消して|空に)/iu,
  deploy_release_publish:
    /\b(?:deploy|publish)\b|\b(?:create|cut|ship|publish)\b.{0,32}\brelease\b|\bship\s+v?\d[\w.-]*\b|\b(?:git\s+tag|tag\s+v?\d[\w.-]*|(?:create|make|cut|sign)\s+(?:the\s+)?(?:v?\d[\w.-]*\s+)?(?:git\s+)?tag)\b|(?:^|[.!?;]\s*|\b(?:(?:can|could|would|will)\s+you|please|to|must|should|need\s+to|then|next|now|actually)\s+)\brelease\s+(?:the\s+)?(?:package|build|artifact|version|software|project|it|this|that|v?\d[\w.-]*)\b|\bgh\s+release\s+(?:create|delete|edit|upload)\b|\b(?:kubectl\s+apply|helm\s+(?:install|upgrade)|terraform\s+apply)\b|\bupload\s+(?:(?:a|an|the)\s+)?(?:release\s+assets?|assets?\s+for\s+(?:the\s+)?release|videos?\s+to\s+youtube|to\s+youtube)\b|\b(?:delete|remove)\s+(?:(?:a|the)\s+)?(?:github\s+)?release\b|\bgit\s+commit\b|\bcommit\s+(?:(?:these|the|all|our|my)\s+)?(?:changes?|work|files?)\b|\bcommit\s+(?:it|this|that|them|everything)\b|\b(?:create|open|submit)\s+(?:a\s+)?pull\s+request\b|\b(?:create|open|submit)\s+(?:a\s+)?pr\b(?!\s+(?:template|description|body|copy|text)\b)|\bgh\s+pr\s+create\b|(?:デプロイ|リリース|公開|コミット|PR作成)(?:を)?(?:(?:作成|実行|反映)(?:する|して)?|する|して|します)|v?\d[\w.-]*のタグを(?:作成(?:する|して)?|作って|切って|付けて)|v?\d[\w.-]*を(?:リリース|公開)(?:する|して)|(?:GitHubの?)?リリース.{0,12}(?:削除|消去)|(?:リリースアセット|YouTube.{0,12}動画|動画.{0,12}YouTube|YouTube).{0,16}アップロード/iu,
  remote_write:
    /\b(?:remote[ -]write|git\s+(?:push|send-pack)|gh\s+(?:api|issue|pr)\s+(?:comment|create|edit|close|reopen|delete|merge|review|approve|lock|unlock|pin|unpin|transfer)|gh\s+repo\s+(?:create|delete|edit|rename|archive)|gh\s+release\s+(?:create|delete|edit|upload)|gh\s+gist\s+(?:create|delete|edit)|gh\s+(?:secret|variable)\s+(?:set|delete|remove)|github\s+(?:issue|pull request)\s+(?:comment|create|edit|close|reopen|delete|merge|review|approve)|aws\s+s3\s+(?:(?:cp|mv|sync)\s+(?!s3:\/\/)[^\r\n]{1,120}\s+s3:\/\/|(?:rm|mb|rb)\b)|kubectl\s+(?:apply|create|delete|patch|replace|set|scale|annotate|label)|kubectl\s+rollout\s+restart|helm\s+(?:install|upgrade|uninstall)|terraform\s+(?:apply|destroy|import)|curl\b[^\r\n]{0,500}?(?:-X\s*(?:POST|PUT|PATCH|DELETE)|--data|--form|--json|--upload-file)|http\s+(?:post|put|patch|delete))\b|\bgh\s+api\b[^\r\n]{0,300}?(?:-X\s*(?:POST|PUT|PATCH|DELETE)|--method\s+(?:POST|PUT|PATCH|DELETE)|--input|--field|-f\b)|\bpush\s+(?:(?:these|the|all|our|my)\s+)?(?:branch|changes?|commits?|tags?)\b|\bpush\b.{0,40}?\b(?:to\s+)?(?:origin|github|gitlab|remote)\b|\b(?:create|open|close|reopen|edit|update|delete|remove|merge|approve|review|post|comment\s+on)\s+(?:a\s+|an\s+|the\s+)?(?:github\s+)?(?:issue|pull\s+request|pr)\b(?!\s+(?:template|description|body|copy|text|parser|client|fixture)\b)|\b(?:delete|remove)\s+(?:(?:a|an|the)\s+)?(?:github\s+)?(?:repository|repo|release|collaborator)\b|\b(?:invite|add|remove)\b.{0,48}?\b(?:to|from)\s+(?:(?:the|a)\s+)?(?:github\s+)?(?:repository|repo|organization|org)\b|\b(?:change|update|edit|remove|disable|enable)\s+(?:the\s+)?(?:github\s+)?branch[ -]protection(?:\s+rules?)?\b|\b(?:create|update|edit|delete|remove|close|reopen|transition)\s+(?:(?:a|an|the)\s+)?(?:jira\s+(?:issue|ticket|project)|notion\s+(?:page|database|record|workspace)|google\s+(?:sheet|spreadsheet)|slack\s+(?:message|channel|post)|youtube\s+(?:video|playlist)|google\s+calendar\s+(?:event|meeting|appointment))\b|\b(?:create|update|edit|delete|remove)\s+(?:(?:a|an|the)\s+)?(?:page|database|record|workspace)\b.{0,24}?\b(?:in|on|to)\s+notion\b|\b(?:update|edit|delete|remove)\s+(?:(?:a|an|the)\s+)?(?:jira|notion)\b(?=\s*(?:[.!?]|$))|\b(?:send(?:ing)?|post(?:ing)?)\s+(?:(?:an|a|the)\s+)?(?:emails?|sms|text\s+messages?|messages?|notifications?|comments?|replies?|files?)\b(?:.{0,48}?\b(?:to|in|on)\s+(?:[a-z0-9._%+-]+@[a-z0-9.-]+|slack|teams|discord|google\s+chat|jira|notion))?|\bemail\s+[a-z0-9._%+-]+@[a-z0-9.-]+\b|\bsend\s+(?:slack|teams|discord|google\s+chat)\s+(?:(?:a|the)\s+)?(?:message|notification|file)\b|\b(?:post|message)\s+(?:to\s+)?(?:slack|teams|discord|google\s+chat)\b|\bupload\s+(?:(?:a|an|the)\s+)?(?:video|file|asset|release\s+asset|s3\s+object|object)?\s*\b(?:to|on)\s+(?:youtube|slack|github|s3)\b|\b(?:create|update|delete|cancel)\s+(?:(?:a|an|the)\s+)?(?:event|meeting|appointment)\b.{0,32}?\b(?:in|on)\s+google\s+calendar\b|(?:PR|プルリク(?:エスト)?)(?:\s*#?\d+)?(?:を|へ|に)?(?:マージ|承認|削除|更新|編集)(?:する|して|してください|します)|(?:GitHub\s*)?(?:Issue|イシュー|リポジトリ|repository|コラボレーター|collaborator|リリース)(?:\s*#?\d+)?(?:を|へ|に)?(?:閉じ(?:る|て|てください|ます)|クローズ(?:する|して|してください|します)|削除|更新|編集)|(?:ブランチ保護|branch protection).{0,16}(?:変更|更新|編集|削除|無効|有効)|(?:Slack|Teams|Discord|Google\s*Chat|Google\s*Calendar|Jira|Notion|YouTube|Google\s*(?:Sheet|スプレッドシート)|メール|SMS|S3)(?:へ|に|の|を).{0,24}?(?:送信|投稿|送って|更新|編集|削除|作成|アップロード)|(?:push|プッシュ)(?:する|して|してください|します)|リモート書き込み/iu,
  authentication:
    /\b(?:add|change|modify|replace|remove|rotate|implement|enable|disable|configure|turn\s+(?:on|off))\b.{0,48}?\b(?:authentication|authorization|identity|oauth|login)\b|\b(?:log|sign)\s+in\b(?:.{0,48}?\b(?:to|into)\b)?|\bauthenticate\b(?:.{0,48}?\b(?:to|with|against)\b)?|(?:認証|認可|本人確認|ログイン).{0,24}?(?:追加|変更|更新|削除|実装|実行|する|して)/iu,
  secret:
    /\b(?:access|read|write|set|rotate|regenerate|change|reset|revoke|store|expose|use|create|delete)\b.{0,48}?\b(?:secret|api[ _-]?key|access[ _-]?token|private[ _-]?key|password|credential)s?\b|\bgh\s+secret\s+(?:set|delete|remove)\b|\baws\s+secretsmanager\s+(?:create-secret|delete-secret|put-secret-value|update-secret)\b|\b(?:cat|read|open|inspect|show|print)\b.{0,32}?(?:\.env(?:\.[a-z0-9_.-]+)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials)\b|(?:^|[\s"'])(?:\.env(?:\.[a-z0-9_.-]+)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials)(?=\s|[.!?,;:]|$)|(?:秘密|機密|トークン|認証情報).{0,24}?(?:取得|参照|保存|設定|変更|更新|削除|利用)/iu,
  permission:
    /\b(?:add|change|modify|expand|grant|revoke|elevate|make|invite|remove)\b.{0,48}?\b(?:permission|privilege|role|admin(?:istrator)?(?:\s+access)?|owner(?:\s+access)?|(?:github\s+)?collaborator)s?\b|\b(?:invite|add|remove)\b.{0,48}?\b(?:to|from)\s+(?:(?:the|a)\s+)?(?:github\s+)?(?:repository|repo|organization|org)\b|\b(?:change|update|edit|remove|disable|enable)\s+(?:the\s+)?(?:github\s+)?branch[ -]protection(?:\s+rules?)?\b|\b(?:chmod|chown|sudo)\b|(?:権限|特権|ロール|コラボレーター|collaborator|ブランチ保護|branch protection|リポジトリメンバー).{0,24}?(?:追加|変更|拡大|付与|剥奪|昇格|招待|削除|更新|編集|無効|有効)|(?:管理者|オーナー)(?:権限)?(?:にする|にして|へ昇格)/iu,
  billing:
    /\b(?:create|change|charge|refund|bill|enable|disable|increase|consume|buy|purchase)\b.{0,48}?\b(?:billing|payment|quota|cost|customer|account|card|credits?|subscriptions?|plans?)\b|\b(?:buy|purchase)\s+(?:more\s+)?credits?\b|(?:課金|支払い|料金|クォータ|クレジット|有料プラン).{0,24}?(?:変更|実行|増加|消費|購入)/iu,
  network:
    /\b(?:git\s+(?:clone|fetch|pull|ls-remote|send-pack)|gh\s+(?!(?:--version|version|help|completion|config)\b)(?:api|auth|browse|codespace|gist|issue|pr|release|repo|run|search|secret|variable|workflow)|npm\s+ci|aws\s+(?!(?:--version|version|help|configure)\b)|gcloud\s+(?!(?:--version|version|help|config)\b)|az\s+(?!(?:--version|version|help|config)\b)|kubectl\s+(?!(?:--?version|help|completion|config)\b)|ssh|scp|sftp|docker\s+(?:pull|push|login|logout|search)|helm\s+(?:install|upgrade|uninstall|repo|pull|push)|terraform\s+(?:apply|destroy|import|plan|refresh))\b|\b(?:open|visit|navigate\s+to)\b.{0,48}?(?:https?:\/\/|the\s+(?:web|internet)|a\s+website)|\bbrowse\b.{0,32}?\b(?:the\s+)?(?:web|internet|website)\b|\bclone\b.{0,48}?\b(?:https?:\/\/|git@|github|gitlab|remote\s+(?:repository|repo)|repository|repo)\b|\b(?:fetch|pull)\b.{0,48}?\b(?:from\s+)?(?:origin|upstream|remote|github|gitlab)\b|\b(?:access|call|connect|fetch|send|post|upload|download|request|enable|use)\b.{0,48}?\b(?:network|internet|https?|webhook|socket|s3|cloud\s+storage|bucket|(?:external|remote|third[ -]party)\s+api|[a-z0-9_.-]+\s+api)\b|\b(?:curl|wget)\b|(?:ネットワーク|通信|外部API|ウェブ).{0,24}?(?:接続|アクセス|閲覧|送信|受信|有効|利用)|(?:git\s*)?(?:clone|fetch|pull|ls-remote|send-pack)(?:する|して|してください|します)|(?:GitHub|GitLab|origin|upstream|リモート|リポジトリ).{0,24}?(?:clone|fetch|pull|ls-remote|send-pack|クローン|取得)|(?:ssh|scp|sftp|aws|kubectl)(?:する|して|してください|します)/iu,
  persistent_data:
    /\b(?:add|create|insert|change|modify|update|remove|write)\b.{0,48}?\b(?:persistent[ -]data|database|schema|record)s?\b|\bbackfill\b.{0,48}?\bdata\b|(?:永続データ|データベース|スキーマ).{0,24}?(?:追加|変更|更新|削除|書き込み)/iu,
  dependency:
    /\b(?:add|install|update|upgrade|replace|remove|uninstall|change)\b(?:(?!\b(?:without|no|not)\b)[^\r\n]){0,48}?\b(?:dependency|dependencies|packages?)\b|\b(?:install|upgrade|uninstall)\s+(?!a\b|an\b|the\b)(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+\b|\b(?:add|update|replace|remove)\s+(?:(?:a|an|the|new|existing)\s+){0,2}(?!(?:tests?|testing|documentation|docs?|code|logic|validation|support|handling|behavio(?:u)?r|features?|functions?|methods?|classes?|fields?|properties|endpoints?|routes?|commands?|options?|flags?|checks?|cases?|files?|directories|folders?|ui|screens?|pages?|buttons?|messages?|errors?|logging|cache|caching|retry|retries|authentication|authorization|coverage|types?|github|gitlab|jira|notion|slack|teams|discord|youtube|s3|production|prod)\b)(?:@[a-z0-9_.-]+\/)?[a-z][a-z0-9_.-]*(?=\s*(?:(?:to\s+(?:the\s+)?(?:project|workspace|application|app))?\s*(?:[.!?]|$)|as\s+(?:a\s+)?dependency\b))|\b(?:npm\s+(?:add|install|ci)|pnpm\s+add|yarn\s+add|uv\s+add)\b|依存(?:関係|パッケージ).{0,20}?(?:追加|導入|更新|変更|削除)/iu,
  breaking_api:
    /\b(?:breaking|backward[ -]incompatible|remove[sd]?\s+(?:public\s+)?api|public\s+api\s+break)\b|\b(?:remove|delete|drop)\b.{0,48}?\b(?:(?:public\s+)?(?:api\s+)?endpoints?|public\s+apis?|public\s+(?:methods?|routes?))\b|破壊的変更|後方互換性なし|(?:公開API|パブリックAPI|エンドポイント).{0,24}?(?:削除|廃止)/iu,
  irreversible: TRIGGER_RULES.irreversible.pattern,
  scope_expansion:
    /\b(?:scope[ -]expansion|outside\s+(?:the\s+)?repository|writable\s+root)\b|\b(?:edit|change|modify|write|append|replace|delete|remove)\b.{0,32}?(?:\/etc\/hosts|\/(?:etc|usr|var|opt|system)\/)|範囲拡大|リポジトリ外|\/etc\/hosts/iu,
  unknown: /\b(?:tbd|todo|unknown|uncertain|unclassified|to be determined)\b|未定|不明|未確認/iu,
};

const TASK_TRIGGER_AUGMENT_PATTERNS: readonly (readonly [DeterministicTrigger, RegExp])[] = [
  [
    "remote_write",
    /\bsend\s+(?:(?:a|the)\s+)?(?:slack|teams|discord|google\s+chat)\s+(?:(?:a|the)\s+)?(?:message|notification|file)\b/iu,
  ],
  ["remote_write", /\b(?:write|put)\s+(?:(?:a|an|the)\s+)?(?:s3\s+)?object\s+to\s+s3\b/iu],
  ["network", /\b(?:write|put)\s+(?:(?:a|an|the)\s+)?(?:s3\s+)?object\s+to\s+s3\b/iu],
  [
    "remote_write",
    /\b(?:archiv(?:e|ing)|renam(?:e|ing))\b.{0,48}?\b(?:github\s+)?(?:repository|repo)\b|\b(?:make|set)\b.{0,48}?\b(?:github\s+)?(?:repository|repo)\b.{0,32}?\bread[ -]only\b|\b(?:change|set)\b.{0,48}?\b(?:github\s+)?(?:repository|repo)(?:'s)?\s+(?:display\s+)?name\b|\b(?:github\s+)?(?:repository|repo)\b.{0,24}?\b(?:should|must|needs?\s+to|will)\s+be\s+(?:archived|renamed)\b|\b(?:lock|transfer|mov(?:e|ing))\b.{0,48}?\b(?:github\s+)?issues?\b|\b(?:sync|mirror(?:ing)?)\b.{0,48}?\b(?:build\s+)?artifacts?\b.{0,24}?\b(?:to|into|with)\s+s3\b|\bcreate\s+(?:(?:a|an|the)\s+)?notification\b.{0,24}?\bin\s+slack\b|\bnotif(?:y|ied|ying)\b.{0,48}?\bslack\b|\bslack\b.{0,32}?\bnotif(?:y|ied|ying)\b|(?:GitHub)?リポジトリ.{0,24}?(?:アーカイブ|読み取り専用|名前.{0,8}変更)|(?:GitHub\s*)?(?:Issue|イシュー).{0,32}?(?:別.{0,16}リポジトリ.{0,8})?移動|(?:ビルド)?成果物.{0,20}S3.{0,12}(?:同期|sync|ミラー)|Slack.{0,24}(?:通知|知らせ)/iu,
  ],
  [
    "network",
    /\b(?:sync|mirror(?:ing)?)\b.{0,48}?\b(?:build\s+)?artifacts?\b.{0,24}?\b(?:to|into|with)\s+s3\b|\b(?:download|fetch|retrieve|get)\b.{0,64}?\b(?:github\s+releases?(?:\s+artifacts?)?|releases?(?:\s+artifacts?)?\b.{0,24}\bfrom\s+github)\b|(?:ビルド)?成果物.{0,20}S3.{0,12}(?:同期|sync|ミラー)/iu,
  ],
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
  readonly task: string;
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
  readonly details: readonly string[];
  readonly affectedComponents: readonly string[];
  readonly evidenceRefs: readonly string[];
}

interface MutableBlocker {
  readonly trigger: DeterministicTrigger;
  readonly descriptions: Set<string>;
  readonly affectedComponents: Set<string>;
  readonly evidenceRefs: Set<string>;
}

function blockerId(trigger: DeterministicTrigger, descriptions: readonly string[]): string {
  const digest = createHash("sha256")
    .update(`${trigger}\0${descriptions.join("\0")}`, "utf8")
    .digest("hex");
  return `blocker_${digest.slice(0, 24)}`;
}

function exactActionIdentity(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[.!?。]+$/gu, "")
    .replace(/\s+/gu, " ");
}

function positiveMatch(text: string, pattern: RegExp): boolean {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matcher = new RegExp(pattern.source, flags);
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(text)) !== null) {
    const index = match.index;
    const prefix = text.slice(Math.max(0, index - 512), index).toLowerCase();
    const matchedText = match[0].toLowerCase();
    const clauseBoundary =
      /(?:[.!?;]|,\s*(?=(?:and\s+)?(?:then|afterwards?|after\s+that|subsequently|next|finally|instead)\b)|\band\s+(?:actually|instead)\b|\b(?:but|however|except)\b)/u;
    const negationPrefix = prefix.split(clauseBoundary).at(-1) ?? prefix;
    const suffix = text.slice(index + match[0].length, index + match[0].length + 96).toLowerCase();
    const negatedBefore =
      /(?:\bno|\bnot|\bnever|\bwithout|\bdeny|\bdenied|\bdisable|\bdisabled|\bprevent|\bavoid|\bdo\s+not|\bdon['’]t|\bdoesn['’]t|\bmustn['’]t)\s+(?:(?:[\w-]+(?:,\s*|\s+))|(?:(?:and|or)\s+)){0,32}$/u.test(
        negationPrefix,
      );
    const negatedAfter =
      /^(?:[- ]free\b|\s*(?:(?:is|are|remains?)\s+)?(?:unchanged|preserved|disabled|denied|not required|not used)\b|\s+(?:(?:unit|integration|e2e|regression)\s+)?(?:tests?|test coverage|documentation|docs?)\b|.{0,16}(?:しない|せず|不要|禁止|行わない))/u.test(
        suffix,
      );
    const subjectClausePrefix = prefix.split(clauseBoundary).at(-1) ?? prefix;
    const howToSubject =
      /\b(?:document(?:ation|ing)?|docs?|tests?|testing|test coverage)\b[^\r\n]{0,512}\bhow\s+to\b/u.test(
        subjectClausePrefix,
      );
    const safeMetaSuffix =
      /^\s+(?:behavio(?:u)?rs?|workflows?|tests?|test\s+cases?|edge\s+cases?|failures?|semantics?|apis?|contracts?|states?|flows?|interactions?|outputs?|coverage|documentation|docs?|guides?|instructions?|examples?(?!\.[a-z])|support|handling|logic|paths?|scenarios?|commands?|steps?|buttons?|controls?|labels?|menu\s+items?|badges?|models?|components?|renderers?|release\s+notes(?:\s+pages?)?|notes(?:\s+pages?)?)\b/u.test(
        suffix,
      );
    const explicitActionMatch =
      /^(?:delete|destroy|drop|truncate|erase|wipe|purge|apply|run|execute|migrate|change|modify|update|write|operate|start|stop|restart|promote|provision|roll|scale|backfill|deploy|publish|release|commit|create|insert|open|submit|approve|push|implement|configure|turn|access|read|rotate|regenerate|reset|store|expose|use|make|grant|revoke|elevate|charge|refund|bill|increase|consume|call|connect|fetch|send|post|upload|download|request|enable|disable|remove|install|upgrade|replace|uninstall|add)\b/u.test(
        matchedText.trimStart(),
      );
    const connector = subjectClausePrefix.match(
      /\b(and\s+then|and|then|afterwards?|after\s+that|subsequently|next|finally)\b[\s,]*((?:[a-z][a-z-]*[\s,]+){0,12})$/u,
    );
    const connectorKind = connector?.[1] ?? null;
    const connectorAdverbs = connector?.[2]?.trim() ?? "";
    const matchedAction = matchedText.trimStart().match(/^[a-z]+\b/u)?.[0] ?? "";
    const hasActionObject = matchedText.trimStart().slice(matchedAction.length).trim().length > 0;
    const hasConcreteSuffix = /^\s+(?:(?:a|an|the|this|that|these|those|our|my|your)\s+)\S/u.test(
      suffix,
    );
    const explicitExecutionAdverb =
      /\b(?:actually|immediately|later|now|separately|instead|explicitly|directly|manually)\b/u.test(
        connectorAdverbs,
      );
    const independentSubjectClause =
      explicitActionMatch &&
      connectorKind !== null &&
      !safeMetaSuffix &&
      (connectorKind !== "and" && connectorKind !== "and then"
        ? true
        : howToSubject
          ? connectorKind === "and then" || explicitExecutionAdverb
          : connectorKind === "and then" ||
            connectorAdverbs.length > 0 ||
            hasActionObject ||
            hasConcreteSuffix);
    const explicitIndependentPositiveClause =
      /\b(?:and(?:\s+then)?|then)\s+(?:(?:you|we)\s+(?:should|must|need\s+to|will)|please)\s+(?:(?:actually|also|immediately|now|next|still)\s+)*$/u.test(
        subjectClausePrefix,
      );
    const lastCommaIndex = subjectClausePrefix.lastIndexOf(",");
    const beforeLastComma =
      lastCommaIndex < 0 ? "" : subjectClausePrefix.slice(0, lastCommaIndex).toLowerCase();
    const afterLastComma =
      lastCommaIndex < 0 ? "" : subjectClausePrefix.slice(lastCommaIndex + 1).toLowerCase();
    const negationBeforeComma =
      /(?:\bno|\bnot|\bnever|\bwithout|\bdo\s+not|\bdon['’]t)\b[^.!?;]{0,256}$/u.test(
        beforeLastComma,
      );
    const commaContinuesNegatedList =
      /^\s*(?:and|or)\s*$/u.test(afterLastComma) || /^\s*,\s*(?:and|or)\b/u.test(suffix);
    const independentCommaClause =
      explicitActionMatch &&
      lastCommaIndex >= 0 &&
      negationBeforeComma &&
      !commaContinuesNegatedList;
    const subjectPrefix =
      independentSubjectClause || independentCommaClause ? "" : subjectClausePrefix;
    const japaneseTestOrDocumentationSuffix =
      /^\s*(?:(?:[a-z0-9_-]+\s*){0,4})?(?:する|した|の)?(?:手順|方法|テスト|試験|検証|挙動|仕様|説明|ドキュメント|文書|レスポンス|応答|リクエスト|ペイロード|結果|出力|クライアント(?:の)?(?:テスト|モック|フィクスチャ))(?:[^。.!?]{0,64})(?:README|ドキュメント|文書|文書化|記載|説明|追加|更新|修正|テスト|試験|検証|モック|スタブ|シミュレート)/u.test(
        suffix,
      ) ||
      /^\s*(?:(?:[a-z0-9_-]+\s*){0,4})?(?:する|した|の)?(?:パーサー|構文解析|字句解析|モック|フィクスチャ)(?:[^。.!?]{0,64})(?:追加|更新|修正|実装|テスト|試験|検証)/u.test(
        suffix,
      );
    const japaneseMetaInsideMatch =
      /(?:手順|方法|テスト|試験|検証|挙動|仕様|説明|ドキュメント|文書|パーサー|構文解析|字句解析|モック|フィクスチャ|レスポンス|応答|リクエスト|ペイロード|結果|出力|クライアント(?:の)?(?:テスト|モック|フィクスチャ))[^。.!?]{0,64}(?:README|ドキュメント|文書|文書化|記載|説明|追加|更新|修正|実装|テスト|試験|検証|モック|スタブ|シミュレート)/u.test(
        matchedText,
      );
    const uiOrModelMetaInsideMatch =
      /\b(?:publish|deploy|install|release|production|account)\b[^\r\n.!?]{0,48}\b(?:buttons?|controls?|labels?|menu\s+items?|badges?|models?|release\s+notes(?:\s+pages?)?|notes\s+pages?)\b/u.test(
        matchedText,
      );
    const documentationFileReference =
      /(?:^|[\s"'`])(?:\.?[a-z0-9_-]+\/)+$/u.test(subjectClausePrefix) &&
      /^[a-z0-9_.-]*\.(?:md|mdx|txt|rst|json|ya?ml|toml|ts|tsx|js|mjs|cjs|py|sh)\b/u.test(suffix);
    const commandExampleContext =
      /\b(?:add|write|document|describe|show|include|create|update)\b[^\r\n.!?;]{0,256}$/u.test(
        subjectClausePrefix,
      ) &&
      /^\s+(?:-[a-z0-9-]+\s+){0,3}(?:example|sample|snippet|usage|documentation|docs?)\b/u.test(
        suffix,
      );
    const parserOrFixtureSubject =
      /\b(?:parser|parsing|lexer|tokenizer|grammar|syntax|mock|fixture|simulator)\s+(?:for|of|around|about|covering)\b[^\r\n]{0,512}$/u.test(
        subjectPrefix,
      ) ||
      /\b(?:mock|fake|fixture|test)\s+(?:[a-z-]+\s+){0,2}client\s+(?:for|of|around|about|covering)\b[^\r\n]{0,512}$/u.test(
        subjectPrefix,
      );
    const operationUsedAsMetaLabel =
      /^\s+(?:(?:[a-z0-9_-]+\s+){0,4})?(?:parser|parsing|lexer|tokenizer|grammar|syntax|mock|fixture|simulator|responses?|requests?|events?|payloads?|results?|outputs?|client\s+(?:tests?|parser|mock|fixture)|commands?\s+(?:syntax|parser|tests?))(?=\s*(?:[.!?]|$))/u.test(
        suffix,
      ) &&
      (explicitActionMatch ||
        /\b(?:add|build|change|create|delete|implement|remove|update|fix|refactor|run|test|verify|document|mock|simulate|stub)\b[^\r\n]{0,256}$/u.test(
          subjectClausePrefix,
        ));
    const clientImplementationMeta =
      /^\s+(?:client|adapter)\b/u.test(suffix) &&
      (explicitActionMatch ||
        /\b(?:add|build|create|implement|update|fix|refactor|test|verify)\b[^\r\n]{0,256}$/u.test(
          subjectClausePrefix,
        ));
    const clientUnderTest =
      /^\s+client\b/u.test(suffix) &&
      /\b(?:test|verify)\s+(?:(?:a|an|the)\s+)?$/u.test(subjectClausePrefix);
    const mockedOperation =
      /^\s+(?:responses?|requests?|events?|payloads?|results?|outputs?)\b/u.test(suffix) &&
      /\b(?:mock|simulate|stub)\s+(?:the\s+)?$/u.test(subjectClausePrefix);
    const directDocumentationSubject =
      /\b(?:document|describe|explain)\b[^\r\n.!?;]{0,512}$/u.test(subjectClausePrefix) &&
      !independentSubjectClause &&
      !/\b(?:and\s+(?:then\s+)?(?:run|execute|actually|please)|then|but|however|instead)\b[^\r\n.!?;]{0,128}$/u.test(
        subjectClausePrefix,
      );
    const testOrDocumentationSubject =
      /\b(?:tests?|testing|test coverage|documentation|docs?|document(?:ing)?)\s+(?:for|of|around|about|covering|how\s+to)\b/u.test(
        matchedText,
      ) ||
      /\b(?:tests?|testing|test coverage)\s+(?:for|of|around|about|covering)\b[^\r\n]{0,512}$/u.test(
        subjectPrefix,
      ) ||
      /\b(?:documentation|docs?)\s+(?:(?:for|of|around|about|covering|on)\b|(?:explaining|describing)(?:\s+how\s+to)?\b)[^\r\n]{0,512}$/u.test(
        subjectPrefix,
      ) ||
      /\bdocument(?:ing)?\s+(?:how\s+to|(?:the\s+)?(?:steps?|process|workflow)\s+(?:for|to))\b[^\r\n]{0,512}$/u.test(
        subjectPrefix,
      ) ||
      safeMetaSuffix ||
      japaneseTestOrDocumentationSuffix ||
      japaneseMetaInsideMatch ||
      uiOrModelMetaInsideMatch ||
      documentationFileReference ||
      commandExampleContext ||
      parserOrFixtureSubject ||
      operationUsedAsMetaLabel ||
      clientImplementationMeta ||
      clientUnderTest ||
      mockedOperation ||
      directDocumentationSubject;
    if (
      (!negatedBefore || explicitIndependentPositiveClause || independentCommaClause) &&
      !negatedAfter &&
      !testOrDocumentationSubject
    ) {
      return true;
    }
    // A suppressed documentation or negated clause may have consumed a later,
    // independently actionable match. Resume inside the match so that operation
    // cannot disappear merely because it shares a sentence with safe wording.
    matcher.lastIndex = index + 1;
  }
  return false;
}

function matchingTriggers(text: string): DeterministicTrigger[] {
  const triggers = new Set(
    (Object.entries(TRIGGER_RULES) as [DeterministicTrigger, TriggerRule][])
      .filter(([, rule]) => positiveMatch(text, rule.pattern))
      .map(([trigger]) => trigger),
  );
  for (const trigger of matchingTaskTriggers(text)) triggers.add(trigger);
  return [...triggers];
}

function matchingTaskTriggers(text: string): DeterministicTrigger[] {
  const triggers = new Set(
    (Object.entries(TASK_TRIGGER_PATTERNS) as [DeterministicTrigger, RegExp][])
      .filter(([, pattern]) => positiveMatch(text, pattern))
      .map(([trigger]) => trigger),
  );
  for (const [trigger, pattern] of TASK_TRIGGER_AUGMENT_PATTERNS) {
    if (positiveMatch(text, pattern)) triggers.add(trigger);
  }
  return [...triggers];
}

function tokenizePlannedCommand(command: string): readonly string[] | null {
  const tokens: string[] = [];
  let token = "";
  let tokenStarted = false;
  let quote: "single" | "double" | null = null;

  function finishToken(): void {
    if (!tokenStarted) return;
    tokens.push(token);
    token = "";
    tokenStarted = false;
  }

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index] ?? "";
    if (character === "\0" || character === "\r" || character === "\n") return null;
    if (quote === "single") {
      if (character === "'") quote = null;
      else token += character;
      continue;
    }
    if (quote === "double") {
      if (character === '"') {
        quote = null;
        continue;
      }
      const next = command[index + 1] ?? "";
      const dollarExpansion =
        character === "$" &&
        (/[A-Za-z0-9_@*#?$!\-]/u.test(next) || next === "{" || next === "(" || next === "[");
      if (dollarExpansion || character === "`") return null;
      if (character === "\\") {
        const escapedCharacter = command[index + 1];
        if (
          escapedCharacter === undefined ||
          escapedCharacter === "\r" ||
          escapedCharacter === "\n"
        ) {
          return null;
        }
        if (new Set(['"', "$", "`", "\\"]).has(escapedCharacter)) {
          token += escapedCharacter;
          index += 1;
          continue;
        }
      }
      token += character;
      continue;
    }
    if (/\s/u.test(character)) {
      finishToken();
      continue;
    }
    if (character === "'") {
      quote = "single";
      tokenStarted = true;
      continue;
    }
    if (character === '"') {
      quote = "double";
      tokenStarted = true;
      continue;
    }
    if (character === "\\") {
      const next = command[index + 1];
      if (next === undefined || next === "\r" || next === "\n") return null;
      token += next;
      tokenStarted = true;
      index += 1;
      continue;
    }
    if (/[|&;<>()[\]{}$`*?~^!#]/u.test(character)) return null;
    if (character === "=" && !tokenStarted) return null;
    token += character;
    tokenStarted = true;
  }
  if (quote !== null) return null;
  finishToken();
  return tokens.length === 0 ? null : tokens;
}

function commandClassTriggers(commandClass: CommandClass): DeterministicTrigger[] {
  switch (commandClass) {
    case "static_read":
    case "git_read":
    case "test":
    case "lint":
    case "typecheck":
    case "build":
    case "verification":
      return [];
    case "git_write":
      return ["deploy_release_publish"];
    case "dependency":
      return ["dependency", "network"];
    case "network":
      return ["network"];
    case "remote_write":
      return ["remote_write", "network"];
    case "destructive":
      return ["destructive_data"];
    case "permission":
      return ["permission"];
    case "secret_access":
      return ["secret"];
    case "migration":
      return ["migration"];
    case "deploy":
      return ["deploy_release_publish", "network"];
    case "release":
      return ["deploy_release_publish", "network"];
    case "file_write":
    case "interpreter":
      return ["unknown"];
  }
}

function isKnownVerificationCommand(program: string, args: readonly string[]): boolean {
  const command = args[0]?.toLowerCase() ?? "";
  if (program === "npm" && command === "run") {
    return /^(?:test|lint|typecheck|build|check|verify)(?::[a-z0-9_-]+)*$/u.test(
      args[1]?.toLowerCase() ?? "",
    );
  }
  if (program === "pnpm") {
    return /^(?:test|lint|typecheck|build|check|verify)(?::[a-z0-9_-]+)*$/u.test(command);
  }
  return false;
}

function isOutputWritingOption(value: string): boolean {
  return /^(?:-o|--output|--output-file|--outputfile|--out-dir|--outdir)(?:=|$)/iu.test(value);
}

const PATH_VALUE_OPTIONS = new Set([
  "--basetemp",
  "--config",
  "--out-dir",
  "--outdir",
  "--output",
  "--output-file",
  "--outputfile",
  "--project",
  "--temporary-directory",
  "-o",
]);

function optionName(value: string): string {
  return (value.includes("=") ? value.slice(0, value.indexOf("=")) : value).toLowerCase();
}

function pathOptionOperands(args: readonly string[]): readonly string[] {
  const operands: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index] ?? "";
    if (!PATH_VALUE_OPTIONS.has(optionName(value))) continue;
    const separator = value.indexOf("=");
    if (separator >= 0) operands.push(value.slice(separator + 1));
    else if (args[index + 1] !== undefined) {
      operands.push(args[index + 1] ?? "");
      index += 1;
    }
  }
  return operands;
}

function hasAmbiguousPathOption(args: readonly string[]): boolean {
  return args.some((value, index) => {
    if (!PATH_VALUE_OPTIONS.has(optionName(value)) || value.includes("=")) return false;
    const next = args[index + 1];
    return next === undefined || next === "--" || next.startsWith("-");
  });
}

function hasParentOrAbsolutePath(value: string): boolean {
  const candidate = value.includes(":") ? (value.split(":").at(-1) ?? value) : value;
  return (
    candidate.startsWith("/") ||
    candidate.startsWith("~/") ||
    /^[a-z]:[\\/]/iu.test(candidate) ||
    candidate.split("/").includes("..")
  );
}

function isProtectedCommandPath(value: string): boolean {
  const candidate = value.includes(":") ? (value.split(":").at(-1) ?? value) : value;
  const relative = candidate.replace(/^\.\//u, "");
  return (
    isSecretLikePath(relative) ||
    /(?:^|\/)\.git\/(?:config|credentials?)(?:$|\/)/u.test(relative) ||
    /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials)$/u.test(relative)
  );
}

function positionalArguments(
  args: readonly string[],
  optionsWithValue: ReadonlySet<string> = new Set(),
  startIndex = 0,
): readonly string[] {
  const result: string[] = [];
  let optionsEnded = false;
  for (let index = startIndex; index < args.length; index += 1) {
    const value = args[index] ?? "";
    if (!optionsEnded && value === "--") {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && value.startsWith("-")) {
      const option = optionName(value);
      if (
        (PATH_VALUE_OPTIONS.has(option) || optionsWithValue.has(option)) &&
        !value.includes("=")
      ) {
        index += 1;
      }
      continue;
    }
    result.push(value);
  }
  return result;
}

function rgPathOperands(args: readonly string[]): readonly string[] {
  const operands: string[] = [];
  let patternSeen = args.some((value) => value === "--files");
  let optionsEnded = false;
  const optionsWithValue = new Set([
    "-A",
    "-B",
    "-C",
    "-E",
    "-M",
    "-g",
    "-j",
    "-m",
    "-r",
    "-t",
    "-T",
    "--after-context",
    "--before-context",
    "--context",
    "--encoding",
    "--glob",
    "--max-columns",
    "--max-count",
    "--pre",
    "--pre-glob",
    "--replace",
    "--threads",
    "--type",
    "--type-add",
    "--type-not",
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index] ?? "";
    if (!optionsEnded && value === "--") {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && value.startsWith("-")) {
      const option = value.includes("=") ? value.slice(0, value.indexOf("=")) : value;
      if (optionsWithValue.has(option) && !value.includes("=")) index += 1;
      continue;
    }
    if (!patternSeen) {
      patternSeen = true;
      continue;
    }
    operands.push(value);
  }
  return operands;
}

function commandPathOperands(program: string, args: readonly string[]): readonly string[] {
  const flaggedPaths = pathOptionOperands(args);
  if (program === "rg") return [...flaggedPaths, ...rgPathOperands(args)];
  if (program === "jq") {
    const values: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
      const value = args[index] ?? "";
      if (value === "-f" || value === "--from-file") {
        if (args[index + 1] !== undefined) values.push(args[index + 1] ?? "");
        index += 1;
        continue;
      }
      if (value === "--slurpfile" || value === "--rawfile" || value === "--argfile") {
        if (args[index + 2] !== undefined) values.push(args[index + 2] ?? "");
        index += 2;
      }
    }
    const positionals = positionalArguments(
      args,
      new Set([
        "--arg",
        "--argjson",
        "--indent",
        "--join-output",
        "--rawfile",
        "--slurpfile",
        "-L",
        "-f",
      ]),
    );
    return [...flaggedPaths, ...values, ...positionals.slice(1)];
  }
  if (program === "find") {
    const roots: string[] = [];
    for (const value of args) {
      if (value === "-H" || value === "-L" || value === "-P") continue;
      if (value.startsWith("-") || value === "!") break;
      roots.push(value);
    }
    return [...flaggedPaths, ...roots];
  }
  if (program === "git" && args[0]?.toLowerCase() === "show") {
    return [...flaggedPaths, ...positionalArguments(args.slice(1))];
  }
  if (program === "sed") {
    const hasExpressionOption = args.some((value) => value === "-e" || value === "--expression");
    const positionals = positionalArguments(args, new Set(["--expression", "-e"]));
    return [...flaggedPaths, ...(hasExpressionOption ? positionals : positionals.slice(1))];
  }
  if (program === "head" || program === "tail") {
    return [
      ...flaggedPaths,
      ...positionalArguments(
        args,
        new Set(["--bytes", "--lines", "--max-unchanged-stats", "--pid", "-c", "-n"]),
      ),
    ];
  }
  if (program === "cut") {
    return [
      ...flaggedPaths,
      ...positionalArguments(
        args,
        new Set([
          "--bytes",
          "--characters",
          "--delimiter",
          "--fields",
          "--output-delimiter",
          "-b",
          "-c",
          "-d",
          "-f",
        ]),
      ),
    ];
  }
  if (program === "sort") {
    return [
      ...flaggedPaths,
      ...positionalArguments(
        args,
        new Set([
          "--batch-size",
          "--buffer-size",
          "--compress-program",
          "--field-separator",
          "--key",
          "--parallel",
          "-S",
          "-T",
          "-k",
          "-t",
        ]),
      ),
    ];
  }
  if (program === "uniq") {
    return [
      ...flaggedPaths,
      ...positionalArguments(
        args,
        new Set(["--check-chars", "--skip-chars", "--skip-fields", "-f", "-s", "-w"]),
      ),
    ];
  }
  if (program === "tree") {
    return [
      ...flaggedPaths,
      ...positionalArguments(args, new Set(["--filelimit", "--timefmt", "-I", "-L", "-P"])),
    ];
  }
  if (program === "pytest") {
    return [
      ...flaggedPaths,
      ...positionalArguments(
        args,
        new Set([
          "--ignore",
          "--ignore-glob",
          "--rootdir",
          "--tb",
          "--verbosity",
          "-k",
          "-m",
          "-o",
        ]),
      ),
    ];
  }
  if (program === "jest" || program === "vitest" || program === "eslint") {
    return [
      ...flaggedPaths,
      ...positionalArguments(
        args,
        new Set(["--coverage-directory", "--test-name-pattern", "--testNamePattern", "-t"]),
      ),
    ];
  }
  if (program === "ruff") {
    const startIndex = new Set(["check", "format"]).has(args[0]?.toLowerCase() ?? "") ? 1 : 0;
    return [...flaggedPaths, ...positionalArguments(args, new Set(["--select"]), startIndex)];
  }
  if (program === "tsc") {
    return [
      ...flaggedPaths,
      ...positionalArguments(args, new Set(["--lib", "--module", "--target"])),
    ];
  }
  if (program === "npm" || program === "pnpm") {
    const separator = args.indexOf("--");
    return [
      ...flaggedPaths,
      ...(separator < 0 ? [] : positionalArguments(args.slice(separator + 1))),
    ];
  }
  if (program === "cat" || program === "file" || program === "stat" || program === "wc") {
    return [...flaggedPaths, ...positionalArguments(args)];
  }
  return flaggedPaths;
}

function splitCompoundCommand(command: string): readonly string[] {
  const segments: string[] = [];
  let segment = "";
  let quote: "single" | "double" | null = null;
  let escaped = false;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index] ?? "";
    if (escaped) {
      segment += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "single") {
      segment += character;
      escaped = true;
      continue;
    }
    if (character === "'" && quote !== "double") {
      quote = quote === "single" ? null : "single";
      segment += character;
      continue;
    }
    if (character === '"' && quote !== "single") {
      quote = quote === "double" ? null : "double";
      segment += character;
      continue;
    }
    if (quote === null && /[;&|]/u.test(character)) {
      if (segment.trim().length > 0) segments.push(segment.trim());
      segment = "";
      while (command[index + 1] === character) index += 1;
      continue;
    }
    segment += character;
  }
  if (segment.trim().length > 0) segments.push(segment.trim());
  return segments;
}

function outputPathOperands(args: readonly string[]): readonly string[] {
  const result: string[] = [];
  for (const [index, value] of args.entries()) {
    if (!isOutputWritingOption(value)) continue;
    const separator = value.indexOf("=");
    if (separator >= 0) result.push(value.slice(separator + 1));
    else if (args[index + 1] !== undefined) result.push(args[index + 1] ?? "");
  }
  return result;
}

function plannedCommandTriggers(command: string): DeterministicTrigger[] {
  const tokens = tokenizePlannedCommand(command);
  if (tokens === null) {
    const triggers = new Set<DeterministicTrigger>(["unknown"]);
    const segments = splitCompoundCommand(command);
    if (segments.length > 1) {
      for (const segment of segments) {
        for (const trigger of plannedCommandTriggers(segment)) {
          if (trigger !== "unknown") triggers.add(trigger);
        }
      }
    }
    return [...triggers];
  }
  const [rawProgram, ...args] = tokens;
  const program = rawProgram?.toLowerCase();
  if (program === undefined || program.includes("/") || program.includes("\\")) return ["unknown"];

  const triggers = new Set<DeterministicTrigger>();
  if (args.some(isOutputWritingOption)) triggers.add("unknown");
  if (hasAmbiguousPathOption(args)) triggers.add("unknown");
  if (outputPathOperands(args).some(hasParentOrAbsolutePath)) {
    triggers.add("scope_expansion");
    triggers.add("unknown");
  }
  const pathOperands = commandPathOperands(program, args);
  if (pathOperands.some(hasParentOrAbsolutePath)) {
    triggers.add("scope_expansion");
    triggers.add("unknown");
  }
  if (pathOperands.some(isProtectedCommandPath)) triggers.add("secret");

  if (program === "open" && args.some((value) => /^https?:\/\//iu.test(value))) {
    triggers.add("network");
    return [...triggers];
  }
  if (program === "git" && args[0]?.toLowerCase() === "send-pack") {
    triggers.add("remote_write");
    triggers.add("network");
    return [...triggers];
  }
  if (program === "git" && args[0]?.toLowerCase() === "ls-remote") {
    triggers.add("network");
    return [...triggers];
  }
  if (isKnownVerificationCommand(program, args)) return [...triggers];

  const classification = classifyCommandAction({ program, args });
  if (!classification.known) {
    triggers.add("unknown");
    return [...triggers];
  }
  for (const trigger of commandClassTriggers(classification.commandClass)) triggers.add(trigger);
  return [...triggers];
}

function statesNoCompatibilityImpact(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (/(?:\bbut\b|\bexcept\b|\bwhile\b|だが|しかし|一方|ただし|、|,|;)/u.test(normalized)) {
    return false;
  }
  return (
    /^(?:none|n\/a|not applicable|no (?:known )?(?:compatibility )?impact)[.!]?$/u.test(
      normalized,
    ) ||
    /^(?:backward )?compatibility (?:is )?(?:preserved|maintained|unchanged)[.!]?$/u.test(
      normalized,
    ) ||
    /^(?:該当なし|なし|互換性(?:へ|に)?の?影響(?:は|が)?(?:ない|なし))[。.]?$/u.test(normalized) ||
    /^.{0,80}互換性を(?:維持(?:する|される|できる)?|保持(?:する|される)?|保つ)[。.]?$/u.test(
      normalized,
    )
  );
}

function statesNoDependencyChange(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (/(?:\bbut\b|\bexcept\b|\bhowever\b|だが|しかし|一方|ただし)/u.test(normalized)) {
    return false;
  }
  const clauses = normalized
    .split(/\s*(?:,|;|、|\band\b|\bwhile\b|および|かつ)\s*/u)
    .map((clause) => clause.replace(/^[\s.。]+|[\s.。]+$/gu, ""))
    .filter(Boolean);
  return (
    clauses.length > 0 &&
    clauses.every(
      (clause) =>
        /^(?:none|n\/a|not applicable|dependency-free|no (?:new )?(?:dependency|dependencies|dependency changes?|package changes?)|without adding (?:a )?(?:dependency|dependencies)|(?:the )?dependencies? (?:(?:are|remain(?:s)?) )?(?:unchanged|preserved)|keep (?:the )?dependencies? unchanged)$/u.test(
          clause,
        ) ||
        /^(?:依存関係(?:の変更)?(?:は|が)?(?:ない|なし)|新しい依存関係(?:は|を)?追加しない|依存関係を変更しない|依存関係(?:は|を)?(?:維持|変更なし))$/u.test(
          clause,
        ),
    )
  );
}

function statesNoDataChange(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    /^(?:none|n\/a|not applicable|no (?:persistent )?data changes?|(?:persistent )?data (?:is |remains? )?(?:unchanged|preserved))[.!]?$/u.test(
      normalized,
    ) ||
    /^(?:該当なし|なし|(?:永続)?データ(?:の)?変更(?:は|が)?(?:ない|なし)|(?:永続)?データ(?:は|を)?(?:変更しない|維持|変更なし))[。.]?$/u.test(
      normalized,
    )
  );
}

function statesNoPermissionChange(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    /^(?:none|n\/a|not applicable|no (?:permission|privilege|role) changes?|(?:permissions?|privileges?|roles?) (?:are |remain(?:s)? )?(?:unchanged|preserved))[.!]?$/u.test(
      normalized,
    ) ||
    /^(?:該当なし|なし|(?:権限|特権|ロール)(?:の)?変更(?:は|が)?(?:ない|なし)|(?:権限|特権|ロール)(?:は|を)?(?:変更しない|維持|変更なし))[。.]?$/u.test(
      normalized,
    )
  );
}

function statesNoExternalEffect(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    /^(?:none|n\/a|not applicable|no (?:external|remote) (?:effects?|writes?)|no network access|no remote writes?(?: (?:or|and) (?:no )?network access)?|no network access(?: (?:or|and) (?:no )?remote writes?)?)[.!]?$/u.test(
      normalized,
    ) ||
    /^(?:該当なし|なし|外部(?:影響|作用)(?:は|が)?(?:ない|なし)|リモート書き込み(?:は|を)?(?:しない|なし)|ネットワークアクセス(?:は|を)?(?:しない|なし))[。.]?$/u.test(
      normalized,
    )
  );
}

export function evaluateDeterministicPolicy(
  input: DeterministicPolicyInput,
): readonly PolicyBlocker[] {
  const blockers = new Map<string, MutableBlocker>();
  const task = input.task.trim();
  const taskTriggers = new Set(task.length === 0 ? [] : matchingTaskTriggers(task));

  function add(
    trigger: DeterministicTrigger,
    value: string,
    plan: PlanArtifactLike,
    evidenceRef: string,
    groupKey?: string,
  ): void {
    const redacted =
      redactText(value, { knownSecrets: input.knownSecrets ?? [] }).text.trim() ||
      "[empty model value]";
    const key = groupKey ?? `${trigger}\0${exactActionIdentity(redacted)}`;
    const existing = blockers.get(key);
    if (existing !== undefined) {
      existing.descriptions.add(redacted);
      for (const component of plan.components) existing.affectedComponents.add(component);
      existing.evidenceRefs.add(evidenceRef);
      return;
    }
    blockers.set(key, {
      trigger,
      descriptions: new Set([redacted]),
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
    for (const trigger of triggers) {
      add(trigger, value, plan, evidenceRef);
    }
    return triggers;
  }

  if (task.length > 0 && taskTriggers.size > 0) {
    const taskEvidencePlan: PlanArtifactLike = {
      probeId: "task",
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
      reversibility: "reversible",
      unknowns: [],
    };
    for (const trigger of taskTriggers) {
      add(trigger, task, taskEvidencePlan, "task:normalized");
    }
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
      if (statesNoDataChange(value)) return;
      const evidenceRef = `${plan.probeId}:dataChanges:${String(index)}`;
      const triggers = scan(value, plan, evidenceRef);
      if (!triggers.includes("destructive_data") && !triggers.includes("migration")) {
        add("persistent_data", value, plan, evidenceRef);
      }
    });
    plan.permissionChanges.forEach((value, index) => {
      if (statesNoPermissionChange(value)) return;
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
      if (statesNoDependencyChange(value)) return;
      const evidenceRef = `${plan.probeId}:dependencyChanges:${String(index)}`;
      add("dependency", value, plan, evidenceRef);
    });
    plan.externalEffects.forEach((value, index) => {
      if (statesNoExternalEffect(value)) return;
      const evidenceRef = `${plan.probeId}:externalEffects:${String(index)}`;
      const triggers = scan(value, plan, evidenceRef);
      if (triggers.length === 0) add("unknown", value, plan, evidenceRef);
    });
    plan.publicApiChanges.forEach((value, index) => {
      scan(value, plan, `${plan.probeId}:publicApiChanges:${String(index)}`);
    });
    plan.compatibilityImpacts.forEach((value, index) => {
      if (statesNoCompatibilityImpact(value)) return;
      const evidenceRef = `${plan.probeId}:compatibilityImpacts:${String(index)}`;
      // Compatibility effects are presented as one explicit all-or-none choice.
      // Every underlying description and evidence reference remains visible.
      add("compatibility", value, plan, evidenceRef, "compatibility\0all");
    });
    plan.commands.forEach((value, index) => {
      const evidenceRef = `${plan.probeId}:commands:${String(index)}`;
      for (const trigger of plannedCommandTriggers(value)) {
        add(trigger, value, plan, evidenceRef);
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
      const details = [...blocker.descriptions].sort();
      return {
        blockerId: blockerId(blocker.trigger, details),
        trigger: blocker.trigger,
        category: rule.category,
        impact: rule.impact,
        orderGroup: rule.orderGroup,
        question: rule.question,
        description:
          details.length === 1
            ? (details[0] ?? "[empty model value]")
            : blocker.trigger === "compatibility"
              ? `${String(details.length)} disclosed compatibility impacts require one explicit all-or-none choice.`
              : `${String(details.length)} descriptions of this policy-relevant action require one explicit decision.`,
        details,
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
