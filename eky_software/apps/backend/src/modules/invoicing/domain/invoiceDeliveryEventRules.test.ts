import { describe, expect, it } from 'vitest';

import {
  InvoiceDeliveryEventValidationError,
  normalizeDeliveryProviderMessageId,
} from './invoiceDeliveryEventRules.js';

describe('normalizeDeliveryProviderMessageId', () => {
  it('preserves a normal SMTP Message-ID', () => {
    expect(
      normalizeDeliveryProviderMessageId('<message.123@example.fi>'),
    ).toBe('<message.123@example.fi>');
  });

  it('rejects control characters from provider data', () => {
    expect(() =>
      normalizeDeliveryProviderMessageId('<message@example.fi>\r\ninjected'),
    ).toThrow(InvoiceDeliveryEventValidationError);
  });
});
