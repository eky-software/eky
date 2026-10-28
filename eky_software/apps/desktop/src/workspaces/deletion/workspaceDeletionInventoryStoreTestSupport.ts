import { chmod, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'vitest';
import { createNodeCrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { deletionTestHeader, deletionTestJournal, deletionTestRecords } from './workspaceDeletionDataTestSupport.js';
import { openWorkspaceDeletionInventoryFile, workspaceDeletionInventoryDirectoryReads,
  type OpenWorkspaceDeletionInventoryFile, type WorkspaceDeletionInventoryDirectoryReads } from './workspaceDeletionInventoryFile.js';
import { createWorkspaceDeletionInventoryPaths, WorkspaceDeletionInventoryStore } from './workspaceDeletionInventoryStore.js';
import { captureWorkspaceDeletionJournal, maximumWorkspaceDeletionJournalBytes,
  workspaceDeletionPhases, type WorkspaceDeletionJournalV1 } from './workspaceDeletionJournalCodec.js';
import { createWorkspaceDeletionJournalPaths, WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';

export async function deletionInventoryStoreFixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-delete-inventory-'));
  await chmod(root, 0o700);
  context.onTestFinished(async () => {
    if (context.task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  const paths = createWorkspaceDeletionInventoryPaths(root, deletionTestHeader.operationId);
  const fileSystem = createNodeCrashSafeFileSlotFileSystem(paths, Number.MAX_SAFE_INTEGER);
  let owned = true;
  let external = true;
  const authority = {
    assertAuthority() { if (!owned) throw new Error('SYNTHETIC_LEASE_LOST'); },
    async assertExternalSelection() { if (!external) throw new Error('SYNTHETIC_TARGET_CHANGED'); },
  };
  const handles = { opened: 0, closed: 0 };
  const trackedOpen: OpenWorkspaceDeletionInventoryFile = async (...args) => {
    const file = await openWorkspaceDeletionInventoryFile(...args);
    handles.opened++;
    return { ...file, async close() { await file.close(); handles.closed++; } };
  };
  const store = (openFile = trackedOpen, directories: WorkspaceDeletionInventoryDirectoryReads = workspaceDeletionInventoryDirectoryReads) =>
    new WorkspaceDeletionInventoryStore(root, deletionTestHeader.operationId, openFile, fileSystem, directories);
  return { root, paths, fileSystem, authority, handles, trackedOpen, store,
    expire() { owned = false; }, changeTarget() { external = false; },
    async prepareExisting() { await mkdir(paths.directoryPath, { recursive: true, mode: 0o700 }); },
    async snapshot() {
      const values: Record<string, string> = {};
      for (const name of await readdir(paths.directoryPath)) values[name] = (await readFile(join(paths.directoryPath, name))).toString('hex');
      return values;
    },
  };
}

export async function deletionInventoryRetirementFixture(context: TestContext,
  phase: WorkspaceDeletionJournalV1['phase'] = 'registryPublished') {
  const fixture = await deletionInventoryStoreFixture(context);
  const receipt = await fixture.store().publish(deletionTestHeader, deletionTestRecords(), fixture.authority);
  const journalPaths = createWorkspaceDeletionJournalPaths(fixture.root);
  const journalSystem = createNodeCrashSafeFileSlotFileSystem(journalPaths, maximumWorkspaceDeletionJournalBytes);
  const journal = new WorkspaceDeletionJournalStore(fixture.root, journalSystem);
  const select = async () => ({ ...fixture.authority, slots: (await journal.inspect(fixture.authority.assertAuthority)).slots });
  const initial = captureWorkspaceDeletionJournal({ ...deletionTestJournal(), ...receipt });
  await journal.publish(initial, await select());
  for (const current of workspaceDeletionPhases.slice(1, workspaceDeletionPhases.indexOf(phase) + 1)) {
    await journal.advance(captureWorkspaceDeletionJournal({ ...initial, phase: current }), await select());
  }
  return { ...fixture, journal, journalPaths, journalSystem, select,
    expected: captureWorkspaceDeletionJournal({ ...initial, phase }) };
}
