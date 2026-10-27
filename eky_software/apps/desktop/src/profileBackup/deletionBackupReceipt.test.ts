import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { WorkspaceRegistryStore } from '../workspaces/registry/workspaceRegistryStore.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../workspaces/registry/workspaceRegistryPaths.js';
import { deriveWorkspaceRoot } from '../workspaces/registry/deriveWorkspaceRoot.js';
import { validateWorkspaceId } from '../workspaces/registry/workspaceIdValidation.js';
import type { LocalWorkspaceRegistryV2 } from '../workspaces/registry/workspaceRegistryTypes.js';
import { captureDeletionTarget } from '../workspaces/management/workspaceDeletionTarget.js';
import { beginDeletionBackupProof, createDeletionBackupExportIdentity,
  type ExportIdentity, type DeletionBackupBinding, type InspectedDeletionBackupBinding } from './deletionBackupReceipt.js';
import { fixture, processBoundary, sourceId, profileId, deferred } from './portableDeletionBackupTestSupport.js';
import type { DeletionBackupContent } from './portableProfileBackup.js';

const workspaceId = validateWorkspaceId(sourceId);
const label = 'Synthetic company';

it('captures actual registry bytes, lineage, root and source owner before the real encrypted export', async () => {
  const f = await targetFixture();
  const proof = f.begin();
  expect(processBoundary.run).not.toHaveBeenCalled();
  const content = await f.create();
  expect(f.snapshotBoundary).toHaveBeenCalledOnce();
  expect(f.selection.target).toMatchObject({ workspaceId, profileId, workspaceLabel: label, previousActiveWorkspaceId: workspaceId });
  expect(f.selection.target.registrySha256).toBe(hash(await fs.readFile(f.registryPath)));
  const receipt = await proof.issue(content);
  expect(f.inspectionBindings.length).toBeGreaterThan(0);
  for (const [binding, actual] of [[f.inspectionBindings[0]!.source, content.sourceIdentity],
    [f.inspectionBindings[0]!.exported, content.exported.identity]]) {
    expect(binding).toEqual({ operationId: actual!.operationId, generationId: actual!.generationId, runtimeSession: actual!.runtimeSession });
  }
  expect(Object.isFrozen(f.inspectionBindings[0]!.source)).toBe(true);
  expect(Object.isFrozen(f.inspectionBindings[0]!.exported)).toBe(true);
  f.ownersExited = true;
  let savedGuard!: () => void;
  let savedSelection!: () => Promise<void>;
  const publish = vi.fn(async (guard: () => void, selection: () => Promise<void>) => {
    savedGuard = guard; savedSelection = selection;
    await selection(); guard();
  });
  await receipt.consume(publish);
  expect(publish).toHaveBeenCalledOnce();
  expect(savedGuard).toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
  await expect(savedSelection()).rejects.toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
  await expect(receipt.consume(publish)).rejects.toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
  await expect(fs.readFile(f.companySentinel)).resolves.toEqual(Buffer.from('synthetic company remains'));
  await expect(fs.stat(f.destinationPath)).resolves.toBeDefined();
});

it('rejects a registry change during export and preserves verified bytes without issuing deletion authority', async () => {
  const f = await targetFixture();
  const proof = f.begin();
  const read = f.snapshot.readProfileInspectionContext.bind(f.snapshot);
  let count = 0;
  vi.spyOn(f.snapshot, 'readProfileInspectionContext').mockImplementation(async () => {
    if (++count === 4) await f.registry.write({ ...f.initial, activeWorkspaceId: null });
    return read();
  });
  await expect(f.create()).rejects.toBeInstanceOf(Error);
  proof.invalidate();
  expect(processBoundary.run).toHaveBeenCalledTimes(2);
  expect(f.service.getStatus()).not.toHaveProperty('latestSuccessfulPortableBackupAt');
  await expect(fs.stat(f.destinationPath)).resolves.toBeDefined();
  await expect(fs.readFile(f.companySentinel)).resolves.toEqual(Buffer.from('synthetic company remains'));
});

it.each(['issue', 'consume'] as const)('rejects same-channel named-fence invalidation before %s', async boundary => {
  const f = await targetFixture();
  const proof = f.begin();
  const content = await f.create();
  const receipt = boundary === 'consume' ? await proof.issue(content) : undefined;
  await f.broker.invalidateDeleteMaintenance(sourceId);
  expect(f.assertFence).not.toThrow();
  const publish = vi.fn();
  f.ownersExited = true;
  if (receipt === undefined) await expect(Promise.resolve().then(() => proof.issue(content))).rejects.toBeInstanceOf(Error);
  else await expect(receipt.consume(publish)).rejects.toBeInstanceOf(Error);
  expect(publish).not.toHaveBeenCalled();
});

it('claims issuance before a named-owner await and rejects reentry and revocation', async () => {
  const f = await targetFixture();
  const proof = f.begin(); const content = await f.create();
  const entered = deferred(); const gate = deferred();
  const assertOwner = f.broker.assertDeleteMaintenance.bind(f.broker);
  vi.spyOn(f.broker, 'assertDeleteMaintenance').mockImplementation(async id => {
    entered.resolve(); await gate.promise; return assertOwner(id);
  });
  const outcome = proof.issue(content).catch(error => error);
  try {
    await entered.promise;
    await expect(proof.issue(content)).rejects.toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
    await f.broker.invalidateDeleteMaintenance(sourceId);
  } finally { gate.resolve(); await outcome; }
  expect(await outcome).toBeInstanceOf(Error);
  expect(f.inspectionBindings).toHaveLength(0);
});

it('cannot revive issuance after invalidation between final async settlement and transition', async () => {
  const f = await targetFixture(); const proof = f.begin(); const content = await f.create();
  let boundAssertions = 0;
  f.continuity.mockImplementation(binding => {
    if ('source' in binding && ++boundAssertions === 2) queueMicrotask(() => proof.invalidate());
  });
  await expect(proof.issue(content)).rejects.toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
});

it('cannot report consumption settled after its final selection callback queues invalidation', async () => {
  const f = await targetFixture(); const proof = f.begin(); const receipt = await proof.issue(await f.create());
  f.ownersExited = true;
  let published = false; let afterPublishAssertions = 0;
  f.continuity.mockImplementation(() => {
    if (published && ++afterPublishAssertions === 4) queueMicrotask(() => proof.invalidate());
  });
  await expect(receipt.consume(async guard => { guard(); published = true; })).rejects.toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
});

it.each(['operationId', 'generationId', 'runtimeSession', 'lineage'] as const)(
  'rejects mismatched actual inspection evidence: %s', async field => {
    const f = await targetFixture();
    const proof = f.begin();
    const content = await f.create();
    const invalid = field === 'lineage' ? { ...content, sourceReceipt: { ...content.sourceReceipt, profileId: 'e'.repeat(64) } }
      : field === 'operationId' ? { ...content, sourceIdentity: { ...content.sourceIdentity, operationId: content.exported.identity.operationId } }
      : { ...content, exported: { ...content.exported, identity: { ...content.exported.identity, [field]: content.sourceIdentity[field] } } };
    await expect(proof.issue(invalid)).rejects.toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
    await expect(proof.issue(content)).rejects.toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
  },
);

it('does not consume before owned work ends, even though the backup itself succeeded', async () => {
  const f = await targetFixture();
  const proof = f.begin();
  const receipt = await proof.issue(await f.create());
  const publish = vi.fn();
  await expect(receipt.consume(publish)).rejects.toThrow('SYNTHETIC_OWNERS_NOT_EXITED');
  f.ownersExited = true;
  await expect(receipt.consume(publish)).rejects.toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
  expect(publish).not.toHaveBeenCalled();
});

it.each(['changedBytes', 'sameBytesNewFile'] as const)('rejects %s at the export recheck', async change => {
  const f = await targetFixture();
  const proof = f.begin();
  const receipt = await proof.issue(await f.create());
  const original = await fs.readFile(f.destinationPath);
  if (change === 'sameBytesNewFile') {
    await fs.rename(f.destinationPath, `${f.destinationPath}.retained`);
    await fs.writeFile(f.destinationPath, original);
  } else {
    const changed = Buffer.from(original); changed[changed.length - 1]! ^= 1;
    await fs.copyFile(f.destinationPath, `${f.destinationPath}.retained`);
    // Only this synthetic corruption fixture is made writable. The exporter
    // correctly published the original as read-only.
    await fs.chmod(f.destinationPath, 0o600);
    await fs.writeFile(f.destinationPath, changed);
  }
  f.ownersExited = true;
  const publish = vi.fn();
  await expect(receipt.consume(publish)).rejects.toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
  expect(publish).not.toHaveBeenCalled();
  await expect(fs.stat(f.destinationPath)).resolves.toBeDefined();
});

it('also checks the measured digest independently of the file identity', async () => {
  const f = await targetFixture();
  const proof = f.begin();
  const receipt = await proof.issue(await f.create());
  const original = await readSyntheticExport(f.destinationPath);
  f.recheck.mockResolvedValue({ ...original, sha256: hash(Buffer.from('different synthetic bytes')) });
  f.ownersExited = true;
  const publish = vi.fn();
  await expect(receipt.consume(publish)).rejects.toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
  expect(publish).not.toHaveBeenCalled();
});

it('checks target selection again after the publication callback and closes its guard on failure', async () => {
  const f = await targetFixture();
  const proof = f.begin(); const receipt = await proof.issue(await f.create());
  f.ownersExited = true;
  let saved!: () => void;
  await expect(receipt.consume(async guard => {
    saved = guard; guard();
    await f.registry.write({ ...f.initial, activeWorkspaceId: null });
  })).rejects.toThrow('WORKSPACE_DELETE_STALE_CONFIRMATION');
  expect(saved).toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
});

it('claims consumption before awaiting selection and rejects reentrant or late publication', async () => {
  const f = await targetFixture();
  const proof = f.begin();
  const receipt = await proof.issue(await f.create());
  f.ownersExited = true;
  const entered = deferred(); const gate = deferred();
  f.recheck.mockImplementation(async () => { entered.resolve(); await gate.promise; return readSyntheticExport(f.destinationPath); });
  const publish = vi.fn();
  const outcome = receipt.consume(publish).catch(error => error);
  try {
    await entered.promise;
    await expect(receipt.consume(publish)).rejects.toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
    f.revoke();
  } finally { gate.resolve(); await outcome; }
  expect(await outcome).toBeInstanceOf(Error);
  expect(publish).not.toHaveBeenCalled();
});

it('burns publication authority after a failed acknowledgement and rejects saved guards', async () => {
  const f = await targetFixture();
  const proof = f.begin(); const receipt = await proof.issue(await f.create());
  f.ownersExited = true;
  let saved!: () => void;
  await expect(receipt.consume(async guard => { saved = guard; guard(); throw new Error('SYNTHETIC_ACK_LOST'); }))
    .rejects.toThrow('SYNTHETIC_ACK_LOST');
  expect(saved).toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
  await expect(receipt.consume(vi.fn())).rejects.toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
});

it('strictly parses completed receipts and their role-specific policies before issuance', async () => {
  const f = await targetFixture();
  const proofs = Array.from({ length: 6 }, () => f.begin());
  const content = await f.create();
  const malformed: unknown[] = [
    { ...content, sourceReceipt: { ...content.sourceReceipt, migrationPolicy: 'restoreCompatible' } },
    { ...content, exported: { ...content.exported, receipt: { ...content.exported.receipt, migrationPolicy: 'exactCurrentManifest' } } },
    { ...content, sourceIdentity: Object.assign({}, content.sourceIdentity, { unexpected: true }) },
    { ...content, sourceReceipt: Object.assign({}, content.sourceReceipt, { unexpected: true }) },
    { ...content, exported: { ...content.exported, receipt: {
      ...content.exported.receipt, database: { ...content.exported.receipt.database, byteSize: -1 },
    } } },
    { ...content, exported: { ...content.exported, identity: { ...content.exported.identity, protocolVersion: 0 } } },
  ];
  for (const [index, invalid] of malformed.entries()) {
    await expect(proofs[index]!.issue(invalid as DeletionBackupContent)).rejects.toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
    await expect(proofs[index]!.issue(content)).rejects.toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
  }
  expect(f.inspectionBindings).toHaveLength(0);
});

it('uses the shared correspondence owner for every authenticated content field and preserves its cause', async () => {
  const f = await targetFixture();
  const proofs = Array.from({ length: 9 }, () => f.begin());
  const content = await f.create();
  const exported = content.exported.receipt;
  const mismatches = [
    { ...exported, profileId: 'f'.repeat(64) },
    { ...exported, migrationChainIdentity: 'f'.repeat(64) },
    { ...exported, artifactIdentity: 'f'.repeat(64) },
    { ...exported, artifactCount: exported.artifactCount + 1 },
    { ...exported, artifactTotalByteSize: exported.artifactTotalByteSize + 1 },
    { ...exported, database: { ...exported.database, sha256: 'f'.repeat(64) } },
    { ...exported, database: { ...exported.database, byteSize: exported.database.byteSize + 1 } },
    { ...exported, artifactCatalog: { ...exported.artifactCatalog, sha256: 'f'.repeat(64) } },
    { ...exported, artifactCatalog: { ...exported.artifactCatalog, byteSize: exported.artifactCatalog.byteSize + 1 } },
  ];
  for (const [index, receipt] of mismatches.entries()) {
    await expect(proofs[index]!.issue({ ...content, exported: { ...content.exported, receipt } }))
      .rejects.toMatchObject({ message: 'WORKSPACE_DELETE_BACKUP_UNAVAILABLE',
        cause: { message: 'PROFILE_BACKUP_CONTENT_MISMATCH' } });
    await expect(proofs[index]!.issue(content)).rejects.toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
  }
});

it('copies the original authenticated file identity independently of later content mutation', async () => {
  const f = await targetFixture();
  const proof = f.begin();
  const content = await f.create();
  const file = { ...content.exported.authenticatedFileIdentity };
  const receipt = await proof.issue({ ...content, exported: { ...content.exported, authenticatedFileIdentity: file } });
  file.ino += 1n;
  f.ownersExited = true;
  const publish = vi.fn(async (guard: () => void) => { guard(); });
  await receipt.consume(publish);
  expect(publish).toHaveBeenCalledOnce();
});

it('detects synchronous invalidation inside an owner assertion and never revives the issued receipt', async () => {
  const f = await targetFixture();
  const proof = f.begin();
  const receipt = await proof.issue(await f.create());
  f.ownersExited = true;
  f.continuity.mockImplementationOnce(() => proof.invalidate());
  const publish = vi.fn();
  await expect(receipt.consume(publish)).rejects.toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
  f.continuity.mockReset();
  await expect(receipt.consume(publish)).rejects.toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
  expect(publish).not.toHaveBeenCalled();
});

async function targetFixture(activeWorkspaceId: typeof workspaceId | null = workspaceId) {
  let selection: Awaited<ReturnType<typeof captureDeletionTarget>> | undefined;
  let revoked = false;
  const base = await fixture({ assertCurrent: async () => { await selection?.assertCurrent(); },
    assertValid: () => selection?.assertValid() });
  const registryPath = join(base.root, WORKSPACE_REGISTRY_FILE_NAME);
  const registry = new WorkspaceRegistryStore({ installationRoot: base.root, filePath: registryPath });
  const initial: LocalWorkspaceRegistryV2 = { formatVersion: 2, activeWorkspaceId, workspaces: [{
    workspaceId, workspaceLabel: label, lineageIdentity: { formatVersion: 1, profileId },
    layoutVersion: 1, lifecycleState: 'ready', createdAt: '2026-10-27T10:00:00.000Z',
  }] };
  await registry.write(initial);
  const companyRoot = deriveWorkspaceRoot(base.root, workspaceId, 1).workspaceRoot;
  await fs.mkdir(companyRoot, { recursive: true, mode: 0o700 });
  const companySentinel = join(companyRoot, 'sentinel');
  await fs.writeFile(companySentinel, 'synthetic company remains');
  const assertLease = base.lease.captureCurrentOwner(['delete']);
  const targetInput = { installationRoot: base.root, workspaceId, typedLabel: label, registry,
    assertAuthority() { assertLease(); if (revoked) throw new Error('SYNTHETIC_DOCUMENT_REVOKED'); } };
  selection = await captureDeletionTarget(targetInput);
  const captured = selection;
  const snapshotBoundary = vi.fn(() => { captured.assertValid(); base.assertFence(); });
  const recheck = vi.fn(() => readSyntheticExport(base.destinationPath));
  const continuity = vi.fn<(binding: DeletionBackupBinding | InspectedDeletionBackupBinding) => void>();
  const inspectionBindings: InspectedDeletionBackupBinding[] = [];
  const assertInspectionBinding = (binding: InspectedDeletionBackupBinding) => {
    const identities = processBoundary.run.mock.calls.map(([input]) => input.identity);
    for (const [selected, actual] of [[binding.source, identities[0]], [binding.exported, identities[1]]] as const) {
      if (selected.operationId !== actual?.operationId || selected.generationId !== actual.generationId ||
        selected.runtimeSession !== actual.runtimeSession) throw new Error('SYNTHETIC_INSPECTION_OWNER_MISMATCH');
    }
    inspectionBindings.push(binding);
  };
  const result = { ...base, selection: captured, registryPath, registry, initial, companyRoot, companySentinel,
    targetInput, snapshotBoundary, recheck, inspectionBindings, continuity, ownersExited: false, revoke() { revoked = true; },
    begin: () => beginDeletionBackupProof({
      operationId: sourceId, workspaceId, profileId, registryEntrySha256: captured.target.registryEntrySha256,
      rootIdentity: captured.target.rootIdentity, leaseOwner: sourceId, runtimeGeneration: 'synthetic-current-generation',
    }, { assertSnapshotBoundary: snapshotBoundary,
      assertContinuity: binding => { captured.assertValid(); base.assertFence(); continuity(binding); },
      async assertCurrent() {
        await captured.assertCurrent();
        await base.broker.assertDeleteMaintenance(sourceId);
        captured.assertValid(); base.assertFence();
      },
      assertOwnersExited: binding => {
        assertInspectionBinding(binding);
        if (!result.ownersExited) throw new Error('SYNTHETIC_OWNERS_NOT_EXITED');
      },
      assertInspectionCleanup: binding => {
        assertInspectionBinding(binding);
        if (base.events.join(',') !== 'process:source,process:export,close:export,close:source') throw new Error('SYNTHETIC_INSPECTION_UNFINISHED');
      }, recheckAuthenticatedExport: () => recheck(),
    }),
  };
  return result;
}

// A measured small synthetic file, not the production export-recheck reader.
async function readSyntheticExport(path: string): Promise<ExportIdentity> {
  const metadata = await fs.lstat(path, { bigint: true });
  return createDeletionBackupExportIdentity(metadata, hash(await fs.readFile(path)));
}
function hash(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
