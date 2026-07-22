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
          <legend>{uiText.companySettings.companyAndContactInformation}</legend>
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

            <label htmlFor="company-website">
              {uiText.companySettings.website}
              <input
                id="company-website"
                name="website"
                onChange={(event) => onFieldChange('website', event.target.value)}
                placeholder={uiText.companySettings.placeholderWebsite}
                type="text"
                value={form.website}
              />
            </label>

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

        <fieldset>
          <legend>{uiText.companySettings.billingPrices}</legend>
          <div className={styles.grid}>
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
                onChange={(event) => onFieldChange('hourlyRateShortcut', event.target.value)}
                placeholder={uiText.companySettings.placeholderHourlyRateShortcut}
                type="text"
                value={form.hourlyRateShortcut}
              />
              <span className={styles.fieldHelp}>{uiText.companySettings.hourlyRateShortcutHelp}</span>
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
          <legend>{uiText.companySettings.emailDeliverySettings}</legend>
          <p className={styles.fieldsetHelp}>
            {uiText.companySettings.emailDeliverySettingsHelp}
          </p>
          <div className={styles.grid}>
            <label htmlFor="company-email-delivery-provider">
              {uiText.companySettings.emailDeliveryProvider}
              <select
                id="company-email-delivery-provider"
                name="emailDeliveryProvider"
                onChange={(event) =>
                  onFieldChange(
                    'emailDeliveryProvider',
                    event.target.value as CompanySettingsFormModel['emailDeliveryProvider'],
                  )
                }
                value={form.emailDeliveryProvider}
              >
                <option value="dryRun">{uiText.companySettings.emailProviderDryRun}</option>
                <option value="dnaSmtp">{uiText.companySettings.emailProviderDnaSmtp}</option>
              </select>
            </label>

            <label htmlFor="company-email-sender-name">
              {uiText.companySettings.emailSenderName}
              <input
                id="company-email-sender-name"
                name="emailSenderName"
                onChange={(event) => onFieldChange('emailSenderName', event.target.value)}
                placeholder={uiText.companySettings.placeholderEmailSenderName}
                type="text"
                value={form.emailSenderName}
              />
            </label>

            <label htmlFor="company-email-sender-address">
              {uiText.companySettings.emailSenderAddress}
              <input
                id="company-email-sender-address"
                name="emailSenderAddress"
                onChange={(event) => onFieldChange('emailSenderAddress', event.target.value)}
                placeholder={uiText.companySettings.placeholderEmailSenderAddress}
                type="email"
                value={form.emailSenderAddress}
              />
            </label>

            {form.emailDeliveryProvider === 'dnaSmtp' ? (
              <p className={styles.wideField}>
                {uiText.companySettings.emailDnaSmtpProfileHelp}
              </p>
            ) : null}

            <label htmlFor="company-email-username">
              {uiText.companySettings.emailUsername}
              <input
                id="company-email-username"
                name="emailUsername"
                onChange={(event) => onFieldChange('emailUsername', event.target.value)}
                placeholder={uiText.companySettings.placeholderEmailUsername}
                type="text"
                value={form.emailUsername}
              />
            </label>

            <label htmlFor="company-email-test-recipient">
              {uiText.companySettings.emailTestRecipientOverride}
              <input
                id="company-email-test-recipient"
                name="emailTestRecipientOverride"
                onChange={(event) =>
                  onFieldChange('emailTestRecipientOverride', event.target.value)
                }
                placeholder={uiText.companySettings.placeholderEmailTestRecipientOverride}
                type="email"
                value={form.emailTestRecipientOverride}
              />
              <span className={styles.fieldHelp}>
                {uiText.companySettings.emailTestRecipientOverrideHelp}
              </span>
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
