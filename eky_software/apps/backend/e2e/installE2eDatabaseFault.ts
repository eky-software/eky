import { fileURLToPath } from 'node:url';

import { createDatabaseConnection } from '../src/database/connection/createDatabaseConnection.js';
import { runMigrations } from '../src/database/migration/runMigrations.js';
import type { E2eFaultPlan } from './e2eBackendConfig.js';

const migrationsDirectory = fileURLToPath(
  new URL('../src/database/migrations/', import.meta.url),
);

export async function installE2eDatabaseFault(input: {
  databaseFilePath: string;
  faultPlan: E2eFaultPlan;
}): Promise<void> {
  if (input.faultPlan.kind !== 'databaseWriteFailed') {
    return;
  }

  const database = createDatabaseConnection({
    databaseFilePath: input.databaseFilePath,
  });
  try {
    await runMigrations(database, { migrationsDirectory });
    database.exec(`
      CREATE TABLE _e2e_fault_state (
        operation TEXT PRIMARY KEY,
        call_count INTEGER NOT NULL
      );
      INSERT INTO _e2e_fault_state (operation, call_count)
      VALUES ('${input.faultPlan.operation}', 0);
    `);

    for (const trigger of resolveTriggers(input.faultPlan.operation)) {
      database.exec(`
        CREATE TRIGGER ${trigger.name}
        BEFORE ${trigger.action} ON ${trigger.tableName}
        BEGIN
          UPDATE _e2e_fault_state
          SET call_count = call_count + 1
          WHERE operation = '${input.faultPlan.operation}';
          SELECT CASE
            WHEN (
              SELECT call_count
              FROM _e2e_fault_state
              WHERE operation = '${input.faultPlan.operation}'
            ) >= ${String(input.faultPlan.failOnCall)}
            THEN RAISE(ABORT, 'E2E_DATABASE_WRITE_FAILED')
          END;
        END;
      `);
    }
  } finally {
    database.close();
  }
}

function resolveTriggers(
  operation: Extract<
    E2eFaultPlan,
    { kind: 'databaseWriteFailed' }
  >['operation'],
): readonly {
  action: 'INSERT' | 'UPDATE';
  name: string;
  tableName: string;
}[] {
  switch (operation) {
    case 'approveInvoice':
      return [
        {
          action: 'INSERT',
          name: '_e2e_fail_approve_invoice',
          tableName: 'invoices',
        },
      ];
    case 'markInvoicePaidEvent':
      return [
        {
          action: 'INSERT',
          name: '_e2e_fail_mark_invoice_paid_event',
          tableName: 'invoice_payment_events',
        },
      ];
    case 'updateCustomer':
      return [
        {
          action: 'UPDATE',
          name: '_e2e_fail_update_customer',
          tableName: 'customers',
        },
      ];
    case 'updateCompanySettings':
      return [
        {
          action: 'INSERT',
          name: '_e2e_fail_insert_company_settings',
          tableName: 'company_settings',
        },
        {
          action: 'UPDATE',
          name: '_e2e_fail_update_company_settings',
          tableName: 'company_settings',
        },
      ];
  }
}
