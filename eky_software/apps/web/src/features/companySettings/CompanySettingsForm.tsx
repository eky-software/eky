import type { CompanySettingsForm as CompanySettingsFormModel } from './companySettingsFormModel.js';
import styles from './CompanySettingsForm.module.css';
import { uiText } from '../../i18n/fi.js';

interface CompanySettingsFormProps {
  errorMessage: string | null;
  form: CompanySettingsFormModel;
  isSaving: boolean;
  onFieldChange(fieldName: keyof CompanySettingsFormModel, value: string): void;
  onSubmit(): void;
}

export function CompanySettingsForm({
  errorMessage,
  form,
  isSaving,
  onFieldChange,
  onSubmit,
}: CompanySettingsFormProps): React.JSX.Element {
  return (
    <section className={`panel ${styles.panel}`}>
      <div className="panel-header">
        <div>
          <p className="panel-kicker">{uiText.companySettings.formKicker}</p>
          <h2>{uiText.companySettings.formHeading}</h2>
        </div>
      </div>

      <p className="panel-description">{uiText.companySettings.formDescription}</p>
      {errorMessage ? <p className="message error-message">{errorMessage}</p> : null}

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <fieldset>
          <legend>{uiText.companySettings.basicInformation}</legend>
          <div className={styles.grid}>
            <label className={styles.wideField} htmlFor="company-name">
              {uiText.companySettings.companyName}
              <input
                id="company-name"
                name="companyName"
                onChange={(event) => onFieldChange('companyName', event.target.value)}
                placeholder={uiText.companySettings.placeholderCompanyName}
                type="text"
                value={form.companyName}
              />
            </label>

            <label htmlFor="company-business-id">
              {uiText.companySettings.businessId}
              <input
                id="company-business-id"
                name="businessId"
                onChange={(event) => onFieldChange('businessId', event.target.value)}
                placeholder={uiText.companySettings.placeholderBusinessId}
                type="text"
                value={form.businessId}
              />
            </label>

            <label htmlFor="company-vat-number">
              {uiText.companySettings.vatNumber}
              <input
                id="company-vat-number"
                name="vatNumber"
                onChange={(event) => onFieldChange('vatNumber', event.target.value)}
                placeholder={uiText.companySettings.placeholderVatNumber}
                type="text"
                value={form.vatNumber}
              />
              <span className={styles.fieldHelp}>{uiText.companySettings.vatNumberHelp}</span>
            </label>

            <label htmlFor="default-hourly-rate">
              {uiText.companySettings.defaultHourlyRate}
              <input
                id="default-hourly-rate"
                inputMode="decimal"
                name="defaultHourlyRateEuro"
                onChange={(event) => onFieldChange('defaultHourlyRateEuro', event.target.value)}
                placeholder={uiText.companySettings.placeholderDefaultHourlyRate}
                type="text"
                value={form.defaultHourlyRateEuro}
              />
              <span className={styles.fieldHelp}>{uiText.companySettings.defaultHourlyRateHelp}</span>
            </label>

            <label htmlFor="hourly-rate-shortcut">
              {uiText.companySettings.hourlyRateShortcut}
              <input
                id="hourly-rate-shortcut"
                name="hourlyRateShortcut"
                onChange={(event) =>
                  onFieldChange('hourlyRateShortcut', event.target.value)
                }
                placeholder={uiText.companySettings.placeholderHourlyRateShortcut}
                type="text"
                value={form.hourlyRateShortcut}
              />
              <span className={styles.fieldHelp}>
                {uiText.companySettings.hourlyRateShortcutHelp}
              </span>
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>{uiText.companySettings.contactInformation}</legend>
          <div className={styles.grid}>
            <label htmlFor="company-email">
              {uiText.companySettings.email}
              <input
                id="company-email"
                name="email"
                onChange={(event) => onFieldChange('email', event.target.value)}
                placeholder={uiText.companySettings.placeholderEmail}
                type="email"
                value={form.email}
              />
            </label>

            <label htmlFor="company-phone">
              {uiText.companySettings.phone}
              <input
                id="company-phone"
                name="phone"
                onChange={(event) => onFieldChange('phone', event.target.value)}
                placeholder={uiText.companySettings.placeholderPhone}
                type="tel"
                value={form.phone}
              />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>{uiText.companySettings.bankDetails}</legend>
          <p className={styles.fieldsetHelp}>
            {uiText.companySettings.bankDetailsHelp}
          </p>
          <div className={styles.grid}>
            <label className={styles.wideField} htmlFor="company-iban">
              {uiText.companySettings.iban}
              <input
                id="company-iban"
                name="iban"
                onChange={(event) => onFieldChange('iban', event.target.value)}
                placeholder={uiText.companySettings.placeholderIban}
                type="text"
                value={form.iban}
              />
            </label>

            <label htmlFor="company-bic">
              {uiText.companySettings.bic}
              <input
                id="company-bic"
                name="bic"
                onChange={(event) => onFieldChange('bic', event.target.value)}
                placeholder={uiText.companySettings.placeholderBic}
                type="text"
                value={form.bic}
              />
            </label>

            <label htmlFor="company-bank-name">
              {uiText.companySettings.bankName}
              <input
                id="company-bank-name"
                name="bankName"
                onChange={(event) => onFieldChange('bankName', event.target.value)}
                placeholder={uiText.companySettings.placeholderBankName}
                type="text"
                value={form.bankName}
              />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>{uiText.companySettings.address}</legend>
          <div className={styles.grid}>
            <label className={styles.wideField} htmlFor="company-street-address">
              {uiText.companySettings.streetAddress}
              <input
                id="company-street-address"
                name="streetAddress"
                onChange={(event) => onFieldChange('streetAddress', event.target.value)}
                placeholder={uiText.companySettings.placeholderStreetAddress}
                type="text"
                value={form.streetAddress}
              />
            </label>

            <label htmlFor="company-postal-code">
              {uiText.companySettings.postalCode}
              <input
                id="company-postal-code"
                name="postalCode"
                onChange={(event) => onFieldChange('postalCode', event.target.value)}
                placeholder={uiText.companySettings.placeholderPostalCode}
                type="text"
                value={form.postalCode}
              />
            </label>

            <label htmlFor="company-city">
              {uiText.companySettings.city}
              <input
                id="company-city"
                name="city"
                onChange={(event) => onFieldChange('city', event.target.value)}
                placeholder={uiText.companySettings.placeholderCity}
                type="text"
                value={form.city}
              />
            </label>
          </div>
        </fieldset>

        <div className={styles.actions}>
          <button disabled={isSaving} type="submit">
            {isSaving ? uiText.companySettings.saving : uiText.companySettings.save}
          </button>
        </div>
      </form>
    </section>
  );
}
