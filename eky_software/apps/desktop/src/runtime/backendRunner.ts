import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseDesktopBackendCommand } from './backendMessages.js';
import type { DesktopBackendFailureCode } from './backendMessages.js';

interface StartedBackendServer {
  close(): Promise<void>;
  port: number;
}

type StartServer = (options: {
  appOptions: {
    databaseFilePath: string;
    invoiceDocumentStorageRoot: string;
    migrationsDirectory: string;
  };
  hostname: string;
  port: number;
}) => Promise<StartedBackendServer>;

let backendServer: StartedBackendServer | undefined;
let startAttempted = false;
const utilityParentPort = process.parentPort;

async function createSmokePdf(
  backendRoot: string,
  smokePdfPath: string,
): Promise<boolean> {
  const rendererModule = (await import(
    pathToFileURL(
      join(
        backendRoot,
        'dist/modules/invoicing/infrastructure/pdf/approvedInvoicePdfRenderer.js',
      ),
    ).href
  )) as { renderApprovedInvoicePdf?: (invoice: unknown) => Promise<Uint8Array> };
  const sampleModule = (await import(
    pathToFileURL(
      join(
        backendRoot,
        'dist/modules/invoicing/infrastructure/pdf/approvedInvoicePdfSample.js',
      ),
    ).href
  )) as { createApprovedInvoicePdfSample?: () => unknown };

  if (
    typeof rendererModule.renderApprovedInvoicePdf !== 'function' ||
    typeof sampleModule.createApprovedInvoicePdfSample !== 'function'
  ) {
    return false;
  }

  const content = await rendererModule.renderApprovedInvoicePdf(
    sampleModule.createApprovedInvoicePdfSample(),
  );

  if (new TextDecoder().decode(content.slice(0, 4)) !== '%PDF') {
    return false;
  }

  await mkdir(dirname(smokePdfPath), { recursive: true });
  await writeFile(smokePdfPath, content);

  return true;
}

utilityParentPort.on('message', (event) => {
  const command = parseDesktopBackendCommand(event.data);

  if (command?.type === 'shutdown') {
    void backendServer?.close().finally(() => process.exit(0));
    return;
  }

  if (command?.type !== 'start' || startAttempted) {
    return;
  }

  startAttempted = true;

  void (async () => {
    let failureCode: DesktopBackendFailureCode = 'BACKEND_MODULE_IMPORT_FAILED';

    try {
      const serverModule = (await import(
        pathToFileURL(join(command.config.backendRoot, 'dist/http/server.js')).href
      )) as { startServer?: StartServer };

      if (typeof serverModule.startServer !== 'function') {
        throw new Error('Backend start function is unavailable.');
      }

      failureCode = 'BACKEND_SERVER_START_FAILED';
      backendServer = await serverModule.startServer({
        appOptions: {
          databaseFilePath: command.config.databaseFilePath,
          invoiceDocumentStorageRoot: command.config.invoiceDocumentStorageRoot,
          migrationsDirectory: command.config.migrationsDirectory,
        },
        hostname: '127.0.0.1',
        port: 0,
      });
      let smokePdfCreated = false;

      if (command.config.createSmokePdf) {
        failureCode = 'BACKEND_SMOKE_PDF_FAILED';
        smokePdfCreated = await createSmokePdf(
          command.config.backendRoot,
          command.config.smokePdfPath,
        );

        if (!smokePdfCreated) {
          throw new Error('Smoke PDF was not created.');
        }
      }

      utilityParentPort.postMessage({
        port: backendServer.port,
        smokePdfCreated,
        type: 'ready',
      });
    } catch {
      utilityParentPort.postMessage({ code: failureCode, type: 'failed' });
    }
  })();
});
