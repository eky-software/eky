import {
  closeSync,
  lstatSync,
  openSync,
  readSync,
} from 'node:fs';

export interface BoundedJsonlSourceReadResult {
  bytesRead: number;
  lines: string[];
  sourceTruncated: boolean;
}

export function readNewestJsonlLines(
  filePath: string,
  maximumBytes: number,
): BoundedJsonlSourceReadResult {
  let descriptor: number | undefined;

  try {
    const metadata = lstatSync(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      return emptyResult(true);
    }
    if (metadata.size === 0) {
      return emptyResult(false);
    }

    const byteCount = Math.min(metadata.size, maximumBytes);
    const start = metadata.size - byteCount;
    const buffer = Buffer.alloc(byteCount);
    descriptor = openSync(filePath, 'r');
    const bytesRead = readSync(
      descriptor,
      buffer,
      0,
      byteCount,
      start,
    );
    let text = buffer.subarray(0, bytesRead).toString('utf8');
    let sourceTruncated = start > 0 || bytesRead !== byteCount;

    if (start > 0) {
      const firstNewline = text.indexOf('\n');
      if (firstNewline < 0) {
        return { bytesRead, lines: [], sourceTruncated: true };
      }
      text = text.slice(firstNewline + 1);
    }

    if (!text.endsWith('\n')) {
      sourceTruncated = true;
    }

    return {
      bytesRead,
      lines: text
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .reverse(),
      sourceTruncated,
    };
  } catch {
    return emptyResult(true);
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}

function emptyResult(
  sourceTruncated: boolean,
): BoundedJsonlSourceReadResult {
  return {
    bytesRead: 0,
    lines: [],
    sourceTruncated,
  };
}
