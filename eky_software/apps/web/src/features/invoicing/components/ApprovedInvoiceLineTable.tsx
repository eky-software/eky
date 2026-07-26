import type {
  ApprovedInvoiceLine,
  ApprovedInvoiceView,
} from '@eky/api-client';

import {
  formatApprovedInvoiceDiscount,
  formatApprovedInvoicePercent,
  formatApprovedInvoicePresentedCurrency,
  formatApprovedInvoiceQuantity,
  formatApprovedInvoiceUnit,
} from '../approved/approvedInvoiceFormatting.js';
import styles from './ApprovedInvoicePreview.module.css';
import { uiText } from '../../../i18n/fi.js';

interface ApprovedInvoiceLineTableProps {
  invoiceKind: ApprovedInvoiceView['invoiceKind'];
  lines: ApprovedInvoiceLine[];
  priceInputMode: ApprovedInvoiceView['priceInputMode'];
  taxTreatment: ApprovedInvoiceView['taxTreatment'];
}

export function ApprovedInvoiceLineTable({
  invoiceKind,
  lines,
  priceInputMode,
  taxTreatment,
}: ApprovedInvoiceLineTableProps): React.JSX.Element {
  const unitPriceLabel =
    priceInputMode === 'net'
      ? uiText.invoicing.priceInputNet
      : uiText.invoicing.priceInputGross;

  return (
    <section>
      <h3>{uiText.invoicing.invoiceRows}</h3>
      <div className={styles.lines} role="table">
        <div
          className={`${styles.lineHeader} ${
            taxTreatment === 'reverseChargeConstruction'
              ? styles.lineWithoutVat
              : ''
          }`}
          role="row"
        >
          <span role="columnheader">{uiText.invoicing.rowCode}</span>
          <span role="columnheader">{uiText.invoicing.rowDescription}</span>
          <span className={styles.number} role="columnheader">
            {uiText.invoicing.rowQuantity}
          </span>
          <span role="columnheader">{uiText.invoicing.rowUnit}</span>
          <span className={styles.number} role="columnheader">
            {unitPriceLabel}
          </span>
          {taxTreatment === 'normalVat' ? (
            <span className={styles.number} role="columnheader">
              {uiText.invoicing.rowVat}
            </span>
          ) : null}
          <span className={styles.number} role="columnheader">
            {uiText.invoicing.rowDiscountType}
          </span>
          <span className={styles.number} role="columnheader">
            {uiText.invoicing.total}
          </span>
        </div>
        {lines.map((line) => (
          <ApprovedInvoiceLineRow
            invoiceKind={invoiceKind}
            key={line.id}
            line={line}
            priceInputMode={priceInputMode}
            showVat={taxTreatment === 'normalVat'}
          />
        ))}
      </div>
    </section>
  );
}

function ApprovedInvoiceLineRow({
  invoiceKind,
  line,
  priceInputMode,
  showVat,
}: {
  invoiceKind: ApprovedInvoiceView['invoiceKind'];
  line: ApprovedInvoiceLine;
  priceInputMode: ApprovedInvoiceView['priceInputMode'];
  showVat: boolean;
}): React.JSX.Element {
  const discount = formatApprovedInvoiceDiscount(line.discount);
  const lineTotal =
    priceInputMode === 'net' ? line.netCents : line.grossCents;

  return (
    <div
      className={`${styles.lineRow} ${
        showVat ? '' : styles.lineWithoutVat
      }`}
      role="row"
    >
      <span role="cell">{line.code}</span>
      <span role="cell">{line.description}</span>
      <span className={styles.number} role="cell">
        {formatApprovedInvoiceQuantity(line.quantityHundredths)}
      </span>
      <span role="cell">{formatApprovedInvoiceUnit(line.unit)}</span>
      <span className={styles.number} role="cell">
        {formatApprovedInvoicePresentedCurrency(
          line.unitPriceCents,
          invoiceKind,
        )}
      </span>
      {showVat && line.vatRateBasisPoints !== null ? (
        <span className={styles.number} role="cell">
          {formatApprovedInvoicePercent(line.vatRateBasisPoints)}
        </span>
      ) : null}
      <span className={styles.number} role="cell">
        {discount ?? ''}
      </span>
      <span className={styles.number} role="cell">
        {formatApprovedInvoicePresentedCurrency(lineTotal, invoiceKind)}
      </span>
    </div>
  );
}
