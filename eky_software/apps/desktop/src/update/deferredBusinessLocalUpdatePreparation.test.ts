import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';

import type { ReadOnlyJournalSlots } from '../workspaces/persistence/readOnlyJournalSlots.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../workspaces/registry/workspaceRegistryStore.js';
import { createBusinessAcceptedBuildMetadata, createSelectorAcceptedBuildMetadata, type VersionedAcceptedBuildMetadata } from './acceptedBuildMetadata.js';
import { AcceptedBuildMetadataStore, acceptedBuildMetadataFileName } from './acceptedBuildMetadataStore.js';
import { prepareDeferredBusinessLocalUpdateState, type DeferredBusinessLocalUpdatePreparation, type DeferredBusinessLocalUpdateState } from './deferredBusinessLocalUpdateState.js';

const at = '2026-10-26T12:00:00.000Z';
const source = { formatVersion: 1 as const, releaseChannel: 'pilot' as const,
  appVersion: '0.2.0', buildRevision: 'a'.repeat(40), acceptedAt: at };
const target = { ...source, appVersion: '0.3.0', buildRevision: 'b'.repeat(40) };
const selector = createSelectorAcceptedBuildMetadata(source, target);
const business = createBusinessAcceptedBuildMetadata(selector, target);
const empty = <T>(): ReadOnlyJournalSlots<T> => ({ current: undefined, next: undefined, backup: undefined });
const encode = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`);
type Values = Partial<Record<'current' | 'next' | 'backup', VersionedAcceptedBuildMetadata>>;

async function fixture(context: TestContext, values: Values = { current: selector, next: business }) {
  const root = await mkdtemp(join(tmpdir(), 'eky-deferred-state-'));
  context.onTestFinished(async ({ task }) => {
    if (task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  const registryPath = join(root, WORKSPACE_REGISTRY_FILE_NAME);
  const registryValue = { formatVersion: 2, activeWorkspaceId: '11111111-1111-4111-8111-111111111111', workspaces: [{
    workspaceId: '11111111-1111-4111-8111-111111111111', workspaceLabel: 'Synthetic company',
    lifecycleState: 'ready', layoutVersion: 1, createdAt: at, lineageIdentity: { formatVersion: 1, profileId: 'c'.repeat(64) },
  }] };
  await writeFile(registryPath, encode(registryValue));
  const registryStore = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPath });
  const metadataPath = join(root, acceptedBuildMetadataFileName);
  const paths = { current: metadataPath, next: `${metadataPath}.next`, backup: `${metadataPath}.backup` };
  for (const slot of ['current', 'next', 'backup'] as const) {
    if (values[slot] !== undefined) await writeFile(paths[slot], encode(values[slot]));
  }
  const metadataStore = new AcceptedBuildMetadataStore(metadataPath);
  const repairingRead = vi.spyOn(metadataStore, 'read').mockRejectedValue(new Error('SYNTHETIC_REPAIR_FORBIDDEN'));
  const externalRead = vi.fn(async (): Promise<Omit<DeferredBusinessLocalUpdateState, 'metadata'>> => ({
    registry: await registryStore.inspectSlots(), legacyMetadata: empty(), updateJournal: empty(),
    legacyUpdateJournal: empty(), directSetupRecovery: empty(), switchJournal: empty(), firstStartJournal: empty(),
    runningBuild: target,
  }));
  const input: DeferredBusinessLocalUpdatePreparation = {
    metadataStore, inspectExternalState: externalRead, assertAuthority: vi.fn(),
  };
  return { root, registryPath, registryValue, paths, metadataStore, repairingRead, externalRead, input };
}

it.for([
  { current: selector }, { current: selector, next: business },
  { backup: selector, next: business }, { current: business, backup: selector },
])('prepares the admitted joint state %# without calling legacy repairing readers', async (values, context) => {
  const f = await fixture(context, values);
  const result = await prepareDeferredBusinessLocalUpdateState(f.input);
  expect(result.metadataSlot).toBe('current');
  expect(result.metadata).toEqual(values.current ?? selector);
  expect(result.businessAccepted).toBe(values.current === business);
  const stored = await f.metadataStore.inspectSlots();
  expect(stored.current?.value).toEqual(result.metadata);
  expect(stored.next).toBeUndefined();
  expect(stored.backup).toBeUndefined();
  expect(f.repairingRead).not.toHaveBeenCalled();
  expect(await readFile(f.registryPath)).toEqual(encode(f.registryValue));
});

it.for(['differentBytes', 'sameBytesNewIdentity', 'newRecovery', 'expiredAuthority'] as const)(
  'preserves metadata when external %s changes during preparation', async (fault, context) => {
    const f = await fixture(context);
    const before = await f.metadataStore.inspectSlots();
    let current = true;
    f.input.assertAuthority = () => { if (!current) throw new Error('SYNTHETIC_LOSS'); };
    const original = f.externalRead.getMockImplementation()!;
    let calls = 0;
    f.externalRead.mockImplementation(async () => {
      if (++calls === 2) {
        if (fault === 'differentBytes') await writeFile(f.registryPath, encode({ ...f.registryValue, activeWorkspaceId: null }));
        if (fault === 'sameBytesNewIdentity') {
          await rename(f.registryPath, `${f.registryPath}.retained`);
          await writeFile(f.registryPath, encode(f.registryValue));
        }
        if (fault === 'expiredAuthority') current = false;
      }
      const result = await original();
      return fault === 'newRecovery' && calls >= 2 ? { ...result,
        directSetupRecovery: { ...empty(), current: { bytes: encode({ synthetic: true }), value: { synthetic: true } } },
      } : result;
    });
    await expect(prepareDeferredBusinessLocalUpdateState(f.input)).rejects.toThrow();
    expect(await f.metadataStore.inspectSlots()).toEqual(before);
  },
);

it('rejects a different expected build before recovering metadata', async context => {
  const f = await fixture(context);
  const before = await f.metadataStore.inspectSlots();
  const original = f.externalRead.getMockImplementation()!;
  f.externalRead.mockImplementation(async () => ({ ...await original(), runningBuild: source }));
  await expect(prepareDeferredBusinessLocalUpdateState(f.input)).rejects.toThrow();
  expect(await f.metadataStore.inspectSlots()).toEqual(before);
});

it.for([false, true])('requires external identity even with same-byte replacement=%s', async (replace, context) => {
  const f = await fixture(context);
  const before = await f.metadataStore.inspectSlots();
  const original = f.externalRead.getMockImplementation()!;
  f.externalRead.mockImplementation(async () => {
    if (replace && f.externalRead.mock.calls.length === 2) {
      await rename(f.registryPath, `${f.registryPath}.retained`);
      await writeFile(f.registryPath, encode(f.registryValue));
    }
    const result = await original();
    const current = result.registry.current!;
    return { ...result, registry: { ...result.registry, current: { bytes: current.bytes, value: current.value } } };
  });
  await expect(prepareDeferredBusinessLocalUpdateState(f.input)).rejects.toThrow();
  expect(await f.metadataStore.inspectSlots()).toEqual(before);
});

it('does not adopt a same-byte metadata replacement after recovery acknowledgment', async context => {
  const f = await fixture(context);
  const recover = f.metadataStore.recoverSelected.bind(f.metadataStore);
  vi.spyOn(f.metadataStore, 'recoverSelected').mockImplementation(async selection => {
    const identity = await recover(selection);
    const bytes = await readFile(f.paths.current);
    await rename(f.paths.current, `${f.paths.current}.retained`);
    await writeFile(f.paths.current, bytes);
    return identity;
  });
  await expect(prepareDeferredBusinessLocalUpdateState(f.input)).rejects.toThrow();
  expect(await readFile(f.paths.current)).toEqual(encode(selector));
  expect(await readFile(`${f.paths.current}.retained`)).toEqual(encode(selector));
});

it('does not substitute a caller guard while its initial read is pending', async context => {
  const f = await fixture(context);
  const before = await f.metadataStore.inspectSlots();
  let valid = true;
  f.input.assertAuthority = () => { if (!valid) throw new Error('SYNTHETIC_LOSS'); };
  const original = f.externalRead.getMockImplementation()!;
  f.externalRead.mockImplementation(async () => {
    const result = await original();
    valid = false;
    f.input.assertAuthority = () => {};
    return result;
  });
  await expect(prepareDeferredBusinessLocalUpdateState(f.input)).rejects.toThrow();
  expect(await f.metadataStore.inspectSlots()).toEqual(before);
});

it('resumes the actual metadata-only backup after interrupted cleanup with fresh authority', async context => {
  const f = await fixture(context, { backup: selector, next: business });
  const original = f.externalRead.getMockImplementation()!;
  f.externalRead.mockImplementation(async () => {
    // Read the synthetic cut condition without re-entering the busy store.
    try { await readFile(f.paths.next); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new Error('SYNTHETIC_LOSS');
      throw error;
    }
    return original();
  });
  await expect(prepareDeferredBusinessLocalUpdateState(f.input)).rejects.toThrow();
  expect((await f.metadataStore.inspectSlots()).backup?.value).toEqual(selector);
  f.externalRead.mockImplementation(original);
  expect((await prepareDeferredBusinessLocalUpdateState(f.input)).metadata).toEqual(selector);
  expect((await f.metadataStore.inspectSlots()).backup).toBeUndefined();
});
