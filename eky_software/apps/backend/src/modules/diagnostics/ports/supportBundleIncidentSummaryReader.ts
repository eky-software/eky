import type { SupportBundleIncidentSummary } from '../domain/supportBundleIncidentSummary.js';

export interface SupportBundleIncidentSummaryReadResult {
  incidentSummaries: SupportBundleIncidentSummary[];
  sourceTruncated: boolean;
}

export interface SupportBundleIncidentSummaryReader {
  readSupportBundleIncidentSummaries(input: {
    earliestTimestamp: string;
    latestTimestamp: string;
  }): Promise<SupportBundleIncidentSummaryReadResult>;
}
