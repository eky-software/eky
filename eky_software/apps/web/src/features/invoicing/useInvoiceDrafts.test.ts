import { EkyApiError } from '@eky/api-client';
import { describe, expect, it } from 'vitest';

import { getInvoiceDraftErrorMessage } from './useInvoiceDrafts.js';
import { uiText } from '../../i18n/fi.js';

describe('getInvoiceDraftErrorMessage', () => {
  it('translates a known safe API error into Finnish', () => {
    const error = new EkyApiError('Invalid invoice draft response.', {
      responseBody: { internal: 'not rendered' },
      status: 200,
    });

    expect(getInvoiceDraftErrorMessage(error)).toBe(
      uiText.apiErrors['Invalid invoice draft response.'],
    );
  });

  it('uses a generic Finnish message for an unknown API error', () => {
    const error = new EkyApiError('Unexpected internal service detail.', {
      responseBody: { internal: 'not rendered' },
      status: 500,
    });

    expect(getInvoiceDraftErrorMessage(error)).toBe(uiText.invoicing.loadError);
  });

  it('uses a generic Finnish message for an unexpected error', () => {
    expect(getInvoiceDraftErrorMessage(new Error('Technical stack detail.'))).toBe(
      uiText.invoicing.loadError,
    );
  });
});
