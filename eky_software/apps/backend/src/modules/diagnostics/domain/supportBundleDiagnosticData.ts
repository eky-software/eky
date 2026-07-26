import type { DiagnosticEventItem } from './diagnosticEventItem.js';

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
  truncated: boolean;
}
