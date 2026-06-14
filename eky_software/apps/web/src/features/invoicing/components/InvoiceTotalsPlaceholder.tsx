import { uiText } from '../../../i18n/fi.js';

export function InvoiceTotalsPlaceholder(): React.JSX.Element {
  return (
    <section className="invoice-totals-placeholder">
      <div>
        <h3>{uiText.invoicing.invoiceTotals}</h3>
        <p>{uiText.invoicing.invoiceTotalsLater}</p>
      </div>
      <dl aria-label={uiText.invoicing.invoiceTotals}>
        <div>
          <dt>{uiText.invoicing.netTotal}</dt>
          <dd>–</dd>
        </div>
        <div>
          <dt>{uiText.invoicing.vatTotal}</dt>
          <dd>–</dd>
        </div>
        <div className="invoice-grand-total">
          <dt>{uiText.invoicing.total}</dt>
          <dd>–</dd>
        </div>
      </dl>
    </section>
  );
}
