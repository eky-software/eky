import { Hono } from 'hono';

import type { DatabaseConnection } from '../database/connection/createDatabaseConnection.js';
import type { BackendEnvironment } from '../http/runtimeTrust.js';
import { getCompanyEmailSecretStatus } from '../modules/companySettings/application/getCompanyEmailSecretStatus.js';
import { getCompanySettings } from '../modules/companySettings/application/getCompanySettings.js';
import { removeCompanyEmailSecret } from '../modules/companySettings/application/removeCompanyEmailSecret.js';
import { setCompanyEmailSecret } from '../modules/companySettings/application/setCompanyEmailSecret.js';
import { CompanyEmailSecretOperationError } from '../modules/companySettings/application/executeCompanyEmailSecretOperation.js';
import { CompanyEmailSecretStoreError } from '../modules/companySettings/ports/companyEmailSecretStoreError.js';
import { updateCompanySettings } from '../modules/companySettings/application/updateCompanySettings.js';
import { createCompanyEmailSecretRoutes } from '../modules/companySettings/http/companyEmailSecretRoutes.js';
import { createCompanySettingsRoutes } from '../modules/companySettings/http/companySettingsRoutes.js';
import { SqliteCompanyEmailSecretAuditWriter } from '../modules/companySettings/infrastructure/sqliteCompanyEmailSecretAuditWriter.js';
import { SqliteCompanySettingsActivityReader } from '../modules/companySettings/infrastructure/sqliteCompanySettingsActivityReader.js';
import { SqliteCompanySettingsRepository } from '../modules/companySettings/infrastructure/sqliteCompanySettingsRepository.js';
import { CompanySettingsAuditWriteError } from '../modules/companySettings/ports/companySettingsAuditWriteError.js';
import type { CompanyEmailSecretStore } from '../modules/companySettings/ports/companyEmailSecretStore.js';
import type { CompanyEmailSecretReader } from '../modules/companySettings/ports/companyEmailSecretReader.js';
import type { CompanySettingsActivityReader } from '../modules/companySettings/ports/companySettingsActivityReader.js';
import type { InvoiceEmailSettingsReader } from '../modules/invoicing/ports/invoiceEmailSettingsReader.js';
import { createBackendOperationalEvent } from '../observability/createOperationalEvent.js';
import type { OperationalRuntimeIdentity } from '../observability/operationalEvent.js';
import type { OperationalLogger } from '../observability/operationalLogger.js';

interface CompanySettingsCompositionOptions {
  companyEmailSecretReader?: CompanyEmailSecretReader;
  companyEmailSecretStore?: CompanyEmailSecretStore;
  sealCompanyEmailSecretAdmission?: () => void;
  database: DatabaseConnection;
  operationalIdentity: Readonly<OperationalRuntimeIdentity>;
  operationalLogger: OperationalLogger;
}

interface CompanySettingsComposition {
  assertEmailSecretOperationsSettled(): void;
  companyEmailSecretReader: CompanyEmailSecretReader;
  companySettingsActivityReader: CompanySettingsActivityReader;
  invoiceEmailSettingsReader: InvoiceEmailSettingsReader;
  routes: Hono<BackendEnvironment>;
}

export function createCompanySettingsComposition(
  options: CompanySettingsCompositionOptions,
): CompanySettingsComposition {
  const companySettingsRepository = new SqliteCompanySettingsRepository(
    options.database,
  );
  const companySettingsActivityReader = new SqliteCompanySettingsActivityReader(
    options.database,
  );
  const routes = new Hono<BackendEnvironment>();
  let activeSecretOperations = 0;
  let secretOutcomeUncertain = false;
  let secretAdmissionClosed = false;

  function sealSecretAdmission(): void {
    if (secretAdmissionClosed) return;
    secretAdmissionClosed = true;
    // The adapter seals its existing queue synchronously, retaining active work.
    try { options.sealCompanyEmailSecretAdmission?.(); }
    catch {
      secretOutcomeUncertain = true;
      throw new CompanyEmailSecretOperationError('COMPANY_EMAIL_SECRET_OUTCOME_UNKNOWN');
    }
  }

  async function withSecretOperation<T>(
    operation: () => Promise<T>,
    kind: 'lifecycle' | 'providerRead' = 'lifecycle',
  ): Promise<T> {
    if (secretOutcomeUncertain) {
      throw new CompanyEmailSecretOperationError('COMPANY_EMAIL_SECRET_OUTCOME_UNKNOWN');
    }
    if (secretAdmissionClosed) {
      throw new CompanyEmailSecretStoreError('noEffect');
    }
    activeSecretOperations += 1;
    try {
      const result = await operation();
      // Check at owned completion, after every reader continuation has settled.
      if (kind === 'providerRead' && secretOutcomeUncertain) {
        throw new CompanyEmailSecretOperationError('COMPANY_EMAIL_SECRET_OUTCOME_UNKNOWN');
      }
      return result;
    } catch (error) {
      if (
        (error instanceof CompanyEmailSecretOperationError &&
          error.code !== 'COMPANY_EMAIL_SECRET_OPERATION_FAILED') ||
        (error instanceof CompanyEmailSecretStoreError && error.effect === 'unknown')
      ) {
        secretOutcomeUncertain = true;
        try { sealSecretAdmission(); }
        catch { /* Keep the first operation error; shutdown remains uncertain. */ }
      }
      throw error;
    } finally {
      activeSecretOperations -= 1;
    }
  }

  if (options.companyEmailSecretStore !== undefined) {
    const companyEmailSecretAuditWriter =
      new SqliteCompanyEmailSecretAuditWriter(options.database);
    const companyEmailSecretStore = options.companyEmailSecretStore;

    routes.route(
      '/',
      createCompanyEmailSecretRoutes({
        getCompanyEmailSecretStatus: (input) =>
          withSecretOperation(() => getCompanyEmailSecretStatus(input, { companyEmailSecretStore })),
        removeCompanyEmailSecret: (input) =>
          withSecretOperation(() => removeCompanyEmailSecret(input, {
            companyEmailSecretAuditWriter,
            companyEmailSecretStore,
          })),
        setCompanyEmailSecret: (input) =>
          withSecretOperation(() => setCompanyEmailSecret(input, {
            companyEmailSecretAuditWriter,
            companyEmailSecretStore,
          })),
      }),
    );
  }

  routes.route(
    '/',
    createCompanySettingsRoutes({
      getCompanySettings: (input) =>
        withSecretOperation(async () => withCompanyEmailSecretStatus(
          await getCompanySettings(input, companySettingsRepository),
          options.companyEmailSecretStore,
        )),
      updateCompanySettings: (input) =>
        withSecretOperation(() => logAuditWriteFailure(
          () =>
            updateCompanySettings(
              input,
              companySettingsRepository,
              options.companyEmailSecretStore,
            ),
          options,
        )),
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

  // Only the provider receives this port; the value never enters settings routes.
  const companyEmailSecretReader: CompanyEmailSecretReader = {
    getSecret: companyId => withSecretOperation(async () => {
      let secret: string | null;
      try {
        secret = await (options.companyEmailSecretReader?.getSecret(companyId) ?? null);
      } catch (error) {
        throw error instanceof CompanyEmailSecretStoreError
          ? error : new CompanyEmailSecretStoreError('unknown');
      }
      return secret;
    }, 'providerRead'),
  };

  return {
    assertEmailSecretOperationsSettled() {
      sealSecretAdmission();
      // A disconnected HTTP client can outlive its socket until audit completion.
      if (activeSecretOperations !== 0 || secretOutcomeUncertain) {
        secretOutcomeUncertain = true;
        throw new CompanyEmailSecretOperationError('COMPANY_EMAIL_SECRET_OUTCOME_UNKNOWN');
      }
    },
    companyEmailSecretReader,
    companySettingsActivityReader,
    invoiceEmailSettingsReader,
    routes,
  };
}

async function logAuditWriteFailure<T>(
  operation: () => Promise<T>,
  options: Pick<
    CompanySettingsCompositionOptions,
    'operationalIdentity' | 'operationalLogger'
  >,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof CompanySettingsAuditWriteError) {
      try {
        options.operationalLogger.write(
          createBackendOperationalEvent(
            {
              entityType: 'companySettings',
              errorCode: 'COMPANY_SETTINGS_AUDIT_WRITE_FAILED',
              eventName: 'businessAudit.writeFailed',
              sideEffectState: 'rolledBack',
              stage: 'companySettingsMutation',
            },
            options.operationalIdentity,
          ),
        );
      } catch {
        // Operational logging must not replace the original safe audit error.
      }
    }

    throw error;
  }
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
