import type { CompanySettingsForm as CompanySettingsFormModel } from './companySettingsFormModel.js';
import { uiText } from '../i18n/fi.js';

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
    <section className="panel company-settings-form-panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">{uiText.companySettings.formKicker}</p>
          <h2>{uiText.companySettings.formHeading}</h2>
        </div>
      </div>

      <p className="panel-description">{uiText.companySettings.formDescription}</p>
      {errorMessage ? <p className="message error-message">{errorMessage}</p> : null}

      <form
        className="customer-form company-settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <fieldset>
          <legend>{uiText.companySettings.basicInformation}</legend>
          <div className="form-grid">
            <label className="form-field-wide" htmlFor="company-name">
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
              <span className="field-help">{uiText.companySettings.defaultHourlyRateHelp}</span>
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>{uiText.companySettings.contactInformation}</legend>
          <div className="form-grid">
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
          <legend>{uiText.companySettings.address}</legend>
          <div className="form-grid">
            <label className="form-field-wide" htmlFor="company-street-address">
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

        <div className="form-actions">
          <button disabled={isSaving} type="submit">
            {isSaving ? uiText.companySettings.saving : uiText.companySettings.save}
          </button>
        </div>
      </form>
    </section>
  );
}
