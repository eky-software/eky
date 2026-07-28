import type { Hono } from 'hono';

import type { DatabaseConnection } from '../database/connection/createDatabaseConnection.js';
import type { BackendEnvironment } from '../http/runtimeTrust.js';
import { listDiagnosticEvents } from '../modules/diagnostics/application/listDiagnosticEvents.js';
import { getRuntimeDiagnosticSummary } from '../modules/diagnostics/application/getRuntimeDiagnosticSummary.js';
import { prepareSupportBundleDiagnosticData } from '../modules/diagnostics/application/prepareSupportBundleDiagnosticData.js';
import { createDiagnosticRoutes } from '../modules/diagnostics/http/diagnosticRoutes.js';
import {
  emptyDiagnosticEventReader,
  FileSystemDiagnosticEventReader,
} from '../modules/diagnostics/infrastructure/fileSystemDiagnosticEventReader.js';
import { SqliteSystemDiagnosticSummaryReader } from '../modules/diagnostics/infrastructure/sqliteSystemDiagnosticSummaryReader.js';
import {
  FileSystemOperationalLogDiagnosticSummaryReader,
} from '../modules/diagnostics/infrastructure/fileSystemOperationalLogDiagnosticSummaryReader.js';
import {
  unavailableOperationalLogSummary,
} from '../modules/diagnostics/application/getRuntimeDiagnosticSummary.js';
import type { OperationalRuntimeIdentity } from '../observability/operationalEvent.js';

export function createDiagnosticsComposition(
  options: {
    buildCreatedAt: string;
    buildDirty: boolean;
    database: DatabaseConnection;
    electronVersion: string | null;
    operationalIdentity: Readonly<OperationalRuntimeIdentity>;
    operationalLogsRoot: string | undefined;
    runtimeArchitecture: string;
    runtimeNodeVersion: string;
    runtimePlatform: string;
  },
): Hono<BackendEnvironment> {
  const reader =
    options.operationalLogsRoot === undefined
      ? emptyDiagnosticEventReader
      : new FileSystemDiagnosticEventReader(options.operationalLogsRoot);
  const systemDiagnosticSummaryReader =
    new SqliteSystemDiagnosticSummaryReader(options.database);
  const operationalLogSummaryReader =
    options.operationalLogsRoot === undefined
      ? {
          async readOperationalLogSummary() {
            return unavailableOperationalLogSummary;
          },
        }
      : new FileSystemOperationalLogDiagnosticSummaryReader(
          options.operationalLogsRoot,
        );
  const readRuntimeSummary = (actorContext: Parameters<
    typeof getRuntimeDiagnosticSummary
  >[0]['actorContext']) =>
    getRuntimeDiagnosticSummary(
      { actorContext },
      {
        identity: {
          ...options.operationalIdentity,
          architecture: options.runtimeArchitecture,
          buildCreatedAt: options.buildCreatedAt,
          buildDirty: options.buildDirty,
          electronVersion: options.electronVersion,
          nodeVersion: options.runtimeNodeVersion,
          platform: options.runtimePlatform,
        },
        operationalLogSummaryReader,
        systemDiagnosticSummaryReader,
      },
    );

  return createDiagnosticRoutes({
    getRuntimeDiagnosticSummary: (input) =>
      readRuntimeSummary(input.actorContext),
    listDiagnosticEvents: (input) => listDiagnosticEvents(input, reader),
    prepareSupportBundleDiagnosticData: (input) =>
      prepareSupportBundleDiagnosticData(input, {
        diagnosticEventReader: reader,
        getRuntimeDiagnosticSummary: () =>
          readRuntimeSummary(input.actorContext),
      }),
  });
}
