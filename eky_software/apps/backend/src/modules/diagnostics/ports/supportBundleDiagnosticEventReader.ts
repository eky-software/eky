import type { DiagnosticEventItem } from '../domain/diagnosticEventItem.js';

export interface SupportBundleDiagnosticEventReadResult {
  diagnosticEvents: DiagnosticEventItem[];
  sourceTruncated: boolean;
}

export interface SupportBundleDiagnosticEventReader {
  readSupportBundleDiagnosticEvents(input: {
    earliestTimestamp: string;
    latestTimestamp: string;
  }): Promise<SupportBundleDiagnosticEventReadResult>;
}
