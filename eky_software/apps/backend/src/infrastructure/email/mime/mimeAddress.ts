import { normalizeEmailAddress } from '../address/emailAddress.js';
import { encodeMimeHeaderValue } from './mimeEncodedWord.js';

export function formatMimeAddress(address: string, displayName = ''): string {
  const normalizedAddress = normalizeEmailAddress(address);
  const normalizedDisplayName = displayName.trim();

  if (normalizedDisplayName.length === 0) {
    return normalizedAddress;
  }

  return `${encodeMimeHeaderValue(normalizedDisplayName)} <${normalizedAddress}>`;
}
