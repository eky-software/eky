import type { Customer, InvoiceDraftSummary } from '@eky/api-client';

import { InvoiceDraftListItem } from './InvoiceDraftListItem.js';
import { uiText } from '../../../i18n/fi.js';

interface InvoiceDraftListProps {
  customers: Customer[];
  customerErrorMessage: string | null;
  isCustomerLoading: boolean;
  drafts: InvoiceDraftSummary[];
  errorMessage: string | null;
  isLoading: boolean;
  onOpenDraft(id: string): void;
}

export function InvoiceDraftList({
  customers,
  customerErrorMessage,
  drafts,
  errorMessage,
  isCustomerLoading,
  isLoading,
  onOpenDraft,
}: InvoiceDraftListProps): React.JSX.Element {
  if (isLoading || isCustomerLoading) {
    return <p className="invoice-draft-state">{uiText.invoicing.loading}</p>;
  }

  if (errorMessage) {
    return (
      <p className="message error-message" role="alert">
        {errorMessage}
      </p>
    );
  }

  if (customerErrorMessage) {
    return (
      <p className="message error-message" role="alert">
        {customerErrorMessage}
      </p>
    );
  }

  if (drafts.length === 0) {
    return <p className="invoice-draft-state">{uiText.invoicing.empty}</p>;
  }

  return (
    <div
      aria-label={uiText.invoicing.draftList}
      className="invoice-draft-table"
      role="table"
    >
      <div className="invoice-draft-table-row invoice-draft-table-head" role="row">
        <span role="columnheader">{uiText.invoicing.invoice}</span>
        <span role="columnheader">{uiText.invoicing.customer}</span>
        <span role="columnheader">{uiText.invoicing.invoiceDate}</span>
        <span role="columnheader">{uiText.invoicing.dueDate}</span>
        <span role="columnheader">{uiText.invoicing.total}</span>
        <span role="columnheader">{uiText.invoicing.status}</span>
      </div>
      {drafts.map((draft) => (
        <InvoiceDraftListItem
          customers={customers}
          draft={draft}
          key={draft.id}
          onOpenDraft={onOpenDraft}
        />
      ))}
    </div>
  );
}
