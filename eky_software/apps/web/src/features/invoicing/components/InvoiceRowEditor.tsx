import type {
  InvoiceDraftLineFormErrors,
} from '../form/invoiceDraftFormValidation.js';
import type {
  InvoiceRowForm,
  InvoiceRowFormField,
} from '../form/invoiceRowFormState.js';
import {
  invoiceDiscountTypeOptions,
  invoiceUnitOptions,
  invoiceVatRateOptions,
} from '../form/invoiceRowOptions.js';
import styles from './InvoiceRowEditor.module.css';
import { uiText } from '../../../i18n/fi.js';

interface InvoiceRowEditorProps {
  canRemove: boolean;
  errors: InvoiceDraftLineFormErrors | undefined;
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
  errors,
  position,
  row,
  onChange,
  onRemove,
}: InvoiceRowEditorProps): React.JSX.Element {
  const discountValueDisabled = row.discountType === 'none';

  return (
    <div className={styles.row}>
      <span className={styles.position} aria-label={uiText.invoicing.row}>
        {position}
      </span>

      <div className={styles.field}>
        <input
          aria-invalid={errors?.description === undefined ? undefined : true}
          aria-label={uiText.invoicing.rowDescription}
          name={`${row.id}-description`}
          placeholder={uiText.invoicing.rowDescriptionPlaceholder}
          type="text"
          value={row.description}
          onChange={(event) =>
            onChange(row.id, 'description', event.target.value)
          }
        />
        <InvoiceRowFieldError message={errors?.description} />
      </div>

      <div className={styles.field}>
        <input
          aria-invalid={errors?.quantity === undefined ? undefined : true}
          aria-label={uiText.invoicing.rowQuantity}
          inputMode="decimal"
          name={`${row.id}-quantity`}
          type="text"
          value={row.quantity}
          onChange={(event) =>
            onChange(row.id, 'quantity', event.target.value)
          }
        />
        <InvoiceRowFieldError message={errors?.quantity} />
      </div>

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

      <div className={styles.field}>
        <input
          aria-invalid={errors?.unitPrice === undefined ? undefined : true}
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
        <InvoiceRowFieldError message={errors?.unitPrice} />
      </div>

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

      <div className={styles.field}>
        <input
          aria-invalid={
            errors?.discountValue === undefined ? undefined : true
          }
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
        <InvoiceRowFieldError message={errors?.discountValue} />
      </div>

      <button
        aria-label={`${uiText.invoicing.removeRow} ${position}`}
        className={styles.removeButton}
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

function InvoiceRowFieldError({
  message,
}: {
  message: string | undefined;
}): React.JSX.Element | null {
  return message ? (
    <small className={styles.fieldError} role="alert">
      {message}
    </small>
  ) : null;
}
