export type GitSnapshotErrorCode =
  | "NOT_A_GIT_REPOSITORY"
  | "GIT_COMMAND_FAILED"
  | "GIT_OUTPUT_LIMIT"
  | "DIRTY_CHOICE_REQUIRED"
  | "SNAPSHOT_CANCELLED"
  | "UNREPRESENTABLE_SUBMODULE_CHANGE"
  | "SNAPSHOT_SOURCE_CHANGED"
  | "UNSAFE_INSTRUCTION_PATH"
  | "STALE_SNAPSHOT"
  | "PATCH_APPLY_FAILED"
  | "PATCH_VERIFICATION_FAILED"
  | "SUBMODULE_MATERIALIZATION_FAILED"
  | "UNSUPPORTED_CHECKOUT_ENTRY"
  | "UNSAFE_TEMPORARY_ROOT"
  | "ORIGINAL_CHECKOUT_CHANGED"
  | "WORKTREE_CLEANUP_FAILED";

export class GitSnapshotError extends Error {
  readonly code: GitSnapshotErrorCode;
  readonly operation: string;

  constructor(code: GitSnapshotErrorCode, operation: string, message: string) {
    super(message);
    this.name = "GitSnapshotError";
    this.code = code;
    this.operation = operation;
  }
}
