import { formatInvoiceDraftCurrency } from '../drafts/invoiceDraftFormatting.js';
import {
  calculateInvoiceDraftPreviewTotals,
  type InvoiceDraftPreviewTotals as InvoiceDraftPreviewTotalsResult,
} from '../preview/invoiceDraftPreviewTotals.js';
import type { NewInvoiceFormState } from '../form/newInvoiceFormState.js';
import styles from './InvoiceTotalsPreview.module.css';
import { uiText } from '../../../i18n/fi.js';

interface InvoiceTotalsPreviewProps {
  form: NewInvoiceFormState;
}

export function InvoiceTotalsPreview({
  form,
}: InvoiceTotalsPreviewProps): React.JSX.Element {
  const totals = calculateInvoiceDraftPreviewTotals(form);

  return (
    <section className={styles.container}>
      <div>
        <h3>{uiText.invoicing.invoiceTotals}</h3>
        <p>{uiText.invoicing.invoiceTotalsPreviewHelp}</p>
      </div>

      {totals.isAvailable ? (
        <InvoiceTotalsPreviewValues totals={totals} />
      ) : (
        <p className={styles.unavailable} role="status">
          {uiText.invoicing.invoiceTotalsUnavailable}
        </p>
      )}
    </section>
  );
}

function InvoiceTotalsPreviewValues({
  totals,
}: {
  totals: Extract<InvoiceDraftPreviewTotalsResult, { isAvailable: true }>;
}): React.JSX.Element {
  return (
    <div className={styles.grid}>
      <dl aria-label={uiText.invoicing.invoiceTotals}>
        <div>
          <dt>{uiText.invoicing.netTotal}</dt>
          <dd>{formatInvoiceDraftCurrency(totals.netTotalCents)}</dd>
        </div>
        <div>
          <dt>{uiText.invoicing.vatTotal}</dt>
          <dd>{formatInvoiceDraftCurrency(totals.vatTotalCents)}</dd>
        </div>
        <div className={styles.grandTotal}>
          <dt>{uiText.invoicing.total}</dt>
          <dd>{formatInvoiceDraftCurrency(totals.grossTotalCents)}</dd>
        </div>
      </dl>

      {totals.vatBreakdown.length > 0 ? (
        <dl
          aria-label={uiText.invoicing.vatBreakdown}
          className={styles.vatBreakdown}
        >
          {totals.vatBreakdown.map((breakdown) => (
            <div key={breakdown.vatRateBasisPoints}>
              <dt>
                {uiText.invoicing.vatRate}{' '}
                {formatVatRate(breakdown.vatRateBasisPoints)}
              </dt>
              <dd>{formatInvoiceDraftCurrency(breakdown.vatCents)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function formatVatRate(vatRateBasisPoints: number): string {
  const wholePart = Math.trunc(vatRateBasisPoints / 100);
  const decimalPart = vatRateBasisPoints % 100;

  if (decimalPart === 0) {
    return `${wholePart} %`;
  }

  return `${wholePart},${String(decimalPart).padStart(2, '0')} %`;
}
