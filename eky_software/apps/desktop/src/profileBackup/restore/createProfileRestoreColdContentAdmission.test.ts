import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProfileSnapshotArtifactIdentity } from '../../runtime/profileInspectionArtifactIdentity.js';
import { createDesktopProfilePaths } from '../../runtime/desktopProfilePaths.js';
import { encodeProfileInspectionDocumentBindings } from '../../runtime/profileInspectionDocumentBindings.js';
import type { ProfileInspectionColdSources } from '../../runtime/profileInspectionMessages.js';
import { createProfileRestoreColdContentAdmission } from './createProfileRestoreColdContentAdmission.js';
import type { ProfileRestoreColdContentContext } from './prepareProfileRestoreColdForwardRecovery.js';
import type { ProfileRestoreActivationJournal } from './profileRestoreActivationJournal.js';
import type { ProfileRestoreColdInspectionResult } from './runProfileRestoreColdInspection.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe('cold forward content admission', () => {
  it('rechecks bytes on the same slots without launching another utility', async () => {
    const f = await fixture();
    await f.admit(f.context);
    await f.admit(f.context);
    expect(f.inspect).toHaveBeenCalledOnce();
    await writeFile(f.databasePath, Buffer.alloc(f.database.length, 65));
    await expect(f.admit(f.context)).rejects.toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
    expect(f.inspect).toHaveBeenCalledOnce();
  });

  it('admits legitimate independent moves against the immutable first content and original deadline', async () => {
    const f = await fixture();
    await f.admit(f.context);
    const { databaseFilePath: activeDatabase, invoiceDocumentStorageRoot: activeDocuments } = createDesktopProfilePaths(f.workspaceRoot);
    await mkdir(dirname(activeDatabase), { recursive: true, mode: 0o700 });
    await mkdir(dirname(activeDocuments), { recursive: true, mode: 0o700 });
    await rename(f.databasePath, activeDatabase);
    f.setSlots('active', 'staged');
    await f.admit(f.context);
    await rename(f.documentsRoot, activeDocuments);
    f.setSlots('active', 'active');
    await f.admit(f.context);
    expect(f.inspect).toHaveBeenCalledTimes(3);
    for (const [input] of f.inspect.mock.calls) expect(input.deadline).toBe(f.context.deadline);
    expect(await readFile(activeDatabase)).toEqual(f.database);
  });

  it('does not adopt different content from a newly valid source pair', async () => {
    const f = await fixture();
    await f.admit(f.context);
    const activeDatabase = createDesktopProfilePaths(f.workspaceRoot).databaseFilePath;
    await mkdir(dirname(activeDatabase), { recursive: true, mode: 0o700 });
    await rename(f.databasePath, activeDatabase);
    f.setSlots('active', 'staged');
    f.inspect.mockImplementation(async input => ({ ...f.result(await input.readSources({ deadline: input.deadline!, signal: input.signal })),
      receipt: { ...f.result(f.sources()).receipt, database: { byteSize: f.database.length, sha256: 'f'.repeat(64) } } }));
    await expect(f.admit(f.context)).rejects.toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
    expect(await readFile(activeDatabase)).toEqual(f.database);
  });

  it('rejects a changed journal before utility work', async () => {
    const f = await fixture();
    f.peek.mockResolvedValue({ ...f.journal, revision: 1 });
    await expect(f.admit(f.context)).rejects.toThrow('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    expect(f.inspect).not.toHaveBeenCalled();
  });

  it('checks lineage on every admission, even when the source pair is unchanged', async () => {
    const f = await fixture();
    await f.admit(f.context);
    f.assertLineage.mockImplementation(() => { throw new Error('synthetic foreign lineage'); });
    await expect(f.admit(f.context)).rejects.toThrow('synthetic foreign lineage');
    expect(f.inspect).toHaveBeenCalledOnce();
  });

  it('invalidates a pending main read on cancellation and never resumes admission on late resolution', async () => {
    const f = await fixture();
    let finish!: (journal: ProfileRestoreActivationJournal) => void;
    let started!: () => void;
    const reading = new Promise<void>(resolve => { started = resolve; });
    f.peek.mockImplementation(() => { started(); return new Promise(resolve => { finish = resolve; }); });
    const operation = f.admit(f.context);
    await reading;
    f.cancellation.abort();
    await expect(operation).rejects.toThrow('PROFILE_INSPECTION_TIMEOUT');
    expect(f.context.reservation.invalidate).toHaveBeenCalledOnce();
    finish(f.journal);
    await Promise.resolve();
    expect(f.inspect).not.toHaveBeenCalled();
    expect(await readFile(f.databasePath)).toEqual(f.database);
  });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-cold-admission-')); roots.push(root);
  const workspaceRoot = join(root, 'workspace'); const stagingRoot = join(root, 'staging'); const operationId = randomUUID();
  const operationRoot = join(stagingRoot, operationId); const databasePath = join(operationRoot, 'profile.sqlite');
  const documentsRoot = join(operationRoot, 'activation', 'storage', 'invoices');
  for (const path of [workspaceRoot, operationRoot, documentsRoot]) await mkdir(path, { recursive: true, mode: 0o700 });
  const database = Buffer.from('synthetic opaque database'); const pdf = Buffer.from('%PDF-1.7 synthetic');
  await writeFile(databasePath, database); await writeFile(join(documentsRoot, 'invoice.pdf'), pdf);
  const documents = Object.freeze([Object.freeze({ logicalPath: `artifacts/invoicing/invoice-documents/${'a'.repeat(64)}.pdf`,
    storagePath: 'invoice.pdf', byteSize: pdf.length, sha256: hash(pdf) })]);
  const bindings = encodeProfileInspectionDocumentBindings(documents);
  let databaseSlot: 'active' | 'staged' = 'staged'; let documentsSlot: 'active' | 'staged' = 'staged';
  const sources = () => ({ workspaceRoot, databaseSlot, documentsSlot });
  const result = (source: ProfileInspectionColdSources): ProfileRestoreColdInspectionResult => Object.freeze({ documents,
    receipt: Object.freeze({ databaseSlot: source.databaseSlot, documentsSlot: source.documentsSlot,
      profileId: 'b'.repeat(64), databaseHealth: 'healthy', migrationPolicy: 'restoreCompatible', migrationChainIdentity: 'c'.repeat(64),
      artifactCount: 1, artifactTotalByteSize: pdf.length, artifactIdentity: createProfileSnapshotArtifactIdentity(documents),
      database: Object.freeze({ byteSize: database.length, sha256: hash(database) }), documentBindings: Object.freeze({ byteSize: bindings.length, sha256: hash(bindings) }) }) });
  const journal: ProfileRestoreActivationJournal = { operationId, formatVersion: 1, phase: 'prepared', revision: 0,
    hadActiveDatabase: false, hadActiveDocuments: false };
  const cancellation = new AbortController(); const peek = vi.fn(async () => journal); const assertLineage = vi.fn((_profileId: string) => {});
  const inspect = vi.fn(async (input: Parameters<typeof import('./runProfileRestoreColdInspection.js').runProfileRestoreColdInspection>[0]) => result(await input.readSources(input as { deadline: number; signal: AbortSignal })));
  const context: ProfileRestoreColdContentContext = { journal, signal: cancellation.signal, deadline: performance.now() + 35_000,
    assertCurrent: async () => {}, assertAuthority() { if (cancellation.signal.aborted || performance.now() >= context.deadline) throw new Error('PROFILE_INSPECTION_TIMEOUT'); },
    reservation: { assertMainOwned: async () => {}, assertMainCurrent() {}, close: async () => {}, invalidate: vi.fn(() => {}),
      bind() { throw new Error('not used by the injected inspection fixture'); } } };
  const admit = createProfileRestoreColdContentAdmission({ operationId, workspaceRoot, stagingRoot, runnerPath: join(root, 'runner.js'),
    deployment: { backendRoot: root, migrationsDirectory: root, nativeResourceRoot: root }, journalStore: { peek },
    transaction: { readForwardRecoverySources: async () => ({ databaseSlot, documentsSlot }) }, assertLineage, inspect });
  return { root, workspaceRoot, stagingRoot, databasePath, documentsRoot, database, sources, result, journal, cancellation, peek,
    assertLineage, inspect, context, admit, setSlots(db: 'active' | 'staged', docs: 'active' | 'staged') { databaseSlot = db; documentsSlot = docs; } };
}
function hash(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
