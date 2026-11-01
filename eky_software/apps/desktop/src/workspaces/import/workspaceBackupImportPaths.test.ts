import { isAbsolute, join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { deletionTestId as id } from '../deletion/workspaceDeletionDataTestSupport.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { validateWorkspaceBackupImportOperationId } from './workspaceBackupImportOperationId.js';
import { deriveWorkspaceBackupImportOperationPaths as operationPaths, deriveWorkspaceBackupImportOperationsPaths as operationsPaths,
  deriveWorkspaceBackupImportPaths as paths } from './workspaceBackupImportPaths.js';

it('shares the exact operation paths without changing existing import destinations', () => {
  const root = resolve('synthetic-workspace');
  const operationId = validateWorkspaceBackupImportOperationId(id(1));
  const workspaceId = validateWorkspaceId(id(2));
  const operation = operationPaths(root, operationId);
  const selected = paths(root, operationId, workspaceId);
  const candidate = join(root, 'workspace-operations', operationId, workspaceId);
  expect(operationsPaths(root)).toEqual({ userDataRoot: root, operationsRoot: join(root, 'workspace-operations') });
  expect(Object.isFrozen(operationsPaths(root))).toBe(true);
  const final = join(root, 'workspaces', workspaceId);
  expect(operation).toEqual({ userDataRoot: root, operationsRoot: join(root, 'workspace-operations'),
    operationRoot: join(root, 'workspace-operations', operationId) });
  expect(selected).toEqual({ ...operation, candidateRoot: candidate, importStagingRoot: join(candidate, 'import-staging'),
    candidateRuntimeRoot: join(candidate, 'runtime'), databaseFilePath: join(candidate, 'runtime', 'data', 'eky.sqlite'),
    artifactRoot: join(candidate, 'runtime', 'storage', 'invoices'), workspacesRoot: join(root, 'workspaces'), finalRoot: final,
    publishedDatabaseFilePath: join(final, 'runtime', 'data', 'eky.sqlite'),
    publishedArtifactRoot: join(final, 'runtime', 'storage', 'invoices') });
  expect(Object.isFrozen(operation)).toBe(true);
  expect(Object.values(selected).every(isAbsolute)).toBe(true);
});

it.for(['', 'relative', 'relative/../root', '/invalid\0root'])(
  'rejects an invalid root in both derivations: %s', root => {
    expect(() => operationsPaths(root)).toThrow('WORKSPACE_IMPORT_INVALID');
    expect(() => operationPaths(root, id(1))).toThrow('WORKSPACE_IMPORT_INVALID');
    expect(() => paths(root, validateWorkspaceBackupImportOperationId(id(1)), validateWorkspaceId(id(2))))
      .toThrow('WORKSPACE_IMPORT_INVALID');
  });

it.for(['../escape', '', id(10).toUpperCase(), null, 42])('rejects an invalid operation key: %s', operationId => {
  expect(() => operationPaths(resolve('synthetic-workspace'), operationId)).toThrow('WORKSPACE_IMPORT_INVALID');
});
