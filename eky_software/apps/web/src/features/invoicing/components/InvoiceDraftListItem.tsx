import type { Customer, InvoiceDraftSummary } from '@eky/api-client';

import {
  formatInvoiceDraftCurrency,
  formatInvoiceDraftDate,
  getInvoiceDraftStatusLabel,
  getInvoiceDraftSubject,
} from '../invoiceDraftFormatting.js';
import { getInvoiceDraftCustomerDisplayName } from '../invoiceDraftCustomerDisplay.js';

interface InvoiceDraftListItemProps {
  customers: Customer[];
  draft: InvoiceDraftSummary;
  onOpenDraft(id: string): void;
}

export function InvoiceDraftListItem({
  customers,
  draft,
  onOpenDraft,
}: InvoiceDraftListItemProps): React.JSX.Element {
  const customerDisplayName = getInvoiceDraftCustomerDisplayName(
    draft,
    customers,
  );

  return (
    <div className="invoice-draft-table-row" role="row">
      <div className="invoice-draft-main-cell" role="cell">
        <button
          className="invoice-draft-open-button"
          onClick={() => onOpenDraft(draft.id)}
          type="button"
        >
          {getInvoiceDraftSubject(draft.subject)}
        </button>
      </div>
      <span role="cell">{customerDisplayName}</span>
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
