export class CustomerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomerValidationError';
  }
}

export function normalizeCustomerName(name: string): string {
  const normalizedName = name.trim();

  if (normalizedName.length === 0) {
    throw new CustomerValidationError('Customer name is required.');
  }

  if (normalizedName.length > 200) {
    throw new CustomerValidationError('Customer name must be 200 characters or less.');
  }

  return normalizedName;
}
