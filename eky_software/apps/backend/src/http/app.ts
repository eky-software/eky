import { Hono } from 'hono';

import {
  createRuntimeTrustMiddleware,
  resolveRuntimeTrust,
  type BackendEnvironment,
  type RuntimeTrust,
} from './runtimeTrust.js';

import type { DatabaseConnection } from '../database/connection/createDatabaseConnection.js';
import { readLocalRuntimeIdentity } from '../database/localRuntimeIdentityReader.js';
import { resolveMigrationsDirectory, runMigrations } from '../database/migration/runMigrations.js';
import { MigrationRunError } from '../database/migration/migrationRunError.js';
import {
  observeMigrationStartupStep,
  type MigrationStartupObserver,
} from '../database/migration/migrationStartupObservation.js';
import { openAttestedMigrationDatabase } from '../database/migration/openAttestedMigrationDatabase.js';
import {
  recoverOwnedLocalDatabase,
  type OwnedLocalDatabaseRecovery,
} from '../database/connection/recoverOwnedLocalDatabase.js';
import {
  inspectMigrationStartupState,
  type MigrationStartupInspection,
  type MigrationStartupPolicy,
} from '../database/migration/inspectMigrationStartupState.js';
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
import { createActiveProfileInspectionContextReader } from '../runtime/profileSnapshot/activeProfileInspectionContext.js';
import { CurrentActiveProfileValidationService } from '../runtime/profileSnapshot/validateActiveProfile.js';
import { SqliteInvoiceBackupArtifactCatalog } from '../modules/invoicing/infrastructure/sqliteInvoiceBackupArtifactCatalog.js';
import {
  selectInvoiceBackupArtifactCatalogSchema,
  type InvoiceBackupArtifactCatalogSchema,
} from '../modules/invoicing/infrastructure/selectInvoiceBackupArtifactCatalogSchema.js';

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
  migrationStartupPolicy?: MigrationStartupPolicy;
  migrationStartupObserver?: MigrationStartupObserver;
  ownedLocalDatabaseRecovery?: OwnedLocalDatabaseRecovery;
  operationalLogger?: OperationalLogger;
  operationalIdentity?: Readonly<OperationalRuntimeIdentity>;
  operationalLogsRoot?: string;
  platform?: string;
  profileMaintenanceState?: ProfileMaintenanceState;
  profileSnapshotServiceRegistration?: ProfileSnapshotServiceRegistration;
  runtimeTrust?: RuntimeTrust;
  beforeMigrations?: (
    inspection: Readonly<MigrationStartupInspection>,
  ) => Promise<void>;
}

export async function createApp(
  options: CreateAppOptions = {},
): Promise<Hono<BackendEnvironment>> {
  const appVersion = options.appVersion ?? defaultAppVersion;
  const migrationsDirectory = resolveMigrationsDirectory(options.migrationsDirectory);
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
    if (options.ownedLocalDatabaseRecovery !== undefined) {
      if (options.databaseFilePath === undefined) throw new Error('LOCAL_DATABASE_RECOVERY_FAILED');
      await recoverOwnedLocalDatabase(options.databaseFilePath, options.ownedLocalDatabaseRecovery);
    }
    database = openAttestedMigrationDatabase({
      allowCreate: true,
      allowEmpty: true,
      ...(options.databaseFilePath === undefined ? {} : { databaseFilePath: options.databaseFilePath }),
      migrationsDirectory,
      policy: options.beforeMigrations === undefined
        ? 'runnerBaseline'
        : options.migrationStartupPolicy ?? 'exactCurrentManifest',
    });
    operationalLogger.write(
      createBackendOperationalEvent(
        {
          durationMs: Date.now() - databaseStartedAt,
          eventName: 'database.opened',
        },
        operationalIdentity,
      ),
    );
  } catch (error) {
    if (error instanceof MigrationRunError) {
      writeMigrationFailure(operationalLogger, operationalIdentity, error, Date.now() - databaseStartedAt);
      throw new Error('Database migrations could not be completed.', { cause: error });
    }
    operationalLogger.write(
      createBackendOperationalEvent(
        {
          durationMs: Date.now() - databaseStartedAt,
          errorCode: 'DATABASE_OPEN_FAILED',
          eventName: 'database.openFailed',
          sideEffectState: options.ownedLocalDatabaseRecovery === undefined ? 'none' : 'unknown',
          stage: 'open',
        },
        operationalIdentity,
      ),
    );
    throw new Error('Database could not be opened.', { cause: error });
  }

  const profileMaintenanceState =
    options.profileMaintenanceState ?? new ProfileMaintenanceState();
  let catalogMigrationPolicy: MigrationStartupPolicy = options.beforeMigrations === undefined
    ? 'exactCurrentManifest' : options.migrationStartupPolicy ?? 'exactCurrentManifest';

  if (options.profileSnapshotServiceRegistration !== undefined) {
    if (options.invoiceDocumentStorageRoot === undefined) {
      database.close();
      throw new Error(
        'Profile snapshot runtime paths must be configured.',
      );
    }
    registerProfileSnapshotServices({
      database,
      invoiceDocumentStorageRoot: options.invoiceDocumentStorageRoot,
      migrationsDirectory,
      profileMaintenanceState,
      readCatalogMigrationPolicy: () => catalogMigrationPolicy,
      registration: options.profileSnapshotServiceRegistration,
    });
  }

  if (options.beforeMigrations !== undefined) {
    try {
      const inspection = inspectMigrationStartupState(
        database,
        migrationsDirectory,
        options.migrationStartupPolicy,
      );
      await options.beforeMigrations(Object.freeze({
        appliedMigrationCount: inspection.appliedMigrationCount,
        migrationChainIdentity: inspection.migrationChainIdentity,
        pendingMigrationCount: inspection.pendingMigrationCount,
        profileState: inspection.profileState,
      }));
    } catch {
      database.close();
      throw new Error(
        'Database migration startup gate could not be completed.',
      );
    } finally {
      // Restore compatibility belongs to the admitted gate, not the running business backend.
      catalogMigrationPolicy = 'exactCurrentManifest';
    }
  }

  const migrationStartedAt = Date.now();
  let invoiceCatalogSchema: InvoiceBackupArtifactCatalogSchema;
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
        migrationsDirectory,
        ...(options.migrationStartupObserver === undefined
          ? {} : { observeStartup: options.migrationStartupObserver }),
        releaseIdentity: {
          appVersion: operationalIdentity.appVersion,
          buildRevision: operationalIdentity.buildRevision,
        },
      },
    );
    const current = observeMigrationStartupStep(options.migrationStartupObserver, 'postRunInspection', () =>
      inspectMigrationStartupState(database, migrationsDirectory),
    );
    if (current.pendingMigrationCount !== 0) {
      throw new Error('MIGRATION_STARTUP_INSPECTION_FAILED');
    }
    observeMigrationStartupStep(options.migrationStartupObserver, 'identityRead', () =>
      readLocalRuntimeIdentity(database),
    );
    invoiceCatalogSchema = selectInvoiceBackupArtifactCatalogSchema(current);
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
    writeMigrationFailure(operationalLogger, operationalIdentity, error, Date.now() - migrationStartedAt);
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
    schema: invoiceCatalogSchema,
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

function writeMigrationFailure(
  logger: OperationalLogger,
  identity: Readonly<OperationalRuntimeIdentity>,
  error: unknown,
  durationMs: number,
): void {
  const failure = error instanceof MigrationRunError ? error : {
    completedMigrationCount: 0,
    errorCode: 'MIGRATION_RUN_FAILED',
    failureStage: 'unknown' as const,
    sideEffectState: 'unknown' as const,
  };
  logger.write(createBackendOperationalEvent({
    completedMigrationCount: failure.completedMigrationCount,
    durationMs,
    errorCode: failure.errorCode,
    eventName: 'migration.failed',
    failureStage: failure.failureStage,
    sideEffectState: failure.sideEffectState,
  }, identity));
}

function registerProfileSnapshotServices(input: {
  database: DatabaseConnection;
  invoiceDocumentStorageRoot: string;
  migrationsDirectory: string;
  profileMaintenanceState: ProfileMaintenanceState;
  readCatalogMigrationPolicy(): MigrationStartupPolicy;
  registration: ProfileSnapshotServiceRegistration;
}): void {
  const snapshotService = createConsistentProfileSnapshotService({
    catalog: {
      listAuthoritativeArtifacts: () => {
        const history = inspectMigrationStartupState(
          input.database, input.migrationsDirectory, input.readCatalogMigrationPolicy(),
        );
        readLocalRuntimeIdentity(input.database);
        return new SqliteInvoiceBackupArtifactCatalog(
          input.database, selectInvoiceBackupArtifactCatalogSchema(history),
        ).listAuthoritativeArtifacts();
      },
    },
    database: input.database,
    invoiceDocumentStorageRoot: input.invoiceDocumentStorageRoot,
    maintenanceState: input.profileMaintenanceState,
    stagingRoot: input.registration.stagingRoot,
  });
  const activeContextReader = createActiveProfileInspectionContextReader(input.database);
  const validationService = new StagedProfileSnapshotValidationService({
    activeContextReader,
    migrationsDirectory: input.migrationsDirectory,
    stagingRoot: input.registration.stagingRoot,
  });
  const activeValidationService = new CurrentActiveProfileValidationService(
    input.database,
    input.invoiceDocumentStorageRoot,
    () => {
      const history = inspectMigrationStartupState(
        input.database,
        input.migrationsDirectory,
        input.readCatalogMigrationPolicy(),
      );
      return history;
    },
  );
  input.registration.register({
    readProfileInspectionContext: () => activeContextReader.readProfileInspectionContext(),
    createProfileSnapshot: (request) =>
      snapshotService.createProfileSnapshot(request),
    prepareProfileRestoreActivation: (operationId) =>
      validationService.prepareProfileRestoreActivation(operationId),
    validateActiveProfile: () =>
      activeValidationService.validateActiveProfile(),
    validateProfileSnapshot: (operationId) =>
      validationService.validateProfileSnapshot(operationId),
  });
}
