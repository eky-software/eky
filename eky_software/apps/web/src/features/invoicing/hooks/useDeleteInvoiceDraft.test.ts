import { EkyApiError } from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  deleteInvoiceDraftAndRefresh,
  deleteInvoiceDraftWithClient,
  getDeleteInvoiceDraftErrorMessage,
} from './useDeleteInvoiceDraft.js';
import { uiText } from '../../../i18n/fi.js';

describe('deleteInvoiceDraftWithClient', () => {
  it('uses the api-client deleteInvoiceDraft endpoint', async () => {
    const apiClient = {
      deleteInvoiceDraft: vi.fn(async () => undefined),
    };

    await expect(
      deleteInvoiceDraftWithClient(apiClient, 'draft-1'),
    ).resolves.toBeUndefined();
    expect(apiClient.deleteInvoiceDraft).toHaveBeenCalledWith('draft-1');
  });
});

describe('deleteInvoiceDraftAndRefresh', () => {
  it('refreshes the list after a successful delete', async () => {
    const deleteDraft = vi.fn(async () => true);
    const refreshDrafts = vi.fn(async () => undefined);

    await expect(
      deleteInvoiceDraftAndRefresh(
        'draft-1',
        deleteDraft,
        refreshDrafts,
      ),
    ).resolves.toBe(true);
    expect(refreshDrafts).toHaveBeenCalledOnce();
  });

  it('keeps the current list when deleting fails', async () => {
    const deleteDraft = vi.fn(async () => false);
    const refreshDrafts = vi.fn(async () => undefined);

    await expect(
      deleteInvoiceDraftAndRefresh(
        'draft-1',
        deleteDraft,
        refreshDrafts,
      ),
    ).resolves.toBe(false);
    expect(refreshDrafts).not.toHaveBeenCalled();
  });
});

describe('getDeleteInvoiceDraftErrorMessage', () => {
  it('translates a known safe API error into Finnish', () => {
    const error = new EkyApiError('Invoice draft not found.', {
      responseBody: { internal: 'not rendered' },
      status: 404,
    });

    expect(getDeleteInvoiceDraftErrorMessage(error)).toBe(
      uiText.apiErrors['Invoice draft not found.'],
    );
  });

  it('uses a generic Finnish message without exposing technical details', () => {
    const error = new EkyApiError('Internal SQL detail.', {
      responseBody: { stack: 'not rendered' },
      status: 500,
    });

    expect(getDeleteInvoiceDraftErrorMessage(error)).toBe(
      uiText.invoicing.deleteDraftError,
    );
  });
});
