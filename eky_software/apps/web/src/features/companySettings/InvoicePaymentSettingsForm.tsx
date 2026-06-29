import type { InvoicePaymentSettingsView } from '@eky/api-client';

import type {
  InvoicePaymentSettingsForm as InvoicePaymentSettingsFormModel,
  InvoicePaymentSettingsValidationErrors,
} from './invoicePaymentSettingsFormModel.js';
import styles from './InvoiceNumberingSettingsForm.module.css';
import { uiText } from '../../i18n/fi.js';

interface InvoicePaymentSettingsFormProps {
  errorMessage: string | null;
  form: InvoicePaymentSettingsFormModel;
  isSaving: boolean;
  settings: InvoicePaymentSettingsView | null;
  successMessage: string | null;
  validationErrors: InvoicePaymentSettingsValidationErrors;
  onFieldChange(fieldName: keyof InvoicePaymentSettingsFormModel, value: string): void;
  onSubmit(): void;
}

export function InvoicePaymentSettingsForm({
  errorMessage,
  form,
  isSaving,
  settings,
  successMessage,
  validationErrors,
  onFieldChange,
  onSubmit,
}: InvoicePaymentSettingsFormProps): React.JSX.Element {
  const isDefaultPreview = settings ? !settings.isPersisted : false;

  return (
    <section className={`panel ${styles.panel}`}>
      <div className="panel-header">
        <div>
          <p className="panel-kicker">{uiText.companySettings.invoicePaymentKicker}</p>
          <h2>{uiText.companySettings.invoicePaymentHeading}</h2>
        </div>
      </div>

      <p className="panel-description">
        {uiText.companySettings.invoicePaymentDescription}
      </p>

      {isDefaultPreview ? (
        <p className="message">{uiText.companySettings.invoicePaymentDefaultInfo}</p>
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
        <fieldset disabled={isSaving}>
          <legend>{uiText.companySettings.invoicePaymentSettings}</legend>
          <div className={styles.grid}>
            <label htmlFor="invoice-payment-late-interest">
              {uiText.companySettings.invoicePaymentLateInterest}
              <input
                id="invoice-payment-late-interest"
                inputMode="decimal"
                name="defaultLatePaymentInterestPercent"
                onChange={(event) =>
                  onFieldChange(
                    'defaultLatePaymentInterestPercent',
                    event.target.value,
                  )
                }
                type="text"
                value={form.defaultLatePaymentInterestPercent}
              />
              <span className={styles.fieldHelp}>
                {uiText.companySettings.invoicePaymentLateInterestHelp}
              </span>
              {validationErrors.defaultLatePaymentInterestPercent ? (
                <span className={styles.fieldError}>
                  {validationErrors.defaultLatePaymentInterestPercent}
                </span>
              ) : null}
            </label>

            <label htmlFor="invoice-payment-reminder-days">
              {uiText.companySettings.invoicePaymentReminderPeriodDays}
              <input
                id="invoice-payment-reminder-days"
                inputMode="numeric"
                name="defaultReminderPeriodDays"
                onChange={(event) =>
                  onFieldChange('defaultReminderPeriodDays', event.target.value)
                }
                type="text"
                value={form.defaultReminderPeriodDays}
              />
              <span className={styles.fieldHelp}>
                {uiText.companySettings.invoicePaymentReminderPeriodDaysHelp}
              </span>
              {validationErrors.defaultReminderPeriodDays ? (
                <span className={styles.fieldError}>
                  {validationErrors.defaultReminderPeriodDays}
                </span>
              ) : null}
            </label>
          </div>
        </fieldset>

        <div className={styles.actions}>
          <button disabled={isSaving} type="submit">
            {isSaving
              ? uiText.companySettings.saving
              : uiText.companySettings.invoicePaymentSave}
          </button>
        </div>
      </form>
    </section>
  );
}
