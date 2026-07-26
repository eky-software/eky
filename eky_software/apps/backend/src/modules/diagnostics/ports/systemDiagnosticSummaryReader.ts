import type { DatabaseDiagnosticSummary } from '../domain/supportBundleDiagnosticData.js';

export interface SystemDiagnosticSummaryReader {
  readDatabaseSummary(): Promise<DatabaseDiagnosticSummary>;
}
