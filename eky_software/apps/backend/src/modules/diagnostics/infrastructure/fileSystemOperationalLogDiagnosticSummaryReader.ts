import {
  closeSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import { unavailableOperationalLogSummary } from '../application/getRuntimeDiagnosticSummary.js';
import type { OperationalLogDiagnosticSummary } from '../domain/runtimeDiagnosticSummary.js';
import type { OperationalLogDiagnosticSummaryReader } from '../ports/operationalLogDiagnosticSummaryReader.js';

const maximumCandidateFiles = 96;
const maximumTailBytesPerFile = 256 * 1024;
const fileNamePattern =
  /^(backend-info|backend-warning-error|backend-security|desktop-info|desktop-warning-error|desktop-security)-(\d{4}-(?:0[1-9]|1[0-2]))-(00[1-4])\.jsonl$/;
const timestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

interface OperationalLogFile {
  directoryName: string;
  filePath: string;
  month: string;
  size: number;
}

export class FileSystemOperationalLogDiagnosticSummaryReader
  implements OperationalLogDiagnosticSummaryReader
{
  readonly #logsRoot: string;

  constructor(logsRoot: string) {
    const absoluteRoot = resolve(logsRoot);
    if (absoluteRoot !== logsRoot) {
      throw new Error('Operational logs root must be absolute.');
    }
    this.#logsRoot = absoluteRoot;
  }

  async readOperationalLogSummary(): Promise<OperationalLogDiagnosticSummary> {
    const files = listOperationalLogFiles(this.#logsRoot);
    if (files.length === 0) {
      return unavailableOperationalLogSummary;
    }

    let latestErrorAt: string | null = null;
    let latestSecurityEventAt: string | null = null;
    let latestWarningAt: string | null = null;

    for (const file of files.slice(0, maximumCandidateFiles)) {
      for (const event of readSafeTailEvents(file.filePath)) {
        if (event.level === 'error') {
          latestErrorAt = latestTimestamp(latestErrorAt, event.timestamp);
        }
        if (event.level === 'warn') {
          latestWarningAt = latestTimestamp(latestWarningAt, event.timestamp);
        }
        if (file.directoryName === 'security') {
          latestSecurityEventAt = latestTimestamp(
            latestSecurityEventAt,
            event.timestamp,
          );
        }
      }
    }

    const months = files.map(({ month }) => month).sort();
    return {
      latestErrorAt,
      latestSecurityEventAt,
      latestWarningAt,
      operationalLogNewestMonth: months.at(-1) ?? null,
      operationalLogOldestMonth: months[0] ?? null,
      operationalLogsAvailable: true,
      operationalLogTotalBytes: files.reduce(
        (total, file) => total + file.size,
        0,
      ),
    };
  }
}

function listOperationalLogFiles(logsRoot: string): OperationalLogFile[] {
  const files: OperationalLogFile[] = [];

  for (const directoryName of ['backend', 'desktop', 'security']) {
    const directoryPath = join(logsRoot, directoryName);
    if (!isSafeDirectory(directoryPath)) {
      continue;
    }

    for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
      const match = fileNamePattern.exec(entry.name);
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        match === null ||
        !belongsToDirectory(entry.name, directoryName)
      ) {
        continue;
      }

      const filePath = join(directoryPath, entry.name);
      const metadata = safeFileMetadata(filePath);
      if (metadata !== null) {
        files.push({
          directoryName,
          filePath,
          month: match[2]!,
          size: metadata.size,
        });
      }
    }
  }

  return files;
}

function readSafeTailEvents(
  filePath: string,
): Array<{ level: 'error' | 'warn'; timestamp: string }> {
  return readBoundedTailLines(filePath).flatMap((line) => {
    try {
      const value: unknown = JSON.parse(line);
      if (
        !isRecord(value) ||
        (value.level !== 'error' && value.level !== 'warn') ||
        typeof value.timestamp !== 'string' ||
        !timestampPattern.test(value.timestamp) ||
        !Number.isFinite(Date.parse(value.timestamp))
      ) {
        return [];
      }
      return [{ level: value.level, timestamp: value.timestamp }];
    } catch {
      return [];
    }
  });
}

function readBoundedTailLines(filePath: string): string[] {
  let descriptor: number | undefined;

  try {
    const metadata = lstatSync(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size === 0) {
      return [];
    }
    const byteCount = Math.min(metadata.size, maximumTailBytesPerFile);
    const start = metadata.size - byteCount;
    const buffer = Buffer.alloc(byteCount);
    descriptor = openSync(filePath, 'r');
    const bytesRead = readSync(descriptor, buffer, 0, byteCount, start);
    let text = buffer.subarray(0, bytesRead).toString('utf8');
    if (start > 0) {
      const newline = text.indexOf('\n');
      text = newline < 0 ? '' : text.slice(newline + 1);
    }
    return text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  } catch {
    return [];
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}

function safeFileMetadata(filePath: string): { size: number } | null {
  try {
    const metadata = lstatSync(filePath);
    return metadata.isFile() && !metadata.isSymbolicLink()
      ? { size: metadata.size }
      : null;
  } catch {
    return null;
  }
}

function isSafeDirectory(path: string): boolean {
  try {
    const metadata = lstatSync(path);
    return metadata.isDirectory() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

function belongsToDirectory(
  fileName: string,
  directoryName: string,
): boolean {
  return directoryName === 'security'
    ? fileName.startsWith('backend-security-') ||
        fileName.startsWith('desktop-security-')
    : fileName.startsWith(`${directoryName}-`);
}

function latestTimestamp(current: string | null, candidate: string): string {
  return current === null || candidate > current ? candidate : current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
