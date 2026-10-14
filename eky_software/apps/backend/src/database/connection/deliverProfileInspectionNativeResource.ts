import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  assertProfileInspectionNativeFileUnchanged,
  inspectProfileInspectionNativeResource,
  openProfileInspectionNativeFile,
} from './inspectProfileInspectionNativeResource.js';
import { profileInspectionNativeContract as contract } from './profileInspectionNativeContract.js';

export async function deliverProfileInspectionNativeResource(
  sourceRoot: string,
  targetRoot: string,
  target = { platform: process.platform, arch: process.arch },
): Promise<Awaited<ReturnType<typeof inspectProfileInspectionNativeResource>>> {
  try {
    if (!isAbsolute(sourceRoot) || !isAbsolute(targetRoot)) throw new Error();
    const source = resolve(sourceRoot);
    const destination = resolve(targetRoot);
    const destinationRelative = relative(source, destination);
    if (destinationRelative === '' || (!isAbsolute(destinationRelative) &&
        destinationRelative !== '..' && !destinationRelative.startsWith(`..${sep}`))) {
      throw new Error();
    }
    const original = await inspectProfileInspectionNativeResource(source, target);
    const parents = [];
    for (let path = dirname(destination); ; path = dirname(path)) {
      const stat = await lstat(path, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink() || relative(path, await realpath(path)) !== '') throw new Error();
      parents.push({ path, stat });
      if (dirname(path) === path) break;
    }
    // No overwrite, hardlink, fallback or deletion of uncertain delivery evidence.
    await mkdir(destination, { mode: 0o700 });
    for (const name of [contract.fileName, contract.metadataFileName]) {
      await copyBoundedResourceFile(join(source, name), join(destination, name),
        name === contract.fileName ? original.metadata.nativeSize : contract.maximumMetadataBytes,
        name === contract.fileName ? original.metadata.nativeSize : undefined);
    }
    const delivered = await inspectProfileInspectionNativeResource(destination, target);
    const retained = await inspectProfileInspectionNativeResource(source, target);
    if (JSON.stringify(original.metadata) !== JSON.stringify(delivered.metadata) ||
        JSON.stringify(original.metadata) !== JSON.stringify(retained.metadata)) throw new Error();
    for (const parent of parents) {
      const stat = await lstat(parent.path, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink() ||
          stat.dev !== parent.stat.dev || stat.ino !== parent.stat.ino) throw new Error();
    }
    return delivered;
  } catch {
    throw new Error('PROFILE_INSPECTION_NATIVE_DELIVERY_INVALID');
  }
}

async function copyBoundedResourceFile(source: string, destination: string, maximum: number, expectedSize?: number) {
  const input = await openProfileInspectionNativeFile(source, maximum);
  try {
    const size = Number(input.stat.size);
    if (expectedSize !== undefined && size !== expectedSize) throw new Error();
    const output = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
      (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      const bytes = Buffer.alloc(Math.min(65_536, size));
      let position = 0;
      while (position < size) {
        const { bytesRead } = await input.handle.read(bytes, 0, Math.min(bytes.length, size - position), position);
        if (bytesRead === 0) throw new Error();
        let written = 0;
        while (written < bytesRead) {
          const result = await output.write(bytes, written, bytesRead - written, position + written);
          if (result.bytesWritten === 0) throw new Error();
          written += result.bytesWritten;
        }
        position += bytesRead;
      }
      await assertProfileInspectionNativeFileUnchanged(source, input.stat, await input.handle.stat({ bigint: true }));
    } finally { await output.close(); }
  } finally { await input.handle.close(); }
}
