import { isAbsolute, join, resolve } from 'node:path';

import {
  CrashSafeByteSlotStore,
  CrashSafeByteSlotStoreError,
} from '../persistence/crashSafeByteSlotStore.js';
import {
  createNodeCrashSafeFileSlotFileSystem,
  CrashSafeFileSlotError,
} from '../persistence/crashSafeFileSlot.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceTimestamp } from '../registry/workspaceTimestampValidation.js';
import { WorkspaceSwitchError } from './workspaceSwitchError.js';
import { assertNoDuplicateWorkspaceSwitchJournalKeys } from './workspaceSwitchJournalDuplicateKeys.js';

const maximumJournalBytes = 4_096;
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

export interface WorkspaceSwitchJournalPort {
  read(): Promise<Readonly<WorkspaceSwitchJournalV1> | undefined>;
  write(value: unknown): Promise<void>;
  clear(operationId: string): Promise<void>;
}

export interface WorkspaceSwitchJournalPaths {
  readonly backupPath: string;
  readonly currentPath: string;
  readonly directoryPath: string;
  readonly nextPath: string;
}

export function createWorkspaceSwitchJournalPaths(
  userDataRoot: string,
): Readonly<WorkspaceSwitchJournalPaths> {
  const root = requireAbsoluteRoot(userDataRoot);
  const directoryPath = join(root, 'workspace-state');
  const currentPath = join(directoryPath, workspaceSwitchJournalFileName);
  return Object.freeze({
    backupPath: `${currentPath}.backup`,
    currentPath,
    directoryPath,
    nextPath: `${currentPath}.next`,
  });
}

export class WorkspaceSwitchJournalStore implements WorkspaceSwitchJournalPort {
  private readonly byteStore: CrashSafeByteSlotStore;
  private activeOperation = false;

  constructor(userDataRoot: string) {
    const paths = createWorkspaceSwitchJournalPaths(userDataRoot);
    this.byteStore = new CrashSafeByteSlotStore(
      createNodeCrashSafeFileSlotFileSystem(
        paths,
        maximumJournalBytes,
      ),
    );
  }

  read(): Promise<Readonly<WorkspaceSwitchJournalV1> | undefined> {
    return this.runExclusive(() => this.recoverAndRead());
  }

  write(value: unknown): Promise<void> {
    return this.runExclusive(async () => {
      const next = validateWorkspaceSwitchJournal(value);
      const current = await this.recoverAndRead();
      assertWorkspaceSwitchTransition(current, next);
      try {
        await this.byteStore.replace(
          serializeWorkspaceSwitchJournal(next),
          current !== undefined,
        );
      } catch (error) {
        throw mapStorageError(error);
      }
    });
  }

  clear(operationId: string): Promise<void> {
    return this.runExclusive(async () => {
      const current = await this.recoverAndRead();
      if (current === undefined || current.operationId !== operationId) {
        throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
      }
      try {
        await this.byteStore.clear();
      } catch (error) {
        throw mapStorageError(error);
      }
    });
  }

  private async recoverAndRead(): Promise<
    Readonly<WorkspaceSwitchJournalV1> | undefined
  > {
    try {
      return await this.byteStore.recoverAndRead(
        parseWorkspaceSwitchJournalBytes,
      );
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  private async runExclusive<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> {
    if (this.activeOperation) {
      throw new WorkspaceSwitchError('WORKSPACE_SWITCH_STORAGE_FAILED');
    }
    this.activeOperation = true;
    try {
      return await operation();
    } finally {
      this.activeOperation = false;
    }
  }
}

export function validateWorkspaceSwitchJournal(
  value: unknown,
): Readonly<WorkspaceSwitchJournalV1> {
  try {
    requirePlainRecord(value);
    requireExactKeys(value, [
      'formatVersion',
      'operationId',
      'sourceWorkspaceId',
      'targetWorkspaceId',
      'state',
      'createdAt',
    ]);
    if (
      value.formatVersion !== 1 ||
      typeof value.operationId !== 'string' ||
      !operationIdPattern.test(value.operationId) ||
      !isWorkspaceSwitchState(value.state)
    ) {
      throw new Error('invalid');
    }
    const sourceWorkspaceId = validateWorkspaceId(value.sourceWorkspaceId);
    const targetWorkspaceId = validateWorkspaceId(value.targetWorkspaceId);
    if (sourceWorkspaceId === targetWorkspaceId) {
      throw new Error('invalid');
    }
    return Object.freeze({
      formatVersion: 1,
      operationId: value.operationId,
      sourceWorkspaceId,
      targetWorkspaceId,
      state: value.state,
      createdAt: validateWorkspaceTimestamp(value.createdAt),
    });
  } catch {
    throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
  }
}

export function serializeWorkspaceSwitchJournal(
  value: unknown,
): Uint8Array {
  const journal = validateWorkspaceSwitchJournal(value);
  return new TextEncoder().encode(
    `${JSON.stringify({
      formatVersion: journal.formatVersion,
      operationId: journal.operationId,
      sourceWorkspaceId: journal.sourceWorkspaceId,
      targetWorkspaceId: journal.targetWorkspaceId,
      state: journal.state,
      createdAt: journal.createdAt,
    })}\n`,
  );
}

export function parseWorkspaceSwitchJournalBytes(
  bytes: Uint8Array,
): Readonly<WorkspaceSwitchJournalV1> {
  try {
    if (bytes.byteLength < 1 || bytes.byteLength > maximumJournalBytes) {
      throw new Error('invalid');
    }
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    assertNoDuplicateWorkspaceSwitchJournalKeys(source);
    const parsed = validateWorkspaceSwitchJournal(JSON.parse(source));
    const canonical = serializeWorkspaceSwitchJournal(parsed);
    if (!bytesEqual(bytes, canonical)) throw new Error('invalid');
    return parsed;
  } catch {
    throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
  }
}

export function assertWorkspaceSwitchTransition(
  current: Readonly<WorkspaceSwitchJournalV1> | undefined,
  next: Readonly<WorkspaceSwitchJournalV1>,
): void {
  if (current === undefined) {
    if (next.state !== 'prepared') {
      throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
    }
    return;
  }
  if (
    current.operationId !== next.operationId ||
    current.sourceWorkspaceId !== next.sourceWorkspaceId ||
    current.targetWorkspaceId !== next.targetWorkspaceId ||
    current.createdAt !== next.createdAt
  ) {
    throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
  }
  const transitions: Readonly<Record<WorkspaceSwitchJournalState, readonly WorkspaceSwitchJournalState[]>> = {
    prepared: ['prepared', 'targetSelected', 'rollbackSelected', 'recoveryRequired'],
    targetSelected: ['targetSelected', 'rollbackSelected', 'recoveryRequired'],
    rollbackSelected: ['rollbackSelected', 'recoveryRequired'],
    recoveryRequired: ['recoveryRequired'],
  };
  if (!transitions[current.state].includes(next.state)) {
    throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
  }
}

function requireAbsoluteRoot(value: string): string {
  if (
    typeof value !== 'string' ||
    value.includes('\0') ||
    !isAbsolute(value) ||
    resolve(value) !== value
  ) {
    throw new WorkspaceSwitchError('WORKSPACE_SWITCH_STORAGE_FAILED');
  }
  return value;
}

function requirePlainRecord(
  value: unknown,
): asserts value is Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error('invalid');
  }
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new Error('invalid');
    }
  }
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const keys = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    keys.length !== required.length ||
    keys.some((key, index) => key !== required[index])
  ) {
    throw new Error('invalid');
  }
}

function isWorkspaceSwitchState(
  value: unknown,
): value is WorkspaceSwitchJournalState {
  return (
    value === 'prepared' ||
    value === 'targetSelected' ||
    value === 'rollbackSelected' ||
    value === 'recoveryRequired'
  );
}

function bytesEqual(first: Uint8Array, second: Uint8Array): boolean {
  return (
    first.byteLength === second.byteLength &&
    first.every((value, index) => value === second[index])
  );
}

function mapStorageError(error: unknown): WorkspaceSwitchError {
  if (error instanceof WorkspaceSwitchError) return error;
  if (
    error instanceof CrashSafeFileSlotError &&
    error.failure === 'invalid'
  ) {
    return new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
  }
  if (error instanceof CrashSafeByteSlotStoreError) {
    return new WorkspaceSwitchError('WORKSPACE_SWITCH_STORAGE_FAILED');
  }
  return new WorkspaceSwitchError('WORKSPACE_SWITCH_STORAGE_FAILED');
}
