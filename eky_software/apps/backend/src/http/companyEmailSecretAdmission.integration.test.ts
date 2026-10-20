import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as invoicing from '../composition/invoicingComposition.js';
import * as connections from '../database/connection/createDatabaseConnection.js';
import { DnaSmtpEmailDeliveryProvider } from '../infrastructure/email/providers/dna/dnaSmtpEmailDeliveryProvider.js';
import { SqliteCompanyEmailSecretAuditWriter } from '../modules/companySettings/infrastructure/sqliteCompanyEmailSecretAuditWriter.js';
import type { CompanyEmailSecretReader } from '../modules/companySettings/ports/companyEmailSecretReader.js';
import { CompanyEmailSecretStoreError } from '../modules/companySettings/ports/companyEmailSecretStoreError.js';
import { createApp } from './app.js';

type Outcome = 'success' | 'noEffect' | 'unknown' | 'auditIncomplete';
const createConnection = connections.createDatabaseConnection;
const createInvoicing = invoicing.createInvoicingComposition;
const cleanup: Array<(failed: boolean) => Promise<void>> = [];
afterEach(async context => {
  const errors: unknown[] = [];
  try {
    for (const dispose of cleanup.splice(0)) {
      try { await dispose(context.task.result?.state !== 'pass'); }
      catch (error) { errors.push(error); }
    }
  } finally { vi.restoreAllMocks(); }
  if (errors.length > 0) throw new AggregateError(errors, 'Synthetic admission cleanup failed.');
});

describe('secret admission shared by settings and the SMTP reader', () => {
  it.each(['unknown', 'auditIncomplete'] as const)(
    'does not enter the secret adapter or SMTP transport after %s', async outcome => {
      const f = await fixture(outcome);
      const response = await f.app.request('/company-settings/email-secret', { method: 'DELETE' });
      expect(response.status).toBe(503);
      expect(f.audit()).toEqual([{ status: 'pending' }]);
      await expect(f.send()).rejects.toMatchObject({ code: 'DNA_SMTP_DELIVERY_FAILED' });
      expect(f.getSecret).not.toHaveBeenCalled();
      expect(f.transport).not.toHaveBeenCalled();
      expect(f.audit()).toEqual([{ status: 'pending' }]);
    },
  );

  it.each(['success', 'noEffect'] as const)(
    'retains a confirmed new send after %s with the selected company credentials', async outcome => {
      const f = await fixture(outcome);
      const response = await f.app.request('/company-settings/email-secret', { method: 'DELETE' });
      expect(response.status).toBe(outcome === 'success' ? 200 : 503);
      await expect(f.send()).resolves.toMatchObject({ provider: 'smtp', testMode: true });
      expect(f.getSecret).toHaveBeenCalledExactlyOnceWith(f.companyId);
      expect(f.transport).toHaveBeenCalledOnce();
      expect(f.audit()).toEqual([{ status: outcome === 'success' ? 'succeeded' : 'failed' }]);
    },
  );

  it('does not relabel an SMTP transport that started before a separate uncertain mutation', async () => {
    const f = await fixture('unknown');
    const entered = gate();
    const release = gate();
    f.transport.mockImplementation(async () => {
      entered.resolve();
      await release.promise;
      return { accepted: true as const, providerMessageId: 'synthetic-accepted-message' };
    });
    const delivery = f.send();
    try {
      await Promise.race([entered.promise, delivery.then(() => {
        throw new Error('Synthetic delivery ended before entering transport.');
      })]);
      expect((await f.app.request('/company-settings/email-secret', { method: 'DELETE' })).status).toBe(503);
      release.resolve();
      await expect(delivery).resolves.toMatchObject({ providerMessageId: 'synthetic-accepted-message' });
      await expect(f.send()).rejects.toMatchObject({ code: 'DNA_SMTP_DELIVERY_FAILED' });
      expect(f.getSecret).toHaveBeenCalledTimes(1);
      expect(f.transport).toHaveBeenCalledTimes(1);
      expect(f.audit()).toEqual([{ status: 'pending' }]);
    } finally {
      release.resolve();
      await delivery.catch(() => undefined);
    }
  });

  it.each(['mutation', 'shutdown'] as const)(
    'rejects a late secret read after %s fences the generation', async source => {
      const f = await fixture('unknown');
      const entered = gate();
      const release = gate();
      f.getSecret.mockImplementation(async () => {
        entered.resolve();
        await release.promise;
        return 'synthetic-current-smtp-secret';
      });
      const delivery = f.send();
      const rejected = expect(delivery).rejects.toMatchObject({ code: 'DNA_SMTP_DELIVERY_FAILED' });
      try {
        await Promise.race([entered.promise, delivery]);
        if (source === 'mutation') {
          expect((await f.app.request('/company-settings/email-secret', { method: 'DELETE' })).status).toBe(503);
        } else {
          expect(f.assertSettled).toThrow(expect.objectContaining({ code: 'COMPANY_EMAIL_SECRET_OUTCOME_UNKNOWN' }));
        }
      } finally {
        release.resolve();
        await rejected;
      }
      expect(f.transport).not.toHaveBeenCalled();
      expect(f.assertSettled).toThrow();
      await expect(f.send()).rejects.toMatchObject({ code: 'DNA_SMTP_DELIVERY_FAILED' });
      expect(f.getSecret).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['unknown', 'untyped', 'noEffect'] as const)(
    'shares the reader %s outcome with settings and shutdown', async outcome => {
      const f = await fixture('success');
      f.getSecret.mockRejectedValueOnce(outcome === 'untyped'
        ? new Error('Synthetic read recovery failed.') : new CompanyEmailSecretStoreError(outcome));
      await expect(f.send()).rejects.toMatchObject({ code: 'DNA_SMTP_DELIVERY_FAILED' });
      const response = await f.app.request('/company-settings/email-secret', { method: 'DELETE' });
      if (outcome === 'noEffect') {
        expect(response.status).toBe(200);
        await expect(f.send()).resolves.toMatchObject({ provider: 'smtp' });
        expect(f.getSecret).toHaveBeenCalledTimes(2);
        expect(f.assertSettled).not.toThrow();
      } else {
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ code: 'COMPANY_EMAIL_SECRET_OUTCOME_UNKNOWN' });
        expect(f.audit()).toEqual([]);
        expect(f.assertSettled).toThrow();
        expect(f.getSecret).toHaveBeenCalledTimes(1);
        expect(f.transport).not.toHaveBeenCalled();
      }
    },
  );

  it('does not reopen a cleanly closed generation for a later send', async () => {
    const f = await fixture('success');
    expect(f.assertSettled).not.toThrow();
    await expect(f.send()).rejects.toMatchObject({ code: 'DNA_SMTP_DELIVERY_FAILED' });
    expect(f.getSecret).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.assertSettled).not.toThrow();
    expect(f.audit()).toEqual([]);
  });

  it('checks uncertainty at owned read completion, not only inside the raw reader continuation', async () => {
    const f = await fixture('success');
    let shutdownRejected = false;
    f.getSecret.mockImplementation(() => {
      // Inner read continuation runs between these two explicit microtasks;
      // the outer operation has not yet settled when shutdown checks ownership.
      queueMicrotask(() => queueMicrotask(() => {
        try { f.assertSettled(); } catch { shutdownRejected = true; }
      }));
      return Promise.resolve('synthetic-current-smtp-secret');
    });
    await expect(f.send()).rejects.toMatchObject({ code: 'DNA_SMTP_DELIVERY_FAILED' });
    expect(shutdownRejected).toBe(true);
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.assertSettled).toThrow();
  });

  it('keeps a late read in a fenced company separate from another company without or with its own secret', async () => {
    const a = await fixture('success', 'a');
    const b = await fixture('success', 'b');
    expect(a.companyId === b.companyId).toBe(false);
    const entered = gate();
    const release = gate();
    a.getSecret.mockImplementation(async () => {
      entered.resolve();
      await release.promise;
      return 'synthetic-a-smtp-secret';
    });
    b.getSecret.mockResolvedValue(null);
    const delivery = a.send();
    const rejected = expect(delivery).rejects.toMatchObject({ code: 'DNA_SMTP_DELIVERY_FAILED' });
    try {
      await Promise.race([entered.promise, delivery]);
      expect(a.assertSettled).toThrow();
      await expect(b.send()).rejects.toMatchObject({ code: 'DNA_SMTP_SECRET_NOT_CONFIGURED' });
      expect(b.transport).not.toHaveBeenCalled();
      b.getSecret.mockResolvedValue('synthetic-b-smtp-secret');
      await expect(b.send()).resolves.toMatchObject({ provider: 'smtp' });
    } finally {
      release.resolve();
      await rejected;
    }
    expect(a.transport).not.toHaveBeenCalled();
    await expect(a.send()).rejects.toMatchObject({ code: 'DNA_SMTP_DELIVERY_FAILED' });
    expect(a.getSecret).toHaveBeenCalledExactlyOnceWith(a.companyId);
    await expect(b.send()).resolves.toMatchObject({ provider: 'smtp' });
    expect(b.getSecret.mock.calls.every(([id]) => id === b.companyId)).toBe(true);
    expect(b.transport).toHaveBeenCalledTimes(2);
    expect(a.audit()).toEqual([]);
    expect(b.audit()).toEqual([]);
    expect(b.assertSettled).not.toThrow();
  });

  it('does not fence another company when one company has an unresolved mutation', async () => {
    const a = await fixture('unknown', 'a');
    const b = await fixture('success', 'b');
    expect((await a.app.request('/company-settings/email-secret', { method: 'DELETE' })).status).toBe(503);
    await expect(a.send()).rejects.toMatchObject({ code: 'DNA_SMTP_DELIVERY_FAILED' });
    await expect(b.send()).resolves.toMatchObject({ provider: 'smtp' });
    expect(a.getSecret).not.toHaveBeenCalled();
    expect(a.transport).not.toHaveBeenCalled();
    expect(b.getSecret).toHaveBeenCalledExactlyOnceWith(b.companyId);
    expect(a.audit()).toEqual([{ status: 'pending' }]);
    expect(b.audit()).toEqual([]);
    expect(b.assertSettled).not.toThrow();
  });
});

async function fixture(outcome: Outcome, label = 'current') {
  const root = await mkdtemp(join(tmpdir(), 'eky-secret-admission-'));
  const databases: connections.DatabaseConnection[] = [];
  cleanup.push(async failed => {
    const errors: unknown[] = [];
    for (const database of databases) {
      try { if (database.open) database.close(); } catch (error) { errors.push(error); }
    }
    if (!failed && errors.length === 0) await rm(root, { recursive: true });
    if (errors.length > 0) throw new AggregateError(errors, 'Synthetic admission cleanup failed.');
  });
  vi.spyOn(connections, 'createDatabaseConnection').mockImplementation(options => {
    const database = createConnection(options);
    databases.push(database);
    return database;
  });
  let reader: CompanyEmailSecretReader | undefined;
  let assertSettled: (() => void) | undefined;
  vi.spyOn(invoicing, 'createInvoicingComposition').mockImplementation(options => {
    reader = options.companyEmailSecretReader;
    return createInvoicing(options);
  });
  const secret = `synthetic-${label}-smtp-secret`;
  const sender = label === 'current' ? 'sender@example.invalid' : `${label}@example.invalid`;
  const getSecret = vi.fn(async (_companyId: string): Promise<string | null> => secret);
  if (outcome === 'auditIncomplete') {
    vi.spyOn(SqliteCompanyEmailSecretAuditWriter.prototype, 'completeCompanyEmailSecretAuditOperation')
      .mockRejectedValue(new Error('Synthetic audit completion refused.'));
  }
  const mutate = async () => {
    if (outcome === 'unknown' || outcome === 'noEffect') throw new CompanyEmailSecretStoreError(outcome);
  };
  const app = await createApp({
    databaseFilePath: join(root, 'profile.sqlite'),
    invoiceDocumentStorageRoot: join(root, 'invoices'),
    runtimeTrust: { mode: 'development' },
    companyEmailSecretReader: { getSecret },
    companyEmailSecretStore: { hasSecret: async () => true, setSecret: mutate, removeSecret: mutate },
    registerCompanyEmailSecretShutdown: value => { assertSettled = value; },
  });
  const database = databases.find(value => value.open);
  if (database === undefined || reader === undefined || assertSettled === undefined) {
    throw new Error('Synthetic composition was not registered.');
  }
  const identity = database.prepare('SELECT company_id FROM local_runtime_identity').get() as { company_id: string };
  const transport = vi.fn(async (input: { credentials: { password: string; username: string } }) => {
    // Compare booleans so unexpected diagnostics do not serialize credentials.
    expect(input.credentials.password === secret).toBe(true);
    expect(input.credentials.username === sender).toBe(true);
    return { accepted: true as const, providerMessageId: 'synthetic-accepted-message' };
  });
  const provider = new DnaSmtpEmailDeliveryProvider({ companyEmailSecretReader: reader, transport });
  return {
    app, getSecret, transport, assertSettled, companyId: identity.company_id,
    audit: () => database.prepare('SELECT status FROM company_email_secret_audit_events').all(),
    send: () => provider.sendTestEmail({
      attemptId: '11111111-1111-4111-8111-111111111111',
      companyId: identity.company_id, body: 'Synthetic message', subject: 'Synthetic invoice',
      emailDeliveryProvider: 'dnaSmtp',
      emailSenderAddress: sender, emailSenderName: 'Synthetic',
      emailTestRecipientOverride: 'owner@example.invalid', emailUsername: sender,
      pdfContent: Buffer.from('%PDF-1.7 synthetic'), pdfFileName: 'synthetic.pdf',
    }),
  };
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}
