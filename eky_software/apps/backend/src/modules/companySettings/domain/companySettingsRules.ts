export class CompanySettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompanySettingsValidationError';
  }
}

export function normalizeCompanySettingsField(value: string, fieldName: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length > 200) {
    throw new CompanySettingsValidationError(`${fieldName} must be 200 characters or less.`);
  }

  return normalizedValue;
}

export function parseDefaultHourlyRateCents(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new CompanySettingsValidationError('Default hourly rate must be whole cents.');
  }

  if (value < 0) {
    throw new CompanySettingsValidationError('Default hourly rate cannot be negative.');
  }

  return value;
}

export function normalizeHourlyRateShortcut(value: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length > 50) {
    throw new CompanySettingsValidationError(
      'Hourly rate shortcut must be 50 characters or less.',
    );
  }

  if (/[\r\n]/.test(normalizedValue)) {
    throw new CompanySettingsValidationError(
      'Hourly rate shortcut must be a single line.',
    );
  }

  return normalizedValue;
}

export function normalizeCompanyVatNumber(value: string): string {
  const normalizedValue = value.trim().toUpperCase();

  if (normalizedValue === '') {
    return '';
  }

  if (!/^FI\d{8}$/.test(normalizedValue)) {
    throw new CompanySettingsValidationError(
      'Company VAT number must use Finnish format FI followed by 8 digits.',
    );
  }

  return normalizedValue;
}
