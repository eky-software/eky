import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { uiText } from '../../i18n/fi.js';
import { InvoicePdfArchivePanelView } from './InvoicePdfArchivePanel.js';

describe('InvoicePdfArchivePanelView', () => {
  it('explains that the capability is desktop-only in browser runtime', () => {
    const html = renderView({
      capabilityAvailable: false,
      status: null,
    });

    expect(html).toContain(
      uiText.companySettings.invoicePdfArchiveDesktopOnly,
    );
    expect(html).not.toContain(
      uiText.companySettings.invoicePdfArchiveChooseDirectory,
    );
  });

  it('shows enabled archive status without exposing a directory path', () => {
    const html = renderView({
      status: {
        displayName: 'Laskuarkisto',
        enabled: true,
        lastArchivedAt: '2026-08-03T20:00:00.000Z',
        lastSafeErrorCode: null,
        pendingCount: 0,
      },
    });

    expect(html).toContain('Laskuarkisto');
    expect(html).toContain(uiText.companySettings.invoicePdfArchiveEnabled);
    expect(html).toContain(
      uiText.companySettings.invoicePdfArchiveChangeDirectory,
    );
    expect(html).toContain(
      uiText.companySettings.invoicePdfArchiveOpenDirectory,
    );
    expect(html).toContain(uiText.companySettings.invoicePdfArchiveDisable);
    expect(html).not.toContain('C:\\');
  });

  it('shows retry and a safe conflict message for pending copies', () => {
    const html = renderView({
      status: {
        displayName: 'Laskuarkisto',
        enabled: true,
        lastArchivedAt: null,
        lastSafeErrorCode: 'ARCHIVE_FILE_CONFLICT',
        pendingCount: 1,
      },
    });

    expect(html).toContain(uiText.companySettings.invoicePdfArchiveRetry);
    expect(html).toContain(uiText.companySettings.invoicePdfArchiveConflict);
    expect(html).not.toContain('ARCHIVE_FILE_CONFLICT');
  });

  it('keeps retry unavailable while archive is disabled', () => {
    const html = renderView({
      status: {
        displayName: null,
        enabled: false,
        lastArchivedAt: null,
        lastSafeErrorCode: 'ARCHIVE_DIRECTORY_UNAVAILABLE',
        pendingCount: 2,
      },
    });

    expect(html).toContain(uiText.companySettings.invoicePdfArchiveRetry);
    expect(html).toContain('disabled=""');
    expect(html).toContain(
      uiText.companySettings.invoicePdfArchivePendingError,
    );
  });
});

function renderView(
  overrides: Partial<
    React.ComponentProps<typeof InvoicePdfArchivePanelView>
  > = {},
): string {
  return renderToStaticMarkup(
    <InvoicePdfArchivePanelView
      capabilityAvailable
      errorMessage={null}
      isBusy={false}
      onChoose={vi.fn(async () => undefined)}
      onDisable={vi.fn(async () => undefined)}
      onOpen={vi.fn(async () => undefined)}
      onRetry={vi.fn(async () => undefined)}
      status={null}
      {...overrides}
    />,
  );
}
