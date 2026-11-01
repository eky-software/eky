import { opendir } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { deletionInventoryPathsEqual, readDeletionInventoryDirectoryIdentity } from './workspaceDeletionInventoryFile.js';
import type { WorkspaceRemnantBindingAuthority } from './workspaceRemnantBindingStore.js';

export const workspaceDeletionDirectoryEntryPageSize = 64;
const invalidCode = 'WORKSPACE_DELETE_INVENTORY_INVALID';

export interface WorkspaceDeletionDirectory {
  read(): Promise<Readonly<{ name: string }> | null>;
  close(): Promise<void>;
}

export interface WorkspaceDeletionDirectoryReads {
  directoryIdentity(path: string, assertCurrent: () => void): Promise<string>;
  openDirectory(path: string): Promise<WorkspaceDeletionDirectory>;
}

export const workspaceDeletionDirectoryReads: WorkspaceDeletionDirectoryReads = Object.freeze({
  directoryIdentity: readDeletionInventoryDirectoryIdentity,
  async openDirectory(path: string) {
    const directory = await opendir(path, { bufferSize: workspaceDeletionDirectoryEntryPageSize });
    return { read: () => directory.read(), close: () => directory.close() };
  },
});

// Sorted observations only: names added behind the cursor require a fresh owner census/EOF comparison.
// Neither yielding a name nor reaching iterator EOF proves ownership or stable directory completeness.
export async function* observeWorkspaceDeletionDirectoryEntries(
  path: string, authority: WorkspaceRemnantBindingAuthority,
  reads: WorkspaceDeletionDirectoryReads = workspaceDeletionDirectoryReads,
): AsyncGenerator<string, void> {
  if (typeof path !== 'string' || path.includes('\0') || !isAbsolute(path) ||
      !deletionInventoryPathsEqual(resolve(path), path)) return invalidDeletionData(invalidCode);
  const assertAuthority = checkedDeletionAuthority(authority.assertAuthority.bind(authority), invalidCode);
  const external = authority.assertExternalSelection.bind(authority);
  const identity = reads.directoryIdentity.bind(reads);
  const open = reads.openDirectory.bind(reads);
  let directoryIdentity: string | undefined;
  const assertSelection = async () => {
    assertAuthority();
    await external();
    assertAuthority();
    const current = await identity(path, assertAuthority);
    assertAuthority();
    if (directoryIdentity !== undefined && current !== directoryIdentity) return invalidDeletionData(invalidCode);
    directoryIdentity ??= current;
    await external();
    assertAuthority();
  };
  const readPage = async (cursor: string | undefined) => {
    await assertSelection();
    let directory: WorkspaceDeletionDirectory | undefined;
    const page: string[] = [];
    let failed = false;
    let failure: unknown;
    try {
      directory = await open(path);
      await assertSelection();
      while (true) {
        // The preceding post-open/read check also guards this read: only bounded synchronous name work intervenes.
        assertAuthority();
        const entry = await directory.read();
        assertAuthority();
        await assertSelection();
        if (entry === null) break;
        const name = entry.name;
        if (typeof name !== 'string' || name.length === 0 || name === '.' || name === '..' ||
            name.includes('\0') || name.includes('/') || (process.platform === 'win32' && name.includes('\\'))) {
          return invalidDeletionData(invalidCode);
        }
        if (cursor !== undefined && name <= cursor) continue;
        let index = 0;
        while (index < page.length && page[index]! < name) index++;
        if (page[index] === name) return invalidDeletionData(invalidCode);
        if (index >= workspaceDeletionDirectoryEntryPageSize) continue;
        if (page.length === workspaceDeletionDirectoryEntryPageSize) page.pop();
        page.splice(index, 0, name);
      }
    } catch (error) { failed = true; failure = error; }
    // Close the original handle even after revocation; no read remains unjoined when close begins.
    try { await directory?.close(); }
    catch (error) {
      if (failed) throw new AggregateError([failure, error], invalidCode);
      throw error;
    }
    if (failed) throw failure;
    await assertSelection();
    return page;
  };
  let cursor: string | undefined;
  while (true) {
    const page = await readPage(cursor);
    if (page.length === 0) return;
    for (const name of page) {
      await assertSelection();
      yield name;
      cursor = name;
    }
  }
}
