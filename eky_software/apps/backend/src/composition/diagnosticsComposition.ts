import type { Hono } from 'hono';

import type { DatabaseConnection } from '../database/connection/createDatabaseConnection.js';
import type { BackendEnvironment } from '../http/runtimeTrust.js';
import { listDiagnosticEvents } from '../modules/diagnostics/application/listDiagnosticEvents.js';
import { prepareSupportBundleDiagnosticData } from '../modules/diagnostics/application/prepareSupportBundleDiagnosticData.js';
import { createDiagnosticRoutes } from '../modules/diagnostics/http/diagnosticRoutes.js';
import {
  emptyDiagnosticEventReader,
  FileSystemDiagnosticEventReader,
} from '../modules/diagnostics/infrastructure/fileSystemDiagnosticEventReader.js';
import { SqliteSystemDiagnosticSummaryReader } from '../modules/diagnostics/infrastructure/sqliteSystemDiagnosticSummaryReader.js';

export function createDiagnosticsComposition(
  options: {
    appVersion: string;
    database: DatabaseConnection;
    operationalLogsRoot: string | undefined;
  },
): Hono<BackendEnvironment> {
  const reader =
    options.operationalLogsRoot === undefined
      ? emptyDiagnosticEventReader
      : new FileSystemDiagnosticEventReader(options.operationalLogsRoot);
  const systemDiagnosticSummaryReader =
    new SqliteSystemDiagnosticSummaryReader(options.database);

  return createDiagnosticRoutes({
    listDiagnosticEvents: (input) => listDiagnosticEvents(input, reader),
    prepareSupportBundleDiagnosticData: (input) =>
      prepareSupportBundleDiagnosticData(input, {
        appVersion: options.appVersion,
        diagnosticEventReader: reader,
        systemDiagnosticSummaryReader,
      }),
  });
}
