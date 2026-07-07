import { useEffect, useState } from 'react';

import type {
  InvoiceDraftLineFormErrors,
} from '../form/invoiceDraftFormValidation.js';
import type {
  InvoiceRowForm,
  InvoiceRowFormField,
} from '../form/invoiceRowFormState.js';
import {
  customInvoiceUnitSelectValue,
  invoiceDiscountTypeOptions,
  invoiceUnitOptions,
  invoiceVatRateOptions,
  isKnownInvoiceUnit,
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
  const [isDiscountOpen, setIsDiscountOpen] = useState(
    row.discountType !== 'none' || errors?.discountValue !== undefined,
  );
  const discountValueDisabled = row.discountType === 'none';
  const isCustomUnit =
    row.unit === '' || !isKnownInvoiceUnit(row.unit);
  const selectedUnitValue = isCustomUnit
    ? customInvoiceUnitSelectValue
    : row.unit;

  useEffect(() => {
    if (row.discountType !== 'none' || errors?.discountValue !== undefined) {
      setIsDiscountOpen(true);
    }
  }, [errors?.discountValue, row.discountType]);

  return (
    <div className={styles.row}>
      <div className={styles.mainRow}>
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
            onFocus={() => {
              if (row.quantity === '0') {
                onChange(row.id, 'quantity', '');
              }
            }}
            onChange={(event) =>
              onChange(row.id, 'quantity', event.target.value)
            }
          />
          <InvoiceRowFieldError message={errors?.quantity} />
        </div>

        <div className={styles.field}>
          <select
            aria-invalid={errors?.unit === undefined ? undefined : true}
            aria-label={uiText.invoicing.rowUnit}
            name={`${row.id}-unit`}
            value={selectedUnitValue}
            onChange={(event) =>
              onChange(
                row.id,
                'unit',
                event.target.value === customInvoiceUnitSelectValue
                  ? ''
                  : event.target.value,
              )
            }
          >
            {invoiceUnitOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            <option value={customInvoiceUnitSelectValue}>
              {uiText.invoicing.unitCustom}
            </option>
          </select>
          {isCustomUnit ? (
            <input
              aria-invalid={errors?.unit === undefined ? undefined : true}
              aria-label={uiText.invoicing.rowCustomUnit}
              maxLength={8}
              name={`${row.id}-customUnit`}
              placeholder={uiText.invoicing.rowCustomUnitPlaceholder}
              type="text"
              value={row.unit}
              onChange={(event) =>
                onChange(row.id, 'unit', event.target.value)
              }
            />
          ) : null}
          <InvoiceRowFieldError message={errors?.unit} />
        </div>

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

        <div className={styles.actions}>
          <button
            aria-expanded={isDiscountOpen}
            aria-label={`${uiText.invoicing.toggleRowDiscount} ${position}`}
            className={styles.discountButton}
            title={uiText.invoicing.toggleRowDiscount}
            type="button"
            onClick={() => setIsDiscountOpen((isOpen) => !isOpen)}
          >
            %
          </button>
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
      </div>

      {isDiscountOpen ? (
        <div className={styles.discountPanel}>
          <label className={styles.discountField}>
            <span>{uiText.invoicing.rowDiscountType}</span>
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
          </label>
          <label className={styles.discountField}>
            <span>{uiText.invoicing.rowDiscountValue}</span>
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
          </label>
        </div>
      ) : null}
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
