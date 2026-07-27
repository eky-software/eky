import type { DiagnosticEventItem } from './diagnosticEventItem.js';
import type { RuntimeDiagnosticSummary } from './runtimeDiagnosticSummary.js';

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
  runtimeSummary: RuntimeDiagnosticSummary;
  truncated: boolean;
}
