import type { InvoiceNumberingSettingsView } from '@eky/api-client';

import {
  invoiceNumberingModeOptions,
  monthOptions,
  type InvoiceNumberingSettingsForm as InvoiceNumberingSettingsFormModel,
  type InvoiceNumberingSettingsValidationErrors,
} from './invoiceNumberingSettingsFormModel.js';
import styles from './InvoiceNumberingSettingsForm.module.css';
import { uiText } from '../../i18n/fi.js';

interface InvoiceNumberingSettingsFormProps {
  errorMessage: string | null;
  form: InvoiceNumberingSettingsFormModel;
  isSaving: boolean;
  settings: InvoiceNumberingSettingsView | null;
  successMessage: string | null;
  validationErrors: InvoiceNumberingSettingsValidationErrors;
  onFieldChange(fieldName: keyof InvoiceNumberingSettingsFormModel, value: string): void;
  onSubmit(): void;
}

export function InvoiceNumberingSettingsForm({
  errorMessage,
  form,
  isSaving,
  settings,
  successMessage,
  validationErrors,
  onFieldChange,
  onSubmit,
}: InvoiceNumberingSettingsFormProps): React.JSX.Element {
  const isLocked = settings?.hasUsedNumbering ?? false;
  const isDefaultPreview = settings ? !settings.isPersisted : false;

  return (
    <section className={`panel ${styles.panel}`}>
      <div className="panel-header">
        <div>
          <p className="panel-kicker">{uiText.companySettings.invoiceNumberingKicker}</p>
          <h2>{uiText.companySettings.invoiceNumberingHeading}</h2>
        </div>
      </div>

      <p className="panel-description">
        {uiText.companySettings.invoiceNumberingDescription}
      </p>

      {isDefaultPreview ? (
        <p className="message">{uiText.companySettings.invoiceNumberingDefaultInfo}</p>
      ) : null}
      {isLocked ? (
        <p className={`message ${styles.warningMessage}`}>
          {uiText.companySettings.invoiceNumberingUsedWarning}
        </p>
      ) : null}
      {successMessage ? <p className="message success-message">{successMessage}</p> : null}
      {errorMessage ? <p className="message error-message">{errorMessage}</p> : null}

      <form
        className={styles.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <fieldset disabled={isLocked || isSaving}>
          <legend>{uiText.companySettings.invoiceNumberingSettings}</legend>
          <div className={styles.grid}>
            <label htmlFor="invoice-numbering-mode">
              {uiText.companySettings.invoiceNumberingMode}
              <select
                id="invoice-numbering-mode"
                name="mode"
                onChange={(event) => onFieldChange('mode', event.target.value)}
                value={form.mode}
              >
                {invoiceNumberingModeOptions.map((mode) => (
                  <option key={mode} value={mode}>
                    {uiText.companySettings.invoiceNumberingModes[mode]}
                  </option>
                ))}
              </select>
              {validationErrors.mode ? (
                <span className={styles.fieldError}>{validationErrors.mode}</span>
              ) : null}
            </label>

            <label htmlFor="invoice-numbering-fiscal-year-start-month">
              {uiText.companySettings.invoiceNumberingFiscalYearStartMonth}
              <select
                id="invoice-numbering-fiscal-year-start-month"
                name="fiscalYearStartMonth"
                onChange={(event) =>
                  onFieldChange('fiscalYearStartMonth', event.target.value)
                }
                value={form.fiscalYearStartMonth}
              >
                {monthOptions.map((monthOption) => (
                  <option key={monthOption.value} value={monthOption.value}>
                    {
                      uiText.companySettings.invoiceNumberingMonths[
                        monthOption.labelKey
                      ]
                    }
                  </option>
                ))}
              </select>
              {validationErrors.fiscalYearStartMonth ? (
                <span className={styles.fieldError}>
                  {validationErrors.fiscalYearStartMonth}
                </span>
              ) : null}
            </label>

            <label htmlFor="invoice-numbering-sequence-padding">
              {uiText.companySettings.invoiceNumberingSequencePadding}
              <input
                id="invoice-numbering-sequence-padding"
                inputMode="numeric"
                name="sequencePadding"
                onChange={(event) => onFieldChange('sequencePadding', event.target.value)}
                type="text"
                value={form.sequencePadding}
              />
              <span className={styles.fieldHelp}>
                {uiText.companySettings.invoiceNumberingSequencePaddingHelp}
              </span>
              {validationErrors.sequencePadding ? (
                <span className={styles.fieldError}>
                  {validationErrors.sequencePadding}
                </span>
              ) : null}
            </label>

            <label htmlFor="invoice-numbering-first-sequence-number">
              {uiText.companySettings.invoiceNumberingFirstSequenceNumber}
              <input
                id="invoice-numbering-first-sequence-number"
                inputMode="numeric"
                name="firstSequenceNumber"
                onChange={(event) =>
                  onFieldChange('firstSequenceNumber', event.target.value)
                }
                type="text"
                value={form.firstSequenceNumber}
              />
              {validationErrors.firstSequenceNumber ? (
                <span className={styles.fieldError}>
                  {validationErrors.firstSequenceNumber}
                </span>
              ) : null}
            </label>
          </div>
        </fieldset>

        {settings ? (
          <dl className={styles.metaGrid}>
            <div>
              <dt>{uiText.companySettings.invoiceNumberingSeriesKey}</dt>
              <dd>{settings.seriesKey}</dd>
            </div>
            <div>
              <dt>{uiText.companySettings.invoiceNumberingHasUsedNumbering}</dt>
              <dd>
                {settings.hasUsedNumbering
                  ? uiText.companySettings.yes
                  : uiText.companySettings.no}
              </dd>
            </div>
            <div>
              <dt>{uiText.companySettings.invoiceNumberingIsPersisted}</dt>
              <dd>
                {settings.isPersisted
                  ? uiText.companySettings.yes
                  : uiText.companySettings.no}
              </dd>
            </div>
          </dl>
        ) : null}

        <div className={styles.actions}>
          <button disabled={isLocked || isSaving} type="submit">
            {isLocked
              ? uiText.companySettings.invoiceNumberingLocked
              : isSaving
                ? uiText.companySettings.saving
                : uiText.companySettings.invoiceNumberingSave}
          </button>
        </div>
      </form>
    </section>
  );
}
