import { resolve } from 'node:path';

import type { ProfileRestoreActivationJournal } from '../../profileBackup/restore/profileRestoreActivationJournal.js';
import type { LocalWorkspaceRegistryV1, WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import { createReadyWorkspaceEntry } from '../registry/workspaceRegistryMutations.js';
import type { WorkspaceBackupCandidateReadiness } from '../import/workspaceBackupImportPorts.js';
import { WorkspaceBackupReplacementCoordinator } from './workspaceBackupReplacementCoordinator.js';
import type { WorkspaceBackupReplacementOperationId } from './workspaceBackupReplacementOperationId.js';

export const TEST_REPLACEMENT_WORKSPACE_ID =
  '11111111-1111-4111-8111-111111111111' as WorkspaceId;
export const TEST_REPLACEMENT_OTHER_WORKSPACE_ID =
  '22222222-2222-4222-8222-222222222222' as WorkspaceId;
export const TEST_REPLACEMENT_OPERATION_ID =
  '33333333-3333-4333-8333-333333333333' as WorkspaceBackupReplacementOperationId;
export const TEST_REPLACEMENT_PROFILE_ID = 'a'.repeat(64);
export const TEST_REPLACEMENT_MIGRATION_ID = 'b'.repeat(64);
export const TEST_REPLACEMENT_CONTAINER_HASH = 'c'.repeat(64);
export const TEST_REPLACEMENT_PASSWORD = 'synthetic-test-password';
export const TEST_REPLACEMENT_CONTAINER_PATH = 'D:\\private\\synthetic.ekybackup';
const TEST_REPLACEMENT_USER_DATA_ROOT = resolve(
  'synthetic-workspace-replacement-user-data',
);

export function createWorkspaceBackupReplacementFixture(options?: {
  readonly activeWorkspaceId?: WorkspaceId | null;
  readonly duplicateLineage?: boolean;
  readonly lifecycleState?: 'ready' | 'recoveryRequired';
  readonly profileId?: string;
}) {
  const events: string[] = [];
  const targetProfileId = options?.profileId ?? TEST_REPLACEMENT_PROFILE_ID;
  const targetEntry = createReadyWorkspaceEntry({
    workspaceId: TEST_REPLACEMENT_WORKSPACE_ID,
    workspaceLabel: 'Sama yritys',
    lineageIdentity: { formatVersion: 1, profileId: targetProfileId },
    createdAt: '2026-08-19T00:00:00.000Z',
  });
  const duplicateEntry = createReadyWorkspaceEntry({
    workspaceId: TEST_REPLACEMENT_OTHER_WORKSPACE_ID,
    workspaceLabel: 'Sama yritys',
    lineageIdentity: {
      formatVersion: 1,
      profileId: options?.duplicateLineage
        ? targetProfileId
        : 'd'.repeat(64),
    },
    createdAt: '2026-08-19T00:01:00.000Z',
  });
  const registry = {
    value: Object.freeze({
      formatVersion: 1 as const,
      activeWorkspaceId:
        options?.activeWorkspaceId === undefined
          ? TEST_REPLACEMENT_WORKSPACE_ID
          : options.activeWorkspaceId,
      workspaces: Object.freeze([
        Object.freeze({
          ...targetEntry,
          lifecycleState: options?.lifecycleState ?? 'ready',
        }),
        duplicateEntry,
      ]),
    }) as Readonly<LocalWorkspaceRegistryV1>,
    reads: 0,
    async read() {
      events.push('registry.read');
      this.reads += 1;
      return this.value;
    },
  };
  const guard = {
    fail: false,
    async assertNoUnresolvedOperations() {
      events.push('guard.assert');
      if (this.fail) throw new Error('private guard detail');
    },
  };
  const container = {
    inspectCalls: 0,
    stageCalls: 0,
    failInspect: false,
    failStage: false,
    stageAppVersion: '0.2.6',
    stageContainerHash: TEST_REPLACEMENT_CONTAINER_HASH,
    async inspect() {
      events.push('backup.inspect');
      this.inspectCalls += 1;
      if (this.failInspect) throw new Error('private backup detail');
      return preflight();
    },
    async stage() {
      events.push('backup.stage');
      this.stageCalls += 1;
      if (this.failStage) throw new Error('private stage detail');
      return preflight({
        appVersion: this.stageAppVersion,
        containerSha256: this.stageContainerHash,
      });
    },
  };
  const lease = {
    held: false,
    fail: false,
    async acquire(purpose: string) {
      events.push(`lease.acquire.${purpose}`);
      if (this.fail) throw new Error('busy');
      this.held = true;
      return {
        release: async () => {
          events.push('lease.release');
          this.held = false;
        },
      };
    },
  };
  const lifecycle = {
    runningOwners: 1,
    sqliteOwners: 1,
    maxRunningOwners: 1,
    maxSqliteOwners: 1,
    failEnsure: false,
    async quiesceWrites() {
      events.push('lifecycle.quiesce');
    },
    async stopAndProveHandlesClosed() {
      events.push('lifecycle.stop');
      this.runningOwners = 0;
      this.sqliteOwners = 0;
      return { handlesClosed: true as const };
    },
    async ensurePreviousWorkspaceRunning() {
      events.push('lifecycle.ensure');
      if (this.failEnsure) throw new Error('private restart detail');
      this.runningOwners = 1;
      this.sqliteOwners = 1;
      this.maxRunningOwners = Math.max(
        this.maxRunningOwners,
        this.runningOwners,
      );
      this.maxSqliteOwners = Math.max(
        this.maxSqliteOwners,
        this.sqliteOwners,
      );
    },
  };
  const runtimeAbsence = {
    async assertNoActiveWorkspaceRuntime() {
      events.push('runtime.absent');
      if (lifecycle.runningOwners !== 0 || lifecycle.sqliteOwners !== 0) {
        throw new Error('runtime present');
      }
    },
  };
  const preRestore = {
    fail: false,
    calls: 0,
    async createPreRestore() {
      events.push('recoveryPoint.preRestore');
      this.calls += 1;
      if (this.fail) throw new Error('private recovery detail');
    },
  };
  const rootStore = {
    prepared: false,
    discarded: false,
    fail: undefined as 'prepare' | 'inspect' | undefined,
    async prepareCandidate() {
      events.push('root.prepare');
      if (this.fail === 'prepare') throw new Error('private root detail');
      this.prepared = true;
    },
    async removeImportStaging() {
      events.push('root.removeImportStaging');
    },
    async inspectCandidate() {
      events.push('root.inspectCandidate');
      if (this.fail === 'inspect') throw new Error('private root detail');
    },
    async discardBeforeActivation() {
      events.push('root.discard');
      this.discarded = true;
    },
  };
  const candidate = {
    failure: undefined as 'migration' | 'validation' | undefined,
    async migrate() {
      events.push('candidate.migrate');
      if (this.failure === 'migration') throw new Error('private migration');
      return {
        handlesClosed: true as const,
        migrationChainIdentity: TEST_REPLACEMENT_MIGRATION_ID,
        profileId: TEST_REPLACEMENT_PROFILE_ID,
      };
    },
    async validateAndMaterialize() {
      events.push('candidate.validate');
      if (this.failure === 'validation') throw new Error('private validation');
      return readiness();
    },
    async validatePublished() {
      throw new Error('not used');
    },
  };
  const activation = {
    journal: undefined as ProfileRestoreActivationJournal | undefined,
    fail: undefined as 'prepare' | 'replace' | 'accept' | 'rollback' | undefined,
    async read() {
      events.push('activationJournal.read');
      return this.journal;
    },
    async prepare(operationId: string) {
      events.push('activation.prepare');
      this.journal = {
        formatVersion: 1,
        hadActiveDatabase: true,
        hadActiveDocuments: true,
        operationId,
        phase: 'prepared',
        revision: 0,
      };
      if (this.fail === 'prepare') throw new Error('private activation');
    },
    async advanceToValidation() {
      events.push('activation.replace');
      if (this.fail === 'replace') throw new Error('private activation');
      if (this.journal === undefined) throw new Error('missing');
      this.journal = {
        ...this.journal,
        phase: 'validationStarting',
        revision: this.journal.revision + 1,
      };
      return this.journal;
    },
    async accept() {
      events.push('activation.accept');
      if (this.fail === 'accept') throw new Error('private activation');
      this.journal = undefined;
    },
    async rollback() {
      events.push('activation.rollback');
      if (this.fail === 'rollback') throw new Error('private rollback');
      if (this.journal === undefined) throw new Error('missing');
      this.journal = {
        ...this.journal,
        phase: 'rolledBack',
        revision: this.journal.revision + 1,
      };
      return this.journal;
    },
    async clearRolledBack() {
      events.push('activation.clearRolledBack');
      this.journal = undefined;
    },
  };
  const runtimeReadiness = {
    fail: false,
    calls: 0,
    async assertReady(input: {
      expectedMigrationChainIdentity?: string;
      expectedProfileId: string;
      workspaceId: WorkspaceId;
    }) {
      events.push('runtime.validate');
      this.calls += 1;
      if (this.fail && this.calls === 1) {
        throw new Error('private runtime detail');
      }
      return {
        artifactRootHealth: 'ready' as const,
        backendOwnerCount: 1 as const,
        databaseHealth: 'healthy' as const,
        foreignKeyHealth: 'healthy' as const,
        migrationChainIdentity:
          input.expectedMigrationChainIdentity ??
          TEST_REPLACEMENT_MIGRATION_ID,
        profileId: input.expectedProfileId,
        runtimeSessionState: 'rotated' as const,
        sqliteOwnerCount: 1 as const,
        workspaceId: input.workspaceId,
      };
    },
  };

  const coordinator = new WorkspaceBackupReplacementCoordinator({
    activationAuthorityFactory: {
      create() {
        events.push('activationFactory.create');
        return {
          journalStore: activation,
          transaction: activation,
        };
      },
    },
    activeWorkspaceLifecycle: lifecycle,
    backupCandidate: candidate,
    backupContainer: container,
    generateOperationId: () => TEST_REPLACEMENT_OPERATION_ID,
    maintenanceLease: lease,
    operationGuard: guard,
    preRestoreRecoveryPoint: preRestore,
    registry,
    rootStore,
    runtimeReadiness,
    userDataRoot: TEST_REPLACEMENT_USER_DATA_ROOT,
    workspaceRuntimeAbsence: runtimeAbsence,
  });

  return {
    activation,
    candidate,
    container,
    coordinator,
    events,
    guard,
    lease,
    lifecycle,
    preRestore,
    registry,
    rootStore,
    runtimeReadiness,
  };
}

export function preflight(overrides?: Partial<{
  appVersion: string;
  containerSha256: string;
  migrationChainIdentity: string;
  profileId: string;
}>) {
  return Object.freeze({
    appVersion: '0.2.6',
    containerSha256: TEST_REPLACEMENT_CONTAINER_HASH,
    migrationChainIdentity: TEST_REPLACEMENT_MIGRATION_ID,
    profileId: TEST_REPLACEMENT_PROFILE_ID,
    ...overrides,
  });
}

export function readiness(
  overrides?: Partial<WorkspaceBackupCandidateReadiness>,
): Readonly<WorkspaceBackupCandidateReadiness> {
  return Object.freeze({
    actorId: 'local-owner',
    artifactRootHealth: 'ready',
    companyId: 'dev-company',
    databaseHealth: 'healthy',
    foreignKeyHealth: 'healthy',
    handlesClosed: true,
    lineageIdentity: {
      formatVersion: 1 as const,
      profileId: TEST_REPLACEMENT_PROFILE_ID,
    },
    migrationChainIdentity: TEST_REPLACEMENT_MIGRATION_ID,
    migrationState: 'current',
    ...overrides,
  });
}
