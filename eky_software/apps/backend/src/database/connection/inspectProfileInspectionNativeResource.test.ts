import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import * as fileSystem from 'node:fs/promises';
import { link, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { inspectProfileInspectionNativeResource } from './inspectProfileInspectionNativeResource.js';
import { parseProfileInspectionNativeMetadata, profileInspectionNativeContract as contract } from './profileInspectionNativeContract.js';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});

const roots: string[] = [];
afterEach(async () => {
  vi.mocked(fileSystem.open).mockReset();
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(fileSystem.open).mockImplementation(actual.open);
  for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true });
});

function metadata(bytes: Buffer) {
  return {
    schemaVersion: 1, purpose: contract.purpose, packageVersion: contract.packageVersion,
    addonApiVersion: contract.addonApiVersion, sourceIntegrity: contract.sourceIntegrity,
    addonApiIntegrity: contract.addonApiIntegrity, patchIdentity: contract.patchIdentity,
    sourceIdentity: 'a'.repeat(64), patchedSourceIdentity: 'b'.repeat(64),
    platform: process.platform, arch: process.arch, nodeVersion: contract.nodeVersion,
    nodeGypVersion: contract.nodeGypVersion, napiVersion: contract.napiVersion,
    sqliteSourceId: `2026-01-01 00:00:00 ${'c'.repeat(64)}`,
    compileOptions: ['THREADSAFE=2'], nativeSize: bytes.length,
    nativeSha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-inspection-native-'));
  roots.push(root);
  const native = Buffer.alloc(contract.minimumNativeBytes, 1);
  await writeFile(join(root, contract.fileName), native);
  await writeFile(join(root, contract.metadataFileName), JSON.stringify(metadata(native)));
  return { root, native, value: metadata(native) };
}

describe('inspection-only native resource', () => {
  it('binds exact target, bounded provenance and independent file bytes', async () => {
    const { root, value } = await fixture();
    const resource = await inspectProfileInspectionNativeResource(root);
    expect(resource.nativeBinding).toBe(join(root, contract.fileName));
    expect(resource.metadata).toEqual(value);
    expect(Object.isFrozen(resource.metadata.compileOptions)).toBe(true);
  });

  it.each([
    ['missing binding', async (root: string) => rm(join(root, contract.fileName))],
    ['changed bytes', async (root: string) => writeFile(join(root, contract.fileName), Buffer.alloc(contract.minimumNativeBytes, 2))],
    ['unreviewed file', async (root: string) => writeFile(join(root, 'private.log'), 'not shipped')],
    ['linked binding', async (root: string) => {
      const linkedRoot = await mkdtemp(join(tmpdir(), 'eky-inspection-native-linked-'));
      roots.push(linkedRoot);
      await link(join(root, contract.fileName), join(linkedRoot, 'linked.node'));
    }],
    ['oversize metadata', async (root: string) => writeFile(join(root, contract.metadataFileName), Buffer.alloc(contract.maximumMetadataBytes + 1))],
  ])('rejects %s without default-binding fallback', async (_name, corrupt) => {
    const { root } = await fixture();
    await corrupt(root);
    await expect(inspectProfileInspectionNativeResource(root)).rejects.toThrow(/^PROFILE_INSPECTION_PROTOCOL_INVALID$/);
  });

  it.each([
    { platform: 'unapproved' }, { arch: 'arm64' }, { packageVersion: '13.0.1' },
    { sourceIntegrity: 'unverified' }, { patchIdentity: 'other' },
    { compileOptions: ['DEFAULT_MEMSTATUS=0'] }, { nativeSha256: 'a' },
    { sourceIdentity: 'b'.repeat(64) }, { nativeSize: 1 }, { command: 'forbidden' },
  ])('rejects altered metadata %j', async change => {
    const { root, value } = await fixture();
    await writeFile(join(root, contract.metadataFileName), JSON.stringify({ ...value, ...change }));
    await expect(inspectProfileInspectionNativeResource(root)).rejects.toThrow(/^PROFILE_INSPECTION_PROTOCOL_INVALID$/);
  });

  it('rejects target mismatch even when resource bytes still match', async () => {
    const { root } = await fixture();
    await expect(inspectProfileInspectionNativeResource(root, { platform: process.platform, arch: 'arm64' }))
      .rejects.toThrow(/^PROFILE_INSPECTION_PROTOCOL_INVALID$/);
  });

  it('bounds the native read to the opened size and rejects growth before acceptance', async () => {
    const { root, native } = await fixture();
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    let observedBytes = 0;
    let streamEnd: number | undefined;
    vi.mocked(fileSystem.open).mockImplementation(async (...args) => {
      const handle = await actual.open(...args);
      if (args[0] === join(root, contract.fileName)) {
        const createStream = handle.createReadStream.bind(handle);
        handle.createReadStream = options => {
          appendFileSync(join(root, contract.fileName), Buffer.alloc(native.length));
          streamEnd = options?.end;
          const stream = createStream(options);
          stream.on('data', bytes => { observedBytes += bytes.length; });
          return stream;
        };
      }
      return handle;
    });
    await expect(inspectProfileInspectionNativeResource(root))
      .rejects.toThrow(/^PROFILE_INSPECTION_PROTOCOL_INVALID$/);
    expect(streamEnd).toBe(native.length - 1);
    expect(observedBytes).toBe(native.length);
  });

  it('rejects a relative resource root and unbounded metadata fields', async () => {
    await expect(inspectProfileInspectionNativeResource('relative')).rejects.toThrow(/^PROFILE_INSPECTION_PROTOCOL_INVALID$/);
    const { root, value } = await fixture();
    expect(() => parseProfileInspectionNativeMetadata({ ...value, compileOptions: ['DEFAULT_MEMSTATUS=1', 'x'.repeat(129)] },
      { platform: process.platform, arch: process.arch })).toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
    expect(JSON.parse(await readFile(join(root, contract.metadataFileName), 'utf8'))).toEqual(value);
  });
});
