import { assertNoDuplicateWorkspaceRegistryKeys } from '../registry/workspaceRegistryDuplicateKeys.js';
import { hasExactDataKeys, isPlainDataRecord } from '../registry/workspaceRegistryValueShape.js';

export type WorkspaceDeletionDataFailure =
  | 'WORKSPACE_DELETE_INVENTORY_INVALID'
  | 'WORKSPACE_DELETE_JOURNAL_CONFLICT'
  | 'WORKSPACE_REMNANT_BINDING_INVALID';

export function invalidDeletionData(code: WorkspaceDeletionDataFailure): never {
  throw new Error(code);
}

export function checkedDeletionAuthority(assertCurrent: () => void, code: WorkspaceDeletionDataFailure): () => void {
  return () => {
    const result: unknown = assertCurrent();
    if (result !== undefined) {
      void Promise.resolve(result).catch(() => undefined);
      invalidDeletionData(code);
    }
  };
}

export function deletionDataRecord(
  value: unknown, keys: readonly string[], code: WorkspaceDeletionDataFailure,
): asserts value is Record<string, unknown> {
  if (!isPlainDataRecord(value) || !hasExactDataKeys(value, keys)) invalidDeletionData(code);
}

export function deletionDigest(value: unknown, code: WorkspaceDeletionDataFailure): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) invalidDeletionData(code);
  return value;
}

export function parseDeletionJson(
  bytes: Uint8Array, maximumBytes: number, code: WorkspaceDeletionDataFailure,
): unknown {
  try {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > maximumBytes) {
      return invalidDeletionData(code);
    }
    const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    assertNoDuplicateWorkspaceRegistryKeys(source);
    return JSON.parse(source) as unknown;
  } catch {
    return invalidDeletionData(code);
  }
}
