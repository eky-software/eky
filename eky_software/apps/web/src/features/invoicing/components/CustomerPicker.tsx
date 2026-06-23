import type { Customer } from '@eky/api-client';
import { useMemo, useState } from 'react';

import styles from './InvoiceBasicInfoSection.module.css';
import { uiText } from '../../../i18n/fi.js';

interface CustomerPickerProps {
  customers: Customer[];
  errorMessage: string | null;
  isLoading: boolean;
  onChange(customerId: string): void;
  validationErrorMessage: string | undefined;
  value: string;
}

export function CustomerPicker({
  customers,
  errorMessage,
  isLoading,
  onChange,
  validationErrorMessage,
  value,
}: CustomerPickerProps): React.JSX.Element {
  const [searchQuery, setSearchQuery] = useState('');
  const isEmpty = !isLoading && errorMessage === null && customers.length === 0;
  const filteredCustomers = useMemo(
    () => filterInvoiceCustomers(customers, searchQuery, value),
    [customers, searchQuery, value],
  );
  const hasNoMatches =
    !isLoading &&
    errorMessage === null &&
    !isEmpty &&
    filteredCustomers.length === 0;
  const isDisabled =
    isLoading || errorMessage !== null || isEmpty || hasNoMatches;

  return (
    <label className={`${styles.field} ${styles.customerField}`}>
      <span>{uiText.invoicing.customer}</span>
      <input
        aria-label={uiText.invoicing.customerSearch}
        disabled={isLoading || errorMessage !== null || isEmpty}
        name="customerSearch"
        placeholder={uiText.invoicing.customerSearchPlaceholder}
        type="search"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
      />
      <select
        aria-describedby="invoice-customer-help"
        aria-invalid={validationErrorMessage === undefined ? undefined : true}
        disabled={isDisabled}
        name="customerId"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">
          {getPlaceholder(isLoading, isEmpty, hasNoMatches, errorMessage)}
        </option>
        {filteredCustomers.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {formatCustomerOption(customer)}
          </option>
        ))}
      </select>
      <small
        className={
          errorMessage === null && validationErrorMessage === undefined
            ? undefined
            : styles.fieldError
        }
        id="invoice-customer-help"
        role={
          errorMessage === null && validationErrorMessage === undefined
            ? undefined
            : 'alert'
        }
      >
        {validationErrorMessage ??
          getHelpText(isLoading, isEmpty, errorMessage)}
      </small>
    </label>
  );
}

export function formatCustomerOption(customer: Customer): string {
  const statusSuffix =
    customer.status === 'inactive'
      ? ` (${uiText.invoicing.customerInactive})`
      : '';

  return `${customer.customerNumber} – ${customer.name}${statusSuffix}`;
}

export function filterInvoiceCustomers(
  customers: Customer[],
  searchQuery: string,
  selectedCustomerId: string,
): Customer[] {
  const normalizedQuery = normalizeCustomerSearchText(searchQuery);
  const filteredCustomers =
    normalizedQuery === ''
      ? customers
      : customers.filter((customer) =>
          normalizeCustomerSearchText(
            `${customer.customerNumber} ${customer.name} ${customer.businessId}`,
          ).includes(normalizedQuery),
        );

  if (
    selectedCustomerId === '' ||
    filteredCustomers.some((customer) => customer.id === selectedCustomerId)
  ) {
    return filteredCustomers;
  }

  const selectedCustomer = customers.find(
    (customer) => customer.id === selectedCustomerId,
  );

  return selectedCustomer === undefined
    ? filteredCustomers
    : [selectedCustomer, ...filteredCustomers];
}

function getPlaceholder(
  isLoading: boolean,
  isEmpty: boolean,
  hasNoMatches: boolean,
  errorMessage: string | null,
): string {
  if (isLoading) {
    return uiText.invoicing.customerLoading;
  }

  if (errorMessage !== null) {
    return uiText.invoicing.customerUnavailable;
  }

  if (isEmpty) {
    return uiText.invoicing.customerEmpty;
  }

  if (hasNoMatches) {
    return uiText.invoicing.customerNoMatches;
  }

  return uiText.invoicing.customerPlaceholder;
}

function getHelpText(
  isLoading: boolean,
  isEmpty: boolean,
  errorMessage: string | null,
): string {
  if (errorMessage !== null) {
    return errorMessage;
  }

  if (isLoading) {
    return uiText.invoicing.customerLoadingHelp;
  }

  if (isEmpty) {
    return uiText.invoicing.customerEmptyHelp;
  }

  return uiText.invoicing.customerPickerHelp;
}

function normalizeCustomerSearchText(value: string): string {
  return value.trim().toLocaleLowerCase('fi-FI');
}
