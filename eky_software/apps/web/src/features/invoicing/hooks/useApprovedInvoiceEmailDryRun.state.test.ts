import type { ApprovedInvoiceEmailPreview } from '@eky/api-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useApprovedInvoiceEmailDryRun } from './useApprovedInvoiceEmailDryRun.js';

// Observe the hook's state writes at its awaited command boundary. Browser
// journeys separately exercise React mounting and the visible result.
const observed = vi.hoisted(() => ({
  writes: [] as unknown[],
  cleanups: [] as (() => void)[],
}));
vi.mock('react', () => ({
  useState: (initial: unknown) => [initial, (value: unknown) => observed.writes.push(value)],
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: (effect: () => () => void) => { observed.cleanups.push(effect()); },
}));
afterEach(() => {
  observed.writes.length = 0;
  observed.cleanups.length = 0;
});

describe('email preparation completion ownership', () => {
  it.each(['resolve', 'reject'] as const)('older %s cannot write state while a newer preparation is pending', async (outcome) => {
    const older = deferredPreview();
    const newer = deferredPreview();
    const client = {
      prepareApprovedInvoiceEmailDryRun: vi.fn()
        .mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise),
    };
    const state = useApprovedInvoiceEmailDryRun(client);
    const oldCommand = state.prepareEmail('invoice-1');
    state.clearEmail();
    const currentCommand = state.prepareEmail('invoice-1');
    observed.writes.length = 0;

    if (outcome === 'reject') older.reject(new Error('Synthetic stale error'));
    else older.resolve(preview());
    // The await includes the old command's catch/finally, not just HTTP delivery.
    expect(await oldCommand).toBeNull();
    expect(observed.writes).toEqual([]);

    const current = preview();
    newer.resolve(current);
    expect(await currentCommand).toBe(current);
    expect(observed.writes).toEqual([current, false]);
  });

  it('unmount invalidates both the caller result and later state writes', async () => {
    const response = deferredPreview();
    const state = useApprovedInvoiceEmailDryRun({
      prepareApprovedInvoiceEmailDryRun: () => response.promise,
    });
    const command = state.prepareEmail('invoice-1');
    for (const cleanup of observed.cleanups) cleanup();
    observed.writes.length = 0;
    response.resolve(preview());
    expect(await command).toBeNull();
    expect(observed.writes).toEqual([]);
  });
});

function deferredPreview() {
  let resolve!: (value: ApprovedInvoiceEmailPreview) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<ApprovedInvoiceEmailPreview>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function preview(): ApprovedInvoiceEmailPreview {
  return {
    attachment: { documentId: 'copy-1', fileName: 'invoice.pdf', mimeType: 'application/pdf', sizeBytes: 10 },
    body: 'Synthetic preserved attachment',
    documentTarget: { kind: 'preservedLegacy', documentId: 'copy-1' },
    invoiceId: 'invoice-1', invoiceNumber: '20260001', provider: 'dryRun',
    subject: 'Synthetic invoice', to: 'recipient@example.invalid',
  };
}
