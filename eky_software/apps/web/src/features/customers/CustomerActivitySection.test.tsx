import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CustomerActivitySection } from './CustomerActivitySection.js';
import type { CustomerActivityState } from './hooks/useCustomerActivity.js';

describe('CustomerActivitySection', () => {
  it('shows allowlisted change categories without customer field values', () => {
    const html = renderToStaticMarkup(
      <CustomerActivitySection
        activityState={createActivityState({
          activityEntries: [
            {
              action: 'customer.updated',
              changeCategories: ['contact', 'pricing'],
              id: 'activity-1',
              occurredAt: '2026-08-01T10:00:00.000Z',
            },
          ],
        })}
      />,
    );

    expect(html).toContain('Päivitettiin yhteystietoja ja hinnoittelua');
    expect(html).not.toContain('customer@example.fi');
    expect(html).not.toContain('Kotikatu');
  });

  it('renders activity errors independently', () => {
    const html = renderToStaticMarkup(
      <CustomerActivitySection
        activityState={createActivityState({
          errorMessage: 'Tapahtumahistoriaa ei voitu ladata.',
        })}
      />,
    );

    expect(html).toContain('Tapahtumahistoriaa ei voitu ladata.');
  });
});

function createActivityState(
  overrides: Partial<CustomerActivityState> = {},
): CustomerActivityState {
  return {
    activityEntries: [],
    errorMessage: null,
    goToPage: () => undefined,
    hasNextPage: false,
    hasPreviousPage: false,
    isLoading: false,
    page: 1,
    ...overrides,
  };
}
