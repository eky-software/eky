import { describe, expect, it } from 'vitest';

import { getFinnishApiErrorMessage, uiText } from './fi.js';

describe('API error translation', () => {
  it('uses known translations with or without a caller fallback', () => {
    expect(getFinnishApiErrorMessage('Customer number already exists.', 'Safe fallback'))
      .toBe('Asiakasnumero on jo käytössä.');
    expect(getFinnishApiErrorMessage('Customer number already exists.'))
      .toBe('Asiakasnumero on jo käytössä.');
  });

  it.each(['SYNTHETIC_PRIVATE_DETAIL', 'constructor', 'toString', '__proto__'])(
    'uses the supplied fallback for an unknown key: %s',
    (message) => {
      expect(getFinnishApiErrorMessage(message, uiText.customers.fallbackError))
        .toBe(uiText.customers.fallbackError);
    },
  );

  it('preserves unknown-message behavior for existing callers without a fallback', () => {
    expect(getFinnishApiErrorMessage('Unknown existing message')).toBe('Unknown existing message');
  });

  it('translates the fixed relationship and exhaustion errors without embedding business data', () => {
    expect(getFinnishApiErrorMessage('Referenced property manager type cannot be changed.'))
      .toContain('Vaihda tai poista ensin');
    expect(getFinnishApiErrorMessage('Customer number range is exhausted.'))
      .toContain('Anna vapaa asiakasnumero käsin.');
  });
});
