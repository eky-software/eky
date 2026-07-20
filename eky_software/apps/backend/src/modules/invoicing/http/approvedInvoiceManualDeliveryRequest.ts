export class ApprovedInvoiceManualDeliveryRequestValidationError extends Error {
  constructor() {
    super('Manual delivery method is invalid.');
    this.name = 'ApprovedInvoiceManualDeliveryRequestValidationError';
  }
}

export function parseApprovedInvoiceManualDeliveryBody(
  value: unknown,
): { deliveryMethod: 'manual' | 'print' } {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== 'deliveryMethod') ||
    !('deliveryMethod' in value) ||
    (value.deliveryMethod !== 'manual' && value.deliveryMethod !== 'print')
  ) {
    throw new ApprovedInvoiceManualDeliveryRequestValidationError();
  }

  return { deliveryMethod: value.deliveryMethod };
}
