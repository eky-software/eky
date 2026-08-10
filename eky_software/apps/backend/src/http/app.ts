import { Hono } from 'hono';

import {
  createRuntimeTrustMiddleware,
  resolveRuntimeTrust,
  type BackendEnvironment,
  type RuntimeTrust,
} from './runtimeTrust.js';

import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../database/connection/createDatabaseConnection.js';
import { readLocalRuntimeIdentity } from '../database/localRuntimeIdentityReader.js';
import { runMigrations } from '../database/migration/runMigrations.js';
import { MigrationRunError } from '../database/migration/migrationRunError.js';
import { createCompanySettingsComposition } from '../composition/companySettingsComposition.js';
import { createCustomersComposition } from '../composition/customersComposition.js';
import { createActivityComposition } from '../composition/activityComposition.js';
import { createDiagnosticsComposition } from '../composition/diagnosticsComposition.js';
import {
  createInvoicingComposition,
  type InvoicingInfrastructureAdapters,
} from '../composition/invoicingComposition.js';
import type { CompanyEmailSecretReader } from '../modules/companySettings/ports/companyEmailSecretReader.js';
import type { CompanyEmailSecretStore } from '../modules/companySettings/ports/companyEmailSecretStore.js';
import {
  noOpDeliveredInvoiceArchiveTaskSink,
  type DeliveredInvoiceArchiveTaskSink,
} from '../modules/invoicing/ports/deliveredInvoiceArchiveTaskSink.js';
import { createBackendOperationalEvent } from '../observability/createOperationalEvent.js';
import type { OperationalRuntimeIdentity } from '../observability/operationalEvent.js';
import { resolveOperationalRuntimeIdentity } from '../observability/operationalRuntimeIdentity.js';
import { maintainBusinessAuditRetention } from '../observability/application/maintainBusinessAuditRetention.js';
import { createBackendOperationalLogger } from '../observability/infrastructure/createBackendOperationalLogger.js';
import { maintainOperationalLogs } from '../observability/infrastructure/operationalLogRetention.js';
import {
  noOpOperationalLogger,
  type OperationalLogger,
} from '../observability/operationalLogger.js';
import {
  createOperationalLoggingMiddleware,
  logUnknownRoute,
} from './operationalLogging.js';
import { SqliteCompanySettingsAuditRetention } from '../modules/companySettings/infrastructure/sqliteCompanySettingsAuditRetention.js';
import { SqliteCustomerAuditRetention } from '../modules/customers/infrastructure/sqliteCustomerAuditRetention.js';
import { SqliteInvoiceSettingsAuditRetention } from '../modules/invoicing/infrastructure/sqliteInvoiceSettingsAuditRetention.js';
import { createProfileMaintenanceMiddleware } from './profileMaintenance.js';
import { ProfileMaintenanceState } from '../runtime/profileMaintenance/profileMaintenanceState.js';
import { createConsistentProfileSnapshotService } from '../runtime/profileSnapshot/createConsistentProfileSnapshot.js';
import type { ProfileSnapshotServiceRegistration } from '../runtime/profileSnapshot/profileSnapshotTypes.js';
import { StagedProfileSnapshotValidationService } from '../runtime/profileSnapshot/validateProfileSnapshot.js';
import { CurrentActiveProfileValidationService } from '../runtime/profileSnapshot/validateActiveProfile.js';

const defaultAppVersion = '0.0.0';

export interface CreateAppOptions {
  appVersion?: string;
  architecture?: string;
  buildCreatedAt?: string;
  buildDirty?: boolean;
  companyEmailSecretReader?: CompanyEmailSecretReader;
  companyEmailSecretStore?: CompanyEmailSecretStore;
  deliveredInvoiceArchiveTaskSink?: DeliveredInvoiceArchiveTaskSink;
  databaseFilePath?: string;
  electronVersion?: string;
  invoiceDocumentStorageRoot?: string;
  invoicingInfrastructureAdapters?: InvoicingInfrastructureAdapters;
  migrationsDirectory?: string;
  operationalLogger?: OperationalLogger;
  operationalIdentity?: Readonly<OperationalRuntimeIdentity>;
  operationalLogsRoot?: string;
  platform?: string;
  profileMaintenanceState?: ProfileMaintenanceState;
  profileSnapshotServiceRegistration?: ProfileSnapshotServiceRegistration;
  runtimeTrust?: RuntimeTrust;
}

export async function createApp(
  options: CreateAppOptions = {},
): Promise<Hono<BackendEnvironment>> {
  const appVersion = options.appVersion ?? defaultAppVersion;
  const operationalIdentity = resolveOperationalRuntimeIdentity({
    appVersion,
    ...(options.operationalIdentity === undefined
      ? {}
      : { operationalIdentity: options.operationalIdentity }),
  });
  const operationalLogger =
    options.operationalLogger ??
    (options.operationalLogsRoot === undefined
      ? noOpOperationalLogger
      : createBackendOperationalLogger(
          options.operationalLogsRoot,
          operationalIdentity,
        ));
  operationalLogger.write(
    createBackendOperationalEvent(
      { eventName: 'backend.starting' },
      operationalIdentity,
    ),
  );

  if (options.operationalLogsRoot !== undefined) {
    const retention = maintainOperationalLogs({
      logsRoot: options.operationalLogsRoot,
    });
    operationalLogger.write(
      createBackendOperationalEvent(
        {
          deletedByteCount: retention.deletedByteCount,
          deletedFileCount: retention.deletedFileCount,
          eventName: 'operationalLog.retentionCompleted',
          ...(retention.oldestRemainingMonth === undefined
            ? {}
            : { oldestRemainingMonth: retention.oldestRemainingMonth }),
        },
        operationalIdentity,
      ),
    );
  }

  operationalLogger.write(
    createBackendOperationalEvent(
      { eventName: 'database.opening' },
      operationalIdentity,
    ),
  );
  const databaseStartedAt = Date.now();
  let database: DatabaseConnection;
  try {
    database = createDatabaseConnection(
      options.databaseFilePath === undefined
        ? {}
        : { databaseFilePath: options.databaseFilePath },
    );
    operationalLogger.write(
      createBackendOperationalEvent(
        {
          durationMs: Date.now() - databaseStartedAt,
          eventName: 'database.opened',
        },
        operationalIdentity,
      ),
    );
  } catch {
    operationalLogger.write(
      createBackendOperationalEvent(
        {
          durationMs: Date.now() - databaseStartedAt,
          errorCode: 'DATABASE_OPEN_FAILED',
          eventName: 'database.openFailed',
          sideEffectState: 'none',
          stage: 'open',
        },
        operationalIdentity,
      ),
    );
    throw new Error('Database could not be opened.');
  }

  const migrationStartedAt = Date.now();
  operationalLogger.write(
    createBackendOperationalEvent(
      { eventName: 'migration.started', stage: 'startup' },
      operationalIdentity,
    ),
  );
  try {
    await runMigrations(
      database,
      {
        ...(options.migrationsDirectory === undefined
          ? {}
          : { migrationsDirectory: options.migrationsDirectory }),
        releaseIdentity: {
          appVersion: operationalIdentity.appVersion,
          buildRevision: operationalIdentity.buildRevision,
        },
      },
    );
    operationalLogger.write(
      createBackendOperationalEvent(
        {
          durationMs: Date.now() - migrationStartedAt,
          eventName: 'migration.completed',
          stage: 'startup',
        },
        operationalIdentity,
      ),
    );
  } catch (error) {
    const migrationFailure =
      error instanceof MigrationRunError
        ? error
        : {
            completedMigrationCount: 0,
            errorCode: 'MIGRATION_RUN_FAILED',
            failureStage: 'unknown' as const,
            sideEffectState: 'unknown' as const,
          };
    operationalLogger.write(
      createBackendOperationalEvent(
        {
          completedMigrationCount:
            migrationFailure.completedMigrationCount,
          durationMs: Date.now() - migrationStartedAt,
          errorCode: migrationFailure.errorCode,
          eventName: 'migration.failed',
          failureStage: migrationFailure.failureStage,
          sideEffectState: migrationFailure.sideEffectState,
        },
        operationalIdentity,
      ),
    );
    database.close();
    throw new Error('Database migrations could not be completed.');
  }

  try {
    const integrityResult: unknown = database.pragma('quick_check', {
      simple: true,
    });

    if (integrityResult !== 'ok') {
      throw new Error('Database integrity check failed.');
    }
  } catch {
    operationalLogger.write(
      createBackendOperationalEvent(
        {
          errorCode: 'DATABASE_INTEGRITY_CHECK_FAILED',
          eventName: 'database.integrityCheckFailed',
          sideEffectState: 'none',
          stage: 'startup',
        },
        operationalIdentity,
      ),
    );
    database.close();
    throw new Error('Database integrity could not be verified.');
  }

  try {
    const retention = await maintainBusinessAuditRetention(new Date(), {
      companySettingsAuditRetention:
        new SqliteCompanySettingsAuditRetention(database),
      customerAuditRetention: new SqliteCustomerAuditRetention(database),
      invoiceSettingsAuditRetention:
        new SqliteInvoiceSettingsAuditRetention(database),
    });
    operationalLogger.write(
      createBackendOperationalEvent(
        {
          deletedEventCount: retention.deletedEventCount,
          eventName: 'businessAudit.retentionCompleted',
        },
        operationalIdentity,
      ),
    );
  } catch {
    operationalLogger.write(
      createBackendOperationalEvent(
        {
          errorCode: 'BUSINESS_AUDIT_RETENTION_FAILED',
          eventName: 'businessAudit.retentionFailed',
          sideEffectState: 'unknown',
          stage: 'startup',
        },
        operationalIdentity,
      ),
    );
  }

  const localRuntimeIdentity = readLocalRuntimeIdentity(database);
  const profileMaintenanceState =
    options.profileMaintenanceState ?? new ProfileMaintenanceState();

  const app = new Hono<BackendEnvironment>();

  app.use(
    '*',
    createOperationalLoggingMiddleware({
      operationalIdentity,
      operationalLogger,
    }),
  );
  app.use(
    '*',
    createRuntimeTrustMiddleware(
      resolveRuntimeTrust(options.runtimeTrust),
      localRuntimeIdentity,
      {
        invalidSession(correlationId) {
          operationalLogger.write(
            createBackendOperationalEvent(
              {
                correlationId,
                eventName: 'runtimeSession.invalid',
              },
              operationalIdentity,
            ),
          );
        },
        missingSession(correlationId) {
          operationalLogger.write(
            createBackendOperationalEvent(
              {
                correlationId,
                eventName: 'runtimeSession.missing',
              },
              operationalIdentity,
            ),
          );
        },
      },
    ),
  );
  app.use('*', createProfileMaintenanceMiddleware(profileMaintenanceState));

  app.get('/health', (context) => {
    return context.json({ status: 'ok' });
  });

  const customersComposition = createCustomersComposition({
    database,
    operationalIdentity,
    operationalLogger,
  });
  const companySettingsComposition = createCompanySettingsComposition({
    database,
    operationalIdentity,
    operationalLogger,
    ...(options.companyEmailSecretStore === undefined
      ? {}
      : { companyEmailSecretStore: options.companyEmailSecretStore }),
  });
  const companyEmailSecretReader: CompanyEmailSecretReader =
    options.companyEmailSecretReader ?? {
      async getSecret() {
        return null;
      },
    };

  app.route('/', customersComposition.routes);
  app.route('/', companySettingsComposition.routes);

  const invoicingComposition = createInvoicingComposition({
    companyEmailSecretReader,
    customerAccessReader: customersComposition.customerAccessReader,
    deliveredInvoiceArchiveTaskSink:
      options.deliveredInvoiceArchiveTaskSink ??
      noOpDeliveredInvoiceArchiveTaskSink,
    invoiceCustomerTaxProfileReader:
      customersComposition.invoiceCustomerTaxProfileReader,
    database,
    ...(options.invoicingInfrastructureAdapters === undefined
      ? {}
      : {
          infrastructureAdapters:
            options.invoicingInfrastructureAdapters,
        }),
    invoiceEmailSettingsReader:
      companySettingsComposition.invoiceEmailSettingsReader,
    operationalLogger,
    operationalIdentity,
    ...(options.invoiceDocumentStorageRoot === undefined
      ? {}
      : { invoiceDocumentStorageRoot: options.invoiceDocumentStorageRoot }),
  });

  if (options.profileSnapshotServiceRegistration !== undefined) {
    if (
      options.migrationsDirectory === undefined ||
      options.invoiceDocumentStorageRoot === undefined
    ) {
      database.close();
      throw new Error(
        'Profile snapshot runtime paths must be configured.',
      );
    }
    const snapshotService = createConsistentProfileSnapshotService({
        catalog: invoicingComposition.invoiceBackupArtifactCatalog,
        database,
        invoiceDocumentStorageRoot: options.invoiceDocumentStorageRoot,
        maintenanceState: profileMaintenanceState,
        migrationsDirectory: options.migrationsDirectory,
        stagingRoot: options.profileSnapshotServiceRegistration.stagingRoot,
      });
    const validationService =
      new StagedProfileSnapshotValidationService({
        activeDatabase: database,
        migrationsDirectory: options.migrationsDirectory,
        stagingRoot: options.profileSnapshotServiceRegistration.stagingRoot,
      });
    const activeValidationService =
      new CurrentActiveProfileValidationService(
        database,
        options.invoiceDocumentStorageRoot,
      );
    options.profileSnapshotServiceRegistration.register({
      createProfileSnapshot: (input) =>
        snapshotService.createProfileSnapshot(input),
      prepareProfileRestoreActivation: (operationId) =>
        validationService.prepareProfileRestoreActivation(operationId),
      validateActiveProfile: () =>
        activeValidationService.validateActiveProfile(),
      validateProfileSnapshot: (operationId) =>
        validationService.validateProfileSnapshot(operationId),
    });
  }

  app.route('/', invoicingComposition.routes);
  app.route(
    '/',
    createActivityComposition({
      companySettingsActivityReader:
        companySettingsComposition.companySettingsActivityReader,
      customerActivityReader: customersComposition.customerActivityReader,
      invoiceActivityReader: invoicingComposition.invoiceActivityReader,
    }),
  );
  app.route(
    '/',
    createDiagnosticsComposition({
      buildCreatedAt:
        options.buildCreatedAt ?? new Date().toISOString(),
      buildDirty: options.buildDirty ?? true,
      database,
      electronVersion: options.electronVersion ?? null,
      operationalIdentity,
      operationalLogsRoot: options.operationalLogsRoot,
      runtimeArchitecture: options.architecture ?? process.arch,
      runtimeNodeVersion: process.version,
      runtimePlatform: options.platform ?? process.platform,
    }),
  );

  app.notFound((context) => {
    logUnknownRoute({
      operationalIdentity,
      correlationId: context.get('correlationId'),
      operationalLogger,
    });
    return context.json({ error: 'Not found.' }, 404);
  });

  return app;
}
