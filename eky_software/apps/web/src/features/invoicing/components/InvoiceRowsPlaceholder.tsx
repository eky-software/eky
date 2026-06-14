import { uiText } from '../../../i18n/fi.js';

export function InvoiceRowsPlaceholder(): React.JSX.Element {
  return (
    <section className="invoice-form-section invoice-rows-section">
      <header className="invoice-form-section-header">
        <h3>{uiText.invoicing.invoiceRows}</h3>
      </header>

      <div className="invoice-rows-placeholder">
        <div className="invoice-rows-placeholder-head" aria-hidden="true">
          <span>{uiText.invoicing.rowDescription}</span>
          <span>{uiText.invoicing.rowQuantity}</span>
          <span>{uiText.invoicing.rowUnit}</span>
          <span>{uiText.invoicing.rowUnitPrice}</span>
          <span>{uiText.invoicing.rowVat}</span>
          <span>{uiText.invoicing.rowTotal}</span>
        </div>
        <p>{uiText.invoicing.invoiceRowsLater}</p>
      </div>
    </section>
  );
}
