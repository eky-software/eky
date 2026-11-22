import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

import { acceptedBuildMetadataFileName, AcceptedBuildMetadataStore } from '../update/acceptedBuildMetadataStore.js';
import { WorkspaceRegistryStore } from '../workspaces/registry/workspaceRegistryStore.js';
import { createWorkspaceRegistryPaths, WORKSPACE_REGISTRY_FILE_NAME } from '../workspaces/registry/workspaceRegistryPaths.js';
import { validateWorkspaceId } from '../workspaces/registry/workspaceIdValidation.js';
import { hasReadOnlyJournalSideSlots } from '../workspaces/persistence/readOnlyJournalSlots.js';
import { needsAcceptedWorkspaceRegistryPromotion, promoteAcceptedWorkspaceRegistry } from './desktopAcceptedWorkspaceRegistry.js';

const roots: string[] = [];
const current = { appVersion: '0.3.0', buildRevision: 'a'.repeat(40) };
const accepted = { ...current, formatVersion: 1, releaseChannel: 'pilot', acceptedAt: '2026-11-20T00:00:00.000Z' } as const;
const oldBuild = { ...accepted, appVersion: '0.2.81', buildRevision: 'b'.repeat(40) };
const activeWorkspaceId = validateWorkspaceId('11111111-1111-4111-8111-111111111111');
const source = { formatVersion: 1, activeWorkspaceId, workspaces: [{
  workspaceId: activeWorkspaceId, workspaceLabel: 'Synthetic retained company',
  lineageIdentity: { formatVersion: 1, profileId: 'c'.repeat(64) }, layoutVersion: 1,
  lifecycleState: 'ready', createdAt: accepted.acceptedAt,
}] } as const;

afterEach(async ({ task }) => {
  const completed = roots.splice(0);
  if (task.result?.state === 'pass') await Promise.all(completed.map(root => rm(root, { force: true, recursive: true })));
});

it('publishes a version-only registry change for an exact accepted business build', async () => {
  const fixture = await createFixture();
  const acceptedBytes = await readFile(fixture.metadataPath);

  await promoteAcceptedWorkspaceRegistry(fixture.input);

  const final = await fixture.registry.inspectSlots();
  expect(final.current?.value).toEqual({ ...fixture.source, formatVersion: 2 });
  expect(final.next).toBeUndefined();
  expect(final.backup).toBeUndefined();
  expect(await readFile(fixture.metadataPath)).toEqual(acceptedBytes);
  expect(fixture.input.onUncertain).not.toHaveBeenCalled();
});

it('observes the need for a restart without writing, then only promotes in the cold owner', async () => {
  const fixture = await createFixture();
  const before = await fixture.registry.inspectSlots();
  const write = vi.spyOn(fixture.registry, 'promoteSettledLegacySelection');
  const read = { ...fixture.input, async assertReadOwner() {} };

  await expect(needsAcceptedWorkspaceRegistryPromotion(read)).resolves.toBe(true);
  expect(await fixture.registry.inspectSlots()).toEqual(before);
  expect(write).not.toHaveBeenCalled();
  await promoteAcceptedWorkspaceRegistry(fixture.input);
  await expect(needsAcceptedWorkspaceRegistryPromotion(read)).resolves.toBe(false);
  expect(write).toHaveBeenCalledOnce();
});

it('does not request a restart after losing the live read owner during build observation', async () => {
  const fixture = await createFixture();
  const failure = new Error('synthetic lost startup owner');
  let live = true;
  const before = await fixture.registry.inspectSlots();

  await expect(needsAcceptedWorkspaceRegistryPromotion({ ...fixture.input,
    async assertReadOwner() { if (!live) throw failure; },
    async inspectBuildSelection() {
      const selected = await fixture.input.inspectBuildSelection();
      live = false;
      return selected;
    },
  })).rejects.toBe(failure);
  expect(await fixture.registry.inspectSlots()).toEqual(before);
});

it.each(['hasRegistrySideSlots', 'hasRecoveryConflict'] as const)(
  'does not return a stale negative observation from %s after authority has closed', async rejectedRead => {
    const fixture = await createFixture();
    const before = await fixture.registry.inspectSlots();
    let live = true;
    await expect(needsAcceptedWorkspaceRegistryPromotion({ ...fixture.input,
      assertCurrent() { if (!live) throw new Error('closed startup'); }, async assertReadOwner() {},
      async [rejectedRead]() { live = false; return true; },
    })).rejects.toThrow();
    expect(await fixture.registry.inspectSlots()).toEqual(before);
  },
);

it('leaves a different active workspace to its existing selection owner', async () => {
  const fixture = await createFixture();
  const before = await fixture.registry.inspectSlots();
  const different = { ...fixture.input, activeWorkspaceId: validateWorkspaceId('22222222-2222-4222-8222-222222222222') };

  await expect(needsAcceptedWorkspaceRegistryPromotion({ ...different, async assertReadOwner() {} })).resolves.toBe(false);
  await promoteAcceptedWorkspaceRegistry(different);
  expect(await fixture.registry.inspectSlots()).toEqual(before);
});

it.each(['newerBuild', 'selectorAcceptance', 'foreignJournal'] as const)(
  'keeps the original bytes when the current build is not eligible: %s', async reason => {
    const fixture = await createFixture();
    const before = await fixture.registry.inspectSlots();
    if (reason === 'newerBuild') await fixture.metadata.write(oldBuild);
    else if (reason === 'selectorAcceptance') {
      await fixture.metadata.write({ formatVersion: 2, acceptanceScope: 'selector',
        acceptedBuild: accepted, businessBaseline: oldBuild });
    } else fixture.input.hasRecoveryConflict.mockResolvedValue(true);

    await promoteAcceptedWorkspaceRegistry(fixture.input);

    expect(await fixture.registry.inspectSlots()).toEqual(before);
    expect(fixture.input.onUncertain).not.toHaveBeenCalled();
  },
);

it('refuses a byte-identical replacement of accepted metadata after selection', async () => {
  const fixture = await createFixture();
  const before = await fixture.registry.inspectSlots();
  const verify = fixture.input.inspectBuildSelection;
  const replacement = vi.fn(verify).mockImplementationOnce(async () => {
    const first = await verify();
    const bytes = await readFile(fixture.metadataPath);
    await rename(fixture.metadataPath, `${fixture.metadataPath}.displaced`);
    await writeFile(fixture.metadataPath, bytes, { mode: 0o600, flag: 'wx' });
    return first;
  });

  await expect(promoteAcceptedWorkspaceRegistry({ ...fixture.input, inspectBuildSelection: replacement })).rejects.toThrow();

  expect(await fixture.registry.inspectSlots()).toEqual(before);
  expect(fixture.input.onUncertain).toHaveBeenCalledOnce();
});

it('leaves a torn next slot to its existing recovery owner without parsing it', async () => {
  const fixture = await createFixture();
  const before = await readFile(fixture.paths.currentPath);
  await writeFile(fixture.paths.nextPath, '{', { mode: 0o600, flag: 'wx' });

  await promoteAcceptedWorkspaceRegistry(fixture.input);

  expect(await readFile(fixture.paths.currentPath)).toEqual(before);
  expect(await readFile(fixture.paths.nextPath, 'utf8')).toBe('{');
  expect(fixture.input.onUncertain).not.toHaveBeenCalled();
});

it('does not certify a replacement during the post-publication acceptance read', async () => {
  const fixture = await createFixture();
  const write = fixture.registry.promoteSettledLegacySelection.bind(fixture.registry);
  let published = false;
  vi.spyOn(fixture.registry, 'promoteSettledLegacySelection').mockImplementation(async (...args) => {
    const identity = await write(...args);
    published = true;
    return identity;
  });
  const inspect = fixture.input.inspectBuildSelection;

  await expect(promoteAcceptedWorkspaceRegistry({ ...fixture.input, async inspectBuildSelection() {
    if (published) {
      const bytes = await readFile(fixture.paths.currentPath);
      await rename(fixture.paths.currentPath, `${fixture.paths.currentPath}.displaced`);
      await writeFile(fixture.paths.currentPath, bytes, { mode: 0o600, flag: 'wx' });
    }
    return inspect();
  } })).rejects.toThrow();

  expect(fixture.input.onUncertain).toHaveBeenCalledOnce();
  expect((await fixture.registry.inspectCurrentSlot())?.value).toEqual({ ...source, formatVersion: 2 });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-accepted-workspace-registry-'));
  roots.push(root);
  const metadataPath = join(root, acceptedBuildMetadataFileName);
  const metadata = new AcceptedBuildMetadataStore(metadataPath);
  const paths = createWorkspaceRegistryPaths(root, join(root, WORKSPACE_REGISTRY_FILE_NAME));
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: paths.currentPath });
  await registry.write(source);
  await metadata.write(accepted);
  const noSlots = { current: undefined, next: undefined, backup: undefined };
  return { metadata, metadataPath, paths, registry, source, input: {
    registry, activeWorkspaceId, buildInfo: { ...current, buildCreatedAt: accepted.acceptedAt, buildDirty: false, schemaVersion: 1 as const },
    releaseInfo: { ...current, appIdentity: 'Eky', architecture: 'x64', msiProductVersion: current.appVersion, platform: 'win32',
      releaseChannel: 'pilot', schemaVersion: 1, upgradeCode: '11111111-1111-4111-8111-111111111111' } as const,
    assertCurrent() {}, async assertOwned() {},
    hasRegistrySideSlots: () => hasReadOnlyJournalSideSlots(paths),
    hasRecoveryConflict: vi.fn(async () => false), onUncertain: vi.fn(),
    async inspectBuildSelection() {
      return { metadata: await metadata.inspectSlots(), legacyMetadata: noSlots, updateJournal: noSlots,
        legacyUpdateJournal: noSlots, directSetupRecovery: noSlots, switchJournal: noSlots };
    },
  } };
}
