import type { Hono } from 'hono';

import type { BackendEnvironment } from '../http/runtimeTrust.js';
import { listDiagnosticEvents } from '../modules/diagnostics/application/listDiagnosticEvents.js';
import { createDiagnosticRoutes } from '../modules/diagnostics/http/diagnosticRoutes.js';
import {
  emptyDiagnosticEventReader,
  FileSystemDiagnosticEventReader,
} from '../modules/diagnostics/infrastructure/fileSystemDiagnosticEventReader.js';

export function createDiagnosticsComposition(
  operationalLogsRoot: string | undefined,
): Hono<BackendEnvironment> {
  const reader =
    operationalLogsRoot === undefined
      ? emptyDiagnosticEventReader
      : new FileSystemDiagnosticEventReader(operationalLogsRoot);

  return createDiagnosticRoutes({
    listDiagnosticEvents: (input) => listDiagnosticEvents(input, reader),
  });
}

