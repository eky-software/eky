import type { Customer } from '@eky/api-client';

import type { CustomerFormModel } from './customerFormModel.js';
import styles from './CustomerForm.module.css';
import { uiText } from '../../i18n/fi.js';

interface CustomerFormFieldsProps {
  form: CustomerFormModel;
  mode: 'create' | 'edit';
  onFieldChange(fieldName: keyof CustomerFormModel, value: string): void;
  propertyManagers: Customer[];
}

export function CustomerFormFields({
  form,
  mode,
  onFieldChange,
  propertyManagers,
}: CustomerFormFieldsProps): React.JSX.Element {
  const isManualNumber =
    mode === 'edit' || form.customerNumberMode === 'manual';

  return (
    <>
      <fieldset>
        <legend>{uiText.customers.basicInformation}</legend>
        <div className={styles.grid}>
          {mode === 'create' ? (
            <div className={styles.wideField}>
              <span className={styles.fieldLabel}>
                {uiText.customers.customerNumber}
              </span>
              <div
                aria-label={uiText.customers.customerNumber}
                className={styles.segmentedControl}
                role="group"
              >
                <label>
                  <input
                    checked={form.customerNumberMode === 'auto'}
                    name="customerNumberMode"
                    onChange={() =>
                      onFieldChange('customerNumberMode', 'auto')
                    }
                    type="radio"
                    value="auto"
                  />
                  <span>{uiText.customers.automaticCustomerNumber}</span>
                </label>
                <label>
                  <input
                    checked={form.customerNumberMode === 'manual'}
                    name="customerNumberMode"
                    onChange={() =>
                      onFieldChange('customerNumberMode', 'manual')
                    }
                    type="radio"
                    value="manual"
                  />
                  <span>{uiText.customers.manualCustomerNumber}</span>
                </label>
              </div>
              <p className={styles.fieldHelp}>
                {uiText.customers.customerNumberHelp}
              </p>
            </div>
          ) : null}

          {isManualNumber ? (
            <label htmlFor="customer-number">
              {uiText.customers.customerNumber} *
              <input
                id="customer-number"
                name="customerNumber"
                onChange={(event) =>
                  onFieldChange('customerNumber', event.target.value)
                }
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
              onChange={(event) =>
                onFieldChange('customerType', event.target.value)
              }
              value={form.customerType}
            >
              <option value="company">{uiText.customers.organization}</option>
              <option value="housingCompany">
                {uiText.customers.housingCompany}
              </option>
              <option value="propertyManager">
                {uiText.customers.propertyManager}
              </option>
              <option value="privatePerson">
                {uiText.customers.privatePerson}
              </option>
              <option value="other">{uiText.customers.other}</option>
            </select>
          </label>

          <label className={styles.wideField} htmlFor="customer-name">
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
              onChange={(event) =>
                onFieldChange('businessId', event.target.value)
              }
              placeholder={uiText.customers.placeholderBusinessId}
              type="text"
              value={form.businessId}
            />
          </label>

          {form.customerType === 'housingCompany' ? (
            <label
              className={styles.wideField}
              htmlFor="managed-by-customer-id"
            >
              {uiText.customers.managedByPropertyManager}
              <select
                id="managed-by-customer-id"
                name="managedByCustomerId"
                onChange={(event) =>
                  onFieldChange('managedByCustomerId', event.target.value)
                }
                value={form.managedByCustomerId}
              >
                <option value="">{uiText.customers.noPropertyManager}</option>
                {propertyManagers.map((propertyManager) => (
                  <option key={propertyManager.id} value={propertyManager.id}>
                    {propertyManager.customerNumber} {propertyManager.name}
                  </option>
                ))}
              </select>
              <span className={styles.fieldHelp}>
                {uiText.customers.propertyManagerHelp}
              </span>
            </label>
          ) : null}
        </div>
      </fieldset>

      <fieldset>
        <legend>{uiText.customers.contactInformation}</legend>
        <div className={styles.grid}>
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
        <div className={styles.grid}>
          <label
            className={styles.wideField}
            htmlFor="customer-street-address"
          >
            {uiText.customers.streetAddress}
            <input
              id="customer-street-address"
              name="streetAddress"
              onChange={(event) =>
                onFieldChange('streetAddress', event.target.value)
              }
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
              onChange={(event) =>
                onFieldChange('postalCode', event.target.value)
              }
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
        <legend>{uiText.customers.pricing}</legend>
        <label htmlFor="customer-hourly-rate-override">
          {uiText.customers.hourlyRateOverride}
          <input
            id="customer-hourly-rate-override"
            inputMode="decimal"
            name="hourlyRateOverrideEuro"
            onChange={(event) =>
              onFieldChange('hourlyRateOverrideEuro', event.target.value)
            }
            placeholder={uiText.customers.placeholderHourlyRateOverride}
            type="text"
            value={form.hourlyRateOverrideEuro}
          />
          <span className={styles.fieldHelp}>
            {uiText.customers.hourlyRateOverrideHelp}
          </span>
        </label>
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
    </>
  );
}
