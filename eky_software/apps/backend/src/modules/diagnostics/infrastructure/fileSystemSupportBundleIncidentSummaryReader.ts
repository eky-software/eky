import {
  closeSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import type { SupportBundleIncidentSummary } from '../domain/supportBundleIncidentSummary.js';
import type {
  SupportBundleIncidentSummaryReader,
  SupportBundleIncidentSummaryReadResult,
} from '../ports/supportBundleIncidentSummaryReader.js';

const defaultMaximumIncidentSummaries = 5_000;
const defaultMaximumProjectedBytes = 5 * 1024 * 1024;
const defaultMaximumSourceBytes = 8 * 1024 * 1024;
const incidentFileNamePattern =
  /^(backend|desktop)-incident-index-(\d{4})\.jsonl$/;
const safeTextPattern = /^[A-Za-z0-9._:-]+$/;
const buildRevisionPattern = /^(?:[0-9a-f]{7,40}|development)$/;

interface IncidentSourceEntry {
  appVersion: string;
  buildRevision: string;
  component: 'backend' | 'desktop';
  errorCode: string;
  eventName: string;
  fingerprint: string;
  outcome: 'blocked' | 'failure' | 'unknown';
  timestamp: string;
}

interface IncidentIndexFile {
  component: 'backend' | 'desktop';
  fileName: string;
  filePath: string;
  year: number;
}

interface ReaderLimits {
  maximumIncidentSummaries: number;
  maximumProjectedBytes: number;
  maximumSourceBytes: number;
}

export class FileSystemSupportBundleIncidentSummaryReader
  implements SupportBundleIncidentSummaryReader
{
  readonly #limits: ReaderLimits;
  readonly #logsRoot: string;

  constructor(
    logsRoot: string,
    limits: Partial<ReaderLimits> = {},
  ) {
    const absoluteRoot = resolve(logsRoot);
    if (absoluteRoot !== logsRoot) {
      throw new Error('Support bundle incident root must be absolute.');
    }
    this.#logsRoot = absoluteRoot;
    this.#limits = {
      maximumIncidentSummaries:
        limits.maximumIncidentSummaries ??
        defaultMaximumIncidentSummaries,
      maximumProjectedBytes:
        limits.maximumProjectedBytes ?? defaultMaximumProjectedBytes,
      maximumSourceBytes:
        limits.maximumSourceBytes ?? defaultMaximumSourceBytes,
    };
    assertPositiveLimits(this.#limits);
  }

  async readSupportBundleIncidentSummaries(input: {
    earliestTimestamp: string;
    latestTimestamp: string;
  }): Promise<SupportBundleIncidentSummaryReadResult> {
    const period = requireValidPeriod(input);
    const listed = listIncidentFiles(this.#logsRoot, period.years);
    let sourceTruncated = listed.sourceTruncated;
    let remainingSourceBytes = this.#limits.maximumSourceBytes;
    let projectedBytes = 2;
    const grouped = new Map<string, SupportBundleIncidentSummary>();

    fileLoop: for (const file of listed.files) {
      if (remainingSourceBytes <= 0) {
        sourceTruncated = true;
        break;
      }

      const readResult = readNewestLines(
        file.filePath,
        remainingSourceBytes,
      );
      remainingSourceBytes -= readResult.bytesRead;
      sourceTruncated ||= readResult.sourceTruncated;

      for (const line of readResult.lines) {
        const entry = parseIncidentEntry(line, file.component);
        if (entry === null) {
          sourceTruncated = true;
          continue;
        }
        const occurredAt = Date.parse(entry.timestamp);
        if (
          occurredAt < period.earliest ||
          occurredAt > period.latest
        ) {
          continue;
        }

        const key = incidentGroupKey(entry);
        const existing = grouped.get(key);
        if (existing !== undefined) {
          existing.count += 1;
          if (entry.timestamp < existing.firstOccurredAt) {
            existing.firstOccurredAt = entry.timestamp;
          }
          if (entry.timestamp > existing.lastOccurredAt) {
            existing.lastOccurredAt = entry.timestamp;
          }
          continue;
        }

        if (grouped.size >= this.#limits.maximumIncidentSummaries) {
          sourceTruncated = true;
          break fileLoop;
        }
        const summary = toSummary(entry);
        const summaryBytes = Buffer.byteLength(
          JSON.stringify(summary),
          'utf8',
        );
        if (
          projectedBytes + summaryBytes + (grouped.size === 0 ? 0 : 1) >
          this.#limits.maximumProjectedBytes
        ) {
          sourceTruncated = true;
          break fileLoop;
        }
        grouped.set(key, summary);
        projectedBytes += summaryBytes + (grouped.size === 1 ? 0 : 1);
      }
    }

    return {
      incidentSummaries: [...grouped.values()].sort(
        compareSummariesNewestFirst,
      ),
      sourceTruncated,
    };
  }
}

export const emptySupportBundleIncidentSummaryReader: SupportBundleIncidentSummaryReader =
  Object.freeze({
    async readSupportBundleIncidentSummaries() {
      return {
        incidentSummaries: [],
        sourceTruncated: false,
      };
    },
  });

function listIncidentFiles(
  logsRoot: string,
  years: ReadonlySet<number>,
): { files: IncidentIndexFile[]; sourceTruncated: boolean } {
  const directory = join(logsRoot, 'incident-index');
  const directoryState = inspectPath(directory);
  if (directoryState === 'missing') {
    return { files: [], sourceTruncated: false };
  }
  if (directoryState !== 'directory') {
    return { files: [], sourceTruncated: true };
  }

  const files: IncidentIndexFile[] = [];
  let sourceTruncated = false;
  try {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const match = incidentFileNamePattern.exec(entry.name);
      if (match === null || !years.has(Number(match[2]))) {
        continue;
      }
      if (!entry.isFile() || entry.isSymbolicLink()) {
        sourceTruncated = true;
        continue;
      }
      files.push({
        component: match[1] as 'backend' | 'desktop',
        fileName: entry.name,
        filePath: join(directory, entry.name),
        year: Number(match[2]),
      });
    }
  } catch {
    sourceTruncated = true;
  }

  return {
    files: files.sort((left, right) => {
      const yearComparison = right.year - left.year;
      return yearComparison === 0
        ? right.fileName.localeCompare(left.fileName)
        : yearComparison;
    }),
    sourceTruncated,
  };
}

function parseIncidentEntry(
  line: string,
  expectedComponent: 'backend' | 'desktop',
): IncidentSourceEntry | null {
  try {
    const value = JSON.parse(line) as unknown;
    if (
      !isRecord(value) ||
      !hasOnlyKeys(value, [
        'appVersion',
        'buildRevision',
        'component',
        'errorCode',
        'eventName',
        'fingerprint',
        'outcome',
        'timestamp',
      ]) ||
      value.component !== expectedComponent ||
      !isSafeText(value.appVersion, 80) ||
      typeof value.buildRevision !== 'string' ||
      !buildRevisionPattern.test(value.buildRevision) ||
      !isSafeText(value.errorCode, 120) ||
      !isSafeText(value.eventName, 120) ||
      !isSafeText(value.fingerprint, 200) ||
      !['blocked', 'failure', 'unknown'].includes(
        value.outcome as string,
      ) ||
      !isExactTimestamp(value.timestamp)
    ) {
      return null;
    }

    return value as unknown as IncidentSourceEntry;
  } catch {
    return null;
  }
}

function toSummary(
  entry: IncidentSourceEntry,
): SupportBundleIncidentSummary {
  return {
    appVersion: entry.appVersion,
    buildRevision: entry.buildRevision,
    count: 1,
    errorCode: entry.errorCode,
    eventName: entry.eventName,
    fingerprint: entry.fingerprint,
    firstOccurredAt: entry.timestamp,
    lastOccurredAt: entry.timestamp,
    outcome: entry.outcome,
  };
}

function incidentGroupKey(entry: IncidentSourceEntry): string {
  return JSON.stringify([
    entry.appVersion,
    entry.buildRevision,
    entry.errorCode,
    entry.eventName,
    entry.fingerprint,
    entry.outcome,
  ]);
}

function readNewestLines(
  filePath: string,
  maximumBytes: number,
): {
  bytesRead: number;
  lines: string[];
  sourceTruncated: boolean;
} {
  let descriptor: number | undefined;

  try {
    const metadata = lstatSync(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      return { bytesRead: 0, lines: [], sourceTruncated: true };
    }
    if (metadata.size === 0) {
      return { bytesRead: 0, lines: [], sourceTruncated: false };
    }

    const byteCount = Math.min(metadata.size, maximumBytes);
    const start = metadata.size - byteCount;
    const buffer = Buffer.alloc(byteCount);
    descriptor = openSync(filePath, 'r');
    const bytesRead = readSync(descriptor, buffer, 0, byteCount, start);
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
    return { bytesRead: 0, lines: [], sourceTruncated: true };
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}

function requireValidPeriod(input: {
  earliestTimestamp: string;
  latestTimestamp: string;
}): {
  earliest: number;
  latest: number;
  years: ReadonlySet<number>;
} {
  if (
    !isExactTimestamp(input.earliestTimestamp) ||
    !isExactTimestamp(input.latestTimestamp)
  ) {
    throw new Error('Support bundle incident period is invalid.');
  }
  const earliest = Date.parse(input.earliestTimestamp);
  const latest = Date.parse(input.latestTimestamp);
  if (earliest > latest) {
    throw new Error('Support bundle incident period is invalid.');
  }

  const earliestYear = new Date(earliest).getUTCFullYear();
  const latestYear = new Date(latest).getUTCFullYear();
  const years = new Set<number>();
  for (let year = earliestYear; year <= latestYear; year += 1) {
    years.add(year);
  }
  return { earliest, latest, years };
}

function compareSummariesNewestFirst(
  left: SupportBundleIncidentSummary,
  right: SupportBundleIncidentSummary,
): number {
  const timeComparison = right.lastOccurredAt.localeCompare(
    left.lastOccurredAt,
  );
  return timeComparison === 0
    ? left.eventName.localeCompare(right.eventName)
    : timeComparison;
}

function inspectPath(
  path: string,
): 'directory' | 'missing' | 'unsafe' {
  try {
    const metadata = lstatSync(path);
    return metadata.isDirectory() && !metadata.isSymbolicLink()
      ? 'directory'
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

function isExactTimestamp(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    return false;
  }
  const parsed = Date.parse(value);
  return (
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString() === value
  );
}

function isSafeText(
  value: unknown,
  maximumLength: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumLength &&
    safeTextPattern.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys);
  return (
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function assertPositiveLimits(limits: ReaderLimits): void {
  if (
    Object.values(limits).some(
      (value) => !Number.isSafeInteger(value) || value <= 0,
    )
  ) {
    throw new Error('Support bundle incident limits are invalid.');
  }
}
