import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceTimestamp } from '../registry/workspaceTimestampValidation.js';
import { WorkspaceSwitchError } from './workspaceSwitchError.js';
import { assertNoDuplicateWorkspaceSwitchJournalKeys } from './workspaceSwitchJournalDuplicateKeys.js';

export const maximumWorkspaceSwitchJournalBytes = 4_096;
export const workspaceSwitchJournalFileName = 'workspace-switch-v1.json';
const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type WorkspaceSwitchJournalState =
  | 'prepared'
  | 'targetSelected'
  | 'rollbackSelected'
  | 'recoveryRequired';

export interface WorkspaceSwitchJournalV1 {
  readonly formatVersion: 1;
  readonly operationId: string;
  readonly sourceWorkspaceId: WorkspaceId;
  readonly targetWorkspaceId: WorkspaceId;
  readonly state: WorkspaceSwitchJournalState;
  readonly createdAt: string;
}

export interface WorkspaceSwitchJournalV2 {
  readonly formatVersion: 2;
  readonly operationId: string;
  readonly sourceWorkspaceId: null;
  readonly targetWorkspaceId: WorkspaceId;
  readonly state: WorkspaceSwitchJournalState;
  readonly createdAt: string;
  readonly registryBeforeSha256: string;
  readonly registrySelectedSha256: string;
  readonly registryRejectedSha256: string;
}

export type WorkspaceSwitchJournal = WorkspaceSwitchJournalV1 | WorkspaceSwitchJournalV2;

export function validateWorkspaceSwitchJournal(value: unknown): Readonly<WorkspaceSwitchJournalV1> {
  const journal = validateVersionedWorkspaceSwitchJournal(value);
  if (journal.formatVersion !== 1) throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
  return journal;
}

export function validateVersionedWorkspaceSwitchJournal(value: unknown): Readonly<WorkspaceSwitchJournal> {
  try {
    requirePlainRecord(value);
    requireExactKeys(value, [
      'formatVersion', 'operationId', 'sourceWorkspaceId', 'targetWorkspaceId', 'state', 'createdAt',
      ...(value.formatVersion === 2
        ? ['registryBeforeSha256', 'registrySelectedSha256', 'registryRejectedSha256'] : []),
    ]);
    if ((value.formatVersion !== 1 && value.formatVersion !== 2) ||
      typeof value.operationId !== 'string' || !operationIdPattern.test(value.operationId) ||
      !isWorkspaceSwitchState(value.state)) {
      throw new Error('invalid');
    }
    const targetWorkspaceId = validateWorkspaceId(value.targetWorkspaceId);
    const createdAt = validateWorkspaceTimestamp(value.createdAt);
    if (value.formatVersion === 2) {
      if (value.sourceWorkspaceId !== null) throw new Error('invalid');
      return Object.freeze({
        formatVersion: 2, operationId: value.operationId, sourceWorkspaceId: null,
        targetWorkspaceId, state: value.state, createdAt,
        registryBeforeSha256: requireDigest(value.registryBeforeSha256),
        registrySelectedSha256: requireDigest(value.registrySelectedSha256),
        registryRejectedSha256: requireDigest(value.registryRejectedSha256),
      });
    }
    const sourceWorkspaceId = validateWorkspaceId(value.sourceWorkspaceId);
    if (sourceWorkspaceId === targetWorkspaceId) throw new Error('invalid');
    return Object.freeze({
      formatVersion: 1, operationId: value.operationId, sourceWorkspaceId,
      targetWorkspaceId, state: value.state, createdAt,
    });
  } catch {
    throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
  }
}

export function serializeWorkspaceSwitchJournal(value: unknown): Uint8Array {
  return serializeVersionedWorkspaceSwitchJournal(validateWorkspaceSwitchJournal(value));
}

export function serializeVersionedWorkspaceSwitchJournal(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(validateVersionedWorkspaceSwitchJournal(value)) + '\n');
}

export function parseWorkspaceSwitchJournalBytes(bytes: Uint8Array): Readonly<WorkspaceSwitchJournalV1> {
  const journal = parseVersionedWorkspaceSwitchJournalBytes(bytes);
  if (journal.formatVersion !== 1) throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
  return journal;
}

export function parseVersionedWorkspaceSwitchJournalBytes(bytes: Uint8Array): Readonly<WorkspaceSwitchJournal> {
  try {
    if (bytes.byteLength < 1 || bytes.byteLength > maximumWorkspaceSwitchJournalBytes) throw new Error('invalid');
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    assertNoDuplicateWorkspaceSwitchJournalKeys(source);
    const parsed = validateVersionedWorkspaceSwitchJournal(JSON.parse(source));
    const canonical = serializeVersionedWorkspaceSwitchJournal(parsed);
    if (bytes.byteLength !== canonical.byteLength ||
      !bytes.every((value, index) => value === canonical[index])) throw new Error('invalid');
    return parsed;
  } catch {
    throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
  }
}

export function assertWorkspaceSwitchTransition(
  current: Readonly<WorkspaceSwitchJournal> | undefined,
  next: Readonly<WorkspaceSwitchJournal>,
): void {
  if (current === undefined) {
    if (next.state !== 'prepared') throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
    return;
  }
  if (current.formatVersion !== next.formatVersion ||
    current.operationId !== next.operationId ||
    current.sourceWorkspaceId !== next.sourceWorkspaceId ||
    current.targetWorkspaceId !== next.targetWorkspaceId ||
    current.createdAt !== next.createdAt ||
    (current.formatVersion === 2 && next.formatVersion === 2 && (
      current.registryBeforeSha256 !== next.registryBeforeSha256 ||
      current.registrySelectedSha256 !== next.registrySelectedSha256 ||
      current.registryRejectedSha256 !== next.registryRejectedSha256
    ))) {
    throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
  }
  const transitions: Readonly<Record<WorkspaceSwitchJournalState, readonly WorkspaceSwitchJournalState[]>> = {
    prepared: ['prepared', 'targetSelected', 'rollbackSelected', 'recoveryRequired'],
    targetSelected: ['targetSelected', 'rollbackSelected', 'recoveryRequired'],
    rollbackSelected: ['rollbackSelected', 'recoveryRequired'],
    recoveryRequired: ['recoveryRequired'],
  };
  if (!transitions[current.state].includes(next.state)) throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
}

function requirePlainRecord(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) throw new Error('invalid');
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor)) throw new Error('invalid');
  }
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const keys = Object.keys(value).sort();
  const required = [...expected].sort();
  if (keys.length !== required.length || keys.some((key, index) => key !== required[index])) throw new Error('invalid');
}

function isWorkspaceSwitchState(value: unknown): value is WorkspaceSwitchJournalState {
  return value === 'prepared' || value === 'targetSelected' || value === 'rollbackSelected' || value === 'recoveryRequired';
}

function requireDigest(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new Error('invalid');
  return value;
}
