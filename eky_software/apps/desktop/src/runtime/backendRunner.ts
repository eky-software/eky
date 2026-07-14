import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseDesktopBackendCommand } from './backendMessages.js';
import type { DesktopBackendFailureCode } from './backendMessages.js';
import { CompanyEmailSecretBrokerClient } from '../secrets/secretBrokerClient.js';
import { createUtilitySecretBrokerTransport } from '../secrets/electronSecretBrokerTransport.js';

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
  runtimeTrust: {
    mode: 'localSession';
    sessionSecret: string;
  };
}) => Promise<StartedBackendServer>;

let backendServer: StartedBackendServer | undefined;
let secretBrokerClient: CompanyEmailSecretBrokerClient | undefined;
let startAttempted = false;
const utilityParentPort = process.parentPort;

async function verifySecretBroker(
  client: CompanyEmailSecretBrokerClient,
): Promise<boolean> {
  const companyId = `desktop-smoke-${randomUUID()}`;
  const secret = `eky-safe-storage-smoke-${randomBytes(32).toString('base64url')}`;

  try {
    await client.setSecret({ companyId, secret });

    if (!(await client.hasSecret(companyId))) {
      return false;
    }

    if ((await client.getSecret(companyId)) !== secret) {
      return false;
    }

    await client.removeSecret(companyId);

    return !(await client.hasSecret(companyId));
  } finally {
    await client.removeSecret(companyId).catch(() => undefined);
  }
}

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
    void (async () => {
      await backendServer?.close();
      secretBrokerClient?.close();
      process.exit(0);
    })();
    return;
  }

  if (command?.type !== 'start' || startAttempted) {
    return;
  }

  startAttempted = true;

  void (async () => {
    let failureCode: DesktopBackendFailureCode = 'BACKEND_MODULE_IMPORT_FAILED';

    try {
      const brokerPort = event.ports[0];

      if (event.ports.length !== 1 || brokerPort === undefined) {
        failureCode = 'BACKEND_SECRET_BROKER_FAILED';
        throw new Error('Secret broker port is unavailable.');
      }

      secretBrokerClient = new CompanyEmailSecretBrokerClient(
        createUtilitySecretBrokerTransport(brokerPort),
      );

      const serverModule = (await import(
        pathToFileURL(join(command.config.backendRoot, 'dist/http/server.js')).href
      )) as { startServer?: StartServer };

      if (typeof serverModule.startServer !== 'function') {
        throw new Error('Backend start function is unavailable.');
      }

      let smokeSecretBrokerVerified = false;

      if (command.config.createSmokePdf) {
        failureCode = 'BACKEND_SECRET_BROKER_FAILED';
        smokeSecretBrokerVerified = await verifySecretBroker(secretBrokerClient);

        if (!smokeSecretBrokerVerified) {
          throw new Error('Secret broker smoke check failed.');
        }
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
        runtimeTrust: {
          mode: 'localSession',
          sessionSecret: command.config.runtimeSessionSecret,
        },
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
        smokeSecretBrokerVerified,
        type: 'ready',
      });
    } catch {
      secretBrokerClient?.close();
      utilityParentPort.postMessage({ code: failureCode, type: 'failed' });
    }
  })();
});
