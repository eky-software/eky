import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createUpdateRecoverySupportBundle,
  createUpdateRecoverySupportBundleFilename,
} from './updateRecoverySupportBundle.js';

describe('update recovery support bundle', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it('contains only bounded technical recovery metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eky-update-recovery-'));
    roots.push(root);
    const targetPath = join(root, 'recovery.json.gz');

    await createUpdateRecoverySupportBundle({
      appVersion: '0.1.0-alpha.1',
      architecture: 'x64',
      buildRevision: 'a'.repeat(40),
      createdAt: '2026-08-12T10:20:30.000Z',
      electronVersion: '43.2.0',
      errorCode: 'UPDATE_RECOVERY_REQUIRED',
      platform: 'win32',
      targetPath,
    });

    const compressed = await readFile(targetPath);
    expect([...compressed.subarray(0, 2)]).toEqual([0x1f, 0x8b]);
    const payload = JSON.parse(gunzipSync(compressed).toString('utf8')) as Record<
      string,
      unknown
    >;
    expect(payload).toEqual({
      appVersion: '0.1.0-alpha.1',
      architecture: 'x64',
      buildRevision: 'a'.repeat(40),
      createdAt: '2026-08-12T10:20:30.000Z',
      electronVersion: '43.2.0',
      errorCode: 'UPDATE_RECOVERY_REQUIRED',
      formatVersion: 1,
      platform: 'win32',
    });
    expect(Object.keys(payload)).not.toEqual(
      expect.arrayContaining([
        'companyId',
        'databasePath',
        'journal',
        'manifestPath',
        'profilePath',
      ]),
    );
  });

  it('uses a direct gzip JSON filename without customer data', () => {
    expect(
      createUpdateRecoverySupportBundleFilename(
        new Date('2026-08-12T23:59:59.000Z'),
      ),
    ).toBe('eky-update-recovery-2026-08-12.json.gz');
  });
});
