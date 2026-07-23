import type {
  ApprovedInvoiceEmailDryRunSendInput,
  ApprovedInvoiceEmailSmtpPrepareInput,
  ApprovedInvoiceEmailSmtpTestPrepareInput,
  CancelApprovedInvoiceInput,
} from '@eky/api-client';

import { ApprovedInvoicePreview } from './ApprovedInvoicePreview.js';
import styles from './InvoicingPage.module.css';
import type { ApprovedInvoiceEmailDryRunState } from '../hooks/useApprovedInvoiceEmailDryRun.js';
import type { ApprovedInvoicePdfState } from '../hooks/useApprovedInvoicePdf.js';
import type { ApprovedInvoiceState } from '../hooks/useApprovedInvoice.js';
import type { CancelApprovedInvoiceState } from '../hooks/useCancelApprovedInvoice.js';
import type { CopyApprovedInvoiceState } from '../hooks/useCopyApprovedInvoiceToDraft.js';
import type { InvoiceDeliveryEventListState } from '../hooks/useInvoiceDeliveryEvents.js';
import type { InvoiceCreditContextState } from '../hooks/useInvoiceCreditContext.js';
import type { MarkApprovedInvoiceSentState } from '../hooks/useMarkApprovedInvoiceSent.js';
import type { ReopenApprovedInvoiceState } from '../hooks/useReopenApprovedInvoiceForEditing.js';
import type { SendApprovedInvoiceEmailDryRunState } from '../hooks/useSendApprovedInvoiceEmailDryRun.js';
import type { SendApprovedInvoiceEmailSmtpState } from '../hooks/useSendApprovedInvoiceEmailSmtp.js';
import type { SendApprovedInvoiceEmailSmtpTestState } from '../hooks/useSendApprovedInvoiceEmailSmtpTest.js';
import { uiText } from '../../../i18n/fi.js';

type ApprovedInvoiceReadViewState = Pick<
  ApprovedInvoiceState,
  'approvedInvoice' | 'errorMessage' | 'isLoading'
>;
type ApprovedInvoicePdfViewState = Pick<
  ApprovedInvoicePdfState,
  'document' | 'errorMessage' | 'isCreating'
>;
type ApprovedInvoiceEmailViewState = Pick<
  ApprovedInvoiceEmailDryRunState,
  'email' | 'errorMessage' | 'isPreparing'
>;
type InvoiceDeliveryHistoryViewState = Pick<
  InvoiceDeliveryEventListState,
  'errorMessage' | 'events' | 'isLoading'
>;
type InvoiceCreditContextViewState = Pick<
  InvoiceCreditContextState,
  'creditContext' | 'errorMessage' | 'isLoading'
>;
type CopyApprovedInvoiceViewState = Pick<
  CopyApprovedInvoiceState,
  'errorMessage' | 'isCopying'
>;
type CancelApprovedInvoiceViewState = Pick<
  CancelApprovedInvoiceState,
  'errorMessage' | 'isCancelling'
>;
type MarkApprovedInvoiceSentViewState = Pick<
  MarkApprovedInvoiceSentState,
  'errorMessage' | 'isMarkingSent'
>;
type ReopenApprovedInvoiceViewState = Pick<
  ReopenApprovedInvoiceState,
  'errorMessage' | 'isReopening'
>;
type EmailSendViewState = Pick<
  SendApprovedInvoiceEmailDryRunState,
  'errorMessage' | 'isSending' | 'successMessage'
>;
type EmailSmtpSendViewState = Pick<
  SendApprovedInvoiceEmailSmtpState,
  'errorMessage' | 'isSending' | 'successMessage'
>;
type EmailSmtpTestSendViewState = Pick<
  SendApprovedInvoiceEmailSmtpTestState,
  'errorMessage' | 'isSending' | 'successMessage'
>;

interface ApprovedInvoiceDetailViewProps {
  cancellationState: CancelApprovedInvoiceViewState;
  copyState: CopyApprovedInvoiceViewState;
  creditContextState: InvoiceCreditContextViewState;
  deliveryHistoryState: InvoiceDeliveryHistoryViewState;
  emailState: ApprovedInvoiceEmailViewState;
  emailSendState: EmailSendViewState;
  emailSmtpState: EmailSmtpSendViewState;
  emailSmtpTestRecipient: string | null;
  emailSmtpTestState: EmailSmtpTestSendViewState;
  emailSmtpTestUnavailableMessage: string | null;
  emailSmtpUnavailableMessage: string | null;
  invoiceState: ApprovedInvoiceReadViewState;
  markSentState: MarkApprovedInvoiceSentViewState;
  pdfState: ApprovedInvoicePdfViewState;
  reopenState: ReopenApprovedInvoiceViewState;
  onBack(): void;
  onCancelInvoice(id: string, input: CancelApprovedInvoiceInput): void;
  onCopyInvoice(id: string): void;
  onCreateCreditDraft(id: string): void;
  onCreatePdf(id: string): void;
  onEditInvoice(id: string): void;
  onMarkSent(id: string): void;
  onOpenPdf(id: string): void;
  onOpenRelatedDraft(id: string): void;
  onOpenRelatedInvoice(id: string): void;
  onPrepareEmail(id: string): void;
  onSendEmailDryRun(
    id: string,
    input: ApprovedInvoiceEmailDryRunSendInput,
  ): void;
  onSendEmailSmtp(
    id: string,
    input: ApprovedInvoiceEmailSmtpPrepareInput,
  ): void;
  onSendEmailSmtpTest(
    id: string,
    input: ApprovedInvoiceEmailSmtpTestPrepareInput,
  ): void;
}

export function ApprovedInvoiceDetailView({
  cancellationState,
  copyState,
  creditContextState,
  deliveryHistoryState,
  emailState,
  emailSendState,
  emailSmtpState,
  emailSmtpTestRecipient,
  emailSmtpTestState,
  emailSmtpTestUnavailableMessage,
  emailSmtpUnavailableMessage,
  invoiceState,
  markSentState,
  pdfState,
  reopenState,
  onBack,
  onCancelInvoice,
  onCopyInvoice,
  onCreateCreditDraft,
  onCreatePdf,
  onEditInvoice,
  onMarkSent,
  onOpenPdf,
  onOpenRelatedDraft,
  onOpenRelatedInvoice,
  onPrepareEmail,
  onSendEmailDryRun,
  onSendEmailSmtp,
  onSendEmailSmtpTest,
}: ApprovedInvoiceDetailViewProps): React.JSX.Element {
  if (invoiceState.isLoading) {
    return (
      <section className={`panel ${styles.editorState}`}>
        <p className={styles.state}>
          {uiText.invoicing.approvedInvoiceLoading}
        </p>
      </section>
    );
  }

  if (invoiceState.errorMessage !== null) {
    return (
      <section className={`panel ${styles.editorState}`}>
        <p className="message error-message" role="alert">
          {invoiceState.errorMessage}
        </p>
        <button className="ghost-button" onClick={onBack} type="button">
          {uiText.invoicing.backToDrafts}
        </button>
      </section>
    );
  }

  if (invoiceState.approvedInvoice === null) {
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
      cancellationErrorMessage={cancellationState.errorMessage}
      copyErrorMessage={copyState.errorMessage}
      creditContext={creditContextState.creditContext}
      creditContextErrorMessage={creditContextState.errorMessage}
      deliveryEvents={deliveryHistoryState.events}
      deliveryEventsErrorMessage={deliveryHistoryState.errorMessage}
      email={emailState.email}
      emailErrorMessage={emailState.errorMessage}
      emailSendErrorMessage={emailSendState.errorMessage}
      emailSendSuccessMessage={emailSendState.successMessage}
      emailSmtpErrorMessage={emailSmtpState.errorMessage}
      emailSmtpSuccessMessage={emailSmtpState.successMessage}
      emailSmtpTestErrorMessage={emailSmtpTestState.errorMessage}
      emailSmtpTestRecipient={emailSmtpTestRecipient}
      emailSmtpTestSuccessMessage={emailSmtpTestState.successMessage}
      emailSmtpTestUnavailableMessage={emailSmtpTestUnavailableMessage}
      emailSmtpUnavailableMessage={emailSmtpUnavailableMessage}
      invoice={invoiceState.approvedInvoice}
      isCancellingInvoice={cancellationState.isCancelling}
      isCopyingInvoice={copyState.isCopying}
      isCreatingPdf={pdfState.isCreating}
      isLoadingCreditContext={creditContextState.isLoading}
      isLoadingDeliveryEvents={deliveryHistoryState.isLoading}
      isMarkingSent={markSentState.isMarkingSent}
      isPdfAvailable={pdfState.document !== null}
      isPreparingEmail={emailState.isPreparing}
      isReopening={reopenState.isReopening}
      isSendingEmailDryRun={emailSendState.isSending}
      isSendingEmailSmtp={emailSmtpState.isSending}
      isSendingEmailSmtpTest={emailSmtpTestState.isSending}
      markSentErrorMessage={markSentState.errorMessage}
      pdfErrorMessage={pdfState.errorMessage}
      reopenErrorMessage={reopenState.errorMessage}
      onBack={onBack}
      onCancelInvoice={onCancelInvoice}
      onCopyInvoice={onCopyInvoice}
      onCreateCreditDraft={onCreateCreditDraft}
      onCreatePdf={onCreatePdf}
      onEditInvoice={onEditInvoice}
      onMarkSent={onMarkSent}
      onOpenPdf={onOpenPdf}
      onOpenRelatedDraft={onOpenRelatedDraft}
      onOpenRelatedInvoice={onOpenRelatedInvoice}
      onPrepareEmail={onPrepareEmail}
      onSendEmailDryRun={onSendEmailDryRun}
      onSendEmailSmtp={onSendEmailSmtp}
      onSendEmailSmtpTest={onSendEmailSmtpTest}
    />
  );
}
