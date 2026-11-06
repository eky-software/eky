import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { captureWorkspaceRemnantBinding, captureWorkspaceRemnantBindingKey, maximumWorkspaceRemnantBindingBytes,
  parseWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding, workspaceRemnantBindingKey,
  workspaceRemnantBindingSha256 } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { remnantBindingTestOwners as owners, remnantTestBinding } from './workspaceRemnantBindingTestSupport.js';

for (const owner of owners) {
  it(`round trips only the canonical fields for ${owner}`, () => {
    const value = remnantTestBinding(owner);
    const bytes = serializeWorkspaceRemnantBinding(value);
    expect(parseWorkspaceRemnantBinding(bytes)).toEqual(value);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.lineageIdentity)).toBe(true);
    expect(bytes.toString()).toBe(`${JSON.stringify(value)}\n`);
    expect(workspaceRemnantBindingSha256(value)).toBe(createHash('sha256').update(bytes).digest('hex'));
    const reordered = Object.fromEntries(Object.entries(value).reverse());
    expect(workspaceRemnantBindingSha256(parseWorkspaceRemnantBinding(Buffer.from(`${JSON.stringify(reordered, null, 2)}\n`))))
      .toBe(workspaceRemnantBindingSha256(value));
    const key = workspaceRemnantBindingKey(value);
    expect(captureWorkspaceRemnantBindingKey(key)).toEqual(key);
    const paths = createWorkspaceRemnantBindingPaths(join(tmpdir(), 'synthetic-installation'), key);
    const expectedDirectory = { workspaceReplacement: 'workspace-replacement-bindings',
      workspaceActivationMigration: 'workspace-activation-migration-bindings', workspaceImport: 'workspace-import-bindings',
      workspaceLegacyAdoption: 'workspace-legacy-adoption-bindings', profileInspection: 'profile-inspection-bindings' }[owner];
    const file = owner === 'workspaceLegacyAdoption' ? `${value.workspaceId}.json`
      : owner === 'profileInspection' ? `${value.operationId}-${id(3)}.json` : `${value.operationId}.json`;
    expect(paths.currentPath.endsWith(file)).toBe(true);
    expect(paths.currentPath).toBe(join(tmpdir(), 'synthetic-installation', 'workspace-state', expectedDirectory, file));
    expect(paths.nextPath).toBe(`${paths.currentPath}.next`);
    expect(paths.backupPath).toBe(`${paths.currentPath}.backup`);
  });
}

for (const field of ['formatVersion', 'owner', 'operationId', 'workspaceId', 'lineageIdentity']) {
  it(`rejects absent or invalid ${field}`, () => {
    const value: Record<string, unknown> = { ...remnantTestBinding() };
    delete value[field];
    expect(() => captureWorkspaceRemnantBinding(value)).toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    value[field] = 'invalid';
    expect(() => captureWorkspaceRemnantBinding(value)).toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  });
}

for (const field of ['generationId', 'rootIdentity', 'parentIdentity']) {
  it(`requires ${field} only for inspection`, () => {
    const value: Record<string, unknown> = { ...remnantTestBinding('profileInspection') };
    delete value[field];
    expect(() => captureWorkspaceRemnantBinding(value)).toThrow();
    value[field] = '../invalid';
    expect(() => captureWorkspaceRemnantBinding(value)).toThrow();
    expect(() => captureWorkspaceRemnantBinding({ ...remnantTestBinding(), [field]: id(1) })).toThrow();
  });
}

for (const field of ['phase', 'path', 'name', 'password', 'runtimeSession', 'authority', 'timestamp']) {
  it(`rejects unwanted ${field} data`, () => {
    expect(() => captureWorkspaceRemnantBinding({ ...remnantTestBinding(), [field]: 'not-allowed' })).toThrow();
  });
}

it('rejects accessor properties without executing them', () => {
  let reads = 0;
  const value = { ...remnantTestBinding() };
  Object.defineProperty(value, 'owner', { get() { reads++; return 'workspaceReplacement'; }, enumerable: true });
  expect(() => captureWorkspaceRemnantBinding(value)).toThrow();
  const key = { operationId: id(1) };
  Object.defineProperty(key, 'owner', { get() { reads++; return 'workspaceReplacement'; }, enumerable: true });
  expect(() => captureWorkspaceRemnantBindingKey(key)).toThrow();
  expect(reads).toBe(0);
});

it('uses the existing inspection UUID range without relaxing other owner identifiers', () => {
  const operationId = id(1).replace('-4000-', '-1000-');
  const value = captureWorkspaceRemnantBinding({ ...remnantTestBinding('profileInspection'), operationId });
  expect(value.operationId).toBe(operationId);
  expect(() => captureWorkspaceRemnantBinding({ ...remnantTestBinding(), operationId })).toThrow();
});

for (const invalid of ['badUtf8', 'bom', 'duplicate', 'missingLf', 'truncated', 'oversized'] as const) {
  it(`rejects ${invalid} byte input`, () => {
    const bytes = serializeWorkspaceRemnantBinding(remnantTestBinding());
    const changed = invalid === 'badUtf8' ? Buffer.from([0xff, 10])
      : invalid === 'bom' ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes])
      : invalid === 'duplicate' ? Buffer.from(bytes.toString().replace('"formatVersion":1', '"formatVersion":1,"formatVersion":1'))
      : invalid === 'missingLf' ? bytes.subarray(0, -1)
      : invalid === 'truncated' ? bytes.subarray(0, 30)
      : Buffer.concat([bytes.subarray(0, -1), Buffer.alloc(maximumWorkspaceRemnantBindingBytes, 32), Buffer.from('\n')]);
    expect(() => parseWorkspaceRemnantBinding(changed)).toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  });
}

it('accepts the precise byte boundary but not an extra byte, without growing the canonical record', () => {
  const value = remnantTestBinding();
  const bytes = serializeWorkspaceRemnantBinding(value);
  const maximum = Buffer.concat([bytes.subarray(0, -1), Buffer.alloc(maximumWorkspaceRemnantBindingBytes - bytes.length, 32), Buffer.from('\n')]);
  expect(maximum).toHaveLength(maximumWorkspaceRemnantBindingBytes);
  expect(parseWorkspaceRemnantBinding(maximum)).toEqual(value);
  expect(() => parseWorkspaceRemnantBinding(Buffer.concat([Buffer.from(' '), maximum]))).toThrow();
});

it('rejects unexpected address keys and traversal rather than deriving paths from them', () => {
  const key = workspaceRemnantBindingKey(remnantTestBinding());
  for (const value of [{ ...key, operationId: '../other' }, { ...key, workspaceId: id(2) },
    { owner: 'workspaceLegacyAdoption', operationId: id(1) }, { owner: 'profileInspection', operationId: id(1) }]) {
    expect(() => createWorkspaceRemnantBindingPaths(join(tmpdir(), 'synthetic-installation'), value)).toThrow();
  }
  expect(() => createWorkspaceRemnantBindingPaths('relative-root', key)).toThrow();
});
