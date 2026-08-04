import { useEffect, useState } from 'react';

import type {
  ProfileBackupInspectionSummary,
  ProfileProtectionCapability,
  ProfileProtectionStatus,
} from '../../app/desktopBridge.js';
import { uiText } from '../../i18n/fi.js';
import { ProfileBackupPanelView } from './ProfileBackupPanelView.js';

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
  const [restoreInspection, setRestoreInspection] =
    useState<ProfileBackupInspectionSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(
    null,
  );
  const [isBusy, setIsBusy] = useState(capability !== undefined);

  useEffect(() => {
    let active = true;

    if (capability === undefined) {
      setIsBusy(false);
      setStatus(null);
      return () => {
        active = false;
      };
    }

    setIsBusy(true);
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
          setIsBusy(false);
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
    await run(async () => {
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
    await run(async () => {
      const result = await capability.inspectBackup();
      if (result.status === 'inspected') {
        setInspection(result.summary);
        setSuccessMessage(
          uiText.companySettings.profileBackupInspectSuccess,
        );
      }
    });
  }

  async function prepareRestore(): Promise<void> {
    if (capability === undefined) {
      return;
    }
    await run(async () => {
      const result = await capability.prepareRestore();
      if (result.status === 'inspected') {
        setRestoreInspection(result.summary);
      }
    });
  }

  async function activateRestore(): Promise<void> {
    if (capability === undefined) {
      return;
    }
    await run(async () => {
      const result = await capability.activatePreparedRestore();
      setRestoreInspection(null);
      if (result === 'relaunching') {
        setSuccessMessage(
          uiText.companySettings.profileRestoreRestarting,
        );
      }
    });
  }

  async function createRecoveryPoint(): Promise<void> {
    if (capability === undefined) {
      return;
    }
    await run(async () => {
      setStatus(await capability.createRecoveryPoint());
      setSuccessMessage(
        uiText.companySettings.profileRecoveryPointCreateSuccess,
      );
    });
  }

  async function run(operation: () => Promise<void>): Promise<void> {
    if (isBusy) {
      return;
    }
    setIsBusy(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await operation();
    } catch {
      setRestoreInspection(null);
      setErrorMessage(uiText.companySettings.profileBackupOperationError);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <ProfileBackupPanelView
      capabilityAvailable={capability !== undefined}
      errorMessage={errorMessage}
      inspection={inspection}
      isBusy={isBusy}
      onActivateRestore={activateRestore}
      onCreateBackup={createBackup}
      onCreateRecoveryPoint={createRecoveryPoint}
      onInspectBackup={inspectBackup}
      onPrepareRestore={prepareRestore}
      restoreInspection={restoreInspection}
      status={status}
      successMessage={successMessage}
    />
  );
}
