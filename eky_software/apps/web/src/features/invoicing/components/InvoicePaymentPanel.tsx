import type {
  ApprovedInvoiceView,
  InvoiceCreditContext,
} from '@eky/api-client';
import { useEffect, useState } from 'react';

import { getHelsinkiPaymentDate } from '../approved/invoicePaymentForm.js';
import {
  formatApprovedInvoiceCurrency,
  formatApprovedInvoiceDate,
} from '../approved/approvedInvoiceFormatting.js';
import styles from './InvoicePaymentPanel.module.css';
import { uiText } from '../../../i18n/fi.js';
import { MessageBanner } from '../../../shared/ui/index.js';

interface InvoicePaymentPanelProps {
  creditContext: InvoiceCreditContext | null;
  creditContextErrorMessage: string | null;
  invoice: ApprovedInvoiceView;
  isLoadingCreditContext: boolean;
  isUpdating: boolean;
  mutationErrorMessage: string | null;
  mutationSuccessMessage: string | null;
  onMarkPaid(invoiceId: string, paidOn: string): void;
  onRevertPaidMark(invoiceId: string): void;
}

type ConfirmationMode = 'markPaid' | 'revert' | null;

export function InvoicePaymentPanel({
  creditContext,
  creditContextErrorMessage,
  invoice,
  isLoadingCreditContext,
  isUpdating,
  mutationErrorMessage,
  mutationSuccessMessage,
  onMarkPaid,
  onRevertPaidMark,
}: InvoicePaymentPanelProps): React.JSX.Element | null {
  const [confirmationMode, setConfirmationMode] =
    useState<ConfirmationMode>(null);
  const [paidOn, setPaidOn] = useState(getHelsinkiPaymentDate);

  useEffect(() => {
    setConfirmationMode(null);
    setPaidOn(getHelsinkiPaymentDate());
  }, [invoice.id, invoice.paymentState]);

  if (invoice.invoiceKind !== 'standard' || invoice.status !== 'sent') {
    return null;
  }

  const isPaid = invoice.paymentState === 'paid';
  const remainingAmount = creditContext?.remainingCreditableGrossCents ?? null;
  const canMarkPaid =
    !isPaid &&
    remainingAmount !== null &&
    remainingAmount > 0 &&
    creditContextErrorMessage === null;

  function handleMarkSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!canMarkPaid || paidOn.length === 0 || isUpdating) {
      return;
    }

    onMarkPaid(invoice.id, paidOn);
  }

  function handleRevertSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!isPaid || isUpdating) {
      return;
    }

    onRevertPaidMark(invoice.id);
  }

  return (
    <section
      aria-labelledby="invoice-payment-heading"
      className={styles.panel}
    >
      <div className={styles.header}>
        <div>
          <h3 id="invoice-payment-heading">
            {uiText.invoicing.invoicePaymentTitle}
          </h3>
          <span className="status-pill status-pill-active">
            {isPaid
              ? uiText.invoicing.invoicePaymentPaid
              : uiText.invoicing.invoicePaymentUnpaid}
          </span>
        </div>
        {isPaid ? (
          <button
            className="secondary-action"
            disabled={isUpdating}
            onClick={() => setConfirmationMode('revert')}
            type="button"
          >
            {uiText.invoicing.revertInvoicePaymentMark}
          </button>
        ) : (
          <button
            className="primary-action"
            disabled={!canMarkPaid || isUpdating}
            onClick={() => setConfirmationMode('markPaid')}
            type="button"
          >
            {uiText.invoicing.markInvoicePaid}
          </button>
        )}
      </div>

      {isLoadingCreditContext && !isPaid ? (
        <p className={styles.muted}>
          {uiText.invoicing.invoicePaymentEligibilityLoading}
        </p>
      ) : null}
      {creditContextErrorMessage !== null && !isPaid ? (
        <MessageBanner variant="error">
          {creditContextErrorMessage}
        </MessageBanner>
      ) : null}

      <dl className={styles.summary}>
        {isPaid && invoice.paidOn !== null ? (
          <div>
            <dt>{uiText.invoicing.invoicePaymentDate}</dt>
            <dd>{formatApprovedInvoiceDate(invoice.paidOn)}</dd>
          </div>
        ) : null}
        {isPaid && invoice.paidAmountCents !== null ? (
          <div>
            <dt>{uiText.invoicing.invoicePaymentAmount}</dt>
            <dd>{formatApprovedInvoiceCurrency(invoice.paidAmountCents)}</dd>
          </div>
        ) : remainingAmount !== null ? (
          <div>
            <dt>{uiText.invoicing.invoicePaymentRemainingAmount}</dt>
            <dd>{formatApprovedInvoiceCurrency(remainingAmount)}</dd>
          </div>
        ) : null}
        {isPaid ? (
          <div>
            <dt>{uiText.invoicing.invoicePaymentSource}</dt>
            <dd>{uiText.invoicing.invoicePaymentSourceManual}</dd>
          </div>
        ) : null}
      </dl>

      {confirmationMode === 'markPaid' ? (
        <form className={styles.form} onSubmit={handleMarkSubmit}>
          <p>{uiText.invoicing.markInvoicePaidConfirmation}</p>
          <strong>
            {uiText.invoicing.invoiceNumber} {invoice.invoiceNumber}
          </strong>
          <label>
            <span>{uiText.invoicing.invoicePaymentDate}</span>
            <input
              max="9999-12-31"
              min="1900-01-01"
              onChange={(event) => setPaidOn(event.currentTarget.value)}
              required
              type="date"
              value={paidOn}
            />
          </label>
          <div className={styles.actions}>
            <button
              className="ghost-button"
              disabled={isUpdating}
              onClick={() => setConfirmationMode(null)}
              type="button"
            >
              {uiText.invoicing.cancel}
            </button>
            <button
              className="primary-action"
              disabled={!canMarkPaid || paidOn.length === 0 || isUpdating}
              type="submit"
            >
              {isUpdating
                ? uiText.invoicing.updatingInvoicePayment
                : uiText.invoicing.confirmInvoicePaid}
            </button>
          </div>
        </form>
      ) : null}

      {confirmationMode === 'revert' ? (
        <form className={styles.form} onSubmit={handleRevertSubmit}>
          <p>{uiText.invoicing.revertInvoicePaymentConfirmation}</p>
          <div className={styles.actions}>
            <button
              className="ghost-button"
              disabled={isUpdating}
              onClick={() => setConfirmationMode(null)}
              type="button"
            >
              {uiText.invoicing.cancel}
            </button>
            <button
              className="secondary-action"
              disabled={isUpdating}
              type="submit"
            >
              {isUpdating
                ? uiText.invoicing.updatingInvoicePayment
                : uiText.invoicing.confirmRevertInvoicePayment}
            </button>
          </div>
        </form>
      ) : null}

      {mutationErrorMessage !== null ? (
        <MessageBanner variant="error">{mutationErrorMessage}</MessageBanner>
      ) : null}
      {mutationSuccessMessage !== null ? (
        <MessageBanner variant="success">
          {mutationSuccessMessage}
        </MessageBanner>
      ) : null}
    </section>
  );
}
