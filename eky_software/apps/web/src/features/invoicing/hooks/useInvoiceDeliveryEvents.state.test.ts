import type { InvoiceDeliveryEventSummary } from '@eky/api-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useInvoiceDeliveryEvents } from './useInvoiceDeliveryEvents.js';

// Hook-level command ownership; browser journeys cover real React mounting.
const observed = vi.hoisted(() => ({
  writes: [] as unknown[], cleanups: [] as (() => void)[],
}));
vi.mock('react', () => ({
  useState: (initial: unknown) => [initial, (value: unknown) => observed.writes.push(value)],
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: (effect: () => () => void) => { observed.cleanups.push(effect()); },
}));
afterEach(() => { observed.writes.length = 0; observed.cleanups.length = 0; });

describe('delivery history completion ownership', () => {
  it.each(['resolve', 'reject'] as const)('ignores an older %s while the next invoice loads', async (outcome) => {
    const older = deferred();
    const newer = deferred();
    const client = { listInvoiceDeliveryEvents: vi.fn()
      .mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise) };
    const state = useInvoiceDeliveryEvents(client);
    const oldCommand = state.loadEvents('invoice-old');
    const newCommand = state.loadEvents('invoice-new');
    observed.writes.length = 0;
    if (outcome === 'reject') older.reject(new Error('private stale detail'));
    else older.resolve([event('old-event')]);
    await oldCommand;
    expect(observed.writes).toEqual([]);
    const current = [event('new-event')];
    newer.resolve(current);
    await newCommand;
    expect(observed.writes).toEqual([current, false]);
  });

  it.each(['clear', 'unmount'] as const)('%s invalidates an in-flight history request', async (action) => {
    const response = deferred();
    const state = useInvoiceDeliveryEvents({ listInvoiceDeliveryEvents: () => response.promise });
    const command = state.loadEvents('invoice-1');
    if (action === 'clear') state.clearEvents();
    else for (const cleanup of observed.cleanups) cleanup();
    observed.writes.length = 0;
    response.resolve([event('stale-event')]);
    await command;
    expect(observed.writes).toEqual([]);
  });
});

function deferred() {
  let resolve!: (events: InvoiceDeliveryEventSummary[]) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<InvoiceDeliveryEventSummary[]>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function event(id: string): InvoiceDeliveryEventSummary {
  return {
    id, createdAt: '2026-07-20T20:00:00.000Z', deliveryMethod: 'email',
    provider: 'smtp', sendMode: 'smtpTest', documentSource: 'revision',
    recipientEmail: 'test@example.invalid', ccEmail: '', safeErrorMessage: null,
    status: 'succeeded',
  };
}
