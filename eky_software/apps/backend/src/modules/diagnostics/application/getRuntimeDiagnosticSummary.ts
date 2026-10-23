import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import type {
  OperationalLogDiagnosticSummary,
  RuntimeDiagnosticSummary,
} from '../domain/runtimeDiagnosticSummary.js';
import type { OperationalLogDiagnosticSummaryReader } from '../ports/operationalLogDiagnosticSummaryReader.js';
import type { SystemDiagnosticSummaryReader } from '../ports/systemDiagnosticSummaryReader.js';
import { notConfiguredDiagnosticReadState, unavailableDiagnosticReadState } from '../domain/diagnosticReadState.js';
import type { DiagnosticReadFailureObserver } from '../ports/diagnosticReadFailureObserver.js';
import { observeDiagnosticReadFailure } from './observeDiagnosticReadFailure.js';

export interface GetRuntimeDiagnosticSummaryInput {
  actorContext: ActorContext;
}

export interface RuntimeDiagnosticIdentity {
  appVersion: string;
  architecture: string;
  buildCreatedAt: string;
  buildDirty: boolean;
  buildRevision: string;
  electronVersion: string | null;
  nodeVersion: string;
  platform: string;
  runtimeInstanceId: string;
}

interface GetRuntimeDiagnosticSummaryDependencies {
  failureObserver?: DiagnosticReadFailureObserver;
  identity: Readonly<RuntimeDiagnosticIdentity>;
  operationalLogSummaryReader: OperationalLogDiagnosticSummaryReader;
  systemDiagnosticSummaryReader?: SystemDiagnosticSummaryReader;
}

const unavailableDatabaseSummary = {
  appliedMigrationCount: null,
  databaseHealth: 'unavailable',
  latestMigrationName: null,
} as const;

export async function getRuntimeDiagnosticSummary(
  input: GetRuntimeDiagnosticSummaryInput,
  dependencies: GetRuntimeDiagnosticSummaryDependencies,
): Promise<RuntimeDiagnosticSummary> {
  requirePermission(input.actorContext, 'viewDiagnostics');

  const [database, logs] = await Promise.all([
    readDatabaseSummary(dependencies.systemDiagnosticSummaryReader),
    readOperationalLogSummary(dependencies.operationalLogSummaryReader, dependencies.failureObserver),
  ]);

  return {
    ...dependencies.identity,
    ...database,
    ...logs,
  };
}

async function readOperationalLogSummary(
  reader: OperationalLogDiagnosticSummaryReader,
  failureObserver?: DiagnosticReadFailureObserver,
): Promise<OperationalLogDiagnosticSummary> {
  try {
    return await reader.readOperationalLogSummary();
  } catch (error) {
    observeDiagnosticReadFailure(failureObserver, error);
    return unavailableOperationalLogSummary;
  }
}

async function readDatabaseSummary(
  reader: SystemDiagnosticSummaryReader | undefined,
): Promise<
  Pick<
    RuntimeDiagnosticSummary,
    'appliedMigrationCount' | 'databaseHealth' | 'latestMigrationName'
  >
> {
  if (reader === undefined) {
    return unavailableDatabaseSummary;
  }

  try {
    const summary = await reader.readDatabaseSummary();
    return {
      appliedMigrationCount: summary.appliedMigrationCount,
      databaseHealth: 'ok',
      latestMigrationName: summary.latestMigrationName,
    };
  } catch {
    return {
      appliedMigrationCount: null,
      databaseHealth: 'failed',
      latestMigrationName: null,
    };
  }
}

export const unavailableOperationalLogSummary: OperationalLogDiagnosticSummary =
  Object.freeze({
    operationalLogReadState: unavailableDiagnosticReadState,
    latestErrorAt: null,
    latestSecurityEventAt: null,
    latestWarningAt: null,
    operationalLogNewestMonth: null,
    operationalLogOldestMonth: null,
    operationalLogsAvailable: false,
    operationalLogTotalBytes: 0,
  });

export const notConfiguredOperationalLogSummary: OperationalLogDiagnosticSummary = Object.freeze({
  ...unavailableOperationalLogSummary, operationalLogReadState: notConfiguredDiagnosticReadState,
});
