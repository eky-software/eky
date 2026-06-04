import type { Customer } from '@eky/api-client';

import type { CustomerFormModel } from './customerFormModel.js';
import { uiText } from '../i18n/fi.js';

interface CustomerFormProps {
  errorMessage: string | null;
  form: CustomerFormModel;
  isSaving: boolean;
  mode: 'create' | 'edit';
  onCancel(): void;
  onFillDummy?: (() => void) | undefined;
  onFieldChange(fieldName: keyof CustomerFormModel, value: string): void;
  onSubmit(): void;
  propertyManagers: Customer[];
}

export function CustomerForm({
  errorMessage,
  form,
  isSaving,
  mode,
  onCancel,
  onFillDummy,
  onFieldChange,
  onSubmit,
  propertyManagers,
}: CustomerFormProps): React.JSX.Element {
  const isManualNumber = mode === 'edit' || form.customerNumberMode === 'manual';
  const isSubmitDisabled =
    isSaving || form.name.trim().length === 0 || (isManualNumber && !form.customerNumber?.trim());
  const heading =
    mode === 'create' ? uiText.customers.addCustomer : uiText.customers.editCustomer;
  const kicker =
    mode === 'create' ? uiText.customers.newCustomer : uiText.customers.customerCard;
  const submitLabel = mode === 'create' ? uiText.customers.add : uiText.customers.saveChanges;

  return (
    <aside className="panel customer-form-panel" aria-labelledby="create-customer-heading">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">{kicker}</p>
          <h2 id="create-customer-heading">{heading}</h2>
        </div>
        <button className="ghost-button" disabled={isSaving} onClick={onCancel} type="button">
          {uiText.customers.close}
        </button>
      </div>

      <p className="panel-description">{uiText.customers.formDescription}</p>
      {onFillDummy ? (
        <div className="form-helper-actions">
          <button className="ghost-button" disabled={isSaving} onClick={onFillDummy} type="button">
            {uiText.customers.fillDummyCustomer}
          </button>
          <span>{uiText.customers.fillDummyCustomerHelp}</span>
        </div>
      ) : null}
      {errorMessage ? <p className="message error-message">{errorMessage}</p> : null}

      <form
        className="customer-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <fieldset>
          <legend>{uiText.customers.basicInformation}</legend>
          <div className="form-grid">
            {mode === 'create' ? (
              <div className="form-field-wide">
                <span className="field-label">{uiText.customers.customerNumber}</span>
                <div
                  className="segmented-control"
                  role="group"
                  aria-label={uiText.customers.customerNumber}
                >
                  <label>
                    <input
                      checked={form.customerNumberMode === 'auto'}
                      name="customerNumberMode"
                      onChange={() => onFieldChange('customerNumberMode', 'auto')}
                      type="radio"
                      value="auto"
                    />
                    <span>{uiText.customers.automaticCustomerNumber}</span>
                  </label>
                  <label>
                    <input
                      checked={form.customerNumberMode === 'manual'}
                      name="customerNumberMode"
                      onChange={() => onFieldChange('customerNumberMode', 'manual')}
                      type="radio"
                      value="manual"
                    />
                    <span>{uiText.customers.manualCustomerNumber}</span>
                  </label>
                </div>
                <p className="field-help">{uiText.customers.customerNumberHelp}</p>
              </div>
            ) : null}

            {isManualNumber ? (
              <label htmlFor="customer-number">
                {uiText.customers.customerNumber} *
                <input
                  id="customer-number"
                  name="customerNumber"
                  onChange={(event) => onFieldChange('customerNumber', event.target.value)}
                  placeholder={uiText.customers.placeholderCustomerNumber}
                  type="text"
                  value={form.customerNumber ?? ''}
                />
              </label>
            ) : null}

            <label htmlFor="customer-type">
              {uiText.customers.customerType} *
              <select
                id="customer-type"
                name="customerType"
                onChange={(event) => onFieldChange('customerType', event.target.value)}
                value={form.customerType}
              >
                <option value="company">{uiText.customers.organization}</option>
                <option value="housingCompany">{uiText.customers.housingCompany}</option>
                <option value="propertyManager">{uiText.customers.propertyManager}</option>
                <option value="privatePerson">{uiText.customers.privatePerson}</option>
                <option value="other">{uiText.customers.other}</option>
              </select>
            </label>

            <label className="form-field-wide" htmlFor="customer-name">
              {uiText.customers.name} *
              <input
                id="customer-name"
                name="customerName"
                onChange={(event) => onFieldChange('name', event.target.value)}
                placeholder={uiText.customers.placeholderName}
                type="text"
                value={form.name}
              />
            </label>

            <label htmlFor="customer-status">
              {uiText.customers.status} *
              <select
                id="customer-status"
                name="status"
                onChange={(event) => onFieldChange('status', event.target.value)}
                value={form.status}
              >
                <option value="active">{uiText.customers.active}</option>
                <option value="inactive">{uiText.customers.inactive}</option>
              </select>
            </label>

            <label htmlFor="customer-business-id">
              {uiText.customers.businessId}
              <input
                id="customer-business-id"
                name="businessId"
                onChange={(event) => onFieldChange('businessId', event.target.value)}
                placeholder={uiText.customers.placeholderBusinessId}
                type="text"
                value={form.businessId}
              />
            </label>

            {form.customerType === 'housingCompany' ? (
              <label className="form-field-wide" htmlFor="managed-by-customer-id">
                {uiText.customers.managedByPropertyManager}
                <select
                  id="managed-by-customer-id"
                  name="managedByCustomerId"
                  onChange={(event) => onFieldChange('managedByCustomerId', event.target.value)}
                  value={form.managedByCustomerId}
                >
                  <option value="">{uiText.customers.noPropertyManager}</option>
                  {propertyManagers.map((propertyManager) => (
                    <option key={propertyManager.id} value={propertyManager.id}>
                      {propertyManager.customerNumber} {propertyManager.name}
                    </option>
                  ))}
                </select>
                <span className="field-help">{uiText.customers.propertyManagerHelp}</span>
              </label>
            ) : null}
          </div>
        </fieldset>

        <fieldset>
          <legend>{uiText.customers.pricing}</legend>
          <label htmlFor="customer-hourly-rate-override">
            {uiText.customers.hourlyRateOverride}
            <input
              id="customer-hourly-rate-override"
              inputMode="decimal"
              name="hourlyRateOverrideEuro"
              onChange={(event) => onFieldChange('hourlyRateOverrideEuro', event.target.value)}
              placeholder={uiText.customers.placeholderHourlyRateOverride}
              type="text"
              value={form.hourlyRateOverrideEuro}
            />
            <span className="field-help">{uiText.customers.hourlyRateOverrideHelp}</span>
          </label>
        </fieldset>

        <fieldset>
          <legend>{uiText.customers.contactInformation}</legend>
          <div className="form-grid">
            <label htmlFor="customer-email">
              {uiText.customers.email}
              <input
                id="customer-email"
                name="email"
                onChange={(event) => onFieldChange('email', event.target.value)}
                placeholder={uiText.customers.placeholderEmail}
                type="email"
                value={form.email}
              />
            </label>

            <label htmlFor="customer-phone">
              {uiText.customers.phone}
              <input
                id="customer-phone"
                name="phone"
                onChange={(event) => onFieldChange('phone', event.target.value)}
                placeholder={uiText.customers.placeholderPhone}
                type="tel"
                value={form.phone}
              />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>{uiText.customers.address}</legend>
          <div className="form-grid">
            <label className="form-field-wide" htmlFor="customer-street-address">
              {uiText.customers.streetAddress}
              <input
                id="customer-street-address"
                name="streetAddress"
                onChange={(event) => onFieldChange('streetAddress', event.target.value)}
                placeholder={uiText.customers.placeholderStreetAddress}
                type="text"
                value={form.streetAddress}
              />
            </label>

            <label htmlFor="customer-postal-code">
              {uiText.customers.postalCode}
              <input
                id="customer-postal-code"
                name="postalCode"
                onChange={(event) => onFieldChange('postalCode', event.target.value)}
                placeholder={uiText.customers.placeholderPostalCode}
                type="text"
                value={form.postalCode}
              />
            </label>

            <label htmlFor="customer-city">
              {uiText.customers.city}
              <input
                id="customer-city"
                name="city"
                onChange={(event) => onFieldChange('city', event.target.value)}
                placeholder={uiText.customers.placeholderCity}
                type="text"
                value={form.city}
              />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>{uiText.customers.additionalInformation}</legend>
          <label htmlFor="customer-comment">
            {uiText.customers.comment}
            <textarea
              id="customer-comment"
              name="comment"
              onChange={(event) => onFieldChange('comment', event.target.value)}
              placeholder={uiText.customers.placeholderComment}
              rows={3}
              value={form.comment}
            />
          </label>
        </fieldset>

        <div className="form-actions">
          <button className="ghost-button" disabled={isSaving} onClick={onCancel} type="button">
            {uiText.customers.cancel}
          </button>
          <button disabled={isSubmitDisabled} type="submit">
            {isSaving ? uiText.customers.saving : submitLabel}
          </button>
        </div>
      </form>
    </aside>
  );
}
