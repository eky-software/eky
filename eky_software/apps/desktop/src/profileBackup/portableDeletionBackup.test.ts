import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { ProfileSnapshotInspectionEvidence } from './profileSnapshotInspectionClient.js';
import type { ProcessInput } from './portableDeletionBackupTestSupport.js';
import { fixture, processBoundary, sourceId, exportId, profileId, password, pdfBytes, pdfName, deferred } from './portableDeletionBackupTestSupport.js';

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
