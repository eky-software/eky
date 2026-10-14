import { mkdtemp, mkdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDesktopProfilePaths } from './desktopProfilePaths.js';
import {
  captureOwnedLocalDatabaseRecoverySelection,
  createOwnedLocalDatabaseRecovery,
  parseOwnedLocalDatabaseRecoverySelection,
} from './ownedLocalDatabaseRecovery.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('owned local database recovery authority', () => {
  it('checks the current reservation and the selected real workspace root on every assertion', async () => {
    const fixture = await createFixture();
    const assertOwned = vi.fn(async () => {});
    const authority = createOwnedLocalDatabaseRecovery({ ...fixture, assertOwned });
    await authority.assertOwnedDatabase(fixture.databaseFilePath);
    await authority.assertOwnedDatabase(fixture.databaseFilePath);
    expect(assertOwned).toHaveBeenCalledTimes(4);
    expect(Object.isFrozen(authority)).toBe(true);
  });

  it.each(['cancelled', 'lost', 'replacedRoot', 'differentDatabase'] as const)(
    'does not authorize recovery after %s', async scenario => {
      const fixture = await createFixture();
      const controller = new AbortController();
      const assertOwned = vi.fn(async () => {
        if (scenario === 'lost') throw new Error('synthetic ownership lost');
      });
      const authority = createOwnedLocalDatabaseRecovery({ ...fixture, assertOwned, signal: controller.signal });
      if (scenario === 'cancelled') controller.abort();
      if (scenario === 'replacedRoot') {
        await rename(fixture.selection.workspaceRoot, fixture.selection.workspaceRoot + '.retained');
        await mkdir(fixture.selection.workspaceRoot);
      }
      const path = scenario === 'differentDatabase'
        ? join(fixture.reservationRoot, 'staging', 'profile.sqlite') : fixture.databaseFilePath;
      await expect(authority.assertOwnedDatabase(path)).rejects.toThrow();
    },
  );

  it('rejects a selection outside the reserved installation and a mismatched database', async () => {
    const fixture = await createFixture();
    expect(() => createOwnedLocalDatabaseRecovery({ ...fixture,
      reservationRoot: join(fixture.reservationRoot, 'another-root'), assertOwned: async () => {},
    })).toThrow('LOCAL_DATABASE_RECOVERY_FAILED');
    expect(() => createOwnedLocalDatabaseRecovery({ ...fixture,
      databaseFilePath: join(fixture.selection.workspaceRoot, 'imported.sqlite'), assertOwned: async () => {},
    })).toThrow('LOCAL_DATABASE_RECOVERY_FAILED');
  });

  it('accepts only two immutable private data fields, not accessors or additional authority', () => {
    const selection = { workspaceIdentity: 'a'.repeat(64), workspaceRoot: resolve('synthetic-workspace') };
    const parsed = parseOwnedLocalDatabaseRecoverySelection(selection);
    expect(parsed).toEqual(selection);
    expect(parsed).not.toBe(selection);
    expect(Object.isFrozen(parsed)).toBe(true);
    for (const value of [undefined, null, [], {}, true, Object.create(selection),
      { ...selection, granted: true }, { ...selection, workspaceIdentity: 'a'.repeat(63) },
      { ...selection, workspaceRoot: '../relative' }]) {
      expect(parseOwnedLocalDatabaseRecoverySelection(value)).toBeUndefined();
    }
    const getter = vi.fn(() => selection.workspaceRoot);
    const accessor = { workspaceIdentity: selection.workspaceIdentity };
    Object.defineProperty(accessor, 'workspaceRoot', { enumerable: true, get: getter });
    expect(parseOwnedLocalDatabaseRecoverySelection(accessor)).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
  });
});

async function createFixture() {
  const reservationRoot = await mkdtemp(join(tmpdir(), 'eky-recovery-authority-'));
  roots.push(reservationRoot);
  const workspaceRoot = join(reservationRoot, 'workspaces', '11111111-1111-4111-8111-111111111111');
  await mkdir(workspaceRoot, { recursive: true });
  return {
    databaseFilePath: createDesktopProfilePaths(workspaceRoot).databaseFilePath,
    reservationRoot,
    selection: await captureOwnedLocalDatabaseRecoverySelection(workspaceRoot),
    signal: new AbortController().signal,
  };
}
