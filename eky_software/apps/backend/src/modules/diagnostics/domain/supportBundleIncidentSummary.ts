export interface SupportBundleIncidentSummary {
  appVersion: string;
  buildRevision: string;
  count: number;
  errorCode: string;
  eventName: string;
  fingerprint: string;
  firstOccurredAt: string;
  lastOccurredAt: string;
  outcome: 'blocked' | 'failure' | 'unknown';
}
