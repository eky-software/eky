import { mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  acquireWorkspaceProcessReservation,
  readWorkspaceProcessReservationIdentity,
  type WorkspaceProcessReservation,
} from './workspaceProcessReservation.js';

describe.skipIf(process.platform !== 'win32' && process.platform !== 'linux')('real workspace IPC reservation', () => {
  let root: string;
  let owners: WorkspaceProcessReservation[];
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'eky-reservation-')));
    owners = [];
  });
  afterEach(async () => {
    const results = await Promise.allSettled(owners.map((owner) => owner.release()));
    // Do not remove evidence or a root whose reservation release is uncertain.
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    await rm(root, { recursive: true });
  });
  const acquire = async (userDataRoot = root, expectedIdentity?: string) => {
    const owner = await acquireWorkspaceProcessReservation({
      userDataRoot, signal: new AbortController().signal,
      ...(expectedIdentity === undefined ? {} : { expectedIdentity }),
    });
    owners.push(owner);
    return owner;
  };

  it('excludes a second owner through an alias, then permits a new owner after release', async () => {
    const first = await acquire();
    const alias = process.platform === 'win32' ? root.toUpperCase() : `${root}/.`;
    await expect(acquire(alias, first.identity)).rejects.toMatchObject({ reason: 'busy' });
    await first.assertOwned();
    expect(first.invalidated.aborted).toBe(false);
    await first.release();
    const second = await acquire(root, first.identity);
    expect(second.identity).toBe(first.identity);
    await second.assertOwned();
    await expect(first.assertOwned()).rejects.toMatchObject({ reason: 'released' });
  });

  it('keeps separate roots independent and rejects a different expected identity', async () => {
    const otherRoot = join(root, 'other');
    await mkdir(otherRoot);
    const first = await acquire();
    const other = await acquire(otherRoot);
    expect(first.identity).not.toBe(other.identity);
    await expect(acquire(root, other.identity)).rejects.toMatchObject({ reason: 'identityChanged' });
    await first.assertOwned();
    await other.assertOwned();
  });

  it('does not create a missing root or persistent reservation files', async () => {
    await expect(acquire(join(root, 'missing'))).rejects.toMatchObject({ reason: 'rootUnavailable' });
    expect(await readWorkspaceProcessReservationIdentity(root)).toMatch(/^[a-f0-9]{64}$/);
    const owner = await acquire();
    expect(await readdir(root)).toEqual([]);
    await owner.release();
    expect(await readdir(root)).toEqual([]);
  });
});
