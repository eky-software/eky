import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Sidebar } from './Sidebar.js';

describe('Sidebar', () => {
  it('keeps operational views out of the primary sidebar', () => {
    const html = renderToStaticMarkup(
      <Sidebar
        activeView="customers"
        isCollapsed={false}
        onViewChange={() => undefined}
      />,
    );

    const companySection = html.indexOf('Yritys');
    const companySettings = html.indexOf('Oma yritys');

    expect(companySection).toBeGreaterThan(-1);
    expect(companySettings).toBeGreaterThan(companySection);
    expect(html).not.toContain('Tapahtumat');
    expect(html).not.toContain('Diagnostiikka');
  });

  it('keeps company settings active for its operational subviews', () => {
    const html = renderToStaticMarkup(
      <Sidebar
        activeView="diagnostics"
        isCollapsed={false}
        onViewChange={() => undefined}
      />,
    );

    expect(html).toContain('aria-current="page"');
    expect(html).toContain('Oma yritys');
  });
});
