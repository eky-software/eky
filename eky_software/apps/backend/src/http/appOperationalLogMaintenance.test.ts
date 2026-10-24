import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpRequestFailureCapture } from '../../../../test-reporters/httpRequestFailureCapture.mjs';

import * as connections from '../database/connection/createDatabaseConnection.js';
import { createApp } from './app.js';

const io = vi.hoisted(() => ({ deniedDirectory: '', observed: false,
  deniedReadDirectory: '', originalReadFailure: undefined as Error | undefined }));
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    opendirSync: (...args: Parameters<typeof actual.opendirSync>) => {
      if (String(args[0]) === io.deniedReadDirectory) {
        io.originalReadFailure = Object.assign(new Error('H4_PRIVATE_ORIGINAL_READ_FAILURE', {
          cause: new Error('H4_PRIVATE_READ_CAUSE'),
        }), { code: 'EACCES' });
        throw io.originalReadFailure;
      }
      return actual.opendirSync(...args);
    },
    readdirSync: (...args: Parameters<typeof actual.readdirSync>) => {
      if (String(args[0]) === io.deniedDirectory) {
        io.observed = true;
        throw Object.assign(new Error('Synthetic log directory failure.'), { code: 'EACCES' });
      }
      return actual.readdirSync(...args);
    },
  };
});
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, opendir: (...args: Parameters<typeof actual.opendir>) => {
    if (String(args[0]) === io.deniedReadDirectory) {
      io.originalReadFailure = Object.assign(new Error('H4_PRIVATE_ORIGINAL_READ_FAILURE', {
        cause: new Error('H4_PRIVATE_READ_CAUSE'),
      }), { code: 'EACCES' });
      throw io.originalReadFailure;
    }
    return actual.opendir(...args);
  } };
});

const roots: string[] = [];
const databases: connections.DatabaseConnection[] = [];
afterEach(async () => {
  io.deniedDirectory = '';
  io.observed = false;
  io.deniedReadDirectory = '';
  io.originalReadFailure = undefined;
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

  it.for([false, true])('offers the original diagnostic I/O cause before safe HTTP status when observer throws=%s', async (throws, context) => {
    const root = await mkdtemp(join(tmpdir(), 'eky-log-read-observation-'));
    roots.push(root);
    const create = connections.createDatabaseConnection;
    vi.spyOn(connections, 'createDatabaseConnection').mockImplementation(options => {
      const database = create(options); databases.push(database); return database;
    });
    const capture = createHttpRequestFailureCapture(context);
    const observed = vi.fn((error: unknown) => {
      capture.captureOriginalException(error);
      if (throws) throw new Error('H4_PRIVATE_OBSERVER_FAILURE');
    });
    const logsRoot = join(root, 'logs');
    const app = await createApp({ databaseFilePath: join(root, 'synthetic.sqlite'), operationalLogsRoot: logsRoot,
      httpRequestFailureObserver: { captureOriginalException: observed } });
    expect(observed).not.toHaveBeenCalled();
    io.deniedReadDirectory = join(logsRoot, 'backend');
    const events = await app.request('/diagnostics/events');
    expect(events.status).toBe(200);
    expect(await events.json()).toEqual({ state: 'unavailable', diagnosticEvents: [],
      readState: { status: 'unavailable', reasons: ['sourceUnavailable'] } });
    expect(observed).toHaveBeenCalledOnce();
    expect(observed.mock.calls[0]?.[0] === io.originalReadFailure).toBe(true);
    const summary = await app.request('/diagnostics/summary');
    expect(summary.status).toBe(200);
    const data = await summary.json();
    expect(data.operationalLogReadState).toEqual({ status: 'unavailable', reasons: ['sourceUnavailable'] });
    expect(JSON.stringify(data)).not.toContain('H4_PRIVATE');
    expect(observed).toHaveBeenCalledTimes(2);
    expect((await app.request('/health')).status).toBe(200);
  });
});
