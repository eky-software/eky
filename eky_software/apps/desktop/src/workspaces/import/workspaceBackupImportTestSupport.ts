import { resolve } from 'node:path';

import type {
  WorkspaceMaintenanceLease,
  WorkspaceMaintenanceLeaseHandle,
  WorkspaceMaintenancePurpose,
} from '../maintenance/workspaceMaintenanceLease.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import type {
  LocalWorkspaceRegistryV1,
  WorkspaceId,
} from '../registry/workspaceRegistryTypes.js';
import { createReadyWorkspaceEntry } from '../registry/workspaceRegistryMutations.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import type { ActiveWorkspaceLifecyclePort } from '../runtime/activeWorkspaceLifecyclePort.js';
import type { WorkspaceRuntimeAbsencePort } from '../runtime/workspaceRuntimeAbsencePort.js';
import { WorkspaceBackupImportCoordinator } from './workspaceBackupImportCoordinator.js';
import {
  assertWorkspaceBackupImportJournalTransition,
  validateWorkspaceBackupImportJournal,
} from './workspaceBackupImportJournalValidation.js';
import { validateWorkspaceBackupImportOperationId } from './workspaceBackupImportOperationId.js';
import type {
  PublishedWorkspaceBackupValidationInput,
  WorkspaceBackupCandidateMigrationInput,
  WorkspaceBackupCandidateMigrationResult,
  WorkspaceBackupCandidatePort,
  WorkspaceBackupCandidateReadiness,
  WorkspaceBackupCandidateValidationInput,
  WorkspaceBackupContainerPort,
  WorkspaceBackupPreflightResult,
  WorkspaceBackupSourceInput,
  WorkspaceBackupStageInput,
} from './workspaceBackupImportPorts.js';
import type { WorkspaceBackupPlaintextQuarantineRecoveryPort } from './workspaceBackupPlaintextQuarantine.js';
import type {
  WorkspaceBackupImportRootPresence,
  WorkspaceBackupImportRootStore,
} from './workspaceBackupImportRootStore.js';
import type {
  WorkspaceBackupImportJournalStore,
  WorkspaceBackupImportJournalV1,
  WorkspaceBackupImportOperationId,
} from './workspaceBackupImportTypes.js';

export const TEST_IMPORT_OPERATION_ID =
  validateWorkspaceBackupImportOperationId(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  );
export const TEST_IMPORT_WORKSPACE_ID = validateWorkspaceId(
  '33333333-3333-4333-8333-333333333333',
);
export const TEST_IMPORT_PREVIOUS_WORKSPACE_ID = validateWorkspaceId(
  '11111111-1111-4111-8111-111111111111',
);
export const TEST_IMPORT_CREATED_AT = '2026-08-19T10:00:00.000Z';
export const TEST_IMPORT_USER_DATA_ROOT = resolve('Eky-import-test-profile');
export const TEST_IMPORT_CONTAINER_PATH = resolve(
  'Eky-import-test-backup.ekybackup',
);
export const TEST_IMPORT_PASSWORD = 'synthetic-test-password';
export const TEST_IMPORT_PROFILE_ID = 'a'.repeat(64);
export const TEST_IMPORT_SOURCE_MIGRATION_ID = 'b'.repeat(64);
export const TEST_IMPORT_CURRENT_MIGRATION_ID = 'c'.repeat(64);
export const TEST_IMPORT_CONTAINER_SHA = 'd'.repeat(64);

export function createWorkspaceBackupImportCoordinatorFixture(
  options: {
    readonly duplicateLineage?: boolean;
    readonly emptyRegistry?: boolean;
  } = {},
) {
  const events: string[] = [];
  const existingEntry = createReadyWorkspaceEntry({
    workspaceId: TEST_IMPORT_PREVIOUS_WORKSPACE_ID,
    workspaceLabel: 'Nykyinen yritys',
    lineageIdentity: {
      formatVersion: 1,
      profileId: (options.duplicateLineage ? 'a' : '9').repeat(64),
    },
    createdAt: '2026-08-18T10:00:00.000Z',
  });
  const registryValue = options.emptyRegistry
    ? createTestImportRegistry()
    : createTestImportRegistry({
        activeWorkspaceId: TEST_IMPORT_PREVIOUS_WORKSPACE_ID,
        workspaces: [existingEntry],
      });
  const lease = new RecordingImportMaintenanceLease(events);
  const journal = new MemoryWorkspaceBackupImportJournal(events);
  const registry = new MemoryWorkspaceBackupImportRegistry(
    events,
    registryValue,
  );
  const container = new RecordingWorkspaceBackupContainer(events);
  const candidate = new RecordingWorkspaceBackupCandidate(events);
  const root = new MemoryWorkspaceBackupImportRootStore(events);
  const plaintextQuarantine = new RecordingWorkspaceBackupPlaintextQuarantine(
    events,
  );
  const lifecycle = new RecordingImportActiveWorkspaceLifecycle(events);
  const runtimeAbsence = new RecordingImportRuntimeAbsence(events);
  const coordinator = new WorkspaceBackupImportCoordinator({
    activeWorkspaceLifecycle: lifecycle,
    backupCandidate: candidate,
    backupContainer: container,
    generateOperationId: () => TEST_IMPORT_OPERATION_ID,
    generateWorkspaceId: () => TEST_IMPORT_WORKSPACE_ID,
    importJournal: journal,
    maintenanceLease: lease,
    now: () => new Date(TEST_IMPORT_CREATED_AT),
    plaintextQuarantine,
    registry,
    rootStore: root,
    userDataRoot: TEST_IMPORT_USER_DATA_ROOT,
    workspaceRuntimeAbsence: runtimeAbsence,
  });

  return {
    candidate,
    container,
    coordinator,
    events,
    journal,
    lease,
    lifecycle,
    plaintextQuarantine,
    registry,
    root,
    runtimeAbsence,
  };
}

export class RecordingWorkspaceBackupPlaintextQuarantine
  implements WorkspaceBackupPlaintextQuarantineRecoveryPort
{
  failRecovery = false;
  stalePayloadCount = 0;

  constructor(private readonly events: string[]) {}

  async recoverStalePayloads(): Promise<void> {
    this.events.push('quarantine.recoverStalePayloads');
    if (this.failRecovery) throw new Error('quarantine');
    this.stalePayloadCount = 0;
  }
}

export function createTestImportPreflight(
  input: Partial<WorkspaceBackupPreflightResult> = {},
): Readonly<WorkspaceBackupPreflightResult> {
  return Object.freeze({
    appVersion: input.appVersion ?? '0.2.6',
    containerSha256: input.containerSha256 ?? TEST_IMPORT_CONTAINER_SHA,
    migrationChainIdentity:
      input.migrationChainIdentity ?? TEST_IMPORT_SOURCE_MIGRATION_ID,
    profileId: input.profileId ?? TEST_IMPORT_PROFILE_ID,
  });
}

export function createTestImportReadiness(
  input: Partial<WorkspaceBackupCandidateReadiness> = {},
): Readonly<WorkspaceBackupCandidateReadiness> {
  return Object.freeze({
    actorId: 'local-owner',
    artifactRootHealth: 'ready',
    companyId: input.companyId ?? `local-company-${'1'.repeat(32)}`,
    databaseHealth: 'healthy',
    foreignKeyHealth: 'healthy',
    handlesClosed: true,
    lineageIdentity: Object.freeze({
      formatVersion: 1,
      profileId:
        input.lineageIdentity?.profileId ?? TEST_IMPORT_PROFILE_ID,
    }),
    migrationChainIdentity:
      input.migrationChainIdentity ?? TEST_IMPORT_CURRENT_MIGRATION_ID,
    migrationState: 'current',
  });
}

export function createTestImportRegistry(
  input: Partial<LocalWorkspaceRegistryV1> = {},
): Readonly<LocalWorkspaceRegistryV1> {
  return Object.freeze({
    formatVersion: 1,
    activeWorkspaceId: input.activeWorkspaceId ?? null,
    workspaces: Object.freeze([...(input.workspaces ?? [])]),
  });
}

export function createTestImportJournal(input: {
  readonly state: WorkspaceBackupImportJournalV1['state'];
  readonly previousActiveWorkspaceId?: WorkspaceId | null;
  readonly workspaceId?: WorkspaceId;
  readonly profileId?: string;
}): Readonly<WorkspaceBackupImportJournalV1> {
  const lineageRequired = [
    'candidateValidated',
    'rootPublished',
    'registryPublished',
  ].includes(input.state);
  return Object.freeze({
    formatVersion: 1,
    operationId: TEST_IMPORT_OPERATION_ID,
    workspaceId: input.workspaceId ?? TEST_IMPORT_WORKSPACE_ID,
    workspaceLabel: 'Tuotu yritys',
    previousActiveWorkspaceId:
      input.previousActiveWorkspaceId === undefined
        ? TEST_IMPORT_PREVIOUS_WORKSPACE_ID
        : input.previousActiveWorkspaceId,
    state: input.state,
    createdAt: TEST_IMPORT_CREATED_AT,
    lineageIdentity: lineageRequired
      ? Object.freeze({
          formatVersion: 1,
          profileId: input.profileId ?? TEST_IMPORT_PROFILE_ID,
        })
      : null,
  });
}

export class RecordingImportMaintenanceLease
  implements WorkspaceMaintenanceLease {
  held = false;

  constructor(private readonly events: string[]) {}

  async acquire(
    purpose: WorkspaceMaintenancePurpose,
  ): Promise<WorkspaceMaintenanceLeaseHandle> {
    this.events.push(`lease.acquire.${purpose}`);
    if (this.held) throw new Error('busy');
    this.held = true;
    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        this.held = false;
        this.events.push('lease.release');
      },
    };
  }
}

export class MemoryWorkspaceBackupImportJournal
  implements WorkspaceBackupImportJournalStore {
  current: Readonly<WorkspaceBackupImportJournalV1> | undefined;
  readonly states: WorkspaceBackupImportJournalV1['state'][] = [];
  readonly writes: Readonly<WorkspaceBackupImportJournalV1>[] = [];
  failBeforeState: WorkspaceBackupImportJournalV1['state'] | undefined;
  failAfterState: WorkspaceBackupImportJournalV1['state'] | undefined;
  failDiscard = false;
  failRemove = false;

  constructor(
    private readonly events: string[],
    initial?: Readonly<WorkspaceBackupImportJournalV1>,
  ) {
    this.current = initial;
  }

  async read(): Promise<Readonly<WorkspaceBackupImportJournalV1> | undefined> {
    this.events.push('journal.read');
    return this.current;
  }

  async write(value: unknown): Promise<void> {
    const next = validateWorkspaceBackupImportJournal(value);
    this.events.push(`journal.write.${next.state}`);
    if (this.failBeforeState === next.state) throw new Error('journal');
    assertWorkspaceBackupImportJournalTransition(this.current, next);
    this.current = next;
    this.states.push(next.state);
    this.writes.push(next);
    if (this.failAfterState === next.state) throw new Error('journal');
  }

  async discardBeforePublication(
    operationId: WorkspaceBackupImportOperationId,
  ): Promise<void> {
    this.events.push('journal.discard');
    if (
      this.failDiscard ||
      this.current === undefined ||
      this.current.operationId !== operationId ||
      this.current.state === 'rootPublished' ||
      this.current.state === 'registryPublished'
    ) {
      throw new Error('journal');
    }
    this.current = undefined;
  }

  async remove(operationId: WorkspaceBackupImportOperationId): Promise<void> {
    this.events.push('journal.remove');
    if (
      this.failRemove ||
      this.current === undefined ||
      this.current.operationId !== operationId ||
      this.current.state !== 'registryPublished'
    ) {
      throw new Error('journal');
    }
    this.current = undefined;
  }
}

export class MemoryWorkspaceBackupImportRegistry
  implements WorkspaceRegistryPort {
  failRead = false;
  failWriteBefore = false;
  failWriteAfter = false;
  readonly writes: Readonly<LocalWorkspaceRegistryV1>[] = [];

  constructor(
    private readonly events: string[],
    public value: Readonly<LocalWorkspaceRegistryV1> | undefined,
  ) {}

  async read(): Promise<Readonly<LocalWorkspaceRegistryV1> | undefined> {
    this.events.push('registry.read');
    if (this.failRead) throw new Error('registry');
    return this.value;
  }

  async write(value: unknown): Promise<void> {
    this.events.push('registry.write');
    if (this.failWriteBefore) throw new Error('registry');
    this.value = value as Readonly<LocalWorkspaceRegistryV1>;
    this.writes.push(this.value);
    if (this.failWriteAfter) throw new Error('registry');
  }
}

export class RecordingWorkspaceBackupContainer
  implements WorkspaceBackupContainerPort {
  failInspect = false;
  failStage = false;
  inspectResult = createTestImportPreflight();
  stageResult = createTestImportPreflight();
  readonly inspectInputs: Readonly<WorkspaceBackupSourceInput>[] = [];
  readonly stageInputs: Readonly<WorkspaceBackupStageInput>[] = [];

  constructor(private readonly events: string[]) {}

  async inspect(
    input: Readonly<WorkspaceBackupSourceInput>,
  ): Promise<Readonly<WorkspaceBackupPreflightResult>> {
    this.events.push('backup.inspect');
    this.inspectInputs.push(input);
    if (this.failInspect) throw new Error('inspect');
    return this.inspectResult;
  }

  async stage(
    input: Readonly<WorkspaceBackupStageInput>,
  ): Promise<Readonly<WorkspaceBackupPreflightResult>> {
    this.events.push('backup.stage');
    this.stageInputs.push(input);
    if (this.failStage) throw new Error('stage');
    if (
      this.stageResult.containerSha256 !== input.expectedContainerSha256 ||
      this.stageResult.profileId !== input.expectedProfileId ||
      this.stageResult.migrationChainIdentity !==
        input.expectedMigrationChainIdentity
    ) {
      throw new Error('source-changed');
    }
    return this.stageResult;
  }
}

export type ImportCandidateFailure =
  | 'migrate'
  | 'validate'
  | 'validatePublished';

export class RecordingWorkspaceBackupCandidate
  implements WorkspaceBackupCandidatePort {
  failure: ImportCandidateFailure | undefined;
  migrationResult: Readonly<WorkspaceBackupCandidateMigrationResult> =
    Object.freeze({
      handlesClosed: true,
      migrationChainIdentity: TEST_IMPORT_CURRENT_MIGRATION_ID,
      profileId: TEST_IMPORT_PROFILE_ID,
    });
  readiness = createTestImportReadiness();
  readonly migrationInputs: Readonly<WorkspaceBackupCandidateMigrationInput>[] =
    [];
  readonly validationInputs: Readonly<WorkspaceBackupCandidateValidationInput>[] =
    [];
  readonly publishedInputs: Readonly<PublishedWorkspaceBackupValidationInput>[] =
    [];

  constructor(private readonly events: string[]) {}

  async migrate(
    input: Readonly<WorkspaceBackupCandidateMigrationInput>,
  ): Promise<Readonly<WorkspaceBackupCandidateMigrationResult>> {
    this.events.push('candidate.migrate');
    this.migrationInputs.push(input);
    if (this.failure === 'migrate') throw new Error('migrate');
    return this.migrationResult;
  }

  async validateAndMaterialize(
    input: Readonly<WorkspaceBackupCandidateValidationInput>,
  ): Promise<Readonly<WorkspaceBackupCandidateReadiness>> {
    this.events.push('candidate.validate');
    this.validationInputs.push(input);
    if (this.failure === 'validate') throw new Error('validate');
    return this.readiness;
  }

  async validatePublished(
    input: Readonly<PublishedWorkspaceBackupValidationInput>,
  ): Promise<Readonly<WorkspaceBackupCandidateReadiness>> {
    this.events.push('candidate.validatePublished');
    this.publishedInputs.push(input);
    if (this.failure === 'validatePublished') throw new Error('validate');
    return this.readiness;
  }
}

export type ImportRootFailure =
  | 'createBefore'
  | 'createAfter'
  | 'removeStaging'
  | 'inspectCandidate'
  | 'publishBefore'
  | 'publishAfter'
  | 'inspectPublished'
  | 'cleanupPublished'
  | 'discard';

export class MemoryWorkspaceBackupImportRootStore
  implements WorkspaceBackupImportRootStore {
  candidateExists = false;
  finalExists = false;
  stagingExists = false;
  failure: ImportRootFailure | undefined;

  constructor(private readonly events: string[]) {}

  async createCandidate(): Promise<void> {
    this.events.push('root.createCandidate');
    if (this.failure === 'createBefore') throw new Error('create');
    this.candidateExists = true;
    this.stagingExists = true;
    if (this.failure === 'createAfter') throw new Error('create');
  }

  async removeImportStaging(): Promise<void> {
    this.events.push('root.removeImportStaging');
    if (this.failure === 'removeStaging' || !this.stagingExists) {
      throw new Error('staging');
    }
    this.stagingExists = false;
  }

  async inspectCandidate(): Promise<void> {
    this.events.push('root.inspectCandidate');
    if (
      this.failure === 'inspectCandidate' ||
      !this.candidateExists ||
      this.stagingExists
    ) {
      throw new Error('candidate');
    }
  }

  async publishCandidate(): Promise<void> {
    this.events.push('root.publishCandidate');
    if (this.failure === 'publishBefore') throw new Error('publish');
    this.candidateExists = false;
    this.finalExists = true;
    if (this.failure === 'publishAfter') throw new Error('publish');
  }

  async inspectPublished(): Promise<void> {
    this.events.push('root.inspectPublished');
    if (this.failure === 'inspectPublished' || !this.finalExists) {
      throw new Error('published');
    }
  }

  async cleanupPublishedOperation(): Promise<void> {
    this.events.push('root.cleanupPublishedOperation');
    if (this.failure === 'cleanupPublished') throw new Error('cleanup');
  }

  async readPresence(): Promise<Readonly<WorkspaceBackupImportRootPresence>> {
    this.events.push('root.readPresence');
    return Object.freeze({
      candidateExists: this.candidateExists,
      finalExists: this.finalExists,
    });
  }

  async discardCandidate(): Promise<void> {
    this.events.push('root.discardCandidate');
    if (this.failure === 'discard') throw new Error('discard');
    this.candidateExists = false;
    this.stagingExists = false;
  }
}

export type ImportLifecycleFailure =
  | 'quiesce'
  | 'stopBeforeSideEffect'
  | 'stopAfterSideEffect'
  | 'ensure';

export class RecordingImportActiveWorkspaceLifecycle
  implements ActiveWorkspaceLifecyclePort {
  failure: ImportLifecycleFailure | undefined;
  ensureCalls = 0;
  runningRuntimeOwners = 1;
  openDatabaseHandleOwners = 1;
  maxRunningRuntimeOwners = 1;
  maxOpenDatabaseHandleOwners = 1;

  constructor(private readonly events: string[]) {}

  async quiesceWrites(): Promise<void> {
    this.events.push('lifecycle.quiesce');
    if (this.failure === 'quiesce') throw new Error('quiesce');
  }

  async stopAndProveHandlesClosed(): Promise<{ readonly handlesClosed: true }> {
    this.events.push('lifecycle.stop');
    if (this.failure === 'stopBeforeSideEffect') throw new Error('stop');
    this.runningRuntimeOwners = 0;
    this.openDatabaseHandleOwners = 0;
    if (this.failure === 'stopAfterSideEffect') throw new Error('stop');
    return Object.freeze({ handlesClosed: true });
  }

  async ensurePreviousWorkspaceRunning(
    previousActiveWorkspaceId: WorkspaceId | null,
  ): Promise<void> {
    this.events.push('lifecycle.ensure');
    this.ensureCalls += 1;
    if (this.failure === 'ensure') throw new Error('ensure');
    if (previousActiveWorkspaceId === null) return;
    if (this.runningRuntimeOwners === 0) {
      this.runningRuntimeOwners = 1;
      this.openDatabaseHandleOwners = 1;
    }
    if (
      this.runningRuntimeOwners !== 1 ||
      this.openDatabaseHandleOwners !== 1
    ) {
      throw new Error('runtime-owner');
    }
    this.maxRunningRuntimeOwners = Math.max(
      this.maxRunningRuntimeOwners,
      this.runningRuntimeOwners,
    );
    this.maxOpenDatabaseHandleOwners = Math.max(
      this.maxOpenDatabaseHandleOwners,
      this.openDatabaseHandleOwners,
    );
  }
}

export class RecordingImportRuntimeAbsence
  implements WorkspaceRuntimeAbsencePort {
  state: 'absent' | 'active' | 'unknown' = 'absent';
  assertionCalls = 0;

  constructor(private readonly events: string[]) {}

  async assertNoActiveWorkspaceRuntime(): Promise<void> {
    this.events.push('runtimeAbsence.assert');
    this.assertionCalls += 1;
    if (this.state !== 'absent') throw new Error('runtime');
  }
}
