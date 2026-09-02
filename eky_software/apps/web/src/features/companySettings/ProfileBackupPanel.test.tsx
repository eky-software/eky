import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { uiText } from '../../i18n/fi.js';
import { ProfileBackupPanelView } from './ProfileBackupPanelView.js';

describe('ProfileBackupPanelView', () => {
  it('shows only desktop availability information in browser runtime', () => {
    const html = renderView({
      capabilityAvailable: false,
    });

    expect(html).toContain(
      uiText.companySettings.profileBackupDesktopOnly,
    );
    expect(html).not.toContain(
      uiText.companySettings.profileBackupCreate,
    );
    expect(html).not.toContain(
      uiText.companySettings.profileBackupWorkspaceRestoreInfo,
    );
  });

  it('shows portable backup and recovery point controls in desktop', () => {
    const html = renderView({ status: availableStatus });

    expect(html).toContain(uiText.companySettings.profileBackupCreate);
    expect(html).toContain(uiText.companySettings.profileBackupInspect);
    expect(html).toContain(
      uiText.companySettings.profileBackupWorkspaceRestoreInfo,
    );
    expect(html).toContain(
      uiText.companySettings.profileRecoveryPointCreate,
    );
    expect(html).toContain('3');
    expect(html).not.toContain('lastSafeErrorCode');
    expect(html).not.toContain('C:\\');
  });

  it('shows only an inspected safe backup summary', () => {
    const html = renderView({
      inspection: inspectionSummary,
      status: availableStatus,
    });

    expect(html).toContain(
      uiText.companySettings.profileBackupInspectionHeading,
    );
    expect(html).toContain('0.1.0');
    expect(html).toContain('4');
    expect(html).not.toContain('company-id');
    expect(html).not.toContain('operationId');
    expect(html).not.toContain('sha256');
  });

  it('fails closed when operating-system encryption is unavailable', () => {
    const html = renderView({
      status: {
        ...availableStatus,
        recoveryPoints: {
          ...availableStatus.recoveryPoints,
          availability: 'unavailable',
        },
      },
    });

    expect(html).toContain(
      uiText.companySettings.profileRecoveryPointsEncryptionUnavailable,
    );
    expect(html).toContain('disabled=""');
  });
});

const inspectionSummary = {
  appVersion: '0.1.0',
  compatibilityStatus: 'compatible' as const,
  createdAt: '2026-08-04T18:00:00.000Z',
  databaseHealth: 'healthy' as const,
  documentCount: 4,
  formatVersion: 1 as const,
  profileMatchStatus: 'same' as const,
  totalBusinessByteSize: 1024,
};

const availableStatus = {
  portableBackup: {
    latestSuccessfulPortableBackupAt: '2026-08-04T18:00:00.000Z',
    operationState: 'idle' as const,
  },
  recoveryPoints: {
    availability: 'available' as const,
    budgetState: 'withinBudget' as const,
    latestValidatedGoodAt: '2026-08-04T17:00:00.000Z',
    nextAutomaticCheckAt: '2026-08-05T17:00:00.000Z',
    operationState: 'idle' as const,
    pointCount: 3,
  },
};

function renderView(
  overrides: Partial<
    React.ComponentProps<typeof ProfileBackupPanelView>
  > = {},
): string {
  return renderToStaticMarkup(
    <ProfileBackupPanelView
      capabilityAvailable
      errorMessage={null}
      inspection={null}
      isBusy={false}
      onCreateBackup={vi.fn(async () => undefined)}
      onCreateRecoveryPoint={vi.fn(async () => undefined)}
      onInspectBackup={vi.fn(async () => undefined)}
      status={null}
      successMessage={null}
      {...overrides}
    />,
  );
}
