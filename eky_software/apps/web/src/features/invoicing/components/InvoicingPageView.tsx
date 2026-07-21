import type {
  ApprovedInvoiceEmailDryRunSendInput,
  ApprovedInvoiceEmailSmtpPrepareInput,
  ApprovedInvoiceEmailSmtpTestPrepareInput,
  ApprovedInvoiceResult,
  InvoiceDraft,
} from '@eky/api-client';

import { ApprovedInvoicePreview } from './ApprovedInvoicePreview.js';
import { InvoiceWorkspaceListView } from './InvoiceWorkspaceListView.js';
import { NewInvoiceForm } from './NewInvoiceForm.js';
import styles from './InvoicingPage.module.css';
import { getInvoiceEmailSmtpTestUnavailableMessage } from '../approved/invoiceEmailSmtpTestAvailability.js';
import { getInvoiceEmailSmtpUnavailableMessage } from '../approved/invoiceEmailSmtpAvailability.js';
import type { InvoicingPageMode } from '../state/invoicingPageState.js';
import type { ApprovedInvoiceEmailDryRunState } from '../hooks/useApprovedInvoiceEmailDryRun.js';
import type { ApprovedInvoiceListState } from '../hooks/useApprovedInvoices.js';
import type { ApprovedInvoicePdfState } from '../hooks/useApprovedInvoicePdf.js';
import type { ApprovedInvoiceState } from '../hooks/useApprovedInvoice.js';
import type { CopyApprovedInvoiceState } from '../hooks/useCopyApprovedInvoiceToDraft.js';
import type { DeleteInvoiceDraftState } from '../hooks/useDeleteInvoiceDraft.js';
import type { InvoiceCompanySettingsState } from '../hooks/useInvoiceCompanySettings.js';
import type { InvoiceCustomerListState } from '../hooks/useInvoiceCustomers.js';
import type { InvoiceDeliveryEventListState } from '../hooks/useInvoiceDeliveryEvents.js';
import type { InvoiceDraftEditorState } from '../hooks/useInvoiceDraftEditor.js';
import type { InvoiceDraftListState } from '../hooks/useInvoiceDrafts.js';
import type { InvoicePaymentDefaultsState } from '../hooks/useInvoicePaymentDefaults.js';
import type { MarkApprovedInvoiceSentState } from '../hooks/useMarkApprovedInvoiceSent.js';
import type { ReopenApprovedInvoiceState } from '../hooks/useReopenApprovedInvoiceForEditing.js';
import type { SendApprovedInvoiceEmailDryRunState } from '../hooks/useSendApprovedInvoiceEmailDryRun.js';
import type { SendApprovedInvoiceEmailSmtpState } from '../hooks/useSendApprovedInvoiceEmailSmtp.js';
import type { SendApprovedInvoiceEmailSmtpTestState } from '../hooks/useSendApprovedInvoiceEmailSmtpTest.js';
import { uiText } from '../../../i18n/fi.js';

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
  invoiceDeliveryEventListState: InvoiceDeliveryEventListState;
  markApprovedInvoiceSentState: MarkApprovedInvoiceSentState;
  pendingDeleteDraftId: string | null;
  reopenApprovedInvoiceState: ReopenApprovedInvoiceState;
  sendApprovedInvoiceEmailState: SendApprovedInvoiceEmailDryRunState;
  sendApprovedInvoiceEmailSmtpState: SendApprovedInvoiceEmailSmtpState;
  sendApprovedInvoiceEmailSmtpTestState: SendApprovedInvoiceEmailSmtpTestState;
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
  onSendApprovedInvoiceEmailSmtpTest(
    id: string,
    input: ApprovedInvoiceEmailSmtpTestPrepareInput,
  ): void;
  onSendApprovedInvoiceEmailSmtp(
    id: string,
    input: ApprovedInvoiceEmailSmtpPrepareInput,
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
  invoiceDeliveryEventListState,
  markApprovedInvoiceSentState,
  drafts,
  errorMessage,
  isLoading,
  pendingDeleteDraftId,
  reopenApprovedInvoiceState,
  sendApprovedInvoiceEmailState,
  sendApprovedInvoiceEmailSmtpState,
  sendApprovedInvoiceEmailSmtpTestState,
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
  onSendApprovedInvoiceEmailSmtp,
  onSendApprovedInvoiceEmailSmtpTest,
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
        <InvoiceWorkspaceListView
          approvedInvoices={approvedInvoiceListState.approvedInvoices}
          approvedInvoiceErrorMessage={approvedInvoiceListState.errorMessage}
          customers={customerListState.customers}
          customerErrorMessage={customerListState.errorMessage}
          deleteErrorMessage={deleteState.errorMessage}
          deletingDraftId={deleteState.deletingDraftId}
          drafts={drafts}
          draftErrorMessage={errorMessage}
          isApprovedInvoiceListLoading={approvedInvoiceListState.isLoading}
          isCustomerListLoading={customerListState.isLoading}
          isDraftListLoading={isLoading}
          pendingDeleteDraftId={pendingDeleteDraftId}
          onCancelDeleteDraft={onCancelDeleteDraft}
          onConfirmDeleteDraft={onConfirmDeleteDraft}
          onNewInvoice={onNewInvoice}
          onOpenApprovedInvoice={onOpenApprovedInvoice}
          onOpenDraft={onOpenDraft}
          onRequestDeleteDraft={onRequestDeleteDraft}
        />
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
          emailSmtpTestRecipient={normalizeOptionalValue(
            companySettingsState.companySettings
              ?.emailTestRecipientOverride ?? '',
          )}
          emailSmtpTestUnavailableMessage={
            getInvoiceEmailSmtpTestUnavailableMessage(
              companySettingsState.companySettings,
              companySettingsState.errorMessage,
              companySettingsState.isLoading,
            )
          }
          emailSmtpUnavailableMessage={getInvoiceEmailSmtpUnavailableMessage(
            companySettingsState.companySettings,
            companySettingsState.errorMessage,
            companySettingsState.isLoading,
          )}
          copyApprovedInvoiceState={copyApprovedInvoiceState}
          approvedInvoicePdfState={approvedInvoicePdfState}
          approvedInvoiceState={approvedInvoiceState}
          invoiceDeliveryEventListState={invoiceDeliveryEventListState}
          markApprovedInvoiceSentState={markApprovedInvoiceSentState}
          reopenApprovedInvoiceState={reopenApprovedInvoiceState}
          sendApprovedInvoiceEmailState={sendApprovedInvoiceEmailState}
          sendApprovedInvoiceEmailSmtpState={sendApprovedInvoiceEmailSmtpState}
          sendApprovedInvoiceEmailSmtpTestState={
            sendApprovedInvoiceEmailSmtpTestState
          }
          onBack={onBackToDrafts}
          onCopyApprovedInvoiceToDraft={onCopyApprovedInvoiceToDraft}
          onCreateApprovedInvoicePdf={onCreateApprovedInvoicePdf}
          onEditApprovedInvoice={onEditApprovedInvoice}
          onMarkApprovedInvoiceSent={onMarkApprovedInvoiceSent}
          onOpenApprovedInvoicePdf={onOpenApprovedInvoicePdf}
          onPrepareApprovedInvoiceEmail={onPrepareApprovedInvoiceEmail}
          onSendApprovedInvoiceEmailDryRun={onSendApprovedInvoiceEmailDryRun}
          onSendApprovedInvoiceEmailSmtp={onSendApprovedInvoiceEmailSmtp}
          onSendApprovedInvoiceEmailSmtpTest={
            onSendApprovedInvoiceEmailSmtpTest
          }
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
  emailSmtpTestRecipient: string | null;
  emailSmtpTestUnavailableMessage: string | null;
  emailSmtpUnavailableMessage: string | null;
  approvedInvoicePdfState: ApprovedInvoicePdfState;
  approvedInvoiceState: ApprovedInvoiceState;
  invoiceDeliveryEventListState: InvoiceDeliveryEventListState;
  copyApprovedInvoiceState: CopyApprovedInvoiceState;
  markApprovedInvoiceSentState: MarkApprovedInvoiceSentState;
  reopenApprovedInvoiceState: ReopenApprovedInvoiceState;
  sendApprovedInvoiceEmailState: SendApprovedInvoiceEmailDryRunState;
  sendApprovedInvoiceEmailSmtpState: SendApprovedInvoiceEmailSmtpState;
  sendApprovedInvoiceEmailSmtpTestState: SendApprovedInvoiceEmailSmtpTestState;
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
  onSendApprovedInvoiceEmailSmtpTest(
    id: string,
    input: ApprovedInvoiceEmailSmtpTestPrepareInput,
  ): void;
  onSendApprovedInvoiceEmailSmtp(
    id: string,
    input: ApprovedInvoiceEmailSmtpPrepareInput,
  ): void;
}

function ApprovedInvoiceView({
  approvedInvoiceEmailState,
  emailSmtpTestRecipient,
  emailSmtpTestUnavailableMessage,
  emailSmtpUnavailableMessage,
  approvedInvoicePdfState,
  approvedInvoiceState,
  invoiceDeliveryEventListState,
  copyApprovedInvoiceState,
  markApprovedInvoiceSentState,
  reopenApprovedInvoiceState,
  sendApprovedInvoiceEmailState,
  sendApprovedInvoiceEmailSmtpState,
  sendApprovedInvoiceEmailSmtpTestState,
  onBack,
  onCopyApprovedInvoiceToDraft,
  onCreateApprovedInvoicePdf,
  onEditApprovedInvoice,
  onMarkApprovedInvoiceSent,
  onOpenApprovedInvoicePdf,
  onPrepareApprovedInvoiceEmail,
  onSendApprovedInvoiceEmailDryRun,
  onSendApprovedInvoiceEmailSmtp,
  onSendApprovedInvoiceEmailSmtpTest,
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
      emailSmtpTestErrorMessage={
        sendApprovedInvoiceEmailSmtpTestState.errorMessage
      }
      emailSmtpTestRecipient={emailSmtpTestRecipient}
      emailSmtpTestUnavailableMessage={emailSmtpTestUnavailableMessage}
      emailSmtpTestSuccessMessage={
        sendApprovedInvoiceEmailSmtpTestState.successMessage
      }
      emailSmtpErrorMessage={sendApprovedInvoiceEmailSmtpState.errorMessage}
      emailSmtpSuccessMessage={sendApprovedInvoiceEmailSmtpState.successMessage}
      emailSmtpUnavailableMessage={emailSmtpUnavailableMessage}
      invoice={approvedInvoiceState.approvedInvoice}
      deliveryEvents={invoiceDeliveryEventListState.events}
      deliveryEventsErrorMessage={invoiceDeliveryEventListState.errorMessage}
      isLoadingDeliveryEvents={invoiceDeliveryEventListState.isLoading}
      isCopyingInvoice={copyApprovedInvoiceState.isCopying}
      isCreatingPdf={approvedInvoicePdfState.isCreating}
      isPdfAvailable={approvedInvoicePdfState.document !== null}
      isMarkingSent={markApprovedInvoiceSentState.isMarkingSent}
      isPreparingEmail={approvedInvoiceEmailState.isPreparing}
      isSendingEmailDryRun={sendApprovedInvoiceEmailState.isSending}
      isSendingEmailSmtp={sendApprovedInvoiceEmailSmtpState.isSending}
      isSendingEmailSmtpTest={
        sendApprovedInvoiceEmailSmtpTestState.isSending
      }
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
      onSendEmailSmtp={onSendApprovedInvoiceEmailSmtp}
      onSendEmailSmtpTest={onSendApprovedInvoiceEmailSmtpTest}
    />
  );
}

function normalizeOptionalValue(value: string): string | null {
  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : null;
}
