import { createHash } from 'node:crypto';
import { promises as fileSystem } from 'node:fs';
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProfileRestoreActivationJournal, ProfileRestoreActivationPhase } from './profileRestoreActivationJournal.js';
import {
  profileRestoreActivationJournalFileName,
  ProfileRestoreActivationJournalStore,
} from './profileRestoreActivationJournalStore.js';
import { ProfileRestoreActivationTransaction } from './profileRestoreActivationTransaction.js';
import { ProfileRestoreStartupRecovery } from './profileRestoreStartupRecovery.js';
import { ProfileRestoreActivationService } from './profileRestoreActivationService.js';
import { PreparedProfileRestoreOwner } from './preparedProfileRestoreOwner.js';
import * as fileMoves from './profileRestoreFileMove.js';
import * as cleanupCensus from './profileRestoreTerminalCleanupCensus.js';

const operationId = '11111111-1111-4111-8111-111111111111';
const interruptiblePhases: readonly ProfileRestoreActivationPhase[] = [
  'movingCurrentDatabase',
  'currentDatabaseMoved',
  'movingCurrentDocuments',
  'currentDocumentsMoved',
  'activatingStagedDatabase',
  'stagedDatabaseActivated',
  'activatingStagedDocuments',
  'stagedDocumentsActivated',
  'validationStarting',
];
const roots: string[] = [];

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, mkdir: vi.fn(actual.mkdir), chmod: vi.fn(actual.chmod), rename: vi.fn(actual.rename) };
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(mkdir).mockReset();
  vi.mocked(chmod).mockReset();
  vi.mocked(rename).mockReset();
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('profile restore activation transaction', () => {
  it.each(['ordinary', 'cold'] as const)(
    'uses separate journal content authority only for %s content-bearing recovery', async mode => {
      const f = await createFixture();
      await f.transaction.prepare(operationId);
      const selected = (await f.journalStore.peek())!;
      const writes = vi.spyOn(f.journalStore, 'write');
      const forwardContent = async (journal: Readonly<ProfileRestoreActivationJournal>) => {
        await f.transaction.readForwardRecoverySources(journal);
      };
      const validated = await f.transaction.advanceToValidation(
        selected, async () => {}, mode === 'cold' ? forwardContent : undefined,
      );
      expect(writes.mock.calls.length).toBeGreaterThan(0);
      for (const [, authority] of writes.mock.calls) {
        expect(authority !== undefined && 'kind' in authority ? authority.kind : undefined)
          .toBe(mode === 'cold' ? 'separateContent' : undefined);
      }
      writes.mockClear();
      const rolledBack = await f.transaction.rollback(validated, async () => {}, mode === 'cold' ? {
        assertContent: async journal => { await f.transaction.readRollbackRecoverySources(journal); },
        beforeStagingMove: async () => {},
      } : undefined);
      expect(rolledBack.phase).toBe('rolledBack');
      expect(writes.mock.calls).toHaveLength(2);
      for (const [, authority] of writes.mock.calls) {
        expect(authority !== undefined && 'kind' in authority ? authority.kind : undefined)
          .toBe(mode === 'cold' ? 'separateContent' : undefined);
      }
      expect(await readFile(f.activeDatabasePath, 'utf8')).toBe('old database');
      expect(await readFile(f.activePdfPath, 'utf8')).toBe('old pdf');
    },
  );

  it.each(['current', 'next', 'backup'] as const)(
    'retains a late %s journal during default preparation publication', async slot => {
      const f = await createFixture();
      const journalPath = join(dirname(dirname(f.activeDatabasePath)),
        'profile-restore-state', profileRestoreActivationJournalFileName);
      const path = journalPath + (slot === 'current' ? '' : `.${slot}`);
      const foreign: ProfileRestoreActivationJournal = {
        formatVersion: 1, operationId: '22222222-2222-4222-8222-222222222222',
        phase: 'prepared', revision: 0, hadActiveDatabase: true, hadActiveDocuments: true,
      };
      const bytes = `${JSON.stringify(foreign)}\n`;
      const write = f.journalStore.write.bind(f.journalStore);
      vi.spyOn(f.journalStore, 'write').mockImplementation(async (journal, authority) => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, bytes);
        await write(journal, authority);
      });
      await expect(f.transaction.prepare(operationId)).rejects.toThrow('PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
      expect(await readFile(path, 'utf8')).toBe(bytes);
      expect(await readdir(join(f.rollbackRoot, operationId))).toEqual([]);
      expect(await readFile(f.activeDatabasePath, 'utf8')).toBe('old database');
      expect(await readFile(f.activePdfPath, 'utf8')).toBe('old pdf');
      expect(await readFile(f.stagedPdfPath, 'utf8')).toBe('new pdf');
    },
  );

  it.each(['default', 'selected', 'guarded', 'sameOperationChangedFlags'] as const)(
    'rejects a changed predecessor inside %s forward publication', async mode => {
      const f = await createFixture();
      await f.transaction.prepare(operationId);
      const selected = (await f.journalStore.peek())!;
      const foreign = mode === 'sameOperationChangedFlags'
        ? { ...selected, hadActiveDocuments: false }
        : { ...selected, operationId: '22222222-2222-4222-8222-222222222222' };
      const write = f.journalStore.write.bind(f.journalStore);
      vi.spyOn(f.journalStore, 'write').mockImplementation(async (journal, authority) => {
        if (journal.phase === 'movingCurrentDatabase') await write(foreign);
        await write(journal, authority);
      });
      await expect(f.transaction.advanceToValidation(
        mode === 'default' ? undefined : selected,
        mode === 'guarded' ? async () => {} : undefined,
      )).rejects.toThrow('PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
      expect(await f.journalStore.peek()).toEqual(foreign);
      expect(await readFile(f.activeDatabasePath, 'utf8')).toBe('old database');
      expect(await readFile(f.activePdfPath, 'utf8')).toBe('old pdf');
      expect(await readFile(f.stagedPdfPath, 'utf8')).toBe('new pdf');
    },
  );

  it.each(['operationId', 'revision', 'hadActiveDatabase', 'hadActiveDocuments'] as const)(
    'rejects a changed prepared %s without repairing or adopting its journal', async key => {
      const f = await createFixture();
      let receipt: Readonly<ProfileRestoreActivationJournal> | undefined;
      await f.transaction.prepare(operationId, async () => {}, journal => { receipt = journal; });
      expect(Object.isFrozen(receipt)).toBe(true);
      const changed = { ...receipt!, [key]: {
        operationId: '22222222-2222-4222-8222-222222222222', revision: 1,
        hadActiveDatabase: false, hadActiveDocuments: false,
      }[key] };
      await f.journalStore.write(changed);
      const repair = vi.spyOn(f.journalStore, 'read');
      await expect(f.transaction.readPreparation(operationId, receipt, async () => {})).rejects.toThrow();
      expect(repair).not.toHaveBeenCalled();
      expect(await f.journalStore.peek()).toEqual(changed);
      expect(await readFile(f.activeDatabasePath, 'utf8')).toBe('old database');
    },
  );

  it('does not adopt a prepared journal without the actual preparation receipt', async () => {
    const f = await createFixture();
    await f.transaction.prepare(operationId);
    await expect(f.transaction.readPreparation(operationId, undefined, async () => {}))
      .rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(await f.journalStore.peek()).toMatchObject({ phase: 'prepared', revision: 0 });
  });

  it('rechecks the prepared selection after awaited readback authority', async () => {
    const f = await createFixture();
    await f.transaction.prepare(operationId);
    const receipt = (await f.journalStore.peek())!;
    let calls = 0;
    await expect(f.transaction.readPreparation(operationId, receipt, async () => {
      if (++calls === 2) await f.journalStore.write({ ...receipt, hadActiveDocuments: false });
    })).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    expect(await f.journalStore.peek()).toMatchObject({ hadActiveDocuments: false });
  });

  it('preserves a real published preparation and its first rejected acknowledgement', async () => {
    const f = await createFixture({ interruptedPhase: 'prepared' });
    const activation = createActivationFixture(f.transaction);
    await expect(activation.service.activate(operationId)).rejects.toMatchObject({
      code: 'PROFILE_RESTORE_RECOVERY_REQUIRED', cause: { message: 'synthetic interruption' },
    });
    expect(await f.journalStore.peek()).toMatchObject({ phase: 'prepared', revision: 0 });
    expect(activation.stopBusinessRuntime).not.toHaveBeenCalled();
    expect(activation.relaunchApplication).not.toHaveBeenCalled();
    expect(activation.profileSnapshotClient.cancelProfileRestoreRetention).not.toHaveBeenCalled();
    expect(() => activation.owner.claim(operationId)).toThrow('PROFILE_RESTORE_BUSY');
    expect(await readFile(f.activeDatabasePath, 'utf8')).toBe('old database');
    expect(await readFile(f.stagedPdfPath, 'utf8')).toBe('new pdf');
  });

  it.each(['movingCurrentDatabase', 'currentDatabaseMoved', 'stagedDocumentsActivated', 'validationStarting'] as const)(
    'binds real activation failure at %s to its own progression and selected rollback', async interruptedPhase => {
      const f = await createFixture({ interruptedPhase });
      const activation = createActivationFixture(f.transaction);
      const rollback = vi.spyOn(f.transaction, 'rollback');
      await expect(activation.service.activate(operationId, activation.assertAuthority)).resolves.toBe('relaunching');
      const selected = rollback.mock.calls[0]![0]!;
      expect(selected).toMatchObject({ operationId, phase: interruptedPhase });
      expect(Object.isFrozen(selected)).toBe(true);
      expect(rollback.mock.calls[0]![1]).toEqual(expect.any(Function));
      expect(activation.stopBusinessRuntime).toHaveBeenCalledOnce();
      expect(activation.relaunchApplication).toHaveBeenCalledOnce();
      expect(await f.journalStore.peek()).toMatchObject({ phase: 'rolledBack', revision: selected.revision + 2 });
      expect(await readFile(f.activeDatabasePath, 'utf8')).toBe('old database');
      expect(await readFile(f.activePdfPath, 'utf8')).toBe('old pdf');
    },
  );

  it.each(['revoked', 'wrongRevision', 'foreignJournal'] as const)(
    'does not compensate own forward failure with %s authority or selection', async variant => {
      const f = await createFixture({ interruptedPhase: 'currentDatabaseMoved' });
      const activation = createActivationFixture(f.transaction);
      let granted = true;
      const forward = f.transaction.advanceToValidation.bind(f.transaction);
      vi.spyOn(f.transaction, 'advanceToValidation').mockImplementation(async (...args) => {
        try { return await forward(...args); }
        catch (error) {
          if (variant === 'revoked') granted = false;
          else {
            const current = (await f.journalStore.peek())!;
            await f.journalStore.write({ ...current,
              ...(variant === 'wrongRevision' ? { revision: current.revision + 1 }
                : { operationId: '22222222-2222-4222-8222-222222222222' }),
            });
          }
          throw error;
        }
      });
      const rollback = vi.spyOn(f.transaction, 'rollback');
      const failure = await activation.service.activate(operationId, async () => {
        if (!granted) throw new Error('synthetic revoked grant');
      }).catch((error: unknown) => error) as Error;
      expect(failure).toMatchObject({ code: 'PROFILE_RESTORE_RECOVERY_REQUIRED' });
      expect((failure.cause as AggregateError).errors[0]).toMatchObject({ message: 'synthetic interruption' });
      expect(rollback).not.toHaveBeenCalled();
      expect(activation.relaunchApplication).not.toHaveBeenCalled();
      expect(await readFile(join(f.rollbackRoot, operationId, 'data', 'eky.sqlite'), 'utf8')).toBe('old database');
      expect(await readFile(join(f.stagingRoot, operationId, 'profile.sqlite'), 'utf8')).toBe('new database');
      expect(() => activation.owner.claim(operationId)).toThrow('PROFILE_RESTORE_BUSY');
    },
  );

  it('rejects preparation when authority expires during its journal absence read', async () => {
    const fixture = await createFixture();
    const first = new Error('synthetic preparation grant expired');
    let current = true;
    const peek = fixture.journalStore.peek.bind(fixture.journalStore);
    vi.spyOn(fixture.journalStore, 'peek').mockImplementation(async () => {
      const journal = await peek();
      current = false;
      return journal;
    });
    await expect(fixture.transaction.prepare(operationId, async () => {
      if (!current) throw first;
    })).rejects.toBe(first);
    expect(await peek()).toBeUndefined();
    expect(await readFile(fixture.activeDatabasePath, 'utf8')).toBe('old database');
    await expect(readdir(join(fixture.rollbackRoot, operationId))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a forward grant without its selected journal', async () => {
    const fixture = await createFixture();
    await fixture.transaction.prepare(operationId);
    const selected = await fixture.journalStore.peek();
    await expect(fixture.transaction.advanceToValidation(undefined, async () => {}))
      .rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(await fixture.journalStore.peek()).toEqual(selected);
    expect(await readFile(fixture.activeDatabasePath, 'utf8')).toBe('old database');
  });

  it('retains its rollback root when preparation authority expires inside journal publication', async () => {
    const fixture = await createFixture();
    const first = new Error('synthetic preparation publication expired');
    let current = true;
    const write = fixture.journalStore.write.bind(fixture.journalStore);
    vi.spyOn(fixture.journalStore, 'write').mockImplementation(async (journal, authority) => {
      current = false;
      await write(journal, authority);
    });
    await expect(fixture.transaction.prepare(operationId, async () => {
      if (!current) throw first;
    })).rejects.toMatchObject({ message: 'PROFILE_RESTORE_JOURNAL_UNAVAILABLE', cause: first });
    expect(await fixture.journalStore.peek()).toBeUndefined();
    expect(await readdir(join(fixture.rollbackRoot, operationId))).toEqual([]);
    expect(await readFile(fixture.activeDatabasePath, 'utf8')).toBe('old database');
    expect(await readFile(fixture.stagedPdfPath, 'utf8')).toBe('new pdf');
  });

  it('restores both original slots with a separately validated grant after guarded forward interruption', async () => {
    const fixture = await createFixture({ interruptedPhase: 'stagedDocumentsActivated' });
    const assertForward = vi.fn(async () => {});
    await fixture.transaction.prepare(operationId, assertForward);
    const prepared = (await fixture.journalStore.peek())!;
    await expect(fixture.transaction.advanceToValidation(prepared, assertForward))
      .rejects.toThrow('synthetic interruption');
    const progressed = (await fixture.journalStore.peek())!;
    expect(progressed).toMatchObject({ operationId, phase: 'stagedDocumentsActivated', revision: 8 });
    expect(await readFile(fixture.activeDatabasePath, 'utf8')).toBe('new database');
    expect(await readFile(fixture.activePdfPath, 'utf8')).toBe('new pdf');

    const assertRollback = vi.fn(async () => {});
    const rolledBack = await fixture.createTransaction().rollback(progressed, assertRollback);
    expect(rolledBack).toMatchObject({ operationId, phase: 'rolledBack', revision: 10 });
    expect(assertRollback).toHaveBeenCalled();
    expect(await fixture.journalStore.peek()).toEqual(rolledBack);
    expect(await readFile(fixture.activeDatabasePath, 'utf8')).toBe('old database');
    expect(await readFile(fixture.activePdfPath, 'utf8')).toBe('old pdf');
    expect(await readFile(join(fixture.failedRoot, operationId, 'active', 'data', 'eky.sqlite'), 'utf8')).toBe('new database');
    expect(await readFile(join(fixture.failedRoot, operationId, 'active', 'storage', 'invoices',
      'company-1', 'invoice-1', 'approved-invoice.pdf'), 'utf8')).toBe('new pdf');
  });

  it.each(['movingCurrentDatabase', 'activatingStagedDatabase', 'validationStarting'] as const)(
    'retains the preceding journal when a forward grant expires inside %s publication', async phase => {
      const fixture = await createFixture();
      await fixture.transaction.prepare(operationId);
      const selected = (await fixture.journalStore.peek())!;
      const first = new Error('synthetic forward grant expired');
      const write = fixture.journalStore.write.bind(fixture.journalStore);
      let preceding: Readonly<ProfileRestoreActivationJournal> | undefined;
      let current = true;
      vi.spyOn(fixture.journalStore, 'write').mockImplementation(async (journal, authority) => {
        if (journal.phase === phase) {
          preceding = await fixture.journalStore.peek();
          current = false;
        }
        await write(journal, authority);
      });
      await expect(fixture.transaction.advanceToValidation(selected, async () => {
        if (!current) throw first;
      })).rejects.toMatchObject({ message: 'PROFILE_RESTORE_JOURNAL_UNAVAILABLE', cause: first });
      expect(preceding).toBeDefined();
      expect(await fixture.journalStore.peek()).toEqual(preceding);
      const databaseBytes = await Promise.all([
        readFile(fixture.activeDatabasePath, 'utf8').catch(allowMissing),
        readFile(join(fixture.rollbackRoot, operationId, 'data', 'eky.sqlite'), 'utf8').catch(allowMissing),
        readFile(join(fixture.stagingRoot, operationId, 'profile.sqlite'), 'utf8').catch(allowMissing),
      ]);
      expect(databaseBytes.filter(value => value !== undefined).sort()).toEqual(['new database', 'old database']);
    },
  );

  it.each(['validationStarting', 'rollbackStarting'] as const)(
    'rejects rollback authority lost in the final journal read at %s', async phase => {
      const fixture = await createFixture();
      await fixture.transaction.prepare(operationId);
      let selected = await fixture.transaction.advanceToValidation();
      if (phase === 'rollbackStarting') {
        selected = { ...selected, phase, revision: selected.revision + 1 };
        await fixture.journalStore.write(selected);
      }
      await fixture.transaction.prepareColdRollbackAnchor(selected, async () => {}, async () => {});
      let current = true;
      let contentChecked = false;
      const peek = fixture.journalStore.peek.bind(fixture.journalStore);
      vi.spyOn(fixture.journalStore, 'peek').mockImplementation(async () => {
        const journal = await peek();
        if (contentChecked) current = false;
        return journal;
      });
      const boundary = fixture.transaction as unknown as {
        assertRollbackMutation(journal: Readonly<ProfileRestoreActivationJournal>, assertCurrent: () => Promise<void>,
          authority: { assertContent(): Promise<void> }): Promise<void>;
      };
      await expect(boundary.assertRollbackMutation(selected, async () => {
        if (!current) throw new Error('PROFILE_INSPECTION_TIMEOUT');
      }, { async assertContent() { contentChecked = true; } })).rejects.toThrow('PROFILE_INSPECTION_TIMEOUT');
      await expect(readFile(fixture.activeDatabasePath, 'utf8')).resolves.toBe('new database');
      await expect(readFile(join(fixture.rollbackRoot, operationId, 'data', 'eky.sqlite'), 'utf8')).resolves.toBe('old database');
      await expect(fixture.journalStore.peek()).resolves.toEqual(selected);
    },
  );

  it('rechecks terminal authority after the final asynchronous journal selection', async () => {
    const f = await createFixture();
    await f.transaction.prepare(operationId);
    await f.transaction.advanceToValidation();
    const selected = await f.transaction.commitAcceptance();
    const census = await f.transaction.readTerminalCleanupCensus(selected);
    let current = true;
    const peek = f.journalStore.peek.bind(f.journalStore);
    vi.spyOn(f.journalStore, 'peek').mockImplementation(async () => {
      const journal = await peek();
      current = false;
      return journal;
    });
    const boundary = f.transaction as unknown as {
      assertTerminalMutation(journal: Readonly<ProfileRestoreActivationJournal>, removed: ReadonlySet<string>,
        recovery: undefined, authority: { census: typeof census; assertCurrent(): Promise<void> }): Promise<void>;
    };
    await expect(boundary.assertTerminalMutation(selected, new Set(), undefined, {
      census, async assertCurrent() { if (!current) throw new Error('PROFILE_INSPECTION_TIMEOUT'); },
    })).rejects.toThrow('PROFILE_INSPECTION_TIMEOUT');
  });

  it('does not delete a captured leaf when terminal authority expires during the final journal read', async () => {
    const f = await createFixture();
    await f.transaction.prepare(operationId);
    await f.transaction.advanceToValidation();
    const selected = await f.transaction.commitAcceptance();
    const census = await f.transaction.readTerminalCleanupCensus(selected);
    const before = await captureEvidence(f);
    let leafChecked = false;
    let current = true;
    let readingCensus = false;
    const checkCensus = f.transaction.assertTerminalCleanupCensus.bind(f.transaction);
    vi.spyOn(f.transaction, 'assertTerminalCleanupCensus').mockImplementation(async (...args) => {
      readingCensus = true;
      try { await checkCensus(...args); }
      finally { readingCensus = false; }
    });
    const checkEntry = cleanupCensus.assertProfileRestoreCleanupEntry;
    vi.spyOn(cleanupCensus, 'assertProfileRestoreCleanupEntry').mockImplementation(async (...args) => {
      await checkEntry(...args);
      if (!readingCensus) leafChecked = true;
    });
    const peek = f.journalStore.peek.bind(f.journalStore);
    vi.spyOn(f.journalStore, 'peek').mockImplementation(async () => {
      const journal = await peek();
      if (leafChecked) current = false;
      return journal;
    });
    const unlink = vi.spyOn(fileSystem, 'unlink');
    const rmdir = vi.spyOn(fileSystem, 'rmdir');
    await expect(f.transaction.clearAccepted(selected, undefined, {
      census, async assertCurrent() { if (!current) throw new Error('PROFILE_INSPECTION_TIMEOUT'); },
    })).rejects.toThrow('PROFILE_INSPECTION_TIMEOUT');
    expect(leafChecked).toBe(true);
    expect(unlink).not.toHaveBeenCalled();
    expect(rmdir).not.toHaveBeenCalled();
    expect(await captureEvidence(f)).toEqual(before);
  });

  it.each(['current', 'backup', 'next'] as const)(
    'retains accepted cold %s journal evidence when live validation fails', async selectedSlot => {
      const f = await createFixture();
      await f.transaction.prepare(operationId);
      await f.transaction.advanceToValidation();
      const selected = await f.transaction.commitAcceptance();
      const journalPath = join(dirname(dirname(f.activeDatabasePath)), 'profile-restore-state',
        profileRestoreActivationJournalFileName);
      if (selectedSlot !== 'current') await rename(journalPath, `${journalPath}.${selectedSlot}`);
      else {
        await writeFile(`${journalPath}.backup`, 'retain backup evidence');
        await writeFile(`${journalPath}.next`, 'retain next evidence');
      }
      const slots = () => Promise.all(['', '.backup', '.next'].map(async suffix => {
        try { return await readFile(journalPath + suffix, 'utf8'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
      }));
      const before = await slots();
      const read = vi.spyOn(f.journalStore, 'read');
      const recovery = new ProfileRestoreStartupRecovery({
        journalStore: f.journalStore, transaction: f.transaction,
        async withTerminalAuthority() { throw new Error('terminal must not start before successful validation'); },
      });
      const mode = await recovery.prepareBeforeBackend(undefined, selectedSlot === 'next' ? undefined : selected);
      expect(read).not.toHaveBeenCalled();
      expect(await slots()).toEqual(before);
      await expect(recovery.validateAfterBackend({ mode, async stopBackend() {},
        async validateActiveProfile() { throw new Error('PROFILE_SCHEMA_UNSUPPORTED'); },
      })).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
      expect(await slots()).toEqual(before);
      expect(recovery.readAcceptanceState()).toBe('committed');
    },
  );

  it.each([false, true])('does not repair the selected terminal journal after its captured bytes change (accepted: %s)', async accepted => {
    const f = await createFixture();
    await f.transaction.prepare(operationId);
    let selected = await f.transaction.advanceToValidation();
    if (accepted) selected = await f.transaction.commitAcceptance(selected);
    const census = await f.transaction.readTerminalCleanupCensus(selected);
    const read = f.journalStore.read.bind(f.journalStore);
    let repairingGuardRejected = false;
    vi.spyOn(f.journalStore, 'read').mockImplementation(async (expected, assertAuthority) => {
      await writeFile(join(f.rollbackRoot, operationId, 'data', 'eky.sqlite'), 'changed retained bytes');
      try { await assertAuthority?.(); }
      catch (error) { repairingGuardRejected = true; throw error; }
      return read(expected, assertAuthority);
    });
    const authority = { census, assertCurrent: async () => {} };
    await expect(accepted ? f.transaction.clearAccepted(selected, undefined, authority)
      : f.transaction.commitAcceptance(selected, undefined, authority)).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    expect(repairingGuardRejected).toBe(true);
    expect(await f.journalStore.peek()).toEqual(selected);
  });

  it('rejects changed captured terminal bytes before publishing accepted', async () => {
    const f = await createFixture();
    await f.transaction.prepare(operationId);
    const selected = await f.transaction.advanceToValidation();
    const census = await f.transaction.readTerminalCleanupCensus(selected);
    await writeFile(join(f.rollbackRoot, operationId, 'data', 'eky.sqlite'), 'foreign replacement');
    await expect(f.transaction.commitAcceptance(selected, undefined, {
      census, assertCurrent: async () => {},
    })).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    expect(await f.journalStore.peek()).toEqual(selected);
  });

  it('retains accepted evidence changed after its terminal claim census', async () => {
    const f = await createFixture();
    await f.transaction.prepare(operationId);
    await f.transaction.advanceToValidation();
    const selected = await f.transaction.commitAcceptance();
    const census = await f.transaction.readTerminalCleanupCensus(selected);
    const retained = join(f.rollbackRoot, operationId, 'data', 'eky.sqlite');
    await writeFile(retained, 'foreign replacement');
    await expect(f.transaction.clearAccepted(selected, undefined, {
      census, assertCurrent: async () => {},
    })).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    expect(await readFile(retained, 'utf8')).toBe('foreign replacement');
    expect(await f.journalStore.peek()).toEqual(selected);
  });

  it('rechecks the captured terminal census inside journal publication', async () => {
    const f = await createFixture();
    await f.transaction.prepare(operationId);
    const selected = await f.transaction.advanceToValidation();
    const census = await f.transaction.readTerminalCleanupCensus(selected);
    const write = f.journalStore.write.bind(f.journalStore);
    vi.spyOn(f.journalStore, 'write').mockImplementation(async (next, authority) => {
      await writeFile(join(f.stagingRoot, operationId, 'late-retained'), 'late evidence');
      await write(next, authority);
    });
    await expect(f.transaction.commitAcceptance(selected, undefined, {
      census, assertCurrent: async () => {},
    })).rejects.toThrow('PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
    expect(await f.journalStore.peek()).toEqual(selected);
  });

  it.each(['rollbackRoot', 'stagingRoot'] as const)('retains unknown accepted %s content before deleting either root', async role => {
    const f = await createFixture();
    await f.transaction.prepare(operationId);
    await f.transaction.advanceToValidation();
    const accepted = await f.transaction.commitAcceptance();
    const unexpected = join(f[role], operationId, 'unrelated-retained');
    await writeFile(unexpected, 'foreign evidence');
    const before = await captureEvidence(f);
    await expect(f.transaction.clearAccepted(accepted)).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    expect(await readFile(unexpected, 'utf8')).toBe('foreign evidence');
    expect(await captureEvidence(f)).toEqual(before);
    expect(await f.journalStore.peek()).toEqual(accepted);
  });

  it('retains unknown nested rollback content rather than recursively deleting it', async () => {
    const f = await createFixture();
    await f.transaction.prepare(operationId);
    await f.transaction.advanceToValidation();
    const accepted = await f.transaction.commitAcceptance();
    const unexpected = join(f.rollbackRoot, operationId, 'data', 'eky.sqlite-journal');
    await writeFile(unexpected, 'retain journal');
    const before = await captureEvidence(f);
    await expect(f.transaction.clearAccepted(accepted)).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    expect(await readFile(unexpected, 'utf8')).toBe('retain journal');
    expect(await captureEvidence(f)).toEqual(before);
    expect(await f.journalStore.peek()).toEqual(accepted);
  });

  it('retains a recreated accepted root inserted after its removal', async () => {
    const f = await createFixture();
    await f.transaction.prepare(operationId);
    await f.transaction.advanceToValidation();
    const accepted = await f.transaction.commitAcceptance();
    const rollback = join(f.rollbackRoot, operationId);
    const remove = fileSystem.rmdir.bind(fileSystem);
    vi.spyOn(fileSystem, 'rmdir').mockImplementation(async path => {
      await remove(path);
      if (String(path) === rollback) {
        await mkdir(rollback);
        await writeFile(join(rollback, 'unrelated-retained'), 'late evidence');
      }
    });
    await expect(f.transaction.clearAccepted(accepted)).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    expect(await readFile(join(rollback, 'unrelated-retained'), 'utf8')).toBe('late evidence');
    expect(await f.journalStore.peek()).toEqual(accepted);
  });

  it('does not publish acceptance over unrelated staging entries', async () => {
    const f = await createFixture();
    await f.transaction.prepare(operationId);
    await f.transaction.advanceToValidation();
    const selected = (await f.journalStore.peek())!;
    const unexpected = join(f.stagingRoot, operationId, 'unrelated-retained');
    await writeFile(unexpected, 'retain before commit');
    await expect(f.transaction.commitAcceptance(selected)).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    expect(await f.journalStore.peek()).toEqual(selected);
    expect(await readFile(unexpected, 'utf8')).toBe('retain before commit');
  });

  it.each(['changedFile', 'linkedFile', 'changedRoot', 'changedAncestor'] as const)(
    'rejects a frozen terminal census after %s without deleting anything', async mutation => {
      const f = await createFixture();
      await f.transaction.prepare(operationId);
      await f.transaction.advanceToValidation();
      const selected = (await f.journalStore.peek())!;
      const census = await f.transaction.readTerminalCleanupCensus(selected);
      expect(Object.isFrozen(census)).toBe(true);
      expect(census.roots.every(root => Object.isFrozen(root) && Object.isFrozen(root.entries))).toBe(true);
      const root = join(f.rollbackRoot, operationId);
      const file = join(root, 'data', 'eky.sqlite');
      if (mutation === 'changedFile') await writeFile(file, 'changed original');
      if (mutation === 'linkedFile') await link(file, join(dirname(root), 'retained-alias'));
      if (mutation === 'changedRoot') {
        await rename(root, root + '-retained');
        await mkdir(root);
      }
      if (mutation === 'changedAncestor') {
        await rename(f.rollbackRoot, f.rollbackRoot + '-retained');
        await mkdir(f.rollbackRoot);
      }
      await expect(f.transaction.assertTerminalCleanupCensus(census)).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
      expect(await f.journalStore.peek()).toEqual(selected);
    },
  );

  it('resumes partially missing accepted roots but does not create them', async () => {
    const f = await createFixture();
    await f.transaction.prepare(operationId);
    await f.transaction.advanceToValidation();
    const accepted = await f.transaction.commitAcceptance();
    const rollback = join(f.rollbackRoot, operationId);
    await rm(rollback, { recursive: true });
    const census = await f.transaction.readTerminalCleanupCensus(accepted);
    expect(census.roots.find(root => root.role === 'rollback')).toMatchObject({ identity: undefined, entries: [] });
    await f.transaction.clearAccepted(accepted);
    await expect(readdir(rollback)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await f.journalStore.peek()).toBeUndefined();
    expect(await readFile(f.activeDatabasePath, 'utf8')).toBe('new database');
  });

  it('retains an entry arriving after the last check without recursively removing it', async () => {
    const f = await createFixture();
    await f.transaction.prepare(operationId);
    await f.transaction.advanceToValidation();
    const accepted = await f.transaction.commitAcceptance();
    const data = join(f.rollbackRoot, operationId, 'data');
    const unexpected = join(data, 'unrelated-retained');
    const remove = fileSystem.rmdir.bind(fileSystem);
    let injected = false;
    vi.spyOn(fileSystem, 'rmdir').mockImplementation(async path => {
      if (String(path) === data && !injected) {
        injected = true;
        await writeFile(unexpected, 'late evidence');
      }
      return remove(path);
    });
    await expect(f.transaction.clearAccepted(accepted)).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    expect(injected).toBe(true);
    expect(await readFile(unexpected, 'utf8')).toBe('late evidence');
    expect(await f.journalStore.peek()).toEqual(accepted);
  });

  it('keeps allowed snapshot copies, the catalog and cold bindings in the named cleanup', async () => {
    const f = await createFixture();
    await f.transaction.prepare(operationId);
    await f.transaction.advanceToValidation();
    const staging = join(f.stagingRoot, operationId);
    const artifact = join(staging, 'artifacts', 'invoicing', 'invoice-documents', `${'a'.repeat(64)}.pdf`);
    await mkdir(dirname(artifact), { recursive: true });
    await writeFile(artifact, '%PDF-1.7 synthetic copy');
    await writeFile(join(staging, 'snapshot-catalog-v1.json'), '{}');
    await writeFile(join(staging, 'cold-document-bindings-v1.json'), '{}');
    const accepted = await f.transaction.commitAcceptance();
    await f.transaction.clearAccepted(accepted);
    await expect(readdir(staging)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(f.activeDatabasePath, 'utf8')).toBe('new database');
    expect(await f.journalStore.peek()).toBeUndefined();
  });

  it('publishes accepted durably without deleting rollback or staging evidence', async () => {
    const f = await createFixture();
    await f.transaction.prepare(operationId);
    await f.transaction.advanceToValidation();
    const selected = (await f.journalStore.peek())!;
    const before = await captureEvidence(f);
    const committed = await f.transaction.commitAcceptance(selected);
    expect(committed).toEqual({ ...selected, phase: 'accepted', revision: selected.revision + 1 });
    expect(Object.isFrozen(committed)).toBe(true);
    expect(await f.journalStore.peek()).toEqual(committed);
    expect(await captureEvidence(f)).toEqual(before);
    await f.transaction.clearAccepted(committed);
    expect(await f.journalStore.peek()).toBeUndefined();
    expect(await readFile(f.activeDatabasePath, 'utf8')).toBe('new database');
    expect(await readFile(f.activePdfPath, 'utf8')).toBe('new pdf');
  });

  it('never rolls back accepted content when journal cleanup fails after actual publication', async () => {
    const f = await createFixture();
    await f.transaction.prepare(operationId);
    await f.transaction.advanceToValidation();
    const recovery = new ProfileRestoreStartupRecovery({ journalStore: f.journalStore, transaction: f.transaction });
    const mode = await recovery.prepareBeforeBackend();
    const primary = new Error('synthetic journal cleanup failed');
    vi.spyOn(f.journalStore, 'clear').mockRejectedValueOnce(primary);
    const rollback = vi.spyOn(f.transaction, 'rollback');
    await expect(recovery.validateAfterBackend({ mode, stopBackend: vi.fn(), validateActiveProfile: vi.fn(async () => {}) }))
      .rejects.toMatchObject({ message: 'PROFILE_RESTORE_RECOVERY_REQUIRED', cause: primary });
    expect(recovery.readAcceptanceState()).toBe('committed');
    const committed = await f.journalStore.peek();
    expect(committed).toMatchObject({ operationId, phase: 'accepted' });
    expect(rollback).not.toHaveBeenCalled();
    expect(await readFile(f.activeDatabasePath, 'utf8')).toBe('new database');
    expect(await readFile(f.activePdfPath, 'utf8')).toBe('new pdf');
    const resumed = new ProfileRestoreStartupRecovery({ journalStore: f.journalStore, transaction: f.transaction });
    const resumedMode = await resumed.prepareBeforeBackend(undefined, committed);
    expect(resumedMode).toBe('validateAcceptedProfile');
    expect(await f.journalStore.peek()).toEqual(committed);
    await expect(resumed.validateAfterBackend({ mode: resumedMode, stopBackend: vi.fn(), validateActiveProfile: vi.fn(async () => {}) })).resolves.toBe('ready');
    expect(await f.journalStore.peek()).toBeUndefined();
    expect(rollback).not.toHaveBeenCalled();
  });

  it('prepares an exclusive stationary cold anchor only after source ownership is proven', async () => {
    const f = await createFixture();
    const journal = await beginInterruptedRollback(f);
    const anchorRoot = join(f.failedRoot, operationId);
    const claim = vi.fn(async (sources: readonly { role: string; root: string; identity: string }[]) => {
      await expect(readFile(anchorRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(sources.map(source => source.role)).toEqual(['staging', 'rollback']);
      expect(sources.every(source => /^[a-f0-9]{64}$/.test(source.identity))).toBe(true);
    });
    const roots = await f.transaction.prepareColdRollbackAnchor(journal, claim, async () => {});
    expect(roots.anchorRoot).toBe(anchorRoot);
    expect(roots.anchorIdentity).toMatch(/^[a-f0-9]{64}$/);
    expect(await readdir(anchorRoot)).toEqual([]);
    expect(await f.journalStore.peek()).toEqual(journal);
  });

  it.each(['root', 'active', 'data', 'storage'] as const)('rejects unknown %s anchor content without adoption', async slot => {
    const f = await createFixture();
    const journal = await beginInterruptedRollback(f);
    const anchorRoot = join(f.failedRoot, operationId);
    const root = slot === 'root' ? anchorRoot : slot === 'active' ? join(anchorRoot, 'active')
      : join(anchorRoot, 'active', slot);
    await mkdir(root, { recursive: true });
    const retained = join(root, 'unrelated-retained');
    await writeFile(retained, 'foreign evidence');
    const claim = vi.fn(async () => {});
    await expect(f.transaction.prepareColdRollbackAnchor(journal, claim, async () => {})).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    expect(claim).not.toHaveBeenCalled();
    expect(await readFile(retained, 'utf8')).toBe('foreign evidence');
    expect(await f.journalStore.peek()).toEqual(journal);
  });

  it('retains a foreign anchor appearing while source claims are acquired', async () => {
    const f = await createFixture();
    const journal = await beginInterruptedRollback(f);
    const root = join(f.failedRoot, operationId);
    await expect(f.transaction.prepareColdRollbackAnchor(journal, async () => {
      await mkdir(root, { recursive: true });
    }, async () => {})).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    expect(await readdir(root)).toEqual([]);
    expect(await f.journalStore.peek()).toEqual(journal);
  });

  it('rejects a replaced stationary anchor after claiming source roots', async () => {
    const f = await createFixture();
    const journal = await beginInterruptedRollback(f);
    const root = join(f.failedRoot, operationId);
    await mkdir(root, { recursive: true });
    await expect(f.transaction.prepareColdRollbackAnchor(journal, async () => {
      await rename(root, root + '-retained');
      await mkdir(root);
    }, async () => {})).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    expect(await readdir(root + '-retained')).toEqual([]);
    expect(await f.journalStore.peek()).toEqual(journal);
  });

  it.each([0, 1, 2, 3, 4, 5])('binds original content across %s prior rollback moves and its own terminal revision', async moves => {
    const f = await createFixture();
    const selected = await beginInterruptedRollback(f);
    await simulateRollbackMoves(f, moves);
    await f.transaction.prepareColdRollbackAnchor(selected, async () => {}, async () => {});
    const seen: string[] = [];
    const assertContent = vi.fn(async (current: Readonly<ProfileRestoreActivationJournal>) => {
      const sources = await f.transaction.readRollbackRecoverySources(current);
      seen.push(current.phase);
      const db = sources.databaseSlot === 'active' ? f.activeDatabasePath
        : join(f.rollbackRoot, operationId, 'data', 'eky.sqlite');
      const pdf = sources.documentsSlot === 'active' ? f.activePdfPath
        : join(f.rollbackRoot, operationId, 'storage', 'invoices', 'company-1', 'invoice-1', 'approved-invoice.pdf');
      expect(await readFile(db, 'utf8')).toBe('old database');
      expect(await readFile(pdf, 'utf8')).toBe('old pdf');
    });
    const beforeStagingMove = vi.fn(async () => {});
    const final = await f.transaction.rollback(selected, async () => {}, { assertContent, beforeStagingMove });
    expect(final).toMatchObject({ phase: 'rolledBack', revision: selected.revision + 1 });
    expect(seen).toContain('rollbackStarting');
    expect(seen).toContain('rolledBack');
    expect(beforeStagingMove).toHaveBeenCalledTimes(moves < 5 ? 1 : 0);
  });

  it('retains the first cold content failure without a failedSafe write under lost authority', async () => {
    const f = await createFixture();
    const selected = await beginInterruptedRollback(f);
    const first = new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
    const before = await captureEvidence(f);
    await expect(f.transaction.rollback(selected, async () => {}, {
      assertContent: async () => { throw first; }, beforeStagingMove: async () => {},
    })).rejects.toBe(first);
    expect(await f.journalStore.peek()).toEqual(selected);
    expect(await captureEvidence(f)).toEqual(before);
  });

  it('rejects a different-inode staging root after releasing its claim, retaining both directories', async () => {
    const f = await createFixture(); const selected = await beginInterruptedRollback(f);
    const staging = join(f.stagingRoot, operationId); const retained = staging + '-retained';
    await expect(f.transaction.rollback(selected, async () => {}, {
      assertContent: async () => {},
      async beforeStagingMove() {
        await rename(staging, retained); await mkdir(staging);
      },
    })).rejects.toMatchObject({ message: 'PROFILE_RESTORE_ROLLBACK_FAILED',
      cause: { message: 'PROFILE_RESTORE_ACTIVATION_STATE_INVALID' } });
    expect(await f.journalStore.peek()).toEqual(selected);
    expect(await readdir(staging)).toEqual([]);
    await expect(readdir(retained)).resolves.toBeDefined();
    await expect(readdir(join(f.failedRoot, operationId, 'staging'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(f.activeDatabasePath, 'utf8')).toBe('old database');
  });

  it('rechecks staging identity after a Windows rename retry instead of moving a replacement root', async () => {
    const f = await createFixture(); const selected = await beginInterruptedRollback(f);
    const staging = join(f.stagingRoot, operationId); const retained = staging + '-retained';
    const originalMove = fileMoves.renameProfilePathWithRetry;
    const secondRename = vi.fn(async (source: string, destination: string) => rename(source, destination));
    let first = true;
    vi.spyOn(fileMoves, 'renameProfilePathWithRetry').mockImplementation(options => originalMove(options.sourcePath !== staging
      ? options : { ...options, platform: 'win32',
          async renamePath(source, destination) {
            if (first) { first = false; throw Object.assign(new Error('synthetic busy rename'), { code: 'EBUSY' }); }
            await secondRename(source, destination);
          },
          async wait() { await rename(staging, retained); await mkdir(staging); },
        }));
    await expect(f.transaction.rollback(selected, async () => {}, {
      assertContent: async () => {}, beforeStagingMove: async () => {},
    })).rejects.toMatchObject({ message: 'PROFILE_RESTORE_ROLLBACK_FAILED',
      cause: { message: 'PROFILE_RESTORE_ACTIVATION_STATE_INVALID' } });
    expect(secondRename).not.toHaveBeenCalled();
    expect(await f.journalStore.peek()).toEqual(selected);
    expect(await readdir(staging)).toEqual([]); await expect(readdir(retained)).resolves.toBeDefined();
  });

  it.each([0, 1, 2, 3, 4, 5])('resumes rollback after %s completed file moves without losing either version', async completedMoves => {
    const fixture = await createFixture();
    const selected = await beginInterruptedRollback(fixture);
    await simulateRollbackMoves(fixture, completedMoves);
    const resumed = fixture.createTransaction();

    expect(await resumed.readRollbackRecoverySources(selected)).toEqual({
      databaseSlot: completedMoves < 4 ? 'rollback' : 'active',
      documentsSlot: completedMoves < 2 ? 'rollback' : 'active',
    });
    const rolledBack = await resumed.rollback(selected);
    expect(rolledBack.phase).toBe('rolledBack');
    expect(await readFile(fixture.activeDatabasePath, 'utf8')).toBe('old database');
    expect(await readFile(fixture.activePdfPath, 'utf8')).toBe('old pdf');
    const failedRoot = join(fixture.failedRoot, operationId);
    expect(await readFile(join(failedRoot, 'active', 'data', 'eky.sqlite'), 'utf8')).toBe('new database');
    expect(await readFile(join(failedRoot, 'active', 'storage', 'invoices',
      'company-1', 'invoice-1', 'approved-invoice.pdf'), 'utf8')).toBe('new pdf');
    await expect(resumed.rollback(rolledBack)).resolves.toEqual(rolledBack);
    await resumed.clearRolledBack(rolledBack);
    expect(await fixture.journalStore.peek()).toBeUndefined();
    expect(await readdir(join(failedRoot, 'staging'))).toContain('activation');
  });

  it.each(interruptiblePhases)('resumes rollbackStarting selected from interrupted forward phase %s', async interruptedPhase => {
    const fixture = await createFixture({ interruptedPhase });
    await fixture.transaction.prepare(operationId);
    await expect(fixture.transaction.advanceToValidation()).rejects.toThrow('synthetic interruption');
    const forward = (await fixture.journalStore.peek())!;
    const selected: ProfileRestoreActivationJournal = {
      ...forward, phase: 'rollbackStarting', revision: forward.revision + 1,
    };
    await fixture.journalStore.write(selected);
    const resumed = fixture.createTransaction();

    const rolledBack = await resumed.rollback(selected);

    expect(await readFile(fixture.activeDatabasePath, 'utf8')).toBe('old database');
    expect(await readFile(fixture.activePdfPath, 'utf8')).toBe('old pdf');
    await resumed.clearRolledBack(rolledBack);
    expect(await fixture.journalStore.peek()).toBeUndefined();
  });

  it.each([[false, false], [true, false], [false, true]] as const)(
    'preserves original absence through terminal cleanup (database=%s documents=%s)', async (database, documents) => {
      const fixture = await createFixture({ activeDatabaseExists: database, activeDocumentsExist: documents });
      const selected = await beginInterruptedRollback(fixture);
      const resumed = fixture.createTransaction();
      expect(await resumed.readRollbackRecoverySources(selected)).toEqual({
        databaseSlot: database ? 'rollback' : 'absent', documentsSlot: documents ? 'rollback' : 'absent',
      });
      const rolledBack = await resumed.rollback(selected);
      if (database) expect(await readFile(fixture.activeDatabasePath, 'utf8')).toBe('old database');
      else await expect(readFile(fixture.activeDatabasePath)).rejects.toMatchObject({ code: 'ENOENT' });
      if (documents) expect(await readFile(fixture.activePdfPath, 'utf8')).toBe('old pdf');
      else await expect(readFile(fixture.activePdfPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await resumed.clearRolledBack(rolledBack);
      expect(await fixture.journalStore.peek()).toBeUndefined();
    },
  );

  it('retains a prepared original when interrupted rollback has lost the staged target', async () => {
    const fixture = await createFixture();
    await fixture.transaction.prepare(operationId);
    const prepared = (await fixture.journalStore.peek())!;
    const selected: ProfileRestoreActivationJournal = {
      ...prepared, phase: 'rollbackStarting', revision: prepared.revision + 1,
    };
    await fixture.journalStore.write(selected);
    await rm(join(fixture.stagingRoot, operationId, 'profile.sqlite'));
    const before = await captureEvidence(fixture);

    await expect(fixture.transaction.rollback(selected)).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');

    expect(await captureEvidence(fixture)).toEqual(before);
    expect(await fixture.journalStore.peek()).toEqual(selected);
  });

  it('rejects a missing failed slot beneath a junction before rollback moves', async () => {
    const fixture = await createFixture();
    const selected = await beginInterruptedRollback(fixture);
    const failedRoot = join(fixture.failedRoot, operationId);
    const unrelated = join(dirname(fixture.stagingRoot), 'unrelated-retained');
    await mkdir(failedRoot, { recursive: true });
    await mkdir(unrelated);
    await writeFile(join(unrelated, 'retain.txt'), 'unrelated bytes');
    await symlink(unrelated, join(failedRoot, 'active'), process.platform === 'win32' ? 'junction' : 'dir');
    const before = await captureEvidence(fixture);

    await expect(fixture.transaction.rollback(selected)).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');

    expect(await captureEvidence(fixture)).toEqual(before);
    expect(await fixture.journalStore.peek()).toEqual(selected);
    expect(await readFile(join(unrelated, 'retain.txt'), 'utf8')).toBe('unrelated bytes');
  });

  it('retains a rolledBack journal and both copies when a retained database becomes hardlinked', async () => {
    const fixture = await createFixture();
    const selected = await beginInterruptedRollback(fixture);
    const rolledBack = await fixture.transaction.rollback(selected);
    const failedDatabase = join(fixture.failedRoot, operationId, 'active', 'data', 'eky.sqlite');
    const duplicate = join(fixture.failedRoot, operationId, 'retain.sqlite');
    await link(failedDatabase, duplicate);

    await expect(fixture.transaction.clearRolledBack(rolledBack)).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');

    expect(await fixture.journalStore.peek()).toEqual(rolledBack);
    expect(await readFile(failedDatabase, 'utf8')).toBe('new database');
    expect(await readFile(duplicate, 'utf8')).toBe('new database');
    expect(await readFile(fixture.activeDatabasePath, 'utf8')).toBe('old database');
  });

  it('resumes terminal cleanup after removal of its empty rollback root', async () => {
    const fixture = await createFixture();
    const selected = await beginInterruptedRollback(fixture);
    const rolledBack = await fixture.transaction.rollback(selected);
    await rm(join(fixture.rollbackRoot, operationId), { recursive: true });
    const resumed = fixture.createTransaction();

    expect(await resumed.readRollbackRecoverySources(rolledBack)).toEqual({ databaseSlot: 'active', documentsSlot: 'active' });
    await resumed.clearRolledBack(rolledBack);

    expect(await fixture.journalStore.peek()).toBeUndefined();
    expect(await readFile(fixture.activeDatabasePath, 'utf8')).toBe('old database');
  });

  it.each(['root', 'data', 'storage'] as const)(
    'retains unknown %s rollback content and its terminal journal', async level => {
      const fixture = await createFixture();
      const selected = await beginInterruptedRollback(fixture);
      const rolledBack = await fixture.transaction.rollback(selected);
      const root = join(fixture.rollbackRoot, operationId);
      const retained = join(level === 'root' ? root : join(root, level), 'unrelated-retained');
      await writeFile(retained, 'foreign evidence');
      const before = await captureEvidence(fixture);

      await expect(fixture.transaction.clearRolledBack(rolledBack))
        .rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');

      expect(await fixture.journalStore.peek()).toEqual(rolledBack);
      expect(await readFile(retained, 'utf8')).toBe('foreign evidence');
      expect(await captureEvidence(fixture)).toEqual(before);
    },
  );

  it.each(['root', 'data', 'storage'] as const)(
    'retains an unknown %s rollback directory and its terminal journal', async level => {
      const fixture = await createFixture();
      const selected = await beginInterruptedRollback(fixture);
      const rolledBack = await fixture.transaction.rollback(selected);
      const root = join(fixture.rollbackRoot, operationId);
      const retained = join(level === 'root' ? root : join(root, level), 'unrelated-retained', 'retain.txt');
      await mkdir(dirname(retained));
      await writeFile(retained, 'foreign evidence');

      await expect(fixture.transaction.clearRolledBack(rolledBack))
        .rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');

      expect(await fixture.journalStore.peek()).toEqual(rolledBack);
      expect(await readFile(retained, 'utf8')).toBe('foreign evidence');
      expect(await readFile(fixture.activeDatabasePath, 'utf8')).toBe('old database');
    },
  );

  it.each(['root', 'data', 'storage'] as const)(
    'retains a late %s rollback entry arriving after the final directory check', async level => {
      const fixture = await createFixture();
      const selected = await beginInterruptedRollback(fixture);
      const rolledBack = await fixture.transaction.rollback(selected);
      const root = join(fixture.rollbackRoot, operationId);
      const target = level === 'root' ? root : join(root, level);
      const retained = join(target, 'late-retained');
      const remove = fileSystem.rmdir;
      let injected = false;
      vi.spyOn(fileSystem, 'rmdir').mockImplementation(async path => {
        if (path === target && !injected) {
          injected = true;
          await writeFile(retained, 'late evidence');
        }
        return remove(path);
      });

      await expect(fixture.transaction.clearRolledBack(rolledBack))
        .rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');

      expect(injected).toBe(true);
      expect(await fixture.journalStore.peek()).toEqual(rolledBack);
      expect(await readFile(retained, 'utf8')).toBe('late evidence');
      expect(await readFile(fixture.activeDatabasePath, 'utf8')).toBe('old database');
    },
  );

  it('resumes terminal cleanup after one empty rollback child was removed', async () => {
    const fixture = await createFixture();
    const selected = await beginInterruptedRollback(fixture);
    const rolledBack = await fixture.transaction.rollback(selected);
    await fileSystem.rmdir(join(fixture.rollbackRoot, operationId, 'data'));

    await fixture.createTransaction().clearRolledBack(rolledBack);

    expect(await fixture.journalStore.peek()).toBeUndefined();
    await expect(readdir(join(fixture.rollbackRoot, operationId))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(fixture.activeDatabasePath, 'utf8')).toBe('old database');
    expect(await readFile(fixture.activePdfPath, 'utf8')).toBe('old pdf');
  });

  it('retains a recreated rollback root before clearing its terminal journal', async () => {
    const fixture = await createFixture();
    const selected = await beginInterruptedRollback(fixture);
    const rolledBack = await fixture.transaction.rollback(selected);
    const root = join(fixture.rollbackRoot, operationId);
    const retained = join(root, 'late-retained');
    const remove = fileSystem.rmdir;
    vi.spyOn(fileSystem, 'rmdir').mockImplementation(async path => {
      await remove(path);
      if (path === root) {
        await mkdir(root);
        await writeFile(retained, 'recreated evidence');
      }
    });

    await expect(fixture.transaction.clearRolledBack(rolledBack))
      .rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');

    expect(await fixture.journalStore.peek()).toEqual(rolledBack);
    expect(await readFile(retained, 'utf8')).toBe('recreated evidence');
    expect(await readFile(fixture.activeDatabasePath, 'utf8')).toBe('old database');
  });

  it('reports terminal cleanup rejection through startup without deleting retained evidence', async () => {
    const fixture = await createFixture();
    const selected = await beginInterruptedRollback(fixture);
    const rolledBack = await fixture.transaction.rollback(selected);
    const retained = join(fixture.rollbackRoot, operationId, 'data', 'unrelated-retained');
    await writeFile(retained, 'foreign evidence');
    const observe = vi.fn();
    const recovery = new ProfileRestoreStartupRecovery({
      journalStore: fixture.journalStore, transaction: fixture.createTransaction(), observer: { observe },
    });
    const mode = await recovery.prepareBeforeBackend();
    const stopBackend = vi.fn(async () => {});

    await expect(recovery.validateAfterBackend({ mode, stopBackend, validateActiveProfile: async () => {} }))
      .rejects.toMatchObject({ message: 'PROFILE_RESTORE_RECOVERY_REQUIRED', cause: { message: 'PROFILE_RESTORE_ACTIVATION_STATE_INVALID' } });

    expect(stopBackend).toHaveBeenCalledOnce();
    expect(observe.mock.calls.map(([event]) => event.eventName)).toEqual([
      'restore.validationCompleted', 'restore.recoveryRequired',
    ]);
    expect(observe).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'restore.validationCompleted', stage: 'rolledBackProfile',
    }));
    expect(JSON.stringify(observe.mock.calls)).not.toMatch(/(?:sqlite|foreign evidence|unrelated-retained|companyId)/i);
    expect(await fixture.journalStore.peek()).toEqual(rolledBack);
    expect(await readFile(retained, 'utf8')).toBe('foreign evidence');
    expect(await readFile(fixture.activeDatabasePath, 'utf8')).toBe('old database');
  });

  it('rejects rollback ancestor replacement during the last external removal check', async () => {
    const fixture = await createFixture();
    const selected = await beginInterruptedRollback(fixture);
    const rolledBack = await fixture.transaction.rollback(selected);
    const root = join(fixture.rollbackRoot, operationId);
    const preservedRoot = join(fixture.rollbackRoot, 'preserved-original');
    const foreignRoot = join(fixture.rollbackRoot, 'foreign-root');
    await mkdir(join(foreignRoot, 'data'), { recursive: true });
    await mkdir(join(foreignRoot, 'storage'));
    const census = fixture.transaction.readRollbackRecoverySources.bind(fixture.transaction);
    let censusCalls = 0;
    let checksAfterCensus = 0;
    let replaced = false;
    vi.spyOn(fixture.transaction, 'readRollbackRecoverySources').mockImplementation(async journal => {
      const sources = await census(journal);
      censusCalls += 1;
      checksAfterCensus = 0;
      return sources;
    });

    await expect(fixture.transaction.clearRolledBack(rolledBack, async () => {
      checksAfterCensus += 1;
      if (censusCalls === 2 && checksAfterCensus === 2) {
        await rename(root, preservedRoot);
        await symlink(foreignRoot, root, process.platform === 'win32' ? 'junction' : 'dir');
        replaced = true;
      }
    })).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');

    expect(replaced).toBe(true);
    expect(await readdir(join(foreignRoot, 'data'))).toEqual([]);
    expect(await readdir(join(foreignRoot, 'storage'))).toEqual([]);
    expect(await fixture.journalStore.peek()).toEqual(rolledBack);
    expect(await readFile(fixture.activeDatabasePath, 'utf8')).toBe('old database');
  });

  it('retains the authoritative journal if rollback root returns in its final authority callback', async () => {
    const fixture = await createFixture();
    const selected = await beginInterruptedRollback(fixture);
    const rolledBack = await fixture.transaction.rollback(selected);
    const root = join(fixture.rollbackRoot, operationId);
    const retained = join(root, 'late-retained');
    const clear = fixture.journalStore.clear.bind(fixture.journalStore);
    let clearing = false;
    let clearIteration = 0;
    let checks = 0;
    let recreated = false;
    vi.spyOn(fixture.journalStore, 'clear').mockImplementation(async (journal, assertAuthority) => {
      clearing = true;
      return clear(journal, async () => {
        clearIteration += 1;
        checks = 0;
        await assertAuthority!();
      });
    });

    await expect(fixture.transaction.clearRolledBack(rolledBack, async () => {
      if (clearing && clearIteration === 3 && ++checks === 3) {
        await mkdir(root);
        await writeFile(retained, 'final callback evidence');
        recreated = true;
      }
    })).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');

    expect(recreated).toBe(true);
    expect(await fixture.journalStore.peek()).toEqual(rolledBack);
    expect(await readFile(retained, 'utf8')).toBe('final callback evidence');
    expect(await readFile(fixture.activeDatabasePath, 'utf8')).toBe('old database');
  });

  it('rejects early staging-root relocation while an originally absent active slot still holds the target', async () => {
    const fixture = await createFixture({ activeProfileExists: false });
    const selected = await beginInterruptedRollback(fixture);
    const failedStagingRoot = join(fixture.failedRoot, operationId, 'staging');
    await mkdir(dirname(failedStagingRoot), { recursive: true });
    await rename(join(fixture.stagingRoot, operationId), failedStagingRoot);
    const before = await captureEvidence(fixture);

    await expect(fixture.transaction.rollback(selected)).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');

    expect(await fixture.journalStore.peek()).toEqual(selected);
    expect(await captureEvidence(fixture)).toEqual(before);
    expect(await readdir(failedStagingRoot)).toContain('activation');
  });

  it('preserves an interrupted rollback rejection through the actual startup observer without leaking evidence', async () => {
    const fixture = await createFixture();
    const selected = await beginInterruptedRollback(fixture);
    await rm(join(fixture.rollbackRoot, operationId, 'data', 'eky.sqlite'));
    const observe = vi.fn();
    const recovery = new ProfileRestoreStartupRecovery({
      journalStore: fixture.journalStore, transaction: fixture.createTransaction(), observer: { observe },
    });
    const before = await captureEvidence(fixture);

    await expect(recovery.prepareBeforeBackend()).rejects.toMatchObject({
      message: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
      cause: { message: 'PROFILE_RESTORE_ACTIVATION_STATE_INVALID' },
    });

    expect(observe.mock.calls.map(([event]) => event.eventName)).toEqual([
      'restore.rollbackStarted', 'restore.rollbackFailed', 'restore.recoveryRequired',
    ]);
    expect(observe).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'restore.rollbackFailed', stage: 'startupRollback',
      errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED', sideEffectState: 'unknown',
    }));
    expect(JSON.stringify(observe.mock.calls)).not.toMatch(/(?:sqlite|old database|new database|password|manifest|companyId|rollbackRoot)/i);
    expect(await fixture.journalStore.peek()).toEqual(selected);
    expect(await captureEvidence(fixture)).toEqual(before);
  });

  it.each(['database', 'documents'] as const)(
    'does not guess the new active %s is original after an interrupted rollback loses its original slot', async kind => {
      const fixture = await createFixture();
      const selected = await beginInterruptedRollback(fixture);
      await rm(kind === 'database'
        ? join(fixture.rollbackRoot, operationId, 'data', 'eky.sqlite')
        : join(fixture.rollbackRoot, operationId, 'storage', 'invoices'), { recursive: true });
      const before = await captureEvidence(fixture);

      await expect(fixture.transaction.rollback(selected)).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');

      expect(await fixture.journalStore.peek()).toEqual(selected);
      expect(await captureEvidence(fixture)).toEqual(before);
      await expect(readdir(join(fixture.failedRoot, operationId))).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('preserves duplicate staging roots before resuming an interrupted rollback', async () => {
    const fixture = await createFixture();
    const selected = await beginInterruptedRollback(fixture);
    const duplicate = join(fixture.failedRoot, operationId, 'staging');
    await mkdir(duplicate, { recursive: true });
    await writeFile(join(duplicate, 'retain.txt'), 'ambiguous staging');
    const before = await captureEvidence(fixture);

    await expect(fixture.transaction.rollback(selected)).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');

    expect(await fixture.journalStore.peek()).toEqual(selected);
    expect(await captureEvidence(fixture)).toEqual(before);
    expect(await readFile(join(duplicate, 'retain.txt'), 'utf8')).toBe('ambiguous staging');
  });

  it.each(['database', 'documents'] as const)(
    'keeps the terminal journal when the restored original %s is missing', async kind => {
      const fixture = await createFixture();
      await fixture.transaction.prepare(operationId);
      await fixture.transaction.advanceToValidation();
      const selected = await fixture.transaction.rollback();
      await rm(kind === 'database' ? fixture.activeDatabasePath : fixture.activeDocumentsRoot, { recursive: true });
      const before = await captureEvidence(fixture);

      await expect(fixture.transaction.clearRolledBack(selected)).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');

      expect(await fixture.journalStore.peek()).toEqual(selected);
      expect(await captureEvidence(fixture)).toEqual(before);
      expect(await readdir(join(fixture.rollbackRoot, operationId))).toBeDefined();
    },
  );

  it.each(['accept', 'rollback'] as const)(
    'refuses %s before changing a validation journal when an original rollback slot is missing', async action => {
      for (const kind of ['database', 'documents'] as const) {
        const fixture = await createFixture();
        await fixture.transaction.prepare(operationId);
        await fixture.transaction.advanceToValidation();
        const selected = (await fixture.journalStore.peek())!;
        await rm(kind === 'database'
          ? join(fixture.rollbackRoot, operationId, 'data', 'eky.sqlite')
          : join(fixture.rollbackRoot, operationId, 'storage', 'invoices'), { recursive: true });
        const before = await captureEvidence(fixture);

        await expect(fixture.transaction[action](selected)).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');

        expect(await fixture.journalStore.peek()).toEqual(selected);
        expect(await captureEvidence(fixture)).toEqual(before);
        await expect(readdir(join(fixture.failedRoot, operationId))).rejects.toMatchObject({ code: 'ENOENT' });
      }
    },
  );

  it.each(['accept', 'rollback'] as const)(
    'preserves duplicate staged data and unexpected failed evidence before %s', async action => {
      for (const kind of ['staged', 'failed'] as const) {
        const fixture = await createFixture();
        await fixture.transaction.prepare(operationId);
        await fixture.transaction.advanceToValidation();
        const selected = (await fixture.journalStore.peek())!;
        const evidence = kind === 'staged'
          ? join(fixture.stagingRoot, operationId, 'profile.sqlite')
          : join(fixture.failedRoot, operationId, 'retain.txt');
        await mkdir(dirname(evidence), { recursive: true });
        await writeFile(evidence, 'retain ambiguous evidence');
        const before = await captureEvidence(fixture);

        await expect(fixture.transaction[action](selected)).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');

        expect(await fixture.journalStore.peek()).toEqual(selected);
        expect(await captureEvidence(fixture)).toEqual(before);
        expect(await readFile(evidence, 'utf8')).toBe('retain ambiguous evidence');
      }
    },
  );

  it.each(['accept', 'rollback', 'clearRolledBack'] as const)(
    'binds %s to the selected operation without repairing or deleting foreign evidence', async action => {
      const fixture = await createFixture();
      await fixture.transaction.prepare(operationId);
      await fixture.transaction.advanceToValidation();
      if (action === 'clearRolledBack') await fixture.transaction.rollback();
      const selected = (await fixture.journalStore.peek())!;
      await fixture.journalStore.write({ ...selected, operationId: '33333333-3333-4333-8333-333333333333' });
      const nextPath = join(dirname(fixture.stagingRoot), 'profile-restore-state', `${profileRestoreActivationJournalFileName}.next`);
      await writeFile(nextPath, 'retain unrelated journal slot');
      const before = await captureEvidence(fixture);
      await expect(fixture.transaction[action](selected)).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
      expect(await captureEvidence(fixture)).toEqual(before);
      expect(await readFile(nextPath, 'utf8')).toBe('retain unrelated journal slot');
      expect(await fixture.journalStore.peek()).toEqual({ ...selected, operationId: '33333333-3333-4333-8333-333333333333' });
    },
  );

  it('retains rollback and staging when acceptance loses authority at the journal commit', async () => {
    const fixture = await createFixture();
    await fixture.transaction.prepare(operationId);
    await fixture.transaction.advanceToValidation();
    const selected = (await fixture.journalStore.peek())!;
    const before = await captureEvidence(fixture);
    const primary = new Error('synthetic accepted ownership lost');
    await expect(fixture.transaction.accept(selected, async () => {
      if ((await fixture.journalStore.peek())?.phase === 'accepted') throw primary;
    })).rejects.toMatchObject({ message: 'PROFILE_RESTORE_JOURNAL_UNAVAILABLE', cause: primary });
    expect(await captureEvidence(fixture)).toEqual(before);
    expect(await fixture.journalStore.peek()).toMatchObject({ operationId, phase: 'accepted' });
  });

  it('does not move the database or rewrite failedSafe after rollback authority is lost between slot moves', async () => {
    const fixture = await createFixture();
    await fixture.transaction.prepare(operationId);
    await fixture.transaction.advanceToValidation();
    const selected = (await fixture.journalStore.peek())!;
    const primary = new Error('synthetic rollback ownership lost');
    await expect(fixture.transaction.rollback(selected, async () => {
      if (await readFile(fixture.activePdfPath, 'utf8').catch(() => undefined) === 'old pdf') throw primary;
    })).rejects.toMatchObject({ message: 'PROFILE_RESTORE_ROLLBACK_FAILED', cause: primary });
    expect(await fixture.journalStore.peek()).toMatchObject({ operationId, phase: 'rollbackStarting' });
    expect(await readFile(fixture.activeDatabasePath, 'utf8')).toBe('new database');
    expect(await readFile(join(fixture.rollbackRoot, operationId, 'data', 'eky.sqlite'), 'utf8')).toBe('old database');
    expect(await readFile(fixture.activePdfPath, 'utf8')).toBe('old pdf');
    expect(await readFile(join(fixture.failedRoot, operationId, 'active', 'storage', 'invoices',
      'company-1', 'invoice-1', 'approved-invoice.pdf'), 'utf8')).toBe('new pdf');
    expect(await readFile(join(fixture.stagingRoot, operationId, 'profile.sqlite'), 'utf8').catch(() => undefined)).toBeUndefined();
    expect(await readdir(join(fixture.stagingRoot, operationId))).toContain('activation');
  });

  it('retains the selected rolledBack journal when final cleanup authority is lost', async () => {
    const fixture = await createFixture();
    await fixture.transaction.prepare(operationId);
    await fixture.transaction.advanceToValidation();
    const selected = await fixture.transaction.rollback();
    const primary = new Error('synthetic cleanup ownership lost');
    await expect(fixture.transaction.clearRolledBack(selected, async () => {
      const remaining = await readdir(join(fixture.rollbackRoot, operationId)).catch(error => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (remaining === undefined) throw primary;
    }))
      .rejects.toBe(primary);
    expect(await fixture.journalStore.peek()).toEqual(selected);
    expect(await readFile(fixture.activeDatabasePath, 'utf8')).toBe('old database');
    expect(await readFile(join(fixture.failedRoot, operationId, 'active', 'data', 'eky.sqlite'), 'utf8')).toBe('new database');
  });

  it.each(interruptiblePhases)(
    'preserves ordinary startup rollback after its own persisted %s interruption', async interruptedPhase => {
      const fixture = await createFixture({ interruptedPhase });
      await fixture.transaction.prepare(operationId);
      const recovery = new ProfileRestoreStartupRecovery({ journalStore: fixture.journalStore, transaction: fixture.transaction });
      await expect(recovery.prepareBeforeBackend()).resolves.toBe('validateRolledBackProfile');
      expect(await fixture.journalStore.peek()).toMatchObject({ operationId, phase: 'rolledBack' });
      expect(await readFile(fixture.activeDatabasePath, 'utf8')).toBe('old database');
      expect(await readFile(fixture.activePdfPath, 'utf8')).toBe('old pdf');
    },
  );

  it.each([
    { operationId: '33333333-3333-4333-8333-333333333333' },
    { revision: 99 }, { phase: 'accepted' as const },
    { hadActiveDatabase: false }, { hadActiveDocuments: false },
    { phase: 'prepared' as const, revision: 0 },
  ])('retains first forward failure and refuses an unrelated or invalid progressed journal %#', async change => {
    const fixture = await createFixture({ interruptedPhase: 'currentDatabaseMoved' });
    await fixture.transaction.prepare(operationId);
    const write = fixture.journalStore.write.bind(fixture.journalStore);
    vi.spyOn(fixture.journalStore, 'write').mockImplementation(async (journal, authority) => {
      await write(journal, authority);
      if (journal.phase === 'currentDatabaseMoved') await write({ ...journal, ...change });
    });
    const rollback = vi.spyOn(fixture.transaction, 'rollback');
    const recovery = new ProfileRestoreStartupRecovery({ journalStore: fixture.journalStore, transaction: fixture.transaction });
    const error = await recovery.prepareBeforeBackend().then(() => { throw new Error('expected interrupted startup'); }, error => error);
    expect(error.message).toBe('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(error.cause).toBeInstanceOf(AggregateError);
    expect(error.cause.errors[0]).toMatchObject({ message: 'synthetic interruption' });
    expect(error.cause.errors[1]).toMatchObject({ message: 'PROFILE_RESTORE_ACTIVATION_STATE_INVALID' });
    expect(rollback).not.toHaveBeenCalled();
    expect(await readFile(join(fixture.rollbackRoot, operationId, 'data', 'eky.sqlite'), 'utf8')).toBe('old database');
    expect(await readFile(join(fixture.stagingRoot, operationId, 'profile.sqlite'), 'utf8')).toBe('new database');
    expect(await fixture.journalStore.peek()).toMatchObject(change);
  });

  it('keeps the original forward cause ahead of a nonmutating peek failure', async () => {
    const fixture = await createFixture({ interruptedPhase: 'currentDatabaseMoved' });
    await fixture.transaction.prepare(operationId);
    const primary = new Error('synthetic interrupted journal unreadable');
    let forwardFailed = false;
    const advance = fixture.transaction.advanceToValidation.bind(fixture.transaction);
    vi.spyOn(fixture.transaction, 'advanceToValidation').mockImplementation(async (...args) => {
      try { return await advance(...args); }
      catch (error) { forwardFailed = true; throw error; }
    });
    const peek = fixture.journalStore.peek.bind(fixture.journalStore);
    vi.spyOn(fixture.journalStore, 'peek').mockImplementation(async () => {
      const journal = await peek();
      if (forwardFailed && journal?.phase === 'currentDatabaseMoved') throw primary;
      return journal;
    });
    const rollback = vi.spyOn(fixture.transaction, 'rollback');
    const recovery = new ProfileRestoreStartupRecovery({ journalStore: fixture.journalStore, transaction: fixture.transaction });
    const error = await recovery.prepareBeforeBackend().catch(error => error);
    expect(error.cause.errors[0]).toMatchObject({ message: 'synthetic interruption' });
    expect(error.cause.errors[1]).toBe(primary);
    expect(rollback).not.toHaveBeenCalled();
    expect(await readFile(join(fixture.rollbackRoot, operationId, 'data', 'eky.sqlite'), 'utf8')).toBe('old database');
  });

  it('keeps the original forward cause ahead of a rollback mutation failure', async () => {
    const fixture = await createFixture({ interruptedPhase: 'currentDatabaseMoved' });
    await fixture.transaction.prepare(operationId);
    const primary = new Error('synthetic rollback failed');
    vi.spyOn(fixture.transaction, 'rollback').mockRejectedValueOnce(primary);
    const recovery = new ProfileRestoreStartupRecovery({ journalStore: fixture.journalStore, transaction: fixture.transaction });
    const error = await recovery.prepareBeforeBackend().catch(error => error);
    expect(error.cause.errors[0]).toMatchObject({ message: 'synthetic interruption' });
    expect(error.cause.errors[1]).toMatchObject({ message: 'PROFILE_RESTORE_RECOVERY_REQUIRED', cause: primary });
    expect(await fixture.journalStore.peek()).toMatchObject({ phase: 'currentDatabaseMoved' });
  });

  it('uses freshly selected content before each forward journal and move mutation', async () => {
    const fixture = await createFixture();
    await fixture.transaction.prepare(operationId);
    const initial = (await fixture.journalStore.peek())!;
    const admitted: string[] = [];
    await fixture.transaction.advanceToValidation(initial, async () => {}, async journal => {
      expect(await fixture.journalStore.peek()).toEqual(journal);
      const sources = await fixture.transaction.readForwardRecoverySources(journal);
      admitted.push(`${journal.phase}:${sources.databaseSlot}:${sources.documentsSlot}`);
    });
    expect(admitted).toContain('prepared:staged:staged');
    expect(admitted).toContain('activatingStagedDatabase:active:staged');
    expect(admitted).toContain('activatingStagedDocuments:active:active');
    expect(admitted.at(-1)).toBe('validationStarting:active:active');
    expect(admitted.length).toBeGreaterThan(20);
  });

  it('rejects a linked destination parent before cold directory preparation changes it', async () => {
    const f = await createFixture();
    await f.transaction.prepare(operationId);
    const selected = (await f.journalStore.peek())!;
    const parent = join(f.rollbackRoot, operationId, 'data');
    const outside = join(dirname(f.stagingRoot), 'untouched-directory');
    await mkdir(outside);
    await writeFile(join(outside, 'retain.txt'), 'unchanged');
    const write = f.journalStore.write.bind(f.journalStore);
    let injected = false;
    vi.spyOn(f.journalStore, 'write').mockImplementation(async (journal, authority) => {
      await write(journal, authority);
      if (journal.phase === 'movingCurrentDatabase') {
        await symlink(outside, parent, process.platform === 'win32' ? 'junction' : 'dir');
        injected = true;
      }
    });
    const create = vi.mocked(mkdir).mockClear();
    const permissions = vi.mocked(chmod).mockClear();
    await expect(f.transaction.advanceToValidation(selected, async () => {}, async journal => {
      await f.transaction.readForwardRecoverySources(journal);
    })).rejects.toThrow();
    expect(injected).toBe(true);
    expect(create).toHaveBeenCalled();
    expect(permissions).toHaveBeenCalled();
    expect(create.mock.calls.filter(([path]) => path === parent)).toEqual([]);
    expect(permissions.mock.calls.filter(([path]) => path === parent)).toEqual([]);
    expect(await readdir(outside)).toEqual(['retain.txt']);
    expect(await readFile(join(outside, 'retain.txt'), 'utf8')).toBe('unchanged');
    expect(await readFile(f.activeDatabasePath, 'utf8')).toBe('old database');
    expect(await readFile(f.activePdfPath, 'utf8')).toBe('old pdf');
    expect(await readFile(join(f.stagingRoot, operationId, 'profile.sqlite'), 'utf8')).toBe('new database');
    expect(await f.journalStore.peek()).toMatchObject({ phase: 'movingCurrentDatabase' });
  });

  it('rechecks cold ownership after awaited directory-layout inspection', async () => {
    const f = await createFixture();
    await f.transaction.prepare(operationId);
    const selected = (await f.journalStore.peek())!;
    const parent = join(f.rollbackRoot, operationId, 'data');
    const first = new Error('synthetic preparation ownership expired');
    const write = f.journalStore.write.bind(f.journalStore);
    let preparation = false;
    let owned = true;
    vi.spyOn(f.journalStore, 'write').mockImplementation(async (journal, authority) => {
      await write(journal, authority);
      if (journal.phase === 'movingCurrentDatabase') preparation = true;
    });
    const inspect = f.transaction.readForwardRecoverySources.bind(f.transaction);
    vi.spyOn(f.transaction, 'readForwardRecoverySources').mockImplementation(async journal => {
      const sources = await inspect(journal);
      if (preparation) owned = false;
      return sources;
    });
    const create = vi.mocked(mkdir).mockClear();
    const permissions = vi.mocked(chmod).mockClear();
    await expect(f.transaction.advanceToValidation(selected, async () => {
      if (!owned) throw first;
    }, async journal => { await inspect(journal); })).rejects.toBe(first);
    expect(owned).toBe(false);
    expect(create).toHaveBeenCalled();
    expect(permissions).toHaveBeenCalled();
    expect(create.mock.calls.filter(([path]) => path === parent)).toEqual([]);
    expect(permissions.mock.calls.filter(([path]) => path === parent)).toEqual([]);
    expect(await readFile(f.activeDatabasePath, 'utf8')).toBe('old database');
    expect(await readFile(f.activePdfPath, 'utf8')).toBe('old pdf');
    expect(await readFile(join(f.stagingRoot, operationId, 'profile.sqlite'), 'utf8')).toBe('new database');
    expect(await f.journalStore.peek()).toMatchObject({ phase: 'movingCurrentDatabase' });
  });

  it.each(['database', 'pdf'] as const)('checks changed %s bytes after directory preparation before any payload rename', async kind => {
    const f = await createFixture();
    await f.transaction.prepare(operationId);
    const selected = (await f.journalStore.peek())!;
    const parent = join(f.rollbackRoot, operationId, 'data');
    const stagedDatabase = join(f.stagingRoot, operationId, 'profile.sqlite');
    const changed = kind === 'database' ? stagedDatabase : f.stagedPdfPath;
    const replacement = kind === 'database' ? 'NEW database' : 'NEW pdf';
    const expectedEvidence = await captureEvidence(f);
    expect(Buffer.byteLength(replacement)).toBe((await readFile(changed)).length);
    expectedEvidence[kind === 'database' ? 2 : 3] = replacement;
    const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
    const expectedDatabase = hash(await readFile(stagedDatabase));
    const expectedPdf = hash(await readFile(f.stagedPdfPath));
    const failure = new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
    let injected = false;
    vi.mocked(chmod).mockImplementation(async (...args) => {
      await fileSystem.chmod(...args);
      if (args[0] === parent && !injected) { injected = true; await writeFile(changed, replacement); }
    });
    const moves = vi.mocked(rename).mockClear();
    await expect(f.transaction.advanceToValidation(selected, async () => {}, async journal => {
      const sources = await f.transaction.readForwardRecoverySources(journal);
      if (hash(await readFile(sources.databaseSlot === 'active' ? f.activeDatabasePath : stagedDatabase)) !== expectedDatabase ||
          hash(await readFile(sources.documentsSlot === 'active' ? f.activePdfPath : f.stagedPdfPath)) !== expectedPdf) throw failure;
    })).rejects.toBe(failure);
    expect(injected).toBe(true);
    expect(moves).toHaveBeenCalled();
    expect(moves.mock.calls.some(([source]) => source === f.activeDatabasePath || source === stagedDatabase ||
      source === dirname(dirname(dirname(f.activePdfPath))) || source === dirname(dirname(dirname(f.stagedPdfPath))))).toBe(false);
    expect(await captureEvidence(f)).toEqual(expectedEvidence);
    expect(await readdir(parent)).toEqual([]);
    expect(await f.journalStore.peek()).toMatchObject({ phase: 'movingCurrentDatabase' });
  });

  it('stops before chmod and payload mutation if directory creation loses ownership', async () => {
    const f = await createFixture();
    await f.transaction.prepare(operationId);
    const selected = (await f.journalStore.peek())!;
    const parent = join(f.rollbackRoot, operationId, 'data');
    const evidence = await captureEvidence(f);
    const primary = new Error('synthetic ownership lost during mkdir');
    let owned = true;
    vi.mocked(mkdir).mockImplementation(async (...args) => {
      const result = await fileSystem.mkdir(...args);
      if (args[0] === parent) owned = false;
      return result;
    });
    const permissions = vi.mocked(chmod).mockClear();
    const moves = vi.mocked(rename).mockClear();
    await expect(f.transaction.advanceToValidation(selected, async () => {
      if (!owned) throw primary;
    }, async journal => { await f.transaction.readForwardRecoverySources(journal); })).rejects.toBe(primary);
    expect(owned).toBe(false);
    expect(permissions).toHaveBeenCalled();
    expect(permissions.mock.calls.filter(([path]) => path === parent)).toEqual([]);
    expect(moves.mock.calls.filter(([source]) => source === f.activeDatabasePath)).toEqual([]);
    expect(await captureEvidence(f)).toEqual(evidence);
    expect(await readdir(parent)).toEqual([]);
    expect(await f.journalStore.peek()).toMatchObject({ phase: 'movingCurrentDatabase' });
  });

  it('stops forward progress without rollback when content changes after a persisted phase', async () => {
    const fixture = await createFixture();
    await fixture.transaction.prepare(operationId);
    const initial = (await fixture.journalStore.peek())!;
    const primary = new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
    const rollback = vi.spyOn(fixture.transaction, 'rollback');
    const recovery = new ProfileRestoreStartupRecovery({ journalStore: fixture.journalStore, transaction: fixture.transaction });
    await expect(recovery.prepareBeforeBackend({ journal: initial, assertCurrent: async () => {},
      async assertContent(journal) {
        await fixture.transaction.readForwardRecoverySources(journal);
        if (journal.phase === 'currentDatabaseMoved') throw primary;
      },
    })).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(rollback).not.toHaveBeenCalled();
    expect(await fixture.journalStore.peek()).toMatchObject({ phase: 'currentDatabaseMoved' });
    expect(await readFile(join(fixture.stagingRoot, operationId, 'profile.sqlite'), 'utf8')).toBe('new database');
    expect(await readFile(join(fixture.rollbackRoot, operationId, 'data', 'eky.sqlite'), 'utf8')).toBe('old database');
  });

  it('does not extend cold forward admission into rollback on an ordinary move failure', async () => {
    const fixture = await createFixture({ interruptedPhase: 'currentDatabaseMoved' });
    await fixture.transaction.prepare(operationId);
    const journal = (await fixture.journalStore.peek())!;
    const rollback = vi.spyOn(fixture.transaction, 'rollback');
    const recovery = new ProfileRestoreStartupRecovery({ journalStore: fixture.journalStore, transaction: fixture.transaction });
    await expect(recovery.prepareBeforeBackend({ journal, assertCurrent: async () => {}, assertContent: async () => {} }))
      .rejects.toMatchObject({ message: 'PROFILE_RESTORE_RECOVERY_REQUIRED', cause: { message: 'synthetic interruption' } });
    expect(rollback).not.toHaveBeenCalled();
    await expect(fixture.journalStore.peek()).resolves.toMatchObject({ phase: 'currentDatabaseMoved' });
    await expect(readFile(join(fixture.stagingRoot, operationId, 'profile.sqlite'), 'utf8')).resolves.toBe('new database');
    await expect(readFile(join(fixture.rollbackRoot, operationId, 'data', 'eky.sqlite'), 'utf8')).resolves.toBe('old database');
  });

  it('does not repair recovery slots during a read-only census after its authority is lost', async () => {
    const fixture = await createFixture();
    await fixture.transaction.prepare(operationId);
    const journal = (await fixture.journalStore.peek())!;
    const nextPath = join(dirname(fixture.stagingRoot), 'profile-restore-state', `${profileRestoreActivationJournalFileName}.next`);
    const evidence = Buffer.from('unknown recovery evidence');
    let injected = false;
    const inject = async () => {
      if (!injected) { injected = true; await writeFile(nextPath, evidence); }
    };
    const read = fixture.journalStore.read.bind(fixture.journalStore);
    const peek = fixture.journalStore.peek.bind(fixture.journalStore);
    const repairingRead = vi.spyOn(fixture.journalStore, 'read').mockImplementation(async expected => {
      const value = await read(expected); await inject(); return value;
    });
    vi.spyOn(fixture.journalStore, 'peek').mockImplementation(async () => {
      const value = await peek(); await inject(); return value;
    });
    await expect(fixture.transaction.assertForwardRecoveryState(journal)).resolves.toBeUndefined();
    expect(repairingRead).not.toHaveBeenCalled();
    await expect(readFile(nextPath)).resolves.toEqual(evidence);
  });

  it.each(['movingCurrentDatabase', 'currentDatabaseMoved', 'movingCurrentDocuments', 'currentDocumentsMoved',
    'activatingStagedDatabase', 'stagedDatabaseActivated', 'activatingStagedDocuments', 'stagedDocumentsActivated'] as const)(
    'stops at %s and preserves both generations when cold ownership is lost after persistence', async phase => {
      const fixture = await createFixture();
      await fixture.transaction.prepare(operationId);
      const journal = (await fixture.journalStore.peek())!;
      const write = fixture.journalStore.write.bind(fixture.journalStore);
      let current = true;
      vi.spyOn(fixture.journalStore, 'write').mockImplementation(async value => {
        await write(value);
        if (value.phase === phase) current = false;
      });
      const rollback = vi.spyOn(fixture.transaction, 'rollback');
      const recovery = new ProfileRestoreStartupRecovery({ journalStore: fixture.journalStore, transaction: fixture.transaction });
      await expect(recovery.prepareBeforeBackend({ journal, assertContent: async () => {}, async assertCurrent() {
        if (!current) throw new Error('synthetic operation reservation lost');
      } })).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
      expect(rollback).not.toHaveBeenCalled();
      await expect(fixture.journalStore.peek()).resolves.toMatchObject({ operationId, phase });
      const readPresent = async (paths: string[]) => {
        const values: string[] = [];
        for (const path of paths) {
          try { values.push(await readFile(path, 'utf8')); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        return values.sort();
      };
      await expect(readPresent([fixture.activeDatabasePath,
        join(fixture.rollbackRoot, operationId, 'data', 'eky.sqlite'),
        join(fixture.stagingRoot, operationId, 'profile.sqlite')]))
        .resolves.toEqual(['new database', 'old database']);
      await expect(readPresent([fixture.activePdfPath,
        join(fixture.rollbackRoot, operationId, 'storage', 'invoices', 'company-1', 'invoice-1', 'approved-invoice.pdf'),
        join(fixture.stagingRoot, operationId, 'activation', 'storage', 'invoices', 'company-1', 'invoice-1', 'approved-invoice.pdf')]))
        .resolves.toEqual(['new pdf', 'old pdf']);
    },
  );

  it.each(['operationId', 'phase', 'revision', 'hadActiveDatabase', 'hadActiveDocuments'] as const)(
    'rejects a changed %s between slot inspection and continuation without rollback', async key => {
    const fixture = await createFixture();
    await fixture.transaction.prepare(operationId);
    const before = (await fixture.journalStore.read())!;
    const changes: Record<typeof key, Partial<ProfileRestoreActivationJournal>> = {
      operationId: { operationId: '22222222-2222-4222-8222-222222222222' },
      phase: { phase: 'validationStarting' }, revision: { revision: 1 },
      hadActiveDatabase: { hadActiveDatabase: false }, hadActiveDocuments: { hadActiveDocuments: false },
    };
    const foreign = { ...before, ...changes[key] };
    const assertState = fixture.transaction.assertForwardRecoveryState.bind(fixture.transaction);
    vi.spyOn(fixture.transaction, 'assertForwardRecoveryState').mockImplementationOnce(async journal => {
      await assertState(journal);
      await fixture.journalStore.write(foreign);
    });
    const rollback = vi.spyOn(fixture.transaction, 'rollback');
    const recovery = new ProfileRestoreStartupRecovery({ journalStore: fixture.journalStore,
      transaction: fixture.transaction });
    await expect(recovery.prepareBeforeBackend()).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(rollback).not.toHaveBeenCalled();
    await expect(fixture.journalStore.read()).resolves.toEqual(foreign);
    await expect(readFile(fixture.activeDatabasePath, 'utf8')).resolves.toBe('old database');
    await expect(readFile(join(fixture.stagingRoot, operationId, 'profile.sqlite'), 'utf8'))
      .resolves.toBe('new database');
  });

  it('preserves files when the checked journal disappears before continuation', async () => {
    const fixture = await createFixture();
    await fixture.transaction.prepare(operationId);
    const assertState = fixture.transaction.assertForwardRecoveryState.bind(fixture.transaction);
    vi.spyOn(fixture.transaction, 'assertForwardRecoveryState').mockImplementationOnce(async journal => {
      await assertState(journal);
      await fixture.journalStore.clear();
    });
    const rollback = vi.spyOn(fixture.transaction, 'rollback');
    const recovery = new ProfileRestoreStartupRecovery({ journalStore: fixture.journalStore,
      transaction: fixture.transaction });
    await expect(recovery.prepareBeforeBackend()).rejects.toMatchObject({
      message: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
      cause: { message: 'PROFILE_RESTORE_JOURNAL_REQUIRED' },
    });
    expect(rollback).not.toHaveBeenCalled();
    await expect(readFile(fixture.activeDatabasePath, 'utf8')).resolves.toBe('old database');
    await expect(readFile(join(fixture.stagingRoot, operationId, 'profile.sqlite'), 'utf8'))
      .resolves.toBe('new database');
  });

  it.each(['activeDatabase', 'failedRoot'] as const)(
    'rejects a missing %s beneath a linked ancestor before any forward side effect', async slot => {
    const fixture = await createFixture({ activeProfileExists: false });
    const outside = join(dirname(fixture.stagingRoot), 'outside-data');
    await mkdir(outside, { mode: 0o700 });
    await symlink(outside, slot === 'activeDatabase' ? dirname(fixture.activeDatabasePath) : fixture.failedRoot,
      process.platform === 'win32' ? 'junction' : 'dir');
    await fixture.transaction.prepare(operationId);
    const before = await fixture.journalStore.read();
    const advance = vi.spyOn(fixture.transaction, 'advanceToValidation');
    const rollback = vi.spyOn(fixture.transaction, 'rollback');
    const recovery = new ProfileRestoreStartupRecovery({ journalStore: fixture.journalStore,
      transaction: fixture.transaction });
    await expect(recovery.prepareBeforeBackend()).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(advance).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
    await expect(readdir(outside)).resolves.toEqual([]);
    await expect(fixture.journalStore.read()).resolves.toEqual(before);
    await expect(readFile(join(fixture.stagingRoot, operationId, 'profile.sqlite'), 'utf8'))
      .resolves.toBe('new database');
  });

  for (const interruptedPhase of ['prepared', ...interruptiblePhases] as const) {
    it.each([
      [true, true], [true, false], [false, true], [false, false],
    ])(`validates and resumes real slots at ${interruptedPhase}, original DB=%s/documents=%s`,
      async (activeDatabaseExists, activeDocumentsExist) => {
        const fixture = await createFixture({ interruptedPhase, activeDatabaseExists, activeDocumentsExist });
        if (interruptedPhase === 'prepared') {
          await expect(fixture.transaction.prepare(operationId)).rejects.toThrow('synthetic interruption');
        } else {
          await fixture.transaction.prepare(operationId);
          await expect(fixture.transaction.advanceToValidation()).rejects.toThrow('synthetic interruption');
        }
        const journalBefore = await fixture.journalStore.read();
        expect(journalBefore).toBeDefined();
        const resumed = fixture.createTransaction();
        await expect(resumed.assertForwardRecoveryState(journalBefore!)).resolves.toBeUndefined();
        const selected = await resumed.readForwardRecoverySources(journalBefore!);
        expect(Object.isFrozen(selected)).toBe(true);
        const databasePath = selected.databaseSlot === 'active' ? fixture.activeDatabasePath
          : join(fixture.stagingRoot, operationId, 'profile.sqlite');
        const pdfPath = selected.documentsSlot === 'active' ? fixture.activePdfPath
          : fixture.stagedPdfPath;
        await expect(readFile(databasePath, 'utf8')).resolves.toBe('new database');
        await expect(readFile(pdfPath, 'utf8')).resolves.toBe('new pdf');
        await expect(fixture.journalStore.read()).resolves.toEqual(journalBefore);
        const recovery = new ProfileRestoreStartupRecovery({ journalStore: fixture.journalStore, transaction: resumed });
        await expect(recovery.prepareBeforeBackend()).resolves.toBe('validateRestoredProfile');
        await expect(readFile(fixture.activeDatabasePath, 'utf8')).resolves.toBe('new database');
        await expect(readFile(fixture.activePdfPath, 'utf8')).resolves.toBe('new pdf');
      });
  }

  it.each(['movingCurrentDatabase', 'movingCurrentDocuments',
    'activatingStagedDatabase', 'activatingStagedDocuments'] as const)(
    'accepts an intent interrupted after its rename at %s', async (interruptedPhase) => {
      const fixture = await createFixture({ interruptedPhase });
      await fixture.transaction.prepare(operationId);
      await expect(fixture.transaction.advanceToValidation()).rejects.toThrow('synthetic interruption');
      const [source, destination] = {
        movingCurrentDatabase: [fixture.activeDatabasePath,
          join(fixture.rollbackRoot, operationId, 'data', 'eky.sqlite')],
        movingCurrentDocuments: [fixture.activeDocumentsRoot,
          join(fixture.rollbackRoot, operationId, 'storage', 'invoices')],
        activatingStagedDatabase: [join(fixture.stagingRoot, operationId, 'profile.sqlite'), fixture.activeDatabasePath],
        activatingStagedDocuments: [join(fixture.stagingRoot, operationId, 'activation', 'storage', 'invoices'),
          fixture.activeDocumentsRoot],
      }[interruptedPhase];
      await mkdir(dirname(destination!), { recursive: true, mode: 0o700 });
      await rename(source!, destination!);
      const recovered = fixture.createTransaction();
      const selected = await recovered.readForwardRecoverySources((await fixture.journalStore.peek())!);
      expect(selected.databaseSlot).toBe(
        interruptedPhase === 'activatingStagedDatabase' || interruptedPhase === 'activatingStagedDocuments' ? 'active' : 'staged');
      expect(selected.documentsSlot).toBe(interruptedPhase === 'activatingStagedDocuments' ? 'active' : 'staged');
      const recovery = new ProfileRestoreStartupRecovery({ journalStore: fixture.journalStore, transaction: recovered });
      await expect(recovery.prepareBeforeBackend()).resolves.toBe('validateRestoredProfile');
      await expect(readFile(fixture.activeDatabasePath, 'utf8')).resolves.toBe('new database');
      await expect(readFile(fixture.activePdfPath, 'utf8')).resolves.toBe('new pdf');
    },
  );

  it('rejects a duplicated old slot without moving its staged successor', async () => {
    const fixture = await createFixture({ interruptedPhase: 'movingCurrentDatabase' });
    await fixture.transaction.prepare(operationId);
    await expect(fixture.transaction.advanceToValidation()).rejects.toThrow('synthetic interruption');
    const rollbackPath = join(fixture.rollbackRoot, operationId, 'data', 'eky.sqlite');
    await mkdir(dirname(rollbackPath), { recursive: true, mode: 0o700 });
    await writeFile(rollbackPath, 'ambiguous original');
    const before = await fixture.journalStore.read();
    await expect(fixture.createTransaction().assertForwardRecoveryState(before!))
      .rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    await expect(fixture.journalStore.read()).resolves.toEqual(before);
    await expect(readFile(fixture.activeDatabasePath, 'utf8')).resolves.toBe('old database');
    await expect(readFile(join(fixture.stagingRoot, operationId, 'profile.sqlite'), 'utf8'))
      .resolves.toBe('new database');
  });

  it('rejects a hard-linked staged database without removing either name', async () => {
    const fixture = await createFixture();
    await fixture.transaction.prepare(operationId);
    const source = join(fixture.stagingRoot, operationId, 'profile.sqlite');
    const alias = join(fixture.stagingRoot, operationId, 'unknown-alias');
    await link(source, alias);
    const before = await fixture.journalStore.read();
    await expect(fixture.transaction.assertForwardRecoveryState(before!))
      .rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    await expect(readFile(source, 'utf8')).resolves.toBe('new database');
    await expect(readFile(alias, 'utf8')).resolves.toBe('new database');
  });

  it('rejects failed-root evidence without removing it', async () => {
    const fixture = await createFixture();
    await fixture.transaction.prepare(operationId);
    const failedRoot = join(fixture.failedRoot, operationId);
    await mkdir(failedRoot, { recursive: true, mode: 0o700 });
    const evidencePath = join(failedRoot, 'evidence');
    await writeFile(evidencePath, 'unresolved');
    const before = await fixture.journalStore.read();
    await expect(fixture.transaction.assertForwardRecoveryState(before!))
      .rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    await expect(readFile(evidencePath, 'utf8')).resolves.toBe('unresolved');
    await expect(fixture.journalStore.read()).resolves.toEqual(before);
  });

  it.each(['operationId', 'phase', 'revision', 'hadActiveDatabase', 'hadActiveDocuments'] as const)(
    'rejects a changed %s in the final journal readback', async (key) => {
      const fixture = await createFixture();
      await fixture.transaction.prepare(operationId);
      const before = (await fixture.journalStore.read())!;
      const changed = { ...before, [key]: {
        operationId: '22222222-2222-4222-8222-222222222222', phase: 'movingCurrentDatabase',
        revision: 1, hadActiveDatabase: false, hadActiveDocuments: false,
      }[key] };
      const reader = vi.spyOn(fixture.journalStore, 'peek').mockResolvedValueOnce(before)
        .mockResolvedValueOnce(changed);
      await expect(fixture.transaction.assertForwardRecoveryState(before))
        .rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
      expect(reader).toHaveBeenCalledTimes(2);
      reader.mockRestore();
      await expect(fixture.journalStore.read()).resolves.toEqual(before);
      await expect(readFile(fixture.activeDatabasePath, 'utf8')).resolves.toBe('old database');
    },
  );

  it.each(['database', 'documents'] as const)(
    'preserves an inconsistent completed activation instead of starting rollback (%s)',
    async (slot) => {
      const fixture = await createFixture();
      await fixture.transaction.prepare(operationId);
      await fixture.transaction.advanceToValidation();
      await rm(slot === 'database' ? fixture.activeDatabasePath : fixture.activeDocumentsRoot,
        { recursive: true, force: true });
      const journalBefore = await fixture.journalStore.read();
      const advance = vi.spyOn(fixture.transaction, 'advanceToValidation');
      const rollback = vi.spyOn(fixture.transaction, 'rollback');
      const recovery = new ProfileRestoreStartupRecovery({
        journalStore: fixture.journalStore,
        transaction: fixture.transaction,
      });

      await expect(recovery.prepareBeforeBackend()).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');

      expect(advance).not.toHaveBeenCalled();
      expect(rollback).not.toHaveBeenCalled();
      await expect(fixture.journalStore.read()).resolves.toEqual(journalBefore);
      await expect(readFile(join(fixture.rollbackRoot, operationId, 'data', 'eky.sqlite'), 'utf8'))
        .resolves.toBe('old database');
      await expect(readFile(join(fixture.rollbackRoot, operationId, 'storage', 'invoices',
        'company-1', 'invoice-1', 'approved-invoice.pdf'), 'utf8')).resolves.toBe('old pdf');
    },
  );

  it('rejects original content becoming stale before publishing rollback intent', async () => {
    const fixture = await createFixture(); await fixture.transaction.prepare(operationId);
    const selected = await fixture.transaction.advanceToValidation();
    const assertCurrent = vi.fn(async () => {});
    await fixture.transaction.prepareColdRollbackAnchor(selected, async () => {}, assertCurrent);
    let checked = 0;
    const beforeStagingMove = vi.fn(async () => {});
    await expect(fixture.transaction.rollback(selected, assertCurrent, {
      async assertContent() { if (++checked > 1) throw new Error('synthetic original changed'); }, beforeStagingMove,
    })).rejects.toThrow('synthetic original changed');
    expect(beforeStagingMove).not.toHaveBeenCalled();
    await expect(fixture.journalStore.peek()).resolves.toEqual(selected);
    await expect(readFile(fixture.activeDatabasePath, 'utf8')).resolves.toBe('new database');
    await expect(readFile(join(fixture.rollbackRoot, operationId, 'data', 'eky.sqlite'), 'utf8')).resolves.toBe('old database');
  });

  it.each(['originalMissing', 'targetMissing', 'earlyFailedMove'] as const)(
    'rejects inconsistent validationStarting rollback geometry (%s)', async fault => {
      const fixture = await createFixture(); await fixture.transaction.prepare(operationId);
      const selected = await fixture.transaction.advanceToValidation();
      if (fault === 'originalMissing') await rm(join(fixture.rollbackRoot, operationId, 'data', 'eky.sqlite'));
      else if (fault === 'targetMissing') await rm(fixture.activeDatabasePath);
      else await mkdir(join(fixture.failedRoot, operationId, 'active'), { recursive: true });
      const assertCurrent = vi.fn(async () => {});
      const claim = vi.fn(async () => {});
      await expect(fixture.transaction.prepareColdRollbackAnchor(selected, claim, assertCurrent))
        .rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
      expect(claim).not.toHaveBeenCalled(); await expect(fixture.journalStore.peek()).resolves.toEqual(selected);
    },
  );

  it('checks original content before rollback intent and each move from validationStarting', async () => {
    const fixture = await createFixture(); await fixture.transaction.prepare(operationId);
    const selected = await fixture.transaction.advanceToValidation();
    const assertCurrent = vi.fn(async () => {});
    await fixture.transaction.prepareColdRollbackAnchor(selected, async () => {}, assertCurrent);
    const phases: string[] = [];
    const assertContent = vi.fn(async (journal: Readonly<ProfileRestoreActivationJournal>) => { phases.push(journal.phase); });
    const beforeStagingMove = vi.fn(async () => {});
    await expect(fixture.transaction.rollback(selected, assertCurrent, { assertContent, beforeStagingMove }))
      .resolves.toMatchObject({ phase: 'rolledBack', revision: selected.revision + 2 });
    expect(phases[0]).toBe('validationStarting');
    expect(phases).toContain('rollbackStarting'); expect(phases).toContain('rolledBack');
    expect(beforeStagingMove).toHaveBeenCalledOnce();
    await expect(readFile(fixture.activeDatabasePath, 'utf8')).resolves.toBe('old database');
    await expect(readFile(fixture.activePdfPath, 'utf8')).resolves.toBe('old pdf');
  });

  it('keeps unjournaled rollback ownership non-retryable without deleting evidence', async () => {
    const fixture = await createFixture();
    const original = new Error('SYNTHETIC_JOURNAL_PUBLICATION_FAILURE');
    const writer = vi.spyOn(fixture.journalStore, 'write').mockRejectedValueOnce(original);
    await expect(fixture.transaction.prepare(operationId)).rejects.toBe(original);
    await expect(fixture.journalStore.read()).resolves.toBeUndefined();
    writer.mockRestore();
    await expect(fixture.transaction.readPreparation(operationId))
      .rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    await expect(fixture.transaction.prepare(operationId))
      .rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    await expect(readFile(fixture.activeDatabasePath, 'utf8')).resolves.toBe('old database');
    await expect(readFile(fixture.activePdfPath, 'utf8')).resolves.toBe('old pdf');
    await expect(fixture.transaction.readPreparation(operationId))
      .rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
  });
  it('reads back a journal persisted before prepare rejected without changing active bytes', async () => {
    const fixture = await createFixture({ interruptedPhase: 'prepared' });
    await expect(fixture.transaction.prepare(operationId)).rejects.toThrow('synthetic interruption');
    await expect(fixture.transaction.readPreparation(operationId)).resolves.toBe('prepared');
    await expect(fixture.journalStore.read()).resolves.toMatchObject({ operationId, phase: 'prepared' });
    await expect(readFile(fixture.activeDatabasePath, 'utf8')).resolves.toBe('old database');
    await expect(readFile(fixture.activePdfPath, 'utf8')).resolves.toBe('old pdf');
    await fixture.createTransaction().advanceToValidation();
    await expect(readFile(fixture.activeDatabasePath, 'utf8')).resolves.toBe('new database');
  });

  it('never treats a foreign or advanced journal as proof of an absent prepare', async () => {
    const fixture = await createFixture();
    await expect(fixture.transaction.readPreparation(operationId)).resolves.toBe('notPrepared');
    await fixture.transaction.prepare(operationId);
    await expect(fixture.transaction.readPreparation('22222222-2222-4222-8222-222222222222'))
      .rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    await fixture.transaction.advanceToValidation();
    await expect(fixture.transaction.readPreparation(operationId)).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    await expect(fixture.journalStore.read()).resolves.toMatchObject({ phase: 'validationStarting' });
  });

  it('RESTORE-ACTIVATE-001 @critical switches database and document slots and clears accepted rollback data', async () => {
    const fixture = await createFixture();

    await fixture.transaction.prepare(operationId);
    await expect(
      fixture.transaction.advanceToValidation(),
    ).resolves.toMatchObject({
      operationId,
      phase: 'validationStarting',
    });
    await expect(readFile(fixture.activeDatabasePath, 'utf8')).resolves.toBe(
      'new database',
    );
    await expect(readFile(fixture.activePdfPath, 'utf8')).resolves.toBe(
      'new pdf',
    );

    await fixture.transaction.accept();

    await expect(fixture.journalStore.read()).resolves.toBeUndefined();
  });

  it.each(interruptiblePhases)(
    'resumes idempotently after interruption at %s',
    async (interruptedPhase) => {
      const fixture = await createFixture({
        interruptedPhase,
      });

      await fixture.transaction.prepare(operationId);
      await expect(
        fixture.transaction.advanceToValidation(),
      ).rejects.toThrow('synthetic interruption');

      const resumed = fixture.createTransaction();
      await expect(resumed.advanceToValidation()).resolves.toMatchObject({
        phase: 'validationStarting',
      });
      await expect(
        readFile(fixture.activeDatabasePath, 'utf8'),
      ).resolves.toBe('new database');
      await expect(readFile(fixture.activePdfPath, 'utf8')).resolves.toBe(
        'new pdf',
      );
    },
  );

  it.each(interruptiblePhases)(
    'RESTORE-ROLLBACK-001 @fault rolls back to the old profile after interruption at %s',
    async (interruptedPhase) => {
      const fixture = await createFixture({
        interruptedPhase,
      });

      await fixture.transaction.prepare(operationId);
      await expect(
        fixture.transaction.advanceToValidation(),
      ).rejects.toThrow('synthetic interruption');

      const recovery = fixture.createTransaction();
      await expect(recovery.rollback()).resolves.toMatchObject({
        phase: 'rolledBack',
      });
      await expect(
        readFile(fixture.activeDatabasePath, 'utf8'),
      ).resolves.toBe('old database');
      await expect(readFile(fixture.activePdfPath, 'utf8')).resolves.toBe(
        'old pdf',
      );
    },
  );

  it('supports a demonstrably empty active profile', async () => {
    const fixture = await createFixture({ activeProfileExists: false });

    await fixture.transaction.prepare(operationId);
    await fixture.transaction.advanceToValidation();
    await fixture.transaction.rollback();

    await expect(readFile(fixture.activeDatabasePath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

async function beginInterruptedRollback(fixture: Awaited<ReturnType<typeof createFixture>>) {
  await fixture.transaction.prepare(operationId);
  const validation = await fixture.transaction.advanceToValidation();
  const selected: ProfileRestoreActivationJournal = {
    ...validation, phase: 'rollbackStarting', revision: validation.revision + 1,
  };
  await fixture.journalStore.write(selected);
  return selected;
}

async function simulateRollbackMoves(fixture: Awaited<ReturnType<typeof createFixture>>, count: number) {
  const failedRoot = join(fixture.failedRoot, operationId);
  const rollbackRoot = join(fixture.rollbackRoot, operationId);
  const moves = [
    [fixture.activeDocumentsRoot, join(failedRoot, 'active', 'storage', 'invoices')],
    [join(rollbackRoot, 'storage', 'invoices'), fixture.activeDocumentsRoot],
    [fixture.activeDatabasePath, join(failedRoot, 'active', 'data', 'eky.sqlite')],
    [join(rollbackRoot, 'data', 'eky.sqlite'), fixture.activeDatabasePath],
    [join(fixture.stagingRoot, operationId), join(failedRoot, 'staging')],
  ] as const;
  for (const [source, destination] of moves.slice(0, count)) {
    await mkdir(dirname(destination), { recursive: true });
    await rename(source, destination);
  }
}

async function captureEvidence(fixture: Awaited<ReturnType<typeof createFixture>>) {
  const paths = [fixture.activeDatabasePath, fixture.activePdfPath,
    join(fixture.stagingRoot, operationId, 'profile.sqlite'), fixture.stagedPdfPath,
    join(fixture.rollbackRoot, operationId, 'data', 'eky.sqlite'),
    join(fixture.rollbackRoot, operationId, 'storage', 'invoices', 'company-1', 'invoice-1', 'approved-invoice.pdf'),
    join(fixture.failedRoot, operationId, 'active', 'data', 'eky.sqlite'),
    join(fixture.failedRoot, operationId, 'active', 'storage', 'invoices', 'company-1', 'invoice-1', 'approved-invoice.pdf')];
  return Promise.all(paths.map(async path => readFile(path, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  })));
}

function allowMissing(error: unknown): undefined {
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
  throw error;
}

function createActivationFixture(transaction: ProfileRestoreActivationTransaction) {
  const owner = new PreparedProfileRestoreOwner();
  owner.set({ operationId, targetDisposition: 'replaceActiveProfile', summary: {
    appVersion: '0.2.81', compatibilityStatus: 'compatible', createdAt: '2026-08-04T00:00:00.000Z',
    databaseHealth: 'healthy', documentCount: 0, formatVersion: 1, profileMatchStatus: 'same', totalBusinessByteSize: 1,
  } });
  const profileSnapshotClient = {
    beginRestoreMaintenance: vi.fn(async () => 'busy' as const),
    assertRestoreMaintenance: vi.fn(async () => 'busy' as const),
    endRestoreMaintenance: vi.fn(async () => 'normal' as const),
    invalidateRestoreMaintenance: vi.fn(async () => 'busy' as const),
    retainProfileSnapshotForRecovery: vi.fn(),
    cancelProfileRestoreRetention: vi.fn(),
    releaseProfileSnapshot: vi.fn(),
    prepareProfileRestoreSnapshot: vi.fn(async () => ({
      activeProfileIsEmpty: false, artifactCount: 0, artifactTotalByteSize: 0, databaseHealth: 'healthy' as const,
      migrationChainIdentity: 'a'.repeat(64), profileId: 'b'.repeat(64), profileMatchesActive: true,
      type: 'profileSnapshotValidation' as const,
    })),
  };
  const stopBusinessRuntime = vi.fn();
  const relaunchApplication = vi.fn();
  const assertAuthority = vi.fn(async () => {});
  const service = new ProfileRestoreActivationService({
    profileSnapshotClient, transaction, stopBusinessRuntime, relaunchApplication,
    stagingService: { claimPreparedRestore: id => owner.claim(id) },
  });
  return { service, owner, profileSnapshotClient, stopBusinessRuntime, relaunchApplication, assertAuthority };
}

async function createFixture(
  options: {
    activeDatabaseExists?: boolean;
    activeDocumentsExist?: boolean;
    activeProfileExists?: boolean;
    interruptedPhase?: ProfileRestoreActivationPhase;
  } = {},
): Promise<{
  activeDatabasePath: string;
  activeDocumentsRoot: string;
  activePdfPath: string;
  createTransaction(): ProfileRestoreActivationTransaction;
  failedRoot: string;
  journalStore: ProfileRestoreActivationJournalStore;
  rollbackRoot: string;
  stagingRoot: string;
  stagedPdfPath: string;
  transaction: ProfileRestoreActivationTransaction;
}> {
  const root = await mkdtemp(join(tmpdir(), 'eky-restore-activation-'));
  roots.push(root);
  const runtimeRoot = join(root, 'runtime');
  const stagingRoot = join(runtimeRoot, 'private-backup-staging');
  const rollbackRoot = join(runtimeRoot, 'profile-restore-rollback');
  const failedRoot = join(runtimeRoot, 'failed-profile-restores');
  const activeDatabasePath = join(runtimeRoot, 'data', 'eky.sqlite');
  const activeDocumentsRoot = join(
    runtimeRoot,
    'storage',
    'invoices',
  );
  const activePdfPath = join(
    activeDocumentsRoot,
    'company-1',
    'invoice-1',
    'approved-invoice.pdf',
  );
  const stagedOperationRoot = join(stagingRoot, operationId);
  const stagedDatabasePath = join(
    stagedOperationRoot,
    'profile.sqlite',
  );
  const stagedPdfPath = join(
    stagedOperationRoot,
    'activation',
    'storage',
    'invoices',
    'company-1',
    'invoice-1',
    'approved-invoice.pdf',
  );
  const journalStore = new ProfileRestoreActivationJournalStore(
    join(
      runtimeRoot,
      'profile-restore-state',
      profileRestoreActivationJournalFileName,
    ),
  );

  await mkdir(join(stagedOperationRoot, 'activation'), {
    mode: 0o700,
    recursive: true,
  });
  await mkdir(dirname(stagedPdfPath), {
    mode: 0o700,
    recursive: true,
  });
  await writeFile(stagedDatabasePath, 'new database');
  await writeFile(stagedPdfPath, 'new pdf');

  if (options.activeDatabaseExists ?? options.activeProfileExists ?? true) {
    await mkdir(dirname(activeDatabasePath), {
      mode: 0o700,
      recursive: true,
    });
    await writeFile(activeDatabasePath, 'old database');
  }
  if (options.activeDocumentsExist ?? options.activeProfileExists ?? true) {
    await mkdir(dirname(activePdfPath), {
      mode: 0o700,
      recursive: true,
    });
    await writeFile(activePdfPath, 'old pdf');
  }

  const createTransaction = (
    interruptedPhase?: ProfileRestoreActivationPhase,
  ) =>
    new ProfileRestoreActivationTransaction({
      ...(interruptedPhase === undefined
        ? {}
        : {
            afterPhasePersisted(phase) {
              if (phase === interruptedPhase) {
                throw new Error('synthetic interruption');
              }
            },
          }),
      journalStore,
      paths: {
        activeDatabasePath,
        activeDocumentsRoot,
        failedRoot,
        rollbackRoot,
        stagingRoot,
      },
    });

  return {
    activeDatabasePath,
    activeDocumentsRoot,
    activePdfPath,
    createTransaction: () => createTransaction(),
    failedRoot,
    journalStore,
    rollbackRoot,
    stagingRoot,
    stagedPdfPath,
    transaction: createTransaction(options.interruptedPhase),
  };
}
