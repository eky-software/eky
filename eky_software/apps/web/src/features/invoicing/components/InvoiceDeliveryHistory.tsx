import type { InvoiceDeliveryEventSummary } from '@eky/api-client';

import { InvoiceDeliveryPdfAction } from './InvoiceDeliveryPdfAction.js';
import type { OpenInvoiceDeliveryEventPdf } from '../approved/openInvoiceDeliveryEventPdf.js';
import styles from './InvoiceDeliveryHistory.module.css';
import { uiText } from '../../../i18n/fi.js';
import { formatFinnishDateTime } from '../../../shared/date/formatFinnishDateTime.js';

interface InvoiceDeliveryHistoryProps {
  invoiceId: string | null;
  errorMessage: string | null;
  events: InvoiceDeliveryEventSummary[];
  isLoading: boolean;
  onOpenPdf: OpenInvoiceDeliveryEventPdf;
}

export function InvoiceDeliveryHistory({
  invoiceId,
  errorMessage,
  events,
  isLoading,
  onOpenPdf,
}: InvoiceDeliveryHistoryProps): React.JSX.Element {
  return (
    <section
      aria-label={uiText.invoicing.invoiceDeliveryHistory}
      className={styles.history}
    >
      <h3>{uiText.invoicing.invoiceDeliveryHistory}</h3>
      {isLoading ? (
        <p className={styles.state}>
          {uiText.invoicing.invoiceDeliveryHistoryLoading}
        </p>
      ) : errorMessage !== null ? (
        <p className="message error-message" role="alert">
          {errorMessage}
        </p>
      ) : events.length === 0 ? (
        <p className={styles.state}>
          {uiText.invoicing.invoiceDeliveryHistoryEmpty}
        </p>
      ) : (
        <div className={styles.table} role="table">
          <div className={styles.header} role="row">
            <span role="columnheader">{uiText.invoicing.invoiceDeliveryTime}</span>
            <span role="columnheader">{uiText.invoicing.invoiceDeliveryMethod}</span>
            <span role="columnheader">{uiText.invoicing.invoiceDeliveryProvider}</span>
            <span role="columnheader">{uiText.invoicing.invoiceEmailTo}</span>
            <span role="columnheader">{uiText.invoicing.invoiceEmailCc}</span>
            <span role="columnheader">{uiText.invoicing.status}</span>
            <span role="columnheader">{uiText.invoicing.invoiceDeliveryPdf}</span>
          </div>
          {events.map((event) => (
            <div className={styles.row} key={`${invoiceId}:${event.id}`} role="row">
              <span role="cell">{formatDeliveryTime(event.createdAt)}</span>
              <span role="cell">
                {deliveryMethodLabel(event.deliveryMethod)}
              </span>
              <span role="cell">
                {deliveryProviderLabel(event.provider)}
                <small className={styles.detail}>
                  {uiText.invoicing.invoiceDeliveryModes[event.sendMode]}
                </small>
              </span>
              <span role="cell">
                {event.recipientEmail || uiText.invoicing.notApplicable}
              </span>
              <span role="cell">
                {event.ccEmail || uiText.invoicing.notApplicable}
              </span>
              <span role="cell">
                {deliveryStatusLabel(event.status)}
                {event.safeErrorMessage === null ? null : (
                  <small className={styles.error}>
                    {deliveryErrorLabel(event.status)}
                  </small>
                )}
              </span>
              <span role="cell">
                <small className={styles.detail}>
                  {uiText.invoicing.invoiceDeliveryDocumentSources[event.documentSource]}
                </small>
                {invoiceId === null || event.documentSource === 'legacyMissingDocument' ? null : (
                  <InvoiceDeliveryPdfAction
                    invoiceId={invoiceId}
                    eventId={event.id}
                    onOpen={onOpenPdf}
                  />
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function formatDeliveryTime(value: string): string {
  return formatFinnishDateTime(value) ?? value;
}

function deliveryMethodLabel(
  method: InvoiceDeliveryEventSummary['deliveryMethod'],
): string {
  return uiText.invoicing.invoiceDeliveryMethods[method];
}

function deliveryProviderLabel(
  provider: InvoiceDeliveryEventSummary['provider'],
): string {
  return uiText.invoicing.invoiceDeliveryProviders[provider];
}

function deliveryStatusLabel(
  status: InvoiceDeliveryEventSummary['status'],
): string {
  return uiText.invoicing.invoiceDeliveryStatuses[status];
}

function deliveryErrorLabel(
  status: InvoiceDeliveryEventSummary['status'],
): string {
  return status === 'outcomeUnknown'
    ? uiText.invoicing.invoiceDeliveryHistoryOutcomeUnknown
    : uiText.invoicing.invoiceDeliveryHistoryFailure;
}
