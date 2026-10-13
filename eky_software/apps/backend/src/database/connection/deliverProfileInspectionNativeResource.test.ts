import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import * as fileSystem from 'node:fs/promises';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { deliverProfileInspectionNativeResource } from './deliverProfileInspectionNativeResource.js';
import { profileInspectionNativeContract as contract } from './profileInspectionNativeContract.js';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});

const roots: string[] = [];
afterEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(fileSystem.open).mockReset().mockImplementation(actual.open);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-native-delivery-'));
  roots.push(root);
  const source = join(root, 'source');
  const target = join(root, contract.directoryName);
  await mkdir(source);
  const bytes = Buffer.alloc(contract.minimumNativeBytes, 1);
  const metadata = {
    schemaVersion: contract.schemaVersion, purpose: contract.purpose,
    packageVersion: contract.packageVersion, addonApiVersion: contract.addonApiVersion,
    sourceIntegrity: contract.sourceIntegrity, addonApiIntegrity: contract.addonApiIntegrity,
    patchIdentity: contract.patchIdentity, sourceIdentity: 'a'.repeat(64),
    patchedSourceIdentity: 'b'.repeat(64), platform: process.platform, arch: process.arch,
    nodeVersion: contract.nodeVersion, nodeGypVersion: contract.nodeGypVersion,
    napiVersion: contract.napiVersion, sqliteSourceId: `2026-01-01 00:00:00 ${'c'.repeat(64)}`,
    compileOptions: ['THREADSAFE=2'], nativeSize: bytes.length,
    nativeSha256: createHash('sha256').update(bytes).digest('hex'),
  };
  await writeFile(join(source, contract.fileName), bytes);
  await writeFile(join(source, contract.metadataFileName), JSON.stringify(metadata));
  return { root, source, target, bytes, metadata };
}

describe('inspection native delivery', () => {
  it('copies only attested independent bytes and leaves the original unchanged', async () => {
    const { source, target, bytes, metadata } = await fixture();
    const delivered = await deliverProfileInspectionNativeResource(source, target);
    expect(delivered.metadata).toEqual(metadata);
    expect((await readdir(target)).sort()).toEqual([contract.fileName, contract.metadataFileName].sort());
    for (const name of [contract.fileName, contract.metadataFileName]) {
      expect(await readFile(join(target, name))).toEqual(await readFile(join(source, name)));
      expect((await lstat(join(target, name))).nlink).toBe(1);
      expect((await lstat(join(source, name))).nlink).toBe(1);
    }
    await writeFile(join(target, contract.fileName), Buffer.alloc(bytes.length, 2));
    expect(await readFile(join(source, contract.fileName))).toEqual(bytes);
  });

  it.each(['source', 'existing target', 'nested target', 'target platform'])('rejects %s without overwriting or deleting the source', async variant => {
    const { source, target, bytes } = await fixture();
    let destination = target;
    let platform = process.platform;
    if (variant === 'source') await writeFile(join(source, 'unapproved.log'), 'not delivered');
    if (variant === 'existing target') await mkdir(target);
    if (variant === 'nested target') destination = join(source, 'nested');
    if (variant === 'target platform') platform = process.platform === 'win32' ? 'linux' : 'win32';
    await expect(deliverProfileInspectionNativeResource(source, destination, { platform, arch: process.arch }))
      .rejects.toThrow(/^PROFILE_INSPECTION_NATIVE_DELIVERY_INVALID$/);
    expect(await readFile(join(source, contract.fileName))).toEqual(bytes);
    if (variant === 'existing target') expect(await readdir(target)).toEqual([]);
    else await expect(lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a redirected destination parent before creating delivery files', async () => {
    const { root, source } = await fixture();
    const outside = join(root, 'outside');
    const linked = join(root, 'linked');
    await mkdir(outside);
    await symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(deliverProfileInspectionNativeResource(source, join(linked, contract.directoryName)))
      .rejects.toThrow(/^PROFILE_INSPECTION_NATIVE_DELIVERY_INVALID$/);
    expect(await readdir(outside)).toEqual([]);
  });

  it('copies at most the attested size when the source grows after opening', async () => {
    const { source, target, bytes } = await fixture();
    const nativePath = join(source, contract.fileName);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    let sourceOpens = 0;
    let grew = false;
    vi.mocked(fileSystem.open).mockImplementation(async (...args) => {
      const handle = await actual.open(...args);
      if (args[0] === nativePath && ++sourceOpens === 2) {
        const read = handle.read.bind(handle);
        handle.read = async (...readArgs: Parameters<typeof read>) => {
          if (!grew) {
            grew = true;
            appendFileSync(nativePath, Buffer.alloc(bytes.length, 2));
          }
          return read(...readArgs);
        };
      }
      return handle;
    });
    await expect(deliverProfileInspectionNativeResource(source, target))
      .rejects.toThrow(/^PROFILE_INSPECTION_NATIVE_DELIVERY_INVALID$/);
    expect(grew).toBe(true);
    expect((await lstat(join(target, contract.fileName))).size).toBe(bytes.length);
    expect((await lstat(nativePath)).size).toBe(2 * bytes.length);
    expect(await readFile(join(target, contract.fileName))).toEqual(bytes);
  });
});
