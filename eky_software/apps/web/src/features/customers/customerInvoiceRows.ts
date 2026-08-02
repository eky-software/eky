import type {
  ApprovedInvoiceSummary,
  InvoiceDraftSummary,
  SentInvoiceGroup,
} from '@eky/api-client';

import type { CustomerInvoiceNavigationTarget } from './customerInvoiceNavigation.js';
import { uiText } from '../../i18n/fi.js';

export interface CustomerInvoiceRow {
  customer: string;
  date: string;
  dueDate: string;
  grossTotalCents: number;
  id: string;
  isCredit: boolean;
  paidOn: string | null;
  reference: string;
  status: string;
  subject: string;
  target: CustomerInvoiceNavigationTarget;
}

export function toDraftRows(
  drafts: readonly InvoiceDraftSummary[],
): CustomerInvoiceRow[] {
  return drafts.map((draft) => ({
    customer: '',
    date: draft.invoiceDate,
    dueDate: draft.dueDate,
    grossTotalCents: draft.grossTotalCents,
    id: draft.id,
    isCredit: draft.invoiceKind === 'credit',
    paidOn: null,
    reference: uiText.customers.invoiceDraft,
    status: uiText.customers.invoiceStatuses.draft,
    subject: draft.subject,
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
    customer: formatInvoiceCustomer(invoice),
    date: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    grossTotalCents: invoice.grossTotalCents,
    id: invoice.id,
    isCredit: invoice.invoiceKind === 'credit',
    paidOn: invoice.paidOn,
    reference: invoice.invoiceNumber,
    status:
      status === 'approved'
        ? uiText.customers.invoiceStatuses.approved
        : uiText.customers.invoiceStatuses.cancelled,
    subject: invoice.subject,
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
      customer: formatInvoiceCustomer(group.rootInvoice),
      date: group.rootInvoice.invoiceDate,
      dueDate: group.rootInvoice.dueDate,
      grossTotalCents: group.rootInvoice.grossTotalCents,
      id: group.rootInvoice.id,
      isCredit: false,
      paidOn: group.rootInvoice.paidOn,
      reference: group.rootInvoice.invoiceNumber,
      status:
        group.creditStatus === 'partial'
          ? addPaidStatus(
              uiText.customers.invoiceStatuses.partiallyCredited,
              group.rootInvoice.paymentState,
            )
          : group.creditStatus === 'full'
            ? addPaidStatus(
                uiText.customers.invoiceStatuses.fullyCredited,
                group.rootInvoice.paymentState,
              )
            : group.rootInvoice.paymentState === 'paid'
              ? uiText.customers.invoiceStatuses.paid
              : uiText.customers.invoiceStatuses.sent,
      subject: group.rootInvoice.subject,
      target: {
        id: group.rootInvoice.id,
        type: 'approvedInvoice',
      },
    };
    const creditRows = group.creditInvoices.map(
      (creditInvoice): CustomerInvoiceRow => ({
        customer: formatInvoiceCustomer(creditInvoice),
        date: creditInvoice.invoiceDate,
        dueDate: creditInvoice.dueDate,
        grossTotalCents: creditInvoice.grossTotalCents,
        id: creditInvoice.id,
        isCredit: true,
        paidOn: null,
        reference: creditInvoice.invoiceNumber,
        status: uiText.customers.invoiceStatuses.creditInvoice,
        subject: creditInvoice.subject,
        target: {
          id: creditInvoice.id,
          type: 'approvedInvoice',
        },
      }),
    );

    return [rootRow, ...creditRows];
  });
}

function formatInvoiceCustomer(invoice: ApprovedInvoiceSummary): string {
  return `${invoice.customerNumberSnapshot} – ${invoice.customerNameSnapshot}`;
}

function addPaidStatus(
  creditStatus: string,
  paymentState: ApprovedInvoiceSummary['paymentState'],
): string {
  return paymentState === 'paid'
    ? `${creditStatus} · ${uiText.customers.invoiceStatuses.paid}`
    : creditStatus;
}
