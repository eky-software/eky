import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { captureDeletionTarget } from '../management/workspaceDeletionTarget.js';
import { parseWorkspaceRegistryBytes } from '../registry/workspaceRegistryBytes.js';
import { serializeWorkspaceRegistry, workspaceRegistryEntrySha256 } from '../registry/workspaceRegistrySerializer.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { createSwitchRegistry, createSwitchWorkspace, TEST_SOURCE_WORKSPACE_ID, TEST_TARGET_WORKSPACE_ID } from '../switch/workspaceSwitchTestSupport.js';
import { captureWorkspaceDeletionRegistryTransition } from './workspaceDeletionRegistrySelection.js';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const operationId = '33333333-3333-4333-8333-333333333333';

it.each([TEST_SOURCE_WORKSPACE_ID, TEST_TARGET_WORKSPACE_ID, null])('binds exact before/after registry bytes from %s', activeWorkspaceId => {
  const f = fixture(activeWorkspaceId);
  const transition = captureWorkspaceDeletionRegistryTransition(f.slots, f.context);
  expect(transition.registryBeforeSha256).toBe(hash(f.bytes));
  expect(transition.registryAfterSha256).toBe(hash(serializeWorkspaceRegistry(transition.after)));
  expect(transition.target.operationId).toBe(operationId);
  expect(transition.after.workspaces).toEqual([f.before.workspaces[0]]);
  expect(transition.after.activeWorkspaceId).toBe(activeWorkspaceId === TEST_TARGET_WORKSPACE_ID ? null : activeWorkspaceId);
  expect(f.slots.current.bytes.equals(f.bytes)).toBe(true);
  f.slots.current.bytes.fill(0);
  expect(transition.before).toEqual(f.before);
  expect(transition.registryBeforeSha256).toBe(hash(f.bytes));
  expect(Object.isFrozen(transition)).toBe(true);
});

it.each(['missingCurrent', 'missingIdentity', 'next', 'backup'] as const)('never selects or repairs %s', changed => {
  const f = fixture();
  const slots = { ...f.slots,
    ...(changed === 'missingCurrent' ? { current: undefined } : {}),
    ...(changed === 'missingIdentity' ? { current: { bytes: f.bytes, value: f.before } } : {}),
    ...(changed === 'next' ? { next: f.slots.current } : {}),
    ...(changed === 'backup' ? { backup: f.slots.current } : {}),
  };
  expect(() => captureWorkspaceDeletionRegistryTransition(slots, f.context)).toThrow();
  expect(f.slots.current.bytes.equals(f.bytes)).toBe(true);
});

it.each(['digest', 'entry', 'lineage', 'name', 'state', 'active', 'operation', 'target'] as const)(
  'rejects a mismatched %s without changing the source', changed => {
    const f = fixture();
    const context = { ...f.context,
      ...(changed === 'operation' ? { operationId: 'not-an-operation' } : {}),
      target: { ...f.context.target,
        ...(changed === 'digest' ? { registrySha256: '0'.repeat(64) } : {}),
        ...(changed === 'entry' ? { registryEntrySha256: '0'.repeat(64) } : {}),
        ...(changed === 'lineage' ? { profileId: '0'.repeat(64) } : {}),
        ...(changed === 'name' ? { workspaceLabel: 'Different' } : {}),
        ...(changed === 'state' ? { lifecycleState: 'recoveryRequired' as const } : {}),
        ...(changed === 'active' ? { previousActiveWorkspaceId: null } : {}),
        ...(changed === 'target' ? { workspaceId: TEST_SOURCE_WORKSPACE_ID } : {}),
      },
    };
    expect(() => captureWorkspaceDeletionRegistryTransition(f.slots, context)).toThrow();
    expect(f.slots.current.bytes.equals(f.bytes)).toBe(true);
  });

it('preserves historical duplicate names, entry order and a recovery-required target', () => {
  const f = fixture(null);
  const first = f.before.workspaces[0]!;
  const third = createSwitchWorkspace('44444444-4444-4444-8444-444444444444' as typeof TEST_SOURCE_WORKSPACE_ID,
    first.workspaceLabel, 'c');
  const before = { ...f.before, workspaces: [first, { ...f.before.workspaces[1]!,
    workspaceLabel: first.workspaceLabel, lifecycleState: 'recoveryRequired' as const }, third] };
  const bytes = Buffer.from(serializeWorkspaceRegistry(before));
  const captured = parseWorkspaceRegistryBytes(bytes);
  const target = captured.workspaces[1]!;
  const transition = captureWorkspaceDeletionRegistryTransition({ ...f.slots, current: {
    ...f.slots.current, bytes, value: captured,
  } }, { ...f.context, target: { ...f.context.target, workspaceLabel: target.workspaceLabel,
    lifecycleState: target.lifecycleState, registrySha256: hash(bytes), registryEntrySha256: workspaceRegistryEntrySha256(target) } });
  expect(transition.after.workspaces).toEqual([first, third]);
  expect(transition.after.activeWorkspaceId).toBeNull();
});

it('keeps the existing canonical entry digest stable across input key order', () => {
  const entry = createSwitchWorkspace(TEST_TARGET_WORKSPACE_ID, 'Synthetic Unicode \u00c4', 'b');
  expect(workspaceRegistryEntrySha256(entry)).toBe(hash(Buffer.from(JSON.stringify(entry))));
  const reordered = Object.fromEntries(Object.entries(entry).reverse());
  expect(workspaceRegistryEntrySha256(reordered as unknown as typeof entry)).toBe(workspaceRegistryEntrySha256(entry));
});

it('binds original byte formatting separately from the canonical result and ignores an untrusted parsed slot value', () => {
  const f = fixture();
  const bytes = Buffer.from(JSON.stringify(f.before, null, 2));
  const transition = captureWorkspaceDeletionRegistryTransition({ ...f.slots, current: {
    ...f.slots.current, bytes, value: { ...f.before, workspaces: [] },
  } }, { ...f.context, target: { ...f.context.target, registrySha256: hash(bytes) } });
  expect(transition.before).toEqual(f.before);
  expect(transition.registryBeforeSha256).toBe(hash(bytes));
  expect(transition.registryBeforeSha256).not.toBe(hash(f.bytes));
  expect(transition.registryAfterSha256).toBe(hash(serializeWorkspaceRegistry(transition.after)));
});

it('reads real selected registry bytes through the existing target owner without writing a deletion result', async context => {
  const root = await mkdtemp(join(tmpdir(), 'eky-deletion-registry-'));
  context.onTestFinished(async () => { if (context.task.result?.state === 'pass') await rm(root, { recursive: true }); });
  const f = fixture();
  const registryPath = join(root, WORKSPACE_REGISTRY_FILE_NAME);
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPath });
  await registry.write(f.before);
  const paths = deriveWorkspaceRoot(root, TEST_TARGET_WORKSPACE_ID, 1);
  await mkdir(paths.workspaceRoot, { recursive: true });
  const sentinel = join(paths.workspaceRoot, 'retained');
  await writeFile(sentinel, 'unchanged');
  const selected = await captureDeletionTarget({ installationRoot: root, workspaceId: TEST_TARGET_WORKSPACE_ID,
    typedLabel: f.context.target.workspaceLabel, registry, assertAuthority() {} });
  const before = await readFile(registryPath);
  const transition = captureWorkspaceDeletionRegistryTransition(await registry.inspectSlots(), {
    operationId, target: selected.target, backupDisposition: 'explicitDataLoss',
  });
  await selected.assertCurrent();
  expect(transition.registryBeforeSha256).toBe(hash(before));
  expect((await readFile(registryPath)).equals(before)).toBe(true);
  expect(await readFile(sentinel, 'utf8')).toBe('unchanged');
});

function fixture(activeWorkspaceId: typeof TEST_SOURCE_WORKSPACE_ID | null = TEST_SOURCE_WORKSPACE_ID) {
  const before = parseWorkspaceRegistryBytes(serializeWorkspaceRegistry({ ...createSwitchRegistry(), formatVersion: 2, activeWorkspaceId }));
  const bytes = Buffer.from(serializeWorkspaceRegistry(before));
  const entry = before.workspaces[1]!;
  const context = Object.freeze({ operationId, backupDisposition: 'explicitDataLoss' as const,
    target: Object.freeze({ workspaceId: entry.workspaceId, workspaceLabel: entry.workspaceLabel,
      profileId: entry.lineageIdentity.profileId, lifecycleState: entry.lifecycleState,
      previousActiveWorkspaceId: activeWorkspaceId, registrySha256: hash(bytes),
      registryEntrySha256: workspaceRegistryEntrySha256(entry), rootIdentity: 'd'.repeat(64) }) });
  const slots = { current: { bytes: Buffer.from(bytes), value: before,
    identity: { dev: 1, ino: 1, size: bytes.byteLength, mtimeMs: 1, ctimeMs: 1 } },
    next: undefined, backup: undefined };
  return { before, bytes, context, slots };
}
