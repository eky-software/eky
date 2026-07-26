import { EkyApiError } from '@eky/api-client';
import { describe, expect, it } from 'vitest';

import { uiText } from '../../../i18n/fi.js';
import { getDiagnosticsErrorMessage } from './useDiagnostics.js';

describe('getDiagnosticsErrorMessage', () => {
  it('does not expose response bodies, paths or stacks', () => {
    const error = new EkyApiError('C:\\Users\\name\\runtime\\logs', {
      responseBody: { stack: 'must not reach the UI' },
      status: 500,
    });

    expect(getDiagnosticsErrorMessage(error)).toBe(
      uiText.diagnostics.loadError,
    );
    expect(getDiagnosticsErrorMessage(new Error('technical failure'))).toBe(
      uiText.diagnostics.loadError,
    );
  });
});

