import { expect } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { InvoiceContentRevisionRow, InvoiceRevisionLineRow } from '../../../database/schema.js';
import type { InvoiceContentRevision, InvoiceContentRevisionLine } from '../domain/invoiceContentRevision.js';

// Independent read-contract oracle; never import the production mapper's field list.
export const headerFields = [
  ['source_draft_id', 'sourceDraftId'],
  ['invoice_kind', 'invoiceKind'],
  ['credited_invoice_id', 'creditedInvoiceId'],
  ['invoice_number', 'invoiceNumber'],
  ['reference_number', 'referenceNumber'],
  ['reference_number_type', 'referenceNumberType'],
  ['series_key', 'seriesKey'],
  ['sequence_scope', 'sequenceScope'],
  ['sequence_number', 'sequenceNumber'],
  ['numbering_mode', 'numberingMode'],
  ['customer_id', 'customerId'],
  ['customer_number_snapshot', 'customerNumberSnapshot'],
  ['customer_name_snapshot', 'customerNameSnapshot'],
  ['customer_business_id_snapshot', 'customerBusinessIdSnapshot'],
  ['customer_type_snapshot', 'customerTypeSnapshot'],
  ['customer_email_snapshot', 'customerEmailSnapshot'],
  ['customer_phone_snapshot', 'customerPhoneSnapshot'],
  ['customer_street_address_snapshot', 'customerStreetAddressSnapshot'],
  ['customer_postal_code_snapshot', 'customerPostalCodeSnapshot'],
  ['customer_city_snapshot', 'customerCitySnapshot'],
  ['company_name_snapshot', 'companyNameSnapshot'],
  ['company_business_id_snapshot', 'companyBusinessIdSnapshot'],
  ['company_vat_number_snapshot', 'companyVatNumberSnapshot'],
  ['company_street_address_snapshot', 'companyStreetAddressSnapshot'],
  ['company_postal_code_snapshot', 'companyPostalCodeSnapshot'],
  ['company_city_snapshot', 'companyCitySnapshot'],
  ['company_email_snapshot', 'companyEmailSnapshot'],
  ['company_phone_snapshot', 'companyPhoneSnapshot'],
  ['company_website_snapshot', 'companyWebsiteSnapshot'],
  ['company_iban_snapshot', 'companyIbanSnapshot'],
  ['company_bic_snapshot', 'companyBicSnapshot'],
  ['company_bank_name_snapshot', 'companyBankNameSnapshot'],
  ['billing_recipient_customer_id', 'billingRecipientCustomerId'],
  ['billing_recipient_customer_number_snapshot', 'billingRecipientCustomerNumberSnapshot'],
  ['billing_recipient_name_snapshot', 'billingRecipientNameSnapshot'],
  ['billing_recipient_business_id_snapshot', 'billingRecipientBusinessIdSnapshot'],
  ['billing_recipient_customer_type_snapshot', 'billingRecipientCustomerTypeSnapshot'],
  ['billing_recipient_email_snapshot', 'billingRecipientEmailSnapshot'],
  ['billing_recipient_phone_snapshot', 'billingRecipientPhoneSnapshot'],
  ['billing_recipient_street_address_snapshot', 'billingRecipientStreetAddressSnapshot'],
  ['billing_recipient_postal_code_snapshot', 'billingRecipientPostalCodeSnapshot'],
  ['billing_recipient_city_snapshot', 'billingRecipientCitySnapshot'],
  ['invoice_date', 'invoiceDate'],
  ['due_date', 'dueDate'],
  ['payment_term_days', 'paymentTermDays'],
  ['reminder_period_days', 'reminderPeriodDays'],
  ['late_payment_interest_basis_points', 'latePaymentInterestBasisPoints'],
  ['price_input_mode', 'priceInputMode'],
  ['subject', 'subject'],
  ['order_number', 'orderNumber'],
  ['note', 'note'],
  ['delivery_address_text', 'deliveryAddressText'],
  ['refund_iban_snapshot', 'refundIbanSnapshot'],
  ['tax_treatment', 'taxTreatment'],
  ['tax_treatment_label_snapshot', 'taxTreatmentLabelSnapshot'],
  ['tax_legal_basis_snapshot', 'taxLegalBasisSnapshot'],
  ['performance_date', 'performanceDate'],
  ['performance_period_start', 'performancePeriodStart'],
  ['performance_period_end', 'performancePeriodEnd'],
  ['total_net_cents', 'totalNetCents'],
  ['total_vat_cents', 'totalVatCents'],
  ['total_gross_cents', 'totalGrossCents'],
  ['created_at', 'createdAt'],
  ['approved_at', 'approvedAt'],
] as const satisfies readonly (readonly [keyof InvoiceContentRevisionRow, keyof InvoiceContentRevision])[];

export const lineFields = [
  ['line_id', 'lineId'], ['invoice_id', 'invoiceId'],
  ['source_invoice_line_id', 'sourceInvoiceLineId'], ['line_order', 'lineOrder'],
  ['code', 'code'], ['description', 'description'],
  ['quantity_hundredths', 'quantityHundredths'], ['unit', 'unit'],
  ['unit_price_cents', 'unitPriceCents'], ['vat_rate_basis_points', 'vatRateBasisPoints'],
  ['discount_type', 'discountType'], ['discount_value', 'discountValue'],
  ['base_cents', 'baseCents'], ['discount_cents', 'discountCents'],
  ['net_cents', 'netCents'], ['vat_cents', 'vatCents'],
  ['gross_cents', 'grossCents'], ['created_at', 'createdAt'],
] as const satisfies readonly (readonly [keyof InvoiceRevisionLineRow, keyof InvoiceContentRevisionLine])[];

export const readerScope = { companyId: 'revision-company', invoiceId: 'revision-invoice' } as const;
export type StoredValues = Record<string, string | number | null>;
type CorruptionTable = 'invoice_content_revisions' | 'invoice_revision_lines'
  | 'invoice_revision_vat_breakdown' | 'invoice_current_revisions' | 'invoices' | 'invoice_lines';

function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function bypassReaderFixtureConstraints(
  database: DatabaseConnection,
  table: CorruptionTable,
  operation: () => void,
): void {
  expect(database.inTransaction).toBe(false);
  const triggers = database.prepare<[string], { name: string; sql: string }>(`
    SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?
  `).all(table);
  const foreignKeys = database.pragma('foreign_keys', { simple: true });
  const checksIgnored = database.pragma('ignore_check_constraints', { simple: true });
  // Only the isolated test database is modified; restore its guards before reading.
  database.pragma('foreign_keys = OFF');
  database.pragma('ignore_check_constraints = ON');
  try {
    for (const trigger of triggers) database.exec(`DROP TRIGGER ${identifier(trigger.name)}`);
    operation();
  } finally {
    for (const trigger of triggers) database.exec(trigger.sql);
    database.pragma(`ignore_check_constraints = ${checksIgnored ? 'ON' : 'OFF'}`);
    database.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  }
}

export function corruptStoredReaderRow(
  database: DatabaseConnection,
  table: CorruptionTable,
  key: StoredValues,
  values: StoredValues,
): void {
  const where = Object.keys(key).map((column) => `${identifier(column)} IS ?`).join(' AND ');
  const assignments = Object.keys(values).map((column) => `${identifier(column)} = ?`).join(', ');
  bypassReaderFixtureConstraints(database, table, () => {
    const result = database.prepare(`UPDATE ${identifier(table)} SET ${assignments} WHERE ${where}`)
      .run(...Object.values(values), ...Object.values(key));
    expect(result.changes).toBe(1);
  });
  const newKey = { ...key };
  for (const column of Object.keys(key)) {
    if (Object.hasOwn(values, column)) newKey[column] = values[column]!;
  }
  expect(database.prepare(`SELECT * FROM ${identifier(table)} WHERE ${where}`)
    .get(...Object.values(newKey))).toMatchObject(values);
}

export function deleteStoredReaderRows(
  database: DatabaseConnection,
  table: CorruptionTable,
  key: StoredValues,
): void {
  const where = Object.keys(key).map((column) => `${identifier(column)} IS ?`).join(' AND ');
  bypassReaderFixtureConstraints(database, table, () => {
    expect(database.prepare(`DELETE FROM ${identifier(table)} WHERE ${where}`)
      .run(...Object.values(key)).changes).toBeGreaterThan(0);
  });
  expect(database.prepare(`SELECT * FROM ${identifier(table)} WHERE ${where}`)
    .all(...Object.values(key))).toEqual([]);
}

export function totalChanges(database: DatabaseConnection): number {
  return database.prepare<[], { changes: number }>('SELECT total_changes() AS changes').get()!.changes;
}
