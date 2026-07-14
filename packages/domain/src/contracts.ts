import { canonicalHash, deepFreeze, DISPLAY_ONLY_KEYS } from "./canonical.js";
import {
  ExecutionContractDraftSchema,
  ExecutionContractSchema,
  type ExecutionContract,
  type ExecutionContractDraft,
} from "./schemas.js";

const CONTRACT_OMIT_KEYS = new Set([
  ...DISPLAY_ONLY_KEYS,
  "approvedAt",
  "contractId",
  "contentHash",
]);

export type ContractAmendment = Partial<
  Omit<ExecutionContractDraft, "approvedAt" | "createdAt" | "runId" | "version">
> & {
  readonly createdAt: string;
};

function contractHashInput(value: ExecutionContractDraft | ExecutionContract): unknown {
  return value;
}

export function executionContractContentHash(
  value: ExecutionContractDraft | ExecutionContract,
): string {
  return canonicalHash(contractHashInput(value), { omitKeys: CONTRACT_OMIT_KEYS });
}

export function createExecutionContract(draft: ExecutionContractDraft): ExecutionContract {
  const parsed = ExecutionContractDraftSchema.parse(draft);
  const contentHash = executionContractContentHash(parsed);
  const contract = ExecutionContractSchema.parse({
    ...parsed,
    contractId: `contract_${contentHash.slice(0, 24)}`,
    contentHash,
  });
  return deepFreeze(contract);
}

export function verifyExecutionContract(contract: ExecutionContract): boolean {
  const parsed = ExecutionContractSchema.parse(contract);
  return parsed.contentHash === executionContractContentHash(parsed);
}

export function approveExecutionContract(
  contract: ExecutionContract,
  approvedAt: string,
): ExecutionContract {
  const parsed = ExecutionContractSchema.parse(contract);
  if (!verifyExecutionContract(parsed)) throw new Error("contract content hash mismatch");
  const approved = ExecutionContractSchema.parse({ ...parsed, approvedAt });
  return deepFreeze(approved);
}

export function amendExecutionContract(
  previous: ExecutionContract,
  amendment: ContractAmendment,
): ExecutionContract {
  const parsed = ExecutionContractSchema.parse(previous);
  if (!verifyExecutionContract(parsed)) throw new Error("contract content hash mismatch");
  const { contractId, contentHash, ...draft } = parsed;
  void contractId;
  void contentHash;
  return createExecutionContract({
    ...draft,
    ...amendment,
    approvedAt: null,
    runId: parsed.runId,
    version: parsed.version + 1,
  });
}
