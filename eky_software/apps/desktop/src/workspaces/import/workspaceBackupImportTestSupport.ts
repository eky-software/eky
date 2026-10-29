import { resolve } from 'node:path';
import type { CrashSafeByteSlotSelection } from '../persistence/crashSafeByteSlotStore.js';
import type { ObservedRecoveryAuthority, ObservedRecoverySelection } from '../persistence/crashSafeObservedRecovery.js';
import { sameCrashSafeFileSlotIdentity, type CrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import { validateWorkspaceRegistry } from '../registry/workspaceRegistryValidation.js';
import { serializeWorkspaceBackupImportJournal } from './workspaceBackupImportJournalSerializer.js';
import { createRecordingImportOwner } from './workspaceBackupImportOwnerTestSupport.js';
import type { ColdImportJournalPort, ColdImportRegistryPort } from './workspaceBackupImportColdOwner.js';

import type {
  WorkspaceMaintenanceLease,
  WorkspaceMaintenanceLeaseHandle,
  WorkspaceMaintenancePurpose,
} from '../maintenance/workspaceMaintenanceLease.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import type {
  LocalWorkspaceRegistry,
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
  WorkspaceImportMutationAuthority,
} from './workspaceBackupImportRootStore.js';
import type { WorkspaceBackupImportPaths } from './workspaceBackupImportPaths.js';
import type { WorkspaceBackupImportOwner } from './workspaceBackupImportOwner.js';
import type {
  WorkspaceBackupImportJournalStore,
  WorkspaceBackupImportJournal,
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
    readonly userDataRoot?: string;
    readonly decorateOwner?: (owner: WorkspaceBackupImportOwner) => WorkspaceBackupImportOwner;
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
  const captureOwner = createRecordingImportOwner({ events, lease, journal, registry, root, lifecycle, runtimeAbsence });
  const coordinator = new WorkspaceBackupImportCoordinator({
    captureImportOwner(held) { const owner = captureOwner(held); return options.decorateOwner?.(owner) ?? owner; },
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
    userDataRoot: options.userDataRoot ?? TEST_IMPORT_USER_DATA_ROOT,
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
  readonly state: WorkspaceBackupImportJournal['state'];
  readonly previousActiveWorkspaceId?: WorkspaceId | null;
  readonly workspaceId?: WorkspaceId;
  readonly profileId?: string;
}): Readonly<WorkspaceBackupImportJournal> {
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
  failRelease = false;
  private handle: WorkspaceMaintenanceLeaseHandle | undefined;

  constructor(private readonly events: string[]) {}

  async acquire(
    purpose: WorkspaceMaintenancePurpose,
  ): Promise<WorkspaceMaintenanceLeaseHandle> {
    this.events.push(`lease.acquire.${purpose}`);
    if (this.held) throw new Error('busy');
    this.held = true;
    let released = false;
    const handle = {
      release: async () => {
        if (released) return;
        released = true;
        this.held = false;
        this.handle = undefined;
        this.events.push('lease.release');
        if (this.failRelease) throw new Error('SYNTHETIC_IMPORT_RELEASE_FAILED');
      },
    };
    this.handle = handle;
    return handle;
  }

  captureCurrentOwner(expected: WorkspaceMaintenanceLeaseHandle): () => void {
    if (!this.held || this.handle !== expected) throw new Error('SYNTHETIC_IMPORT_LEASE_INVALID');
    return () => { if (!this.held || this.handle !== expected) throw new Error('SYNTHETIC_IMPORT_LEASE_INVALID'); };
  }
}

export class MemoryWorkspaceBackupImportJournal
  implements WorkspaceBackupImportJournalStore, ColdImportJournalPort {
  current: Readonly<WorkspaceBackupImportJournal> | undefined;
  readonly states: WorkspaceBackupImportJournal['state'][] = [];
  readonly writes: Readonly<WorkspaceBackupImportJournal>[] = [];
  failBeforeState: WorkspaceBackupImportJournal['state'] | undefined;
  failAfterState: WorkspaceBackupImportJournal['state'] | undefined;
  failDiscard = false;
  failRemove = false;
  revision = 1;

  constructor(
    private readonly events: string[],
    initial?: Readonly<WorkspaceBackupImportJournal>,
  ) {
    this.current = initial;
  }

  async read(): Promise<Readonly<WorkspaceBackupImportJournal> | undefined> {
    this.events.push('journal.read');
    return this.current;
  }

  async write(value: unknown): Promise<void> {
    const next = validateWorkspaceBackupImportJournal(value);
    this.events.push(`journal.write.${next.state}`);
    if (this.failBeforeState === next.state) throw new Error('journal');
    assertWorkspaceBackupImportJournalTransition(this.current, next);
    this.current = next;
    this.revision++;
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
    this.revision++;
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
    this.revision++;
  }

  async inspectSlots(assertCurrent?: () => void) {
    assertCurrent?.(); this.events.push('journal.inspect');
    const current = this.current === undefined ? undefined : { value: this.current,
      bytes: serializeWorkspaceBackupImportJournal(this.current), identity: memoryImportIdentity(this.revision, serializeWorkspaceBackupImportJournal(this.current).byteLength) };
    assertCurrent?.(); return { current, next: undefined, backup: undefined };
  }

  inspectRecoverySelection(assertCurrent: () => void) {
    return inspectMemoryImportRecoverySelection(check => this.inspectSlots(check), assertCurrent);
  }

  recoverObservedSelection(selection: ObservedRecoverySelection, authority: ObservedRecoveryAuthority) {
    return recoverMemoryImportObservedSelection(() => this.inspectSlots(), selection, authority);
  }

  async writeSelected(value: unknown, selection: CrashSafeByteSlotSelection) {
    const next = validateWorkspaceBackupImportJournal(value);
    await assertMemorySelection(() => this.inspectSlots(), selection);
    const identity = memoryImportIdentity(this.revision + 1, serializeWorkspaceBackupImportJournal(next).byteLength);
    await this.write(next);
    selection.assertAuthority(); await selection.assertExternalSelection(); selection.assertAuthority();
    if (!this.current || this.revision !== identity.ino) throw new Error('SYNTHETIC_JOURNAL_RECEIPT_INVALID');
    return identity;
  }

  async removeSelected(operationId: WorkspaceBackupImportOperationId, selection: CrashSafeByteSlotSelection) {
    await assertMemorySelection(() => this.inspectSlots(), selection);
    await this.remove(operationId);
    selection.assertAuthority(); await selection.assertExternalSelection(); selection.assertAuthority();
  }

  async discardBeforePublicationSelected(operationId: WorkspaceBackupImportOperationId, selection: CrashSafeByteSlotSelection) {
    await assertMemorySelection(() => this.inspectSlots(), selection);
    await this.discardBeforePublication(operationId);
    selection.assertAuthority(); await selection.assertExternalSelection(); selection.assertAuthority();
  }
}

export class MemoryWorkspaceBackupImportRegistry
  implements WorkspaceRegistryPort, ColdImportRegistryPort {
  failRead = false;
  failWriteBefore = false;
  failWriteAfter = false;
  readonly writes: Readonly<LocalWorkspaceRegistry>[] = [];
  revision = 1;

  constructor(
    private readonly events: string[],
    public value: Readonly<LocalWorkspaceRegistry> | undefined,
  ) {}

  async read(): Promise<Readonly<LocalWorkspaceRegistry> | undefined> {
    this.events.push('registry.read');
    if (this.failRead) throw new Error('registry');
    return this.value;
  }

  async write(value: unknown): Promise<void> {
    this.events.push('registry.write');
    if (this.failWriteBefore) throw new Error('registry');
    this.value = value as Readonly<LocalWorkspaceRegistry>;
    this.revision++;
    this.writes.push(this.value);
    if (this.failWriteAfter) throw new Error('registry');
  }

  async inspectSlots(assertCurrent?: () => void) {
    assertCurrent?.(); this.events.push('registry.inspect');
    if (this.failRead) throw new Error('registry');
    const current = this.value === undefined ? undefined : { value: this.value, bytes: serializeWorkspaceRegistry(this.value),
      identity: memoryImportIdentity(this.revision, serializeWorkspaceRegistry(this.value).byteLength) };
    assertCurrent?.(); return { current, next: undefined, backup: undefined };
  }

  inspectRecoverySelection(assertCurrent: () => void) {
    return inspectMemoryImportRecoverySelection(check => this.inspectSlots(check), assertCurrent);
  }

  recoverObservedSelection(selection: ObservedRecoverySelection, authority: ObservedRecoveryAuthority) {
    return recoverMemoryImportObservedSelection(() => this.inspectSlots(), selection, authority);
  }

  async writeSelected(value: unknown, selection: CrashSafeByteSlotSelection) {
    const next = validateWorkspaceRegistry(value);
    await assertMemorySelection(() => this.inspectSlots(), selection);
    if (this.value?.formatVersion === 2 && next.formatVersion === 1) throw new Error('registry');
    const bytes = serializeWorkspaceRegistry(next);
    const identity = memoryImportIdentity(this.revision + 1, bytes.byteLength);
    await this.write(next);
    selection.assertAuthority(); await selection.assertExternalSelection(); selection.assertAuthority();
    if (!this.value || !sameCrashSafeFileSlotIdentity(identity, memoryImportIdentity(this.revision, serializeWorkspaceRegistry(this.value).byteLength)) ||
        !Buffer.from(bytes).equals(Buffer.from(serializeWorkspaceRegistry(this.value)))) throw new Error('SYNTHETIC_REGISTRY_RECEIPT_INVALID');
    return identity;
  }
}

export function memoryImportIdentity(revision: number, size: number): Readonly<CrashSafeFileSlotIdentity> {
  return Object.freeze({ dev: 1, ino: revision, size, mtimeMs: revision, ctimeMs: revision });
}

type MemoryImportSlots<T> = Readonly<Record<keyof ObservedRecoverySelection['identities'],
  Readonly<{ value: T; bytes: Uint8Array; identity: Readonly<CrashSafeFileSlotIdentity> }> | undefined>>;

// Clean-current model only. Real side-slot repair remains a file-store test concern.
async function inspectMemoryImportRecoverySelection<T>(
  read: (assertCurrent: () => void) => Promise<MemoryImportSlots<T>>,
  assertCurrent: () => void,
): Promise<ObservedRecoverySelection & Readonly<{ value: T | undefined }>> {
  assertCurrent();
  const slots = await read(assertCurrent);
  assertCurrent();
  if (slots.next !== undefined || slots.backup !== undefined) throw new Error('SYNTHETIC_IMPORT_SIDE_SLOTS_UNSUPPORTED');
  const current = slots.current;
  return Object.freeze({
    source: current === undefined ? undefined : 'current',
    bytes: current === undefined ? undefined : Uint8Array.from(current.bytes),
    identities: Object.freeze({ current: current === undefined ? undefined : Object.freeze({ ...current.identity }), next: undefined, backup: undefined }),
    value: current?.value,
  });
}

async function recoverMemoryImportObservedSelection<T>(
  read: () => Promise<MemoryImportSlots<T>>,
  observation: ObservedRecoverySelection,
  authority: ObservedRecoveryAuthority,
) {
  const assertAuthority = authority.assertAuthority.bind(authority);
  const assertExternalSelection = authority.assertExternalSelection.bind(authority);
  const onUncertain = authority.onUncertain.bind(authority);
  try {
    assertAuthority();
    if (observation.source !== 'current' || observation.bytes === undefined || observation.identities.current === undefined ||
        observation.identities.next !== undefined || observation.identities.backup !== undefined ||
        observation.identities.current.ino === 0 || observation.bytes.byteLength < 1 ||
        observation.bytes.byteLength !== observation.identities.current.size) throw new Error('SYNTHETIC_SELECTED_JOURNAL_CHANGED');
    const bytes = Uint8Array.from(observation.bytes);
    const identity = Object.freeze({ ...observation.identities.current });
    const selection = { assertAuthority, assertExternalSelection,
      expectedSlots: { current: bytes, next: undefined, backup: undefined },
      expectedIdentities: { current: identity, next: undefined, backup: undefined } };
    await assertMemorySelection(read, selection);
    const slots = await assertMemorySelection(read, selection);
    assertAuthority();
    if (slots.current === undefined) throw new Error('SYNTHETIC_SELECTED_JOURNAL_CHANGED');
    return Object.freeze({ bytes, identity, value: slots.current.value });
  } catch (error) {
    try { onUncertain(error); } catch { /* Preserve the recovery failure. */ }
    throw error;
  }
}

async function assertMemorySelection<T>(read: () => Promise<MemoryImportSlots<T>>, selection: CrashSafeByteSlotSelection) {
  selection.assertAuthority(); await selection.assertExternalSelection(); selection.assertAuthority();
  const slots = await read(); selection.assertAuthority();
  if (slots.next !== undefined || slots.backup !== undefined ||
      selection.expectedSlots.next !== undefined || selection.expectedSlots.backup !== undefined ||
      selection.expectedIdentities.next !== undefined || selection.expectedIdentities.backup !== undefined ||
      (slots.current === undefined ? selection.expectedSlots.current !== undefined || selection.expectedIdentities.current !== undefined :
        selection.expectedSlots.current === undefined || selection.expectedIdentities.current === undefined ||
        !Buffer.from(slots.current.bytes).equals(Buffer.from(selection.expectedSlots.current)) ||
        !sameCrashSafeFileSlotIdentity(slots.current.identity, selection.expectedIdentities.current))) throw new Error('SYNTHETIC_SELECTED_JOURNAL_CHANGED');
  return slots;
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
  operationExists = false;
  failure: ImportRootFailure | undefined;

  constructor(private readonly events: string[]) {}

  async createCandidate(_paths?: Readonly<WorkspaceBackupImportPaths>, authority?: Readonly<WorkspaceImportMutationAuthority>): Promise<void> {
    await authority?.assertCurrent(); authority?.assertMutationCurrent();
    this.events.push('root.createCandidate');
    if (this.failure === 'createBefore') throw new Error('create');
    this.candidateExists = true;
    this.operationExists = true;
    this.stagingExists = true;
    if (this.failure === 'createAfter') throw new Error('create');
  }

  async removeImportStaging(_paths?: Readonly<WorkspaceBackupImportPaths>, authority?: Readonly<WorkspaceImportMutationAuthority>): Promise<void> {
    await authority?.assertCurrent(); authority?.assertMutationCurrent();
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

  async publishCandidate(_paths?: Readonly<WorkspaceBackupImportPaths>, authority?: Readonly<WorkspaceImportMutationAuthority>): Promise<void> {
    await authority?.assertCurrent(); authority?.assertMutationCurrent();
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

  async cleanupPublishedOperation(_paths?: Readonly<WorkspaceBackupImportPaths>, authority?: Readonly<WorkspaceImportMutationAuthority>): Promise<void> {
    await authority?.assertCurrent(); authority?.assertMutationCurrent();
    this.events.push('root.cleanupPublishedOperation');
    if (this.failure === 'cleanupPublished') throw new Error('cleanup');
    this.operationExists = false;
  }

  async readPresence(): Promise<Readonly<WorkspaceBackupImportRootPresence>> {
    this.events.push('root.readPresence');
    return Object.freeze({
      candidateExists: this.candidateExists,
      finalExists: this.finalExists,
    });
  }

  async discardCandidate(_paths?: Readonly<WorkspaceBackupImportPaths>, authority?: Readonly<WorkspaceImportMutationAuthority>): Promise<void> {
    await authority?.assertCurrent(); authority?.assertMutationCurrent();
    this.events.push('root.discardCandidate');
    if (this.failure === 'discard') throw new Error('discard');
    this.candidateExists = false;
    this.stagingExists = false;
    this.operationExists = false;
  }

  async assertOperationAbsent(_paths: unknown, assertAuthority: () => void): Promise<void> {
    assertAuthority();
    this.events.push('root.assertOperationAbsent');
    if (this.operationExists || this.candidateExists || this.stagingExists) throw new Error('operation-remains');
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
  private returnWorkspaceId: WorkspaceId | null = null;

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
    this.returnWorkspaceId = this.runningRuntimeOwners === 0 ? previousActiveWorkspaceId : null;
  }

  completeReturn(): void {
    const previousActiveWorkspaceId = this.returnWorkspaceId;
    this.returnWorkspaceId = null;
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
