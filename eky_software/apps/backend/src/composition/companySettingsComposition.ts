import { Hono } from 'hono';

import type { DatabaseConnection } from '../database/connection/createDatabaseConnection.js';
import type { BackendEnvironment } from '../http/runtimeTrust.js';
import { getCompanyEmailSecretStatus } from '../modules/companySettings/application/getCompanyEmailSecretStatus.js';
import { getCompanySettings } from '../modules/companySettings/application/getCompanySettings.js';
import { removeCompanyEmailSecret } from '../modules/companySettings/application/removeCompanyEmailSecret.js';
import { setCompanyEmailSecret } from '../modules/companySettings/application/setCompanyEmailSecret.js';
import { updateCompanySettings } from '../modules/companySettings/application/updateCompanySettings.js';
import { createCompanyEmailSecretRoutes } from '../modules/companySettings/http/companyEmailSecretRoutes.js';
import { createCompanySettingsRoutes } from '../modules/companySettings/http/companySettingsRoutes.js';
import { SqliteCompanyEmailSecretAuditWriter } from '../modules/companySettings/infrastructure/sqliteCompanyEmailSecretAuditWriter.js';
import { SqliteCompanySettingsRepository } from '../modules/companySettings/infrastructure/sqliteCompanySettingsRepository.js';
import type { CompanyEmailSecretStore } from '../modules/companySettings/ports/companyEmailSecretStore.js';
import type { InvoiceEmailSettingsReader } from '../modules/invoicing/ports/invoiceEmailSettingsReader.js';

interface CompanySettingsCompositionOptions {
  companyEmailSecretStore?: CompanyEmailSecretStore;
  database: DatabaseConnection;
}

interface CompanySettingsComposition {
  invoiceEmailSettingsReader: InvoiceEmailSettingsReader;
  routes: Hono<BackendEnvironment>;
}

export function createCompanySettingsComposition(
  options: CompanySettingsCompositionOptions,
): CompanySettingsComposition {
  const companySettingsRepository = new SqliteCompanySettingsRepository(
    options.database,
  );
  const routes = new Hono<BackendEnvironment>();

  if (options.companyEmailSecretStore !== undefined) {
    const companyEmailSecretAuditWriter =
      new SqliteCompanyEmailSecretAuditWriter(options.database);
    const companyEmailSecretStore = options.companyEmailSecretStore;

    routes.route(
      '/',
      createCompanyEmailSecretRoutes({
        getCompanyEmailSecretStatus: (input) =>
          getCompanyEmailSecretStatus(input, { companyEmailSecretStore }),
        removeCompanyEmailSecret: (input) =>
          removeCompanyEmailSecret(input, {
            companyEmailSecretAuditWriter,
            companyEmailSecretStore,
          }),
        setCompanyEmailSecret: (input) =>
          setCompanyEmailSecret(input, {
            companyEmailSecretAuditWriter,
            companyEmailSecretStore,
          }),
      }),
    );
  }

  routes.route(
    '/',
    createCompanySettingsRoutes({
      getCompanySettings: async (input) =>
        withCompanyEmailSecretStatus(
          await getCompanySettings(input, companySettingsRepository),
          options.companyEmailSecretStore,
        ),
      updateCompanySettings: async (input) =>
        withCompanyEmailSecretStatus(
          await updateCompanySettings(input, companySettingsRepository),
          options.companyEmailSecretStore,
        ),
    }),
  );

  const invoiceEmailSettingsReader: InvoiceEmailSettingsReader = {
    async getEmailSettings(companyId) {
      const settings = await companySettingsRepository.findByCompanyId(companyId);

      if (settings === null) {
        return null;
      }

      return {
        emailDeliveryProvider: settings.emailDeliveryProvider,
        emailSenderAddress: settings.emailSenderAddress,
        emailSenderName: settings.emailSenderName,
        emailTestRecipientOverride: settings.emailTestRecipientOverride,
        emailUsername: settings.emailUsername,
      };
    },
  };

  return {
    invoiceEmailSettingsReader,
    routes,
  };
}

async function withCompanyEmailSecretStatus<T extends { companyId: string }>(
  settings: T & { emailSecretConfigured: boolean },
  secretStore: CompanyEmailSecretStore | undefined,
): Promise<T & { emailSecretConfigured: boolean }> {
  if (secretStore === undefined) {
    return settings;
  }

  return {
    ...settings,
    emailSecretConfigured: await secretStore.hasSecret(settings.companyId),
  };
}
