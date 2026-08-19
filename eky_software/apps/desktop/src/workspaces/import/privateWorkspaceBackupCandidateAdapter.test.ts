import { describe, expect, it } from 'vitest';

import {
  PrivateWorkspaceBackupCandidateAdapter,
  type PrivateWorkspaceBackupCandidateRuntime,
} from './privateWorkspaceBackupCandidateAdapter.js';
import {
  createTestImportReadiness,
  TEST_IMPORT_CURRENT_MIGRATION_ID,
  TEST_IMPORT_OPERATION_ID,
  TEST_IMPORT_PROFILE_ID,
  TEST_IMPORT_SOURCE_MIGRATION_ID,
  TEST_IMPORT_WORKSPACE_ID,
} from './workspaceBackupImportTestSupport.js';

const migrationInput = Object.freeze({
  operationId: TEST_IMPORT_OPERATION_ID,
  workspaceId: TEST_IMPORT_WORKSPACE_ID,
  candidateRoot: 'candidate',
  importStagingRoot: 'staging',
  databaseFilePath: 'database',
  artifactRoot: 'artifacts',
  expectedProfileId: TEST_IMPORT_PROFILE_ID,
  expectedSourceMigrationChainIdentity: TEST_IMPORT_SOURCE_MIGRATION_ID,
});

const validationInput = Object.freeze({
  operationId: TEST_IMPORT_OPERATION_ID,
  workspaceId: TEST_IMPORT_WORKSPACE_ID,
  candidateRoot: 'candidate',
  importStagingRoot: 'staging',
  databaseFilePath: 'database',
  artifactRoot: 'artifacts',
  expectedProfileId: TEST_IMPORT_PROFILE_ID,
});

describe('PrivateWorkspaceBackupCandidateAdapter', () => {
  it('closes the private migration runtime before reading its result', async () => {
    const events: string[] = [];
    const adapter = new PrivateWorkspaceBackupCandidateAdapter({
      startMigration: async () => migrationRuntime(events),
      startValidation: async () => readinessRuntime(events),
      startPublishedValidation: async () => readinessRuntime(events),
    });

    await expect(adapter.migrate(migrationInput)).resolves.toEqual({
      handlesClosed: true,
      migrationChainIdentity: TEST_IMPORT_CURRENT_MIGRATION_ID,
      profileId: TEST_IMPORT_PROFILE_ID,
    });
    expect(events).toEqual(['runtime.stop', 'migration.inspect']);
  });

  it('uses separate private validation entrypoints for candidate and published roots', async () => {
    const events: string[] = [];
    const readiness = createTestImportReadiness();
    const adapter = new PrivateWorkspaceBackupCandidateAdapter({
      startMigration: async () => migrationRuntime(events),
      startValidation: async () => {
        events.push('candidate.start');
        return readinessRuntime(events, readiness);
      },
      startPublishedValidation: async () => {
        events.push('published.start');
        return readinessRuntime(events, readiness);
      },
    });

    await expect(
      adapter.validateAndMaterialize(validationInput),
    ).resolves.toEqual(readiness);
    await expect(
      adapter.validatePublished({
        ...validationInput,
        publishedRoot: validationInput.candidateRoot,
      }),
    ).resolves.toEqual(readiness);
    expect(events).toEqual([
      'candidate.start',
      'runtime.stop',
      'readiness.inspect',
      'published.start',
      'runtime.stop',
      'readiness.inspect',
    ]);
  });

  it('fails closed when the runtime cannot prove closed handles', async () => {
    const adapter = new PrivateWorkspaceBackupCandidateAdapter({
      startMigration: async () => ({
        stopAndProveHandlesClosed: async () => false,
        inspectStoppedMigrationResult: async () => ({
          handlesClosed: true,
          migrationChainIdentity: TEST_IMPORT_CURRENT_MIGRATION_ID,
          profileId: TEST_IMPORT_PROFILE_ID,
        }),
      }),
      startValidation: async () => readinessRuntime([]),
      startPublishedValidation: async () => readinessRuntime([]),
    });

    await expect(adapter.migrate(migrationInput)).rejects.toMatchObject({
      code: 'WORKSPACE_IMPORT_MIGRATION_FAILED',
      stage: 'candidateMigration',
    });
  });

  it('does not inspect a runtime that failed to close', async () => {
    let inspected = false;
    const adapter = new PrivateWorkspaceBackupCandidateAdapter({
      startMigration: async () => migrationRuntime([]),
      startValidation: async () => ({
        stopAndProveHandlesClosed: async () => false,
        inspectStoppedReadiness: async () => {
          inspected = true;
          return createTestImportReadiness();
        },
      }),
      startPublishedValidation: async () => readinessRuntime([]),
    });

    await expect(
      adapter.validateAndMaterialize(validationInput),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_IMPORT_VALIDATION_FAILED',
      stage: 'candidateValidation',
    });
    expect(inspected).toBe(false);
  });
});

function migrationRuntime(
  events: string[],
): PrivateWorkspaceBackupCandidateRuntime {
  let stopped = false;
  return {
    stopAndProveHandlesClosed: async () => {
      events.push('runtime.stop');
      stopped = true;
      return true;
    },
    inspectStoppedMigrationResult: async () => {
      if (!stopped) throw new Error('runtime-active');
      events.push('migration.inspect');
      return Object.freeze({
        handlesClosed: true,
        migrationChainIdentity: TEST_IMPORT_CURRENT_MIGRATION_ID,
        profileId: TEST_IMPORT_PROFILE_ID,
      });
    },
  };
}

function readinessRuntime(
  events: string[],
  readiness = createTestImportReadiness(),
): PrivateWorkspaceBackupCandidateRuntime {
  let stopped = false;
  return {
    stopAndProveHandlesClosed: async () => {
      events.push('runtime.stop');
      stopped = true;
      return true;
    },
    inspectStoppedReadiness: async () => {
      if (!stopped) throw new Error('runtime-active');
      events.push('readiness.inspect');
      return readiness;
    },
  };
}
