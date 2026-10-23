import {
  closeSync,
  lstatSync,
  openSync,
  readSync,
} from 'node:fs';

import type { DiagnosticReadIssue } from '../domain/diagnosticReadState.js';
import type { DiagnosticReadFailureObserver } from '../ports/diagnosticReadFailureObserver.js';
import { observeDiagnosticReadFailure } from '../application/observeDiagnosticReadFailure.js';

export interface BoundedJsonlSourceReadResult {
  bytesRead: number;
  lines: string[];
  sourceTruncated: boolean;
  issues: DiagnosticReadIssue[];
}

export function readNewestJsonlLines(
  filePath: string,
  maximumBytes: number,
  failureObserver?: DiagnosticReadFailureObserver,
): BoundedJsonlSourceReadResult {
  let descriptor: number | undefined;
  let result = emptyResult(true);

  try {
    result = readSource();
  } catch (error) {
    observeDiagnosticReadFailure(failureObserver, error);
    result = emptyResult(true);
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch (error) {
        observeDiagnosticReadFailure(failureObserver, error);
        if (!result.issues.includes('sourceUnavailable')) result.issues.push('sourceUnavailable');
        result.sourceTruncated = true;
      }
    }
  }
  return result;

  function readSource(): BoundedJsonlSourceReadResult {
    const metadata = lstatSync(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return emptyResult(true);
    if (metadata.size === 0) return emptyResult(false);
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
    const issues: DiagnosticReadIssue[] = [];
    if (start > 0) issues.push('limitReached');
    if (bytesRead !== byteCount) issues.push('sourceUnavailable');

    if (start > 0) {
      const firstNewline = text.indexOf('\n');
      if (firstNewline < 0) {
        return { bytesRead, lines: [], sourceTruncated: true, issues };
      }
      text = text.slice(firstNewline + 1);
    }

    if (!text.endsWith('\n')) {
      issues.push('invalidEntries');
    }

    return {
      bytesRead,
      lines: text
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .reverse(),
      sourceTruncated: issues.length > 0,
      issues,
    };
  }
}

function emptyResult(
  sourceTruncated: boolean,
): BoundedJsonlSourceReadResult {
  return {
    bytesRead: 0,
    lines: [],
    sourceTruncated,
    issues: sourceTruncated ? ['sourceUnavailable'] : [],
  };
}
