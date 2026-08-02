import { EkyApiError } from '@eky/api-client';
import { describe, expect, it } from 'vitest';

import { toSafeSeriesErrorMessage } from './useInvoiceNumberingSeriesTransition.js';
import { uiText } from '../../../i18n/fi.js';

describe('toSafeSeriesErrorMessage', () => {
  it('maps conflicts without exposing backend response bodies', () => {
    const message = toSafeSeriesErrorMessage(
      new EkyApiError('SQLITE_CONSTRAINT_SECRET', {
        responseBody: { stack: 'sensitive stack' },
        status: 409,
      }),
      'activate',
    );

    expect(message).toBe(
      uiText.companySettings.invoiceNumberingSeriesConflictError,
    );
    expect(message).not.toContain('SQLITE');
    expect(message).not.toContain('stack');
  });

  it('uses operation-specific safe fallbacks for unknown failures', () => {
    expect(toSafeSeriesErrorMessage(new Error('secret'), 'preview')).toBe(
      uiText.companySettings.invoiceNumberingSeriesPreviewError,
    );
    expect(toSafeSeriesErrorMessage(new Error('secret'), 'activate')).toBe(
      uiText.companySettings.invoiceNumberingSeriesActivationError,
    );
  });
});
