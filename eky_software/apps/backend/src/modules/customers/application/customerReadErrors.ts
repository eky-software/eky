export class CustomerNotFoundError extends Error {
  readonly code = 'customer_not_found';

  constructor() {
    super('Customer not found.');
    this.name = 'CustomerNotFoundError';
  }
}

export class CustomerReadValidationError extends Error {
  readonly code = 'customer_read_validation_error';

  constructor(message: string) {
    super(message);
    this.name = 'CustomerReadValidationError';
  }
}

export function requireCustomerResourceId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(value)) {
    throw new CustomerReadValidationError('Customer id is invalid.');
  }

  return value;
}
