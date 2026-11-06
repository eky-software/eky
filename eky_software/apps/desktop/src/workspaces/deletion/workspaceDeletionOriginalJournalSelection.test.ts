import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { ProfileRestoreActivationJournalStore } from '../../profileBackup/restore/profileRestoreActivationJournalStore.js';
import { createAdoptionJournal } from '../adoption/workspaceLegacyAdoptionTestSupport.js';
import { WorkspaceLegacyAdoptionJournalStore, createWorkspaceLegacyAdoptionJournalPaths } from '../adoption/workspaceLegacyAdoptionJournal.js';
import { WorkspaceBackupImportJournalStore } from '../import/workspaceBackupImportJournalStore.js';
import { WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from '../import/workspaceBackupImportJournalPaths.js';
import { deriveWorkspaceBackupImportPaths } from '../import/workspaceBackupImportPaths.js';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { deriveWorkspaceBackupReplacementOperationsPaths } from '../replacement/workspaceBackupReplacementPaths.js';
import { deletionTestJournal } from './workspaceDeletionDataTestSupport.js';
import { captureDeletionInventoryHeader } from './workspaceDeletionInventoryCodec.js';
import { captureWorkspaceDeletionJournal, workspaceDeletionOriginalJournalOwners,
  type WorkspaceDeletionJournal, type WorkspaceDeletionOriginalJournalProof } from './workspaceDeletionJournalCodec.js';
import { captureWorkspaceDeletionOriginalJournalContinuation, captureWorkspaceDeletionOriginalJournals,
  type WorkspaceDeletionOriginalJournalSelection } from './workspaceDeletionOriginalJournalSelection.js';
import { deriveWorkspaceReplacementRemnantRoot } from './workspaceReplacementRemnantPaths.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingKey, workspaceRemnantBindingSha256 } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';
import { remnantBindingFixture } from './workspaceRemnantBindingTestSupport.js';

type Owner = WorkspaceDeletionOriginalJournalProof['owner'];
async function fixture(test: TestContext, owner?: Owner) {
  const base = await remnantBindingFixture(test);
  const target = captureDeletionInventoryHeader({ ...deletionTestJournal().target,
    workspaceId: base.binding.workspaceId, lineageIdentity: base.binding.lineageIdentity });
  const imported = new WorkspaceBackupImportJournalStore({ installationRoot: base.root,
    filePath: join(base.root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME) });
  const adopted = new WorkspaceLegacyAdoptionJournalStore(base.root);
  const activationPath = deriveWorkspaceBackupReplacementOperationsPaths(base.root).activationJournalPath;
  const activated = new ProfileRestoreActivationJournalStore(activationPath);
  const first = new Error('SYNTHETIC_ORIGINAL_SELECTION_EXPIRED'), writerError = new Error('SYNTHETIC_ORIGINAL_WRITER_PRESENT');
  let active = true, writer = false;
  const jobs: Promise<unknown>[] = [], receipts: WorkspaceDeletionOriginalJournalSelection[] = [], releases: (() => void)[] = [];
  const track = <T>(work: Promise<T>): Promise<T> => { jobs.push(work); return work; };
  const authority = { assertAuthority() { test.signal.throwIfAborted(); if (!active) throw first; base.authority.assertAuthority(); },
    async assertExternalSelection() { authority.assertAuthority(); await base.authority.assertExternalSelection(); },
    async assertWritersAbsent() { authority.assertAuthority(); if (writer) throw writerError; } };
  test.onTestFinished(async () => {
    active = false; for (const release of releases) release();
    await Promise.allSettled(jobs); for (const receipt of receipts) receipt.revoke(); vi.restoreAllMocks();
  });
  const binding = (kind: Owner) => captureWorkspaceRemnantBinding({ ...base.binding, owner: kind });
  const bindingPath = (kind: Owner) => createWorkspaceRemnantBindingPaths(base.root, workspaceRemnantBindingKey(binding(kind))).currentPath;
  const journalPath = (kind: Owner) => kind === 'workspaceImport' ? join(base.root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME)
    : kind === 'workspaceLegacyAdoption' ? createWorkspaceLegacyAdoptionJournalPaths(base.root).currentPath : activationPath;
  const publishBinding = (kind: Owner) => track(new WorkspaceRemnantBindingStore(base.root, workspaceRemnantBindingKey(binding(kind))).publish(binding(kind), authority));
  const add = (kind: Owner) => track((async () => {
    authority.assertAuthority(); await publishBinding(kind);
    if (kind === 'workspaceImport') await imported.write({ formatVersion: 2, operationId: base.binding.operationId,
      workspaceId: target.workspaceId, workspaceLabel: 'Synthetic selected original', createdAt: '2026-11-02T00:00:00.000Z',
      previousActiveWorkspaceId: null, state: 'prepared', lineageIdentity: null });
    else if (kind === 'workspaceLegacyAdoption') await adopted.write({ ...createAdoptionJournal('prepared'),
      operationId: base.binding.operationId, workspaceId: target.workspaceId });
    else {
      await mkdir(dirname(activationPath), { recursive: true, mode: 0o700 });
      await activated.write({ formatVersion: 1, operationId: base.binding.operationId, phase: 'prepared', revision: 0,
        hadActiveDatabase: true, hadActiveDocuments: true });
    }
    authority.assertAuthority();
  })());
  const capture = () => track((async () => {
    const receipt = await captureWorkspaceDeletionOriginalJournals(base.root, target, authority);
    receipts.push(receipt); authority.assertAuthority(); return receipt;
  })());
  const continueSelection = (journal: WorkspaceDeletionJournal, registryState: 'before' | 'after') => track((async () => {
    const receipt = await captureWorkspaceDeletionOriginalJournalContinuation(base.root, journal, registryState, authority);
    receipts.push(receipt); authority.assertAuthority(); return receipt;
  })());
  const snapshot = () => track((async () => {
    const values: Record<string, string | null> = {};
    const paths = new Set(workspaceDeletionOriginalJournalOwners.flatMap(kind => [journalPath(kind), bindingPath(kind)]));
    for (const path of paths) for (const suffix of ['', '.next', '.backup']) {
      try { values[path + suffix] = (await readFile(path + suffix)).toString('hex'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; values[path + suffix] = null; }
    }
    return values;
  })());
  if (owner !== undefined) await add(owner);
  return { root: base.root, target, binding, bindingPath, journalPath, imported, capture, continueSelection, snapshot, publishBinding, add,
    authority, first, writerError, releases, run: <T>(work: () => Promise<T>) => track(work()),
    stop() { active = false; }, addWriter() { writer = true; }, changeTarget: base.changeTarget };
}

// A validated phase fixture with native original commitments, not a startup/lease or physical-deletion proof.
function continuationJournal(target: unknown, proofs: readonly WorkspaceDeletionOriginalJournalProof[], phase: WorkspaceDeletionJournal['phase'] = 'authorized') {
  return captureWorkspaceDeletionJournal({ ...deletionTestJournal(phase), target, formatVersion: 2, originalJournalProofs: proofs });
}

it.for(workspaceDeletionOriginalJournalOwners)('compares a continued %s owner against the original native commitments without writes', async (owner, test) => {
  const f = await fixture(test, owner);
  await f.run(async () => {
    const original = await f.capture(), journal = continuationJournal(f.target, original.proofs), before = await f.snapshot();
    const selected = await f.continueSelection(journal, 'before');
    expect(selected.proofs).toEqual(original.proofs); await selected.assertSelected(); expect(await f.snapshot()).toEqual(before);
    selected.revoke(); await expect(selected.assertSelected()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  });
});

it.for(['authorizedBefore', 'purgedBefore', 'purgedAfter', 'terminalAfter'] as const)(
  'admits missing original slots only for the purged after-registry fixture (%s)', async (state, test) => {
    const f = await fixture(test, 'workspaceImport');
    await f.run(async () => {
      const original = await f.capture(), journal = continuationJournal(f.target, original.proofs,
        state === 'terminalAfter' ? 'registryPublished' : state === 'authorizedBefore' ? 'authorized' : 'purged');
      await unlink(f.journalPath('workspaceImport'));
      const before = await f.snapshot(), afterRegistry = state.endsWith('After');
      if (afterRegistry) {
        const selected = await f.continueSelection(journal, 'after'); await selected.assertSelected();
        expect(selected.proofs).toEqual(original.proofs);
      } else await expect(f.continueSelection(journal, 'before')).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
      expect(await f.snapshot()).toEqual(before);
    });
  },
);

it.for(['binding', 'original'] as const)('compares original commitments and pins the newly observed %s identity', async (changed, test) => {
  const f = await fixture(test, 'workspaceImport');
  await f.run(async () => {
    const original = await f.capture(), journal = continuationJournal(f.target, original.proofs);
    const path = changed === 'binding' ? f.bindingPath('workspaceImport') : f.journalPath('workspaceImport');
    const bytes = await readFile(path); await rename(path, path + '.retained'); await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
    const before = await f.snapshot();
    if (changed === 'original') await expect(f.continueSelection(journal, 'before')).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    else {
      // Original proofs bind canonical binding bytes, not a historical binding-file identity.
      const selected = await f.continueSelection(journal, 'before'); await selected.assertSelected();
      await rename(path, path + '.second-retained'); await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
      await expect(selected.assertSelected()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    }
    expect(await f.snapshot()).toEqual(before); expect(await readFile(path + '.retained')).toEqual(bytes);
  });
});

it('rejects an unproved original group and keeps V1 from acquiring a continuation exception', async test => {
  const f = await fixture(test, 'workspaceImport');
  await f.run(async () => {
    const original = await f.capture(), journal = continuationJournal(f.target, original.proofs);
    await f.add('workspaceLegacyAdoption'); const before = await f.snapshot();
    await expect(f.continueSelection(journal, 'before')).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    await expect(f.continueSelection(deletionTestJournal(), 'before')).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    expect(await f.snapshot()).toEqual(before);
  });
});

it.for(workspaceDeletionOriginalJournalOwners)('keeps a continued %s proof after both metadata files are gone and rejects a returning payload', async (owner, test) => {
  const f = await fixture(test, owner);
  await f.run(async () => {
    const original = await f.capture(), journal = continuationJournal(f.target, original.proofs, 'purged');
    await unlink(f.journalPath(owner)); await unlink(f.bindingPath(owner));
    const before = await f.snapshot(), selected = await f.continueSelection(journal, 'after');
    expect(selected.proofs).toEqual(original.proofs); await selected.assertSelected(); expect(await f.snapshot()).toEqual(before);
    const binding = f.binding(owner), path = owner === 'workspaceReplacement' || owner === 'workspaceActivationMigration'
      ? deriveWorkspaceReplacementRemnantRoot(f.root, binding.workspaceId, binding.operationId, 'activationFailed').rootPath
      : deriveWorkspaceBackupImportPaths(f.root, validateWorkspaceBackupImportOperationId(binding.operationId), binding.workspaceId).candidateRoot;
    await mkdir(path, { recursive: true, mode: 0o700 }); const payload = join(path, 'retained');
    await writeFile(payload, 'returned original payload', { mode: 0o600, flag: 'wx' });
    await expect(selected.assertSelected()).rejects.toThrow(); await expect(f.continueSelection(journal, 'after')).rejects.toThrow();
    expect(await readFile(payload, 'utf8')).toBe('returned original payload'); expect(await f.snapshot()).toEqual(before);
  });
});

it('checks a late activation counteralias even when the original journal and selected binding are absent', async test => {
  const f = await fixture(test, 'workspaceReplacement');
  await f.run(async () => {
    const original = await f.capture(), journal = continuationJournal(f.target, original.proofs, 'purged');
    await unlink(f.journalPath('workspaceReplacement')); await unlink(f.bindingPath('workspaceReplacement'));
    const selected = await f.continueSelection(journal, 'after'); await f.publishBinding('workspaceActivationMigration');
    const before = await f.snapshot(); await expect(selected.assertSelected()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    await expect(f.continueSelection(journal, 'after')).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    expect(await f.snapshot()).toEqual(before);
  });
});

it('brackets a complete original selection without recursively rereading the target for each slot', async test => {
  const f = await fixture(test, 'workspaceImport');
  await f.run(async () => {
    let selections = 0;
    const authority = { ...f.authority, async assertExternalSelection() { selections++; await f.authority.assertExternalSelection(); } };
    const receipt = await captureWorkspaceDeletionOriginalJournals(f.root, f.target, authority);
    try {
      selections = 0; await receipt.assertSelected();
      expect(selections).toBe(4);
      const inspect = WorkspaceRemnantBindingStore.prototype.inspect;
      vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'inspect').mockImplementationOnce(async function (this: WorkspaceRemnantBindingStore, ...args) {
        const result = await inspect.apply(this, args); f.changeTarget(); return result;
      });
      const before = await f.snapshot();
      await expect(receipt.assertSelected()).rejects.toThrow('SYNTHETIC_TARGET_CHANGED');
      expect(await f.snapshot()).toEqual(before);
    } finally { receipt.revoke(); }
  });
});

it.for(workspaceDeletionOriginalJournalOwners)('selects the actual %s original journal and copied commitments', async (owner, test) => {
  const f = await fixture(test, owner);
  await f.run(async () => {
    const before = await f.snapshot(), receipt = await f.capture();
    expect(receipt.proofs).toHaveLength(1);
    const proof = receipt.proofs[0]!, bytes = await readFile(f.journalPath(owner));
    expect(proof.owner).toBe(owner); expect(proof.bindingSha256).toBe(workspaceRemnantBindingSha256(f.binding(owner)));
    expect(proof.slots.current!.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(Object.isFrozen(receipt.proofs)).toBe(true);
    await receipt.assertSelected(); expect(await f.snapshot()).toEqual(before);
    receipt.revoke(); await expect(receipt.assertSelected()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  });
});

it('selects all three fixed owners canonically and never guesses an activation alias', async test => {
  const f = await fixture(test);
  await f.run(async () => {
    for (const owner of ['workspaceImport', 'workspaceLegacyAdoption', 'workspaceActivationMigration'] as const) await f.add(owner);
    const before = await f.snapshot(), selected = await f.capture();
    expect(selected.proofs.map(proof => proof.owner)).toEqual(['workspaceImport', 'workspaceLegacyAdoption', 'workspaceActivationMigration']);
    await selected.assertSelected(); expect(await f.snapshot()).toEqual(before);
  });
});

it('returns no original proof for absent journals while preserving orphan bindings', async test => {
  const f = await fixture(test);
  await f.run(async () => {
    await f.publishBinding('workspaceImport');
    const before = await f.snapshot(), selected = await f.capture();
    expect(selected.proofs).toEqual([]); await selected.assertSelected(); expect(await f.snapshot()).toEqual(before);
    await f.add('workspaceLegacyAdoption');
    const after = await f.snapshot(); await expect(selected.assertSelected()).rejects.toThrow();
    expect(await f.snapshot()).toEqual(after);
  });
});

it.for(['next', 'backup'] as const)('observes an owner-validated %s-only original without promoting it', async (slot, test) => {
  const f = await fixture(test, 'workspaceImport');
  await f.run(async () => {
    await rename(f.journalPath('workspaceImport'), f.journalPath('workspaceImport') + '.' + slot);
    const before = await f.snapshot(), selected = await f.capture();
    expect(selected.proofs[0]!.slots.current).toBeNull(); expect(selected.proofs[0]!.slots[slot]).not.toBeNull();
    await selected.assertSelected(); expect(await f.snapshot()).toEqual(before);
  });
});

it.for(['binding', 'original', 'foreignTarget', 'missingBinding', 'threeSlots'] as const)(
  'rejects %s selection changes without adopting or clearing evidence', async (attack, test) => {
    const f = await fixture(test, 'workspaceImport');
    await f.run(async () => {
      const selected = await f.capture();
      const path = attack === 'binding' || attack === 'missingBinding' ? f.bindingPath('workspaceImport') : f.journalPath('workspaceImport');
      if (attack === 'binding' || attack === 'original' || attack === 'missingBinding') {
        const bytes = await readFile(path); await rename(path, path + '.retained-original');
        if (attack !== 'missingBinding') await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
      } else if (attack === 'foreignTarget') {
        await writeFile(f.bindingPath('workspaceImport'), Buffer.from(JSON.stringify({ ...f.binding('workspaceImport'), workspaceId: '00000000-0000-4000-8000-000000000099' }) + '\n'));
      } else {
        const bytes = await readFile(path); for (const suffix of ['.next', '.backup']) await writeFile(path + suffix, bytes, { flag: 'wx', mode: 0o600 });
      }
      const after = await f.snapshot(); await expect(selected.assertSelected()).rejects.toThrow();
      expect(await f.snapshot()).toEqual(after);
      if (attack === 'binding' || attack === 'original') {
        const fresh = await f.capture(); await fresh.assertSelected();
      } else await expect(f.capture()).rejects.toThrow();
      expect(await f.snapshot()).toEqual(after);
    });
  },
);

it('rejects an activation journal with two owner aliases and a late second alias', async test => {
  const f = await fixture(test, 'workspaceReplacement');
  await f.run(async () => {
    const selected = await f.capture(); await f.publishBinding('workspaceActivationMigration');
    const before = await f.snapshot(); await expect(selected.assertSelected()).rejects.toThrow();
    await expect(f.capture()).rejects.toThrow(); expect(await f.snapshot()).toEqual(before);
  });
});

it('retains the first writer failure when a later owner loss is observed', async test => {
  const f = await fixture(test, 'workspaceImport');
  await f.run(async () => {
    const selected = await f.capture(), before = await f.snapshot(); f.addWriter();
    await expect(selected.assertSelected()).rejects.toBe(f.writerError);
    f.stop(); await expect(selected.assertSelected()).rejects.toBe(f.writerError);
    expect(await f.snapshot()).toEqual(before);
  });
});

it('joins a delayed original-owner read before rejecting a late result', async test => {
  const f = await fixture(test, 'workspaceImport');
  await f.run(async () => {
    const inspect = WorkspaceBackupImportJournalStore.prototype.inspectSlots;
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    f.releases.push(release);
    vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'inspectSlots').mockImplementationOnce(async function(this: WorkspaceBackupImportJournalStore, ...args) {
      const result = await inspect.apply(this, args); entered(); await held; return result;
    });
    let settled = false;
    const result = f.capture().then(() => undefined, error => error as unknown).finally(() => { settled = true; });
    try {
      await Promise.race([started, result.then(() => { throw new Error('ORIGINAL_READ_NOT_HELD'); })]);
      f.stop(); await Promise.resolve(); expect(settled).toBe(false);
    } finally { release(); }
    expect(await result).toBe(f.first);
  });
});

it.for(['default', 'owned'] as const)(
  'preserves original receipt bookends and writer counts (%s)', async (mode, test) => {
    const f = await fixture(test);
    await f.run(async () => {
      const events: string[] = [];
      const authority = { ...f.authority,
        async assertExternalSelection() { events.push('full'); await f.authority.assertExternalSelection(); },
        async assertWritersAbsent() { events.push('writers'); await f.authority.assertWritersAbsent(); },
      };
      const owned = async () => { events.push('owned'); f.authority.assertAuthority(); };
      const receipt = mode === 'default'
        ? await captureWorkspaceDeletionOriginalJournals(f.root, f.target, authority)
        : await captureWorkspaceDeletionOriginalJournals(f.root, f.target, authority, owned);
      try {
        events.length = 0;
        const before = await f.snapshot();
        await receipt.assertSelected();
        const usesOwned = mode === 'owned';
        expect(events).toEqual(usesOwned
          ? ['owned', 'writers', 'full', 'owned', 'writers', 'full']
          : ['full', 'writers', 'full', 'full', 'writers', 'full']);
        expect(events.filter(event => event === 'full')).toHaveLength(usesOwned ? 2 : 4);
        expect(events.filter(event => event === 'owned')).toHaveLength(usesOwned ? 2 : 0);
        expect(events.filter(event => event === 'writers')).toHaveLength(2);
        expect(await f.snapshot()).toEqual(before);
        receipt.revoke(); events.length = 0;
        const nativeRead = vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'inspectSlots');
        await expect(receipt.assertSelected()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
        expect(events).toEqual([]); expect(nativeRead).not.toHaveBeenCalled();
      } finally { receipt.revoke(); }
    });
  },
);

it('keeps continuation on four full selections with no publication-only port', async test => {
  const f = await fixture(test);
  await f.run(async () => {
    const original = await f.capture();
    const full = vi.spyOn(f.authority, 'assertExternalSelection');
    const receipt = await f.continueSelection(continuationJournal(f.target, original.proofs), 'before');
    full.mockClear();
    await receipt.assertSelected();
    expect(full).toHaveBeenCalledTimes(4);
  });
});

it.for(workspaceDeletionOriginalJournalOwners)(
  'retains the native %s commitments through optional publication bookends', async (owner, test) => {
    const f = await fixture(test, owner);
    await f.run(async () => {
      const before = await f.snapshot();
      const original = await f.capture();
      const owned = vi.fn(async () => { f.authority.assertAuthority(); });
      const receipt = await captureWorkspaceDeletionOriginalJournals(f.root, f.target, f.authority, owned);
      try {
        expect(receipt.proofs).toEqual(original.proofs);
        expect(receipt.proofs).toHaveLength(1);
        const proof = receipt.proofs[0]!;
        expect(proof.owner).toBe(owner);
        expect(proof.bindingSha256).toBe(workspaceRemnantBindingSha256(f.binding(owner)));
        expect(proof.slots.current!.sha256).toBe(createHash('sha256').update(await readFile(f.journalPath(owner))).digest('hex'));
        expect(proof.slots.current!.identity).toEqual(original.proofs[0]!.slots.current!.identity);
        owned.mockClear();
        await receipt.assertSelected();
        expect(owned).toHaveBeenCalledTimes(2);
        expect(await f.snapshot()).toEqual(before);
      } finally { receipt.revoke(); }
    });
  },
);

// Callback-level observation model only: this does not emulate native registry identities.
it.for(['default-transient', 'owned-transient', 'owned-persistent'] as const)(
  'observes the modeled registry window according to the selected bookends (%s)', async (mode, test) => {
    const f = await fixture(test);
    await f.run(async () => {
      const registryError = new Error('SYNTHETIC_MODELED_REGISTRY_CHANGED');
      const events: string[] = [];
      let armed = false, changed = false;
      const authority = { ...f.authority,
        async assertExternalSelection() {
          await f.authority.assertExternalSelection();
          events.push(changed ? 'full:changed' : 'full:stable');
          if (changed) throw registryError;
        },
        async assertWritersAbsent() {
          await f.authority.assertWritersAbsent();
          if (armed && mode !== 'owned-persistent') changed = false;
          events.push(changed ? 'writers:changed' : 'writers:stable');
        },
      };
      const owned = async () => {
        f.authority.assertAuthority();
        if (armed) changed = true;
        events.push(changed ? 'owned:changed' : 'owned:stable');
      };
      const receipt = mode === 'default-transient'
        ? await captureWorkspaceDeletionOriginalJournals(f.root, f.target, authority)
        : await captureWorkspaceDeletionOriginalJournals(f.root, f.target, authority, owned);
      try {
        const before = await f.snapshot();
        events.length = 0; armed = true; changed = true;
        if (mode === 'owned-transient') {
          await receipt.assertSelected();
          expect(events).toEqual(['owned:changed', 'writers:stable', 'full:stable',
            'owned:changed', 'writers:stable', 'full:stable']);
        } else {
          await expect(receipt.assertSelected()).rejects.toBe(registryError);
          expect(events).toEqual(mode === 'default-transient' ? ['full:changed']
            : ['owned:changed', 'writers:changed', 'full:changed']);
          armed = false; changed = false; events.length = 0;
          await expect(receipt.assertSelected()).rejects.toBe(registryError);
          expect(events).toEqual([]);
        }
        expect(await f.snapshot()).toEqual(before);
      } finally { receipt.revoke(); }
    });
  },
);

it.for(['default', 'owned'] as const)(
  'retains the first registry or writer failure in the selected order (%s)', async (mode, test) => {
    const f = await fixture(test);
    await f.run(async () => {
      const registryError = new Error('SYNTHETIC_REGISTRY_FIRST');
      let fail = false;
      const events: string[] = [];
      const authority = { ...f.authority,
        async assertExternalSelection() {
          events.push('full'); await f.authority.assertExternalSelection(); if (fail) throw registryError;
        },
        async assertWritersAbsent() {
          events.push('writers'); await f.authority.assertWritersAbsent();
        },
      };
      const owned = async () => { events.push('owned'); f.authority.assertAuthority(); };
      const receipt = mode === 'default'
        ? await captureWorkspaceDeletionOriginalJournals(f.root, f.target, authority)
        : await captureWorkspaceDeletionOriginalJournals(f.root, f.target, authority, owned);
      try {
        const before = await f.snapshot();
        fail = true; f.addWriter(); events.length = 0;
        const usesOwned = mode === 'owned';
        const expected = usesOwned ? f.writerError : registryError;
        await expect(receipt.assertSelected()).rejects.toBe(expected);
        expect(events).toEqual(usesOwned ? ['owned', 'writers'] : ['full']);
        events.length = 0; f.stop();
        await expect(receipt.assertSelected()).rejects.toBe(expected);
        receipt.revoke();
        await expect(receipt.assertSelected()).rejects.toBe(expected);
        expect(events).toEqual([]);
        expect(await f.snapshot()).toEqual(before);
      } finally { receipt.revoke(); }
    });
  },
);

it.for(['error', 'undefined'] as const)(
  'retains an owned-read %s rejection and rejects receipt reuse without more reads', async (kind, test) => {
    const f = await fixture(test);
    await f.run(async () => {
      const first: unknown = kind === 'error' ? new Error('SYNTHETIC_OWNED_READ_FAILED') : undefined;
      let fail = false;
      const full = vi.fn(async () => { await f.authority.assertExternalSelection(); });
      const writers = vi.fn(async () => { await f.authority.assertWritersAbsent(); });
      const owned = vi.fn(async () => { f.authority.assertAuthority(); if (fail) throw first; });
      const receipt = await captureWorkspaceDeletionOriginalJournals(f.root, f.target, {
        ...f.authority, assertExternalSelection: full, assertWritersAbsent: writers,
      }, owned);
      try {
        const before = await f.snapshot();
        full.mockClear(); writers.mockClear(); owned.mockClear();
        const nativeRead = vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'inspectSlots');
        fail = true;
        await expect(receipt.assertSelected()).rejects.toBe(first);
        fail = false;
        await expect(receipt.assertSelected()).rejects.toBe(first);
        f.stop(); receipt.revoke();
        await expect(receipt.assertSelected()).rejects.toBe(first);
        expect(owned).toHaveBeenCalledTimes(1);
        expect(full).not.toHaveBeenCalled(); expect(writers).not.toHaveBeenCalled();
        expect(nativeRead).not.toHaveBeenCalled();
        expect(await f.snapshot()).toEqual(before);
      } finally { receipt.revoke(); }
    });
  },
);

it.for(['originalIdentity', 'bindingIdentity', 'nextSlot', 'backupSlot', 'lateAlias'] as const)(
  'rejects a late native %s change through optional publication bookends', async (change, test) => {
    const owner = change === 'lateAlias' ? 'workspaceReplacement' : 'workspaceImport';
    const f = await fixture(test, owner);
    await f.run(async () => {
      const owned = vi.fn(async () => { f.authority.assertAuthority(); });
      const receipt = await captureWorkspaceDeletionOriginalJournals(f.root, f.target, f.authority, owned);
      try {
        const path = change === 'bindingIdentity' ? f.bindingPath(owner) : f.journalPath(owner);
        const bytes = await readFile(path);
        if (change === 'originalIdentity' || change === 'bindingIdentity') {
          await rename(path, path + '.retained-original');
          await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
        } else if (change === 'lateAlias') await f.publishBinding('workspaceActivationMigration');
        else await writeFile(path + (change === 'nextSlot' ? '.next' : '.backup'), bytes, { mode: 0o600, flag: 'wx' });
        const changed = await f.snapshot(); owned.mockClear();
        await expect(receipt.assertSelected()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
        expect(owned).toHaveBeenCalledTimes(1);
        expect(await f.snapshot()).toEqual(changed);
        expect(await readFile(path)).toEqual(bytes);
        if (change === 'originalIdentity' || change === 'bindingIdentity') {
          expect(await readFile(path + '.retained-original')).toEqual(bytes);
          await unlink(path); await rename(path + '.retained-original', path);
        }
        owned.mockClear();
        await expect(receipt.assertSelected()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
        expect(owned).not.toHaveBeenCalled();
      } finally { receipt.revoke(); }
    });
  },
);
