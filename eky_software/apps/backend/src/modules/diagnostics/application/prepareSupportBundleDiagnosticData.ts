import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import type { DiagnosticEventReader } from '../ports/diagnosticEventReader.js';
import type { SupportBundleDiagnosticData } from '../domain/supportBundleDiagnosticData.js';
import {
  toDatabaseDiagnosticSummary,
  type RuntimeDiagnosticSummary,
} from '../domain/runtimeDiagnosticSummary.js';

const diagnosticPeriodDays = 30;
const millisecondsPerDay = 24 * 60 * 60 * 1_000;
const maximumSupportBundleEvents = 5_000;
const readerCandidateLimit = 10_001;

export interface PrepareSupportBundleDiagnosticDataInput {
  actorContext: ActorContext;
}

interface PrepareSupportBundleDiagnosticDataDependencies {
  diagnosticEventReader: DiagnosticEventReader;
  getRuntimeDiagnosticSummary(): Promise<RuntimeDiagnosticSummary>;
  now?(): Date;
}

export async function prepareSupportBundleDiagnosticData(
  input: PrepareSupportBundleDiagnosticDataInput,
  dependencies: PrepareSupportBundleDiagnosticDataDependencies,
): Promise<SupportBundleDiagnosticData> {
  requirePermission(input.actorContext, 'createSupportBundle');

  const now = dependencies.now?.() ?? new Date();
  const earliestTimestamp = new Date(
    now.getTime() - diagnosticPeriodDays * millisecondsPerDay,
  ).toISOString();
  const candidates =
    await dependencies.diagnosticEventReader.listRecentDiagnosticEvents(
      readerCandidateLimit,
    );
  const eligibleEvents = candidates.filter(
    (event) =>
      event.occurredAt >= earliestTimestamp &&
      (event.level === 'error' ||
        event.level === 'warn' ||
        event.category === 'security'),
  );
  const runtimeSummary = await dependencies.getRuntimeDiagnosticSummary();
  const database = toDatabaseDiagnosticSummary(runtimeSummary);
  if (database === null) {
    throw new Error('DATABASE_DIAGNOSTIC_SUMMARY_UNAVAILABLE');
  }

  return {
    backendVersion: runtimeSummary.appVersion,
    database,
    diagnosticEvents: eligibleEvents.slice(0, maximumSupportBundleEvents),
    diagnosticPeriodDays,
    runtimeSummary,
    truncated:
      candidates.length === readerCandidateLimit ||
      eligibleEvents.length > maximumSupportBundleEvents,
  };
}
