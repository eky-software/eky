import {
  WorkspaceMaintenanceLeaseBusyError,
  type WorkspaceMaintenanceLease,
  type WorkspaceMaintenanceLeaseHandle,
  type WorkspaceMaintenancePurpose,
} from '../maintenance/workspaceMaintenanceLease.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import type {
  LocalWorkspaceRegistryEntryV1,
  LocalWorkspaceRegistryV1,
  WorkspaceId,
} from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import type { ActiveWorkspaceLifecyclePort } from '../runtime/activeWorkspaceLifecyclePort.js';
import {
  assertWorkspaceSwitchTransition,
  type WorkspaceSwitchJournalPort,
  type WorkspaceSwitchJournalV1,
  validateWorkspaceSwitchJournal,
} from './workspaceSwitchJournal.js';

export const TEST_SWITCH_OPERATION_ID =
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const TEST_SWITCH_CREATED_AT = '2026-08-19T10:00:00.000Z';
export const TEST_SOURCE_WORKSPACE_ID = validateWorkspaceId(
  '11111111-1111-4111-8111-111111111111',
);
export const TEST_TARGET_WORKSPACE_ID = validateWorkspaceId(
  '22222222-2222-4222-8222-222222222222',
);

export function createSwitchRegistry(
  activeWorkspaceId: WorkspaceId = TEST_SOURCE_WORKSPACE_ID,
): Readonly<LocalWorkspaceRegistryV1> {
  return Object.freeze({
    formatVersion: 1,
    activeWorkspaceId,
    workspaces: Object.freeze([
      createSwitchWorkspace(TEST_SOURCE_WORKSPACE_ID, 'Lähde', 'a'),
      createSwitchWorkspace(TEST_TARGET_WORKSPACE_ID, 'Kohde', 'b'),
    ]),
  });
}

export function createSwitchWorkspace(
  workspaceId: WorkspaceId,
  workspaceLabel: string,
  profileCharacter: string,
): Readonly<LocalWorkspaceRegistryEntryV1> {
  return Object.freeze({
    workspaceId,
    workspaceLabel,
    lineageIdentity: Object.freeze({
      formatVersion: 1,
      profileId: profileCharacter.repeat(64),
    }),
    layoutVersion: 1,
    lifecycleState: 'ready',
    createdAt: TEST_SWITCH_CREATED_AT,
  });
}

export function createSwitchJournal(
  state: WorkspaceSwitchJournalV1['state'],
): Readonly<WorkspaceSwitchJournalV1> {
  return Object.freeze({
    formatVersion: 1,
    operationId: TEST_SWITCH_OPERATION_ID,
    sourceWorkspaceId: TEST_SOURCE_WORKSPACE_ID,
    targetWorkspaceId: TEST_TARGET_WORKSPACE_ID,
    state,
    createdAt: TEST_SWITCH_CREATED_AT,
  });
}

export class MemorySwitchJournal implements WorkspaceSwitchJournalPort {
  current: Readonly<WorkspaceSwitchJournalV1> | undefined;
  failAfterState: WorkspaceSwitchJournalV1['state'] | undefined;
  failBeforeState: WorkspaceSwitchJournalV1['state'] | undefined;
  failClear = false;

  constructor(
    private readonly events: string[],
    initial?: Readonly<WorkspaceSwitchJournalV1>,
  ) {
    this.current = initial;
  }

  async read(): Promise<Readonly<WorkspaceSwitchJournalV1> | undefined> {
    this.events.push('journal.read');
    return this.current;
  }

  async write(value: unknown): Promise<void> {
    const next = validateWorkspaceSwitchJournal(value);
    this.events.push(`journal.write.${next.state}`);
    if (this.failBeforeState === next.state) throw new Error('journal');
    assertWorkspaceSwitchTransition(this.current, next);
    this.current = next;
    if (this.failAfterState === next.state) {
      this.failAfterState = undefined;
      throw new Error('journal');
    }
  }

  async clear(operationId: string): Promise<void> {
    this.events.push('journal.clear');
    if (
      this.failClear ||
      this.current === undefined ||
      this.current.operationId !== operationId
    ) {
      throw new Error('journal');
    }
    this.current = undefined;
  }
}

export class MemorySwitchRegistry implements WorkspaceRegistryPort {
  failWriteAfter = false;
  failWriteBefore = false;

  constructor(
    private readonly events: string[],
    public value: Readonly<LocalWorkspaceRegistryV1> | undefined,
  ) {}

  async read(): Promise<Readonly<LocalWorkspaceRegistryV1> | undefined> {
    this.events.push('registry.read');
    return this.value;
  }

  async write(value: unknown): Promise<void> {
    this.events.push('registry.write');
    if (this.failWriteBefore) throw new Error('registry');
    this.value = value as Readonly<LocalWorkspaceRegistryV1>;
    if (this.failWriteAfter) {
      this.failWriteAfter = false;
      throw new Error('registry');
    }
  }
}

export type SwitchLifecycleFailure =
  | 'quiesce'
  | 'stopBeforeSideEffect'
  | 'stopAfterSideEffect'
  | 'ensure';

export class RecordingSwitchLifecycle implements ActiveWorkspaceLifecyclePort {
  failure: SwitchLifecycleFailure | undefined;
  runningRuntimeOwners = 1;
  openDatabaseHandleOwners = 1;

  constructor(private readonly events: string[]) {}

  async quiesceWrites(
    workspaceId: WorkspaceId | null,
  ): Promise<void> {
    this.events.push(`lifecycle.quiesce.${workspaceId ?? 'none'}`);
    if (this.failure === 'quiesce') throw new Error('quiesce');
  }

  async stopAndProveHandlesClosed(
    workspaceId: WorkspaceId | null,
  ): Promise<{ readonly handlesClosed: true }> {
    this.events.push(`lifecycle.stop.${workspaceId ?? 'none'}`);
    if (this.failure === 'stopBeforeSideEffect') throw new Error('stop');
    this.runningRuntimeOwners = 0;
    this.openDatabaseHandleOwners = 0;
    if (this.failure === 'stopAfterSideEffect') throw new Error('stop');
    return { handlesClosed: true };
  }

  async ensurePreviousWorkspaceRunning(
    workspaceId: WorkspaceId | null,
  ): Promise<void> {
    this.events.push(`lifecycle.ensure.${workspaceId ?? 'none'}`);
    if (this.failure === 'ensure') throw new Error('ensure');
    if (this.runningRuntimeOwners === 0) this.runningRuntimeOwners = 1;
    if (this.openDatabaseHandleOwners === 0) {
      this.openDatabaseHandleOwners = 1;
    }
    if (
      this.runningRuntimeOwners !== 1 ||
      this.openDatabaseHandleOwners !== 1
    ) {
      throw new Error('multiple-owners');
    }
  }
}

export class RecordingSwitchLease implements WorkspaceMaintenanceLease {
  failAcquire = false;
  failRelease = false;
  held = false;

  constructor(private readonly events: string[]) {}

  async acquire(
    purpose: WorkspaceMaintenancePurpose,
  ): Promise<WorkspaceMaintenanceLeaseHandle> {
    this.events.push(`lease.acquire.${purpose}`);
    if (this.failAcquire) throw new Error('lease');
    if (this.held) throw new WorkspaceMaintenanceLeaseBusyError();
    this.held = true;
    return {
      release: async () => {
        this.events.push('lease.release');
        if (this.failRelease) throw new Error('lease');
        this.held = false;
      },
    };
  }
}
