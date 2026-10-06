import type { ApprovedInvoiceView } from '@eky/api-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useApprovedInvoice } from './useApprovedInvoice.js';

// Command completion ownership; the browser regression covers React mounting.
const observed = vi.hoisted(() => ({
  writes: [] as unknown[], cleanups: [] as (() => void)[],
}));
vi.mock('react', () => ({
  useState: (initial: unknown) => [initial, (value: unknown) => observed.writes.push(value)],
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: (effect: () => () => void) => { observed.cleanups.push(effect()); },
}));
afterEach(() => { observed.writes.length = 0; observed.cleanups.length = 0; });

describe('approved invoice completion ownership', () => {
  it.each(['resolve', 'reject'] as const)('ignores an older %s while the next invoice loads', async (outcome) => {
    const old = deferred();
    const current = deferred();
    const state = useApprovedInvoice({ getApprovedInvoice: vi.fn()
      .mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise) });
    const oldCommand = state.openApprovedInvoice('invoice-old');
    const currentCommand = state.openApprovedInvoice('invoice-new');
    observed.writes.length = 0;
    if (outcome === 'resolve') old.resolve(invoice('invoice-old'));
    else old.reject(new Error('private stale detail'));
    expect(await oldCommand).toBeNull();
    expect(observed.writes).toEqual([]);
    const result = invoice('invoice-new');
    current.resolve(result);
    expect(await currentCommand).toBe(result);
    expect(observed.writes).toEqual([result, false]);
  });

  it.each(['clear', 'unmount', 'replace'] as const)('%s invalidates an in-flight detail request', async (action) => {
    const response = deferred();
    const state = useApprovedInvoice({ getApprovedInvoice: () => response.promise });
    const command = state.openApprovedInvoice('invoice-1');
    if (action === 'clear') state.clearApprovedInvoice();
    else if (action === 'replace') state.replaceApprovedInvoice(invoice('invoice-1'));
    else for (const cleanup of observed.cleanups) cleanup();
    observed.writes.length = 0;
    response.resolve(invoice('invoice-1'));
    expect(await command).toBeNull();
    expect(observed.writes).toEqual([]);
  });
});

function deferred() {
  let resolve!: (value: ApprovedInvoiceView) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<ApprovedInvoiceView>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function invoice(id: string): ApprovedInvoiceView {
  // Only identity is consumed by this hook; full snapshots belong to UI tests.
  return { id } as ApprovedInvoiceView;
}
