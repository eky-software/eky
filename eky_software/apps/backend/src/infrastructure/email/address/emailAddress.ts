import { emailTransportLimits } from '../emailTransportLimits.js';

const localPartPattern = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;
const domainLabelPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const forbiddenAddressCharacterPattern = /[\u0000-\u0020\u007f<>(),:;"\\[\]]/;

export class EmailAddressValidationError extends Error {
  constructor() {
    super('Email address is invalid.');
    this.name = 'EmailAddressValidationError';
  }
}

export function normalizeEmailAddress(value: string): string {
  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > emailTransportLimits.maximumAddressCharacters ||
    forbiddenAddressCharacterPattern.test(normalizedValue)
  ) {
    throw new EmailAddressValidationError();
  }

  const separatorIndex = normalizedValue.lastIndexOf('@');

  if (
    separatorIndex <= 0 ||
    separatorIndex !== normalizedValue.indexOf('@') ||
    separatorIndex === normalizedValue.length - 1
  ) {
    throw new EmailAddressValidationError();
  }

  const localPart = normalizedValue.slice(0, separatorIndex);
  const domain = normalizedValue.slice(separatorIndex + 1).toLowerCase();

  if (
    localPart.length > 64 ||
    localPart.startsWith('.') ||
    localPart.endsWith('.') ||
    localPart.includes('..') ||
    !localPartPattern.test(localPart) ||
    domain.length > 253 ||
    domain.includes('..') ||
    !domain.includes('.') ||
    domain.split('.').some((label) => !domainLabelPattern.test(label))
  ) {
    throw new EmailAddressValidationError();
  }

  return `${localPart}@${domain}`;
}
