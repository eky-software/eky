import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import type {
  SupportBundleBackendData,
  SupportBundleDiagnosticEvent,
} from './supportBundleBackendData.js';

export const supportBundleFormatVersion = 1;
export const maximumUncompressedSupportBundleBytes = 25 * 1024 * 1024;

interface CreateSupportBundleArchiveInput {
  appVersion: string;
  architecture: string;
  backendData: SupportBundleBackendData;
  createdAt?: Date;
  creationCorrelationId?: string;
  platform: string;
}

export interface SupportBundleArchive {
  compressed: Buffer;
  fileName: string;
}

export function createSupportBundleArchive(
  input: CreateSupportBundleArchiveInput,
): SupportBundleArchive {
  const createdAt = input.createdAt ?? new Date();
  const system = {
    appVersion: input.appVersion,
    architecture: input.architecture,
    backendVersion: input.backendData.backendVersion,
    platform: input.platform,
  };
  const database = input.backendData.database;
  const runtimeSummary = input.backendData.runtimeSummary;
  const operationalSummary = createOperationalSummary(
    input.backendData.diagnosticEvents,
  );
  const incidentSummaries = createIncidentSummaries(
    input.backendData.diagnosticEvents,
  );
  const diagnosticEvents = input.backendData.diagnosticEvents;
  const document = {
    manifest: {
      createdAt: createdAt.toISOString(),
      creationCorrelationId:
        input.creationCorrelationId ?? randomUUID(),
      diagnosticPeriodDays: input.backendData.diagnosticPeriodDays,
      sectionChecksums: {
        database: checksum(database),
        diagnosticEvents: checksum(diagnosticEvents),
        incidentSummaries: checksum(incidentSummaries),
        operationalSummary: checksum(operationalSummary),
        runtimeSummary: checksum(runtimeSummary),
        system: checksum(system),
      },
      supportBundleFormatVersion,
      truncatedSections: input.backendData.truncated
        ? ['diagnosticEvents']
        : [],
    },
    system,
    database,
    operationalSummary,
    runtimeSummary,
    incidentSummaries,
    diagnosticEvents,
  };
  const uncompressed = Buffer.from(JSON.stringify(document), 'utf8');

  if (uncompressed.byteLength > maximumUncompressedSupportBundleBytes) {
    throw new Error('SUPPORT_BUNDLE_TOO_LARGE');
  }

  return {
    compressed: gzipSync(uncompressed),
    fileName: createSupportBundleFileName(createdAt),
  };
}

export function createSupportBundleFileName(createdAt: Date): string {
  return `eky-support-${createdAt.toISOString().slice(0, 10)}.ekysupport`;
}

function createOperationalSummary(
  events: readonly SupportBundleDiagnosticEvent[],
) {
  return {
    eventCount: events.length,
    byComponent: {
      backend: events.filter(({ component }) => component === 'backend').length,
      desktop: events.filter(({ component }) => component === 'desktop').length,
    },
    byLevel: {
      error: events.filter(({ level }) => level === 'error').length,
      info: events.filter(({ level }) => level === 'info').length,
      warn: events.filter(({ level }) => level === 'warn').length,
    },
  };
}

function createIncidentSummaries(
  events: readonly SupportBundleDiagnosticEvent[],
) {
  const counts = new Map<
    string,
    {
      count: number;
      errorCode: string | null;
      eventName: string;
      outcome: SupportBundleDiagnosticEvent['outcome'];
    }
  >();

  for (const event of events) {
    const key = `${event.eventName}\u0000${event.errorCode ?? ''}\u0000${event.outcome}`;
    const existing = counts.get(key);
    if (existing === undefined) {
      counts.set(key, {
        count: 1,
        errorCode: event.errorCode,
        eventName: event.eventName,
        outcome: event.outcome,
      });
    } else {
      existing.count += 1;
    }
  }

  return [...counts.values()].sort((left, right) => {
    const countComparison = right.count - left.count;
    return countComparison === 0
      ? left.eventName.localeCompare(right.eventName)
      : countComparison;
  });
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function checksum(value: unknown): string {
  return sha256(JSON.stringify(value));
}
