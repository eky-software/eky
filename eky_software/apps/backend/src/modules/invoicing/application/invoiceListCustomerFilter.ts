import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';

const maximumCustomerIdLength = 200;

export function normalizeOptionalInvoiceListCustomerId(
  customerId: string | undefined,
): string | null {
  if (customerId === undefined) {
    return null;
  }

  const normalizedCustomerId = requireIdentifier(customerId, 'Customer id');

  if (normalizedCustomerId.length > maximumCustomerIdLength) {
    throw new InvoiceDraftValidationError('Customer id is invalid.');
  }

  return normalizedCustomerId;
}

export interface InvoiceListCustomerFilters {
  customerId: string | null;
  billingRecipientCustomerId: string | null;
}

export function normalizeInvoiceListCustomerFilters(input: {
  customerId?: string;
  billingRecipientCustomerId?: string;
}): InvoiceListCustomerFilters {
  if (
    input.customerId !== undefined &&
    input.billingRecipientCustomerId !== undefined
  ) {
    throw new InvoiceDraftValidationError(
      'Invoice list customer filters cannot be combined.',
    );
  }

  return {
    customerId: normalizeOptionalInvoiceListCustomerId(input.customerId),
    billingRecipientCustomerId: normalizeOptionalInvoiceListCustomerId(
      input.billingRecipientCustomerId,
    ),
  };
}
