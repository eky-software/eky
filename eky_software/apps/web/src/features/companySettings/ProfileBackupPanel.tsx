import { useEffect, useState } from 'react';

import type {
  ProfileBackupInspectionSummary,
  ProfileProtectionCapability,
  ProfileProtectionStatus,
} from '../../app/desktopBridge.js';
import { uiText } from '../../i18n/fi.js';
import { ProfileBackupPanelView, type ProfileBackupOperation } from './ProfileBackupPanelView.js';

interface ProfileBackupPanelProps {
  capability?: ProfileProtectionCapability;
}

export function ProfileBackupPanel({
  capability,
}: ProfileBackupPanelProps): React.JSX.Element {
  const [status, setStatus] = useState<ProfileProtectionStatus | null>(
    null,
  );
  const [inspection, setInspection] =
    useState<ProfileBackupInspectionSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(
    null,
  );
  const [operation, setOperation] = useState<ProfileBackupOperation | null>(
    capability === undefined ? null : 'status',
  );

  useEffect(() => {
    let active = true;

    if (capability === undefined) {
      setOperation(null);
      setStatus(null);
      return () => {
        active = false;
      };
    }

    setOperation('status');
    setErrorMessage(null);
    void capability
      .getStatus()
      .then((nextStatus) => {
        if (active) {
          setStatus(nextStatus);
        }
      })
      .catch(() => {
        if (active) {
          setErrorMessage(uiText.companySettings.profileBackupLoadError);
        }
      })
      .finally(() => {
        if (active) {
          setOperation(null);
        }
      });

    return () => {
      active = false;
    };
  }, [capability]);

  async function createBackup(): Promise<void> {
    if (capability === undefined) {
      return;
    }
    await run('backup', async () => {
      const result = await capability.createBackup();
      if (result === 'created') {
        setSuccessMessage(
          uiText.companySettings.profileBackupCreateSuccess,
        );
        setStatus(await capability.getStatus());
      }
    });
  }

  async function inspectBackup(): Promise<void> {
    if (capability === undefined) {
      return;
    }
    await run('inspection', async () => {
      const result = await capability.inspectBackup();
      if (result.status === 'inspected') {
        setInspection(result.summary);
        setSuccessMessage(
          uiText.companySettings.profileBackupInspectSuccess,
        );
      }
    });
  }

  async function createRecoveryPoint(): Promise<void> {
    if (capability === undefined) {
      return;
    }
    await run('recoveryPoint', async () => {
      setStatus(await capability.createRecoveryPoint());
      setSuccessMessage(
        uiText.companySettings.profileRecoveryPointCreateSuccess,
      );
    });
  }

  async function run(kind: ProfileBackupOperation, perform: () => Promise<void>): Promise<void> {
    if (operation !== null) {
      return;
    }
    setOperation(kind);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await perform();
    } catch {
      setErrorMessage(uiText.companySettings.profileBackupOperationError);
    } finally {
      setOperation(null);
    }
  }

  return (
    <ProfileBackupPanelView
      capabilityAvailable={capability !== undefined}
      errorMessage={errorMessage}
      inspection={inspection}
      operation={operation}
      onCreateBackup={createBackup}
      onCreateRecoveryPoint={createRecoveryPoint}
      onInspectBackup={inspectBackup}
      status={status}
      successMessage={successMessage}
    />
  );
}
