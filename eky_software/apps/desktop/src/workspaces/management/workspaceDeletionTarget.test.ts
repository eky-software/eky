import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { fixture, processBoundary, sourceId, profileId } from '../../profileBackup/portableDeletionBackupTestSupport.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import type { LocalWorkspaceRegistryV2 } from '../registry/workspaceRegistryTypes.js';
import { captureDeletionTarget } from './workspaceDeletionTarget.js';

const workspaceId = validateWorkspaceId(sourceId);
const label = 'Synthetic company';

it('captures immutable target data from current registry bytes and the original directory identity', async () => {
  const f = await targetFixture();
  expect(f.selection.target).toMatchObject({ workspaceId, profileId, workspaceLabel: label,
    lifecycleState: 'ready', previousActiveWorkspaceId: workspaceId,
    registrySha256: createHash('sha256').update(await fs.readFile(f.registryPath)).digest('hex') });
  expect(Object.isFrozen(f.selection)).toBe(true);
  expect(Object.isFrozen(f.selection.target)).toBe(true);
  expect(processBoundary.run).not.toHaveBeenCalled();
});

it.each(['label', 'lineage', 'selection', 'sameBytesNewFile', 'nextSlot', 'root'] as const)(
  'permanently rejects a target change after capture: %s', async change => {
    const f = await targetFixture();
    const before = await fs.readFile(f.registryPath);
    if (change === 'root') {
      await fs.rename(f.companyRoot, `${f.companyRoot}.retained`);
      await fs.mkdir(f.companyRoot, { mode: 0o700 });
    } else if (change === 'sameBytesNewFile') {
      await fs.rename(f.registryPath, `${f.registryPath}.retained`);
      await fs.writeFile(f.registryPath, before, { mode: 0o600 });
    } else if (change === 'nextSlot') {
      await fs.writeFile(`${f.registryPath}.next`, before, { mode: 0o600 });
    } else {
      const current = JSON.parse(before.toString()) as LocalWorkspaceRegistryV2;
      const changed = change === 'selection' ? { ...current, activeWorkspaceId: null }
        : { ...current, workspaces: [{ ...current.workspaces[0]!,
          ...(change === 'label' ? { workspaceLabel: 'Changed' } : { lineageIdentity: { formatVersion: 1, profileId: 'f'.repeat(64) } }),
        }] };
      await f.registry.write(changed);
    }
    await expect(f.selection.assertCurrent()).rejects.toThrow('WORKSPACE_DELETE_STALE_CONFIRMATION');
    expect(f.selection.assertValid).toThrow('WORKSPACE_DELETE_STALE_CONFIRMATION');
    await expect(f.create()).rejects.toBeInstanceOf(Error);
    expect(processBoundary.run).not.toHaveBeenCalled();
    // Confirmation never removes the displaced root or registry file.
    await expect(fs.readFile(change === 'root' ? join(`${f.companyRoot}.retained`, 'sentinel') : f.companySentinel))
      .resolves.toEqual(Buffer.from('synthetic company remains'));
  },
);

it.each([null, workspaceId])('captures previous selection %s without substituting another company', async activeWorkspaceId => {
  const f = await targetFixture(activeWorkspaceId);
  expect(f.selection.target.previousActiveWorkspaceId).toBe(activeWorkspaceId);
  await expect(f.selection.assertCurrent()).resolves.toBeUndefined();
});

it('uses exact deletion name matching, not case-insensitive uniqueness matching', async () => {
  const f = await targetFixture();
  await expect(captureDeletionTarget({ ...f.targetInput, typedLabel: label.toLowerCase() }))
    .rejects.toThrow('WORKSPACE_DELETE_STALE_CONFIRMATION');
});

it('rejects authority lost during a real registry read and never invokes recovery-writing read', async () => {
  const f = await targetFixture();
  const recovering = vi.spyOn(f.registry, 'read');
  const read = f.registry.inspectSlots.bind(f.registry);
  vi.spyOn(f.registry, 'inspectSlots').mockImplementation(async () => {
    const result = await read(); f.revoke(); return result;
  });
  await expect(captureDeletionTarget(f.targetInput)).rejects.toThrow('SYNTHETIC_DOCUMENT_REVOKED');
  expect(recovering).not.toHaveBeenCalled();
});

it('captures the owner-supplied installation root before the first await', async () => {
  const f = await targetFixture();
  const input = { ...f.targetInput };
  const read = f.registry.inspectSlots.bind(f.registry);
  vi.spyOn(f.registry, 'inspectSlots').mockImplementation(async () => {
    const result = await read(); input.installationRoot = join(f.root, 'different-root'); return result;
  });
  const selected = await captureDeletionTarget(input);
  expect(selected.target.rootIdentity).toBe(f.selection.target.rootIdentity);
  await expect(selected.assertCurrent()).resolves.toBeUndefined();
});

it('does not restore captured authority by acquiring a new lease of the same purpose', async () => {
  const f = await targetFixture();
  await f.handle.release();
  const replacement = await f.lease.acquire('delete');
  try {
    await expect(f.selection.assertCurrent()).rejects.toThrow('WORKSPACE_MAINTENANCE_BUSY');
    await expect(f.create()).rejects.toBeInstanceOf(Error);
  } finally { await replacement.release(); }
  expect(processBoundary.run).not.toHaveBeenCalled();
});

it.each(['next', 'backup'] as const)('rejects an ambiguous %s slot without recovering it', async slot => {
  const f = await targetFixture();
  const bytes = await fs.readFile(f.registryPath);
  const path = `${f.registryPath}.${slot}`;
  await fs.writeFile(path, bytes, { mode: 0o600 });
  const recovering = vi.spyOn(f.registry, 'read');
  await expect(captureDeletionTarget(f.targetInput)).rejects.toThrow('WORKSPACE_DELETE_STALE_CONFIRMATION');
  expect(recovering).not.toHaveBeenCalled();
  await expect(fs.readFile(path)).resolves.toEqual(bytes);
  await expect(fs.readFile(f.registryPath)).resolves.toEqual(bytes);
});

it('requires the current v2 slot instead of choosing a recovery slot', async () => {
  const f = await targetFixture();
  await fs.rename(f.registryPath, `${f.registryPath}.backup`);
  await expect(captureDeletionTarget(f.targetInput)).rejects.toThrow('WORKSPACE_DELETE_STALE_CONFIRMATION');
  await expect(fs.stat(f.registryPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(fs.readFile(`${f.registryPath}.backup`)).resolves.toBeInstanceOf(Buffer);
});

it('reparses slot bytes strictly instead of trusting a pre-parsed value', async () => {
  const f = await targetFixture();
  const slots = await f.registry.inspectSlots();
  const bytes = Buffer.from(JSON.stringify(f.initial).replace('"formatVersion":2', '"formatVersion":2,"formatVersion":2'));
  vi.spyOn(f.registry, 'inspectSlots').mockResolvedValue({ ...slots, current: { ...slots.current!, bytes } });
  await expect(captureDeletionTarget(f.targetInput)).rejects.toThrow('WORKSPACE_REGISTRY_INVALID');
});

it('requires the original slot identity even when the parsed value and bytes are valid', async () => {
  const f = await targetFixture();
  const slots = await f.registry.inspectSlots();
  vi.spyOn(f.registry, 'inspectSlots').mockResolvedValue({ ...slots,
    current: { bytes: slots.current!.bytes, value: slots.current!.value } });
  await expect(captureDeletionTarget(f.targetInput)).rejects.toThrow('WORKSPACE_DELETE_STALE_CONFIRMATION');
});

it('keeps a changed selection invalid even after the old registry bytes return', async () => {
  const f = await targetFixture();
  await f.registry.write({ ...f.initial, activeWorkspaceId: null });
  await expect(f.selection.assertCurrent()).rejects.toThrow('WORKSPACE_DELETE_STALE_CONFIRMATION');
  await f.registry.write(f.initial);
  expect(f.selection.assertValid).toThrow('WORKSPACE_DELETE_STALE_CONFIRMATION');
  await expect(f.selection.assertCurrent()).rejects.toThrow('WORKSPACE_DELETE_STALE_CONFIRMATION');
});

it('uses exact NFC equality without collapsing internal whitespace', async () => {
  const f = await targetFixture();
  const workspaceLabel = 'Synthetic \u00c4 company';
  await f.registry.write({ ...f.initial, workspaces: [{ ...f.initial.workspaces[0]!, workspaceLabel }] });
  const selected = await captureDeletionTarget({ ...f.targetInput, typedLabel: 'Synthetic A\u0308 company' });
  expect(selected.target.workspaceLabel).toBe(workspaceLabel);
  await expect(captureDeletionTarget({ ...f.targetInput, typedLabel: 'Synthetic  \u00c4 company' }))
    .rejects.toThrow('WORKSPACE_DELETE_STALE_CONFIRMATION');
});

it('keeps the deletion target separate from another active company', async () => {
  const f = await targetFixture();
  const otherId = validateWorkspaceId('22222222-2222-4222-8222-222222222222');
  await f.registry.write({ ...f.initial, activeWorkspaceId: otherId, workspaces: [
    ...f.initial.workspaces, { ...f.initial.workspaces[0]!, workspaceId: otherId,
      workspaceLabel: 'Other company', lineageIdentity: { formatVersion: 1, profileId: 'f'.repeat(64) } },
  ] });
  const selected = await captureDeletionTarget(f.targetInput);
  expect(selected.target).toMatchObject({ workspaceId, profileId, previousActiveWorkspaceId: otherId });
  await expect(selected.assertCurrent()).resolves.toBeUndefined();
  expect(processBoundary.run).not.toHaveBeenCalled();
});

it('identifies a recovery-required target without opening its business runtime', async () => {
  const f = await targetFixture();
  await f.registry.write({ ...f.initial, activeWorkspaceId: null,
    workspaces: [{ ...f.initial.workspaces[0]!, lifecycleState: 'recoveryRequired' }] });
  const selected = await captureDeletionTarget(f.targetInput);
  expect(selected.target).toMatchObject({ workspaceId, profileId,
    lifecycleState: 'recoveryRequired', previousActiveWorkspaceId: null });
  await expect(selected.assertCurrent()).resolves.toBeUndefined();
  expect(processBoundary.run).not.toHaveBeenCalled();
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
  return { ...base, selection: captured, registryPath, registry, initial, companyRoot, companySentinel,
    targetInput, revoke() { revoked = true; } };
}
