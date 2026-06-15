import type { Customer } from '@eky/api-client';

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
  const isEmpty = !isLoading && errorMessage === null && customers.length === 0;
  const isDisabled = isLoading || errorMessage !== null || isEmpty;

  return (
    <label className="invoice-field invoice-field-customer">
      <span>{uiText.invoicing.customer}</span>
      <select
        aria-describedby="invoice-customer-help"
        aria-invalid={validationErrorMessage === undefined ? undefined : true}
        disabled={isDisabled}
        name="customerId"
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{getPlaceholder(isLoading, isEmpty, errorMessage)}</option>
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {formatCustomerOption(customer)}
          </option>
        ))}
      </select>
      <small
        className={
          errorMessage === null && validationErrorMessage === undefined
            ? undefined
            : 'invoice-field-error'
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

function getPlaceholder(
  isLoading: boolean,
  isEmpty: boolean,
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
