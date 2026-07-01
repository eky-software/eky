import type { ApprovedInvoiceResult } from '@eky/api-client';

import styles from './InvoiceApprovalPanel.module.css';
import { uiText } from '../../../i18n/fi.js';

interface InvoiceApprovalConfirmationProps {
  isApproving: boolean;
  onCancel(): void;
  onConfirm(): void;
}

export function InvoiceApprovalConfirmation({
  isApproving,
  onCancel,
  onConfirm,
}: InvoiceApprovalConfirmationProps): React.JSX.Element {
  return (
    <section
      aria-labelledby="invoice-approval-confirmation-heading"
      className={`message ${styles.panel}`}
    >
      <div>
        <h3 id="invoice-approval-confirmation-heading">
          {uiText.invoicing.approveDraftConfirmationTitle}
        </h3>
        <p>{uiText.invoicing.approveDraftConfirmationIntro}</p>
        <p>{uiText.invoicing.approveDraftConfirmationLock}</p>
      </div>
      <div className={styles.actions}>
        <button className="ghost-button" onClick={onCancel} type="button">
          {uiText.invoicing.cancel}
        </button>
        <button
          disabled={isApproving}
          onClick={onConfirm}
          type="button"
        >
          {isApproving
            ? uiText.invoicing.approvingDraft
            : uiText.invoicing.approveDraftConfirmAction}
        </button>
      </div>
    </section>
  );
}

interface InvoiceApprovalSuccessPanelProps {
  approvedInvoice: ApprovedInvoiceResult;
  onBack(): void;
  onOpenApprovedInvoice(id: string): void;
}

export function InvoiceApprovalSuccessPanel({
  approvedInvoice,
  onBack,
  onOpenApprovedInvoice,
}: InvoiceApprovalSuccessPanelProps): React.JSX.Element {
  return (
    <section className={`panel ${styles.panel}`} role="status">
      <div>
        <p className="panel-kicker">{uiText.invoicing.approvedInvoiceKicker}</p>
        <h2>{uiText.invoicing.approveDraftSuccess}</h2>
        <p>{uiText.invoicing.approveDraftSuccessHelp}</p>
      </div>
      <dl className={styles.details}>
        <dt>{uiText.invoicing.invoiceNumber}</dt>
        <dd>{approvedInvoice.invoiceNumber}</dd>
        <dt>{uiText.invoicing.referenceNumber}</dt>
        <dd>{approvedInvoice.referenceNumber}</dd>
      </dl>
      <div className={styles.actions}>
        <button
          className="primary-action"
          onClick={() => onOpenApprovedInvoice(approvedInvoice.invoiceId)}
          type="button"
        >
          {uiText.invoicing.invoicePreviewOpen}
        </button>
        <button className="ghost-button" onClick={onBack} type="button">
          {uiText.invoicing.backToDrafts}
        </button>
      </div>
    </section>
  );
}
