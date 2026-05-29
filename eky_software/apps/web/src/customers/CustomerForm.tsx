import type { CreateCustomerRequest } from '@eky/api-client';

import { uiText } from '../i18n/fi.js';

interface CustomerFormProps {
  form: CreateCustomerRequest;
  isSaving: boolean;
  onFieldChange(fieldName: keyof CreateCustomerRequest, value: string): void;
  onSubmit(): void;
}

export function CustomerForm({
  form,
  isSaving,
  onFieldChange,
  onSubmit,
}: CustomerFormProps): React.JSX.Element {
  return (
    <section className="panel customer-form-panel" aria-labelledby="create-customer-heading">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">{uiText.customers.newCustomer}</p>
          <h2 id="create-customer-heading">{uiText.customers.addCustomer}</h2>
        </div>
      </div>

      <form
        className="customer-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="form-grid">
          <label htmlFor="customer-number">
            {uiText.customers.customerNumber}
            <input
              id="customer-number"
              name="customerNumber"
              onChange={(event) => onFieldChange('customerNumber', event.target.value)}
              placeholder={uiText.customers.placeholderCustomerNumber}
              type="text"
              value={form.customerNumber}
            />
          </label>

          <label htmlFor="customer-type">
            {uiText.customers.customerType}
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
            {uiText.customers.name}
            <input
              id="customer-name"
              name="customerName"
              onChange={(event) => onFieldChange('name', event.target.value)}
              placeholder={uiText.customers.placeholderName}
              type="text"
              value={form.name}
            />
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

          <label htmlFor="customer-status">
            {uiText.customers.status}
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

          <label className="form-field-wide" htmlFor="customer-comment">
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
        </div>

        <div className="form-actions">
          <button disabled={isSaving} type="submit">
            {isSaving ? uiText.customers.saving : uiText.customers.add}
          </button>
        </div>
      </form>
    </section>
  );
}
