import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { InvoiceRow } from '../../../database/schema.js';
import type { InvoiceCreditContext } from '../domain/invoiceCreditContext.js';
import type { InvoiceCreditContextReader } from '../ports/invoiceCreditContextReader.js';
import { toApprovedInvoiceSummary } from './approvedInvoiceReadModelMapping.js';
import { createSentInvoiceGroup } from './sentInvoiceGroupMapping.js';

type InvoiceCreditContextKeyParameters = [string, string];

interface ActiveCreditDraftRow {
  id: string;
}

export class SqliteInvoiceCreditContextReader
  implements InvoiceCreditContextReader
{
  constructor(private readonly database: DatabaseConnection) {}

  async getInvoiceCreditContext(
    companyId: string,
    sourceInvoiceId: string,
  ): Promise<InvoiceCreditContext | undefined> {
    const sourceInvoice = this.database
      .prepare<InvoiceCreditContextKeyParameters, InvoiceRow>(
        `
          SELECT *
          FROM invoices
          WHERE
            company_id = ?
            AND id = ?
            AND invoice_kind = 'standard'
            AND status = 'sent'
        `,
      )
      .get(companyId, sourceInvoiceId);

    if (sourceInvoice === undefined) {
      return undefined;
    }

    const creditInvoices = this.database
      .prepare<InvoiceCreditContextKeyParameters, InvoiceRow>(
        `
          SELECT *
          FROM invoices
          WHERE
            company_id = ?
            AND credited_invoice_id = ?
            AND invoice_kind = 'credit'
            AND status IN ('approved', 'sent')
          ORDER BY invoice_date ASC, id ASC
        `,
      )
      .all(companyId, sourceInvoiceId)
      .map(toApprovedInvoiceSummary);
    const activeCreditDraft = this.database
      .prepare<InvoiceCreditContextKeyParameters, ActiveCreditDraftRow>(
        `
          SELECT id
          FROM invoice_drafts
          WHERE
            company_id = ?
            AND credited_invoice_id = ?
            AND invoice_kind = 'credit'
            AND approved_invoice_id IS NULL
          ORDER BY created_at ASC, id ASC
          LIMIT 1
        `,
      )
      .get(companyId, sourceInvoiceId);
    const creditedGrossCents = creditInvoices.reduce(
      (sum, invoice) => sum + invoice.grossTotalCents,
      0,
    );
    const group = createSentInvoiceGroup(
      toApprovedInvoiceSummary(sourceInvoice),
      creditInvoices,
      creditedGrossCents,
    );

    return {
      sourceInvoiceId,
      creditInvoices,
      creditStatus: group.creditStatus,
      remainingCreditableGrossCents: group.remainingCreditableGrossCents,
      activeCreditDraftId: activeCreditDraft?.id ?? null,
    };
  }
}
