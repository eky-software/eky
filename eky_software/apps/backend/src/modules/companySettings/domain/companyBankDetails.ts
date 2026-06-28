import { CompanySettingsValidationError } from './companySettingsRules.js';

export interface CompanyBankDetails {
  iban: string;
  bic: string;
  bankName: string;
}

export function normalizeCompanyBankDetails(
  input: CompanyBankDetails,
): CompanyBankDetails {
  const normalizedDetails = {
    iban: normalizeIban(input.iban),
    bic: normalizeBic(input.bic),
    bankName: normalizeBankName(input.bankName),
  };

  validateCompanyBankDetails(normalizedDetails);

  return normalizedDetails;
}

export function validateCompanyBankDetails(input: CompanyBankDetails): void {
  if (input.iban !== '' && !hasValidIbanChecksum(input.iban)) {
    throw new CompanySettingsValidationError('IBAN is invalid.');
  }
}

function normalizeIban(value: string): string {
  const normalizedValue = value.replace(/\s+/g, '').toUpperCase();

  if (normalizedValue === '') {
    return '';
  }

  if (
    normalizedValue.length < 15 ||
    normalizedValue.length > 34 ||
    !/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(normalizedValue)
  ) {
    throw new CompanySettingsValidationError('IBAN is invalid.');
  }

  return normalizedValue;
}

function normalizeBic(value: string): string {
  const normalizedValue = value.trim().toUpperCase();

  if (normalizedValue === '') {
    return '';
  }

  if (!/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(normalizedValue)) {
    throw new CompanySettingsValidationError('BIC is invalid.');
  }

  return normalizedValue;
}

function normalizeBankName(value: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length > 200) {
    throw new CompanySettingsValidationError(
      'Bank name must be 200 characters or less.',
    );
  }

  return normalizedValue;
}

function hasValidIbanChecksum(iban: string): boolean {
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;

  for (const character of rearranged) {
    const numericValue = ibanCharacterToNumericValue(character);

    for (const digit of numericValue) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }

  return remainder === 1;
}

function ibanCharacterToNumericValue(character: string): string {
  if (/[0-9]/.test(character)) {
    return character;
  }

  if (/[A-Z]/.test(character)) {
    return String(character.charCodeAt(0) - 55);
  }

  throw new CompanySettingsValidationError('IBAN is invalid.');
}
