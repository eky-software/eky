import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, vi, type TestContext } from 'vitest';
import { captureDeletionTarget } from '../management/workspaceDeletionTarget.js';
import { CrashSafeByteSlotStore, type CrashSafeByteSlotReadSelection, type CrashSafeByteSlotSelection } from '../persistence/crashSafeByteSlotStore.js';
import { createNodeCrashSafeFileSlotFileSystem, type CrashSafeFileSlot, type CrashSafeFileSlotIdentity, type CrashSafeFileSlotMutationGuard } from '../persistence/crashSafeFileSlot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { createSwitchRegistry } from '../switch/workspaceSwitchTestSupport.js';
import { deletionTestHeader as header, deletionTestId as id, deletionTestJournal as journal } from './workspaceDeletionDataTestSupport.js';
import { createWorkspaceDeletionInventoryPaths, WorkspaceDeletionInventoryStore } from './workspaceDeletionInventoryStore.js';
import { maximumWorkspaceDeletionJournalBytes, serializeWorkspaceDeletionJournal } from './workspaceDeletionJournalCodec.js';
import { createWorkspaceDeletionJournalPaths, WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { createWorkspaceDeletionPayloadExecutor } from './workspaceDeletionPayloadExecutor.js';
import { createWorkspaceDeletionPublisher } from './workspaceDeletionPublication.js';
import { deletionRoleSourceFixture } from './workspaceDeletionRolesTestSupport.js';
type ReadSelection = CrashSafeByteSlotReadSelection;
export interface WorkspaceDeletionJournalTestIo {
  root: string; path: string;
  beforeRead: (() => Promise<void>) | undefined; beforeClose: (() => Promise<void>) | undefined;
  handles: FileHandle[]; live: Set<FileHandle>;
}
export function publishedDeletionJournalPlan(plan: Awaited<ReturnType<WorkspaceDeletionJournalStore['inspect']>>['plan']) {
  if (plan.mode !== 'published')
    throw new Error('SYNTHETIC_EXPECTED_PUBLISHED_JOURNAL');
  return plan;
}

export async function captureWorkspaceDeletionPayloadJournalTestFailure(test: TestContext, first: unknown) {
  const f = await deletionRoleSourceFixture(test);
  const registryPath = join(f.root, WORKSPACE_REGISTRY_FILE_NAME);
  const registry = new WorkspaceRegistryStore({ installationRoot: f.root, filePath: registryPath });
  const base = createSwitchRegistry();
  await registry.write({ ...base, formatVersion: 2, workspaces: [base.workspaces[0]!,
    { ...base.workspaces[1]!, workspaceId: header.workspaceId, lineageIdentity: header.lineageIdentity }] });
  const assertCurrent = f.authority.assertAuthority;
  const input = { userDataRoot: f.root, registry,
    assertWritersAbsent: f.authority.assertWritersAbsent, assertStableSelection: f.authority.assertExternalSelection };
  const target = await captureDeletionTarget({ installationRoot: f.root, workspaceId: header.workspaceId,
    typedLabel: base.workspaces[1]!.workspaceLabel, registry, assertAuthority: assertCurrent });
  const operationId = id(200);
  const published = await createWorkspaceDeletionPublisher(input)(assertCurrent, f.authority.assertExternalSelection,
    target.target, { operationId, target: target.target, backupDisposition: 'explicitDataLoss' }, target.assertCurrent);
  const paths = createWorkspaceDeletionJournalPaths(f.root);
  const inventory = createWorkspaceDeletionInventoryPaths(f.root, operationId);
  const journalBytes = await readFile(paths.currentPath), inventoryBytes = await readFile(inventory.currentPath);
  const journalEntries = (await readdir(paths.directoryPath)).sort();
  const registryBytes = await readFile(registryPath);
  const advance = WorkspaceDeletionJournalStore.prototype.advance;
  const consume = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
  let native = false, injected = false, normalized: unknown;
  const advanceSpy = vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'advance').mockImplementation(function(
    this: WorkspaceDeletionJournalStore, value, selection, readSelection, intermediate,
  ) {
    expect(typeof intermediate?.assertAfterSlotRead).toBe('function');
    const fileSystem = createNodeCrashSafeFileSlotFileSystem(paths, maximumWorkspaceDeletionJournalBytes);
    const prepare = fileSystem.prepareDirectory.bind(fileSystem);
    fileSystem.prepareDirectory = async (...args) => {
      native = true;
      try { return await prepare(...args); }
      catch (error) { normalized = error; throw error; }
      finally { native = false; }
    };
    return advance.call(new WorkspaceDeletionJournalStore(f.root, fileSystem), value, selection, readSelection, intermediate);
  });
  const consumeSpy = vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(function(
    this: WorkspaceDeletionInventoryStore, ...args
  ) {
    if (native && !injected) { injected = true; return Promise.reject(first); }
    return consume.apply(this, args);
  });
  const work = createWorkspaceDeletionPayloadExecutor(input)(operationId,
    { assertCurrent, assertOwned: f.authority.assertExternalSelection }, published.journal)
    .then(() => ({ ok: true as const }), error => ({ ok: false as const, error }));
  test.onTestFinished(async () => { await work; });
  let outcome: Awaited<typeof work>;
  try { outcome = await work; }
  finally { consumeSpy.mockRestore(); advanceSpy.mockRestore(); }
  expect(injected).toBe(true);
  expect(normalized).toMatchObject({ name: 'CrashSafeFileSlotError', failure: 'unavailable' });
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error('PAYLOAD_JOURNAL_EXPECTED_REJECTION');
  expect(outcome.error).toBe(first);
  expect(await readFile(paths.currentPath)).toEqual(journalBytes);
  expect((await readdir(paths.directoryPath)).sort()).toEqual(journalEntries);
  expect(await readFile(inventory.currentPath)).toEqual(inventoryBytes);
  expect(await readFile(registryPath)).toEqual(registryBytes);
  return outcome.error;
}
export async function createWorkspaceDeletionJournalReadFixture(test: TestContext, io: WorkspaceDeletionJournalTestIo, mode: 'published' | 'recovery' | 'initial' | 'backupNext' | 'currentBackup' = 'published') {
  const root = await mkdtemp(join(tmpdir(), 'eky-journal-read-proof-'));
  await chmod(root, 0o700);
  const paths = createWorkspaceDeletionJournalPaths(root);
  await mkdir(paths.directoryPath, { mode: 0o700 });
  if (mode === 'published' || mode === 'recovery' || mode === 'currentBackup')
    await writeFile(paths.currentPath, serializeWorkspaceDeletionJournal(journal(mode === 'currentBackup' ? 'quarantined' : 'authorized')), { mode: 0o600, flag: 'wx' });
  if (mode === 'backupNext' || mode === 'currentBackup')
    await writeFile(paths.backupPath, serializeWorkspaceDeletionJournal(journal()), { mode: 0o600, flag: 'wx' });
  if (mode === 'recovery' || mode === 'backupNext' || mode === 'initial')
    await writeFile(paths.nextPath, serializeWorkspaceDeletionJournal(journal(mode === 'initial' ? 'authorized' : 'quarantined')), { mode: 0o600, flag: 'wx' });
  const payloadPath = join(root, 'payload-proof'), competitorPath = join(root, 'competing-binding'), registryPath = join(root, 'registry-proof');
  await writeFile(payloadPath, 'expected-payload', { flag: 'wx' });
  await writeFile(registryPath, 'original-registry', { flag: 'wx' });
  const fs = createNodeCrashSafeFileSlotFileSystem(paths, maximumWorkspaceDeletionJournalBytes);
  const store = new WorkspaceDeletionJournalStore(root, fs), bytes = new CrashSafeByteSlotStore(fs);
  const events: string[] = [], calls = { full: 0, read: 0, slots: 0, mutations: 0 };
  let live = true, writersAbsent = true, failed = false, first: unknown;
  const retained = (error: unknown) => {
    if (!failed) {
      failed = true;
      first = error;
    }
    return first;
  };
  const leaseFailure = new Error('SYNTHETIC_JOURNAL_LEASE_LOST');
  const writerFailure = new Error('SYNTHETIC_JOURNAL_WRITER_RETURNED');
  const contentFailure = new Error('SYNTHETIC_JOURNAL_CONTENT_CHANGED');
  const registryFailure = new Error('SYNTHETIC_JOURNAL_REGISTRY_CHANGED');
  const assertAuthority = () => {
    if (failed)
      throw first;
    if (!live)
      throw retained(leaseFailure);
  };
  const assertRead = async () => {
    assertAuthority();
    calls.read++;
    events.push('read');
    if (!writersAbsent)
      throw retained(writerFailure);
    if ((await readFile(registryPath, 'utf8')) !== 'original-registry')
      throw retained(registryFailure);
    assertAuthority();
  };
  const assertFull = async () => {
    assertAuthority();
    calls.full++;
    events.push('full');
    if (!writersAbsent)
      throw retained(writerFailure);
    if ((await readFile(registryPath, 'utf8')) !== 'original-registry')
      throw retained(registryFailure);
    let competitor = false;
    try {
      await readFile(competitorPath);
      competitor = true;
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error;
    }
    if ((await readFile(payloadPath, 'utf8')) !== 'expected-payload' || competitor)
      throw retained(contentFailure);
    assertAuthority();
  };
  const selected = await store.inspect(assertAuthority);
  const select = { slots: selected.slots, assertAuthority, assertExternalSelection: assertFull };
  const expectedSlots: Record<CrashSafeFileSlot, Uint8Array | undefined> = { current: undefined, next: undefined, backup: undefined };
  const expectedIdentities: Record<CrashSafeFileSlot, CrashSafeFileSlotIdentity | undefined> = { current: undefined, next: undefined, backup: undefined };
  for (const key of ['current', 'next', 'backup'] as const) {
    expectedSlots[key] = selected.slots[key]?.bytes;
    expectedIdentities[key] = selected.slots[key]?.identity;
  }
  const byteSelection: CrashSafeByteSlotSelection = { expectedSlots, expectedIdentities, assertAuthority, assertExternalSelection: assertFull };
  let prefixReads = 0;
  const readSelection: ReadSelection = { async assertBeforeSlotRead() { prefixReads++; await assertRead(); } };
  const realRead = fs.readSlot.bind(fs);
  fs.readSlot = async (...args) => { calls.slots++; events.push(`slot:${args[0]}`); return realRead(...args); };
  for (const method of ['prepareDirectory', 'createNextWriter', 'moveSlot', 'removeSlot', 'syncDirectory'] as const) {
    const original = fs[method].bind(fs);
    Object.defineProperty(fs, method, {
      configurable: true, enumerable: true, writable: true,
      value: async (...args: unknown[]) => {
        const index = method === 'moveSlot' ? 2 : method === 'removeSlot' ? 1 : 0;
        const guard = args[index] as CrashSafeFileSlotMutationGuard | undefined;
        if (guard !== undefined)
          args[index] = {
            assertAuthority: guard.assertAuthority,
            async beforeMutation() { await guard.beforeMutation(); assertAuthority(); events.push(`authorized:${method}`); calls.mutations++; }
          };
        return Reflect.apply(original, fs, args);
      }
    });
  }
  const pending: Promise<unknown>[] = [], releases: (() => void)[] = [];
  const run = (read: ReadSelection | undefined = readSelection, intermediate?: {
    assertAfterSlotRead(): Promise<void>;
  }) => {
    const work = mode === 'published' ? Reflect.apply(store.advance, store, [journal('quarantined'), select, read, intermediate]) as Promise<Readonly<CrashSafeFileSlotIdentity>> : store.recover(select, read);
    pending.push(work.catch(error => error));
    return work;
  };
  const snapshot = async () => {
    const result: Record<string, string> = {};
    for (const name of await readdir(paths.directoryPath))
      result[name] = (await readFile(join(paths.directoryPath, name))).toString('hex');
    for (const [name, path] of Object.entries({ payload: payloadPath, registry: registryPath, competitor: competitorPath })) {
      try {
        result[name] = (await readFile(path)).toString('hex');
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw error;
      }
    }
    return result;
  };
  test.onTestFinished(async () => {
    for (const release of releases)
      release();
    await Promise.allSettled(pending);
    if (test.task.result?.state === 'pass')
      await rm(root, { recursive: true, force: true });
  });
  io.root = root;
  io.path = paths.currentPath;
  return {
    root, paths, fs, store, bytes, select, byteSelection, readSelection, run, snapshot, payloadPath, competitorPath, registryPath,
    events, calls, get prefixReads() { return prefixReads; }, releases, assertAuthority, assertFull, assertRead, leaseFailure, writerFailure, contentFailure, registryFailure,
    expire() { live = false; }, returnWriter() { writersAbsent = false; }
  };
}
