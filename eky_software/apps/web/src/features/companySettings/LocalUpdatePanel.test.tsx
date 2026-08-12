import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { LocalUpdateStatus } from '../../app/desktopBridge.js';
import { uiText } from '../../i18n/fi.js';
import { LocalUpdatePanelView } from './LocalUpdatePanel.js';

describe('LocalUpdatePanelView', () => {
  it('keeps local package operations unavailable in browser runtime', () => {
    const html = renderView({ capabilityAvailable: false });

    expect(html).toContain(uiText.companySettings.localUpdateUnavailable);
    expect(html).not.toContain(uiText.companySettings.localUpdateStart);
    expect(html).not.toContain(uiText.companySettings.localUpdateSelectCurrent);
  });

  it('shows bounded current and candidate identities without paths', () => {
    const html = renderView({ status });

    expect(html).toContain('0.1.0-alpha.1');
    expect(html).toContain('0.1.0-alpha.2');
    expect(html).toContain('0.1.2');
    expect(html).toContain(uiText.companySettings.localUpdateReady);
    expect(html).toContain(uiText.companySettings.localUpdateStart);
    expect(html).toContain(uiText.companySettings.localUpdateDiscard);
    expect(html).toContain(
      uiText.companySettings.localUpdateUnsignedWarning,
    );
    expect(html).not.toMatch(/C:\\|packageSha256|runtimeSession/i);
  });

  it('requires the exact rollback package before enabling update start', () => {
    const html = renderView({
      status: { ...status, currentRollbackPackage: 'missing' },
    });

    expect(html).toContain(uiText.companySettings.localUpdateSelectCurrent);
    expect(html).toContain(uiText.companySettings.localUpdateMissing);
    expect(html).toMatch(
      new RegExp(`<button[^>]*disabled=""[^>]*>${uiText.companySettings.localUpdateStart}</button>`),
    );
  });

  it('shows only the safe generic processing error', () => {
    const html = renderView({
      errorMessage: uiText.companySettings.localUpdateError,
    });

    expect(html).toContain(uiText.companySettings.localUpdateError);
    expect(html).not.toContain('LOCAL_UPDATE_OPERATION_FAILED');
  });
});

const status: LocalUpdateStatus = {
  architecture: 'x64',
  candidate: {
    appVersion: '0.1.0-alpha.2',
    buildRevision: 'abcdef012345',
    msiProductVersion: '0.1.2',
    packageFingerprint: 'abcdef012345',
    releaseChannel: 'pilot',
    role: 'candidate',
    signingStatus: 'unsigned-prototype',
  },
  current: {
    appVersion: '0.1.0-alpha.1',
    buildRevision: '123456789abc',
    msiProductVersion: '0.1.1',
    releaseChannel: 'pilot',
  },
  currentRollbackPackage: 'ready',
  phase: 'idle',
  recoveryPointState: 'notStarted',
  signingStatus: 'unsigned-prototype',
};

function renderView(
  overrides: Partial<React.ComponentProps<typeof LocalUpdatePanelView>> = {},
): string {
  return renderToStaticMarkup(
    <LocalUpdatePanelView
      capabilityAvailable
      errorMessage={null}
      isLoading={false}
      onConfirm={vi.fn(async () => undefined)}
      onDiscard={vi.fn(async () => undefined)}
      onSelect={vi.fn(async () => undefined)}
      operation={null}
      status={null}
      {...overrides}
    />,
  );
}
