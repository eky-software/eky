import type { NewInvoiceFormState } from '../newInvoiceFormState.js';
import { uiText } from '../../../i18n/fi.js';

interface InvoiceBasicInfoSectionProps {
  form: NewInvoiceFormState;
  onFieldChange<FieldName extends keyof NewInvoiceFormState>(
    fieldName: FieldName,
    value: NewInvoiceFormState[FieldName],
  ): void;
}

export function InvoiceBasicInfoSection({
  form,
  onFieldChange,
}: InvoiceBasicInfoSectionProps): React.JSX.Element {
  return (
    <section className="invoice-form-section">
      <header className="invoice-form-section-header">
        <h3>{uiText.invoicing.basicInformation}</h3>
        <p>{uiText.invoicing.basicInformationHelp}</p>
      </header>

      <div className="invoice-basic-info-grid">
        <label className="invoice-field invoice-field-customer">
          <span>{uiText.invoicing.customer}</span>
          <select
            disabled
            name="customerId"
            value={form.customerId}
            onChange={(event) =>
              onFieldChange('customerId', event.target.value)
            }
          >
            <option value="">{uiText.invoicing.customerPlaceholder}</option>
          </select>
          <small>{uiText.invoicing.customerPlaceholderHelp}</small>
        </label>

        <label className="invoice-field">
          <span>{uiText.invoicing.invoiceDate}</span>
          <input
            name="invoiceDate"
            type="date"
            value={form.invoiceDate}
            onChange={(event) =>
              onFieldChange('invoiceDate', event.target.value)
            }
          />
        </label>

        <label className="invoice-field">
          <span>{uiText.invoicing.paymentTermDays}</span>
          <input
            inputMode="numeric"
            min="0"
            name="paymentTermDays"
            step="1"
            type="number"
            value={form.paymentTermDays}
            onChange={(event) =>
              onFieldChange('paymentTermDays', event.target.value)
            }
          />
        </label>

        <label className="invoice-field">
          <span>{uiText.invoicing.dueDate}</span>
          <input
            name="dueDate"
            type="date"
            value={form.dueDate}
            onChange={(event) =>
              onFieldChange('dueDate', event.target.value)
            }
          />
        </label>

        <label className="invoice-field invoice-field-wide">
          <span>{uiText.invoicing.subject}</span>
          <input
            name="subject"
            placeholder={uiText.invoicing.subjectPlaceholder}
            type="text"
            value={form.subject}
            onChange={(event) =>
              onFieldChange('subject', event.target.value)
            }
          />
        </label>

        <label className="invoice-field">
          <span>{uiText.invoicing.orderNumber}</span>
          <input
            name="orderNumber"
            placeholder={uiText.invoicing.orderNumberPlaceholder}
            type="text"
            value={form.orderNumber}
            onChange={(event) =>
              onFieldChange('orderNumber', event.target.value)
            }
          />
        </label>

        <fieldset className="invoice-price-mode">
          <legend>{uiText.invoicing.priceInputMode}</legend>
          <div className="segmented-control">
            <label>
              <input
                checked={form.priceInputMode === 'net'}
                name="priceInputMode"
                type="radio"
                value="net"
                onChange={() => onFieldChange('priceInputMode', 'net')}
              />
              <span>{uiText.invoicing.priceInputNet}</span>
            </label>
            <label>
              <input
                checked={form.priceInputMode === 'gross'}
                name="priceInputMode"
                type="radio"
                value="gross"
                onChange={() => onFieldChange('priceInputMode', 'gross')}
              />
              <span>{uiText.invoicing.priceInputGross}</span>
            </label>
          </div>
        </fieldset>

        <label className="invoice-field invoice-field-wide">
          <span>{uiText.invoicing.note}</span>
          <textarea
            name="note"
            placeholder={uiText.invoicing.notePlaceholder}
            value={form.note}
            onChange={(event) => onFieldChange('note', event.target.value)}
          />
        </label>
      </div>
    </section>
  );
}
