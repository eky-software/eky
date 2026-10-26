import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CustomerPage } from '../features/customers/CustomerPage.js';
import { CompanySettingsPage } from '../features/companySettings/CompanySettingsPage.js';
import { InvoicingPage } from '../features/invoicing/InvoicingPage.js';
import { ActivityPage } from '../features/activity/ActivityPage.js';
import { DiagnosticsPage } from '../features/diagnostics/DiagnosticsPage.js';
import { AppLayout } from '../layout/AppLayout.js';
import { uiText } from '../i18n/fi.js';
import { App } from './App.js';
import { createWebAppComposition } from './createWebAppComposition.js';
import { DesktopOperationalLogNotice } from './DesktopOperationalLogNotice.js';

vi.mock('../features/customers/CustomerPage.js', () => ({
  CustomerPage: vi.fn(() => <p>Business customers</p>),
}));
vi.mock('../features/companySettings/CompanySettingsPage.js', () => ({ CompanySettingsPage: vi.fn() }));
vi.mock('../features/invoicing/InvoicingPage.js', () => ({ InvoicingPage: vi.fn() }));
vi.mock('../features/activity/ActivityPage.js', () => ({ ActivityPage: vi.fn() }));
vi.mock('../features/diagnostics/DiagnosticsPage.js', () => ({ DiagnosticsPage: vi.fn() }));
vi.mock('../layout/AppLayout.js', () => ({
  AppLayout: vi.fn(({ children }: { children: React.ReactNode }) => <div>{children}</div>),
}));
vi.mock('./DesktopOperationalLogNotice.js', () => ({ DesktopOperationalLogNotice: vi.fn(() => null) }));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('App root composition', () => {
  it.each([true, false])('never mounts business consumers in selector mode (capability: %s)', (available) => {
    const getStatus = vi.fn(async () => ({
      activeWorkspaceId: null, formatVersion: 1, operationState: 'idle', workspaces: [],
    }));
    const desktop = available ? {
      getWorkspaceManagementStatus: getStatus,
      createEmptyWorkspace: vi.fn(),
      importWorkspaceBackupAsNew: vi.fn(),
      renameWorkspace: vi.fn(),
      switchWorkspace: vi.fn(),
    } : undefined;
    const forbiddenCapabilityRead = vi.fn(() => {
      throw new Error('Business capability is forbidden');
    });
    if (desktop !== undefined) {
      for (const name of [
        'getLocalUpdateStatus', 'getProfileBackupStatus', 'openInvoicePdf',
        'chooseInvoicePdfArchiveDirectory', 'createSupportBundle',
        'openOperationalLogFolder',
      ]) {
        Object.defineProperty(desktop, name, { get: forbiddenCapabilityRead });
      }
    }
    vi.stubGlobal('window', {
      location: { href: 'eky://app/index.html#workspace-selector' },
      ekyDesktop: desktop,
    });
    const fetch = vi.fn(() => { throw new Error('Business request is forbidden'); });
    vi.stubGlobal('fetch', fetch);
    const composition = createWebAppComposition();
    // The initial presentation is fixed for this renderer, not a hashchange router.
    window.location.href = 'eky://app/index.html';
    const html = renderToStaticMarkup(<App {...composition} />);

    expect(html).toContain('<main');
    expect(html).toContain(uiText.workspaces.heading);
    expect(html).toContain(available ? uiText.workspaces.loading : uiText.workspaces.safeError);
    expect(html).not.toContain(uiText.workspaces.close);
    expect(html).not.toContain('Business customers');
    for (const consumer of [AppLayout, CustomerPage, CompanySettingsPage,
      InvoicingPage, ActivityPage, DiagnosticsPage]) {
      expect(consumer).not.toHaveBeenCalled();
    }
    expect(DesktopOperationalLogNotice).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(forbiddenCapabilityRead).not.toHaveBeenCalled();
  });

  it.each(['eky://app/index.html', 'http://127.0.0.1:5173/'])(
    'preserves the normal initial customer view at %s', (href) => {
      vi.stubGlobal('window', { location: { href } });
      const html = renderToStaticMarkup(<App {...createWebAppComposition()} />);
      expect(AppLayout).toHaveBeenCalledOnce();
      expect(CustomerPage).toHaveBeenCalledOnce();
      expect(DesktopOperationalLogNotice).toHaveBeenCalledOnce();
      expect(html).toContain('Business customers');
      expect(html).not.toContain('workspace-selector-title');
    },
  );
});
