import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import {
  InvoicePdfArchiveConfigStore,
  parseInvoicePdfArchiveConfig,
} from './invoicePdfArchiveConfig.js';
import { createInvoicePdfArchiveRuntimePaths } from './invoicePdfArchivePaths.js';
import { InvoicePdfArchiveError } from './invoicePdfArchiveTypes.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('InvoicePdfArchiveConfigStore', () => {
  it('writes and reads the exact versioned config for an existing directory', async () => {
    const root = await createTemporaryRoot();
    const target = join(root, 'archive target');
    await mkdir(target);
    const paths = createInvoicePdfArchiveRuntimePaths(root);
    const store = new InvoicePdfArchiveConfigStore(paths.configFilePath);

    await expect(store.enable(target)).resolves.toEqual({
      directoryPath: target,
      enabled: true,
      schemaVersion: 1,
    });
    await expect(store.read()).resolves.toEqual({
      directoryPath: target,
      enabled: true,
      schemaVersion: 1,
    });
    await expect(store.readDisplayName()).resolves.toBe('archive target');

    const persisted = JSON.parse(
      await readFile(paths.configFilePath, 'utf8'),
    ) as unknown;
    expect(persisted).toEqual({
      directoryPath: target,
      enabled: true,
      schemaVersion: 1,
    });
  });

  it('rejects unknown fields and relative paths', () => {
    expect(() =>
      parseInvoicePdfArchiveConfig({
        directoryPath: 'relative',
        enabled: true,
        schemaVersion: 1,
      }),
    ).toThrowError(InvoicePdfArchiveError);
    expect(() =>
      parseInvoicePdfArchiveConfig({
        directoryPath: '/tmp/archive',
        enabled: true,
        extra: true,
        schemaVersion: 1,
      }),
    ).toThrowError(InvoicePdfArchiveError);
  });

  it('fails closed when the selected directory disappears', async () => {
    const root = await createTemporaryRoot();
    const target = join(root, 'archive');
    await mkdir(target);
    const store = new InvoicePdfArchiveConfigStore(
      createInvoicePdfArchiveRuntimePaths(root).configFilePath,
    );
    await store.enable(target);
    await rm(target, { recursive: true });

    await expect(store.read()).rejects.toMatchObject({
      code: 'ARCHIVE_DIRECTORY_UNAVAILABLE',
    });
  });

  it('restores a valid backup after an interrupted atomic replacement', async () => {
    const root = await createTemporaryRoot();
    const target = join(root, 'archive');
    await mkdir(target);
    const configPath =
      createInvoicePdfArchiveRuntimePaths(root).configFilePath;
    await mkdir(join(root, 'settings'));
    await writeFile(
      `${configPath}.backup`,
      JSON.stringify({
        directoryPath: target,
        enabled: true,
        schemaVersion: 1,
      }),
      'utf8',
    );
    const store = new InvoicePdfArchiveConfigStore(configPath);

    await expect(store.read()).resolves.toMatchObject({
      directoryPath: target,
    });
    await expect(
      readFile(configPath, 'utf8').then(
        (contents) =>
          (JSON.parse(contents) as { directoryPath: string }).directoryPath,
      ),
    ).resolves.toBe(target);
  });

  it('does not replace a corrupt current config with recovery data', async () => {
    const root = await createTemporaryRoot();
    const target = join(root, 'archive');
    await mkdir(target);
    const configPath =
      createInvoicePdfArchiveRuntimePaths(root).configFilePath;
    await mkdir(join(root, 'settings'));
    await writeFile(configPath, '{broken', 'utf8');
    await writeFile(
      `${configPath}.backup`,
      JSON.stringify({
        directoryPath: target,
        enabled: true,
        schemaVersion: 1,
      }),
      'utf8',
    );

    await expect(
      new InvoicePdfArchiveConfigStore(configPath).read(),
    ).rejects.toMatchObject({ code: 'ARCHIVE_CONFIG_INVALID' });
    await expect(readFile(configPath, 'utf8')).resolves.toBe('{broken');
  });

  it('removes current and recovery slots when disabled', async () => {
    const root = await createTemporaryRoot();
    const target = join(root, 'archive');
    await mkdir(target);
    const configPath =
      createInvoicePdfArchiveRuntimePaths(root).configFilePath;
    const store = new InvoicePdfArchiveConfigStore(configPath);
    await store.enable(target);
    await writeFile(`${configPath}.next`, 'stale', 'utf8');
    await writeFile(`${configPath}.backup`, 'stale', 'utf8');

    await expect(store.disable()).resolves.toBeUndefined();
    await expect(readFile(configPath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(`${configPath}.next`, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      readFile(`${configPath}.backup`, 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-archive-config-'));
  temporaryRoots.push(root);
  return root;
}
