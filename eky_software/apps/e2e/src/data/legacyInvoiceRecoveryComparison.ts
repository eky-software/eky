import { isDeepStrictEqual } from 'node:util';

import { withReadOnlyDatabaseConnection } from '../../../backend/src/database/connection/openReadOnlyDatabaseConnection.js';

const tables = ['invoices', 'invoice_lines', 'invoice_documents', 'invoice_delivery_events'] as const;
type LegacyRow = Readonly<Record<string, unknown>>;
export type LegacyInvoiceRecoverySnapshot = Readonly<Record<typeof tables[number], readonly LegacyRow[]>>;

export function readLegacyInvoiceRecoverySnapshot(databaseFilePath: string): LegacyInvoiceRecoverySnapshot {
  if (process.env.EKY_E2E !== '1') throw new Error('LEGACY_RECOVERY_COMPARISON_E2E_REQUIRED');
  return withReadOnlyDatabaseConnection(databaseFilePath, database => ({
    invoices: database.prepare<[], LegacyRow>('SELECT * FROM invoices ORDER BY id').all(),
    invoice_lines: database.prepare<[], LegacyRow>('SELECT * FROM invoice_lines ORDER BY id').all(),
    invoice_documents: database.prepare<[], LegacyRow>('SELECT * FROM invoice_documents ORDER BY id').all(),
    invoice_delivery_events: database.prepare<[], LegacyRow>('SELECT * FROM invoice_delivery_events ORDER BY id').all(),
  }));
}

export function assertLegacyInvoiceRecoveryPreserved(
  original: LegacyInvoiceRecoverySnapshot,
  restored: LegacyInvoiceRecoverySnapshot,
): void {
  // Migration adds columns, but every original value and row must survive.
  for (const table of tables) {
    const expected = original[table];
    const actual = restored[table];
    if (actual.length !== expected.length || expected.some((row, index) => {
      const restoredRow = actual[index]!;
      return !isDeepStrictEqual(row, Object.fromEntries(Object.keys(row).map(key => [key, restoredRow[key]])));
    })) throw new Error('PACKAGED_LEGACY_BUSINESS_CONTENT_CHANGED');
  }
}
