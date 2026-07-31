import { describe, expect, it } from 'vitest';

import {
  activateAppView,
  initialAppNavigationState,
} from './appNavigation.js';

describe('activateAppView', () => {
  it('changes the active application view', () => {
    expect(
      activateAppView(initialAppNavigationState, 'invoicing'),
    ).toEqual({
      activeView: 'invoicing',
      customerNavigationRevision: 0,
      invoicingNavigationRevision: 0,
      invoicingNavigationTarget: null,
    });
  });

  it('opens the read-only activity view without changing invoicing state', () => {
    expect(activateAppView(initialAppNavigationState, 'activity')).toEqual({
      activeView: 'activity',
      customerNavigationRevision: 0,
      invoicingNavigationRevision: 0,
      invoicingNavigationTarget: null,
    });
  });

  it('opens diagnostics without changing invoicing state', () => {
    expect(activateAppView(initialAppNavigationState, 'diagnostics')).toEqual({
      activeView: 'diagnostics',
      customerNavigationRevision: 0,
      invoicingNavigationRevision: 0,
      invoicingNavigationTarget: null,
    });
  });

  it('signals a return to the customer list when customers is selected again', () => {
    expect(activateAppView(initialAppNavigationState, 'customers')).toEqual({
      activeView: 'customers',
      customerNavigationRevision: 1,
      invoicingNavigationRevision: 0,
      invoicingNavigationTarget: null,
    });
  });

  it('signals a return to the draft list when invoicing is selected again', () => {
    const invoicingState = activateAppView(
      initialAppNavigationState,
      'invoicing',
    );

    expect(activateAppView(invoicingState, 'invoicing')).toEqual({
      activeView: 'invoicing',
      customerNavigationRevision: 0,
      invoicingNavigationRevision: 1,
      invoicingNavigationTarget: null,
    });
  });

  it('creates a revisioned request for an approved invoice', () => {
    expect(
      activateAppView(initialAppNavigationState, {
        target: {
          id: 'invoice-1',
          type: 'approvedInvoice',
        },
        type: 'openInvoicingTarget',
      }),
    ).toEqual({
      activeView: 'invoicing',
      customerNavigationRevision: 0,
      invoicingNavigationRevision: 1,
      invoicingNavigationTarget: {
        id: 'invoice-1',
        type: 'approvedInvoice',
      },
    });
  });
});
