import { DatabaseSync } from 'node:sqlite';

import type { E2eFaultPlan } from '../../../backend/e2e/e2eBackendConfig.js';

type DatabaseFaultOperation = Extract<
  E2eFaultPlan,
  { kind: 'databaseWriteFailed' }
>['operation'];

const triggerNamesByOperation = Object.freeze({
  approveInvoice: ['_e2e_fail_approve_invoice'],
  markInvoicePaidEvent: ['_e2e_fail_mark_invoice_paid_event'],
  updateCompanySettings: [
    '_e2e_fail_insert_company_settings',
    '_e2e_fail_update_company_settings',
  ],
  updateCustomer: ['_e2e_fail_update_customer'],
} satisfies Record<DatabaseFaultOperation, readonly string[]>);

export function releaseE2eDatabaseFault(
  databaseFilePath: string,
  operation: DatabaseFaultOperation,
): void {
  const database = new DatabaseSync(databaseFilePath);

  try {
    database.exec('BEGIN IMMEDIATE');
    for (const triggerName of triggerNamesByOperation[operation]) {
      database.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
    }
    database.exec('DROP TABLE IF EXISTS _e2e_fault_state');
    database.exec('COMMIT');
  } catch (error) {
    if (database.isTransaction) {
      database.exec('ROLLBACK');
    }
    throw error;
  } finally {
    database.close();
  }
}
