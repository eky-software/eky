import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runMigrations } from '../database/migration/runMigrations.js';
import { createInvoiceReadModelTestDatabase } from './invoiceReadModelTestFixtures.js';

vi.mock('../database/migration/runMigrations.js', () => ({ runMigrations: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

describe('invoice read model fixture allocation', () => {
  it('closes the allocated database and preserves a migration failure', async () => {
    const failure = new Error('synthetic migration failure');
    vi.mocked(runMigrations).mockRejectedValueOnce(failure);
    const close = vi.spyOn(Database.prototype, 'close');
    await expect(createInvoiceReadModelTestDatabase()).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
    expect(vi.mocked(runMigrations).mock.calls.at(-1)![0].open).toBe(false);
  });

  it('closes the allocated database if seeding fails after migrations', async () => {
    vi.mocked(runMigrations).mockResolvedValueOnce(undefined);
    const close = vi.spyOn(Database.prototype, 'close');
    // No schema was installed, so the first real seed write must fail.
    await expect(createInvoiceReadModelTestDatabase()).rejects.toThrow(/no such table/);
    expect(close).toHaveBeenCalledOnce();
    expect(vi.mocked(runMigrations).mock.calls.at(-1)![0].open).toBe(false);
  });
});
