import {
  lstatSync,
  readdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import type { SupportBundleIncidentSummary } from '../domain/supportBundleIncidentSummary.js';
import type {
  SupportBundleIncidentSummaryReader,
  SupportBundleIncidentSummaryReadResult,
} from '../ports/supportBundleIncidentSummaryReader.js';
import { readNewestJsonlLines } from './boundedJsonlSourceReader.js';

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

const legacyIncidentSourceKeys = [
  'appVersion',
  'buildRevision',
  'component',
  'errorCode',
  'eventName',
  'fingerprint',
  'outcome',
  'timestamp',
] as const;
const currentIncidentSourceKeys = [
  ...legacyIncidentSourceKeys,
  'schemaVersion',
] as const;

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
    const grouped = new Map<string, SupportBundleIncidentSummary>();
    const observedSources: Array<{
      component: IncidentIndexFile['component'];
      lines: string[];
    }> = [];

    for (const file of listed.files) {
      if (remainingSourceBytes <= 0) {
        sourceTruncated = true;
        break;
      }

      const readResult = readNewestJsonlLines(
        file.filePath,
        remainingSourceBytes,
      );
      remainingSourceBytes -= readResult.bytesRead;
      sourceTruncated ||= readResult.sourceTruncated;
      observedSources.push({ component: file.component, lines: readResult.lines });

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
          if (entry.timestamp > existing.lastOccurredAt) {
            existing.lastOccurredAt = entry.timestamp;
          }
          continue;
        }

        grouped.set(key, toSummary(entry));
        if (grouped.size > this.#limits.maximumIncidentSummaries * 2) {
          retainNewestIncidentCandidates(grouped, this.#limits.maximumIncidentSummaries);
          sourceTruncated = true;
        }
      }
    }

    sourceTruncated ||= grouped.size > this.#limits.maximumIncidentSummaries;
    retainNewestIncidentCandidates(grouped, this.#limits.maximumIncidentSummaries);
    for (const summary of grouped.values()) {
      summary.count = 0;
      summary.firstOccurredAt = summary.lastOccurredAt;
    }
    // Recount selected groups from the same bounded bytes, never from a second file read.
    for (const source of observedSources) {
      for (const line of source.lines) {
        const entry = parseIncidentEntry(line, source.component);
        if (entry === null) continue;
        const occurredAt = Date.parse(entry.timestamp);
        if (occurredAt < period.earliest || occurredAt > period.latest) continue;
        const summary = grouped.get(incidentGroupKey(entry));
        if (summary !== undefined) {
          summary.count += 1;
          if (entry.timestamp < summary.firstOccurredAt) {
            summary.firstOccurredAt = entry.timestamp;
          }
        }
      }
    }

    const incidentSummaries: SupportBundleIncidentSummary[] = [];
    let projectedBytes = 2;
    for (const summary of [...grouped.values()].sort(compareSummariesNewestFirst)) {
      const summaryBytes = Buffer.byteLength(JSON.stringify(summary), 'utf8') +
        (incidentSummaries.length === 0 ? 0 : 1);
      if (projectedBytes + summaryBytes > this.#limits.maximumProjectedBytes) {
        sourceTruncated = true;
        break;
      }
      incidentSummaries.push(summary);
      projectedBytes += summaryBytes;
    }

    return {
      incidentSummaries,
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
      !hasSupportedIncidentShape(value) ||
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

function hasSupportedIncidentShape(
  value: Record<string, unknown>,
): boolean {
  if (!Object.hasOwn(value, 'schemaVersion')) {
    return hasOnlyKeys(value, legacyIncidentSourceKeys);
  }

  return (
    value.schemaVersion === 1 &&
    hasOnlyKeys(value, currentIncidentSourceKeys)
  );
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

function incidentGroupKey(entry: Pick<IncidentSourceEntry,
  'appVersion' | 'buildRevision' | 'errorCode' | 'eventName' | 'fingerprint' | 'outcome'
>): string {
  return JSON.stringify([
    entry.appVersion,
    entry.buildRevision,
    entry.errorCode,
    entry.eventName,
    entry.fingerprint,
    entry.outcome,
  ]);
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
    ? left.eventName.localeCompare(right.eventName) ||
      incidentGroupKey(left).localeCompare(incidentGroupKey(right))
    : timeComparison;
}

function retainNewestIncidentCandidates(
  candidates: Map<string, SupportBundleIncidentSummary>,
  maximum: number,
): void {
  const retained = [...candidates.values()].sort(compareSummariesNewestFirst).slice(0, maximum);
  candidates.clear();
  for (const summary of retained) {
    candidates.set(incidentGroupKey(summary), summary);
  }
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
