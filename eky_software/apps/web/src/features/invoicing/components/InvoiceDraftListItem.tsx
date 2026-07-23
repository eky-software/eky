import type { Customer, InvoiceDraftSummary } from '@eky/api-client';

import {
  formatInvoiceDraftCurrency,
  formatInvoiceDraftDate,
  getInvoiceDraftStatusLabel,
  getInvoiceDraftSubject,
} from '../drafts/invoiceDraftFormatting.js';
import { getInvoiceDraftCustomerDisplayName } from '../drafts/invoiceDraftCustomerDisplay.js';
import styles from './InvoiceDraftList.module.css';
import { uiText } from '../../../i18n/fi.js';

interface InvoiceDraftListItemProps {
  customers: Customer[];
  draft: InvoiceDraftSummary;
  isDeleting: boolean;
  isDeletePending: boolean;
  onCancelDelete(): void;
  onConfirmDelete(id: string): void;
  onOpenDraft(id: string): void;
  onRequestDelete(id: string): void;
}

export function InvoiceDraftListItem({
  customers,
  draft,
  isDeleting,
  isDeletePending,
  onCancelDelete,
  onConfirmDelete,
  onOpenDraft,
  onRequestDelete,
}: InvoiceDraftListItemProps): React.JSX.Element {
  const customerDisplayName = getInvoiceDraftCustomerDisplayName(
    draft,
    customers,
  );
  const isCreditDraft = draft.invoiceKind === 'credit';

  return (
    <>
      <div className={styles.row} role="row">
        <div className={styles.mainCell} role="cell">
          <button
            className={styles.openButton}
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
        <strong className={styles.total} role="cell">
          {formatInvoiceDraftCurrency(
            isCreditDraft && draft.grossTotalCents !== 0
              ? -draft.grossTotalCents
              : draft.grossTotalCents,
          )}
        </strong>
        <span className="status-pill status-pill-draft" role="cell">
          {isCreditDraft
            ? uiText.invoicing.statusCreditDraft
            : getInvoiceDraftStatusLabel(draft.status)}
        </span>
        <div className={styles.rowActions} role="cell">
          <button
            aria-label={uiText.invoicing.deleteDraft}
            className={styles.deleteButton}
            disabled={isDeleting}
            onClick={() => onRequestDelete(draft.id)}
            title={uiText.invoicing.deleteDraft}
            type="button"
          >
            <span aria-hidden="true">🗑︎</span>
          </button>
        </div>
      </div>
      {isDeletePending ? (
        <div className={styles.confirmationRow} role="row">
          <div className={styles.confirmation} role="cell">
            <strong>{uiText.invoicing.deleteDraftConfirm}</strong>
            <div className={styles.confirmationActions}>
              <button
                className={styles.cancelDeleteButton}
                disabled={isDeleting}
                onClick={onCancelDelete}
                type="button"
              >
                {uiText.invoicing.deleteDraftCancel}
              </button>
              <button
                className={styles.confirmDeleteButton}
                disabled={isDeleting}
                onClick={() => onConfirmDelete(draft.id)}
                type="button"
              >
                {isDeleting
                  ? uiText.invoicing.deletingDraft
                  : uiText.invoicing.deleteDraftConfirmAction}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
