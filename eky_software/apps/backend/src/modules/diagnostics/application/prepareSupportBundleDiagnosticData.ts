import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import type { DiagnosticEventReader } from '../ports/diagnosticEventReader.js';
import type { SystemDiagnosticSummaryReader } from '../ports/systemDiagnosticSummaryReader.js';
import type { SupportBundleDiagnosticData } from '../domain/supportBundleDiagnosticData.js';

const diagnosticPeriodDays = 30;
const millisecondsPerDay = 24 * 60 * 60 * 1_000;
const maximumSupportBundleEvents = 5_000;
const readerCandidateLimit = 10_001;

export interface PrepareSupportBundleDiagnosticDataInput {
  actorContext: ActorContext;
}

interface PrepareSupportBundleDiagnosticDataDependencies {
  appVersion: string;
  diagnosticEventReader: DiagnosticEventReader;
  now?(): Date;
  systemDiagnosticSummaryReader: SystemDiagnosticSummaryReader;
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

  return {
    backendVersion: dependencies.appVersion,
    database:
      await dependencies.systemDiagnosticSummaryReader.readDatabaseSummary(),
    diagnosticEvents: eligibleEvents.slice(0, maximumSupportBundleEvents),
    diagnosticPeriodDays,
    truncated:
      candidates.length === readerCandidateLimit ||
      eligibleEvents.length > maximumSupportBundleEvents,
  };
}
