import { chmod, link, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, type TestContext } from 'vitest';
import { createNodeCrashSafeFileSlotFileSystem, type CrashSafeFileSlot } from '../persistence/crashSafeFileSlot.js';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import { deletionTestDigest as hash, deletionTestJournal as journal } from './workspaceDeletionDataTestSupport.js';
import { captureWorkspaceDeletionJournal, maximumWorkspaceDeletionJournalBytes, serializeWorkspaceDeletionJournal,
  workspaceDeletionPhases, type WorkspaceDeletionJournalV1 } from './workspaceDeletionJournalCodec.js';
import { inspectWorkspaceDeletionJournal, planWorkspaceDeletionJournalSlots } from './workspaceDeletionJournalSlots.js';

function slots(values: Partial<Record<CrashSafeFileSlot, WorkspaceDeletionJournalV1>>): ReadOnlyJournalSlots<WorkspaceDeletionJournalV1> {
  const record = (value?: WorkspaceDeletionJournalV1) => value === undefined ? undefined
    : { value, bytes: serializeWorkspaceDeletionJournal(value) };
  return { current: record(values.current), next: record(values.next), backup: record(values.backup) };
}

it('distinguishes absence and unpublished initial-next without selecting either for deletion', () => {
  expect(planWorkspaceDeletionJournalSlots(slots({}))).toEqual({ mode: 'absent' });
  expect(planWorkspaceDeletionJournalSlots(slots({ next: journal() }))).toEqual({ mode: 'unpublished' });
  expect(() => planWorkspaceDeletionJournalSlots(slots({ next: journal('quarantined') }))).toThrow();
});

for (const [index, phase] of workspaceDeletionPhases.entries()) {
  it(`accepts published ${phase} alone but only terminal-current permits technical finalization`, () => {
    expect(planWorkspaceDeletionJournalSlots(slots({ current: journal(phase) }))).toMatchObject({
      mode: 'published', selected: journal(phase), terminalOnly: phase === 'registryPublished',
    });
    expect(planWorkspaceDeletionJournalSlots(slots({ backup: journal(phase) }))).toMatchObject({
      mode: 'published', selected: journal(phase), terminalOnly: false,
    });
  });
  for (const [siblingIndex, sibling] of workspaceDeletionPhases.entries()) {
    it(`validates both interruption directions for ${phase} / ${sibling}`, () => {
      const currentBackup = slots({ current: journal(phase), backup: journal(sibling) });
      const currentNext = slots({ current: journal(phase), next: journal(sibling) });
      const backupNext = slots({ backup: journal(phase), next: journal(sibling) });
      if (index === siblingIndex + 1) expect(planWorkspaceDeletionJournalSlots(currentBackup)).toMatchObject({ mode: 'published', selected: journal(phase), terminalOnly: false });
      else expect(() => planWorkspaceDeletionJournalSlots(currentBackup)).toThrow();
      for (const pair of [currentNext, backupNext]) {
        if (siblingIndex === index + 1) expect(planWorkspaceDeletionJournalSlots(pair)).toMatchObject({ mode: 'published', selected: journal(phase), terminalOnly: false });
        else expect(() => planWorkspaceDeletionJournalSlots(pair)).toThrow();
      }
    });
  }
}

it('rejects immutable binding conflicts and three simultaneous slots', () => {
  const other = captureWorkspaceDeletionJournal({ ...journal('quarantined'),
    inventory: { ...journal().inventory, sha256: hash('foreign') } });
  expect(() => planWorkspaceDeletionJournalSlots(slots({ current: journal(), next: other }))).toThrow();
  expect(() => planWorkspaceDeletionJournalSlots(slots({ backup: journal(), current: journal('quarantined'), next: journal('purgeAuthorized') }))).toThrow();
});

async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-deletion-slots-'));
  await chmod(root, 0o700);
  context.onTestFinished(async () => {
    if (context.task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  const directoryPath = join(root, 'state');
  const paths = { directoryPath, currentPath: join(directoryPath, 'journal.json'),
    nextPath: join(directoryPath, 'journal.json.next'), backupPath: join(directoryPath, 'journal.json.backup') };
  const fs = createNodeCrashSafeFileSlotFileSystem(paths, maximumWorkspaceDeletionJournalBytes);
  return { root, paths, fs, async write(slot: CrashSafeFileSlot, bytes: Uint8Array) {
    await mkdir(directoryPath, { mode: 0o700, recursive: true });
    await writeFile(paths[`${slot}Path`], bytes, { flag: 'wx', mode: 0o600 });
  }, async snapshot() {
    const result: Record<string, string> = {};
    for (const name of await readdir(directoryPath)) result[name] = (await readFile(join(directoryPath, name))).toString('hex');
    return result;
  } };
}

it('observes actual bytes and identities without promoting initial-next or repairing a published pair', async context => {
  const f = await fixture(context);
  expect((await inspectWorkspaceDeletionJournal(f.fs, () => undefined)).plan).toEqual({ mode: 'absent' });
  expect(await readdir(f.root)).toEqual([]);
  await f.write('next', serializeWorkspaceDeletionJournal(journal()));
  const unpublished = await f.snapshot();
  expect((await inspectWorkspaceDeletionJournal(f.fs, () => undefined)).plan).toEqual({ mode: 'unpublished' });
  expect(await f.snapshot()).toEqual(unpublished);
  await rm(f.paths.nextPath);
  await f.write('current', serializeWorkspaceDeletionJournal(journal('quarantined')));
  await f.write('backup', serializeWorkspaceDeletionJournal(journal()));
  const published = await f.snapshot();
  const observed = await inspectWorkspaceDeletionJournal(f.fs, () => undefined);
  expect(observed.plan).toMatchObject({ mode: 'published', terminalOnly: false });
  expect(observed.slots.current?.identity?.ino).not.toBe(0);
  expect(await f.snapshot()).toEqual(published);
});

for (const slot of ['next', 'backup'] as const) it(`preserves a valid current and malformed ${slot} sibling on failure`, async context => {
  const f = await fixture(context);
  await f.write('current', serializeWorkspaceDeletionJournal(journal()));
  await f.write(slot, Buffer.from('{"private":"synthetic-only"'));
  const before = await f.snapshot();
  await expect(inspectWorkspaceDeletionJournal(f.fs, () => undefined)).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(await f.snapshot()).toEqual(before);
});

it('rejects a linked slot and preserves both link names', async context => {
  const f = await fixture(context);
  await f.write('current', serializeWorkspaceDeletionJournal(journal()));
  await link(f.paths.currentPath, f.paths.backupPath);
  const before = await f.snapshot();
  await expect(inspectWorkspaceDeletionJournal(f.fs, () => undefined)).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it('does not return a selection after authority expires across a slot read', async context => {
  const f = await fixture(context);
  await f.write('current', serializeWorkspaceDeletionJournal(journal()));
  const before = await f.snapshot();
  let current = true;
  const read = f.fs.readSlot.bind(f.fs);
  f.fs.readSlot = async (...args) => { const bytes = await read(...args); current = false; return bytes; };
  const failure = new Error('SYNTHETIC_AUTHORITY_ENDED');
  await expect(inspectWorkspaceDeletionJournal(f.fs, () => { if (!current) throw failure; })).rejects.toBe(failure);
  expect(await f.snapshot()).toEqual(before);
});
