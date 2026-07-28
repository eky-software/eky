import type { OperationalLogDiagnosticSummary } from '../domain/runtimeDiagnosticSummary.js';

export interface OperationalLogDiagnosticSummaryReader {
  readOperationalLogSummary(): Promise<OperationalLogDiagnosticSummary>;
}
