import type { CreditInvoiceDraftLineForm } from '../form/creditInvoiceDraftForm.js';
import {
  formatApprovedInvoiceCurrency,
  formatApprovedInvoiceDiscount,
  formatApprovedInvoicePercent,
  formatApprovedInvoiceQuantity,
  formatApprovedInvoiceUnit,
} from '../approved/approvedInvoiceFormatting.js';
import { invoiceUnitOptions } from '../form/invoiceRowOptions.js';
import { parseEuroCents } from '../form/invoiceDraftFormMapping.js';
import { uiText } from '../../../i18n/fi.js';
import styles from './CreditInvoiceDraftEditorView.module.css';

interface CreditInvoiceDraftLineEditorProps {
  index: number;
  line: CreditInvoiceDraftLineForm;
  showVat: boolean;
  availableVatRates: readonly number[];
  onChange(line: CreditInvoiceDraftLineForm): void;
  onRemove(): void;
}

export function CreditInvoiceDraftLineEditor({
  index,
  line,
  showVat,
  availableVatRates,
  onChange,
  onRemove,
}: CreditInvoiceDraftLineEditorProps): React.JSX.Element {
  const isSourceLine = line.lineType === 'source';

  return (
    <fieldset className={styles.line}>
      <legend>
        {isSourceLine
          ? `${uiText.invoicing.row} ${index + 1}`
          : uiText.invoicing.creditDraftManualLine}
      </legend>

      {isSourceLine ? (
        <label className={styles.include}>
          <input
            checked={line.isIncluded}
            onChange={(event) => {
              const isIncluded = event.currentTarget.checked;
              onChange({
                ...line,
                isIncluded,
                quantity:
                  isIncluded && line.quantity === '0,00'
                    ? formatApprovedInvoiceQuantity(
                        line.maximumQuantityHundredths,
                      )
                    : line.quantity,
              });
            }}
            type="checkbox"
          />
          <span>{uiText.invoicing.creditDraftIncludeLine}</span>
        </label>
      ) : (
        <button
          className={`ghost-button ${styles.removeManualLine}`}
          onClick={onRemove}
          type="button"
        >
          {uiText.invoicing.creditDraftRemoveManualLine}
        </button>
      )}

      <label className={styles.description}>
        <span>{uiText.invoicing.rowDescription}</span>
        <input
          disabled={isSourceLine && !line.isIncluded}
          maxLength={5_000}
          onChange={(event) =>
            onChange({ ...line, description: event.currentTarget.value })
          }
          type="text"
          value={line.description}
        />
      </label>

      <label>
        <span>{uiText.invoicing.creditDraftQuantity}</span>
        <input
          disabled={isSourceLine && !line.isIncluded}
          inputMode="decimal"
          onChange={(event) =>
            onChange({ ...line, quantity: event.currentTarget.value })
          }
          type="text"
          value={line.quantity}
        />
        {isSourceLine ? (
          <small>
            {uiText.invoicing.creditDraftMaximumQuantity(
              formatApprovedInvoiceQuantity(
                line.maximumQuantityHundredths,
              ),
              formatApprovedInvoiceUnit(line.unit),
            )}
          </small>
        ) : null}
      </label>

      {isSourceLine ? (
        <>
          <ReadonlyValue
            label={uiText.invoicing.rowUnit}
            value={formatApprovedInvoiceUnit(line.unit)}
          />
          <ReadonlyValue
            label={uiText.invoicing.rowUnitPrice}
            value={formatApprovedInvoiceCurrencyInput(line.unitPrice)}
          />
          {showVat && line.vatRateBasisPoints !== null ? (
            <ReadonlyValue
              label={uiText.invoicing.rowVat}
              value={formatApprovedInvoicePercent(
                line.vatRateBasisPoints,
              )}
            />
          ) : null}
          <ReadonlyValue
            label={uiText.invoicing.rowDiscountType}
            value={
              formatApprovedInvoiceDiscount(line.discount) ??
              uiText.invoicing.discountNone
            }
          />
        </>
      ) : (
        <>
          <label>
            <span>{uiText.invoicing.rowUnit}</span>
            <input
              list="credit-invoice-unit-options"
              maxLength={8}
              onChange={(event) =>
                onChange({ ...line, unit: event.currentTarget.value })
              }
              type="text"
              value={line.unit}
            />
          </label>
          <label>
            <span>{uiText.invoicing.rowUnitPrice}</span>
            <input
              inputMode="decimal"
              onChange={(event) =>
                onChange({ ...line, unitPrice: event.currentTarget.value })
              }
              type="text"
              value={line.unitPrice}
            />
          </label>
          {showVat ? (
            <label>
              <span>{uiText.invoicing.rowVat}</span>
              <select
                onChange={(event) =>
                  onChange({
                    ...line,
                    vatRateBasisPoints: Number(event.currentTarget.value),
                  })
                }
                value={line.vatRateBasisPoints ?? ''}
              >
                {availableVatRates.map((vatRate) => (
                  <option key={vatRate} value={vatRate}>
                    {formatApprovedInvoicePercent(vatRate)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <ReadonlyValue
            label={uiText.invoicing.rowDiscountType}
            value={uiText.invoicing.discountNone}
          />
        </>
      )}

      <ReadonlyValue
        label={uiText.invoicing.creditDraftSavedLineTotal}
        value={formatCreditCurrency(line.savedGrossCents)}
      />
    </fieldset>
  );
}

export function CreditInvoiceUnitOptions(): React.JSX.Element {
  return (
    <datalist id="credit-invoice-unit-options">
      {invoiceUnitOptions.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </datalist>
  );
}

function ReadonlyValue({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div aria-readonly="true" className={styles.readonlyValue}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatApprovedInvoiceCurrencyInput(value: string): string {
  const cents = parseEuroCents(value);
  return cents !== null
    ? formatApprovedInvoiceCurrency(cents)
    : value;
}

function formatCreditCurrency(cents: number): string {
  return formatApprovedInvoiceCurrency(cents === 0 ? 0 : -cents);
}
