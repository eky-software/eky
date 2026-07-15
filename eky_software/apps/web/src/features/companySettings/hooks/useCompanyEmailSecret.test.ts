import { EkyApiError } from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  getCompanyEmailSecretLoadErrorMessage,
  getCompanyEmailSecretSaveErrorMessage,
  loadCompanyEmailSecretStatus,
  removeCompanyEmailSecret,
  saveCompanyEmailSecret,
} from './useCompanyEmailSecret.js';
import { uiText } from '../../../i18n/fi.js';

describe('company email secret operations', () => {
  it('loads only the configured status through the API client', async () => {
    const status = { configured: true };
    const apiClient = {
      getCompanyEmailSecretStatus: vi.fn(async () => status),
    };

    await expect(loadCompanyEmailSecretStatus(apiClient)).resolves.toBe(status);
    expect(apiClient.getCompanyEmailSecretStatus).toHaveBeenCalledOnce();
  });

  it('passes the unchanged secret only to the API client set operation', async () => {
    const apiClient = {
      setCompanyEmailSecret: vi.fn(async () => ({ configured: true })),
    };

    await expect(
      saveCompanyEmailSecret(apiClient, '  synthetic password  '),
    ).resolves.toEqual({ configured: true });
    expect(apiClient.setCompanyEmailSecret).toHaveBeenCalledWith({
      secret: '  synthetic password  ',
    });
  });

  it('removes the secret without passing company or secret input', async () => {
    const apiClient = {
      removeCompanyEmailSecret: vi.fn(async () => ({ configured: false })),
    };

    await expect(removeCompanyEmailSecret(apiClient)).resolves.toEqual({
      configured: false,
    });
    expect(apiClient.removeCompanyEmailSecret).toHaveBeenCalledWith();
  });
});

describe('company email secret error messages', () => {
  it('explains that browser development cannot manage a desktop secret', () => {
    expect(
      getCompanyEmailSecretLoadErrorMessage(
        new EkyApiError('API request failed.', { status: 404 }),
      ),
    ).toBe(uiText.companySettings.emailSecretDesktopOnly);
  });

  it('translates known validation errors without rendering response data', () => {
    const message = getCompanyEmailSecretSaveErrorMessage(
      new EkyApiError('Email secret is required.', {
        responseBody: {
          secret: 'must-not-render',
          stack: 'must-not-render',
        },
        status: 400,
      }),
    );

    expect(message).toBe(uiText.apiErrors['Email secret is required.']);
    expect(message).not.toContain('must-not-render');
    expect(message).not.toContain('stack');
  });

  it('uses a safe fallback for unknown technical errors', () => {
    const message = getCompanyEmailSecretSaveErrorMessage(
      new EkyApiError('SAFE_STORAGE_INTERNAL_PATH', {
        responseBody: { path: 'private path' },
        status: 500,
      }),
    );

    expect(message).toBe(uiText.companySettings.emailSecretSaveError);
    expect(message).not.toContain('SAFE_STORAGE');
    expect(message).not.toContain('private path');
  });
});
