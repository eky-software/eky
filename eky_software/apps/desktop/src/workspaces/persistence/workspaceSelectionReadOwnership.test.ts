import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorkspaceRegistryPaths } from '../registry/workspaceRegistryPaths.js';
import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import {
  createWorkspaceSwitchJournalPaths, serializeWorkspaceSwitchJournal, WorkspaceSwitchJournalStore,
} from '../switch/workspaceSwitchJournal.js';
import { createSwitchJournal } from '../switch/workspaceSwitchTestSupport.js';

const boundary = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs/promises')>(), open: boundary.open,
}));

const roots: string[] = [];
const slots = ['current', 'next', 'backup'] as const;
const families = ['registry', 'switch'] as const;
const workspaceId = '11111111-1111-4111-8111-111111111111';

beforeEach(async () => {
  const native = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  boundary.open.mockReset().mockImplementation(native.open);
});
afterEach(async context => {
  vi.restoreAllMocks();
  const completed = roots.splice(0);
  if (context.task.result?.state === 'pass') {
    for (const root of completed) await rm(root, { recursive: true, force: true });
  }
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}

async function fixture(family: typeof families[number]) {
  const root = await mkdtemp(join(tmpdir(), 'eky-selection-read-'));
  roots.push(root);
  const registryRoot = join(root, 'workspace-state');
  const registryPath = join(registryRoot, 'workspace-registry-v1.json');
  const paths = family === 'registry'
    ? createWorkspaceRegistryPaths(registryRoot, registryPath)
    : createWorkspaceSwitchJournalPaths(root);
  const store = family === 'registry'
    ? new WorkspaceRegistryStore({ installationRoot: registryRoot, filePath: registryPath })
    : new WorkspaceSwitchJournalStore(root);
  const bytes = family === 'registry'
    ? serializeWorkspaceRegistry({ formatVersion: 2, activeWorkspaceId: null, workspaces: [{
      workspaceId, workspaceLabel: 'Synthetic company', lifecycleState: 'ready', layoutVersion: 1,
      createdAt: '2026-10-29T00:00:00.000Z', lineageIdentity: { formatVersion: 1, profileId: 'a'.repeat(64) },
    }] })
    : serializeWorkspaceSwitchJournal(createSwitchJournal('prepared'));
  await mkdir(dirname(paths.currentPath), { recursive: true });
  for (const slot of slots) await writeFile(paths[`${slot}Path`], bytes);
  return { store, paths, bytes,
    async assertPreserved() {
      for (const slot of slots) expect(await readFile(paths[`${slot}Path`])).toEqual(Buffer.from(bytes));
    },
  };
}

describe.each(families)('%s readonly selection ownership', family => {
  it('rechecks a current synchronous authority and preserves every slot', async () => {
    const f = await fixture(family);
    const authority = vi.fn();
    const result = await f.store.inspectSlots(authority);
    expect(authority.mock.calls.length).toBeGreaterThanOrEqual(7);
    for (const slot of slots) expect(result[slot]?.bytes).toEqual(f.bytes);
    expect(boundary.open).toHaveBeenCalledTimes(3);
    await f.assertPreserved();
  });

  it('rejects lost authority before opening the first slot', async () => {
    const f = await fixture(family);
    await expect(f.store.inspectSlots(() => { throw new Error('synthetic lost owner'); })).rejects.toThrow();
    expect(boundary.open).not.toHaveBeenCalled();
    await f.assertPreserved();
    await expect(f.store.inspectSlots()).resolves.toHaveProperty('backup');
  });

  it('does not treat a malformed null authority as the optional omitted guard', async () => {
    const f = await fixture(family);
    await expect(f.store.inspectSlots(null as unknown as () => void)).rejects.toThrow();
    expect(boundary.open).not.toHaveBeenCalled();
    await f.assertPreserved();
  });

  it.each(['resolvedPromise', 'rejectedPromise', 'number', 'null'] as const)(
    'rejects a non-synchronous guard result: %s', async kind => {
      const f = await fixture(family);
      const authority = () => kind === 'resolvedPromise' ? Promise.resolve()
        : kind === 'rejectedPromise' ? Promise.reject(new Error('synthetic async owner'))
        : kind === 'number' ? 1 : null;
      await expect(f.store.inspectSlots(authority)).rejects.toThrow();
      expect(boundary.open).not.toHaveBeenCalled();
      await f.assertPreserved();
    },
  );

  it.each(slots)('waits for the original %s handle close and forbids the next read after cancellation', async selected => {
    const f = await fixture(family);
    const native = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const closing = gate();
    const finishClose = gate();
    let current = true;
    let fileClosed = false;
    let settled = false;
    boundary.open.mockImplementation(async (...args: Parameters<typeof native.open>) => {
      const file = await native.open(...args);
      if (args[0] === f.paths[`${selected}Path`]) {
        const close = file.close.bind(file);
        vi.spyOn(file, 'close').mockImplementationOnce(async () => {
          closing.resolve();
          await finishClose.promise;
          await close();
          fileClosed = true;
        });
      }
      return file;
    });
    const authority = () => { if (!current) throw new Error('synthetic cancelled selection'); };
    const original = f.store.inspectSlots(authority);
    const result = original.then(() => { settled = true; return 'completed'; }, () => { settled = true; return 'failed'; });
    await closing.promise;
    try {
      current = false;
      await expect(f.store.inspectSlots()).rejects.toThrow();
      expect(settled).toBe(false);
      expect(fileClosed).toBe(false);
    } finally { finishClose.resolve(); }
    expect(await result).toBe('failed');
    expect(fileClosed).toBe(true);
    expect(boundary.open).toHaveBeenCalledTimes(slots.indexOf(selected) + 1);
    await f.assertPreserved();
    // A new caller may inspect; the cancelled original never continues to another slot.
    await expect(f.store.inspectSlots(() => {})).resolves.toHaveProperty('backup');
  });

  it.each([2, 3, 4, 5, 6, 7])('rejects an asynchronous guard at boundary %i without a later slot read or result', async boundaryIndex => {
    const f = await fixture(family);
    let checks = 0;
    await expect(f.store.inspectSlots(() => {
      if (++checks === boundaryIndex) return Promise.reject(new Error('synthetic late async guard'));
    })).rejects.toThrow();
    expect(boundary.open).toHaveBeenCalledTimes(Math.min(3, Math.floor(boundaryIndex / 2)));
    await f.assertPreserved();
  });

  it('does not interpret an absent slot as permission to continue after losing authority', async () => {
    const f = await fixture(family);
    await rm(f.paths.currentPath);
    let checks = 0;
    await expect(f.store.inspectSlots(() => {
      if (++checks === 2) throw new Error('synthetic absent-slot cancellation');
    })).rejects.toThrow();
    expect(boundary.open).not.toHaveBeenCalled();
    for (const slot of ['next', 'backup'] as const) {
      expect(await readFile(f.paths[`${slot}Path`])).toEqual(Buffer.from(f.bytes));
    }
  });
});
