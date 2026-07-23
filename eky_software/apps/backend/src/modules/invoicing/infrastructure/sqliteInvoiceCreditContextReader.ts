import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { InvoiceRow } from '../../../database/schema.js';
import type { ApprovedInvoiceSummary } from '../domain/approvedInvoiceSummary.js';
import type { InvoiceCreditContext } from '../domain/invoiceCreditContext.js';
import type { InvoiceKind } from '../domain/invoiceKind.js';
import type { SentInvoiceGroup } from '../domain/sentInvoiceGroup.js';
import type { InvoiceCreditContextReader } from '../ports/invoiceCreditContextReader.js';

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

function toApprovedInvoiceSummary(invoice: InvoiceRow): ApprovedInvoiceSummary {
  return {
    id: invoice.id,
    invoiceKind: invoice.invoice_kind as InvoiceKind,
    creditedInvoiceId: invoice.credited_invoice_id,
    invoiceNumber: invoice.invoice_number,
    referenceNumber: invoice.reference_number ?? '',
    status: invoice.status as 'approved' | 'sent' | 'cancelled',
    customerId: invoice.customer_id,
    customerNumberSnapshot: invoice.customer_number_snapshot,
    customerNameSnapshot: invoice.customer_name_snapshot,
    billingRecipientNameSnapshot: invoice.billing_recipient_name_snapshot,
    invoiceDate: invoice.invoice_date,
    dueDate: invoice.due_date,
    grossTotalCents: invoice.total_gross_cents,
    approvedAt: invoice.approved_at,
    updatedAt: invoice.updated_at,
    cancelledAt: invoice.cancelled_at,
  };
}

function createSentInvoiceGroup(
  rootInvoice: ApprovedInvoiceSummary,
  creditInvoices: ApprovedInvoiceSummary[],
  creditedGrossCents: number,
): SentInvoiceGroup {
  const remainingCreditableGrossCents = Math.max(
    0,
    rootInvoice.grossTotalCents - creditedGrossCents,
  );

  return {
    rootInvoice,
    creditInvoices,
    creditStatus:
      creditedGrossCents <= 0
        ? 'none'
        : remainingCreditableGrossCents === 0
          ? 'full'
          : 'partial',
    remainingCreditableGrossCents,
  };
}
