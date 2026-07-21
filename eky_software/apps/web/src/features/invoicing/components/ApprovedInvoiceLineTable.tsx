import type {
  ApprovedInvoiceLine,
  ApprovedInvoiceView,
} from '@eky/api-client';

import {
  formatApprovedInvoiceCurrency,
  formatApprovedInvoiceDiscount,
  formatApprovedInvoicePercent,
  formatApprovedInvoiceQuantity,
  formatApprovedInvoiceUnit,
} from '../approved/approvedInvoiceFormatting.js';
import styles from './ApprovedInvoicePreview.module.css';
import { uiText } from '../../../i18n/fi.js';

interface ApprovedInvoiceLineTableProps {
  lines: ApprovedInvoiceLine[];
  priceInputMode: ApprovedInvoiceView['priceInputMode'];
}

export function ApprovedInvoiceLineTable({
  lines,
  priceInputMode,
}: ApprovedInvoiceLineTableProps): React.JSX.Element {
  const unitPriceLabel =
    priceInputMode === 'net'
      ? uiText.invoicing.priceInputNet
      : uiText.invoicing.priceInputGross;

  return (
    <section>
      <h3>{uiText.invoicing.invoiceRows}</h3>
      <div className={styles.lines} role="table">
        <div className={styles.lineHeader} role="row">
          <span role="columnheader">{uiText.invoicing.rowCode}</span>
          <span role="columnheader">{uiText.invoicing.rowDescription}</span>
          <span className={styles.number} role="columnheader">
            {uiText.invoicing.rowQuantity}
          </span>
          <span role="columnheader">{uiText.invoicing.rowUnit}</span>
          <span className={styles.number} role="columnheader">
            {unitPriceLabel}
          </span>
          <span className={styles.number} role="columnheader">
            {uiText.invoicing.rowVat}
          </span>
          <span className={styles.number} role="columnheader">
            {uiText.invoicing.rowDiscountType}
          </span>
          <span className={styles.number} role="columnheader">
            {uiText.invoicing.total}
          </span>
        </div>
        {lines.map((line) => (
          <ApprovedInvoiceLineRow
            key={line.id}
            line={line}
            priceInputMode={priceInputMode}
          />
        ))}
      </div>
    </section>
  );
}

function ApprovedInvoiceLineRow({
  line,
  priceInputMode,
}: {
  line: ApprovedInvoiceLine;
  priceInputMode: ApprovedInvoiceView['priceInputMode'];
}): React.JSX.Element {
  const discount = formatApprovedInvoiceDiscount(line.discount);
  const lineTotal =
    priceInputMode === 'net' ? line.netCents : line.grossCents;

  return (
    <div className={styles.lineRow} role="row">
      <span role="cell">{line.code}</span>
      <span role="cell">{line.description}</span>
      <span className={styles.number} role="cell">
        {formatApprovedInvoiceQuantity(line.quantityHundredths)}
      </span>
      <span role="cell">{formatApprovedInvoiceUnit(line.unit)}</span>
      <span className={styles.number} role="cell">
        {formatApprovedInvoiceCurrency(line.unitPriceCents)}
      </span>
      <span className={styles.number} role="cell">
        {formatApprovedInvoicePercent(line.vatRateBasisPoints)}
      </span>
      <span className={styles.number} role="cell">
        {discount ?? ''}
      </span>
      <span className={styles.number} role="cell">
        {formatApprovedInvoiceCurrency(lineTotal)}
      </span>
    </div>
  );
}
