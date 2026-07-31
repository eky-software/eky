import type {
  ApprovedInvoiceSummary,
  InvoiceDraftSummary,
  SentInvoiceGroup,
} from '@eky/api-client';

import type { CustomerInvoiceNavigationTarget } from './customerInvoiceNavigation.js';
import { uiText } from '../../i18n/fi.js';

export interface CustomerInvoiceRow {
  date: string;
  dueDate: string;
  grossTotalCents: number;
  id: string;
  isCredit: boolean;
  reference: string;
  relation: string;
  status: string;
  target: CustomerInvoiceNavigationTarget;
}

export function toDraftRows(
  drafts: readonly InvoiceDraftSummary[],
): CustomerInvoiceRow[] {
  return drafts.map((draft) => ({
    date: draft.updatedAt,
    dueDate: draft.dueDate,
    grossTotalCents: draft.grossTotalCents,
    id: draft.id,
    isCredit: draft.invoiceKind === 'credit',
    reference: uiText.customers.invoiceDraft,
    relation:
      draft.invoiceKind === 'credit'
        ? uiText.customers.creditDraft
        : draft.subject,
    status: uiText.customers.invoiceStatuses.draft,
    target: {
      id: draft.id,
      invoiceKind: draft.invoiceKind,
      type: 'draft',
    },
  }));
}

export function toApprovedRows(
  invoices: readonly ApprovedInvoiceSummary[],
  status: 'approved' | 'cancelled',
): CustomerInvoiceRow[] {
  return invoices.map((invoice) => ({
    date: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    grossTotalCents: invoice.grossTotalCents,
    id: invoice.id,
    isCredit: invoice.invoiceKind === 'credit',
    reference: invoice.invoiceNumber,
    relation: getCreditRelation(invoice),
    status:
      status === 'approved'
        ? uiText.customers.invoiceStatuses.approved
        : uiText.customers.invoiceStatuses.cancelled,
    target: {
      id: invoice.id,
      type: 'approvedInvoice',
    },
  }));
}

export function toSentRows(
  groups: readonly SentInvoiceGroup[],
): CustomerInvoiceRow[] {
  return groups.flatMap((group) => {
    const rootRow: CustomerInvoiceRow = {
      date: group.rootInvoice.invoiceDate,
      dueDate: group.rootInvoice.dueDate,
      grossTotalCents: group.rootInvoice.grossTotalCents,
      id: group.rootInvoice.id,
      isCredit: false,
      reference: group.rootInvoice.invoiceNumber,
      relation:
        group.creditInvoices.length === 0
          ? ''
          : uiText.customers.creditInvoiceRelation(
              group.creditInvoices.map((invoice) => invoice.invoiceNumber),
            ),
      status:
        group.creditStatus === 'partial'
          ? uiText.customers.invoiceStatuses.partiallyCredited
          : group.creditStatus === 'full'
            ? uiText.customers.invoiceStatuses.fullyCredited
            : uiText.customers.invoiceStatuses.sent,
      target: {
        id: group.rootInvoice.id,
        type: 'approvedInvoice',
      },
    };
    const creditRows = group.creditInvoices.map(
      (creditInvoice): CustomerInvoiceRow => ({
        date: creditInvoice.invoiceDate,
        dueDate: creditInvoice.dueDate,
        grossTotalCents: creditInvoice.grossTotalCents,
        id: creditInvoice.id,
        isCredit: true,
        reference: creditInvoice.invoiceNumber,
        relation: uiText.customers.creditsInvoice(
          group.rootInvoice.invoiceNumber,
        ),
        status: uiText.customers.invoiceStatuses.creditInvoice,
        target: {
          id: creditInvoice.id,
          type: 'approvedInvoice',
        },
      }),
    );

    return [rootRow, ...creditRows];
  });
}

function getCreditRelation(invoice: ApprovedInvoiceSummary): string {
  if (
    invoice.invoiceKind !== 'credit' ||
    invoice.creditedInvoiceId === null
  ) {
    return '';
  }

  return uiText.customers.creditInvoice;
}
