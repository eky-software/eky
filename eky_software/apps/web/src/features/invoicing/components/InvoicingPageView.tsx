import type {
  ApprovedInvoiceEmailDryRunSendInput,
  ApprovedInvoiceEmailSmtpPrepareInput,
  ApprovedInvoiceEmailSmtpTestPrepareInput,
  ApprovedInvoiceResult,
  CancelApprovedInvoiceInput,
  InvoiceDraft,
  InvoiceDraftSummary,
  UpdateCreditInvoiceDraftInput,
} from '@eky/api-client';

import { ApprovedInvoiceDetailView } from './ApprovedInvoiceDetailView.js';
import { CreditInvoiceDraftEditorView } from './CreditInvoiceDraftEditorView.js';
import { InvoiceDraftEditorView } from './InvoiceDraftEditorView.js';
import { InvoiceWorkspaceListView } from './InvoiceWorkspaceListView.js';
import type { NewInvoiceFormClient } from './NewInvoiceForm.js';
import styles from './InvoicingPage.module.css';
import { getInvoiceEmailSmtpTestUnavailableMessage } from '../approved/invoiceEmailSmtpTestAvailability.js';
import { getInvoiceEmailSmtpUnavailableMessage } from '../approved/invoiceEmailSmtpAvailability.js';
import type { InvoicingPageMode } from '../state/invoicingPageState.js';
import type { ApprovedInvoiceEmailDryRunState } from '../hooks/useApprovedInvoiceEmailDryRun.js';
import type { ApproveCreditInvoiceDraftState } from '../hooks/useApproveCreditInvoiceDraft.js';
import type { ApprovedInvoiceListState } from '../hooks/useApprovedInvoices.js';
import type { ApprovedInvoicePdfState } from '../hooks/useApprovedInvoicePdf.js';
import type { ApprovedInvoiceState } from '../hooks/useApprovedInvoice.js';
import type { CancelApprovedInvoiceState } from '../hooks/useCancelApprovedInvoice.js';
import type { CopyApprovedInvoiceState } from '../hooks/useCopyApprovedInvoiceToDraft.js';
import type { CreditInvoiceDraftState } from '../hooks/useCreditInvoiceDraft.js';
import type { DeleteInvoiceDraftState } from '../hooks/useDeleteInvoiceDraft.js';
import type { InvoiceCompanySettingsState } from '../hooks/useInvoiceCompanySettings.js';
import type { InvoiceCustomerListState } from '../hooks/useInvoiceCustomers.js';
import type { InvoiceDeliveryEventListState } from '../hooks/useInvoiceDeliveryEvents.js';
import type { InvoiceCreditContextState } from '../hooks/useInvoiceCreditContext.js';
import type { InvoiceDraftEditorState } from '../hooks/useInvoiceDraftEditor.js';
import type { InvoicePaymentDefaultsState } from '../hooks/useInvoicePaymentDefaults.js';
import type { InvoiceVatRatesState } from '../hooks/useInvoiceVatRates.js';
import type { MarkApprovedInvoiceSentState } from '../hooks/useMarkApprovedInvoiceSent.js';
import type { ReopenApprovedInvoiceState } from '../hooks/useReopenApprovedInvoiceForEditing.js';
import type { SendApprovedInvoiceEmailDryRunState } from '../hooks/useSendApprovedInvoiceEmailDryRun.js';
import type { SendApprovedInvoiceEmailSmtpState } from '../hooks/useSendApprovedInvoiceEmailSmtp.js';
import type { SendApprovedInvoiceEmailSmtpTestState } from '../hooks/useSendApprovedInvoiceEmailSmtpTest.js';
import { uiText } from '../../../i18n/fi.js';

interface InvoicingPageViewProps {
  activeView: InvoicingPageMode;
  apiClient: NewInvoiceFormClient;
  approveCreditInvoiceDraftState: ApproveCreditInvoiceDraftState;
  approvedInvoiceEmailState: ApprovedInvoiceEmailDryRunState;
  approvedInvoiceListState: ApprovedInvoiceListState;
  approvedInvoicePdfState: ApprovedInvoicePdfState;
  approvedInvoiceState: ApprovedInvoiceState;
  cancelApprovedInvoiceState: CancelApprovedInvoiceState;
  customerListState: InvoiceCustomerListState;
  companySettingsState: InvoiceCompanySettingsState;
  copyApprovedInvoiceState: CopyApprovedInvoiceState;
  creditInvoiceDraftState: CreditInvoiceDraftState;
  deleteState: DeleteInvoiceDraftState;
  drafts: InvoiceDraftSummary[];
  draftErrorMessage: string | null;
  draftEditorState: InvoiceDraftEditorState;
  invoicePaymentDefaultsState: InvoicePaymentDefaultsState;
  invoiceVatRatesState: InvoiceVatRatesState;
  invoiceDeliveryEventListState: InvoiceDeliveryEventListState;
  invoiceCreditContextState: InvoiceCreditContextState;
  markApprovedInvoiceSentState: MarkApprovedInvoiceSentState;
  isDraftListLoading: boolean;
  pendingDeleteDraftId: string | null;
  reopenApprovedInvoiceState: ReopenApprovedInvoiceState;
  sendApprovedInvoiceEmailState: SendApprovedInvoiceEmailDryRunState;
  sendApprovedInvoiceEmailSmtpState: SendApprovedInvoiceEmailSmtpState;
  sendApprovedInvoiceEmailSmtpTestState: SendApprovedInvoiceEmailSmtpTestState;
  onBackToDrafts(): void;
  onApproveCreditInvoiceDraft(
    invoiceDraftId: string,
    input: UpdateCreditInvoiceDraftInput,
  ): void;
  onCancelApprovedInvoice(
    id: string,
    input: CancelApprovedInvoiceInput,
  ): void;
  onCancelDeleteDraft(): void;
  onConfirmDeleteDraft(id: string): void;
  onCreateApprovedInvoicePdf(id: string): void;
  onCopyApprovedInvoiceToDraft(id: string): void;
  onCreateCreditInvoiceDraft(id: string): void;
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
  onSaveCreditInvoiceDraft(
    invoiceDraftId: string,
    input: UpdateCreditInvoiceDraftInput,
  ): void;
  onRequestDeleteDraft(id: string): void;
  onNewInvoice(): void;
}

export function InvoicingPageView({
  activeView,
  apiClient,
  approveCreditInvoiceDraftState,
  approvedInvoiceEmailState,
  approvedInvoiceListState,
  approvedInvoicePdfState,
  approvedInvoiceState,
  cancelApprovedInvoiceState,
  customerListState,
  companySettingsState,
  copyApprovedInvoiceState,
  creditInvoiceDraftState,
  deleteState,
  draftEditorState,
  invoicePaymentDefaultsState,
  invoiceVatRatesState,
  invoiceDeliveryEventListState,
  invoiceCreditContextState,
  markApprovedInvoiceSentState,
  drafts,
  draftErrorMessage,
  isDraftListLoading,
  pendingDeleteDraftId,
  reopenApprovedInvoiceState,
  sendApprovedInvoiceEmailState,
  sendApprovedInvoiceEmailSmtpState,
  sendApprovedInvoiceEmailSmtpTestState,
  onBackToDrafts,
  onApproveCreditInvoiceDraft,
  onCancelApprovedInvoice,
  onCancelDeleteDraft,
  onConfirmDeleteDraft,
  onCreateApprovedInvoicePdf,
  onCopyApprovedInvoiceToDraft,
  onCreateCreditInvoiceDraft,
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
  onSaveCreditInvoiceDraft,
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
          approvedInvoicePageState={approvedInvoiceListState.approved}
          cancelledInvoicePageState={approvedInvoiceListState.cancelled}
          creditedInvoicePageState={approvedInvoiceListState.credited}
          customers={customerListState.customers}
          customerErrorMessage={customerListState.errorMessage}
          deleteErrorMessage={deleteState.errorMessage}
          deletingDraftId={deleteState.deletingDraftId}
          drafts={drafts}
          draftErrorMessage={draftErrorMessage}
          isCustomerListLoading={customerListState.isLoading}
          isDraftListLoading={isDraftListLoading}
          pendingDeleteDraftId={pendingDeleteDraftId}
          sentInvoicePageState={approvedInvoiceListState.sent}
          onCancelDeleteDraft={onCancelDeleteDraft}
          onConfirmDeleteDraft={onConfirmDeleteDraft}
          onNewInvoice={onNewInvoice}
          onOpenApprovedInvoice={onOpenApprovedInvoice}
          onOpenDraft={onOpenDraft}
          onRequestDeleteDraft={onRequestDeleteDraft}
        />
      ) : activeView === 'newInvoice' || activeView === 'editInvoice' ? (
        <InvoiceDraftEditorView
          apiClient={apiClient}
          companySettingsState={companySettingsState}
          customerListState={customerListState}
          draft={
            activeView === 'editInvoice' ? draftEditorState.draft : null
          }
          draftErrorMessage={
            activeView === 'editInvoice' ? draftEditorState.errorMessage : null
          }
          editorMode={activeView === 'newInvoice' ? 'create' : 'edit'}
          invoicePaymentDefaultsState={invoicePaymentDefaultsState}
          invoiceVatRatesState={invoiceVatRatesState}
          isDraftLoading={
            activeView === 'editInvoice' && draftEditorState.isLoading
          }
          onBack={onBackToDrafts}
          onDraftApproved={onDraftApproved}
          onDraftSaved={onDraftSaved}
          onOpenApprovedInvoice={onOpenApprovedInvoice}
        />
      ) : activeView === 'creditInvoice' ? (
        <CreditInvoiceDraftEditorView
          approvalErrorMessage={approveCreditInvoiceDraftState.errorMessage}
          draft={creditInvoiceDraftState.draft}
          errorMessage={creditInvoiceDraftState.errorMessage}
          isApproving={approveCreditInvoiceDraftState.isApproving}
          isLoading={creditInvoiceDraftState.isLoading}
          isSaving={creditInvoiceDraftState.isSaving}
          successMessage={creditInvoiceDraftState.successMessage}
          onApprove={onApproveCreditInvoiceDraft}
          onBack={onBackToDrafts}
          onSave={onSaveCreditInvoiceDraft}
        />
      ) : (
        <ApprovedInvoiceDetailView
          cancellationState={{
            errorMessage: cancelApprovedInvoiceState.errorMessage,
            isCancelling: cancelApprovedInvoiceState.isCancelling,
          }}
          copyState={{
            errorMessage: copyApprovedInvoiceState.errorMessage,
            isCopying: copyApprovedInvoiceState.isCopying,
          }}
          creditContextState={{
            creditContext: invoiceCreditContextState.creditContext,
            errorMessage: invoiceCreditContextState.errorMessage,
            isLoading: invoiceCreditContextState.isLoading,
          }}
          deliveryHistoryState={{
            errorMessage: invoiceDeliveryEventListState.errorMessage,
            events: invoiceDeliveryEventListState.events,
            isLoading: invoiceDeliveryEventListState.isLoading,
          }}
          emailState={{
            email: approvedInvoiceEmailState.email,
            errorMessage: approvedInvoiceEmailState.errorMessage,
            isPreparing: approvedInvoiceEmailState.isPreparing,
          }}
          emailSendState={{
            errorMessage: sendApprovedInvoiceEmailState.errorMessage,
            isSending: sendApprovedInvoiceEmailState.isSending,
            successMessage: sendApprovedInvoiceEmailState.successMessage,
          }}
          emailSmtpState={{
            errorMessage: sendApprovedInvoiceEmailSmtpState.errorMessage,
            isSending: sendApprovedInvoiceEmailSmtpState.isSending,
            successMessage: sendApprovedInvoiceEmailSmtpState.successMessage,
          }}
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
          emailSmtpTestState={{
            errorMessage: sendApprovedInvoiceEmailSmtpTestState.errorMessage,
            isSending: sendApprovedInvoiceEmailSmtpTestState.isSending,
            successMessage:
              sendApprovedInvoiceEmailSmtpTestState.successMessage,
          }}
          invoiceState={{
            approvedInvoice: approvedInvoiceState.approvedInvoice,
            errorMessage: approvedInvoiceState.errorMessage,
            isLoading: approvedInvoiceState.isLoading,
          }}
          markSentState={{
            errorMessage: markApprovedInvoiceSentState.errorMessage,
            isMarkingSent: markApprovedInvoiceSentState.isMarkingSent,
          }}
          pdfState={{
            document: approvedInvoicePdfState.document,
            errorMessage: approvedInvoicePdfState.errorMessage,
            isCreating: approvedInvoicePdfState.isCreating,
          }}
          reopenState={{
            errorMessage: reopenApprovedInvoiceState.errorMessage,
            isReopening: reopenApprovedInvoiceState.isReopening,
          }}
          onBack={onBackToDrafts}
          onCancelInvoice={onCancelApprovedInvoice}
          onCopyInvoice={onCopyApprovedInvoiceToDraft}
          onCreateCreditDraft={onCreateCreditInvoiceDraft}
          onCreatePdf={onCreateApprovedInvoicePdf}
          onEditInvoice={onEditApprovedInvoice}
          onMarkSent={onMarkApprovedInvoiceSent}
          onOpenPdf={onOpenApprovedInvoicePdf}
          onOpenRelatedDraft={onOpenDraft}
          onOpenRelatedInvoice={onOpenApprovedInvoice}
          onPrepareEmail={onPrepareApprovedInvoiceEmail}
          onSendEmailDryRun={onSendApprovedInvoiceEmailDryRun}
          onSendEmailSmtp={onSendApprovedInvoiceEmailSmtp}
          onSendEmailSmtpTest={onSendApprovedInvoiceEmailSmtpTest}
        />
      )}
    </div>
  );
}

function normalizeOptionalValue(value: string): string | null {
  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : null;
}
