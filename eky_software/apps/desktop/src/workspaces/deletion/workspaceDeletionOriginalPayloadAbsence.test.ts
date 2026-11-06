import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, it, type TestContext } from 'vitest';
import { deriveWorkspaceLegacyRuntimePaths } from '../adoption/workspaceLegacyAdoptionPaths.js';
import { workspaceOwnedEntryNames } from '../adoption/workspaceLegacyAdoptionRootStore.js';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { deriveWorkspaceBackupImportPaths } from '../import/workspaceBackupImportPaths.js';
import { workspaceDeletionOriginalJournalOwners, type WorkspaceDeletionOriginalJournalProof } from './workspaceDeletionJournalCodec.js';
import { captureWorkspaceDeletionOriginalPayloadAbsence as capture } from './workspaceDeletionOriginalPayloadAbsence.js';
import { remnantBindingFixture } from './workspaceRemnantBindingTestSupport.js';
import { deriveWorkspaceReplacementRemnantRoot } from './workspaceReplacementRemnantPaths.js';

async function fixture(test: TestContext, owner: WorkspaceDeletionOriginalJournalProof['owner'] = 'workspaceImport') {
  const f = await remnantBindingFixture(test, owner), work: Promise<unknown>[] = [];
  let writersAbsent = true;
  const authority = { ...f.authority, assertAuthority() { test.signal.throwIfAborted(); f.authority.assertAuthority(); },
    async assertWritersAbsent() { if (!writersAbsent) throw new Error('SYNTHETIC_ORIGINAL_WRITER_PRESENT'); } };
  test.onTestFinished(async () => { f.expire(); await Promise.allSettled(work); });
  const payloadRoot = owner === 'workspaceImport' || owner === 'workspaceLegacyAdoption'
    ? deriveWorkspaceBackupImportPaths(f.root, validateWorkspaceBackupImportOperationId(f.binding.operationId), f.binding.workspaceId).candidateRoot
    : deriveWorkspaceReplacementRemnantRoot(f.root, f.binding.workspaceId, f.binding.operationId, 'activationFailed').rootPath;
  const track = <T>(pending: Promise<T>) => { work.push(pending); return pending; };
  return { ...f, payloadRoot, authority, track,
    capture: () => track(capture(f.root, f.binding, authority)), addWriter() { writersAbsent = false; } };
}

it.for(workspaceDeletionOriginalJournalOwners)('proves fixed %s root absence without recreating retired bindings', async (owner, test) => {
  const f = await fixture(test, owner);
  await f.track((async () => {
    const before = await readdir(f.root), selected = await f.capture();
    await selected.assertAbsent(); expect(await readdir(f.root)).toEqual(before);
  })());
});

it.for(workspaceDeletionOriginalJournalOwners)('preserves a returned %s payload and refuses metadata retirement', async (owner, test) => {
  const f = await fixture(test, owner);
  await f.track((async () => {
    const selected = await f.capture();
    await mkdir(f.payloadRoot, { recursive: true, mode: 0o700 });
    await writeFile(join(f.payloadRoot, 'retained'), 'synthetic returned payload', { flag: 'wx', mode: 0o600 });
    await expect(selected.assertAbsent()).rejects.toThrow();
    expect(await readFile(join(f.payloadRoot, 'retained'), 'utf8')).toBe('synthetic returned payload');
    await expect(f.capture()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  })());
});

it('pins an absent operation parent instead of adopting a later empty directory', async test => {
  const f = await fixture(test);
  await f.track((async () => {
    const selected = await f.capture(); await mkdir(dirname(f.payloadRoot), { recursive: true, mode: 0o700 });
    await expect(selected.assertAbsent()).rejects.toThrow();
    expect(await readdir(dirname(f.payloadRoot))).toEqual([]);
  })());
});

it('preserves reappearing legacy owned entries without opening a database', async test => {
  const f = await fixture(test, 'workspaceLegacyAdoption');
  await f.track((async () => {
    const legacy = deriveWorkspaceLegacyRuntimePaths(f.root).legacyRuntimeRoot;
    await mkdir(legacy, { mode: 0o700 });
    const selected = await f.capture(), entry = join(legacy, workspaceOwnedEntryNames[0]!);
    await mkdir(entry, { mode: 0o700 }); await writeFile(join(entry, 'retained'), 'synthetic legacy bytes', { flag: 'wx', mode: 0o600 });
    await expect(selected.assertAbsent()).rejects.toThrow();
    expect(await readFile(join(entry, 'retained'), 'utf8')).toBe('synthetic legacy bytes');
  })());
});

it('retains the first writer failure after a later ownership loss', async test => {
  const f = await fixture(test);
  await f.track((async () => {
    const selected = await f.capture(); f.addWriter();
    const first = await selected.assertAbsent().then(() => undefined, error => error as Error);
    expect(first?.message).toBe('SYNTHETIC_ORIGINAL_WRITER_PRESENT'); f.expire();
    await expect(selected.assertAbsent()).rejects.toBe(first);
  })());
});
