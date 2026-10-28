import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, onTestFinished, vi } from 'vitest';
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
import { InMemoryWorkspaceMaintenanceLease, type WorkspaceMaintenanceLeaseHandle,
  type WorkspaceMaintenancePurpose } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import type { ProfileSnapshotBrokerTransport } from './profileSnapshotBrokerTransport.js';

export type ProcessInput = Parameters<typeof import('../runtime/profileInspectionProcess.js')['runProfileInspectionProcess']>[0];
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

type Options = {
  ordinary?: boolean;
  revokeAtSourceClose?: boolean;
  uncertainExport?: boolean;
  afterExportBytes?(): Promise<void>;
  assertCurrent?(): Promise<void>;
  assertValid?(): void;
  beginDeleteMaintenance?: boolean;
  deferMaintenanceLease?: boolean;
  retainEvidence?(): boolean;
};
async function fixture(options: Options = {}) {
  const root = await fs.mkdtemp(join(tmpdir(), 'eky-delete-backup-'));
  let cleanupCompleted = false;
  onTestFinished(async ({ task }) => {
    if (task.result?.state === 'pass' && cleanupCompleted && !options.uncertainExport && !options.retainEvidence?.()) {
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
  let ownedHandle: WorkspaceMaintenanceLeaseHandle | undefined;
  let leaseGuard: (() => void) | undefined;
  const acquireLease = async (purpose: WorkspaceMaintenancePurpose) => {
    const acquired = await lease.acquire(purpose);
    ownedHandle = acquired;
    leaseGuard = lease.captureCurrentOwner([purpose]);
    return acquired;
  };
  if (!options.deferMaintenanceLease) await acquireLease(options.ordinary ? 'backup' : 'delete');
  const handle = { async release() { await ownedHandle?.release(); } };
  const assertLease = () => {
    if (leaseGuard === undefined) throw new Error('SYNTHETIC_LEASE_NOT_ACQUIRED');
    leaseGuard();
  };
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
  const assertFence = () => { assertLease(); assertChannel(); options.assertValid?.(); };
  const begin = vi.spyOn(broker, 'beginMaintenance');
  const end = vi.spyOn(broker, 'endMaintenance');
  const contextRequests = vi.spyOn(broker, 'readProfileInspectionContext');
  if (!options.ordinary && options.beginDeleteMaintenance !== false) await broker.beginDeleteMaintenance(sourceId);
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
    broker, backend, state, lease, handle, acquireLease, contextRequests, snapshot, assertFence,
    create: () => service.createForDeletion({ destinationPath, password }, {
      operationId: sourceId, assertValid: assertFence,
      async assertCurrent() { assertFence(); await broker.assertDeleteMaintenance(sourceId); assertFence(); await options.assertCurrent?.(); assertFence(); },
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

export { fixture, processBoundary, sourceId, exportId, profileId, password, pdfBytes, pdfName, deferred };
