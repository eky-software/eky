import type {
  ApprovedInvoiceView,
  CancelApprovedInvoiceInput,
} from '@eky/api-client';
import { useState } from 'react';

import { InvoiceCancellationPanel } from './InvoiceCancellationPanel.js';
import styles from './ApprovedInvoicePreview.module.css';
import { uiText } from '../../../i18n/fi.js';
import { MessageBanner } from '../../../shared/ui/index.js';

interface ApprovedInvoiceActionsProps {
  cancellationErrorMessage: string | null;
  copyErrorMessage: string | null;
  emailErrorMessage: string | null;
  invoiceId: string;
  invoiceNumber: string;
  invoiceStatus: ApprovedInvoiceView['status'];
  isCancellingInvoice: boolean;
  isCopyingInvoice: boolean;
  isCreatingPdf: boolean;
  isMarkingSent: boolean;
  isPdfAvailable: boolean;
  isPreparingEmail: boolean;
  isReopening: boolean;
  markSentErrorMessage: string | null;
  pdfErrorMessage: string | null;
  reopenErrorMessage: string | null;
  onBack(): void;
  onCancelInvoice(id: string, input: CancelApprovedInvoiceInput): void;
  onCopyInvoice(id: string): void;
  onCreatePdf(id: string): void;
  onEditInvoice(id: string): void;
  onMarkSent(id: string): void;
  onOpenPdf(id: string): void;
  onPrepareEmail(id: string): void;
}

type PendingInvoiceAction = 'cancel' | 'copy' | 'edit' | 'markSent' | null;

export function ApprovedInvoiceActions({
  cancellationErrorMessage,
  copyErrorMessage,
  emailErrorMessage,
  invoiceId,
  invoiceNumber,
  invoiceStatus,
  isCancellingInvoice,
  isCopyingInvoice,
  isCreatingPdf,
  isMarkingSent,
  isPdfAvailable,
  isPreparingEmail,
  isReopening,
  markSentErrorMessage,
  pdfErrorMessage,
  reopenErrorMessage,
  onBack,
  onCancelInvoice,
  onCopyInvoice,
  onCreatePdf,
  onEditInvoice,
  onMarkSent,
  onOpenPdf,
  onPrepareEmail,
}: ApprovedInvoiceActionsProps): React.JSX.Element {
  const isSent = invoiceStatus === 'sent';
  const [pendingAction, setPendingAction] =
    useState<PendingInvoiceAction>(null);
  const confirmationMessage =
    pendingAction === 'copy'
      ? uiText.invoicing.copyApprovedInvoiceConfirm
      : pendingAction === 'markSent'
        ? uiText.invoicing.markApprovedInvoiceSentConfirm
        : uiText.invoicing.reopenApprovedInvoiceConfirm;
  const confirmationAction =
    pendingAction === 'copy'
      ? uiText.invoicing.copyApprovedInvoice
      : pendingAction === 'markSent'
        ? uiText.invoicing.markApprovedInvoiceSent
        : uiText.invoicing.editApprovedInvoice;
  const isConfirmationActionPending =
    pendingAction === 'copy'
      ? isCopyingInvoice
      : pendingAction === 'markSent'
        ? isCreatingPdf || isMarkingSent
        : isReopening;

  function confirmPendingAction(): void {
    const action = pendingAction;
    setPendingAction(null);

    if (action === 'copy') {
      onCopyInvoice(invoiceId);
      return;
    }

    if (action === 'markSent') {
      onMarkSent(invoiceId);
      return;
    }

    if (action === 'edit') {
      onEditInvoice(invoiceId);
    }
  }

  return (
    <>
      <header className={styles.header}>
        <div>
          <p className="panel-kicker">
            {uiText.invoicing.approvedInvoiceKicker}
          </p>
          <h2>
            {uiText.invoicing.invoice} {invoiceNumber}
          </h2>
          <p className={styles.muted}>
            {uiText.invoicing.approvedInvoicePreviewHelp}
          </p>
          <p className={styles.status}>
            <span className="status-pill status-pill-active">
              {isSent
                ? uiText.invoicing.statusSent
                : uiText.invoicing.statusApproved}
            </span>
          </p>
        </div>
        <div className={styles.headerActions}>
          {!isPdfAvailable ? (
            <button
              className="secondary-action"
              disabled={isCreatingPdf}
              onClick={() => onCreatePdf(invoiceId)}
              type="button"
            >
              {isCreatingPdf
                ? uiText.invoicing.approvedInvoicePdfCreating
                : uiText.invoicing.approvedInvoicePdfCreate}
            </button>
          ) : null}
          {isPdfAvailable ? (
            <button
              className={`secondary-action ${styles.actionLink}`}
              disabled={isCreatingPdf}
              onClick={() => onOpenPdf(invoiceId)}
              type="button"
            >
              {isCreatingPdf
                ? uiText.invoicing.approvedInvoicePdfCreating
                : uiText.invoicing.approvedInvoiceOpenPdf}
            </button>
          ) : null}
          <button
            className="secondary-action"
            disabled={isCreatingPdf || isPreparingEmail}
            onClick={() => onPrepareEmail(invoiceId)}
            type="button"
          >
            {isPreparingEmail
              ? uiText.invoicing.invoiceEmailPreparing
              : uiText.invoicing.invoiceEmailPrepare}
          </button>
          {isSent ? (
            <button
              className="secondary-action"
              disabled={isCopyingInvoice}
              onClick={() => setPendingAction('copy')}
              type="button"
            >
              {isCopyingInvoice
                ? uiText.invoicing.copiedApprovedInvoice
                : uiText.invoicing.copyApprovedInvoice}
            </button>
          ) : null}
          {!isSent ? (
            <>
              <button
                className="secondary-action"
                disabled={isCreatingPdf || isMarkingSent}
                onClick={() => setPendingAction('markSent')}
                type="button"
              >
                {isCreatingPdf
                  ? uiText.invoicing.approvedInvoicePdfCreating
                  : isMarkingSent
                    ? uiText.invoicing.markingApprovedInvoiceSent
                    : uiText.invoicing.markApprovedInvoiceSent}
              </button>
              <button
                className="secondary-action"
                disabled={isReopening}
                onClick={() => setPendingAction('edit')}
                type="button"
              >
                {isReopening
                  ? uiText.invoicing.reopeningApprovedInvoice
                  : uiText.invoicing.editApprovedInvoice}
              </button>
              <button
                className="secondary-action"
                disabled={isCancellingInvoice}
                onClick={() => setPendingAction('cancel')}
                type="button"
              >
                {uiText.invoicing.cancelApprovedInvoice}
              </button>
            </>
          ) : null}
          <button className="ghost-button" onClick={onBack} type="button">
            {uiText.invoicing.backToDrafts}
          </button>
        </div>
      </header>

      {pendingAction === 'cancel' ? (
        <InvoiceCancellationPanel
          errorMessage={cancellationErrorMessage}
          invoiceNumber={invoiceNumber}
          isCancelling={isCancellingInvoice}
          onCancel={() => setPendingAction(null)}
          onConfirm={(input) => onCancelInvoice(invoiceId, input)}
        />
      ) : pendingAction !== null ? (
        <section
          aria-labelledby="approved-invoice-action-confirmation-heading"
          className={styles.actionConfirmation}
        >
          <p id="approved-invoice-action-confirmation-heading">
            {confirmationMessage}
          </p>
          <div className={styles.actionConfirmationButtons}>
            <button
              className="ghost-button"
              onClick={() => setPendingAction(null)}
              type="button"
            >
              {uiText.invoicing.cancel}
            </button>
            <button
              className="primary-action"
              disabled={isConfirmationActionPending}
              onClick={confirmPendingAction}
              type="button"
            >
              {confirmationAction}
            </button>
          </div>
        </section>
      ) : null}

      {reopenErrorMessage !== null ? (
        <MessageBanner variant="error">{reopenErrorMessage}</MessageBanner>
      ) : null}
      {pdfErrorMessage !== null ? (
        <MessageBanner variant="error">{pdfErrorMessage}</MessageBanner>
      ) : null}
      {markSentErrorMessage !== null ? (
        <MessageBanner variant="error">{markSentErrorMessage}</MessageBanner>
      ) : null}
      {copyErrorMessage !== null ? (
        <MessageBanner variant="error">{copyErrorMessage}</MessageBanner>
      ) : null}
      {emailErrorMessage !== null ? (
        <MessageBanner variant="error">{emailErrorMessage}</MessageBanner>
      ) : null}
    </>
  );
}
