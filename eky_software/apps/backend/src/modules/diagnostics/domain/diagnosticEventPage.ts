import type { DiagnosticEventItem } from './diagnosticEventItem.js';
import type { DiagnosticReadState } from './diagnosticReadState.js';

export type DiagnosticPageDirection = { state: 'available'; cursor: string }
  | { state: 'end' | 'unknown' };
export type DiagnosticEventPage =
  | { state: 'scanning'; cursor: string }
  | { state: 'ready'; diagnosticEvents: DiagnosticEventItem[];
      readState: Exclude<DiagnosticReadState, { status: 'unavailable' }>;
      older: DiagnosticPageDirection; newer: DiagnosticPageDirection }
  | { state: 'limited'; diagnosticEvents: [];
      readState: { status: 'partial'; reasons: readonly ['limitReached'] } }
  | { state: 'unavailable'; diagnosticEvents: [];
      readState: Extract<DiagnosticReadState, { status: 'unavailable' }> };

export type DiagnosticReadyPage = Extract<DiagnosticEventPage, { state: 'ready' }>;
export type DiagnosticBrowseQuery = { limit: number; cursor?: never }
  | { cursor: string; limit?: never };
