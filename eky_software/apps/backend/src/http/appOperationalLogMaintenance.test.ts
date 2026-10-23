import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as connections from '../database/connection/createDatabaseConnection.js';
import { createApp } from './app.js';

const io = vi.hoisted(() => ({ deniedDirectory: '', observed: false }));
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readdirSync: (...args: Parameters<typeof actual.readdirSync>) => {
      if (String(args[0]) === io.deniedDirectory) {
        io.observed = true;
        throw Object.assign(new Error('Synthetic log directory failure.'), { code: 'EACCES' });
      }
      return actual.readdirSync(...args);
    },
  };
});

const roots: string[] = [];
const databases: connections.DatabaseConnection[] = [];
afterEach(async () => {
  io.deniedDirectory = '';
  io.observed = false;
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) if (database.open) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('backend operational-log maintenance startup wiring', () => {
  it.each(['backend', 'incident-index'])('preserves healthy startup when %s listing fails', async directory => {
    const root = await mkdtemp(join(tmpdir(), 'eky-log-startup-'));
    roots.push(root);
    const logsRoot = join(root, 'logs');
    await mkdir(join(logsRoot, directory), { recursive: true });
    io.deniedDirectory = join(logsRoot, directory);
    const create = connections.createDatabaseConnection;
    vi.spyOn(connections, 'createDatabaseConnection').mockImplementation(options => {
      const database = create(options);
      databases.push(database);
      return database;
    });

    const app = await createApp({
      databaseFilePath: join(root, 'synthetic.sqlite'), operationalLogsRoot: logsRoot,
    });
    expect(io.observed).toBe(true);
    expect((await app.request('/health')).status).toBe(200);
  });

  it('does not turn an invalid log-root configuration into healthy startup', async () => {
    await expect(createApp({ databaseFilePath: ':memory:', operationalLogsRoot: 'relative-logs' }))
      .rejects.toThrow('absolute');
  });
});
