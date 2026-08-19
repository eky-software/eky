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
import { WorkspaceLegacyAdoptionError } from './workspaceLegacyAdoptionError.js';
import { assertNoDuplicateWorkspaceLegacyAdoptionJournalKeys } from './workspaceLegacyAdoptionJournalDuplicateKeys.js';

const maximumJournalBytes = 4_096;
export const workspaceLegacyAdoptionJournalFileName =
  'workspace-adoption-v1.json';
const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type WorkspaceLegacyAdoptionSourceKind = 'fresh' | 'legacy';
export type WorkspaceLegacyAdoptionJournalState =
  | 'prepared'
  | 'candidatePrepared'
  | 'rootPublished'
  | 'registryPublished'
  | 'recoveryRequired';

export interface WorkspaceLegacyAdoptionJournalV1 {
  readonly formatVersion: 1;
  readonly operationId: string;
  readonly workspaceId: WorkspaceId;
  readonly sourceKind: WorkspaceLegacyAdoptionSourceKind;
  readonly state: WorkspaceLegacyAdoptionJournalState;
  readonly createdAt: string;
}

export interface WorkspaceLegacyAdoptionJournalPort {
  read(): Promise<Readonly<WorkspaceLegacyAdoptionJournalV1> | undefined>;
  write(value: unknown): Promise<void>;
  clear(operationId: string): Promise<void>;
}

export interface WorkspaceLegacyAdoptionJournalPaths {
  readonly backupPath: string;
  readonly currentPath: string;
  readonly directoryPath: string;
  readonly nextPath: string;
}

export function createWorkspaceLegacyAdoptionJournalPaths(
  userDataRoot: string,
): Readonly<WorkspaceLegacyAdoptionJournalPaths> {
  const root = requireAbsoluteRoot(userDataRoot);
  const directoryPath = join(root, 'workspace-state');
  const currentPath = join(
    directoryPath,
    workspaceLegacyAdoptionJournalFileName,
  );
  return Object.freeze({
    backupPath: `${currentPath}.backup`,
    currentPath,
    directoryPath,
    nextPath: `${currentPath}.next`,
  });
}

export class WorkspaceLegacyAdoptionJournalStore
  implements WorkspaceLegacyAdoptionJournalPort
{
  private readonly byteStore: CrashSafeByteSlotStore;
  private activeOperation = false;

  constructor(userDataRoot: string) {
    const paths = createWorkspaceLegacyAdoptionJournalPaths(userDataRoot);
    this.byteStore = new CrashSafeByteSlotStore(
      createNodeCrashSafeFileSlotFileSystem(
        paths,
        maximumJournalBytes,
      ),
    );
  }

  read(): Promise<Readonly<WorkspaceLegacyAdoptionJournalV1> | undefined> {
    return this.runExclusive(() => this.recoverAndRead());
  }

  write(value: unknown): Promise<void> {
    return this.runExclusive(async () => {
      const next = validateWorkspaceLegacyAdoptionJournal(value);
      const current = await this.recoverAndRead();
      assertWorkspaceLegacyAdoptionTransition(current, next);
      try {
        await this.byteStore.replace(
          serializeWorkspaceLegacyAdoptionJournal(next),
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
      if (current?.operationId !== operationId) {
        throw new WorkspaceLegacyAdoptionError('WORKSPACE_ADOPTION_INVALID');
      }
      try {
        await this.byteStore.clear();
      } catch (error) {
        throw mapStorageError(error);
      }
    });
  }

  private async recoverAndRead(): Promise<
    Readonly<WorkspaceLegacyAdoptionJournalV1> | undefined
  > {
    try {
      return await this.byteStore.recoverAndRead(
        parseWorkspaceLegacyAdoptionJournalBytes,
      );
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  private async runExclusive<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> {
    if (this.activeOperation) {
      throw new WorkspaceLegacyAdoptionError(
        'WORKSPACE_ADOPTION_STORAGE_FAILED',
      );
    }
    this.activeOperation = true;
    try {
      return await operation();
    } finally {
      this.activeOperation = false;
    }
  }
}

export function validateWorkspaceLegacyAdoptionJournal(
  value: unknown,
): Readonly<WorkspaceLegacyAdoptionJournalV1> {
  try {
    requirePlainRecord(value);
    requireExactKeys(value, [
      'formatVersion',
      'operationId',
      'workspaceId',
      'sourceKind',
      'state',
      'createdAt',
    ]);
    if (
      value.formatVersion !== 1 ||
      typeof value.operationId !== 'string' ||
      !operationIdPattern.test(value.operationId) ||
      !isSourceKind(value.sourceKind) ||
      !isJournalState(value.state)
    ) {
      throw new Error('invalid');
    }
    return Object.freeze({
      formatVersion: 1,
      operationId: value.operationId,
      workspaceId: validateWorkspaceId(value.workspaceId),
      sourceKind: value.sourceKind,
      state: value.state,
      createdAt: validateWorkspaceTimestamp(value.createdAt),
    });
  } catch {
    throw new WorkspaceLegacyAdoptionError('WORKSPACE_ADOPTION_INVALID');
  }
}

export function serializeWorkspaceLegacyAdoptionJournal(
  value: unknown,
): Uint8Array {
  const journal = validateWorkspaceLegacyAdoptionJournal(value);
  return new TextEncoder().encode(
    `${JSON.stringify({
      formatVersion: journal.formatVersion,
      operationId: journal.operationId,
      workspaceId: journal.workspaceId,
      sourceKind: journal.sourceKind,
      state: journal.state,
      createdAt: journal.createdAt,
    })}\n`,
  );
}

export function parseWorkspaceLegacyAdoptionJournalBytes(
  bytes: Uint8Array,
): Readonly<WorkspaceLegacyAdoptionJournalV1> {
  try {
    if (bytes.byteLength < 1 || bytes.byteLength > maximumJournalBytes) {
      throw new Error('invalid');
    }
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    assertNoDuplicateWorkspaceLegacyAdoptionJournalKeys(source);
    const parsed = validateWorkspaceLegacyAdoptionJournal(JSON.parse(source));
    if (!bytesEqual(bytes, serializeWorkspaceLegacyAdoptionJournal(parsed))) {
      throw new Error('invalid');
    }
    return parsed;
  } catch {
    throw new WorkspaceLegacyAdoptionError('WORKSPACE_ADOPTION_INVALID');
  }
}

export function assertWorkspaceLegacyAdoptionTransition(
  current: Readonly<WorkspaceLegacyAdoptionJournalV1> | undefined,
  next: Readonly<WorkspaceLegacyAdoptionJournalV1>,
): void {
  if (current === undefined) {
    if (next.state !== 'prepared') invalid();
    return;
  }
  if (
    current.operationId !== next.operationId ||
    current.workspaceId !== next.workspaceId ||
    current.sourceKind !== next.sourceKind ||
    current.createdAt !== next.createdAt
  ) {
    invalid();
  }
  const transitions: Readonly<
    Record<
      WorkspaceLegacyAdoptionJournalState,
      readonly WorkspaceLegacyAdoptionJournalState[]
    >
  > = {
    prepared: ['prepared', 'candidatePrepared', 'recoveryRequired'],
    candidatePrepared: [
      'candidatePrepared',
      'rootPublished',
      'recoveryRequired',
    ],
    rootPublished: [
      'rootPublished',
      'registryPublished',
      'recoveryRequired',
    ],
    registryPublished: ['registryPublished', 'recoveryRequired'],
    recoveryRequired: ['recoveryRequired'],
  };
  if (!transitions[current.state].includes(next.state)) invalid();
}

function requireAbsoluteRoot(value: string): string {
  if (
    typeof value !== 'string' ||
    value.includes('\0') ||
    !isAbsolute(value) ||
    resolve(value) !== value
  ) {
    throw new WorkspaceLegacyAdoptionError(
      'WORKSPACE_ADOPTION_STORAGE_FAILED',
    );
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

function isSourceKind(value: unknown): value is WorkspaceLegacyAdoptionSourceKind {
  return value === 'fresh' || value === 'legacy';
}

function isJournalState(
  value: unknown,
): value is WorkspaceLegacyAdoptionJournalState {
  return (
    value === 'prepared' ||
    value === 'candidatePrepared' ||
    value === 'rootPublished' ||
    value === 'registryPublished' ||
    value === 'recoveryRequired'
  );
}

function invalid(): never {
  throw new WorkspaceLegacyAdoptionError('WORKSPACE_ADOPTION_INVALID');
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

function mapStorageError(error: unknown): WorkspaceLegacyAdoptionError {
  if (error instanceof WorkspaceLegacyAdoptionError) return error;
  if (error instanceof CrashSafeFileSlotError) {
    return new WorkspaceLegacyAdoptionError(
      error.failure === 'invalid'
        ? 'WORKSPACE_ADOPTION_INVALID'
        : 'WORKSPACE_ADOPTION_STORAGE_FAILED',
    );
  }
  if (error instanceof CrashSafeByteSlotStoreError) {
    return new WorkspaceLegacyAdoptionError(
      'WORKSPACE_ADOPTION_STORAGE_FAILED',
    );
  }
  return new WorkspaceLegacyAdoptionError('WORKSPACE_ADOPTION_STORAGE_FAILED');
}
