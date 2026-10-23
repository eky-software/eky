import type { DiagnosticEventItem } from './diagnosticEventItem.js';
import type { DiagnosticReadState } from './diagnosticReadState.js';

export interface DiagnosticEventReadResult {
  diagnosticEvents: DiagnosticEventItem[];
  readState: DiagnosticReadState;
}
