import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { deriveProfileRestoreActivationOperationPaths } from '../../profileBackup/restore/profileRestoreActivationPaths.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { deriveWorkspaceBackupReplacementPaths } from '../replacement/workspaceBackupReplacementPaths.js';
import { validateWorkspaceBackupReplacementOperationId } from '../replacement/workspaceBackupReplacementOperationId.js';
import { deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { deriveWorkspaceReplacementRemnantParents as parents, deriveWorkspaceReplacementRemnantRoot as root } from './workspaceReplacementRemnantPaths.js';

const userDataRoot = join(tmpdir(), 'eky-remnant-paths');
const workspaceId = validateWorkspaceId(id(1)), operationId = validateWorkspaceBackupReplacementOperationId(id(2));

it('uses exactly the four existing replacement/activation owner roots', () => {
  const replacement = deriveWorkspaceBackupReplacementPaths(userDataRoot, operationId, workspaceId);
  const activation = deriveProfileRestoreActivationOperationPaths({ activeDatabasePath: replacement.activeDatabasePath,
    activeDocumentsRoot: replacement.activeArtifactRoot, stagingRoot: replacement.activationStagingRoot,
    rollbackRoot: replacement.activationRollbackRoot, failedRoot: replacement.activationFailedRoot }, operationId);
  const locations = parents(userDataRoot, workspaceId);
  expect(locations.map(location => location.parentPath)).toEqual([replacement.importRoot, replacement.activationStagingRoot,
    replacement.activationRollbackRoot, replacement.activationFailedRoot]);
  expect(locations.map(location => root(userDataRoot, workspaceId, operationId, location.role).rootPath))
    .toEqual([replacement.importStagingRoot, activation.stagingOperationRoot, activation.rollbackOperationRoot, activation.failedOperationRoot]);
  for (const location of locations) {
    expect(location.ancestors[0]).toBe(userDataRoot);
    expect(location.ancestors.at(-1)).toBe(location.parentPath);
    expect(root(userDataRoot, workspaceId, operationId, location.role).parentPath).toBe(location.parentPath);
    expect(Object.isFrozen(location.ancestors)).toBe(true);
  }
  expect(parents(userDataRoot, id(8))).toEqual(locations);
});

it.for(['relative-root', `${userDataRoot}\0`])('rejects invalid installation root %s', value => {
  expect(() => parents(value, workspaceId)).toThrow();
  expect(() => root(value, workspaceId, operationId, 'activationFailed')).toThrow();
});

it.for(['../other', '', operationId.toUpperCase().replace('00000000', 'FFFFFFFF')])('rejects invalid owner identifiers %s', value => {
  expect(() => parents(userDataRoot, value)).toThrow();
  expect(() => root(userDataRoot, workspaceId, value, 'activationStaging')).toThrow();
});

it.for(['inspection', 'workspace', 'toString', '__proto__'])('does not widen the role map to %s', role => {
  expect(() => root(userDataRoot, workspaceId, operationId, role as Parameters<typeof root>[3]))
    .toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
});
