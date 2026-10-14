import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProfileSnapshotArtifactIdentity } from '../../runtime/profileInspectionArtifactIdentity.js';
import { encodeProfileInspectionDocumentBindings } from '../../runtime/profileInspectionDocumentBindings.js';
import { profileInspectionProtocolVersion, type ProfileInspectionOriginalSources } from '../../runtime/profileInspectionMessages.js';
import { createProfileRestoreOriginalContentAdmission } from './createProfileRestoreOriginalContentAdmission.js';
import type { ProfileRestoreColdContentContext } from './prepareProfileRestoreColdForwardRecovery.js';
import type { ProfileRestoreActivationJournal } from './profileRestoreActivationJournal.js';
import type { ProfileRestoreOriginalInspectionResult } from './runProfileRestoreOriginalInspection.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe('cold original rollback content admission', () => {
  it.skipIf(process.platform === 'win32').each(['workspace', 'database', 'documents'] as const)(
    'rejects a non-private %s root without changing the original bytes', async kind => {
      const f = await fixture();
      const path = kind === 'workspace' ? f.workspaceRoot : kind === 'database' ? dirname(f.databasePath) : f.documentsRoot;
      const pdfPath = join(f.documentsRoot, 'invoice.pdf');
      const pdf = await readFile(pdfPath);
      await chmod(path, 0o755);
      await expect(f.admit(f.context)).rejects.toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
      expect(await readFile(f.databasePath)).toEqual(f.database);
      expect(await readFile(pdfPath)).toEqual(pdf);
    },
  );

  it('checks original bytes before rollback intent at validationStarting', async () => {
    const f = await fixture(); f.journal.phase = 'validationStarting';
    await f.admit(f.context);
    f.journal.phase = 'rollbackStarting'; f.journal.revision++;
    await f.admit(f.context);
    expect(f.inspect).toHaveBeenCalledOnce();
    await writeFile(f.databasePath, Buffer.alloc(f.database.length, 65));
    await expect(f.admit(f.context)).rejects.toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
  });

  it.each(['profileRestore', 'workspaceReplacement'] as const)('rebinds independent moves in %s without adopting new content', async layout => {
    const f = await fixture(layout);
    await f.admit(f.context);
    await f.admit(f.context);
    expect(f.inspect).toHaveBeenCalledOnce();
    await mkdir(dirname(f.activeDatabase), { recursive: true, mode: 0o700 });
    await rename(f.databasePath, f.activeDatabase); f.setSlots('active', 'rollback');
    await f.admit(f.context);
    await mkdir(dirname(f.activeDocuments), { recursive: true, mode: 0o700 });
    await rename(f.documentsRoot, f.activeDocuments); f.setSlots('active', 'active');
    await f.admit(f.context);
    expect(f.inspect).toHaveBeenCalledTimes(3);
    for (const [input] of f.inspect.mock.calls) expect(input.deadline).toBe(f.context.deadline);
    await writeFile(f.activeDatabase, Buffer.alloc(f.database.length, 65));
    await expect(f.admit(f.context)).rejects.toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
    expect(f.inspect).toHaveBeenCalledTimes(3);
  });

  it('rejects changed PDF bytes on unchanged source slots', async () => {
    const f = await fixture(); await f.admit(f.context);
    await writeFile(join(f.documentsRoot, 'invoice.pdf'), Buffer.from('%PDF-1.7 different'));
    await expect(f.admit(f.context)).rejects.toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
    expect(f.inspect).toHaveBeenCalledOnce();
  });

  it('rejects a stale journal before launching inspection', async () => {
    const f = await fixture(); f.peek.mockResolvedValue({ ...f.journal, operationId: randomUUID() });
    await expect(f.admit(f.context)).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    expect(f.inspect).not.toHaveBeenCalled();
  });

  it('rechecks lineage on cached content instead of trusting an earlier receipt', async () => {
    const f = await fixture(); await f.admit(f.context);
    f.assertLineage.mockImplementation(() => { throw new Error('synthetic foreign lineage'); });
    await expect(f.admit(f.context)).rejects.toThrow('synthetic foreign lineage');
    expect(f.inspect).toHaveBeenCalledOnce();
  });

  it.each(['sourceRole', 'layout', 'operationId', 'databaseSlot'] as const)('rejects an unrelated %s result before granting file authority', async key => {
    const f = await fixture();
    f.inspect.mockImplementation(async () => {
      const valid = f.result(f.sources());
      return (key === 'operationId' ? { ...valid, status: { ...valid.status, operationId: randomUUID() } }
        : { ...valid, status: { ...valid.status, result: { ...valid.status.result,
            [key]: key === 'sourceRole' ? 'target' : key === 'layout' ? 'workspaceReplacement' : 'active' } } }) as ProfileRestoreOriginalInspectionResult;
    });
    await expect(f.admit(f.context)).rejects.toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
    expect(await readFile(f.databasePath)).toEqual(f.database);
  });

  it('does not fabricate identity or health for an originally absent database', async () => {
    const f = await fixture(); await rm(f.databasePath); await rm(f.documentsRoot, { recursive: true });
    f.setSlots('absent', 'absent');
    await f.admit(f.context); await f.admit(f.context);
    expect(f.inspect).toHaveBeenCalledOnce(); expect(f.assertLineage).not.toHaveBeenCalled();
    const result = f.result(f.sources());
    expect(result).not.toHaveProperty('documents'); expect(result.status.result).not.toHaveProperty('profileId');
  });

  it('supports present database and absent documents only with an empty checked binding set', async () => {
    const f = await fixture(); await rm(f.documentsRoot, { recursive: true }); f.setSlots('rollback', 'absent');
    await f.admit(f.context);
    expect(f.assertLineage).toHaveBeenCalled();
  });

  it('does not replace the immutable first content with a new valid-looking source receipt', async () => {
    const f = await fixture(); await f.admit(f.context);
    await mkdir(dirname(f.activeDatabase), { recursive: true, mode: 0o700 }); await rename(f.databasePath, f.activeDatabase);
    f.setSlots('active', 'rollback');
    f.inspect.mockImplementation(async () => {
      const next = f.result(f.sources());
      return { ...next, status: { ...next.status, result: { ...next.status.result, profileId: 'e'.repeat(64) } } };
    });
    await expect(f.admit(f.context)).rejects.toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
  });

  it('invalidates a pending census read on cancellation and cannot grant on late completion', async () => {
    const f = await fixture(); let finish!: (journal: ProfileRestoreActivationJournal) => void; let started!: () => void;
    const reading = new Promise<void>(resolve => { started = resolve; });
    f.peek.mockImplementation(() => { started(); return new Promise(resolve => { finish = resolve; }); });
    const operation = f.admit(f.context); await reading; f.cancellation.abort();
    await expect(operation).rejects.toThrow('PROFILE_INSPECTION_TIMEOUT');
    expect(f.context.reservation.invalidate).toHaveBeenCalledOnce();
    finish(f.journal); await Promise.resolve(); expect(f.inspect).not.toHaveBeenCalled();
  });
});

async function fixture(layout: ProfileInspectionOriginalSources['layout'] = 'profileRestore') {
  const root = await mkdtemp(join(tmpdir(), 'eky-original-admission-')); roots.push(root);
  const operationId = randomUUID();
  const workspaceRoot = layout === 'profileRestore' ? join(root, 'workspace') : join(root, 'workspaces', randomUUID());
  const failedRoot = layout === 'profileRestore' ? join(workspaceRoot, 'runtime', 'failed-profile-restores')
    : join(root, 'workspace-replacement-operations', 'activation', 'failed');
  const rollbackRoot = layout === 'profileRestore' ? join(workspaceRoot, 'runtime', 'profile-restore-rollback', operationId)
    : join(root, 'workspace-replacement-operations', 'activation', 'rollback', operationId);
  const databasePath = join(rollbackRoot, 'data', 'eky.sqlite'); const documentsRoot = join(rollbackRoot, 'storage', 'invoices');
  const activeDatabase = join(workspaceRoot, 'runtime', 'data', 'eky.sqlite'); const activeDocuments = join(workspaceRoot, 'runtime', 'storage', 'invoices');
  for (const path of [workspaceRoot, join(failedRoot, operationId), dirname(databasePath), documentsRoot]) await mkdir(path, { recursive: true, mode: 0o700 });
  const database = Buffer.from('synthetic opaque original database'); const pdf = Buffer.from('%PDF-1.7 synthetic');
  await writeFile(databasePath, database); await writeFile(join(documentsRoot, 'invoice.pdf'), pdf);
  const documents = Object.freeze([Object.freeze({ logicalPath: `artifacts/invoicing/invoice-documents/${'a'.repeat(64)}.pdf`,
    storagePath: 'invoice.pdf', byteSize: pdf.length, sha256: hash(pdf) })]);
  let databaseSlot: ProfileInspectionOriginalSources['databaseSlot'] = 'rollback';
  let documentsSlot: ProfileInspectionOriginalSources['documentsSlot'] = 'rollback';
  const sources = () => ({ workspaceRoot, layout, databaseSlot, documentsSlot });
  const result = (source: ProfileInspectionOriginalSources): ProfileRestoreOriginalInspectionResult => {
    const original = { sourceRole: 'original' as const, layout, databaseSlot: source.databaseSlot, documentsSlot: source.documentsSlot };
    const identity = { protocolVersion: profileInspectionProtocolVersion, operationId, generationId: randomUUID(), runtimeSession: 'f'.repeat(43) } as const;
    if (source.databaseSlot === 'absent') return { status: { ...identity, type: 'originalCompleted', result: { ...original, databaseSlot: 'absent' } } };
    const selectedDocuments = source.documentsSlot === 'absent' ? Object.freeze([]) : documents;
    const bindings = encodeProfileInspectionDocumentBindings(selectedDocuments);
    return { documents: selectedDocuments, status: { ...identity, type: 'originalCompleted', result: { ...original,
      databaseSlot: source.databaseSlot, profileId: 'b'.repeat(64), databaseHealth: 'healthy', migrationPolicy: 'restoreCompatible', migrationChainIdentity: 'c'.repeat(64),
      artifactCount: selectedDocuments.length, artifactTotalByteSize: selectedDocuments.length * pdf.length,
      artifactIdentity: createProfileSnapshotArtifactIdentity(selectedDocuments), database: { byteSize: database.length, sha256: hash(database) },
      documentBindings: { byteSize: bindings.length, sha256: hash(bindings) } } } };
  };
  const journal: ProfileRestoreActivationJournal = { operationId, formatVersion: 1, phase: 'rollbackStarting', revision: 10,
    hadActiveDatabase: true, hadActiveDocuments: true };
  const cancellation = new AbortController(); const peek = vi.fn(async () => journal); const assertLineage = vi.fn((_profileId: string) => {});
  const inspect = vi.fn(async (input: Parameters<typeof import('./runProfileRestoreOriginalInspection.js').runProfileRestoreOriginalInspection>[0]) => result(await input.readSources({ deadline: input.deadline!, signal: input.signal })));
  const context: ProfileRestoreColdContentContext = { journal, signal: cancellation.signal, deadline: performance.now() + 35_000,
    assertCurrent: async () => {}, assertAuthority() { if (cancellation.signal.aborted) throw new Error('PROFILE_INSPECTION_TIMEOUT'); },
    reservation: { assertMainOwned: async () => {}, assertMainCurrent() {}, close: async () => {}, invalidate: vi.fn(() => {}),
      bind() { throw new Error('not used by the injected inspection fixture'); } } };
  const admit = createProfileRestoreOriginalContentAdmission({ operationId, workspaceRoot, failedRoot, layout, runnerPath: join(root, 'runner.js'),
    deployment: { backendRoot: root, migrationsDirectory: root, nativeResourceRoot: root }, journalStore: { peek },
    transaction: { readRollbackRecoverySources: async () => ({ databaseSlot, documentsSlot }) }, assertLineage, inspect });
  return { root, workspaceRoot, databasePath, documentsRoot, activeDatabase, activeDocuments, database, sources, result, journal, cancellation,
    peek, assertLineage, inspect, context, admit,
    setSlots(db: ProfileInspectionOriginalSources['databaseSlot'], docs: ProfileInspectionOriginalSources['documentsSlot']) { databaseSlot = db; documentsSlot = docs; } };
}
function hash(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
