import { useEffect, useReducer, useRef, useState } from 'react';
import type {
  ApprovedInvoiceEmailDryRunSendInput,
  ApprovedInvoiceResult,
  InvoiceDraft,
} from '@eky/api-client';

import { InvoiceDraftList } from './InvoiceDraftList.js';
import { ApprovedInvoiceList } from './ApprovedInvoiceList.js';
import { ApprovedInvoicePreview } from './ApprovedInvoicePreview.js';
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
  useInvoicePaymentDefaults,
  type InvoicePaymentDefaultsState,
} from '../hooks/useInvoicePaymentDefaults.js';
import {
  useInvoiceDraftEditor,
  type InvoiceDraftEditorState,
} from '../hooks/useInvoiceDraftEditor.js';
import {
  useApprovedInvoice,
  type ApprovedInvoiceState,
} from '../hooks/useApprovedInvoice.js';
import {
  useApprovedInvoices,
  type ApprovedInvoiceListState,
} from '../hooks/useApprovedInvoices.js';
import {
  useApprovedInvoicePdf,
  type ApprovedInvoicePdfState,
} from '../hooks/useApprovedInvoicePdf.js';
import {
  useApprovedInvoiceEmailDryRun,
  type ApprovedInvoiceEmailDryRunState,
} from '../hooks/useApprovedInvoiceEmailDryRun.js';
import {
  useSendApprovedInvoiceEmailDryRun,
  type SendApprovedInvoiceEmailDryRunState,
} from '../hooks/useSendApprovedInvoiceEmailDryRun.js';
import {
  deleteInvoiceDraftAndRefresh,
  useDeleteInvoiceDraft,
  type DeleteInvoiceDraftState,
} from '../hooks/useDeleteInvoiceDraft.js';
import {
  useReopenApprovedInvoiceForEditing,
  type ReopenApprovedInvoiceState,
} from '../hooks/useReopenApprovedInvoiceForEditing.js';
import {
  useMarkApprovedInvoiceSent,
  type MarkApprovedInvoiceSentState,
} from '../hooks/useMarkApprovedInvoiceSent.js';
import {
  useCopyApprovedInvoiceToDraft,
  type CopyApprovedInvoiceState,
} from '../hooks/useCopyApprovedInvoiceToDraft.js';
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
  const invoicePaymentDefaultsState = useInvoicePaymentDefaults();
  const draftEditorState = useInvoiceDraftEditor();
  const approvedInvoiceState = useApprovedInvoice();
  const approvedInvoiceListState = useApprovedInvoices();
  const approvedInvoicePdfState = useApprovedInvoicePdf();
  const approvedInvoiceEmailState = useApprovedInvoiceEmailDryRun();
  const sendApprovedInvoiceEmailState = useSendApprovedInvoiceEmailDryRun();
  const deleteState = useDeleteInvoiceDraft();
  const reopenApprovedInvoiceState = useReopenApprovedInvoiceForEditing();
  const markApprovedInvoiceSentState = useMarkApprovedInvoiceSent();
  const copyApprovedInvoiceState = useCopyApprovedInvoiceToDraft();
  const [pendingDeleteDraftId, setPendingDeleteDraftId] = useState<string | null>(null);
  const previousNavigationRevision = useRef(navigationRevision);
  const [activeView, dispatch] = useReducer(
    reduceInvoicingPageMode,
    'draftList',
  );

  function handleBackToDrafts(): void {
    approvedInvoiceState.clearApprovedInvoice();
    draftEditorState.clearDraft();
    deleteState.clearError();
    reopenApprovedInvoiceState.clearError();
    markApprovedInvoiceSentState.clearError();
    copyApprovedInvoiceState.clearError();
    approvedInvoicePdfState.clearPdf();
    approvedInvoiceEmailState.clearEmail();
    sendApprovedInvoiceEmailState.clearStatus();
    setPendingDeleteDraftId(null);
    dispatch({ type: 'showDraftList' });
  }

  function handleOpenDraft(id: string): void {
    approvedInvoiceState.clearApprovedInvoice();
    reopenApprovedInvoiceState.clearError();
    markApprovedInvoiceSentState.clearError();
    copyApprovedInvoiceState.clearError();
    approvedInvoicePdfState.clearPdf();
    approvedInvoiceEmailState.clearEmail();
    sendApprovedInvoiceEmailState.clearStatus();
    setPendingDeleteDraftId(null);
    dispatch({ type: 'openEditInvoice' });
    void draftEditorState.openDraft(id);
  }

  function handleOpenApprovedInvoice(id: string): void {
    draftEditorState.clearDraft();
    deleteState.clearError();
    reopenApprovedInvoiceState.clearError();
    markApprovedInvoiceSentState.clearError();
    copyApprovedInvoiceState.clearError();
    approvedInvoicePdfState.clearPdf();
    approvedInvoiceEmailState.clearEmail();
    sendApprovedInvoiceEmailState.clearStatus();
    setPendingDeleteDraftId(null);
    dispatch({ type: 'openApprovedInvoice' });
    void approvedInvoiceState.openApprovedInvoice(id);
    void approvedInvoicePdfState.loadPdfMetadata(id);
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
    void approvedInvoiceListState.refreshApprovedInvoices();
  }

  async function handleEditApprovedInvoice(id: string): Promise<void> {
    const shouldReopen = window.confirm(
      uiText.invoicing.reopenApprovedInvoiceConfirm,
    );

    if (!shouldReopen) {
      return;
    }

    const reopenedInvoice =
      await reopenApprovedInvoiceState.reopenApprovedInvoice(id);

    if (reopenedInvoice === null) {
      return;
    }

    approvedInvoiceState.clearApprovedInvoice();
    dispatch({ type: 'openEditInvoice' });
    void draftState.refreshDrafts();
    void approvedInvoiceListState.refreshApprovedInvoices();
    void draftEditorState.openDraft(reopenedInvoice.invoiceDraftId);
  }

  async function handleMarkApprovedInvoiceSent(id: string): Promise<void> {
    const shouldMarkSent = window.confirm(
      uiText.invoicing.markApprovedInvoiceSentConfirm,
    );

    if (!shouldMarkSent) {
      return;
    }

    const pdfMetadata = await approvedInvoicePdfState.createPdf(id);

    if (pdfMetadata === null) {
      return;
    }

    const sentInvoice =
      await markApprovedInvoiceSentState.markApprovedInvoiceSent(id);

    if (sentInvoice === null) {
      return;
    }

    approvedInvoiceState.replaceApprovedInvoice(sentInvoice);
    void approvedInvoiceListState.refreshApprovedInvoices();
  }

  async function handleCopyApprovedInvoiceToDraft(id: string): Promise<void> {
    const shouldCopy = window.confirm(
      uiText.invoicing.copyApprovedInvoiceConfirm,
    );

    if (!shouldCopy) {
      return;
    }

    const copiedDraft =
      await copyApprovedInvoiceState.copyApprovedInvoiceToDraft(id);

    if (copiedDraft === null) {
      return;
    }

    approvedInvoiceState.clearApprovedInvoice();
    approvedInvoicePdfState.clearPdf();
    approvedInvoiceEmailState.clearEmail();
    sendApprovedInvoiceEmailState.clearStatus();
    draftEditorState.replaceDraft(copiedDraft);
    dispatch({ type: 'openEditInvoice' });
    void draftState.refreshDrafts();
  }

  async function handleOpenApprovedInvoicePdf(id: string): Promise<void> {
    const pdfWindow = window.open('', '_blank');

    if (pdfWindow !== null) {
      pdfWindow.opener = null;
    }

    const metadata = await approvedInvoicePdfState.createPdf(id);

    if (metadata === null) {
      pdfWindow?.close();
      return;
    }

    const pdfUrl = approvedInvoicePdfState.getPdfUrl(id);

    if (pdfWindow !== null) {
      pdfWindow.location.href = pdfUrl;
      return;
    }

    window.open(pdfUrl, '_blank', 'noopener,noreferrer');
  }

  async function handlePrepareApprovedInvoiceEmail(id: string): Promise<void> {
    const metadata = await approvedInvoicePdfState.createPdf(id);

    if (metadata === null) {
      return;
    }

    await approvedInvoiceEmailState.prepareEmail(id);
  }

  async function handleSendApprovedInvoiceEmailDryRun(
    id: string,
    input: ApprovedInvoiceEmailDryRunSendInput,
  ): Promise<void> {
    await sendApprovedInvoiceEmailState.sendEmailDryRun(id, input);
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
      approvedInvoiceListState={approvedInvoiceListState}
      approvedInvoiceEmailState={approvedInvoiceEmailState}
      approvedInvoicePdfState={approvedInvoicePdfState}
      approvedInvoiceState={approvedInvoiceState}
      customerListState={customerListState}
      companySettingsState={companySettingsState}
      copyApprovedInvoiceState={copyApprovedInvoiceState}
      deleteState={deleteState}
      draftEditorState={draftEditorState}
      invoicePaymentDefaultsState={invoicePaymentDefaultsState}
      markApprovedInvoiceSentState={markApprovedInvoiceSentState}
      pendingDeleteDraftId={pendingDeleteDraftId}
      reopenApprovedInvoiceState={reopenApprovedInvoiceState}
      sendApprovedInvoiceEmailState={sendApprovedInvoiceEmailState}
      onBackToDrafts={handleBackToDrafts}
      onCancelDeleteDraft={handleCancelDeleteDraft}
      onConfirmDeleteDraft={(id) => void handleConfirmDeleteDraft(id)}
      onDraftApproved={handleDraftApproved}
      onDraftSaved={handleDraftSaved}
      onOpenApprovedInvoice={handleOpenApprovedInvoice}
      onCreateApprovedInvoicePdf={(id) =>
        void approvedInvoicePdfState.createPdf(id)
      }
      onCopyApprovedInvoiceToDraft={(id) =>
        void handleCopyApprovedInvoiceToDraft(id)
      }
      onEditApprovedInvoice={(id) => void handleEditApprovedInvoice(id)}
      onMarkApprovedInvoiceSent={(id) =>
        void handleMarkApprovedInvoiceSent(id)
      }
      onOpenApprovedInvoicePdf={(id) =>
        void handleOpenApprovedInvoicePdf(id)
      }
      onPrepareApprovedInvoiceEmail={(id) =>
        void handlePrepareApprovedInvoiceEmail(id)
      }
      onSendApprovedInvoiceEmailDryRun={(id, input) =>
        void handleSendApprovedInvoiceEmailDryRun(id, input)
      }
      onOpenDraft={handleOpenDraft}
      onRequestDeleteDraft={handleRequestDeleteDraft}
      onNewInvoice={() => dispatch({ type: 'openNewInvoice' })}
    />
  );
}

interface InvoicingPageViewProps extends InvoiceDraftListState {
  activeView: InvoicingPageMode;
  approvedInvoiceEmailState: ApprovedInvoiceEmailDryRunState;
  approvedInvoiceListState: ApprovedInvoiceListState;
  approvedInvoicePdfState: ApprovedInvoicePdfState;
  approvedInvoiceState: ApprovedInvoiceState;
  customerListState: InvoiceCustomerListState;
  companySettingsState: InvoiceCompanySettingsState;
  copyApprovedInvoiceState: CopyApprovedInvoiceState;
  deleteState: DeleteInvoiceDraftState;
  draftEditorState: InvoiceDraftEditorState;
  invoicePaymentDefaultsState: InvoicePaymentDefaultsState;
  markApprovedInvoiceSentState: MarkApprovedInvoiceSentState;
  pendingDeleteDraftId: string | null;
  reopenApprovedInvoiceState: ReopenApprovedInvoiceState;
  sendApprovedInvoiceEmailState: SendApprovedInvoiceEmailDryRunState;
  onBackToDrafts(): void;
  onCancelDeleteDraft(): void;
  onConfirmDeleteDraft(id: string): void;
  onCreateApprovedInvoicePdf(id: string): void;
  onCopyApprovedInvoiceToDraft(id: string): void;
  onDraftApproved(approvedInvoice: ApprovedInvoiceResult): void;
  onDraftSaved(savedDraft: InvoiceDraft): void;
  onOpenApprovedInvoice(id: string): void;
  onEditApprovedInvoice(id: string): void;
  onMarkApprovedInvoiceSent(id: string): void;
  onOpenApprovedInvoicePdf(id: string): void;
  onPrepareApprovedInvoiceEmail(id: string): void;
  onSendApprovedInvoiceEmailDryRun(
    id: string,
    input: ApprovedInvoiceEmailDryRunSendInput,
  ): void;
  onOpenDraft(id: string): void;
  onRequestDeleteDraft(id: string): void;
  onNewInvoice(): void;
}

export function InvoicingPageView({
  activeView,
  approvedInvoiceEmailState,
  approvedInvoiceListState,
  approvedInvoicePdfState,
  approvedInvoiceState,
  customerListState,
  companySettingsState,
  copyApprovedInvoiceState,
  deleteState,
  draftEditorState,
  invoicePaymentDefaultsState,
  markApprovedInvoiceSentState,
  drafts,
  errorMessage,
  isLoading,
  pendingDeleteDraftId,
  reopenApprovedInvoiceState,
  sendApprovedInvoiceEmailState,
  onBackToDrafts,
  onCancelDeleteDraft,
  onConfirmDeleteDraft,
  onCreateApprovedInvoicePdf,
  onCopyApprovedInvoiceToDraft,
  onDraftApproved,
  onDraftSaved,
  onOpenApprovedInvoice,
  onEditApprovedInvoice,
  onMarkApprovedInvoiceSent,
  onOpenApprovedInvoicePdf,
  onPrepareApprovedInvoiceEmail,
  onSendApprovedInvoiceEmailDryRun,
  onOpenDraft,
  onRequestDeleteDraft,
  onNewInvoice,
}: InvoicingPageViewProps): React.JSX.Element {
  const approvedInvoices = approvedInvoiceListState.approvedInvoices.filter(
    (invoice) => invoice.status === 'approved',
  );
  const sentInvoices = approvedInvoiceListState.approvedInvoices.filter(
    (invoice) => invoice.status === 'sent',
  );

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
        <div className={styles.listStack}>
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

          <section className={`panel ${styles.draftListPanel}`}>
            <header className={`panel-header ${styles.draftListHeader}`}>
              <div>
                <p className="panel-kicker">
                  {uiText.invoicing.approvedInvoices}
                </p>
                <h2>{uiText.invoicing.approvedInvoiceList}</h2>
              </div>
              <div className="panel-actions">
                {!approvedInvoiceListState.isLoading &&
                approvedInvoiceListState.errorMessage === null ? (
                  <span
                    className="count-badge"
                    aria-label={uiText.invoicing.approvedInvoiceCount}
                  >
                    {approvedInvoices.length}
                  </span>
                ) : null}
              </div>
            </header>

            <ApprovedInvoiceList
              approvedInvoices={approvedInvoices}
              errorMessage={approvedInvoiceListState.errorMessage}
              isLoading={approvedInvoiceListState.isLoading}
              onOpenApprovedInvoice={onOpenApprovedInvoice}
            />
          </section>

          <section className={`panel ${styles.draftListPanel}`}>
            <header className={`panel-header ${styles.draftListHeader}`}>
              <div>
                <p className="panel-kicker">
                  {uiText.invoicing.sentInvoices}
                </p>
                <h2>{uiText.invoicing.sentInvoiceList}</h2>
              </div>
              <div className="panel-actions">
                {!approvedInvoiceListState.isLoading &&
                approvedInvoiceListState.errorMessage === null ? (
                  <span
                    className="count-badge"
                    aria-label={uiText.invoicing.sentInvoiceCount}
                  >
                    {sentInvoices.length}
                  </span>
                ) : null}
              </div>
            </header>

            <ApprovedInvoiceList
              approvedInvoices={sentInvoices}
              emptyMessage={uiText.invoicing.sentInvoicesEmpty}
              errorMessage={approvedInvoiceListState.errorMessage}
              isLoading={approvedInvoiceListState.isLoading}
              listLabel={uiText.invoicing.sentInvoiceList}
              onOpenApprovedInvoice={onOpenApprovedInvoice}
            />
          </section>
        </div>
      ) : activeView === 'newInvoice' ? (
        <NewInvoiceForm
          companySettingsState={companySettingsState}
          customerListState={customerListState}
          invoicePaymentDefaultsState={invoicePaymentDefaultsState}
          mode={{ type: 'create' }}
          onBack={onBackToDrafts}
          onDraftApproved={onDraftApproved}
          onDraftSaved={onDraftSaved}
          onOpenApprovedInvoice={onOpenApprovedInvoice}
        />
      ) : activeView === 'editInvoice' ? (
        <InvoiceDraftEditView
          companySettingsState={companySettingsState}
          customerListState={customerListState}
          draftEditorState={draftEditorState}
          invoicePaymentDefaultsState={invoicePaymentDefaultsState}
          onBack={onBackToDrafts}
          onDraftApproved={onDraftApproved}
          onDraftSaved={onDraftSaved}
          onOpenApprovedInvoice={onOpenApprovedInvoice}
        />
      ) : (
        <ApprovedInvoiceView
          approvedInvoiceEmailState={approvedInvoiceEmailState}
          copyApprovedInvoiceState={copyApprovedInvoiceState}
          approvedInvoicePdfState={approvedInvoicePdfState}
          approvedInvoiceState={approvedInvoiceState}
          markApprovedInvoiceSentState={markApprovedInvoiceSentState}
          reopenApprovedInvoiceState={reopenApprovedInvoiceState}
          sendApprovedInvoiceEmailState={sendApprovedInvoiceEmailState}
          onBack={onBackToDrafts}
          onCopyApprovedInvoiceToDraft={onCopyApprovedInvoiceToDraft}
          onCreateApprovedInvoicePdf={onCreateApprovedInvoicePdf}
          onEditApprovedInvoice={onEditApprovedInvoice}
          onMarkApprovedInvoiceSent={onMarkApprovedInvoiceSent}
          onOpenApprovedInvoicePdf={onOpenApprovedInvoicePdf}
          onPrepareApprovedInvoiceEmail={onPrepareApprovedInvoiceEmail}
          onSendApprovedInvoiceEmailDryRun={onSendApprovedInvoiceEmailDryRun}
        />
      )}
    </div>
  );
}

interface InvoiceDraftEditViewProps {
  companySettingsState: InvoiceCompanySettingsState;
  customerListState: InvoiceCustomerListState;
  draftEditorState: InvoiceDraftEditorState;
  invoicePaymentDefaultsState: InvoicePaymentDefaultsState;
  onBack(): void;
  onDraftApproved(approvedInvoice: ApprovedInvoiceResult): void;
  onDraftSaved(savedDraft: InvoiceDraft): void;
  onOpenApprovedInvoice(id: string): void;
}

function InvoiceDraftEditView({
  companySettingsState,
  customerListState,
  draftEditorState,
  invoicePaymentDefaultsState,
  onBack,
  onDraftApproved,
  onDraftSaved,
  onOpenApprovedInvoice,
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
      invoicePaymentDefaultsState={invoicePaymentDefaultsState}
      mode={{
        draft: draftEditorState.draft,
        type: 'edit',
      }}
      onBack={onBack}
      onDraftApproved={onDraftApproved}
      onDraftSaved={onDraftSaved}
      onOpenApprovedInvoice={onOpenApprovedInvoice}
    />
  );
}

interface ApprovedInvoiceViewProps {
  approvedInvoiceEmailState: ApprovedInvoiceEmailDryRunState;
  approvedInvoicePdfState: ApprovedInvoicePdfState;
  approvedInvoiceState: ApprovedInvoiceState;
  copyApprovedInvoiceState: CopyApprovedInvoiceState;
  markApprovedInvoiceSentState: MarkApprovedInvoiceSentState;
  reopenApprovedInvoiceState: ReopenApprovedInvoiceState;
  sendApprovedInvoiceEmailState: SendApprovedInvoiceEmailDryRunState;
  onBack(): void;
  onCopyApprovedInvoiceToDraft(id: string): void;
  onCreateApprovedInvoicePdf(id: string): void;
  onEditApprovedInvoice(id: string): void;
  onMarkApprovedInvoiceSent(id: string): void;
  onOpenApprovedInvoicePdf(id: string): void;
  onPrepareApprovedInvoiceEmail(id: string): void;
  onSendApprovedInvoiceEmailDryRun(
    id: string,
    input: ApprovedInvoiceEmailDryRunSendInput,
  ): void;
}

function ApprovedInvoiceView({
  approvedInvoiceEmailState,
  approvedInvoicePdfState,
  approvedInvoiceState,
  copyApprovedInvoiceState,
  markApprovedInvoiceSentState,
  reopenApprovedInvoiceState,
  sendApprovedInvoiceEmailState,
  onBack,
  onCopyApprovedInvoiceToDraft,
  onCreateApprovedInvoicePdf,
  onEditApprovedInvoice,
  onMarkApprovedInvoiceSent,
  onOpenApprovedInvoicePdf,
  onPrepareApprovedInvoiceEmail,
  onSendApprovedInvoiceEmailDryRun,
}: ApprovedInvoiceViewProps): React.JSX.Element {
  if (approvedInvoiceState.isLoading) {
    return (
      <section className={`panel ${styles.editorState}`}>
        <p className={styles.state}>
          {uiText.invoicing.approvedInvoiceLoading}
        </p>
      </section>
    );
  }

  if (approvedInvoiceState.errorMessage !== null) {
    return (
      <section className={`panel ${styles.editorState}`}>
        <p className="message error-message" role="alert">
          {approvedInvoiceState.errorMessage}
        </p>
        <button className="ghost-button" onClick={onBack} type="button">
          {uiText.invoicing.backToDrafts}
        </button>
      </section>
    );
  }

  if (approvedInvoiceState.approvedInvoice === null) {
    return (
      <section className={`panel ${styles.editorState}`}>
        <p className={styles.state}>
          {uiText.invoicing.approvedInvoiceOpenPrompt}
        </p>
        <button className="ghost-button" onClick={onBack} type="button">
          {uiText.invoicing.backToDrafts}
        </button>
      </section>
    );
  }

  return (
    <ApprovedInvoicePreview
      copyErrorMessage={copyApprovedInvoiceState.errorMessage}
      email={approvedInvoiceEmailState.email}
      emailErrorMessage={approvedInvoiceEmailState.errorMessage}
      emailSendErrorMessage={sendApprovedInvoiceEmailState.errorMessage}
      emailSendSuccessMessage={sendApprovedInvoiceEmailState.successMessage}
      invoice={approvedInvoiceState.approvedInvoice}
      isCopyingInvoice={copyApprovedInvoiceState.isCopying}
      isCreatingPdf={approvedInvoicePdfState.isCreating}
      isPdfAvailable={approvedInvoicePdfState.document !== null}
      isMarkingSent={markApprovedInvoiceSentState.isMarkingSent}
      isPreparingEmail={approvedInvoiceEmailState.isPreparing}
      isSendingEmailDryRun={sendApprovedInvoiceEmailState.isSending}
      isReopening={reopenApprovedInvoiceState.isReopening}
      markSentErrorMessage={markApprovedInvoiceSentState.errorMessage}
      pdfErrorMessage={approvedInvoicePdfState.errorMessage}
      reopenErrorMessage={reopenApprovedInvoiceState.errorMessage}
      onBack={onBack}
      onCopyInvoice={onCopyApprovedInvoiceToDraft}
      onCreatePdf={onCreateApprovedInvoicePdf}
      onEditInvoice={onEditApprovedInvoice}
      onMarkSent={onMarkApprovedInvoiceSent}
      onOpenPdf={onOpenApprovedInvoicePdf}
      onPrepareEmail={onPrepareApprovedInvoiceEmail}
      onSendEmailDryRun={onSendApprovedInvoiceEmailDryRun}
    />
  );
}
