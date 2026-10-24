import type { DiagnosticBrowseQuery, DiagnosticEventPage } from '../domain/diagnosticEventPage.js';

export interface DiagnosticEventReader {
  browseDiagnosticEvents(query: DiagnosticBrowseQuery, actor: string): Promise<DiagnosticEventPage>;
  close(): Promise<void>;
}

