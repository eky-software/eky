import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import type { SupportBundleDiagnosticData } from '../domain/supportBundleDiagnosticData.js';
import type { SupportBundleDiagnosticEventReader } from '../ports/supportBundleDiagnosticEventReader.js';
import {
  toDatabaseDiagnosticSummary,
  type RuntimeDiagnosticSummary,
} from '../domain/runtimeDiagnosticSummary.js';

const diagnosticPeriodDays = 30;
const millisecondsPerDay = 24 * 60 * 60 * 1_000;
export interface PrepareSupportBundleDiagnosticDataInput {
  actorContext: ActorContext;
}

interface PrepareSupportBundleDiagnosticDataDependencies {
  supportBundleDiagnosticEventReader: SupportBundleDiagnosticEventReader;
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
  const diagnosticReadResult =
    await dependencies.supportBundleDiagnosticEventReader.readSupportBundleDiagnosticEvents(
      {
        earliestTimestamp,
        latestTimestamp: now.toISOString(),
      },
    );
  const runtimeSummary = await dependencies.getRuntimeDiagnosticSummary();
  const database = toDatabaseDiagnosticSummary(runtimeSummary);
  if (database === null) {
    throw new Error('DATABASE_DIAGNOSTIC_SUMMARY_UNAVAILABLE');
  }

  return {
    backendVersion: runtimeSummary.appVersion,
    database,
    diagnosticEvents: diagnosticReadResult.diagnosticEvents,
    diagnosticPeriodDays,
    runtimeSummary,
    truncated: diagnosticReadResult.sourceTruncated,
  };
}
