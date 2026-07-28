import {
  lstatSync,
  readdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import type { DiagnosticEventItem } from '../domain/diagnosticEventItem.js';
import type {
  SupportBundleDiagnosticEventReader,
  SupportBundleDiagnosticEventReadResult,
} from '../ports/supportBundleDiagnosticEventReader.js';
import { readNewestJsonlLines } from './boundedJsonlSourceReader.js';
import { projectDiagnosticOperationalEvent } from './diagnosticOperationalEventProjector.js';

const defaultMaximumCandidateFiles = 48;
const defaultMaximumDiagnosticEvents = 5_000;
const defaultMaximumProjectedEventBytes = 20 * 1024 * 1024;
const defaultMaximumSourceBytes = 24 * 1024 * 1024;
const maximumSegmentsPerMonth = 4;
const relevantFileNamePattern =
  /^(backend-warning-error|backend-security|desktop-warning-error|desktop-security)-(\d{4}-(?:0[1-9]|1[0-2]))-(00[1-4])\.jsonl$/;

interface DiagnosticLogFile {
  fileName: string;
  filePath: string;
  month: string;
  segment: number;
  stream: string;
}

interface ReaderLimits {
  maximumCandidateFiles: number;
  maximumDiagnosticEvents: number;
  maximumProjectedEventBytes: number;
  maximumSourceBytes: number;
}

export class FileSystemSupportBundleDiagnosticEventReader
  implements SupportBundleDiagnosticEventReader
{
  readonly #limits: ReaderLimits;
  readonly #logsRoot: string;

  constructor(
    logsRoot: string,
    limits: Partial<ReaderLimits> = {},
  ) {
    const absoluteRoot = resolve(logsRoot);
    if (absoluteRoot !== logsRoot) {
      throw new Error('Support bundle logs root must be absolute.');
    }
    this.#logsRoot = absoluteRoot;
    this.#limits = {
      maximumCandidateFiles:
        limits.maximumCandidateFiles ?? defaultMaximumCandidateFiles,
      maximumDiagnosticEvents:
        limits.maximumDiagnosticEvents ?? defaultMaximumDiagnosticEvents,
      maximumProjectedEventBytes:
        limits.maximumProjectedEventBytes ??
        defaultMaximumProjectedEventBytes,
      maximumSourceBytes:
        limits.maximumSourceBytes ?? defaultMaximumSourceBytes,
    };
    assertPositiveLimits(this.#limits);
  }

  async readSupportBundleDiagnosticEvents(input: {
    earliestTimestamp: string;
    latestTimestamp: string;
  }): Promise<SupportBundleDiagnosticEventReadResult> {
    const period = requireValidPeriod(input);
    const listed = listRelevantLogFiles(
      this.#logsRoot,
      period.includedMonths,
    );
    let sourceTruncated =
      listed.sourceTruncated || hasSegmentGap(listed.files);
    const candidates = listed.files.slice(
      0,
      this.#limits.maximumCandidateFiles,
    );
    if (listed.files.length > candidates.length) {
      sourceTruncated = true;
    }

    const diagnosticEvents: DiagnosticEventItem[] = [];
    const seenIds = new Set<string>();
    let projectedEventBytes = 0;
    let remainingSourceBytes = this.#limits.maximumSourceBytes;

    candidateLoop: for (const candidate of candidates) {
      if (remainingSourceBytes <= 0) {
        sourceTruncated = true;
        break;
      }

      const result = readNewestJsonlLines(
        candidate.filePath,
        remainingSourceBytes,
      );
      remainingSourceBytes -= result.bytesRead;
      sourceTruncated ||= result.sourceTruncated;

      for (const line of result.lines) {
        const event = parseProjectedEvent(line);
        if (event === null) {
          sourceTruncated = true;
          continue;
        }
        if (event.level === 'info') {
          continue;
        }
        if (
          !isTimestampWithinPeriod(
            event.occurredAt,
            period.earliest,
            period.latest,
          ) ||
          seenIds.has(event.id)
        ) {
          continue;
        }

        const eventBytes = Buffer.byteLength(
          JSON.stringify(event),
          'utf8',
        );
        if (
          diagnosticEvents.length >=
            this.#limits.maximumDiagnosticEvents ||
          projectedEventBytes + eventBytes >
            this.#limits.maximumProjectedEventBytes
        ) {
          sourceTruncated = true;
          break candidateLoop;
        }

        diagnosticEvents.push(event);
        seenIds.add(event.id);
        projectedEventBytes += eventBytes;
      }
    }

    return {
      diagnosticEvents: diagnosticEvents.sort(compareEventsNewestFirst),
      sourceTruncated,
    };
  }
}

export const emptySupportBundleDiagnosticEventReader: SupportBundleDiagnosticEventReader =
  Object.freeze({
    async readSupportBundleDiagnosticEvents() {
      return {
        diagnosticEvents: [],
        sourceTruncated: false,
      };
    },
  });

function listRelevantLogFiles(
  logsRoot: string,
  includedMonths: ReadonlySet<string>,
): { files: DiagnosticLogFile[]; sourceTruncated: boolean } {
  const files: DiagnosticLogFile[] = [];
  let sourceTruncated = false;

  for (const directoryName of ['backend', 'desktop', 'security']) {
    const directoryPath = join(logsRoot, directoryName);
    const directoryState = inspectDirectory(directoryPath);
    if (directoryState === 'missing') {
      continue;
    }
    if (directoryState === 'unsafe') {
      sourceTruncated = true;
      continue;
    }

    try {
      for (const entry of readdirSync(directoryPath, {
        withFileTypes: true,
      })) {
        const match = relevantFileNamePattern.exec(entry.name);
        if (
          match === null ||
          !includedMonths.has(match[2]!) ||
          !belongsToDirectory(entry.name, directoryName)
        ) {
          continue;
        }
        if (!entry.isFile() || entry.isSymbolicLink()) {
          sourceTruncated = true;
          continue;
        }

        files.push({
          fileName: entry.name,
          filePath: join(directoryPath, entry.name),
          month: match[2]!,
          segment: Number(match[3]),
          stream: match[1]!,
        });
      }
    } catch {
      sourceTruncated = true;
    }
  }

  return {
    files: files.sort(compareFilesNewestFirst),
    sourceTruncated,
  };
}

function parseProjectedEvent(line: string): DiagnosticEventItem | null {
  try {
    return projectDiagnosticOperationalEvent(JSON.parse(line) as unknown);
  } catch {
    return null;
  }
}

function requireValidPeriod(input: {
  earliestTimestamp: string;
  latestTimestamp: string;
}): {
  earliest: number;
  includedMonths: ReadonlySet<string>;
  latest: number;
} {
  const earliest = parseExactTimestamp(input.earliestTimestamp);
  const latest = parseExactTimestamp(input.latestTimestamp);
  if (earliest === null || latest === null || earliest > latest) {
    throw new Error('Support bundle diagnostic period is invalid.');
  }

  const includedMonths = new Set<string>();
  const cursor = new Date(
    Date.UTC(earliest.getUTCFullYear(), earliest.getUTCMonth(), 1),
  );
  const lastMonth = Date.UTC(
    latest.getUTCFullYear(),
    latest.getUTCMonth(),
    1,
  );
  while (cursor.getTime() <= lastMonth) {
    includedMonths.add(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return {
    earliest: earliest.getTime(),
    includedMonths,
    latest: latest.getTime(),
  };
}

function parseExactTimestamp(value: string): Date | null {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    return null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const date = new Date(parsed);
  return date.toISOString() === value ? date : null;
}

function isTimestampWithinPeriod(
  value: string,
  earliest: number,
  latest: number,
): boolean {
  const parsed = Date.parse(value);
  return (
    Number.isFinite(parsed) &&
    parsed >= earliest &&
    parsed <= latest
  );
}

function hasSegmentGap(files: readonly DiagnosticLogFile[]): boolean {
  const segmentsByStreamMonth = new Map<string, Set<number>>();
  for (const file of files) {
    const key = `${file.stream}:${file.month}`;
    const segments = segmentsByStreamMonth.get(key) ?? new Set<number>();
    segments.add(file.segment);
    segmentsByStreamMonth.set(key, segments);
  }

  for (const segments of segmentsByStreamMonth.values()) {
    const highest = Math.max(...segments);
    for (let segment = 1; segment <= highest; segment += 1) {
      if (!segments.has(segment)) {
        return true;
      }
    }
  }
  return false;
}

function compareFilesNewestFirst(
  left: DiagnosticLogFile,
  right: DiagnosticLogFile,
): number {
  const monthComparison = right.month.localeCompare(left.month);
  if (monthComparison !== 0) {
    return monthComparison;
  }
  const segmentComparison = right.segment - left.segment;
  return segmentComparison === 0
    ? right.fileName.localeCompare(left.fileName)
    : segmentComparison;
}

function compareEventsNewestFirst(
  left: DiagnosticEventItem,
  right: DiagnosticEventItem,
): number {
  const timeComparison = right.occurredAt.localeCompare(left.occurredAt);
  return timeComparison === 0
    ? right.id.localeCompare(left.id)
    : timeComparison;
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
  return fileName.startsWith(`${directoryName}-warning-error-`);
}

function inspectDirectory(
  directoryPath: string,
): 'missing' | 'safe' | 'unsafe' {
  try {
    const metadata = lstatSync(directoryPath);
    return metadata.isDirectory() && !metadata.isSymbolicLink()
      ? 'safe'
      : 'unsafe';
  } catch (error) {
    return isMissingFileError(error) ? 'missing' : 'unsafe';
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function assertPositiveLimits(limits: ReaderLimits): void {
  if (
    Object.values(limits).some(
      (value) => !Number.isSafeInteger(value) || value <= 0,
    ) ||
    limits.maximumCandidateFiles >
      maximumSegmentsPerMonth * 4 * 3
  ) {
    throw new Error('Support bundle reader limits are invalid.');
  }
}
