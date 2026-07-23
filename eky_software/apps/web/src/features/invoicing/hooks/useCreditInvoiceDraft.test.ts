import { EkyApiError } from '@eky/api-client';
import { describe, expect, it } from 'vitest';

import { getCreditInvoiceDraftErrorMessage } from './useCreditInvoiceDraft.js';
import { uiText } from '../../../i18n/fi.js';

describe('getCreditInvoiceDraftErrorMessage', () => {
  it.each([
    [400, uiText.invoicing.creditDraftValidationError],
    [404, uiText.invoicing.creditDraftNotFound],
    [409, uiText.invoicing.creditDraftConflictError],
  ])('maps status %s to a safe Finnish message', (status, expected) => {
    expect(
      getCreditInvoiceDraftErrorMessage(
        new EkyApiError('Internal technical detail', { status }),
      ),
    ).toBe(expected);
  });

  it('does not expose response body or stack details', () => {
    const message = getCreditInvoiceDraftErrorMessage(
      new EkyApiError('SQL stack trace', {
        responseBody: { stack: 'secret' },
        status: 500,
      }),
    );

    expect(message).toBe(uiText.invoicing.creditDraftError);
    expect(message).not.toContain('SQL');
    expect(message).not.toContain('stack');
  });
});

