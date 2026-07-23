import type {
  ApprovedInvoiceVatBreakdown,
  ApprovedInvoiceView,
} from '@eky/api-client';

import {
  formatApprovedInvoicePercent,
  formatApprovedInvoicePresentedCurrency,
} from '../approved/approvedInvoiceFormatting.js';
import styles from './ApprovedInvoicePreview.module.css';
import { uiText } from '../../../i18n/fi.js';

interface ApprovedInvoiceTotalsProps {
  breakdown: ApprovedInvoiceVatBreakdown[];
  invoiceKind: ApprovedInvoiceView['invoiceKind'];
  totals: ApprovedInvoiceView['totals'];
}

export function ApprovedInvoiceTotals({
  breakdown,
  invoiceKind,
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
                {formatApprovedInvoicePresentedCurrency(
                  item.netCents,
                  invoiceKind,
                )}
              </span>
              <span className={styles.number} role="cell">
                {formatApprovedInvoicePresentedCurrency(
                  item.vatCents,
                  invoiceKind,
                )}
              </span>
              <strong className={styles.number} role="cell">
                {formatApprovedInvoicePresentedCurrency(
                  item.grossCents,
                  invoiceKind,
                )}
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
            <span>
              {formatApprovedInvoicePresentedCurrency(
                totals.netTotalCents,
                invoiceKind,
              )}
            </span>
          </div>
          <div>
            <span>{uiText.invoicing.vatTotal}</span>
            <span>
              {formatApprovedInvoicePresentedCurrency(
                totals.vatTotalCents,
                invoiceKind,
              )}
            </span>
          </div>
          <div className={styles.grandTotal}>
            <span>{uiText.invoicing.total}</span>
            <span>
              {formatApprovedInvoicePresentedCurrency(
                totals.grossTotalCents,
                invoiceKind,
              )}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
