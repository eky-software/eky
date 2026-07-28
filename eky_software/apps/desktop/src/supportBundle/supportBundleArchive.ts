import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import type {
  SupportBundleBackendData,
  SupportBundleDiagnosticEvent,
  SupportBundleIncidentSummary,
} from './supportBundleBackendData.js';
import { supportBundleSizeBudget } from './supportBundleSizeBudget.js';

export const supportBundleFormatVersion = 2;
export const maximumUncompressedSupportBundleBytes =
  supportBundleSizeBudget.maximumUncompressedBytes;

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
  const creationCorrelationId =
    input.creationCorrelationId ?? randomUUID();
  const system = {
    appVersion: input.appVersion,
    architecture: input.architecture,
    backendVersion: input.backendData.backendVersion,
    platform: input.platform,
  };
  const database = input.backendData.database;
  const runtimeSummary = input.backendData.runtimeSummary;
  const diagnosticFit = fitNewestItemsToBytes(
    input.backendData.diagnosticEvents,
    supportBundleSizeBudget.diagnosticEventsBytes,
  );
  const incidentFit = fitNewestItemsToBytes(
    input.backendData.incidentSummaries,
    supportBundleSizeBudget.incidentSummariesBytes,
  );
  const coreDocument = createDocument({
    createdAt,
    creationCorrelationId,
    database,
    diagnosticEvents: [],
    diagnosticEventsTruncated: true,
    diagnosticPeriodDays: input.backendData.diagnosticPeriodDays,
    incidentSummaries: [],
    incidentSummariesTruncated: true,
    runtimeSummary,
    system,
  });

  if (serializedByteLength(coreDocument) > maximumUncompressedSupportBundleBytes) {
    throw new Error('SUPPORT_BUNDLE_CORE_TOO_LARGE');
  }

  let diagnosticEvents = diagnosticFit.items;
  let incidentSummaries = incidentFit.items;
  let diagnosticEventsTruncated =
    input.backendData.truncated || diagnosticFit.truncated;
  let incidentSummariesTruncated =
    input.backendData.incidentSummariesTruncated ||
    incidentFit.truncated;
  let document = createDocument({
    createdAt,
    creationCorrelationId,
    database,
    diagnosticEvents,
    diagnosticEventsTruncated,
    diagnosticPeriodDays: input.backendData.diagnosticPeriodDays,
    incidentSummaries,
    incidentSummariesTruncated,
    runtimeSummary,
    system,
  });

  if (serializedByteLength(document) > maximumUncompressedSupportBundleBytes) {
    diagnosticEvents = findLargestFittingPrefix(
      diagnosticEvents,
      (candidateEvents) =>
        createDocument({
          createdAt,
          creationCorrelationId,
          database,
          diagnosticEvents: candidateEvents,
          diagnosticEventsTruncated: true,
          diagnosticPeriodDays: input.backendData.diagnosticPeriodDays,
          incidentSummaries,
          incidentSummariesTruncated,
          runtimeSummary,
          system,
        }),
    );
    diagnosticEventsTruncated = true;
    document = createDocument({
      createdAt,
      creationCorrelationId,
      database,
      diagnosticEvents,
      diagnosticEventsTruncated,
      diagnosticPeriodDays: input.backendData.diagnosticPeriodDays,
      incidentSummaries,
      incidentSummariesTruncated,
      runtimeSummary,
      system,
    });
  }

  if (serializedByteLength(document) > maximumUncompressedSupportBundleBytes) {
    diagnosticEvents = [];
    diagnosticEventsTruncated = true;
    incidentSummaries = findLargestFittingPrefix(
      incidentSummaries,
      (candidateSummaries) =>
        createDocument({
          createdAt,
          creationCorrelationId,
          database,
          diagnosticEvents,
          diagnosticEventsTruncated,
          diagnosticPeriodDays: input.backendData.diagnosticPeriodDays,
          incidentSummaries: candidateSummaries,
          incidentSummariesTruncated: true,
          runtimeSummary,
          system,
        }),
    );
    incidentSummariesTruncated = true;
    document = createDocument({
      createdAt,
      creationCorrelationId,
      database,
      diagnosticEvents,
      diagnosticEventsTruncated,
      diagnosticPeriodDays: input.backendData.diagnosticPeriodDays,
      incidentSummaries,
      incidentSummariesTruncated,
      runtimeSummary,
      system,
    });
  }
  const uncompressed = Buffer.from(JSON.stringify(document), 'utf8');

  if (uncompressed.byteLength > maximumUncompressedSupportBundleBytes) {
    throw new Error('SUPPORT_BUNDLE_CORE_TOO_LARGE');
  }

  return {
    compressed: gzipSync(uncompressed),
    fileName: createSupportBundleFileName(createdAt),
  };
}

function createDocument(input: {
  createdAt: Date;
  creationCorrelationId: string;
  database: SupportBundleBackendData['database'];
  diagnosticEvents: readonly SupportBundleDiagnosticEvent[];
  diagnosticEventsTruncated: boolean;
  diagnosticPeriodDays: 30;
  incidentSummaries: readonly SupportBundleIncidentSummary[];
  incidentSummariesTruncated: boolean;
  runtimeSummary: SupportBundleBackendData['runtimeSummary'];
  system: {
    appVersion: string;
    architecture: string;
    backendVersion: string;
    platform: string;
  };
}) {
  const operationalSummary = createOperationalSummary(
    input.diagnosticEvents,
  );

  return {
    manifest: {
      createdAt: input.createdAt.toISOString(),
      creationCorrelationId: input.creationCorrelationId,
      diagnosticPeriodDays: input.diagnosticPeriodDays,
      sectionChecksums: {
        database: checksum(input.database),
        diagnosticEvents: checksum(input.diagnosticEvents),
        incidentSummaries: checksum(input.incidentSummaries),
        operationalSummary: checksum(operationalSummary),
        runtimeSummary: checksum(input.runtimeSummary),
        system: checksum(input.system),
      },
      supportBundleFormatVersion,
      truncatedSections: [
        ...(input.diagnosticEventsTruncated
          ? ['diagnosticEvents']
          : []),
        ...(input.incidentSummariesTruncated
          ? ['incidentSummaries']
          : []),
      ],
    },
    system: input.system,
    database: input.database,
    operationalSummary,
    runtimeSummary: input.runtimeSummary,
    incidentSummaries: input.incidentSummaries,
    diagnosticEvents: input.diagnosticEvents,
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

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function checksum(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function fitNewestItemsToBytes<Item>(
  items: readonly Item[],
  maximumBytes: number,
): { items: Item[]; truncated: boolean } {
  const fittedItems = findLargestPrefixWithinBytes(items, maximumBytes);

  return {
    items: fittedItems,
    truncated: fittedItems.length < items.length,
  };
}

function findLargestPrefixWithinBytes<Item>(
  items: readonly Item[],
  maximumBytes: number,
): Item[] {
  let lowerBound = 0;
  let upperBound = items.length;

  while (lowerBound < upperBound) {
    const candidateLength = Math.ceil((lowerBound + upperBound) / 2);
    const candidate = items.slice(0, candidateLength);

    if (serializedByteLength(candidate) <= maximumBytes) {
      lowerBound = candidateLength;
    } else {
      upperBound = candidateLength - 1;
    }
  }

  return items.slice(0, lowerBound);
}

function findLargestFittingPrefix<Item, Document>(
  items: readonly Item[],
  createCandidateDocument: (candidateItems: readonly Item[]) => Document,
): Item[] {
  let lowerBound = 0;
  let upperBound = items.length;

  while (lowerBound < upperBound) {
    const candidateLength = Math.ceil((lowerBound + upperBound) / 2);
    const candidateItems = items.slice(0, candidateLength);
    const candidateDocument = createCandidateDocument(candidateItems);

    if (
      serializedByteLength(candidateDocument) <=
      maximumUncompressedSupportBundleBytes
    ) {
      lowerBound = candidateLength;
    } else {
      upperBound = candidateLength - 1;
    }
  }

  return items.slice(0, lowerBound);
}

function serializedByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}
