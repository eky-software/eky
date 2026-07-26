import {
  closeSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import type { DiagnosticEventItem } from '../domain/diagnosticEventItem.js';
import type { DiagnosticEventReader } from '../ports/diagnosticEventReader.js';
import { projectDiagnosticOperationalEvent } from './diagnosticOperationalEventProjector.js';

const maximumCandidateFiles = 32;
const maximumTailBytesPerFile = 256 * 1024;
const fileNamePattern =
  /^(backend-info|backend-warning-error|backend-security|desktop-info|desktop-warning-error|desktop-security)-(\d{4}-(?:0[1-9]|1[0-2]))-(00[1-4])\.jsonl$/;

interface DiagnosticLogFile {
  fileName: string;
  filePath: string;
  month: string;
  segment: number;
}

export class FileSystemDiagnosticEventReader
  implements DiagnosticEventReader
{
  readonly #logsRoot: string;

  constructor(logsRoot: string) {
    const absoluteRoot = resolve(logsRoot);
    if (absoluteRoot !== logsRoot) {
      throw new Error('Diagnostic logs root must be absolute.');
    }
    this.#logsRoot = absoluteRoot;
  }

  async listRecentDiagnosticEvents(
    limit: number,
  ): Promise<DiagnosticEventItem[]> {
    const events: DiagnosticEventItem[] = [];
    const seenIds = new Set<string>();

    for (const candidate of listDiagnosticLogFiles(this.#logsRoot).slice(
      0,
      maximumCandidateFiles,
    )) {
      for (const line of readBoundedTailLines(candidate.filePath)) {
        const event = parseProjectedEvent(line);
        if (event !== null && !seenIds.has(event.id)) {
          events.push(event);
          seenIds.add(event.id);
        }
      }
    }

    return events
      .sort((left, right) => {
        const timeComparison = right.occurredAt.localeCompare(left.occurredAt);
        return timeComparison === 0
          ? right.id.localeCompare(left.id)
          : timeComparison;
      })
      .slice(0, limit);
  }
}

export const emptyDiagnosticEventReader: DiagnosticEventReader = Object.freeze({
  async listRecentDiagnosticEvents() {
    return [];
  },
});

function listDiagnosticLogFiles(logsRoot: string): DiagnosticLogFile[] {
  const files: DiagnosticLogFile[] = [];

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

      files.push({
        fileName: entry.name,
        filePath: join(directoryPath, entry.name),
        month: match[2]!,
        segment: Number(match[3]),
      });
    }
  }

  return files.sort((left, right) => {
    const monthComparison = right.month.localeCompare(left.month);
    if (monthComparison !== 0) {
      return monthComparison;
    }
    const segmentComparison = right.segment - left.segment;
    return segmentComparison === 0
      ? right.fileName.localeCompare(left.fileName)
      : segmentComparison;
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
      const firstNewline = text.indexOf('\n');
      if (firstNewline < 0) {
        return [];
      }
      text = text.slice(firstNewline + 1);
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

function parseProjectedEvent(line: string): DiagnosticEventItem | null {
  try {
    return projectDiagnosticOperationalEvent(JSON.parse(line) as unknown);
  } catch {
    return null;
  }
}

function belongsToDirectory(
  fileName: string,
  directoryName: string,
): boolean {
  if (directoryName === 'security') {
    return (
      fileName.startsWith('backend-security-') ||
      fileName.startsWith('desktop-security-')
    );
  }
  return fileName.startsWith(`${directoryName}-`);
}

function isSafeDirectory(directoryPath: string): boolean {
  try {
    const metadata = lstatSync(directoryPath);
    return metadata.isDirectory() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}
