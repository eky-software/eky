import type { DiagnosticEventItem } from './diagnosticEventItem.js';
import type { RuntimeDiagnosticSummary } from './runtimeDiagnosticSummary.js';
import type { SupportBundleIncidentSummary } from './supportBundleIncidentSummary.js';

export interface DatabaseDiagnosticSummary {
  appliedMigrationCount: number;
  health: 'ok';
  latestMigrationName: string | null;
}

export interface SupportBundleDiagnosticData {
  backendVersion: string;
  database: DatabaseDiagnosticSummary;
  diagnosticEvents: DiagnosticEventItem[];
  diagnosticPeriodDays: number;
  incidentSummaries: SupportBundleIncidentSummary[];
  incidentSummariesTruncated: boolean;
  runtimeSummary: RuntimeDiagnosticSummary;
  truncated: boolean;
}
