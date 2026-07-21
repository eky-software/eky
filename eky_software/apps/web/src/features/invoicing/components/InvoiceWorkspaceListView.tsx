import type {
  ApprovedInvoiceSummary,
  Customer,
  InvoiceDraftSummary,
} from '@eky/api-client';

import { ApprovedInvoiceList } from './ApprovedInvoiceList.js';
import { InvoiceDraftList } from './InvoiceDraftList.js';
import styles from './InvoicingPage.module.css';
import { uiText } from '../../../i18n/fi.js';

interface InvoiceWorkspaceListViewProps {
  approvedInvoices: ApprovedInvoiceSummary[];
  approvedInvoiceErrorMessage: string | null;
  customers: Customer[];
  customerErrorMessage: string | null;
  deleteErrorMessage: string | null;
  deletingDraftId: string | null;
  drafts: InvoiceDraftSummary[];
  draftErrorMessage: string | null;
  isApprovedInvoiceListLoading: boolean;
  isCustomerListLoading: boolean;
  isDraftListLoading: boolean;
  pendingDeleteDraftId: string | null;
  onCancelDeleteDraft(): void;
  onConfirmDeleteDraft(id: string): void;
  onNewInvoice(): void;
  onOpenApprovedInvoice(id: string): void;
  onOpenDraft(id: string): void;
  onRequestDeleteDraft(id: string): void;
}

export function InvoiceWorkspaceListView({
  approvedInvoices,
  approvedInvoiceErrorMessage,
  customers,
  customerErrorMessage,
  deleteErrorMessage,
  deletingDraftId,
  drafts,
  draftErrorMessage,
  isApprovedInvoiceListLoading,
  isCustomerListLoading,
  isDraftListLoading,
  pendingDeleteDraftId,
  onCancelDeleteDraft,
  onConfirmDeleteDraft,
  onNewInvoice,
  onOpenApprovedInvoice,
  onOpenDraft,
  onRequestDeleteDraft,
}: InvoiceWorkspaceListViewProps): React.JSX.Element {
  const approvedInvoiceItems = approvedInvoices.filter(
    (invoice) => invoice.status === 'approved',
  );
  const sentInvoiceItems = approvedInvoices.filter(
    (invoice) => invoice.status === 'sent',
  );

  return (
    <div className={styles.listStack}>
      <section className={`panel ${styles.draftListPanel}`}>
        <header className={`panel-header ${styles.draftListHeader}`}>
          <div>
            <p className="panel-kicker">{uiText.invoicing.drafts}</p>
            <h2>{uiText.invoicing.draftList}</h2>
          </div>
          <div className="panel-actions">
            {!isDraftListLoading && draftErrorMessage === null ? (
              <span
                className="count-badge"
                aria-label={uiText.invoicing.draftCount}
              >
                {drafts.length}
              </span>
            ) : null}
            <button
              className="primary-action"
              onClick={onNewInvoice}
              type="button"
            >
              {uiText.invoicing.newInvoice}
            </button>
          </div>
        </header>

        <InvoiceDraftList
          customers={customers}
          customerErrorMessage={customerErrorMessage}
          drafts={drafts}
          errorMessage={draftErrorMessage}
          isCustomerLoading={isCustomerListLoading}
          isLoading={isDraftListLoading}
          deleteErrorMessage={deleteErrorMessage}
          deletingDraftId={deletingDraftId}
          pendingDeleteDraftId={pendingDeleteDraftId}
          onCancelDelete={onCancelDeleteDraft}
          onConfirmDelete={onConfirmDeleteDraft}
          onOpenDraft={onOpenDraft}
          onRequestDelete={onRequestDeleteDraft}
        />
      </section>

      <section className={`panel ${styles.draftListPanel}`}>
        <header className={`panel-header ${styles.draftListHeader}`}>
          <div>
            <p className="panel-kicker">
              {uiText.invoicing.approvedInvoices}
            </p>
            <h2>{uiText.invoicing.approvedInvoiceList}</h2>
          </div>
          <div className="panel-actions">
            {!isApprovedInvoiceListLoading &&
            approvedInvoiceErrorMessage === null ? (
              <span
                className="count-badge"
                aria-label={uiText.invoicing.approvedInvoiceCount}
              >
                {approvedInvoiceItems.length}
              </span>
            ) : null}
          </div>
        </header>

        <ApprovedInvoiceList
          approvedInvoices={approvedInvoiceItems}
          errorMessage={approvedInvoiceErrorMessage}
          isLoading={isApprovedInvoiceListLoading}
          onOpenApprovedInvoice={onOpenApprovedInvoice}
        />
      </section>

      <section className={`panel ${styles.draftListPanel}`}>
        <header className={`panel-header ${styles.draftListHeader}`}>
          <div>
            <p className="panel-kicker">{uiText.invoicing.sentInvoices}</p>
            <h2>{uiText.invoicing.sentInvoiceList}</h2>
          </div>
          <div className="panel-actions">
            {!isApprovedInvoiceListLoading &&
            approvedInvoiceErrorMessage === null ? (
              <span
                className="count-badge"
                aria-label={uiText.invoicing.sentInvoiceCount}
              >
                {sentInvoiceItems.length}
              </span>
            ) : null}
          </div>
        </header>

        <ApprovedInvoiceList
          approvedInvoices={sentInvoiceItems}
          emptyMessage={uiText.invoicing.sentInvoicesEmpty}
          errorMessage={approvedInvoiceErrorMessage}
          isLoading={isApprovedInvoiceListLoading}
          listLabel={uiText.invoicing.sentInvoiceList}
          onOpenApprovedInvoice={onOpenApprovedInvoice}
        />
      </section>
    </div>
  );
}
