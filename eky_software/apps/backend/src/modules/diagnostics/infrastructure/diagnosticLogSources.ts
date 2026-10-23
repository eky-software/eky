import { type Dir, lstatSync, opendirSync } from 'node:fs';
import { join } from 'node:path';

import type { DiagnosticEventItem } from '../domain/diagnosticEventItem.js';
import { createDiagnosticReadState, type DiagnosticReadIssue } from '../domain/diagnosticReadState.js';
import { readNewestJsonlLines } from './boundedJsonlSourceReader.js';
import { classifyDiagnosticOperationalEvent } from './diagnosticOperationalEventProjector.js';
import { observeDiagnosticReadFailure } from '../application/observeDiagnosticReadFailure.js';
import type { DiagnosticReadFailureObserver } from '../ports/diagnosticReadFailureObserver.js';

const maximumTailBytesPerFile = 256 * 1024;
const fileNamePattern =
  /^(backend-info|backend-warning-error|backend-security|desktop-info|desktop-warning-error|desktop-security)-(\d{4}-(?:0[1-9]|1[0-2]))-(00[1-4])\.jsonl$/;

interface DiagnosticLogFile {
  fileName: string;
  filePath: string;
  month: string;
  segment: number;
  component: 'backend' | 'desktop';
  security: boolean;
}

// Only the two diagnostic read models share discovery and bounded source facts.
export function readDiagnosticLogSources(options: {
  logsRoot: string;
  maximumCandidateFiles: number;
  failureObserver?: DiagnosticReadFailureObserver;
  visitEvent(event: DiagnosticEventItem, security: boolean): void;
}) {
  const issues = new Set<DiagnosticReadIssue>();
  const files: DiagnosticLogFile[] = [];
  let totalByteCount = 0;
  let oldestMonth: string | null = null;
  let newestMonth: string | null = null;
  let rootAvailable = false;
  let successfulReads = 0;
  try {
    const root = lstatSync(options.logsRoot);
    rootAvailable = root.isDirectory() && !root.isSymbolicLink();
  } catch (error) { observeDiagnosticReadFailure(options.failureObserver, error); }
  if (!rootAvailable) {
    return { readState: createDiagnosticReadState(issues, false),
      totalByteCount, oldestMonth, newestMonth };
  }

  for (const directory of ['backend', 'desktop', 'security']) {
    const directoryPath = join(options.logsRoot, directory);
    try {
      const metadata = lstatSync(directoryPath);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        issues.add('sourceUnavailable');
        continue;
      }
    } catch (error) {
      if (!isMissing(error)) {
        observeDiagnosticReadFailure(options.failureObserver, error);
        issues.add('sourceUnavailable');
      }
      continue;
    }
    let directoryHandle: Dir | undefined;
    try {
      directoryHandle = opendirSync(directoryPath);
      for (let entry = directoryHandle.readSync(); entry !== null; entry = directoryHandle.readSync()) {
        const match = fileNamePattern.exec(entry.name);
        if (match === null || !belongsToDirectory(entry.name, directory)) continue;
        if (!entry.isFile() || entry.isSymbolicLink()) {
          issues.add('sourceUnavailable');
          continue;
        }
        const filePath = join(directoryPath, entry.name);
        const month = match[2]!;
        files.push({ filePath, fileName: entry.name, month, segment: Number(match[3]),
          component: entry.name.startsWith('backend-') ? 'backend' : 'desktop',
          security: directory === 'security' });
        if (files.length > options.maximumCandidateFiles * 2) {
          files.sort(compareFilesNewestFirst);
          files.length = options.maximumCandidateFiles;
          issues.add('limitReached');
        }
      }
    } catch (error) {
      observeDiagnosticReadFailure(options.failureObserver, error);
      issues.add('sourceUnavailable');
    } finally {
      if (directoryHandle !== undefined) {
        try { directoryHandle.closeSync(); } catch (error) {
          observeDiagnosticReadFailure(options.failureObserver, error);
          issues.add('sourceUnavailable');
        }
      }
    }
  }
  files.sort(compareFilesNewestFirst);
  if (files.length > options.maximumCandidateFiles) {
    files.length = options.maximumCandidateFiles;
    issues.add('limitReached');
  }

  for (const file of files) {
    try {
      const metadata = lstatSync(file.filePath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        issues.add('sourceUnavailable');
        continue;
      }
      totalByteCount += metadata.size;
      if (oldestMonth === null || file.month < oldestMonth) oldestMonth = file.month;
      if (newestMonth === null || file.month > newestMonth) newestMonth = file.month;
    } catch (error) {
      observeDiagnosticReadFailure(options.failureObserver, error);
      issues.add('sourceUnavailable');
      continue;
    }
    const source = readNewestJsonlLines(file.filePath, maximumTailBytesPerFile, options.failureObserver);
    for (const issue of source.issues) issues.add(issue);
    if (source.bytesRead > 0 || !source.sourceTruncated) successfulReads++;
    for (const line of source.lines) {
      let value: unknown;
      try { value = JSON.parse(line); } catch {
        issues.add('invalidEntries');
        continue;
      }
      if (typeof value !== 'object' || value === null ||
        !('component' in value) || value.component !== file.component) {
        issues.add('invalidEntries');
        continue;
      }
      const classified = classifyDiagnosticOperationalEvent(value);
      if (classified.kind === 'invalid') issues.add('invalidEntries');
      if (classified.kind === 'event') options.visitEvent(classified.event, file.security);
    }
  }
  const hasReadableSource = files.length > 0 ? successfulReads > 0
    : !issues.has('sourceUnavailable');
  return { readState: createDiagnosticReadState(issues, hasReadableSource),
    totalByteCount, oldestMonth, newestMonth };
}

function compareFilesNewestFirst(left: DiagnosticLogFile, right: DiagnosticLogFile): number {
  return right.month.localeCompare(left.month) || right.segment - left.segment ||
    right.fileName.localeCompare(left.fileName);
}

function belongsToDirectory(fileName: string, directory: string): boolean {
  return directory === 'security'
    ? fileName.startsWith('backend-security-') || fileName.startsWith('desktop-security-')
    : fileName.startsWith(`${directory}-`);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
