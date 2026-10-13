import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as connections from '../database/connection/createDatabaseConnection.js';
import { migrationStartupStages } from '../database/migration/migrationStartupObservation.js';
import type { BackendOperationalEvent } from '../observability/operationalEvent.js';
import { createApp } from './app.js';

const roots: string[] = [];
const databases: connections.DatabaseConnection[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) if (database.open) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('createApp migration startup observation wiring', () => {
  it.each([false, true])('preserves health and normal logs with observer throwing=%s', async throws => {
    const root = await mkdtemp(join(tmpdir(), 'eky-app-migration-observation-'));
    roots.push(root);
    const create = connections.createDatabaseConnection;
    vi.spyOn(connections, 'createDatabaseConnection').mockImplementation(options => {
      const database = create(options);
      databases.push(database);
      return database;
    });
    const events: BackendOperationalEvent[] = [];
    const observer = vi.fn(() => { if (throws) throw new Error('synthetic observation failure'); });
    const app = await createApp({
      databaseFilePath: join(root, 'synthetic.sqlite'),
      migrationStartupObserver: observer,
      operationalLogger: { write: event => { events.push(event); } },
    });

    expect((await app.request('/health')).status).toBe(200);
    expect(observer.mock.calls).toEqual(migrationStartupStages.flatMap(stage => [
      [stage, 'entered'], [stage, 'returned'],
    ]));
    expect(observer).toHaveBeenCalledTimes(14);
    expect(events.filter(event => event.eventName.startsWith('migration.')).map(event => event.eventName))
      .toEqual(['migration.started', 'migration.completed']);
    expect(JSON.stringify(events)).not.toContain('synthetic observation failure');
  });
});
