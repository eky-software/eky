import { describe, expect, it, vi } from 'vitest';

import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { WorkspaceActivationMigrationError } from './workspaceActivationMigrationError.js';
import { WorkspaceActivationMigrationStartup } from './workspaceActivationMigrationStartup.js';

const operationId = validateWorkspaceBackupImportOperationId(
  '123e4567-e89b-42d3-a456-426614174000',
);
const sourceWorkspaceId = validateWorkspaceId(
  '11111111-1111-4111-8111-111111111111',
);
const targetWorkspaceId = validateWorkspaceId(
  '22222222-2222-4222-8222-222222222222',
);
const profileId = 'b'.repeat(64);
const migrationChainIdentity = 'c'.repeat(64);

describe('workspace activation migration startup', () => {
  it('does not inspect a normal workspace activation', async () => {
    const fixture = createFixture({ mode: 'normal' });

    await expect(fixture.startup.prepareBeforeBackend()).resolves.toEqual({
      migrationStartupPolicy: 'exactCurrentManifest',
      status: 'notRequired',
    });

    expect(fixture.inspect).not.toHaveBeenCalled();
    expect(fixture.validateHistorical).not.toHaveBeenCalled();
  });

  it('keeps a current target on the exact migration policy without writes', async () => {
    const fixture = createFixture({ inspectionStatus: 'current' });

    await expect(fixture.startup.prepareBeforeBackend()).resolves.toEqual({
      migrationStartupPolicy: 'exactCurrentManifest',
      status: 'notRequired',
    });

    expect(fixture.prove).not.toHaveBeenCalled();
    expect(fixture.validateHistorical).not.toHaveBeenCalled();
    expect(fixture.rejectInvalidTarget).not.toHaveBeenCalled();
  });

  it('isolates invalid history and requests a relaunch without opening the target backend', async () => {
    const fixture = createFixture({ inspectionStatus: 'invalidHistory' });

    await expect(fixture.startup.prepareBeforeBackend()).resolves.toEqual({
      status: 'relaunchRequired',
    });

    expect(fixture.rejectInvalidTarget).toHaveBeenCalledOnce();
    expect(fixture.requestRelaunch).toHaveBeenCalledOnce();
    expect(fixture.validateHistorical).not.toHaveBeenCalled();
    expect(fixture.migrateAndActivate).not.toHaveBeenCalled();
  });

  it('fails closed when invalid history cannot be returned to the source', async () => {
    const fixture = createFixture({
      inspectionStatus: 'invalidHistory',
      rejectOutcome: 'recoveryRequired',
    });

    await expect(
      fixture.startup.prepareBeforeBackend(),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
    });
    expect(fixture.requestRelaunch).not.toHaveBeenCalled();
  });

  it('migrates only after the backend proves the same historical chain', async () => {
    const fixture = createFixture({ inspectionStatus: 'compatiblePending' });

    await expect(fixture.startup.prepareBeforeBackend()).resolves.toEqual({
      migrationStartupPolicy: 'restoreCompatible',
      status: 'migrationRequired',
    });
    await expect(
      fixture.startup.beforeMigrations(createBackendInspection(), {
        stopStartupRuntime: fixture.stopStartupRuntime,
      }),
    ).resolves.toBe('relaunchRequired');

    expect(fixture.validateHistorical).toHaveBeenCalledOnce();
    expect(fixture.stopStartupRuntime).toHaveBeenCalledOnce();
    expect(fixture.markTargetRuntimeStopped).toHaveBeenCalledOnce();
    expect(fixture.migrateAndActivate).toHaveBeenCalledWith({
      expectedSourceMigrationChainIdentity: migrationChainIdentity,
      proof: expect.objectContaining({ operationId, profileId }),
      stopTargetStartupRuntime: expect.any(Function),
    });
  });

  it('does not mark the runtime stopped when the stop operation fails', async () => {
    const fixture = createFixture({ inspectionStatus: 'compatiblePending' });
    fixture.stopStartupRuntime.mockRejectedValueOnce(new Error('private'));

    await fixture.startup.prepareBeforeBackend();
    await expect(
      fixture.startup.beforeMigrations(createBackendInspection(), {
        stopStartupRuntime: fixture.stopStartupRuntime,
      }),
    ).rejects.toThrow('private');

    expect(fixture.markTargetRuntimeStopped).not.toHaveBeenCalled();
  });

  it('rejects changed backend migration evidence before migration side effects', async () => {
    const fixture = createFixture({ inspectionStatus: 'compatiblePending' });

    await fixture.startup.prepareBeforeBackend();
    await expect(
      fixture.startup.beforeMigrations(
        { ...createBackendInspection(), pendingMigrationCount: 3 },
        { stopStartupRuntime: fixture.stopStartupRuntime },
      ),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
    });

    expect(fixture.migrateAndActivate).not.toHaveBeenCalled();
    expect(fixture.stopStartupRuntime).not.toHaveBeenCalled();
  });

  it('rejects repeated preparation and migration attempts', async () => {
    const fixture = createFixture({ inspectionStatus: 'compatiblePending' });

    await fixture.startup.prepareBeforeBackend();
    await expect(fixture.startup.prepareBeforeBackend()).rejects.toBeInstanceOf(
      WorkspaceActivationMigrationError,
    );
    await fixture.startup.beforeMigrations(createBackendInspection(), {
      stopStartupRuntime: fixture.stopStartupRuntime,
    });
    await expect(
      fixture.startup.beforeMigrations(createBackendInspection(), {
        stopStartupRuntime: fixture.stopStartupRuntime,
      }),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
    });
  });
});

function createFixture(options: {
  inspectionStatus?: 'compatiblePending' | 'current' | 'invalidHistory';
  mode?: 'normal' | 'targetValidation';
  rejectOutcome?: 'recoveryRequired' | 'relaunchRequired';
} = {}) {
  const inspectionStatus = options.inspectionStatus ?? 'compatiblePending';
  const inspect = vi.fn(async () => ({
    appliedMigrationCount: 38,
    pendingMigrationCount: inspectionStatus === 'compatiblePending' ? 2 : 0,
    status: inspectionStatus,
  }));
  const rejectInvalidTarget = vi.fn(
    async () => options.rejectOutcome ?? ('relaunchRequired' as const),
  );
  const requestRelaunch = vi.fn();
  const prove = vi.fn(async () => ({
    operationId,
    profileId,
    registrySnapshot: new Uint8Array([1]),
    sourceWorkspaceId,
    switchJournalSnapshot: new Uint8Array([2]),
    targetWorkspaceId,
  }));
  const validateHistorical = vi.fn(async () => ({
    actorId: 'local-owner' as const,
    artifactRootHealth: 'ready' as const,
    companyId: 'dev-company',
    databaseHealth: 'healthy' as const,
    foreignKeyHealth: 'healthy' as const,
    handlesClosed: true as const,
    lineageIdentity: { formatVersion: 1 as const, profileId },
    migrationChainIdentity,
    migrationState: 'compatiblePending' as const,
  }));
  const stopStartupRuntime = vi.fn(async () => undefined);
  const markTargetRuntimeStopped = vi.fn();
  const migrateAndActivate = vi.fn(async (input) => {
    await input.stopTargetStartupRuntime();
    return 'relaunchRequired' as const;
  });
  const startup = new WorkspaceActivationMigrationStartup({
    activeWorkspace: {
      mode: options.mode ?? 'targetValidation',
      rejectInvalidTarget,
      ...(options.mode === 'normal'
        ? {}
        : {
            switchContext: {
              operationId,
              sourceWorkspaceId,
              targetProfileId: profileId,
              targetWorkspaceId,
            },
          }),
      workspaceId:
        options.mode === 'normal' ? sourceWorkspaceId : targetWorkspaceId,
      workspaceRoot: 'C:\\private\\workspace',
    },
    coordinator: { migrateAndActivate },
    guard: { prove },
    historicalValidation: {
      validateHistoricalPublished: validateHistorical,
    },
    inspector: { inspect },
    markTargetRuntimeStopped,
    publishedValidationInput: {
      artifactRoot: 'C:\\private\\workspace\\documents',
      databaseFilePath: 'C:\\private\\workspace\\profile.sqlite',
      expectedProfileId: profileId,
      publishedRoot: 'C:\\private\\workspace',
    },
    requestRelaunch,
    userDataRoot: 'C:\\private',
  });

  return {
    inspect,
    markTargetRuntimeStopped,
    migrateAndActivate,
    prove,
    rejectInvalidTarget,
    requestRelaunch,
    startup,
    stopStartupRuntime,
    validateHistorical,
  };
}

function createBackendInspection() {
  return {
    appliedMigrationCount: 38,
    migrationChainIdentity,
    pendingMigrationCount: 2,
    profileState: 'existing' as const,
  };
}
