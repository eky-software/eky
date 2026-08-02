import type {
  Customer,
  InvoiceDraftSummary,
} from '@eky/api-client';

import { ApprovedInvoiceListSection } from './ApprovedInvoiceListSection.js';
import { InvoiceDraftList } from './InvoiceDraftList.js';
import styles from './InvoicingPage.module.css';
import type { ApprovedInvoicePageState } from '../hooks/useApprovedInvoicePage.js';
import { uiText } from '../../../i18n/fi.js';

interface InvoiceWorkspaceListViewProps {
  approvedInvoicePageState: ApprovedInvoicePageState;
  cancelledInvoicePageState: ApprovedInvoicePageState;
  creditedInvoicePageState: ApprovedInvoicePageState;
  customers: Customer[];
  customerErrorMessage: string | null;
  deleteErrorMessage: string | null;
  deletingDraftId: string | null;
  drafts: InvoiceDraftSummary[];
  draftErrorMessage: string | null;
  isCustomerListLoading: boolean;
  isDraftListLoading: boolean;
  paidInvoicePageState: ApprovedInvoicePageState;
  pendingDeleteDraftId: string | null;
  sentInvoicePageState: ApprovedInvoicePageState;
  onCancelDeleteDraft(): void;
  onConfirmDeleteDraft(id: string): void;
  onNewInvoice(): void;
  onOpenApprovedInvoice(id: string): void;
  onOpenDraft(id: string): void;
  onRequestDeleteDraft(id: string): void;
}

export function InvoiceWorkspaceListView({
  approvedInvoicePageState,
  cancelledInvoicePageState,
  creditedInvoicePageState,
  customers,
  customerErrorMessage,
  deleteErrorMessage,
  deletingDraftId,
  drafts,
  draftErrorMessage,
  isCustomerListLoading,
  isDraftListLoading,
  paidInvoicePageState,
  pendingDeleteDraftId,
  sentInvoicePageState,
  onCancelDeleteDraft,
  onConfirmDeleteDraft,
  onNewInvoice,
  onOpenApprovedInvoice,
  onOpenDraft,
  onRequestDeleteDraft,
}: InvoiceWorkspaceListViewProps): React.JSX.Element {
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

      <ApprovedInvoiceListSection
        countLabel={uiText.invoicing.approvedInvoiceCount}
        emptyMessage={uiText.invoicing.approvedInvoicesEmpty}
        kicker={uiText.invoicing.approvedInvoices}
        listLabel={uiText.invoicing.approvedInvoiceList}
        loadingMessage={uiText.invoicing.approvedInvoicesLoading}
        pageState={approvedInvoicePageState}
        title={uiText.invoicing.approvedInvoiceList}
        onOpenApprovedInvoice={onOpenApprovedInvoice}
      />

      <ApprovedInvoiceListSection
        countLabel={uiText.invoicing.sentInvoiceCount}
        emptyMessage={uiText.invoicing.sentInvoicesEmpty}
        kicker={uiText.invoicing.sentInvoices}
        listLabel={uiText.invoicing.sentInvoiceList}
        loadingMessage={uiText.invoicing.sentInvoicesLoading}
        pageState={sentInvoicePageState}
        title={uiText.invoicing.sentInvoiceList}
        onOpenApprovedInvoice={onOpenApprovedInvoice}
      />

      <ApprovedInvoiceListSection
        countLabel={uiText.invoicing.paidInvoiceCount}
        emptyMessage={uiText.invoicing.paidInvoicesEmpty}
        kicker={uiText.invoicing.paidInvoices}
        listLabel={uiText.invoicing.paidInvoiceList}
        loadingMessage={uiText.invoicing.paidInvoicesLoading}
        pageState={paidInvoicePageState}
        title={uiText.invoicing.paidInvoiceList}
        onOpenApprovedInvoice={onOpenApprovedInvoice}
      />

      <ApprovedInvoiceListSection
        countLabel={uiText.invoicing.creditedInvoiceCount}
        emptyMessage={uiText.invoicing.creditedInvoicesEmpty}
        kicker={uiText.invoicing.creditedInvoices}
        listLabel={uiText.invoicing.creditedInvoiceList}
        loadingMessage={uiText.invoicing.creditedInvoicesLoading}
        pageState={creditedInvoicePageState}
        title={uiText.invoicing.creditedInvoiceList}
        onOpenApprovedInvoice={onOpenApprovedInvoice}
      />

      <ApprovedInvoiceListSection
        countLabel={uiText.invoicing.cancelledInvoiceCount}
        emptyMessage={uiText.invoicing.cancelledInvoicesEmpty}
        kicker={uiText.invoicing.cancelledInvoices}
        listLabel={uiText.invoicing.cancelledInvoiceList}
        loadingMessage={uiText.invoicing.cancelledInvoicesLoading}
        pageState={cancelledInvoicePageState}
        title={uiText.invoicing.cancelledInvoiceList}
        onOpenApprovedInvoice={onOpenApprovedInvoice}
      />
    </div>
  );
}
