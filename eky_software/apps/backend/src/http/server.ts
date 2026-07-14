import { serve, type ServerType } from '@hono/node-server';

import { createApp, type CreateAppOptions } from './app.js';
import type { RuntimeTrust } from './runtimeTrust.js';

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
  const hostname = getServerHostname(options.hostname ?? process.env.HOST);
  const port =
    options.port ?? getServerPort(process.env.PORT);
  const appOptions: CreateAppOptions = { ...options.appOptions };

  if (options.runtimeTrust !== undefined) {
    appOptions.runtimeTrust = options.runtimeTrust;
  }

  const app = await createApp(appOptions);

  return new Promise((resolveStart, rejectStart) => {
    const server = serve(
      {
        fetch: app.fetch,
        hostname,
        port,
      },
      (info) => {
        resolveStart({
          close: () => closeServer(server),
          hostname,
          port: info.port,
        });
      },
    );

    server.once('error', rejectStart);
  });
}
