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

  it('renders the desktop active company as the sidebar brand selector', () => {
    const html = renderToStaticMarkup(
      <Sidebar
        activeView="customers"
        activeWorkspaceLabel="Oma yritys Oy"
        brandState="idle"
        isCollapsed={false}
        onOpenWorkspaceManagement={() => undefined}
        onViewChange={() => undefined}
        workspaceManagementAvailable
      />,
    );

    expect(html).toContain('Oma yritys Oy');
    expect(html).toContain('Eky · Paikallinen');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain(
      'aria-label="Vaihda yritystä. Aktiivinen yritys: Oma yritys Oy"',
    );
  });

  it('keeps browser-only branding static', () => {
    const html = renderToStaticMarkup(
      <Sidebar
        activeView="customers"
        isCollapsed={false}
        onViewChange={() => undefined}
      />,
    );

    expect(html).toContain('Eky');
    expect(html).toContain('Paikallinen');
    expect(html).not.toContain('aria-haspopup="dialog"');
  });
});
