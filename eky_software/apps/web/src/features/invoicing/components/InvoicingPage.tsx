import { useEffect, useReducer, useRef, useState } from 'react';
import type { ApprovedInvoiceResult, InvoiceDraft } from '@eky/api-client';

import { InvoiceDraftList } from './InvoiceDraftList.js';
import { NewInvoiceForm } from './NewInvoiceForm.js';
import styles from './InvoicingPage.module.css';
import {
  reduceInvoicingPageMode,
  type InvoicingPageMode,
} from '../state/invoicingPageState.js';
import {
  useInvoiceDrafts,
  type InvoiceDraftListState,
} from '../hooks/useInvoiceDrafts.js';
import {
  useInvoiceCustomers,
  type InvoiceCustomerListState,
} from '../hooks/useInvoiceCustomers.js';
import {
  useInvoiceCompanySettings,
  type InvoiceCompanySettingsState,
} from '../hooks/useInvoiceCompanySettings.js';
import {
  useInvoiceDraftEditor,
  type InvoiceDraftEditorState,
} from '../hooks/useInvoiceDraftEditor.js';
import {
  deleteInvoiceDraftAndRefresh,
  useDeleteInvoiceDraft,
  type DeleteInvoiceDraftState,
} from '../hooks/useDeleteInvoiceDraft.js';
import { uiText } from '../../../i18n/fi.js';

interface InvoicingPageProps {
  navigationRevision: number;
}

export function InvoicingPage({
  navigationRevision,
}: InvoicingPageProps): React.JSX.Element {
  const draftState = useInvoiceDrafts();
  const customerListState = useInvoiceCustomers();
  const companySettingsState = useInvoiceCompanySettings();
  const draftEditorState = useInvoiceDraftEditor();
  const deleteState = useDeleteInvoiceDraft();
  const [pendingDeleteDraftId, setPendingDeleteDraftId] = useState<string | null>(null);
  const previousNavigationRevision = useRef(navigationRevision);
  const [activeView, dispatch] = useReducer(
    reduceInvoicingPageMode,
    'draftList',
  );

  function handleBackToDrafts(): void {
    draftEditorState.clearDraft();
    deleteState.clearError();
    setPendingDeleteDraftId(null);
    dispatch({ type: 'showDraftList' });
  }

  function handleOpenDraft(id: string): void {
    setPendingDeleteDraftId(null);
    dispatch({ type: 'openEditInvoice' });
    void draftEditorState.openDraft(id);
  }

  function handleRequestDeleteDraft(id: string): void {
    deleteState.clearError();
    setPendingDeleteDraftId(id);
  }

  function handleCancelDeleteDraft(): void {
    deleteState.clearError();
    setPendingDeleteDraftId(null);
  }

  async function handleConfirmDeleteDraft(id: string): Promise<void> {
    const wasDeleted = await deleteInvoiceDraftAndRefresh(
      id,
      deleteState.deleteDraft,
      draftState.refreshDrafts,
    );

    if (!wasDeleted) {
      return;
    }

    setPendingDeleteDraftId(null);
  }

  function handleDraftSaved(savedDraft: InvoiceDraft): void {
    draftEditorState.replaceDraft(savedDraft);
    dispatch({ type: 'draftSaved' });
    void draftState.refreshDrafts();
  }

  function handleDraftApproved(_approvedInvoice: ApprovedInvoiceResult): void {
    void draftState.refreshDrafts();
  }

  useEffect(() => {
    if (previousNavigationRevision.current === navigationRevision) {
      return;
    }

    previousNavigationRevision.current = navigationRevision;
    handleBackToDrafts();
  }, [navigationRevision]);

  return (
    <InvoicingPageView
      {...draftState}
      activeView={activeView}
      customerListState={customerListState}
      companySettingsState={companySettingsState}
      deleteState={deleteState}
      draftEditorState={draftEditorState}
      pendingDeleteDraftId={pendingDeleteDraftId}
      onBackToDrafts={handleBackToDrafts}
      onCancelDeleteDraft={handleCancelDeleteDraft}
      onConfirmDeleteDraft={(id) => void handleConfirmDeleteDraft(id)}
      onDraftApproved={handleDraftApproved}
      onDraftSaved={handleDraftSaved}
      onOpenDraft={handleOpenDraft}
      onRequestDeleteDraft={handleRequestDeleteDraft}
      onNewInvoice={() => dispatch({ type: 'openNewInvoice' })}
    />
  );
}

interface InvoicingPageViewProps extends InvoiceDraftListState {
  activeView: InvoicingPageMode;
  customerListState: InvoiceCustomerListState;
  companySettingsState: InvoiceCompanySettingsState;
  deleteState: DeleteInvoiceDraftState;
  draftEditorState: InvoiceDraftEditorState;
  pendingDeleteDraftId: string | null;
  onBackToDrafts(): void;
  onCancelDeleteDraft(): void;
  onConfirmDeleteDraft(id: string): void;
  onDraftApproved(approvedInvoice: ApprovedInvoiceResult): void;
  onDraftSaved(savedDraft: InvoiceDraft): void;
  onOpenDraft(id: string): void;
  onRequestDeleteDraft(id: string): void;
  onNewInvoice(): void;
}

export function InvoicingPageView({
  activeView,
  customerListState,
  companySettingsState,
  deleteState,
  draftEditorState,
  drafts,
  errorMessage,
  isLoading,
  pendingDeleteDraftId,
  onBackToDrafts,
  onCancelDeleteDraft,
  onConfirmDeleteDraft,
  onDraftApproved,
  onDraftSaved,
  onOpenDraft,
  onRequestDeleteDraft,
  onNewInvoice,
}: InvoicingPageViewProps): React.JSX.Element {
  return (
    <div className={styles.workspace}>
      <section className={`page-intro ${styles.pageHeader}`}>
        <div>
          <p className="eyebrow">{uiText.invoicing.workspace}</p>
          <h2>{uiText.invoicing.title}</h2>
          <p>{uiText.invoicing.description}</p>
        </div>
      </section>

      {activeView === 'draftList' ? (
        <section className={`panel ${styles.draftListPanel}`}>
          <header className={`panel-header ${styles.draftListHeader}`}>
            <div>
              <p className="panel-kicker">{uiText.invoicing.drafts}</p>
              <h2>{uiText.invoicing.draftList}</h2>
            </div>
            <div className="panel-actions">
              {!isLoading && errorMessage === null ? (
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
            customers={customerListState.customers}
            customerErrorMessage={customerListState.errorMessage}
            drafts={drafts}
            errorMessage={errorMessage}
            isCustomerLoading={customerListState.isLoading}
            isLoading={isLoading}
            deleteErrorMessage={deleteState.errorMessage}
            deletingDraftId={deleteState.deletingDraftId}
            pendingDeleteDraftId={pendingDeleteDraftId}
            onCancelDelete={onCancelDeleteDraft}
            onConfirmDelete={onConfirmDeleteDraft}
            onOpenDraft={onOpenDraft}
            onRequestDelete={onRequestDeleteDraft}
          />
        </section>
      ) : activeView === 'newInvoice' ? (
        <NewInvoiceForm
          companySettingsState={companySettingsState}
          customerListState={customerListState}
          mode={{ type: 'create' }}
          onBack={onBackToDrafts}
          onDraftApproved={onDraftApproved}
          onDraftSaved={onDraftSaved}
        />
      ) : (
        <InvoiceDraftEditView
          companySettingsState={companySettingsState}
          customerListState={customerListState}
          draftEditorState={draftEditorState}
          onBack={onBackToDrafts}
          onDraftApproved={onDraftApproved}
          onDraftSaved={onDraftSaved}
        />
      )}
    </div>
  );
}

interface InvoiceDraftEditViewProps {
  companySettingsState: InvoiceCompanySettingsState;
  customerListState: InvoiceCustomerListState;
  draftEditorState: InvoiceDraftEditorState;
  onBack(): void;
  onDraftApproved(approvedInvoice: ApprovedInvoiceResult): void;
  onDraftSaved(savedDraft: InvoiceDraft): void;
}

function InvoiceDraftEditView({
  companySettingsState,
  customerListState,
  draftEditorState,
  onBack,
  onDraftApproved,
  onDraftSaved,
}: InvoiceDraftEditViewProps): React.JSX.Element {
  if (draftEditorState.isLoading) {
    return (
      <section className={`panel ${styles.editorState}`}>
        <p className={styles.state}>
          {uiText.invoicing.openingDraft}
        </p>
      </section>
    );
  }

  if (draftEditorState.errorMessage !== null) {
    return (
      <section className={`panel ${styles.editorState}`}>
        <p className="message error-message" role="alert">
          {draftEditorState.errorMessage}
        </p>
        <button className="ghost-button" onClick={onBack} type="button">
          {uiText.invoicing.backToDrafts}
        </button>
      </section>
    );
  }

  if (draftEditorState.draft === null) {
    return (
      <section className={`panel ${styles.editorState}`}>
        <p className={styles.state}>
          {uiText.invoicing.openDraftPrompt}
        </p>
        <button className="ghost-button" onClick={onBack} type="button">
          {uiText.invoicing.backToDrafts}
        </button>
      </section>
    );
  }

  return (
    <NewInvoiceForm
      key={draftEditorState.draft.id}
      companySettingsState={companySettingsState}
      customerListState={customerListState}
      mode={{
        draft: draftEditorState.draft,
        type: 'edit',
      }}
      onBack={onBack}
      onDraftApproved={onDraftApproved}
      onDraftSaved={onDraftSaved}
    />
  );
}
