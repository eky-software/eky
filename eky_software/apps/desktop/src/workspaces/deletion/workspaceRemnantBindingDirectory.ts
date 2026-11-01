import { invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { readDeletionInventoryDirectoryIdentity } from './workspaceDeletionInventoryFile.js';
import { createWorkspaceRemnantBindingOwnerDirectoryPaths } from './workspaceRemnantBindingPaths.js';
import { captureWorkspaceRemnantBindingKey, workspaceRemnantBindingInvalidCode,
  type WorkspaceRemnantBindingKey } from './workspaceRemnantBindingCodec.js';

// A missing child is meaningful only below the same real, privately owned ancestor.
export async function inspectWorkspaceRemnantBindingDirectory(
  userDataRoot: string, key: unknown, assertCurrent: () => void,
  readIdentity = readDeletionInventoryDirectoryIdentity,
) {
  const captured = captureWorkspaceRemnantBindingKey(key);
  const observed = await inspectWorkspaceRemnantBindingOwnerDirectory(userDataRoot, captured.owner, assertCurrent, readIdentity);
  return Object.freeze({ present: observed.present, ancestorPath: observed.ancestorPath, ancestorIdentity: observed.ancestorIdentity });
}

export async function inspectWorkspaceRemnantBindingOwnerDirectory(
  userDataRoot: string, owner: WorkspaceRemnantBindingKey['owner'], assertCurrent: () => void,
  readIdentity = readDeletionInventoryDirectoryIdentity,
) {
  const paths = createWorkspaceRemnantBindingOwnerDirectoryPaths(userDataRoot, owner);
  let missing = false;
  let ancestorPath = '';
  let ancestorIdentity = '';
  const identities: (string | null)[] = [];
  for (const path of paths.ancestors) {
    let identity: string;
    try { identity = await readIdentity(path, assertCurrent); }
    catch (error) {
      assertCurrent();
      if (path === userDataRoot || (error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
      missing = true;
      identities.push(null);
      continue;
    }
    assertCurrent();
    if (missing) return invalidDeletionData(workspaceRemnantBindingInvalidCode);
    ancestorPath = path;
    ancestorIdentity = identity;
    identities.push(identity);
  }
  return Object.freeze({ present: !missing, ancestorPath, ancestorIdentity, identities: Object.freeze(identities) });
}
