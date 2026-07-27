export type DiagnosticEventComponent = 'backend' | 'desktop';
export type DiagnosticEventLevel = 'error' | 'info' | 'warn';
export type DiagnosticEventOutcome =
  | 'blocked'
  | 'failure'
  | 'success'
  | 'unknown';
export type DiagnosticEventSideEffectState =
  | 'committed'
  | 'none'
  | 'rolledBack'
  | 'unknown';

export interface DiagnosticEventItem {
  appVersion?: string;
  buildRevision?: string;
  category: string;
  component: DiagnosticEventComponent;
  correlationId?: string;
  durationMs?: number;
  errorCode: string | null;
  eventName: string;
  fingerprint?: string;
  id: string;
  level: DiagnosticEventLevel;
  occurredAt: string;
  operationId?: string;
  outcome: DiagnosticEventOutcome;
  retryable?: boolean;
  runtimeInstanceId?: string;
  sideEffectState?: DiagnosticEventSideEffectState;
  stage?: string;
}
