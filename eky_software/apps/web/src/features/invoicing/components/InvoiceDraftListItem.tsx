import type { InvoiceDraftSummary } from '@eky/api-client';

import {
  formatInvoiceDraftCurrency,
  formatInvoiceDraftDate,
  getInvoiceDraftStatusLabel,
  getInvoiceDraftSubject,
} from '../invoiceDraftFormatting.js';

interface InvoiceDraftListItemProps {
  draft: InvoiceDraftSummary;
}

export function InvoiceDraftListItem({
  draft,
}: InvoiceDraftListItemProps): React.JSX.Element {
  return (
    <div className="invoice-draft-table-row" role="row">
      <div className="invoice-draft-main-cell" role="cell">
        <strong>{getInvoiceDraftSubject(draft.subject)}</strong>
        <span>{draft.id}</span>
      </div>
      <span title={draft.customerId} role="cell">
        {draft.customerId}
      </span>
      <time dateTime={draft.invoiceDate} role="cell">
        {formatInvoiceDraftDate(draft.invoiceDate)}
      </time>
      <time dateTime={draft.dueDate} role="cell">
        {formatInvoiceDraftDate(draft.dueDate)}
      </time>
      <strong className="invoice-draft-total" role="cell">
        {formatInvoiceDraftCurrency(draft.grossTotalCents)}
      </strong>
      <span className="status-pill status-pill-draft" role="cell">
        {getInvoiceDraftStatusLabel(draft.status)}
      </span>
    </div>
  );
}
