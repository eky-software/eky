import type { Customer, InvoiceDraftSummary } from '@eky/api-client';

import { InvoiceDraftListItem } from './InvoiceDraftListItem.js';
import styles from './InvoiceDraftList.module.css';
import { uiText } from '../../../i18n/fi.js';

interface InvoiceDraftListProps {
  customers: Customer[];
  customerErrorMessage: string | null;
  isCustomerLoading: boolean;
  drafts: InvoiceDraftSummary[];
  errorMessage: string | null;
  isLoading: boolean;
  deleteErrorMessage: string | null;
  deletingDraftId: string | null;
  pendingDeleteDraftId: string | null;
  onCancelDelete(): void;
  onConfirmDelete(id: string): void;
  onOpenDraft(id: string): void;
  onRequestDelete(id: string): void;
}

export function InvoiceDraftList({
  customers,
  customerErrorMessage,
  drafts,
  deleteErrorMessage,
  deletingDraftId,
  errorMessage,
  isCustomerLoading,
  isLoading,
  pendingDeleteDraftId,
  onCancelDelete,
  onConfirmDelete,
  onOpenDraft,
  onRequestDelete,
}: InvoiceDraftListProps): React.JSX.Element {
  if (isLoading || isCustomerLoading) {
    return <p className={styles.state}>{uiText.invoicing.loading}</p>;
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
    return <p className={styles.state}>{uiText.invoicing.empty}</p>;
  }

  return (
    <>
      {deleteErrorMessage !== null ? (
        <p className="message error-message" role="alert">
          {deleteErrorMessage}
        </p>
      ) : null}
      <div
        aria-label={uiText.invoicing.draftList}
        className={styles.table}
        role="table"
      >
        <div className={`${styles.row} ${styles.head}`} role="row">
          <span role="columnheader">{uiText.invoicing.invoice}</span>
          <span role="columnheader">{uiText.invoicing.customer}</span>
          <span role="columnheader">{uiText.invoicing.invoiceDate}</span>
          <span role="columnheader">{uiText.invoicing.dueDate}</span>
          <span className={styles.totalHeader} role="columnheader">
            {uiText.invoicing.total}
          </span>
          <span role="columnheader">{uiText.invoicing.status}</span>
          <span
            aria-label={uiText.invoicing.rowActions}
            role="columnheader"
          />
        </div>
        {drafts.map((draft) => (
          <InvoiceDraftListItem
            customers={customers}
            draft={draft}
            isDeleting={deletingDraftId === draft.id}
            isDeletePending={pendingDeleteDraftId === draft.id}
            key={draft.id}
            onCancelDelete={onCancelDelete}
            onConfirmDelete={onConfirmDelete}
            onOpenDraft={onOpenDraft}
            onRequestDelete={onRequestDelete}
          />
        ))}
      </div>
    </>
  );
}
