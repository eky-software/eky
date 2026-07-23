import type { CancelApprovedInvoiceInput } from '@eky/api-client';
import { useState } from 'react';

import styles from './InvoiceCancellationPanel.module.css';
import { uiText } from '../../../i18n/fi.js';
import { MessageBanner } from '../../../shared/ui/index.js';

interface InvoiceCancellationPanelProps {
  errorMessage: string | null;
  invoiceNumber: string;
  isCancelling: boolean;
  onCancel(): void;
  onConfirm(input: CancelApprovedInvoiceInput): void;
}

export function InvoiceCancellationPanel({
  errorMessage,
  invoiceNumber,
  isCancelling,
  onCancel,
  onConfirm,
}: InvoiceCancellationPanelProps): React.JSX.Element {
  const [confirmationInvoiceNumber, setConfirmationInvoiceNumber] =
    useState('');
  const [cancellationReason, setCancellationReason] = useState('');
  const canConfirm = isInvoiceCancellationConfirmationValid({
    cancellationReason,
    confirmationInvoiceNumber,
    invoiceNumber,
  });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!canConfirm || isCancelling) {
      return;
    }

    onConfirm({
      cancellationReason,
      confirmationInvoiceNumber,
    });
  }

  return (
    <section
      aria-labelledby="invoice-cancellation-heading"
      className={styles.panel}
    >
      <div className={styles.heading}>
        <div>
          <h3 id="invoice-cancellation-heading">
            {uiText.invoicing.cancelApprovedInvoiceTitle}
          </h3>
          <p>{uiText.invoicing.cancelApprovedInvoiceWarning}</p>
        </div>
        <strong>
          {uiText.invoicing.invoice} {invoiceNumber}
        </strong>
      </div>

      <form className={styles.form} noValidate onSubmit={handleSubmit}>
        <label>
          <span>{uiText.invoicing.cancelApprovedInvoiceNumberLabel}</span>
          <input
            autoComplete="off"
            maxLength={200}
            onChange={(event) =>
              setConfirmationInvoiceNumber(event.currentTarget.value)
            }
            spellCheck={false}
            type="text"
            value={confirmationInvoiceNumber}
          />
          <small>{uiText.invoicing.cancelApprovedInvoiceNumberHelp}</small>
        </label>

        <label>
          <span>{uiText.invoicing.cancelApprovedInvoiceReasonLabel}</span>
          <textarea
            maxLength={500}
            onChange={(event) =>
              setCancellationReason(event.currentTarget.value)
            }
            rows={4}
            value={cancellationReason}
          />
        </label>

        {errorMessage !== null ? (
          <MessageBanner variant="error">{errorMessage}</MessageBanner>
        ) : null}

        <div className={styles.actions}>
          <button
            className="ghost-button"
            disabled={isCancelling}
            onClick={onCancel}
            type="button"
          >
            {uiText.invoicing.cancel}
          </button>
          <button
            className={styles.dangerAction}
            disabled={!canConfirm || isCancelling}
            type="submit"
          >
            {isCancelling
              ? uiText.invoicing.cancellingApprovedInvoice
              : uiText.invoicing.confirmApprovedInvoiceCancellation}
          </button>
        </div>
      </form>
    </section>
  );
}

export function isInvoiceCancellationConfirmationValid(input: {
  cancellationReason: string;
  confirmationInvoiceNumber: string;
  invoiceNumber: string;
}): boolean {
  return (
    input.confirmationInvoiceNumber === input.invoiceNumber &&
    input.cancellationReason.trim().length > 0 &&
    input.cancellationReason.trim().length <= 500
  );
}
