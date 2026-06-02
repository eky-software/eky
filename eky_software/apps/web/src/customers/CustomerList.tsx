import type { Customer } from '@eky/api-client';

import { uiText } from '../i18n/fi.js';

interface CustomerListProps {
  customers: Customer[];
  errorMessage: string | null;
  isLoading: boolean;
  onCreateClick(): void;
  onCustomerSelect(customer: Customer): void;
}

export function CustomerList({
  customers,
  errorMessage,
  isLoading,
  onCreateClick,
  onCustomerSelect,
}: CustomerListProps): React.JSX.Element {
  return (
    <section className="panel customer-list-panel" aria-labelledby="customer-list-heading">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">{uiText.customers.customerRegister}</p>
          <h2 id="customer-list-heading">{uiText.customers.customerList}</h2>
        </div>
        <div className="panel-actions">
          <span className="count-badge">{customers.length}</span>
          <button onClick={onCreateClick} type="button">
            {uiText.customers.newCustomerAction}
          </button>
        </div>
      </div>

      {errorMessage ? <p className="message error-message">{errorMessage}</p> : null}
      {isLoading ? <p className="message">{uiText.customers.loading}</p> : null}
      {!isLoading && customers.length === 0 ? (
        <p className="message">{uiText.customers.empty}</p>
      ) : null}

      {customers.length > 0 ? (
        <div className="customer-table" role="table" aria-label={uiText.customers.customers}>
          <div className="customer-table-row customer-table-head" role="row">
            <span role="columnheader">{uiText.customers.customer}</span>
            <span role="columnheader">{uiText.customers.customerType}</span>
            <span role="columnheader">{uiText.customers.city}</span>
            <span role="columnheader">{uiText.customers.contact}</span>
            <span role="columnheader">{uiText.customers.status}</span>
          </div>
          {customers.map((customer) => (
            <button
              className="customer-table-row customer-table-button"
              key={customer.id}
              onClick={() => onCustomerSelect(customer)}
              type="button"
            >
              <span className="customer-main-cell">
                <span className="customer-number">{customer.customerNumber}</span>
                <strong>{customer.name}</strong>
                {getCustomerRelationshipLabel(customer, customers) ? (
                  <span className="customer-secondary">
                    {getCustomerRelationshipLabel(customer, customers)}
                  </span>
                ) : null}
              </span>
              <span role="cell">{getCustomerTypeLabel(customer.customerType)}</span>
              <span role="cell">{customer.city || '-'}</span>
              <span role="cell">{getPrimaryContact(customer)}</span>
              <span role="cell">
                <span className={`status-pill status-pill-${customer.status}`}>
                  {getCustomerStatusLabel(customer.status)}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function getCustomerTypeLabel(customerType: Customer['customerType']): string {
  if (customerType === 'company') {
    return uiText.customers.organization;
  }

  if (customerType === 'housingCompany') {
    return uiText.customers.housingCompany;
  }

  if (customerType === 'propertyManager') {
    return uiText.customers.propertyManager;
  }

  if (customerType === 'privatePerson') {
    return uiText.customers.privatePerson;
  }

  return uiText.customers.other;
}

function getCustomerStatusLabel(status: Customer['status']): string {
  return status === 'active' ? uiText.customers.active : uiText.customers.inactive;
}

function getPrimaryContact(customer: Customer): string {
  return customer.email || customer.phone || '-';
}

function getCustomerRelationshipLabel(customer: Customer, customers: Customer[]): string {
  if (customer.customerType !== 'housingCompany' || customer.managedByCustomerId.length === 0) {
    return '';
  }

  const propertyManager = customers.find(
    (candidate) => candidate.id === customer.managedByCustomerId,
  );

  if (propertyManager === undefined) {
    return '';
  }

  return `${uiText.customers.managedByPropertyManager}: ${propertyManager.name}`;
}
