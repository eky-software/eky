import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Sidebar } from './Sidebar.js';

describe('Sidebar', () => {
  it('groups activity and diagnostics below company settings', () => {
    const html = renderToStaticMarkup(
      <Sidebar
        activeView="customers"
        isCollapsed={false}
        onViewChange={() => undefined}
      />,
    );

    const companySection = html.indexOf('Yritys');
    const companySettings = html.indexOf('Oma yritys');
    const activity = html.indexOf('Tapahtumat');
    const diagnostics = html.indexOf('Diagnostiikka');

    expect(companySection).toBeGreaterThan(-1);
    expect(companySettings).toBeGreaterThan(companySection);
    expect(activity).toBeGreaterThan(companySettings);
    expect(diagnostics).toBeGreaterThan(activity);
  });
});
