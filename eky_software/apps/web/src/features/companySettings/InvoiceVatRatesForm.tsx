import type { InvoiceVatRatesView } from '@eky/api-client';

import type {
  InvoiceVatRateFormRow,
  InvoiceVatRatesValidationErrors,
} from './invoiceVatRatesFormModel.js';
import styles from './InvoiceVatRatesForm.module.css';
import { uiText } from '../../i18n/fi.js';

interface InvoiceVatRatesFormProps {
  errorMessage: string | null;
  isSaving: boolean;
  rows: InvoiceVatRateFormRow[];
  settings: InvoiceVatRatesView | null;
  successMessage: string | null;
  validationErrors: InvoiceVatRatesValidationErrors;
  onAdd(): void;
  onChange(
    id: string,
    field: keyof Omit<InvoiceVatRateFormRow, 'id'>,
    value: string | boolean,
  ): void;
  onRemove(id: string): void;
  onSubmit(): void;
}

export function InvoiceVatRatesForm({
  errorMessage,
  isSaving,
  rows,
  settings,
  successMessage,
  validationErrors,
  onAdd,
  onChange,
  onRemove,
  onSubmit,
}: InvoiceVatRatesFormProps): React.JSX.Element {
  return (
    <section className={`panel ${styles.panel}`}>
      <div className="panel-header">
        <div>
          <p className="panel-kicker">
            {uiText.companySettings.invoiceVatRatesKicker}
          </p>
          <h2>{uiText.companySettings.invoiceVatRatesHeading}</h2>
        </div>
        <button
          className="ghost-button"
          disabled={isSaving || rows.length >= 20}
          onClick={onAdd}
          type="button"
        >
          {uiText.companySettings.invoiceVatRatesAdd}
        </button>
      </div>
      <p className="panel-description">
        {uiText.companySettings.invoiceVatRatesDescription}
      </p>
      {settings !== null && !settings.isPersisted ? (
        <p className="message">{uiText.companySettings.invoiceVatRatesDefaultInfo}</p>
      ) : null}
      {successMessage ? (
        <p className="message success-message">{successMessage}</p>
      ) : null}
      {errorMessage ? (
        <p className="message error-message">{errorMessage}</p>
      ) : null}
      {validationErrors.form ? (
        <p className="message error-message">{validationErrors.form}</p>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <fieldset className={styles.fieldset} disabled={isSaving}>
          <legend>{uiText.companySettings.invoiceVatRatesSettings}</legend>
          <div className={styles.header} aria-hidden="true">
            <span>{uiText.companySettings.invoiceVatRatePercent}</span>
            <span>{uiText.companySettings.invoiceVatRateLabel}</span>
            <span>{uiText.companySettings.invoiceVatRateActive}</span>
            <span>{uiText.companySettings.invoiceVatRateDefault}</span>
            <span>{uiText.companySettings.invoiceVatRateActions}</span>
          </div>
          {rows.map((row) => (
            <div className={styles.row} key={row.id}>
              <label>
                <span className={styles.mobileLabel}>
                  {uiText.companySettings.invoiceVatRatePercent}
                </span>
                <input
                  aria-invalid={
                    validationErrors.rows[row.id]?.ratePercent
                      ? true
                      : undefined
                  }
                  inputMode="decimal"
                  onChange={(event) =>
                    onChange(row.id, 'ratePercent', event.target.value)
                  }
                  value={row.ratePercent}
                />
                {validationErrors.rows[row.id]?.ratePercent ? (
                  <small>{validationErrors.rows[row.id]?.ratePercent}</small>
                ) : null}
              </label>
              <label>
                <span className={styles.mobileLabel}>
                  {uiText.companySettings.invoiceVatRateLabel}
                </span>
                <input
                  aria-invalid={
                    validationErrors.rows[row.id]?.label ? true : undefined
                  }
                  maxLength={50}
                  onChange={(event) =>
                    onChange(row.id, 'label', event.target.value)
                  }
                  value={row.label}
                />
                {validationErrors.rows[row.id]?.label ? (
                  <small>{validationErrors.rows[row.id]?.label}</small>
                ) : null}
              </label>
              <label className={styles.checkField}>
                <input
                  checked={row.isActive}
                  onChange={(event) =>
                    onChange(row.id, 'isActive', event.target.checked)
                  }
                  type="checkbox"
                />
                <span>{uiText.companySettings.invoiceVatRateActive}</span>
              </label>
              <label className={styles.checkField}>
                <input
                  checked={row.isDefault}
                  name="default-vat-rate"
                  onChange={() => onChange(row.id, 'isDefault', true)}
                  type="radio"
                />
                <span>{uiText.companySettings.invoiceVatRateDefault}</span>
              </label>
              <button
                className="ghost-button"
                disabled={rows.length <= 1}
                onClick={() => onRemove(row.id)}
                type="button"
              >
                {uiText.companySettings.invoiceVatRatesRemove}
              </button>
            </div>
          ))}
        </fieldset>
        <div className={styles.actions}>
          <button disabled={isSaving} type="submit">
            {isSaving ? uiText.companySettings.saving : uiText.companySettings.invoiceVatRatesSave}
          </button>
        </div>
      </form>
    </section>
  );
}
