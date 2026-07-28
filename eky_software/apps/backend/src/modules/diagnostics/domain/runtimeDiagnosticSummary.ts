import type { DatabaseDiagnosticSummary } from './supportBundleDiagnosticData.js';

export type DatabaseDiagnosticHealth = 'failed' | 'ok' | 'unavailable';

export interface OperationalLogDiagnosticSummary {
  latestErrorAt: string | null;
  latestSecurityEventAt: string | null;
  latestWarningAt: string | null;
  operationalLogNewestMonth: string | null;
  operationalLogOldestMonth: string | null;
  operationalLogsAvailable: boolean;
  operationalLogTotalBytes: number;
}

export interface RuntimeDiagnosticSummary
  extends OperationalLogDiagnosticSummary {
  appVersion: string;
  appliedMigrationCount: number | null;
  architecture: string;
  buildCreatedAt: string;
  buildDirty: boolean;
  buildRevision: string;
  databaseHealth: DatabaseDiagnosticHealth;
  electronVersion: string | null;
  latestMigrationName: string | null;
  nodeVersion: string;
  platform: string;
  runtimeInstanceId: string;
}

export function toDatabaseDiagnosticSummary(
  summary: RuntimeDiagnosticSummary,
): DatabaseDiagnosticSummary | null {
  return summary.databaseHealth === 'ok' &&
    summary.appliedMigrationCount !== null
    ? {
        appliedMigrationCount: summary.appliedMigrationCount,
        health: 'ok',
        latestMigrationName: summary.latestMigrationName,
      }
    : null;
}
