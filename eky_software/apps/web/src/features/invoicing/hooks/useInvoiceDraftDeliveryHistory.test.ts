import type { InvoiceDraftDeliveryHistory } from '@eky/api-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uiText } from '../../../i18n/fi.js';
import { useInvoiceDraftDeliveryHistory } from './useInvoiceDraftDeliveryHistory.js';

const observed = vi.hoisted(() => ({
  writes: [] as unknown[], cleanups: [] as (() => void)[], previous: undefined as unknown,
}));
vi.mock('react', () => ({
  useState: (initial: () => unknown) => [observed.previous ?? initial(), (value: unknown) => observed.writes.push(value)],
  useEffect: (effect: () => () => void) => { observed.cleanups.push(effect()); },
}));
afterEach(() => { observed.writes.length = 0; observed.cleanups.length = 0; observed.previous = undefined; });

describe('draft delivery history request ownership', () => {
  it('loads only the selected draft through the read-only client', async () => {
    const history = { invoiceId: 'invoice-1', events: [] };
    const client = { getInvoiceDraftDeliveryHistory: vi.fn(async () => history) };
    expect(useInvoiceDraftDeliveryHistory(client, 'draft-1').isLoading).toBe(true);
    await Promise.resolve();
    expect(client.getInvoiceDraftDeliveryHistory).toHaveBeenCalledExactlyOnceWith('draft-1');
    expect(observed.writes.at(-1)).toEqual({ draftId: 'draft-1', history, isLoading: false, errorMessage: null });
  });

  it('does not expose raw request errors', async () => {
    useInvoiceDraftDeliveryHistory({ getInvoiceDraftDeliveryHistory: async () => { throw new Error('private raw detail'); } }, 'draft-1');
    await Promise.resolve();
    expect(observed.writes.at(-1)).toEqual({ draftId: 'draft-1', history: null, isLoading: false,
      errorMessage: uiText.invoicing.invoiceDeliveryHistoryError });
    expect(JSON.stringify(observed.writes)).not.toContain('private raw detail');
  });

  it.each(['resolve', 'reject'] as const)('ignores stale %s after effect cleanup and a new selection', async outcome => {
    const old = deferred();
    useInvoiceDraftDeliveryHistory({ getInvoiceDraftDeliveryHistory: () => old.promise }, 'old-draft');
    observed.cleanups[0]!();
    const next = { invoiceId: 'new-invoice', events: [] };
    useInvoiceDraftDeliveryHistory({ getInvoiceDraftDeliveryHistory: async () => next }, 'new-draft');
    await Promise.resolve();
    observed.writes.length = 0;
    if (outcome === 'resolve') old.resolve({ invoiceId: 'old-invoice', events: [] });
    else old.reject(new Error('old private error'));
    await Promise.resolve();
    expect(observed.writes).toEqual([]);
  });

  it('hides previous draft history before the new effect completes', () => {
    observed.previous = { draftId: 'old-draft', history: { invoiceId: 'old-invoice', events: [] }, errorMessage: null, isLoading: false };
    const state = useInvoiceDraftDeliveryHistory({ getInvoiceDraftDeliveryHistory: () => deferred().promise }, 'new-draft');
    expect(state).toEqual({ draftId: 'new-draft', history: null, isLoading: true, errorMessage: null });
  });
});

function deferred() {
  let resolve!: (history: InvoiceDraftDeliveryHistory) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<InvoiceDraftDeliveryHistory>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
