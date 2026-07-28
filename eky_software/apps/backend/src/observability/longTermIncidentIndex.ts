export interface LongTermIncidentIndexEntry {
  schemaVersion: 1;
  appVersion: string;
  buildRevision: string;
  component: 'backend';
  errorCode: string;
  eventName: string;
  fingerprint: string;
  outcome: 'blocked' | 'failure' | 'unknown';
  timestamp: string;
}

export interface LongTermIncidentIndex {
  write(entry: LongTermIncidentIndexEntry): void;
}
