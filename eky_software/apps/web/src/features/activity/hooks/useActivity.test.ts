import { EkyApiError } from '@eky/api-client';
import { describe, expect, it } from 'vitest';

import { uiText } from '../../../i18n/fi.js';
import { getActivityErrorMessage } from './useActivity.js';

describe('getActivityErrorMessage', () => {
  it('does not expose an unknown API response or technical error', () => {
    const error = new EkyApiError('Sensitive backend detail', {
      responseBody: {
        stack: 'must not reach the UI',
      },
      status: 500,
    });

    expect(getActivityErrorMessage(error)).toBe(uiText.activity.loadError);
    expect(getActivityErrorMessage(new Error('technical failure'))).toBe(
      uiText.activity.loadError,
    );
  });
});
