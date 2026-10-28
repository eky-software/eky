import { invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { readDeletionInventoryDirectoryIdentity } from './workspaceDeletionInventoryFile.js';
import { createWorkspaceDeletionJournalPaths } from './workspaceDeletionJournalStore.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { workspaceRemnantBindingInvalidCode } from './workspaceRemnantBindingCodec.js';

// A missing child is meaningful only below the same real, privately owned ancestor.
export async function inspectWorkspaceRemnantBindingDirectory(
  userDataRoot: string, key: unknown, assertCurrent: () => void,
  readIdentity = readDeletionInventoryDirectoryIdentity,
) {
  const state = createWorkspaceDeletionJournalPaths(userDataRoot).directoryPath;
  const paths = createWorkspaceRemnantBindingPaths(userDataRoot, key);
  let missing = false;
  let ancestorPath = '';
  let ancestorIdentity = '';
  for (const path of [userDataRoot, state, paths.directoryPath]) {
    let identity: string;
    try { identity = await readIdentity(path, assertCurrent); }
    catch (error) {
      assertCurrent();
      if (path === userDataRoot || (error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
      missing = true;
      continue;
    }
    assertCurrent();
    if (missing) return invalidDeletionData(workspaceRemnantBindingInvalidCode);
    ancestorPath = path;
    ancestorIdentity = identity;
  }
  return Object.freeze({ present: !missing, ancestorPath, ancestorIdentity });
}
