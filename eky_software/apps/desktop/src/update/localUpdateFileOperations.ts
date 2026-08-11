import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';

import type { WindowsRegularFileMetadata } from './windowsRegularFileMetadata.js';

const copyBufferBytes = 1024 * 1024;

export interface LocalUpdateSourceSnapshot {
  device: string;
  inode: string;
  modifiedNanoseconds: string;
  size: number;
  windows: Readonly<WindowsRegularFileMetadata>;
}

export interface LocalUpdateFileIdentity {
  sha256: string;
  size: number;
}

export async function readLocalUpdateSourceSnapshot(
  path: string,
  inspectWindowsFile: (
    path: string,
  ) => Promise<Readonly<WindowsRegularFileMetadata>>,
): Promise<Readonly<LocalUpdateSourceSnapshot>> {
  const metadata = await lstat(path, { bigint: true });
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1n ||
    metadata.size > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new Error('LOCAL_UPDATE_SOURCE_FILE_INVALID');
  }
  const windows = await inspectWindowsFile(path);
  if (windows.length !== Number(metadata.size)) {
    throw new Error('LOCAL_UPDATE_SOURCE_FILE_INVALID');
  }
  return Object.freeze({
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
    modifiedNanoseconds: metadata.mtimeNs.toString(),
    size: Number(metadata.size),
    windows,
  });
}

export function assertLocalUpdateSourceUnchanged(
  before: Readonly<LocalUpdateSourceSnapshot>,
  after: Readonly<LocalUpdateSourceSnapshot>,
): void {
  if (
    before.device !== after.device ||
    before.inode !== after.inode ||
    before.modifiedNanoseconds !== after.modifiedNanoseconds ||
    before.size !== after.size ||
    before.windows.length !== after.windows.length ||
    before.windows.lastWriteTimeUtcTicks !==
      after.windows.lastWriteTimeUtcTicks
  ) {
    throw new Error('LOCAL_UPDATE_SOURCE_FILE_CHANGED');
  }
}

export async function copyLocalUpdatePackageWithHash(
  sourcePath: string,
  destinationPath: string,
): Promise<Readonly<LocalUpdateFileIdentity>> {
  const source = await open(sourcePath, 'r');
  let destination;
  try {
    destination = await open(destinationPath, 'wx', 0o600);
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(copyBufferBytes);
    let position = 0;
    while (true) {
      const { bytesRead } = await source.read(
        buffer,
        0,
        buffer.byteLength,
        position,
      );
      if (bytesRead === 0) {
        break;
      }
      hash.update(buffer.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        const result = await destination.write(
          buffer,
          written,
          bytesRead - written,
          position + written,
        );
        if (result.bytesWritten < 1) {
          throw new Error('LOCAL_UPDATE_PACKAGE_COPY_FAILED');
        }
        written += result.bytesWritten;
      }
      position += bytesRead;
    }
    await destination.sync();
    return Object.freeze({ sha256: hash.digest('hex'), size: position });
  } finally {
    await destination?.close().catch(() => undefined);
    await source.close().catch(() => undefined);
  }
}

export async function hashLocalUpdateFile(
  path: string,
): Promise<Readonly<LocalUpdateFileIdentity>> {
  const file = await open(path, 'r');
  try {
    const metadata = await file.stat({ bigint: true });
    if (
      !metadata.isFile() ||
      metadata.size < 1n ||
      metadata.size > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new Error('LOCAL_UPDATE_CACHE_FILE_INVALID');
    }
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(copyBufferBytes);
    let position = 0;
    while (true) {
      const { bytesRead } = await file.read(
        buffer,
        0,
        buffer.byteLength,
        position,
      );
      if (bytesRead === 0) {
        break;
      }
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    if (position !== Number(metadata.size)) {
      throw new Error('LOCAL_UPDATE_CACHE_FILE_CHANGED');
    }
    return Object.freeze({ sha256: hash.digest('hex'), size: position });
  } finally {
    await file.close().catch(() => undefined);
  }
}

export async function writeExclusiveSyncedFile(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  const file = await open(path, 'wx', 0o600);
  try {
    let written = 0;
    while (written < bytes.byteLength) {
      const result = await file.write(
        bytes,
        written,
        bytes.byteLength - written,
        written,
      );
      if (result.bytesWritten < 1) {
        throw new Error('LOCAL_UPDATE_CACHE_WRITE_FAILED');
      }
      written += result.bytesWritten;
    }
    await file.sync();
  } finally {
    await file.close().catch(() => undefined);
  }
}
