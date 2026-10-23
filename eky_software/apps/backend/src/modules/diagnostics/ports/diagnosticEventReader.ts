import type { DiagnosticEventReadResult } from '../domain/diagnosticEventReadResult.js';

export interface DiagnosticEventReader {
  listRecentDiagnosticEvents(limit: number): Promise<DiagnosticEventReadResult>;
}

