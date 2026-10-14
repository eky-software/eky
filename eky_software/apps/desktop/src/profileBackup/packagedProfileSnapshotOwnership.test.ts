import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProfileSnapshotArtifactIdentity } from '../runtime/profileInspectionArtifactIdentity.js';
import type { ProfileInspectionReceipt } from '../runtime/profileInspectionMessages.js';
import { captureActiveProfileEntries, type PackagedProfileSnapshotClient } from './packagedProfileBackupSmoke.js';
import { PortableProfileBackupCleanupError } from './portableProfileBackup.js';

const roots: string[] = [];
afterEach(async ({ task }) => {
  const completedRoots = roots.splice(0);
  if (task.result?.state === 'pass') {
    await Promise.all(completedRoots.map(root => rm(root, { recursive: true, force: true })));
  }
});

describe('packaged snapshot observation uses the isolated inspection owner', () => {
  it('binds observed bytes to the receipt and completes owned cleanup before releasing maintenance', async () => {
    const f = await fixture();
    const entries = await captureActiveProfileEntries(f.options);
    expect(entries).toHaveLength(2);
    expect(entries.find(entry => entry.type === 'database')).toMatchObject({
      sha256: digest('synthetic database'), contentLength: '18',
    });
    expect(f.steps).toEqual(['admit', 'begin', 'create', 'validate', 'use', 'used', 'remove', 'end', 'settled']);
    expect(f.client.removeProfileSnapshot).toHaveBeenCalledOnce();
    await expect(readFile(f.source())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects changed bytes after validation instead of publishing a comparison snapshot', async () => {
    const f = await fixture();
    f.useSnapshot.mockImplementation(async (_id, use) => {
      await writeFile(f.source(), 'different database');
      return use(f.receipt);
    });
    await expect(captureActiveProfileEntries(f.options)).rejects.toThrow('PROFILE_BACKUP_SOURCE_INVALID');
    expect(f.client.removeProfileSnapshot).toHaveBeenCalledOnce();
    expect(f.client.endMaintenance).toHaveBeenCalledOnce();
  });

  it('does not observe a different profile and preserves its first validation error', async () => {
    const f = await fixture();
    f.client.validateProfileSnapshot.mockResolvedValue({ ...f.validation, profileMatchesActive: false });
    await expect(captureActiveProfileEntries(f.options)).rejects.toThrow('DESKTOP_SMOKE_PROFILE_SNAPSHOT_FAILED');
    expect(f.useSnapshot).not.toHaveBeenCalled();
    expect(f.client.removeProfileSnapshot).toHaveBeenCalledOnce();
  });

  it('retains source bytes and the original cause when the owner cannot prove cleanup', async () => {
    const f = await fixture();
    const original = new Error('synthetic inspection failed');
    f.client.validateProfileSnapshot.mockRejectedValue(original);
    f.client.removeProfileSnapshot.mockRejectedValue(new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED'));
    const failure = await captureActiveProfileEntries(f.options).catch(error => error as unknown);
    expect(failure).toBeInstanceOf(PortableProfileBackupCleanupError);
    expect(failure).toMatchObject({ cause: original, cleanupStatus: 'unverified' });
    expect(f.client.removeProfileSnapshot).toHaveBeenCalledOnce();
    expect(f.client.endMaintenance).toHaveBeenCalledOnce();
    expect(await readFile(f.source(), 'utf8')).toBe('synthetic database');
    expect(f.steps.at(-1)).toBe('settled');
  });

  it('fails a successful observation if owned cleanup fails', async () => {
    const f = await fixture();
    const cleanup = new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    f.client.removeProfileSnapshot.mockRejectedValue(cleanup);
    await expect(captureActiveProfileEntries(f.options)).rejects.toMatchObject({
      cause: cleanup, cleanupStatus: 'unverified',
    });
    expect(await readFile(f.source(), 'utf8')).toBe('synthetic database');
    expect(f.client.endMaintenance).toHaveBeenCalledOnce();
  });

  it('fails if maintenance cannot be released after the source was safely removed', async () => {
    const f = await fixture();
    const cleanup = new Error('synthetic maintenance release failed');
    f.client.endMaintenance.mockRejectedValue(cleanup);
    await expect(captureActiveProfileEntries(f.options)).rejects.toMatchObject({ cause: cleanup });
    expect(f.client.removeProfileSnapshot).toHaveBeenCalledOnce();
    await expect(readFile(f.source())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not start maintenance or cleanup after inspection admission closes', async () => {
    const f = await fixture();
    const closed = new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    f.admission.mockRejectedValue(closed);
    await expect(captureActiveProfileEntries(f.options)).rejects.toBe(closed);
    expect(f.client.beginMaintenance).not.toHaveBeenCalled();
    expect(f.client.removeProfileSnapshot).not.toHaveBeenCalled();
  });
});

async function fixture() {
  const stagingRoot = await mkdtemp(join(tmpdir(), 'eky-smoke-inspection-'));
  roots.push(stagingRoot);
  let operationId = '';
  const steps: string[] = [];
  const receipt: ProfileInspectionReceipt = {
    artifactIdentity: createProfileSnapshotArtifactIdentity([]),
    artifactCount: 0, artifactTotalByteSize: 0, databaseHealth: 'healthy',
    profileId: 'a'.repeat(64), migrationChainIdentity: 'b'.repeat(64), migrationPolicy: 'exactCurrentManifest',
    database: { byteSize: 18, sha256: digest('synthetic database') },
    artifactCatalog: { byteSize: 2, sha256: digest('{}') },
  };
  const validation = { type: 'profileSnapshotValidation' as const, ...receipt,
    activeProfileIsEmpty: false, profileMatchesActive: true };
  const client = {
    async withInspectionOperation<T>(use: () => Promise<T>): Promise<T> {
      steps.push('admit');
      try { return await use(); } finally { steps.push('settled'); }
    },
    beginMaintenance: vi.fn(async () => { steps.push('begin'); return 'busy' as const; }),
    createProfileSnapshot: vi.fn(async (id: string) => {
      steps.push('create'); operationId = id;
      await mkdir(join(stagingRoot, id));
      await writeFile(join(stagingRoot, id, 'profile.sqlite'), 'synthetic database');
      await writeFile(join(stagingRoot, id, 'snapshot-catalog-v1.json'), '{}');
      return { type: 'profileSnapshot' as const,
        database: { databaseByteSize: 18, logicalPath: 'profile.sqlite' as const, sha256: receipt.database.sha256, totalPages: 1 },
        artifactCatalog: { artifactCount: 0, artifactTotalByteSize: 0, catalogByteSize: 2,
          logicalPath: 'snapshot-catalog-v1.json' as const, sha256: receipt.artifactCatalog.sha256 },
      };
    }),
    validateProfileSnapshot: vi.fn(async () => { steps.push('validate'); return validation; }),
    async withProfileSnapshot<T>(_id: string, use: (receipt: ProfileInspectionReceipt) => Promise<T>): Promise<T> {
      steps.push('use'); const result = await use(receipt); steps.push('used'); return result;
    },
    removeProfileSnapshot: vi.fn(async (id: string) => {
      steps.push('remove'); await rm(join(stagingRoot, id), { recursive: true, force: true });
    }),
    endMaintenance: vi.fn(async () => { steps.push('end'); return 'normal' as const; }),
  } satisfies PackagedProfileSnapshotClient;
  const admission = vi.spyOn(client, 'withInspectionOperation');
  const useSnapshot = vi.spyOn(client, 'withProfileSnapshot');
  return { client, admission, useSnapshot, steps, receipt, validation, source: () => join(stagingRoot, operationId, 'profile.sqlite'),
    options: { profileSnapshotClient: client, stagingRoot } };
}

function digest(value: string) { return createHash('sha256').update(value).digest('hex'); }
