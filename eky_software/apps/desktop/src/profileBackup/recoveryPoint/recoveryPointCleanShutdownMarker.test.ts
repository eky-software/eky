import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  recoveryPointCleanShutdownMarkerFileName,
  RecoveryPointCleanShutdownMarker,
} from './recoveryPointCleanShutdownMarker.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('recovery point clean shutdown marker', () => {
  it('marks and consumes one controlled shutdown', async () => {
    const fixture = await createFixture();
    await fixture.marker.markClean('2026-08-04T12:00:00.000Z');

    await expect(fixture.marker.consume()).resolves.toBe('clean');
    await expect(fixture.marker.consume()).resolves.toBe('unclean');
  });

  it('treats malformed and unknown fields as an unclean shutdown', async () => {
    const fixture = await createFixture();
    await writeFile(
      fixture.filePath,
      JSON.stringify({
        completedAt: '2026-08-04T12:00:00.000Z',
        formatVersion: 1,
        unknown: true,
      }),
    );

    await expect(fixture.marker.consume()).resolves.toBe('unclean');
  });

  it('recovers a valid backup slot before consuming it', async () => {
    const fixture = await createFixture();
    await writeFile(
      `${fixture.filePath}.backup`,
      JSON.stringify({
        completedAt: '2026-08-04T12:00:00.000Z',
        formatVersion: 1,
      }),
    );

    await expect(fixture.marker.consume()).resolves.toBe('clean');
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-recovery-shutdown-'));
  roots.push(root);
  await mkdir(root, { mode: 0o700, recursive: true });
  const filePath = join(
    root,
    recoveryPointCleanShutdownMarkerFileName,
  );
  return {
    filePath,
    marker: new RecoveryPointCleanShutdownMarker(filePath),
  };
}
