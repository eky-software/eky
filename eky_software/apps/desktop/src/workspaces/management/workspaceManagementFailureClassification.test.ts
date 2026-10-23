import { describe, expect, it } from 'vitest';
import { WorkspaceBackupImportError } from '../import/workspaceBackupImportError.js';
import { WorkspaceBackupReplacementError } from '../replacement/workspaceBackupReplacementError.js';
import { classifyWorkspaceManagementFailure } from './workspaceManagementFailureClassification.js';

describe('workspace management failure provenance', () => {
  it('uses the primary branch and never borrows a cleanup lineage or inspection cause', () => {
    const lineage = new WorkspaceBackupReplacementError('WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH', 'lineageCheck');
    expect(classifyWorkspaceManagementFailure(new AggregateError([lineage, new Error('PROFILE_SCHEMA_UNSUPPORTED')]), 'replace'))
      .toEqual({ lineageMismatch: true });
    expect(classifyWorkspaceManagementFailure(new AggregateError([new Error('private'), lineage]), 'replace'))
      .toEqual({ lineageMismatch: false });
    expect(classifyWorkspaceManagementFailure(new Error('WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH'), 'replace'))
      .toEqual({ lineageMismatch: false });
    expect(classifyWorkspaceManagementFailure(lineage, 'import')).toEqual({ lineageMismatch: false });
  });

  it('retains unknown only behind a typed inspection boundary or an observed closed candidate cause', () => {
    expect(classifyWorkspaceManagementFailure(new WorkspaceBackupImportError(
      'WORKSPACE_IMPORT_VALIDATION_FAILED', 'candidateValidation', { cause: new Error('private') }), 'import'))
      .toEqual({ lineageMismatch: false, inspectionCauseCode: 'unknown' });
    expect(classifyWorkspaceManagementFailure(new Error('PROFILE_SCHEMA_UNSUPPORTED'), 'replace'))
      .toEqual({ lineageMismatch: false, inspectionCauseCode: 'PROFILE_SCHEMA_UNSUPPORTED' });
    expect(classifyWorkspaceManagementFailure(new WorkspaceBackupImportError(
      'WORKSPACE_IMPORT_REGISTRY_FAILED', 'registryRead', { cause: new Error('private') }), 'import'))
      .toEqual({ lineageMismatch: false });
  });

  it('bounds cyclic, inaccessible and unrelated failures without exporting their metadata', () => {
    const cycle = new Error('private');
    cycle.cause = cycle;
    const inaccessible = new Error('private');
    Object.defineProperty(inaccessible, 'cause', { get() { throw new Error('private getter'); } });
    for (const error of [cycle, inaccessible, null, 'private', new Error('private')]) {
      expect(classifyWorkspaceManagementFailure(error, 'replace')).toEqual({ lineageMismatch: false });
    }
    expect(classifyWorkspaceManagementFailure(new Error('PROFILE_SCHEMA_UNSUPPORTED'), 'create'))
      .toEqual({ lineageMismatch: false });
  });
});
