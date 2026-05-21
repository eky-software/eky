import { serve } from '@hono/node-server';

import { createApp } from './app.js';

const defaultHostname = '127.0.0.1';
const defaultPort = 3000;

function getPort(portValue: string | undefined): number {
  if (portValue === undefined || portValue.trim() === '') {
    return defaultPort;
  }

  const port = Number(portValue);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: ${portValue}`);
  }

  return port;
}

const hostname = process.env.HOST?.trim() || defaultHostname;
const port = getPort(process.env.PORT);

export async function startServer() {
  const app = await createApp();

  serve(
    {
      fetch: app.fetch,
      hostname,
      port,
    },
    (info) => {
      console.log(`Backend listening on http://${info.address}:${info.port}`);
    },
  );
}
