import type { DiagnosticEventItem } from '../domain/diagnosticEventItem.js';

export interface DiagnosticEventReader {
  listRecentDiagnosticEvents(limit: number): Promise<DiagnosticEventItem[]>;
}

