import type {
  InvoiceRowForm,
  InvoiceRowFormField,
} from '../invoiceRowFormState.js';
import {
  invoiceDiscountTypeOptions,
  invoiceUnitOptions,
  invoiceVatRateOptions,
} from '../invoiceRowOptions.js';
import { uiText } from '../../../i18n/fi.js';

interface InvoiceRowEditorProps {
  canRemove: boolean;
  position: number;
  row: InvoiceRowForm;
  onChange<FieldName extends InvoiceRowFormField>(
    rowId: string,
    fieldName: FieldName,
    value: InvoiceRowForm[FieldName],
  ): void;
  onRemove(rowId: string): void;
}

export function InvoiceRowEditor({
  canRemove,
  position,
  row,
  onChange,
  onRemove,
}: InvoiceRowEditorProps): React.JSX.Element {
  const discountValueDisabled = row.discountType === 'none';

  return (
    <div className="invoice-row-editor">
      <span className="invoice-row-position" aria-label={uiText.invoicing.row}>
        {position}
      </span>

      <input
        aria-label={uiText.invoicing.rowDescription}
        name={`${row.id}-description`}
        placeholder={uiText.invoicing.rowDescriptionPlaceholder}
        type="text"
        value={row.description}
        onChange={(event) =>
          onChange(row.id, 'description', event.target.value)
        }
      />

      <input
        aria-label={uiText.invoicing.rowQuantity}
        inputMode="decimal"
        name={`${row.id}-quantity`}
        type="text"
        value={row.quantity}
        onChange={(event) =>
          onChange(row.id, 'quantity', event.target.value)
        }
      />

      <select
        aria-label={uiText.invoicing.rowUnit}
        name={`${row.id}-unit`}
        value={row.unit}
        onChange={(event) =>
          onChange(row.id, 'unit', event.target.value as InvoiceRowForm['unit'])
        }
      >
        {invoiceUnitOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <input
        aria-label={uiText.invoicing.rowUnitPrice}
        inputMode="decimal"
        name={`${row.id}-unitPrice`}
        placeholder={uiText.invoicing.rowUnitPricePlaceholder}
        type="text"
        value={row.unitPrice}
        onChange={(event) =>
          onChange(row.id, 'unitPrice', event.target.value)
        }
      />

      <select
        aria-label={uiText.invoicing.rowVat}
        name={`${row.id}-vatRate`}
        value={row.vatRateBasisPoints}
        onChange={(event) =>
          onChange(
            row.id,
            'vatRateBasisPoints',
            Number(event.target.value),
          )
        }
      >
        {invoiceVatRateOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <select
        aria-label={uiText.invoicing.rowDiscountType}
        name={`${row.id}-discountType`}
        value={row.discountType}
        onChange={(event) =>
          onChange(
            row.id,
            'discountType',
            event.target.value as InvoiceRowForm['discountType'],
          )
        }
      >
        {invoiceDiscountTypeOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <input
        aria-label={uiText.invoicing.rowDiscountValue}
        disabled={discountValueDisabled}
        inputMode="decimal"
        name={`${row.id}-discountValue`}
        placeholder={
          discountValueDisabled
            ? ''
            : uiText.invoicing.rowDiscountValuePlaceholder
        }
        type="text"
        value={row.discountValue}
        onChange={(event) =>
          onChange(row.id, 'discountValue', event.target.value)
        }
      />

      <button
        aria-label={`${uiText.invoicing.removeRow} ${position}`}
        className="invoice-row-remove-button"
        disabled={!canRemove}
        title={
          canRemove
            ? uiText.invoicing.removeRow
            : uiText.invoicing.keepOneRow
        }
        type="button"
        onClick={() => onRemove(row.id)}
      >
        {uiText.invoicing.removeRow}
      </button>
    </div>
  );
}
