import { createHash } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, realpath, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import {
  parseProfileInspectionNativeMetadata,
  profileInspectionNativeContract as contract,
  type ProfileInspectionNativeMetadata,
} from './profileInspectionNativeContract.js';

export async function inspectProfileInspectionNativeResource(
  resourceRoot: string,
  target = { platform: process.platform, arch: process.arch },
): Promise<{ nativeBinding: string; metadata: ProfileInspectionNativeMetadata }> {
  try {
    if (!isAbsolute(resourceRoot)) throw new Error();
    const root = resolve(resourceRoot);
    const directories = [];
    for (let path = root; ; path = dirname(path)) {
      const stat = await lstat(path, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink() ||
          relative(path, await realpath(path)) !== '') throw new Error();
      directories.push({ path, stat });
      if (dirname(path) === path) break;
    }
    const names = (await readdir(root)).sort();
    if (names.join('\0') !== [contract.fileName, contract.metadataFileName].sort().join('\0')) {
      throw new Error();
    }
    const bytes = await readBoundedRegularFile(join(root, contract.metadataFileName), contract.maximumMetadataBytes);
    const metadata = parseProfileInspectionNativeMetadata(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), target,
    );
    const nativeBinding = join(root, contract.fileName);
    const nativeHash = createHash('sha256');
    const native = await openProfileInspectionNativeFile(nativeBinding, contract.maximumNativeBytes);
    try {
      if (Number(native.stat.size) !== metadata.nativeSize) throw new Error();
      const stream = native.handle.createReadStream({
        autoClose: false, start: 0, end: Number(native.stat.size) - 1,
      });
      let length = 0;
      for await (const chunk of stream) {
        length += chunk.length;
        if (length > Number(native.stat.size)) throw new Error();
        nativeHash.update(chunk);
      }
      if (length !== Number(native.stat.size)) throw new Error();
      await assertProfileInspectionNativeFileUnchanged(nativeBinding, native.stat, await native.handle.stat({ bigint: true }));
      if (nativeHash.digest('hex') !== metadata.nativeSha256) throw new Error();
    } finally { await native.handle.close(); }
    for (const directory of directories) {
      const stat = await lstat(directory.path, { bigint: true });
      if (stat.dev !== directory.stat.dev || stat.ino !== directory.stat.ino ||
          !stat.isDirectory() || stat.isSymbolicLink()) throw new Error();
    }
    return { nativeBinding, metadata };
  } catch {
    throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
  }
}

export async function openProfileInspectionNativeFile(path: string, maximum: number) {
  const stat = await lstat(path, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n ||
      stat.size < 1n || stat.size > BigInt(maximum) ||
      relative(path, await realpath(path)) !== '') throw new Error();
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    await assertProfileInspectionNativeFileUnchanged(path, stat, await handle.stat({ bigint: true }));
    return { handle, stat };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export async function assertProfileInspectionNativeFileUnchanged(
  path: string,
  before: BigIntStats,
  opened: BigIntStats,
): Promise<void> {
  const current = await lstat(path, { bigint: true });
  for (const after of [opened, current]) {
    if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1n ||
        after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
        after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) throw new Error();
  }
}

async function readBoundedRegularFile(path: string, maximum: number): Promise<Buffer> {
  const file = await openProfileInspectionNativeFile(path, maximum);
  try {
    const buffer = Buffer.alloc(Number(file.stat.size));
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) throw new Error();
      offset += bytesRead;
    }
    await assertProfileInspectionNativeFileUnchanged(path, file.stat, await file.handle.stat({ bigint: true }));
    return buffer;
  } finally { await file.handle.close(); }
}
