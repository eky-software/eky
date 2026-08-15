import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { InvoiceIssuanceReadinessData } from '../domain/invoiceIssuanceReadiness.js';
import type { InvoiceIssuanceReadinessReader } from '../ports/invoiceIssuanceReadinessReader.js';

interface InvoiceIssuanceReadinessRow {
  billing_recipient_city: string | null;
  billing_recipient_name: string | null;
  billing_recipient_postal_code: string | null;
  billing_recipient_street_address: string | null;
  company_business_id: string | null;
  company_city: string | null;
  company_iban: string | null;
  company_name: string | null;
  company_postal_code: string | null;
  company_street_address: string | null;
  company_vat_number: string | null;
  customer_city: string | null;
  customer_name: string | null;
  customer_postal_code: string | null;
  customer_street_address: string | null;
  has_active_invoice_numbering_settings: number;
}

export class SqliteInvoiceIssuanceReadinessReader
  implements InvoiceIssuanceReadinessReader
{
  constructor(private readonly database: DatabaseConnection) {}

  async getReadinessData(
    companyId: string,
    invoiceDraftId: string,
  ): Promise<InvoiceIssuanceReadinessData | undefined> {
    const row = this.database
      .prepare<[string, string], InvoiceIssuanceReadinessRow>(
        `
          SELECT
            recipient.city AS billing_recipient_city,
            recipient.name AS billing_recipient_name,
            recipient.postal_code AS billing_recipient_postal_code,
            recipient.street_address AS billing_recipient_street_address,
            settings.business_id AS company_business_id,
            settings.city AS company_city,
            settings.iban AS company_iban,
            settings.company_name AS company_name,
            settings.postal_code AS company_postal_code,
            settings.street_address AS company_street_address,
            settings.vat_number AS company_vat_number,
            customer.city AS customer_city,
            customer.name AS customer_name,
            customer.postal_code AS customer_postal_code,
            customer.street_address AS customer_street_address,
            EXISTS (
              SELECT 1
              FROM invoice_numbering_active_series AS active_series
              INNER JOIN invoice_numbering_settings AS numbering_settings
                ON numbering_settings.company_id = active_series.company_id
                AND numbering_settings.series_key = active_series.active_series_key
              WHERE active_series.company_id = draft.company_id
            ) AS has_active_invoice_numbering_settings
          FROM invoice_drafts AS draft
          LEFT JOIN company_settings AS settings
            ON settings.company_id = draft.company_id
          LEFT JOIN customers AS customer
            ON customer.company_id = draft.company_id
            AND customer.id = draft.customer_id
          LEFT JOIN customers AS recipient
            ON recipient.company_id = draft.company_id
            AND recipient.id = COALESCE(
              draft.billing_recipient_customer_id,
              draft.customer_id
            )
          WHERE draft.company_id = ?
            AND draft.id = ?
            AND draft.status = 'draft'
            AND draft.invoice_kind = 'standard'
            AND draft.credited_invoice_id IS NULL
            AND draft.approved_invoice_id IS NULL
        `,
      )
      .get(companyId, invoiceDraftId);

    if (row === undefined) {
      return undefined;
    }

    return {
      billingRecipientCity: row.billing_recipient_city ?? '',
      billingRecipientName: row.billing_recipient_name ?? '',
      billingRecipientPostalCode: row.billing_recipient_postal_code ?? '',
      billingRecipientStreetAddress:
        row.billing_recipient_street_address ?? '',
      companyBusinessId: row.company_business_id ?? '',
      companyCity: row.company_city ?? '',
      companyIban: row.company_iban ?? '',
      companyName: row.company_name ?? '',
      companyPostalCode: row.company_postal_code ?? '',
      companyStreetAddress: row.company_street_address ?? '',
      companyVatNumber: row.company_vat_number ?? '',
      customerCity: row.customer_city ?? '',
      customerName: row.customer_name ?? '',
      customerPostalCode: row.customer_postal_code ?? '',
      customerStreetAddress: row.customer_street_address ?? '',
      hasActiveInvoiceNumberingSettings:
        row.has_active_invoice_numbering_settings === 1,
    };
  }
}
