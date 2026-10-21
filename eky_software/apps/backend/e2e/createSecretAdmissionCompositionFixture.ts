import { createActorContext } from '@eky/auth';
import Database from 'better-sqlite3';
import { Hono } from 'hono';

import { createCompanySettingsComposition } from '../src/composition/companySettingsComposition.js';
import { runMigrations } from '../src/database/migration/runMigrations.js';
import type { BackendEnvironment } from '../src/http/runtimeTrust.js';
import type { CompanyEmailSecretStore } from '../src/modules/companySettings/ports/companyEmailSecretStore.js';

// In-memory cross-layer fixture, never part of the production backend build.
export async function createSecretAdmissionCompositionFixture(input: {
  store: CompanyEmailSecretStore;
  sealAdmission(): void;
}) {
  if (process.env.EKY_E2E !== '1') throw new Error('E2E marker required.');
  const database = new Database(':memory:');
  try {
    await runMigrations(database);
    database.exec(`
      CREATE TEMP TRIGGER reject_first_secret_audit_completion
      BEFORE UPDATE ON company_email_secret_audit_events
      WHEN OLD.operation_id = (
        SELECT operation_id FROM company_email_secret_audit_events ORDER BY rowid LIMIT 1
      )
      BEGIN SELECT RAISE(ABORT, 'Synthetic first audit completion refused.'); END;
    `);
    const composition = createCompanySettingsComposition({
      database, companyEmailSecretStore: input.store,
      sealCompanyEmailSecretAdmission: input.sealAdmission,
      operationalIdentity: { appVersion: '0.0.0-e2e', buildRevision: 'development',
        runtimeInstanceId: '11111111-1111-4111-8111-111111111111' },
      operationalLogger: { write() {} },
    });
    const app = new Hono<BackendEnvironment>();
    app.use('*', async (context, next) => {
      context.set('actorContext', createActorContext({
        actorId: 'synthetic-owner', authenticationMode: 'local',
        companyId: 'synthetic-company', permissions: ['manageCompanyEmailSecret'],
      }));
      await next();
    });
    app.route('/', composition.routes);
    return {
      remove: () => Promise.resolve(app.request('/company-settings/email-secret', { method: 'DELETE' })),
      audit: () => database.prepare('SELECT status FROM company_email_secret_audit_events ORDER BY rowid').all(),
      assertSettled: composition.assertEmailSecretOperationsSettled,
      close: () => database.close(),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
