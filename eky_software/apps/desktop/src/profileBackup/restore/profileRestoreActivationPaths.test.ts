import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { deriveProfileRestoreActivationOperationPaths as derive, type ProfileRestoreActivationPaths } from './profileRestoreActivationPaths.js';

const root = join(tmpdir(), 'eky-activation-paths');
const operationId = '00000000-0000-4000-8000-000000000001';
const paths: ProfileRestoreActivationPaths = {
  activeDatabasePath: join(root, 'runtime', 'data', 'eky.sqlite'),
  activeDocumentsRoot: join(root, 'runtime', 'storage', 'invoices'),
  failedRoot: join(root, 'failed'), rollbackRoot: join(root, 'rollback'), stagingRoot: join(root, 'staging'),
};

it('preserves every existing activation, rollback and failed path', () => {
  const staging = join(paths.stagingRoot, operationId), rollback = join(paths.rollbackRoot, operationId);
  const failed = join(paths.failedRoot, operationId);
  expect(derive(paths, operationId)).toEqual({
    failedActiveDatabasePath: join(failed, 'active', 'data', 'eky.sqlite'),
    failedActiveDocumentsRoot: join(failed, 'active', 'storage', 'invoices'),
    failedOperationRoot: failed,
    failedStagingRoot: join(failed, 'staging'),
    failedStagedDatabasePath: join(failed, 'staging', 'profile.sqlite'),
    failedStagedDocumentsRoot: join(failed, 'staging', 'activation', 'storage', 'invoices'),
    rollbackDatabasePath: join(rollback, 'data', 'eky.sqlite'),
    rollbackDocumentsRoot: join(rollback, 'storage', 'invoices'),
    rollbackOperationRoot: rollback,
    stagedDatabasePath: join(staging, 'profile.sqlite'),
    stagedDocumentsRoot: join(staging, 'activation', 'storage', 'invoices'),
    stagingOperationRoot: staging,
  });
  expect(Object.isFrozen(derive(paths, operationId))).toBe(true);
});

it.for(['../escape', `${operationId}/child`, `${operationId}\\child`, '', `${operationId}\0`,
  '00000000-0000-6000-8000-000000000001'])('rejects invalid operation %s', id => {
  expect(() => derive(paths, id)).toThrow('PROFILE_RESTORE_OPERATION_INVALID');
});

it.for(Object.keys(paths) as (keyof ProfileRestoreActivationPaths)[])(
  'preserves all root validation for %s', key => {
    for (const invalid of ['relative', `${root}\0`, join(root, 'a'.repeat(4_097))]) {
      expect(() => derive({ ...paths, [key]: invalid }, operationId)).toThrow('PROFILE_RESTORE_ACTIVATION_PATHS_INVALID');
    }
  });

it('preserves alias rejection and absolute normalization', () => {
  expect(() => derive({ ...paths, failedRoot: join(paths.rollbackRoot, 'child', '..') }, operationId))
    .toThrow('PROFILE_RESTORE_ACTIVATION_PATHS_INVALID');
  const input = { ...paths, stagingRoot: join(root, 'temporary', '..', 'staging') };
  expect(derive(input, operationId).stagingOperationRoot).toBe(join(resolve(input.stagingRoot), operationId));
});

it.skipIf(process.platform !== 'win32')('retains case-insensitive root alias rejection on Windows', () => {
  expect(() => derive({ ...paths, failedRoot: paths.rollbackRoot.toUpperCase() }, operationId))
    .toThrow('PROFILE_RESTORE_ACTIVATION_PATHS_INVALID');
});
