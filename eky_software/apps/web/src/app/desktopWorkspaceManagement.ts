import type { EkyDesktopApi } from './desktopBridge.js';

const WORKSPACE_LABEL_MAX_CODE_POINTS = 80;
const WORKSPACE_STATUS_MAX_BYTES = 32 * 1024;
const WORKSPACE_MAX_ENTRIES = 64;
const workspaceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const forbiddenWorkspaceLabelCodePoint =
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

export type WorkspaceManagementOperationState =
  | 'busy'
  | 'idle'
  | 'recoveryRequired';
export type WorkspaceManagementAvailability = 'ready' | 'recoveryRequired';

export interface WorkspaceManagementEntry {
  readonly availability: WorkspaceManagementAvailability;
  readonly isActive: boolean;
  readonly workspaceId: string;
  readonly workspaceLabel: string;
}

export interface WorkspaceManagementStatus {
  readonly activeWorkspaceId: string | null;
  readonly formatVersion: 1;
  readonly operationState: WorkspaceManagementOperationState;
  readonly workspaces: readonly WorkspaceManagementEntry[];
}

export interface WorkspaceManagementCapability {
  createEmpty(workspaceLabel: string): Promise<'completed' | 'relaunching'>;
  getStatus(): Promise<WorkspaceManagementStatus>;
  importBackupAsNew(
    workspaceLabel: string,
  ): Promise<'cancelled' | 'completed' | 'relaunching'>;
  rename(workspaceId: string, workspaceLabel: string): Promise<'completed'>;
  switchTo(workspaceId: string): Promise<'completed' | 'relaunching'>;
}

export function getDesktopWorkspaceManagement(
  target: Pick<Window, 'ekyDesktop'> = window,
): WorkspaceManagementCapability | undefined {
  const desktop = target.ekyDesktop;
  if (
    typeof desktop?.getWorkspaceManagementStatus !== 'function' ||
    typeof desktop.createEmptyWorkspace !== 'function' ||
    typeof desktop.importWorkspaceBackupAsNew !== 'function' ||
    typeof desktop.switchWorkspace !== 'function' ||
    typeof desktop.renameWorkspace !== 'function'
  ) {
    return undefined;
  }

  return Object.freeze({
    async createEmpty(workspaceLabel: string) {
      const input = readWorkspaceLabel(workspaceLabel);
      const result = await desktop.createEmptyWorkspace({
        workspaceLabel: input,
      });
      return readOperationResult(
        result,
        ['completed', 'relaunching'],
        'create',
      );
    },
    async getStatus() {
      return readWorkspaceStatus(await desktop.getWorkspaceManagementStatus());
    },
    async importBackupAsNew(workspaceLabel: string) {
      const input = readWorkspaceLabel(workspaceLabel);
      const result = await desktop.importWorkspaceBackupAsNew({
        workspaceLabel: input,
      });
      return readOperationResult(
        result,
        ['cancelled', 'completed', 'relaunching'],
        'import',
      );
    },
    async rename(workspaceId: string, workspaceLabel: string) {
      const result = await desktop.renameWorkspace({
        workspaceId: readWorkspaceId(workspaceId),
        workspaceLabel: readWorkspaceLabel(workspaceLabel),
      });
      return readOperationResult(result, ['completed'], 'rename');
    },
    async switchTo(workspaceId: string) {
      const result = await desktop.switchWorkspace({
        workspaceId: readWorkspaceId(workspaceId),
      });
      return readOperationResult(
        result,
        ['completed', 'relaunching'],
        'switch',
      );
    },
  });
}

function readWorkspaceStatus(value: unknown): WorkspaceManagementStatus {
  try {
    return parseWorkspaceStatus(value);
  } catch {
    return invalidWorkspaceStatus();
  }
}

function parseWorkspaceStatus(value: unknown): WorkspaceManagementStatus {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'activeWorkspaceId',
      'formatVersion',
      'operationState',
      'workspaces',
    ]) ||
    value.formatVersion !== 1 ||
    !isOperationState(value.operationState) ||
    !Array.isArray(value.workspaces) ||
    value.workspaces.length > WORKSPACE_MAX_ENTRIES
  ) {
    return invalidWorkspaceStatus();
  }

  const activeWorkspaceId =
    value.activeWorkspaceId === null
      ? null
      : readWorkspaceId(value.activeWorkspaceId);
  const seenIds = new Set<string>();
  const workspaces = value.workspaces.map((entry) => {
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, [
        'availability',
        'isActive',
        'workspaceId',
        'workspaceLabel',
      ]) ||
      !isAvailability(entry.availability) ||
      typeof entry.isActive !== 'boolean'
    ) {
      return invalidWorkspaceStatus();
    }
    const workspaceId = readWorkspaceId(entry.workspaceId);
    if (seenIds.has(workspaceId)) return invalidWorkspaceStatus();
    seenIds.add(workspaceId);
    return Object.freeze({
      availability: entry.availability,
      isActive: entry.isActive,
      workspaceId,
      workspaceLabel: readWorkspaceLabel(entry.workspaceLabel),
    });
  });
  const activeEntries = workspaces.filter((entry) => entry.isActive);
  if (
    (activeWorkspaceId === null && activeEntries.length !== 0) ||
    (activeWorkspaceId !== null &&
      (activeEntries.length !== 1 ||
        activeEntries[0]?.workspaceId !== activeWorkspaceId ||
        activeEntries[0]?.availability !== 'ready'))
  ) {
    return invalidWorkspaceStatus();
  }

  const result = Object.freeze({
    activeWorkspaceId,
    formatVersion: 1,
    operationState: value.operationState,
    workspaces: Object.freeze(workspaces),
  });
  if (encodedByteLength(result) > WORKSPACE_STATUS_MAX_BYTES) {
    return invalidWorkspaceStatus();
  }
  return result;
}

function readOperationResult<const Status extends string>(
  value: unknown,
  allowedStatuses: readonly Status[],
  operation: string,
): Status {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['formatVersion', 'status']) ||
    value.formatVersion !== 1 ||
    typeof value.status !== 'string' ||
    !allowedStatuses.includes(value.status as Status)
  ) {
    throw new Error(`Invalid workspace ${operation} result.`);
  }
  return value.status as Status;
}

function readWorkspaceId(value: unknown): string {
  if (typeof value !== 'string' || !workspaceIdPattern.test(value)) {
    throw new Error('Invalid workspace identifier.');
  }
  return value;
}

function readWorkspaceLabel(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    value.length === 0 ||
    [...value].length > WORKSPACE_LABEL_MAX_CODE_POINTS ||
    forbiddenWorkspaceLabelCodePoint.test(value) ||
    containsUnpairedSurrogate(value)
  ) {
    throw new Error('Invalid workspace label.');
  }
  return value;
}

function containsUnpairedSurrogate(value: string): boolean {
  for (let offset = 0; offset < value.length; offset += 1) {
    const codeUnit = value.charCodeAt(offset);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(offset + 1);
      if (!(nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff)) return true;
      offset += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function encodedByteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isOperationState(
  value: unknown,
): value is WorkspaceManagementOperationState {
  return value === 'idle' || value === 'busy' || value === 'recoveryRequired';
}

function isAvailability(
  value: unknown,
): value is WorkspaceManagementAvailability {
  return value === 'ready' || value === 'recoveryRequired';
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== expectedKeys.length ||
    ownKeys.some(
      (key) => typeof key !== 'string' || !expectedKeys.includes(key),
    )
  ) {
    return false;
  }
  return ownKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && 'value' in descriptor;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function invalidWorkspaceStatus(): never {
  throw new Error('Invalid workspace management status.');
}
