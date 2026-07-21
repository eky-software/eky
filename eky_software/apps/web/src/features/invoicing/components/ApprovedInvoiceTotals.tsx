import type {
  ApprovedInvoiceVatBreakdown,
  ApprovedInvoiceView,
} from '@eky/api-client';

import {
  formatApprovedInvoiceCurrency,
  formatApprovedInvoicePercent,
} from '../approved/approvedInvoiceFormatting.js';
import styles from './ApprovedInvoicePreview.module.css';
import { uiText } from '../../../i18n/fi.js';

interface ApprovedInvoiceTotalsProps {
  breakdown: ApprovedInvoiceVatBreakdown[];
  totals: ApprovedInvoiceView['totals'];
}

export function ApprovedInvoiceTotals({
  breakdown,
  totals,
}: ApprovedInvoiceTotalsProps): React.JSX.Element {
  return (
    <div className={styles.totalsGrid}>
      <section className={styles.box}>
        <h3>{uiText.invoicing.vatBreakdown}</h3>
        <div className={styles.vatTable} role="table">
          <div className={styles.vatHeader} role="row">
            <span role="columnheader">{uiText.invoicing.rowVat}</span>
            <span className={styles.number} role="columnheader">
              {uiText.invoicing.netAmount}
            </span>
            <span className={styles.number} role="columnheader">
              {uiText.invoicing.vatAmount}
            </span>
            <span className={styles.number} role="columnheader">
              {uiText.invoicing.grossTotal}
            </span>
          </div>
          {breakdown.map((item) => (
            <div
              className={styles.vatRow}
              key={item.vatRateBasisPoints}
              role="row"
            >
              <span role="cell">
                {formatApprovedInvoicePercent(item.vatRateBasisPoints)}
              </span>
              <span className={styles.number} role="cell">
                {formatApprovedInvoiceCurrency(item.netCents)}
              </span>
              <span className={styles.number} role="cell">
                {formatApprovedInvoiceCurrency(item.vatCents)}
              </span>
              <strong className={styles.number} role="cell">
                {formatApprovedInvoiceCurrency(item.grossCents)}
              </strong>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.box}>
        <h3>{uiText.invoicing.invoiceTotals}</h3>
        <div className={styles.totalsTable}>
          <div>
            <span>{uiText.invoicing.netTotal}</span>
            <span>{formatApprovedInvoiceCurrency(totals.netTotalCents)}</span>
          </div>
          <div>
            <span>{uiText.invoicing.vatTotal}</span>
            <span>{formatApprovedInvoiceCurrency(totals.vatTotalCents)}</span>
          </div>
          <div className={styles.grandTotal}>
            <span>{uiText.invoicing.total}</span>
            <span>{formatApprovedInvoiceCurrency(totals.grossTotalCents)}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
