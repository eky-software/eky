import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest';
import { PortableProfileBackupService } from './portableProfileBackup.js';
import { ProfileSnapshotInspectionClient, type ProfileSnapshotInspectionEvidence } from './profileSnapshotInspectionClient.js';
import { createProfileBackupSourceEntries } from './createProfileBackupSourceEntries.js';
import { createProfileSnapshotArtifactIdentity } from '../runtime/profileInspectionArtifactIdentity.js';
import { resolveProfileInspectionCopyRoot, type ProfileInspectionReceipt } from '../runtime/profileInspectionMessages.js';
import { ProfileInspectionProcessError } from '../runtime/profileInspectionProcess.js';
import type { OwnedProfileBackupInspectionReservation } from './inspectOwnedEncryptedProfileBackup.js';
import { ProfileMaintenanceState } from './profileMaintenanceStateTestSupport.js';
import { ProfileSnapshotBrokerClient } from './profileSnapshotBrokerClient.js';
import { startProfileSnapshotBrokerBackend } from './profileSnapshotBrokerBackend.js';
import { InMemoryWorkspaceMaintenanceLease } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import type { ProfileSnapshotBrokerTransport } from './profileSnapshotBrokerTransport.js';

type ProcessInput = Parameters<typeof import('../runtime/profileInspectionProcess.js')['runProfileInspectionProcess']>[0];
const processBoundary = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() } }));
vi.mock('../runtime/profileInspectionProcess.js', async importOriginal => ({
  ...await importOriginal<typeof import('../runtime/profileInspectionProcess.js')>(),
  runProfileInspectionProcess: (input: ProcessInput) => processBoundary.run(input),
}));
beforeEach(() => { processBoundary.run.mockReset(); });
const closeFixtures: Array<() => Promise<void>> = [];
afterEach(async () => {
  try { for (const close of closeFixtures.splice(0).reverse()) await close(); }
  finally { vi.restoreAllMocks(); }
});

const password = 'Synthetic bound inspection 2026!';
const profileId = 'b'.repeat(64);
const chain = 'a'.repeat(64);
const sourceId = '11111111-1111-4111-8111-111111111111';
const exportId = '22222222-2222-4222-8222-222222222222';
const tempId = '33333333-3333-4333-8333-333333333333';
const pdfBytes = Buffer.from('%PDF-1.7\nSynthetic evidence only\n%%EOF\n');
const pdfName = `${'c'.repeat(64)}.pdf`;

it('retains both actual owner-generated identities through encrypted export, cleanup and return', async () => {
  const f = await fixture();
  const content = await f.create();
  const [source, exported] = processBoundary.run.mock.calls.map(([input]) => input as ProcessInput);
  expect(content.sourceIdentity).toBe(source!.identity);
  expect(content.exported.identity).toBe(exported!.identity);
  expect(source!.identity.operationId).toBe(sourceId);
  expect(exported!.identity.operationId).toBe(exportId);
  expect(content.sourceIdentity.generationId).not.toBe(content.exported.identity.generationId);
  expect(content.sourceIdentity.runtimeSession).not.toBe(content.exported.identity.runtimeSession);
  expect(Object.isFrozen(content.sourceIdentity)).toBe(true);
  expect(Object.isFrozen(content.exported.identity)).toBe(true);
  expect(content.sourceReceipt.database).toEqual(content.exported.receipt.database);
  expect(content.sourceReceipt.artifactIdentity).toBe(content.exported.receipt.artifactIdentity);
  expect(content.sourceReceipt.artifactTotalByteSize).toBe(pdfBytes.length);
  expect(content.exported.containerSha256).toBe(createHash('sha256').update(await fs.readFile(f.destinationPath)).digest('hex'));
  expect(await fs.lstat(f.destinationPath, { bigint: true })).toMatchObject(content.exported.authenticatedFileIdentity);
  expect(JSON.stringify(content.exported.summary)).not.toContain(content.exported.identity.runtimeSession);
  expect(f.begin).not.toHaveBeenCalled();
  expect(f.end).not.toHaveBeenCalled();
  expect(f.contextRequests.mock.calls.map(([request]) => ({
    operationId: request.operationId, owner: request.deleteMaintenanceOperationId,
    updateOwner: request.updateMaintenanceOperationId, kind: request.kind,
  }))).toEqual([sourceId, sourceId, exportId, exportId].map(operationId => ({
    operationId, owner: sourceId, updateOwner: undefined, kind: 'inspect',
  })));
  await expect(f.broker.assertDeleteMaintenance(sourceId)).resolves.toBe('busy');
  expect(f.state.tryBeginBusinessWrite()).toBeUndefined();
  expect(f.lease.readState()).toBe('busy');
  await expect(fs.readdir(f.stagingRoot)).resolves.toEqual([]);
  expect(f.events).toEqual(['process:source', 'process:export', 'close:export', 'close:source']);
  await f.client.shutdown();
});

it('ordinary export uses the same owners without publishing inspection identity', async () => {
  const f = await fixture({ ordinary: true });
  const summary = await f.service.create({ destinationPath: f.destinationPath, password });
  expect(summary).toMatchObject({ databaseHealth: 'healthy', documentCount: 1 });
  expect(summary).not.toHaveProperty('identity');
  expect(summary).not.toHaveProperty('receipt');
  expect(f.begin).toHaveBeenCalledOnce();
  expect(f.end).toHaveBeenCalledOnce();
  expect(f.contextRequests.mock.calls.every(([request]) => request.deleteMaintenanceOperationId === undefined)).toBe(true);
  expect(f.state.getStatus()).toBe('normal');
  f.state.tryBeginBusinessWrite()!();
  await expect(fs.readdir(f.stagingRoot)).resolves.toEqual([]);
  await f.client.shutdown();
});

it.each(['withProfileSnapshotEvidence', 'validateDeletionProfileSnapshot'] as const)(
  'requires %s before creating a deletion export', async method => {
  const f = await fixture();
  Object.defineProperty(f.client, method, { value: undefined });
  await expect(f.create()).rejects.toMatchObject({ code: 'PROFILE_BACKUP_CREATE_FAILED',
    cause: { message: 'PROFILE_BACKUP_EVIDENCE_PORT_MISSING' } });
  expect(f.service.getStatus()).toMatchObject({ lastSafeErrorCode: 'PROFILE_BACKUP_CREATE_FAILED', operationState: 'idle' });
  expect(processBoundary.run).not.toHaveBeenCalled();
  await expect(fs.readdir(f.stagingRoot)).resolves.toEqual([]);
  await expect(fs.stat(f.destinationPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await f.client.shutdown();
});

it.each(['generationId', 'runtimeSession'] as const)('rejects a shared %s with otherwise valid independent operations', async field => {
  const f = await fixture();
  const withEvidence = f.client.withProfileSnapshotEvidence.bind(f.client);
  let source: ProfileSnapshotInspectionEvidence | undefined;
  f.client.withProfileSnapshotEvidence = <T>(id: string, use: (
    evidence: ProfileSnapshotInspectionEvidence, assertCurrent: () => Promise<void>,
  ) => Promise<T>): Promise<T> => withEvidence(id, async (evidence, assertCurrent) => {
    if (id === sourceId) { source = evidence; return use(evidence, assertCurrent); }
    expect(source).toBeDefined();
    expect(id).toBe(exportId);
    expect(evidence.identity.operationId).toBe(exportId);
    return use(Object.freeze({ ...evidence,
      identity: Object.freeze({ ...evidence.identity, [field]: source!.identity[field] }),
    }), assertCurrent);
  });
  await expect(f.create()).rejects.toMatchObject({ code: 'PROFILE_BACKUP_CREATE_FAILED',
    cause: { message: 'PROFILE_BACKUP_INSPECTION_IDENTITY_INVALID' } });
  expect(processBoundary.run).toHaveBeenCalledTimes(2);
  expect(f.end).not.toHaveBeenCalled();
  expect(f.service.getStatus()).not.toHaveProperty('latestSuccessfulPortableBackupAt');
  await expect(fs.stat(f.destinationPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await f.client.shutdown();
});

it('retains the verified export without issuing evidence if the caller loses authority at final release', async () => {
  const f = await fixture({ revokeAtSourceClose: true });
  await expect(f.create()).rejects.toMatchObject({ code: 'PROFILE_BACKUP_CREATE_FAILED' });
  await expect(fs.stat(f.destinationPath)).resolves.toBeDefined();
  expect(f.events).toContain('close:source');
  expect(f.end).not.toHaveBeenCalled();
  await f.client.shutdown();
});

it.each(['database', 'artifactCatalog', 'artifactIdentity'] as const)(
  'rejects a changed exported %s even when its safe summary matches', async field => {
    const f = await fixture();
    const useEvidence = f.client.withProfileSnapshotEvidence.bind(f.client);
    vi.spyOn(f.client, 'withProfileSnapshotEvidence').mockImplementation((id, use) =>
      useEvidence(id, (evidence, assertCurrent) => {
        const receipt = evidence.receipt;
        const changed = field === 'artifactIdentity'
          ? { ...receipt, artifactIdentity: 'f'.repeat(64) }
          : { ...receipt, [field]: { ...receipt[field], sha256: 'f'.repeat(64) } };
        return use(id === exportId ? { ...evidence, receipt: changed } : evidence, assertCurrent);
      }));
    await expect(f.create()).rejects.toMatchObject({ code: 'PROFILE_BACKUP_CREATE_FAILED',
      cause: { message: 'PROFILE_BACKUP_CONTENT_MISMATCH' } });
    await expect(fs.stat(f.destinationPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(f.end).not.toHaveBeenCalled();
    await f.client.shutdown();
  },
);

it('rejects a caller revoked during the final temporary cleanup and retains its verified export', async () => {
  const f = await fixture();
  const remove = fs.rm;
  const entered = deferred(); const gate = deferred();
  let removals = 0;
  const interception = vi.spyOn(fs, 'rm').mockImplementation(async (path, options) => {
    if (String(path).startsWith(join(f.root, 'destination')) && String(path).endsWith('.partial') && ++removals === 2) {
      entered.resolve(); await gate.promise;
    }
    await remove(path, options);
  });
  const outcome = f.create().catch(error => error);
  try { await entered.promise; await f.handle.release(); }
  finally { gate.resolve(); await outcome; interception.mockRestore(); }
  expect(await outcome).toMatchObject({ code: 'PROFILE_BACKUP_CREATE_FAILED' });
  await expect(fs.stat(f.destinationPath)).resolves.toBeDefined();
  expect(f.end).not.toHaveBeenCalled();
  await f.client.shutdown();
});

it('rechecks the caller after the inspection scope finishes its own cleanup', async () => {
  const f = await fixture();
  const scope = f.client.withInspectionOperation.bind(f.client);
  vi.spyOn(f.client, 'withInspectionOperation').mockImplementation(async operation => {
    const result = await scope(operation);
    await f.handle.release();
    return result;
  });
  await expect(f.create()).rejects.toMatchObject({ code: 'PROFILE_BACKUP_CREATE_FAILED' });
  await expect(fs.stat(f.destinationPath)).resolves.toBeDefined();
  expect(f.end).not.toHaveBeenCalled();
  await f.client.shutdown();
});

it('retains the verified export when only its final inspection-staging removal fails', async () => {
  const f = await fixture();
  const remove = f.client.removeProfileSnapshot.bind(f.client);
  const first = new Error('SYNTHETIC_EXPORT_CLEANUP_UNVERIFIED');
  const interception = vi.spyOn(f.client, 'removeProfileSnapshot').mockImplementation(async id => {
    if (id === exportId) throw first;
    await remove(id);
  });
  try {
    await expect(f.create()).rejects.toMatchObject({ cleanupStatus: 'unverified' });
    expect(interception.mock.calls.filter(([id]) => id === exportId)).toHaveLength(1);
    await expect(fs.stat(join(f.stagingRoot, exportId, 'profile.sqlite'))).resolves.toBeDefined();
    await expect(fs.stat(f.destinationPath)).resolves.toBeDefined();
    expect(f.service.getStatus()).not.toHaveProperty('latestSuccessfulPortableBackupAt');
    expect(f.end).not.toHaveBeenCalled();
  } finally { interception.mockRestore(); await f.client.shutdown(); }
});

it.each([sourceId, exportId])('rejects an inspection bound to a foreign fence at %s', async rejectedId => {
  const f = await fixture();
  const validate = f.client.validateDeletionProfileSnapshot.bind(f.client);
  vi.spyOn(f.client, 'validateDeletionProfileSnapshot').mockImplementation((id, owner) =>
    validate(id, id === rejectedId ? randomUUID() : owner));
  await expect(f.create()).rejects.toBeInstanceOf(Error);
  expect(processBoundary.run).toHaveBeenCalledTimes(rejectedId === sourceId ? 0 : 1);
  expect(f.service.getStatus()).not.toHaveProperty('latestSuccessfulPortableBackupAt');
  await expect(f.broker.assertDeleteMaintenance(sourceId)).resolves.toBe('busy');
  expect(f.state.tryBeginBusinessWrite()).toBeUndefined();
  expect(f.end).not.toHaveBeenCalled();
  await f.client.shutdown();
});

it.each([1, 2, 3, 4])('rejects revocation during context read %i across the actual broker', async readIndex => {
  const f = await fixture();
  const entered = deferred();
  const gate = deferred();
  const read = f.snapshot.readProfileInspectionContext.bind(f.snapshot);
  let count = 0;
  vi.spyOn(f.snapshot, 'readProfileInspectionContext').mockImplementation(async () => {
    if (++count === readIndex) { entered.resolve(); await gate.promise; }
    return read();
  });
  const outcome = f.create().then(value => ({ value }), error => ({ error }));
  try {
    await entered.promise;
    await expect(f.broker.invalidateDeleteMaintenance(sourceId)).resolves.toBe('busy');
  } finally { gate.resolve(); await outcome; }
  expect(await outcome).toHaveProperty('error');
  expect(processBoundary.run).toHaveBeenCalledTimes(Math.floor(readIndex / 2));
  expect(f.service.getStatus()).not.toHaveProperty('latestSuccessfulPortableBackupAt');
  expect(f.state.tryBeginBusinessWrite()).toBeUndefined();
  expect(f.end).not.toHaveBeenCalled();
  await expect(f.broker.assertDeleteMaintenance(sourceId)).rejects.toMatchObject({ code: 'PROFILE_MAINTENANCE_OPERATION_MISMATCH' });
  await f.client.shutdown();
});

it('rejects malformed delete ownership before acquiring inspection work', async () => {
  const f = await fixture();
  expect(() => f.client.validateDeletionProfileSnapshot(sourceId, 'invalid')).toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
  expect(f.contextRequests).not.toHaveBeenCalled();
  expect(processBoundary.run).not.toHaveBeenCalled();
  await expect(fs.readdir(f.stagingRoot)).resolves.toEqual([]);
  await f.client.shutdown();
});

it('does not issue content or remove an export source whose process cleanup is unverified', async () => {
  const f = await fixture({ uncertainExport: true });
  await expect(f.create()).rejects.toMatchObject({ cleanupStatus: 'unverified' });
  await expect(fs.stat(join(f.stagingRoot, exportId, 'profile.sqlite'))).resolves.toBeDefined();
  await expect(fs.stat(join(f.stagingRoot, sourceId, 'profile.sqlite'))).resolves.toBeDefined();
  expect(f.events).not.toContain('close:source');
  expect(f.events).not.toContain('close:export');
  await expect(f.client.shutdown()).rejects.toThrow();
});

it('joins an admitted export consumer before shutdown can remove its source', async () => {
  const entered = deferred();
  const gate = deferred();
  const f = await fixture({ async afterExportBytes() { entered.resolve(); await gate.promise; } });
  const pending = f.create();
  const outcome = pending.catch(error => error);
  let shutdown: Promise<unknown> | undefined;
  try {
    await entered.promise;
    shutdown = f.client.shutdown().catch(error => error);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(f.events).not.toContain('close:source');
    expect(f.events).not.toContain('close:export');
    await expect(fs.stat(join(f.stagingRoot, sourceId, 'profile.sqlite'))).resolves.toBeDefined();
  } finally { gate.resolve(); await Promise.allSettled([pending, shutdown]); }
  expect(await outcome).toBeInstanceOf(Error);
  expect(f.end).not.toHaveBeenCalled();
});

type Options = {
  ordinary?: boolean;
  revokeAtSourceClose?: boolean;
  uncertainExport?: boolean;
  afterExportBytes?(): Promise<void>;
};
async function fixture(options: Options = {}) {
  const root = await fs.mkdtemp(join(tmpdir(), 'eky-delete-backup-'));
  let cleanupCompleted = false;
  onTestFinished(async ({ task }) => {
    if (task.result?.state === 'pass' && cleanupCompleted && !options.uncertainExport) {
      await fs.rm(root, { recursive: true });
    }
  });
  const stagingRoot = join(root, 'staging');
  const quarantineRoot = join(root, 'quarantine');
  for (const path of [stagingRoot, quarantineRoot, join(root, 'destination')]) await fs.mkdir(path, { recursive: true, mode: 0o700 });
  const destinationPath = join(root, 'destination', 'synthetic.ekybackup');
  const events: string[] = [];
  const state = new ProfileMaintenanceState();
  const lease = new InMemoryWorkspaceMaintenanceLease();
  const handle = await lease.acquire(options.ordinary ? 'backup' : 'delete');
  const assertLease = lease.captureCurrentOwner([options.ordinary ? 'backup' : 'delete']);
  const transports = serializedTransportPair();
  const broker = new ProfileSnapshotBrokerClient(transports[0]);
  const snapshot = {
    async readProfileInspectionContext() { return { activeProfileId: profileId, activeProfileIsEmpty: false }; },
    async createProfileSnapshot({ operationId: id }: { operationId: string }) {
      const sourceRoot = join(stagingRoot, id);
      const documents = join(sourceRoot, 'artifacts', 'invoicing', 'invoice-documents');
      await fs.mkdir(documents, { recursive: true, mode: 0o700 });
      await fs.writeFile(join(sourceRoot, 'profile.sqlite'), 'synthetic SQLite boundary, not a real database');
      await fs.writeFile(join(sourceRoot, 'snapshot-catalog-v1.json'), '{"artifacts":[]}');
      await fs.writeFile(join(documents, pdfName), pdfBytes);
      const receipt = await receiptFor(sourceRoot, 'exactCurrentManifest');
      return {
        database: { databaseByteSize: receipt.database.byteSize, logicalPath: 'profile.sqlite' as const, sha256: receipt.database.sha256, totalPages: 1 },
        artifactCatalog: { artifactCount: 1, artifactTotalByteSize: pdfBytes.length,
          catalogByteSize: receipt.artifactCatalog.byteSize, logicalPath: 'snapshot-catalog-v1.json' as const, sha256: receipt.artifactCatalog.sha256 },
      };
    },
  };
  const backend = startProfileSnapshotBrokerBackend({ maintenance: state, snapshot, transport: transports[1] });
  closeFixtures.push(async () => { broker.close(); backend.close(); await handle.release(); });
  const assertChannel = broker.captureInspectionAuthority();
  const assertFence = () => { assertLease(); assertChannel(); };
  const begin = vi.spyOn(broker, 'beginMaintenance');
  const end = vi.spyOn(broker, 'endMaintenance');
  const contextRequests = vi.spyOn(broker, 'readProfileInspectionContext');
  if (!options.ordinary) await broker.beginDeleteMaintenance(sourceId);
  processBoundary.run.mockImplementation(async (input: ProcessInput) => {
    // Only the process/SQLite boundary is injected. Main ownership, file copy,
    // content hashing, container authentication and cleanup use current code.
    await input.reservationTransfer.prepare(input.signal);
    const sourceRoot = input.reservationTransfer.descriptor.userDataRoot;
    await fs.copyFile(join(sourceRoot, 'profile.sqlite'), join(resolveProfileInspectionCopyRoot(input.reservationTransfer.descriptor), 'profile.sqlite'));
    const isSource = input.identity.operationId === sourceId;
    events.push(`process:${isSource ? 'source' : 'export'}`);
    const receipt = await receiptFor(sourceRoot, input.migrationPolicy!);
    if (!isSource) {
      expect(await fs.readFile(join(sourceRoot, 'artifacts', 'invoicing', 'invoice-documents', pdfName))).toEqual(pdfBytes);
      await options.afterExportBytes?.();
      if (options.uncertainExport) throw new ProfileInspectionProcessError('PROFILE_INSPECTION_TIMEOUT', {
        processAbsent: false, reservationReclaimed: false, forced: true,
      });
    }
    return receipt;
  });
  const client = new ProfileSnapshotInspectionClient({
    stagingRoot, runnerPath: join(root, 'synthetic-runner.js'),
    deployment: { backendRoot: join(root, 'backend'), migrationsDirectory: join(root, 'migrations'), nativeResourceRoot: join(root, 'native') },
    assertMainInstance() {},
    async acquireReservation({ operationRoot }): Promise<OwnedProfileBackupInspectionReservation> {
      let invalidated = false;
      let closed = false;
      return {
        async assertMainOwned() {
          if (invalidated || closed) throw new Error('SYNTHETIC_RESERVATION_LOST');
          await fs.lstat(operationRoot);
        },
        invalidate() { invalidated = true; },
        bind(generationId, assertAuthority, prepareMainOwned) {
          return {
            descriptor: { generationId, identity: 'd'.repeat(64), userDataRoot: operationRoot },
            prepare: prepareMainOwned, assertCurrent: assertAuthority,
            async assertGrant() { assertAuthority(); }, async reclaimAfterExit() {},
            invalidate() { invalidated = true; },
          };
        },
        async close() {
          if (invalidated) throw new Error('SYNTHETIC_RESERVATION_LOST');
          closed = true;
          const isSource = operationRoot === join(stagingRoot, sourceId);
          events.push(`close:${isSource ? 'source' : 'export'}`);
          if (isSource && options.revokeAtSourceClose) {
            await handle.release();
            const replacement = await lease.acquire('delete');
            closeFixtures.push(() => replacement.release());
            expect(lease.captureCurrentOwner(['delete'])).not.toThrow();
            expect(assertLease).toThrow('WORKSPACE_MAINTENANCE_BUSY');
          }
        },
      };
    },
    broker,
  });
  const shutdown = client.shutdown.bind(client);
  let shutdownObserved = false;
  vi.spyOn(client, 'shutdown').mockImplementation(async () => {
    try { return await shutdown(); } finally { shutdownObserved = true; }
  });
  closeFixtures.push(async () => {
    if (!shutdownObserved) await client.shutdown();
    cleanupCompleted = true;
  });
  const ids = options.ordinary ? [sourceId, exportId, tempId] : [exportId, tempId];
  const service = new PortableProfileBackupService({
    appVersion: '0.1.0-alpha.1', forbiddenRoots: [stagingRoot, quarantineRoot],
    stagingRoot, quarantineRoot, profileSnapshotClient: client, operationIdFactory: () => ids.shift()!,
  });
  return { root, stagingRoot, destinationPath, client, service, begin, end, events,
    broker, backend, state, lease, handle, contextRequests, snapshot,
    create: () => service.createForDeletion({ destinationPath, password }, {
      operationId: sourceId, assertValid: assertFence,
      async assertCurrent() { assertFence(); await broker.assertDeleteMaintenance(sourceId); assertFence(); },
    }),
  };
}

async function receiptFor(root: string, migrationPolicy: ProfileInspectionReceipt['migrationPolicy']): Promise<ProfileInspectionReceipt> {
  const entries = await createProfileBackupSourceEntries(root);
  const database = entries.find(entry => entry.type === 'database')!;
  const catalog = entries.find(entry => entry.type === 'artifactCatalog')!;
  const artifacts = entries.filter(entry => entry.type === 'businessArtifact');
  return { profileId, migrationChainIdentity: chain, migrationPolicy, databaseHealth: 'healthy',
    artifactCount: artifacts.length, artifactTotalByteSize: Number(artifacts.reduce((sum, entry) => sum + entry.contentLength, 0n)),
    artifactIdentity: createProfileSnapshotArtifactIdentity(artifacts.map(entry => ({
      logicalPath: entry.logicalPath, byteSize: Number(entry.contentLength), sha256: entry.sha256 }))),
    database: { byteSize: Number(database.contentLength), sha256: database.sha256 },
    artifactCatalog: { byteSize: Number(catalog.contentLength), sha256: catalog.sha256 } };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { resolve, promise };
}

function serializedTransportPair(): [ProfileSnapshotBrokerTransport, ProfileSnapshotBrokerTransport] {
  const sides = [0, 1].map(() => ({ closed: false, messages: new Set<(value: unknown) => void>(), closes: new Set<() => void>() }));
  return sides.map((own, index): ProfileSnapshotBrokerTransport => {
    const peer = sides[1 - index]!;
    return {
      close() {
        if (own.closed) return;
        own.closed = true; own.messages.clear();
        for (const listener of [...peer.closes]) listener();
      },
      send(value) {
        if (own.closed || peer.closed) throw new Error('SYNTHETIC_CHANNEL_CLOSED');
        const copy: unknown = JSON.parse(JSON.stringify(value));
        queueMicrotask(() => { if (!peer.closed) for (const listener of peer.messages) listener(copy); });
      },
      subscribe(listener) { own.messages.add(listener); return () => own.messages.delete(listener); },
      subscribeClose(listener) { own.closes.add(listener); return () => own.closes.delete(listener); },
    };
  }) as [ProfileSnapshotBrokerTransport, ProfileSnapshotBrokerTransport];
}
