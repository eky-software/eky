import type { ApprovedInvoiceSummary } from '../domain/approvedInvoiceSummary.js';
import type { SentInvoiceGroup } from '../domain/sentInvoiceGroup.js';

export function groupCreditInvoices(
  creditInvoices: ApprovedInvoiceSummary[],
): Map<string, ApprovedInvoiceSummary[]> {
  const invoicesByRoot = new Map<string, ApprovedInvoiceSummary[]>();

  for (const creditInvoice of creditInvoices) {
    if (creditInvoice.creditedInvoiceId === null) {
      continue;
    }

    const invoices = invoicesByRoot.get(creditInvoice.creditedInvoiceId) ?? [];
    invoices.push(creditInvoice);
    invoicesByRoot.set(creditInvoice.creditedInvoiceId, invoices);
  }

  return invoicesByRoot;
}

export function createSentInvoiceGroup(
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
