import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { generateWorkspaceId } from '../registry/workspaceIdGeneration.js';
import { generateWorkspaceBackupReplacementOperationId } from './workspaceBackupReplacementOperationId.js';
import {
  deriveWorkspaceBackupReplacementPaths,
  deriveWorkspaceBackupReplacementRuntimePaths,
} from './workspaceBackupReplacementPaths.js';

describe('workspace backup replacement paths', () => {
  it('derives stable startup paths without requiring an operation id', () => {
    const userDataRoot = join(tmpdir(), 'eky-workspace-replacement-paths');
    const workspaceId = generateWorkspaceId();

    const paths = deriveWorkspaceBackupReplacementRuntimePaths(
      userDataRoot,
      workspaceId,
    );

    expect(paths.activationJournalPath).toBe(
      join(
        userDataRoot,
        'workspace-replacement-operations',
        'activation',
        'profile-restore-activation-journal-v1.json',
      ),
    );
    expect(paths.activeDatabasePath).toContain(workspaceId);
    expect(paths.activeArtifactRoot).toContain(workspaceId);
  });

  it('keeps operation-specific candidate paths under runtime-owned roots', () => {
    const userDataRoot = join(tmpdir(), 'eky-workspace-replacement-candidate');
    const workspaceId = generateWorkspaceId();
    const operationId = generateWorkspaceBackupReplacementOperationId();

    const runtimePaths = deriveWorkspaceBackupReplacementRuntimePaths(
      userDataRoot,
      workspaceId,
    );
    const operationPaths = deriveWorkspaceBackupReplacementPaths(
      userDataRoot,
      operationId,
      workspaceId,
    );

    expect(operationPaths.activationJournalPath).toBe(
      runtimePaths.activationJournalPath,
    );
    expect(operationPaths.candidateDatabasePath).toContain(operationId);
    expect(operationPaths.importStagingRoot).toContain(operationId);
  });

  it('fails closed for a relative runtime root', () => {
    expect(() =>
      deriveWorkspaceBackupReplacementRuntimePaths(
        'relative-root',
        generateWorkspaceId(),
      ),
    ).toThrow('WORKSPACE_REPLACEMENT_INVALID');
  });
});
