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
