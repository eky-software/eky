import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceMaintenancePurpose } from '../maintenance/workspaceMaintenanceLease.js';
import {
  mapWorkspaceBackupImportError,
  WorkspaceBackupImportError,
} from '../import/workspaceBackupImportError.js';
import {
  createWorkspaceBackupImportCoordinatorFixture,
  TEST_IMPORT_CONTAINER_PATH,
  TEST_IMPORT_PASSWORD,
} from '../import/workspaceBackupImportTestSupport.js';
import {
  mapWorkspaceBackupReplacementError,
  WorkspaceBackupReplacementError,
} from '../replacement/workspaceBackupReplacementError.js';
import {
  createWorkspaceBackupReplacementFixture,
  TEST_REPLACEMENT_CONTAINER_PATH,
  TEST_REPLACEMENT_PASSWORD,
  TEST_REPLACEMENT_WORKSPACE_ID,
} from '../replacement/workspaceBackupReplacementTestSupport.js';
import { mapWorkspaceManagementError } from './workspaceManagementError.js';

describe('workspace backup first failure preservation', () => {
  it('retains the internal import cause without changing its public code or stage', () => {
    const cause = new Error('PROFILE_SCHEMA_UNSUPPORTED');
    const mapped = mapWorkspaceBackupImportError(
      cause,
      'WORKSPACE_IMPORT_MIGRATION_FAILED',
      'candidateMigration',
    );
    expect(mapped.cause).toBe(cause);
    expect(mapped.message).toBe('WORKSPACE_IMPORT_MIGRATION_FAILED');
    expect(mapped.stage).toBe('candidateMigration');
    expect(mapWorkspaceBackupImportError(
      mapped,
      'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
      'recovery',
    )).toBe(mapped);
  });

  it('retains the internal replacement cause without changing its public code or stage', () => {
    const cause = new Error('PROFILE_SCHEMA_UNSUPPORTED');
    const mapped = mapWorkspaceBackupReplacementError(
      cause,
      'WORKSPACE_REPLACEMENT_MIGRATION_FAILED',
      'candidateMigration',
    );
    expect(mapped.cause).toBe(cause);
    expect(mapped.message).toBe('WORKSPACE_REPLACEMENT_MIGRATION_FAILED');
    expect(mapped.stage).toBe('candidateMigration');
    expect(mapWorkspaceBackupReplacementError(
      mapped,
      'WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED',
      'rollback',
    )).toBe(mapped);
  });

  it.each(['import', 'replace'] as const)(
    'retains %s detail behind the existing management message',
    operation => {
      const raw = new Error('synthetic-private-password/path/detail');
      const error = operation === 'import'
        ? mapWorkspaceBackupImportError(
          raw, 'WORKSPACE_IMPORT_VALIDATION_FAILED', 'candidateValidation',
        )
        : mapWorkspaceBackupReplacementError(
          raw, 'WORKSPACE_REPLACEMENT_VALIDATION_FAILED', 'candidateValidation',
        );
      const mapped = mapWorkspaceManagementError(error, operation);
      expect(mapped.cause).toBe(error);
      expect(mapped.message).toBe(operation === 'import'
        ? 'WORKSPACE_MANAGEMENT_IMPORT_FAILED'
        : 'WORKSPACE_MANAGEMENT_REPLACE_FAILED');
      expect(JSON.stringify(mapped)).not.toContain(raw.message);
      expect(JSON.stringify(mapped)).not.toContain('cause');
    },
  );

  it.each(['import', 'replace'] as const)('retains the first %s cause through ordinary recovery', async operation => {
    const fixture = fixtureFor(operation);
    const first = new Error('PROFILE_SCHEMA_UNSUPPORTED');
    vi.spyOn(fixture.candidate, 'migrate').mockRejectedValueOnce(first);
    const error = await captureFailure(() => fixture.run());
    expect(error.cause).toBe(first);
    expect(error.stage).toBe('candidateMigration');
    expect(fixture.lease.held).toBe(false);
  });

  it.each(['import', 'replace'] as const)('retains primary, recovery and release %s failures in order', async operation => {
    const fixture = fixtureFor(operation);
    // An unknown primary must not inherit a cleanup failure's known code.
    const first = new Error('synthetic unknown primary');
    const recovery = new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    const release = new Error('synthetic release failure');
    vi.spyOn(fixture.candidate, 'migrate').mockRejectedValueOnce(first);
    fixture.failRecovery(recovery);
    const acquire = fixture.lease.acquire.bind(fixture.lease);
    vi.spyOn(fixture.lease, 'acquire').mockImplementationOnce(
      async (purpose: WorkspaceMaintenancePurpose) => {
        const lease = await acquire(purpose);
        return {
          release: async () => {
            await lease.release();
            throw release;
          },
        };
      },
    );

    const error = await captureFailure(() => fixture.run());
    expect(error.stage).toBe('lease');
    expect(error.message).toBe(operation === 'import'
      ? 'WORKSPACE_IMPORT_LIFECYCLE_FAILED'
      : 'WORKSPACE_REPLACEMENT_LIFECYCLE_FAILED');
    expect(error.cause).toBeInstanceOf(AggregateError);
    expect(failureLeaves(error)).toEqual([first, recovery, release]);
    expect(fixture.lease.held).toBe(false);
  });

  it('retains both import recovery failures instead of replacing the first with restart failure', async () => {
    const fixture = createWorkspaceBackupImportCoordinatorFixture();
    const first = new Error('PROFILE_SCHEMA_UNSUPPORTED');
    const cleanup = new Error('synthetic cleanup failure');
    const restart = new Error('synthetic restart failure');
    vi.spyOn(fixture.candidate, 'migrate').mockRejectedValueOnce(first);
    vi.spyOn(fixture.root, 'discardCandidate').mockRejectedValueOnce(cleanup);
    vi.spyOn(fixture.lifecycle, 'ensurePreviousWorkspaceRunning')
      .mockRejectedValueOnce(restart);

    const error = await captureFailure(
      () => fixture.coordinator.import(importInput),
    );
    expect(error.cause).toBeInstanceOf(AggregateError);
    expect(failureLeaves(error)).toEqual([first, cleanup, restart]);
    expect(fixture.journal.current).toBeDefined();
    expect(fixture.registry.writes).toHaveLength(0);
    expect(fixture.lease.held).toBe(false);
  });

  it.each(['import', 'replace'] as const)('keeps an isolated %s release failure a failure, not an aggregate success', async operation => {
    const fixture = fixtureFor(operation);
    const release = new Error('synthetic release failure');
    vi.spyOn(fixture.lease, 'acquire').mockResolvedValueOnce({
      release: async () => {
        throw release;
      },
    });
    const error = await captureFailure(() => fixture.run());
    expect(error.stage).toBe('lease');
    expect(error.cause).toBe(release);
    expect(error.cause).not.toBeInstanceOf(AggregateError);
  });
});

const importInput = {
  containerPath: TEST_IMPORT_CONTAINER_PATH,
  password: TEST_IMPORT_PASSWORD,
  workspaceLabel: 'Synthetic import',
};

function fixtureFor(operation: 'import' | 'replace') {
  if (operation === 'import') {
    const fixture = createWorkspaceBackupImportCoordinatorFixture();
    return {
      candidate: fixture.candidate,
      lease: fixture.lease,
      run: () => fixture.coordinator.import(importInput),
      failRecovery: (error: Error) => {
        vi.spyOn(fixture.root, 'discardCandidate').mockRejectedValueOnce(error);
      },
    };
  }
  const fixture = createWorkspaceBackupReplacementFixture();
  return {
    candidate: fixture.candidate,
    lease: fixture.lease,
    run: () => fixture.coordinator.replace({
      containerPath: TEST_REPLACEMENT_CONTAINER_PATH,
      password: TEST_REPLACEMENT_PASSWORD,
      targetWorkspaceId: TEST_REPLACEMENT_WORKSPACE_ID,
    }),
    failRecovery: (error: Error) => {
      vi.spyOn(fixture.rootStore, 'discardBeforeActivation')
        .mockRejectedValueOnce(error);
    },
  };
}

async function captureFailure(
  operation: () => Promise<unknown>,
): Promise<WorkspaceBackupImportError | WorkspaceBackupReplacementError> {
  try {
    await operation();
  } catch (error) {
    if (
      error instanceof WorkspaceBackupImportError ||
      error instanceof WorkspaceBackupReplacementError
    ) return error;
    throw error;
  }
  throw new Error('Expected the operation to fail');
}

function failureLeaves(error: unknown): unknown[] {
  if (error instanceof AggregateError) return error.errors.flatMap(failureLeaves);
  if (error instanceof Error && error.cause !== undefined) {
    return failureLeaves(error.cause);
  }
  return [error];
}
