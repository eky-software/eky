import type { Customer } from '@eky/api-client';

import { uiText } from '../i18n/fi.js';

interface CustomerListProps {
  customers: Customer[];
  errorMessage: string | null;
  isLoading: boolean;
}

export function CustomerList({
  customers,
  errorMessage,
  isLoading,
}: CustomerListProps): React.JSX.Element {
  return (
    <section className="panel customer-list-panel" aria-labelledby="customer-list-heading">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">{uiText.customers.customerRegister}</p>
          <h2 id="customer-list-heading">{uiText.customers.customerList}</h2>
        </div>
        <span className="count-badge">{customers.length}</span>
      </div>

      {errorMessage ? <p className="message error-message">{errorMessage}</p> : null}
      {isLoading ? <p className="message">{uiText.customers.loading}</p> : null}
      {!isLoading && customers.length === 0 ? (
        <p className="message">{uiText.customers.empty}</p>
      ) : null}

      {customers.length > 0 ? (
        <div className="customer-table" role="table" aria-label={uiText.customers.customers}>
          <div className="customer-table-row customer-table-head" role="row">
            <span role="columnheader">{uiText.customers.name}</span>
            <span role="columnheader">{uiText.customers.tenant}</span>
            <span role="columnheader">{uiText.customers.created}</span>
          </div>
          {customers.map((customer) => (
            <div className="customer-table-row" role="row" key={customer.id}>
              <strong role="cell">{customer.name}</strong>
              <span role="cell">{customer.companyId}</span>
              <time role="cell" dateTime={customer.createdAt}>
                {formatDate(customer.createdAt)}
              </time>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('fi-FI', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}
