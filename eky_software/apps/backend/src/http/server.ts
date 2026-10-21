import { serve, type ServerType } from '@hono/node-server';
import type { Socket } from 'node:net';

import { createApp, type CreateAppOptions } from './app.js';
import type { RuntimeTrust } from './runtimeTrust.js';
export { CompanyEmailSecretStoreError } from '../modules/companySettings/ports/companyEmailSecretStoreError.js';
import { createBackendOperationalEvent } from '../observability/createOperationalEvent.js';
import { createBackendOperationalLogger } from '../observability/infrastructure/createBackendOperationalLogger.js';
import { resolveOperationalRuntimeIdentity } from '../observability/operationalRuntimeIdentity.js';
import {
  noOpOperationalLogger,
  type OperationalLogger,
} from '../observability/operationalLogger.js';

const defaultHostname = '127.0.0.1';
const defaultPort = 3000;

export function getServerPort(portValue: string | undefined): number {
  if (portValue === undefined || portValue.trim() === '') {
    return defaultPort;
  }

  const port = Number(portValue);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${portValue}`);
  }

  return port;
}

export function getServerHostname(hostnameValue: string | undefined): string {
  const hostname = hostnameValue?.trim() || defaultHostname;

  if (hostname !== defaultHostname) {
    throw new Error('Backend hostname must be the IPv4 loopback address.');
  }

  return hostname;
}

export interface StartServerOptions {
  appOptions?: CreateAppOptions;
  hostname?: string;
  port?: number;
  runtimeTrust?: RuntimeTrust;
}

export interface StartedServer {
  close(): Promise<void>;
  hostname: string;
  port: number;
}

function closeServer(server: ServerType): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error !== undefined) {
        rejectClose(error);
        return;
      }

      resolveClose();
    });
  });
}

export async function startServer(
  options: StartServerOptions = {},
): Promise<StartedServer> {
  const startedAt = Date.now();
  const hostname = getServerHostname(options.hostname ?? process.env.HOST);
  const port =
    options.port ?? getServerPort(process.env.PORT);
  const appOptions: CreateAppOptions = { ...options.appOptions };
  const operationalIdentity = resolveOperationalRuntimeIdentity({
    ...(appOptions.appVersion === undefined
      ? {}
      : { appVersion: appOptions.appVersion }),
    ...(appOptions.operationalIdentity === undefined
      ? {}
      : { operationalIdentity: appOptions.operationalIdentity }),
  });
  appOptions.appVersion = operationalIdentity.appVersion;
  appOptions.operationalIdentity = operationalIdentity;
  const operationalLogger = resolveOperationalLogger(
    appOptions,
    operationalIdentity,
  );
  appOptions.operationalLogger = operationalLogger;

  if (options.runtimeTrust !== undefined) {
    appOptions.runtimeTrust = options.runtimeTrust;
  }

  let assertEmailSecretOperationsSettled: (() => void) | undefined;
  const app = await createApp({
    ...appOptions,
    registerCompanyEmailSecretShutdown(assertSettled) {
      assertEmailSecretOperationsSettled = assertSettled;
      appOptions.registerCompanyEmailSecretShutdown?.(assertSettled);
    },
  });

  return new Promise((resolveStart, rejectStart) => {
    const unusedConnections = new Set<Socket>();
    let closing = false;
    const server = serve(
      {
        fetch: app.fetch,
        hostname,
        port,
      },
      (info) => {
        operationalLogger.write(
          createBackendOperationalEvent(
            {
              durationMs: Date.now() - startedAt,
              eventName: 'backend.started',
            },
            operationalIdentity,
          ),
        );
        resolveStart({
          async close() {
            const shutdownStartedAt = Date.now();
            operationalLogger.write(
              createBackendOperationalEvent(
                { eventName: 'backend.shutdownStarted' },
                operationalIdentity,
              ),
            );
            closing = true;
            const closed = closeServer(server);
            // HTTP close does not release connections that have sent no request.
            // Accepted requests keep the normal graceful-drain behavior.
            for (const socket of unusedConnections) socket.destroy();
            await closed;
            if (assertEmailSecretOperationsSettled === undefined) {
              throw new Error('COMPANY_EMAIL_SECRET_SHUTDOWN_UNAVAILABLE');
            }
            assertEmailSecretOperationsSettled();
            operationalLogger.write(
              createBackendOperationalEvent(
                {
                  durationMs: Date.now() - shutdownStartedAt,
                  eventName: 'backend.shutdownCompleted',
                },
                operationalIdentity,
              ),
            );
          },
          hostname,
          port: info.port,
        });
      },
    );

    server.on('connection', socket => {
      if (closing) {
        socket.destroy();
        return;
      }
      unusedConnections.add(socket);
      socket.once('close', () => unusedConnections.delete(socket));
    });
    server.prependListener('request', (request, response) => {
      unusedConnections.delete(request.socket);
      response.once('finish', () => {
        // A request active at close() may become idle only after that first sweep.
        if (closing && 'closeIdleConnections' in server) {
          server.closeIdleConnections();
        }
      });
    });
    server.once('error', rejectStart);
  });
}

function resolveOperationalLogger(
  appOptions: CreateAppOptions,
  operationalIdentity: ReturnType<typeof resolveOperationalRuntimeIdentity>,
): OperationalLogger {
  if (appOptions.operationalLogger !== undefined) {
    return appOptions.operationalLogger;
  }
  if (appOptions.operationalLogsRoot !== undefined) {
    return createBackendOperationalLogger(
      appOptions.operationalLogsRoot,
      operationalIdentity,
    );
  }
  return noOpOperationalLogger;
}
