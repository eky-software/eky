import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CompanyEmailSecretBrokerClient } from '../src/secrets/secretBrokerClient.js';
import { createUtilitySecretBrokerTransport } from '../src/secrets/electronSecretBrokerTransport.js';
import { InvoicePdfArchiveBrokerClient } from '../src/invoicePdfArchive/invoicePdfArchiveBrokerClient.js';
import { createInvoicePdfArchiveBrokerTransport } from '../src/invoicePdfArchive/electronInvoicePdfArchiveBrokerTransport.js';
import { startProfileSnapshotBrokerBackend } from '../src/profileBackup/profileSnapshotBrokerBackend.js';
import { createProfileSnapshotBrokerTransport } from '../src/profileBackup/electronProfileSnapshotBrokerTransport.js';
import {
  parseDesktopBackendCommand,
  type DesktopBackendStartMessage,
} from '../src/runtime/backendMessages.js';
import type { ElectronE2eBackendStartupStage } from './electronE2eBackendStatus.js';

interface E2eBackendServer {
  close(): Promise<void>;
  port: number;
}

interface StartE2eBackend {
  (
    configPath: string,
    options: {
      companyEmailSecretReader: CompanyEmailSecretBrokerClient;
      companyEmailSecretStore: CompanyEmailSecretBrokerClient;
      deliveredInvoiceArchiveTaskSink: InvoicePdfArchiveBrokerClient;
      profileSnapshotStagingRoot: string;
      runtimePaths: {
        databaseFilePath: string;
        documentsRoot: string;
        logsRoot: string;
      };
      runtimeSessionSecret: string;
      runtimeInstanceId: string;
    },
  ): Promise<{
    profileSnapshotRuntime?: {
      maintenance: Parameters<
        typeof startProfileSnapshotBrokerBackend
      >[0]['maintenance'];
      service: Parameters<
        typeof startProfileSnapshotBrokerBackend
      >[0]['snapshot'];
    };
    server: E2eBackendServer;
  }>;
}

const parentPort = process.parentPort;
let server: E2eBackendServer | undefined;
let secretBrokerClient: CompanyEmailSecretBrokerClient | undefined;
let invoicePdfArchiveBrokerClient: InvoicePdfArchiveBrokerClient | undefined;
let profileSnapshotBrokerHandle: { close(): void } | undefined;
let startAttempted = false;

parentPort.on('message', (event) => {
  const command = parseCommand(event.data);
  if (command?.type === 'shutdown') {
    void shutdown();
    return;
  }
  if (command?.type !== 'start' || startAttempted) {
    return;
  }
  startAttempted = true;

  void (async () => {
    let startupStage: ElectronE2eBackendStartupStage = 'boundaryValidation';
    try {
      if (process.env.EKY_E2E !== '1' || event.ports.length !== 3) {
        throw new Error('ELECTRON_E2E_BACKEND_BOUNDARY_INVALID');
      }
      const brokerPort = event.ports[0];
      const archiveBrokerPort = event.ports[1];
      const profileSnapshotBrokerPort = event.ports[2];
      if (
        brokerPort === undefined ||
        archiveBrokerPort === undefined ||
        profileSnapshotBrokerPort === undefined
      ) {
        throw new Error('ELECTRON_E2E_SECRET_BROKER_MISSING');
      }
      startupStage = 'brokerClientCreation';
      secretBrokerClient = new CompanyEmailSecretBrokerClient(
        createUtilitySecretBrokerTransport(brokerPort),
      );
      invoicePdfArchiveBrokerClient = new InvoicePdfArchiveBrokerClient(
        createInvoicePdfArchiveBrokerTransport(archiveBrokerPort),
      );
      const repositoryRoot = resolve(import.meta.dirname, '../../../..');
      const modulePath = resolve(
        repositoryRoot,
        'apps/desktop/e2e-backend-stage/e2e-dist/e2e/startE2eBackend.js',
      );
      startupStage = 'moduleImport';
      const module = (await import(pathToFileURL(modulePath).href)) as {
        startE2eBackend?: StartE2eBackend;
      };
      if (typeof module.startE2eBackend !== 'function') {
        throw new Error('ELECTRON_E2E_BACKEND_MODULE_INVALID');
      }

      startupStage = 'backendStart';
      const started = await module.startE2eBackend(command.configPath, {
        companyEmailSecretReader: secretBrokerClient,
        companyEmailSecretStore: secretBrokerClient,
        deliveredInvoiceArchiveTaskSink: invoicePdfArchiveBrokerClient,
        profileSnapshotStagingRoot:
          command.config.profileSnapshotStagingRoot,
        runtimeInstanceId: command.config.runtimeInstanceId,
        runtimePaths: {
          databaseFilePath: command.config.databaseFilePath,
          documentsRoot: command.config.invoiceDocumentStorageRoot,
          logsRoot: command.config.operationalLogsRoot,
        },
        runtimeSessionSecret: command.config.runtimeSessionSecret,
      });
      if (started.profileSnapshotRuntime === undefined) {
        throw new Error('ELECTRON_E2E_PROFILE_SNAPSHOT_RUNTIME_MISSING');
      }
      startupStage = 'profileSnapshotBrokerStart';
      profileSnapshotBrokerHandle = startProfileSnapshotBrokerBackend({
        maintenance: started.profileSnapshotRuntime.maintenance,
        snapshot: started.profileSnapshotRuntime.service,
        transport: createProfileSnapshotBrokerTransport(
          profileSnapshotBrokerPort,
        ),
      });
      server = started.server;
      startupStage = 'readyNotification';
      parentPort.postMessage({ port: server.port, type: 'ready' });
    } catch {
      secretBrokerClient?.close();
      invoicePdfArchiveBrokerClient?.close();
      profileSnapshotBrokerHandle?.close();
      parentPort.postMessage({
        stage: startupStage,
        type: 'failed',
      });
    }
  })();
});

async function shutdown(): Promise<void> {
  await server?.close().catch(() => undefined);
  secretBrokerClient?.close();
  invoicePdfArchiveBrokerClient?.close();
  profileSnapshotBrokerHandle?.close();
  process.exit(0);
}

type RunnerCommand =
  | { type: 'shutdown' }
  | {
      config: DesktopBackendStartMessage['config'];
      configPath: string;
      type: 'start';
    };

function parseCommand(value: unknown): RunnerCommand | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const command = value as Record<string, unknown>;
  if (command.type === 'shutdown') {
    return { type: 'shutdown' };
  }
  if (
    command.type === 'start' &&
    Object.keys(command).length === 3 &&
    typeof command.configPath === 'string'
  ) {
    const parsed = parseDesktopBackendCommand({
      config: command.config,
      type: 'start',
    });
    if (parsed?.type !== 'start') {
      return undefined;
    }
    return {
      config: parsed.config,
      configPath: command.configPath,
      type: 'start',
    };
  }
  return undefined;
}
