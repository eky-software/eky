import type {
  ApprovedInvoiceView,
  InvoiceCreditContext,
} from '@eky/api-client';

import styles from './InvoiceCreditRelations.module.css';
import {
  formatApprovedInvoiceCurrency,
  formatApprovedInvoiceDate,
  formatApprovedInvoicePresentedCurrency,
} from '../approved/approvedInvoiceFormatting.js';
import { uiText } from '../../../i18n/fi.js';
import { MessageBanner } from '../../../shared/ui/index.js';

interface InvoiceCreditRelationsProps {
  context: InvoiceCreditContext | null;
  errorMessage: string | null;
  invoice: ApprovedInvoiceView;
  isLoading: boolean;
  onOpenDraft(id: string): void;
  onOpenInvoice(id: string): void;
}

export function InvoiceCreditRelations({
  context,
  errorMessage,
  invoice,
  isLoading,
  onOpenDraft,
  onOpenInvoice,
}: InvoiceCreditRelationsProps): React.JSX.Element | null {
  if (invoice.invoiceKind === 'credit') {
    if (
      invoice.creditedInvoiceId === null ||
      invoice.creditedInvoiceNumber === null
    ) {
      return null;
    }

    return (
      <section className={styles.relations}>
        <h3>{uiText.invoicing.creditRelations}</h3>
        <button
          className="secondary-action"
          onClick={() => onOpenInvoice(invoice.creditedInvoiceId!)}
          type="button"
        >
          {uiText.invoicing.openCreditedInvoice(
            invoice.creditedInvoiceNumber,
          )}
        </button>
      </section>
    );
  }

  if (invoice.status !== 'sent') {
    return null;
  }

  return (
    <section className={styles.relations}>
      <h3>{uiText.invoicing.creditRelations}</h3>
      {isLoading ? <p>{uiText.invoicing.creditContextLoading}</p> : null}
      {errorMessage !== null ? (
        <MessageBanner variant="error">{errorMessage}</MessageBanner>
      ) : null}
      {context !== null ? (
        <>
          <dl className={styles.summary}>
            <div>
              <dt>{uiText.invoicing.creditStatus}</dt>
              <dd>{getCreditStatusLabel(context.creditStatus)}</dd>
            </div>
            <div>
              <dt>{uiText.invoicing.remainingCreditableLabel}</dt>
              <dd>
                {formatApprovedInvoiceCurrency(
                  context.remainingCreditableGrossCents,
                )}
              </dd>
            </div>
          </dl>

          {context.activeCreditDraftId !== null ? (
            <button
              className="secondary-action"
              onClick={() => onOpenDraft(context.activeCreditDraftId!)}
              type="button"
            >
              {uiText.invoicing.openActiveCreditDraft}
            </button>
          ) : null}

          {context.creditInvoices.length > 0 ? (
            <div className={styles.invoiceList}>
              {context.creditInvoices.map((creditInvoice) => (
                <button
                  className={styles.invoiceLink}
                  key={creditInvoice.id}
                  onClick={() => onOpenInvoice(creditInvoice.id)}
                  type="button"
                >
                  <strong>
                    {uiText.invoicing.creditInvoice}{' '}
                    {creditInvoice.invoiceNumber}
                  </strong>
                  <span>
                    {formatApprovedInvoiceDate(creditInvoice.invoiceDate)}
                  </span>
                  <span>
                    {formatApprovedInvoicePresentedCurrency(
                      creditInvoice.grossTotalCents,
                      'credit',
                    )}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className={styles.muted}>
              {uiText.invoicing.noRelatedCreditInvoices}
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}

function getCreditStatusLabel(
  status: InvoiceCreditContext['creditStatus'],
): string {
  if (status === 'partial') {
    return uiText.invoicing.creditStatusPartial;
  }

  if (status === 'full') {
    return uiText.invoicing.creditStatusFull;
  }

  return uiText.invoicing.creditStatusNone;
}
