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
      invoicingNavigationRevision: 0,
    });
  });

  it('opens the read-only activity view without changing invoicing state', () => {
    expect(activateAppView(initialAppNavigationState, 'activity')).toEqual({
      activeView: 'activity',
      invoicingNavigationRevision: 0,
    });
  });

  it('opens diagnostics without changing invoicing state', () => {
    expect(activateAppView(initialAppNavigationState, 'diagnostics')).toEqual({
      activeView: 'diagnostics',
      invoicingNavigationRevision: 0,
    });
  });

  it('signals a return to the draft list when invoicing is selected again', () => {
    const invoicingState = activateAppView(
      initialAppNavigationState,
      'invoicing',
    );

    expect(activateAppView(invoicingState, 'invoicing')).toEqual({
      activeView: 'invoicing',
      invoicingNavigationRevision: 1,
    });
  });
});
