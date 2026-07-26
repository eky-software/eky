export type DiagnosticEventComponent = 'backend' | 'desktop';
export type DiagnosticEventLevel = 'error' | 'info' | 'warn';
export type DiagnosticEventOutcome =
  | 'blocked'
  | 'failure'
  | 'success'
  | 'unknown';

export interface DiagnosticEventItem {
  category: string;
  component: DiagnosticEventComponent;
  errorCode: string | null;
  eventName: string;
  id: string;
  level: DiagnosticEventLevel;
  occurredAt: string;
  outcome: DiagnosticEventOutcome;
}

