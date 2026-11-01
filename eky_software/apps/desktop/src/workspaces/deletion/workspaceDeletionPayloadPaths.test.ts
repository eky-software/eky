import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { profileInspectionCopyDirectoryName } from '../../runtime/profileInspectionMessages.js';
import { workspaceOwnedEntryNames } from '../adoption/workspaceLegacyAdoptionRootStore.js';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { deriveWorkspaceBackupImportPaths } from '../import/workspaceBackupImportPaths.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { deletionTestHeader, deletionTestId, deletionTestRecord } from './workspaceDeletionDataTestSupport.js';
import { deriveWorkspaceDeletionPayloadPaths } from './workspaceDeletionPayloadPaths.js';
import { deriveWorkspaceInspectionRemnantParents } from './workspaceInspectionRemnantPaths.js';
import { deriveWorkspaceReplacementRemnantRoot } from './workspaceReplacementRemnantPaths.js';

const root = resolve('synthetic-delete-root');
const workspace = { ...deletionTestRecord(), role: 'workspace', ownerOperationId: null, bindingSha256: null };
const paths = (record: unknown, target: unknown = deletionTestHeader) => deriveWorkspaceDeletionPayloadPaths(root, target, record);

describe('deletion payload paths', () => {
  it('keeps workspace quarantine beside the selected workspace, outside inventory storage', () => {
    const [selected] = paths(workspace);
    expect(selected?.sourcePath).toBe(deriveWorkspaceRoot(root, deletionTestHeader.workspaceId, 1).workspaceRoot);
    expect(dirname(selected!.quarantinePath)).toBe(selected!.parentPath);
    expect(selected!.quarantinePath).not.toBe(selected!.sourcePath);
    expect(selected!.ancestors).toEqual([root, join(root, 'workspaces')]);
    expect(paths(workspace)).toEqual(paths(workspace));
    expect(paths(workspace, { ...deletionTestHeader, operationId: deletionTestId(91) })[0]?.quarantinePath)
      .not.toBe(selected!.quarantinePath);
  });

  it.for(['replacementImport', 'activationStaging', 'activationRollback', 'activationFailed'] as const)(
    'uses the existing %s owner path', role => {
      const record = { ...deletionTestRecord(), role };
      const [selected] = paths(record);
      expect(selected?.sourcePath).toBe(deriveWorkspaceReplacementRemnantRoot(root, deletionTestHeader.workspaceId,
        record.ownerOperationId!, role).rootPath);
      expect(dirname(selected!.quarantinePath)).toBe(selected!.parentPath);
    },
  );

  it.for(['importCandidate', 'adoptionCandidate'] as const)('selects only the %s candidate, not its operation directory', role => {
    const record = { ...deletionTestRecord(71), role };
    const expected = deriveWorkspaceBackupImportPaths(root,
      validateWorkspaceBackupImportOperationId(record.ownerOperationId), deletionTestHeader.workspaceId);
    const [selected] = paths(record);
    expect(selected?.sourcePath).toBe(expected.candidateRoot);
    expect(selected?.parentPath).toBe(expected.operationRoot);
  });

  it('keeps all legacy entries distinct without selecting the shared runtime', () => {
    const names = new Set<string>();
    for (const member of workspaceOwnedEntryNames) {
      const [selected] = paths({ ...deletionTestRecord(), role: 'legacyEntry', ownerOperationId: null, member });
      expect(selected?.sourcePath).toBe(join(root, 'runtime', member));
      expect(selected?.parentPath).toBe(join(root, 'runtime'));
      expect(selected?.legacyEntry).toBe(true);
      names.add(selected!.quarantinePath);
    }
    expect(names.size).toBe(workspaceOwnedEntryNames.length);
  });

  it('considers both external inspection locations but never the copies covered by the workspace', () => {
    const record = { ...deletionTestRecord(), role: 'inspection', generationId: deletionTestId(31) };
    const selected = paths(record);
    const expected = deriveWorkspaceInspectionRemnantParents(root, deletionTestHeader.workspaceId)
      .filter(location => location.scope === 'replacement')
      .map(location => join(location.parentPath, profileInspectionCopyDirectoryName(record.generationId)));
    expect(selected.map(location => location.sourcePath)).toEqual(expected);
    expect(selected).toHaveLength(2);
    expect(selected.every(location => !location.sourcePath.startsWith(deriveWorkspaceRoot(root, deletionTestHeader.workspaceId, 1).workspaceRoot)))
      .toBe(true);
  });

  it.for([
    { ...deletionTestRecord(), role: 'inspectionEvidence', generationId: deletionTestId(31) },
    { ...deletionTestRecord(), role: 'legacyEntry', ownerOperationId: null, member: '../outside' },
    { ...deletionTestRecord(), ownerOperationId: '../outside' },
    { ...deletionTestRecord(), extraPath: '../outside' },
  ])('rejects evidence and path injection before returning any physical target', record => {
    expect(() => paths(record)).toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
  });
});
