import type { ProfileRestoreActivationJournal } from '../profileBackup/restore/profileRestoreActivationJournal.js';
import type { ProfileRestoreStartupMode } from '../profileBackup/restore/profileRestoreStartupRecovery.js';
import type { DirectSetupMigrationRecovery } from './directSetupMigrationRecovery.js';
import type { MigrationStartupInspection } from './firstStartUpdateCoordinator.js';
import {
  resolveStartupRecoveryAuthority,
  type StartupRecoveryAuthority,
} from './startupRecoveryAuthority.js';
import type { UpdateJournal } from './updateJournal.js';

const sha256Pattern = /^[0-9a-f]{64}$/;

export type RestoreFirstStartMigrationDecision =
  | 'authorized'
  | 'notRequired';

export class RestoreFirstStartMigrationAuthorityError extends Error {
  constructor() {
    super('The restored profile cannot be migrated safely.');
    this.name = 'RestoreFirstStartMigrationAuthorityError';
  }
}

export function authorizeRestoreFirstStartForwardMigrations(input: {
  directSetupRecovery: Readonly<DirectSetupMigrationRecovery> | undefined;
  inspection: Readonly<MigrationStartupInspection>;
  profileRestoreJournal:
    | Readonly<ProfileRestoreActivationJournal>
    | undefined;
  profileRestoreStartupMode: ProfileRestoreStartupMode;
  startupRecoveryAuthority: StartupRecoveryAuthority;
  updateJournal: Readonly<UpdateJournal> | undefined;
}): RestoreFirstStartMigrationDecision {
  const currentAuthority = resolveStartupRecoveryAuthority({
    directSetupRecovery: input.directSetupRecovery,
    profileRestoreJournal: input.profileRestoreJournal,
    updateJournal: input.updateJournal,
  });

  if (currentAuthority !== input.startupRecoveryAuthority) {
    throw new RestoreFirstStartMigrationAuthorityError();
  }

  if (input.startupRecoveryAuthority !== 'profileRestore') {
    return 'notRequired';
  }

  if (input.inspection.pendingMigrationCount === 0) {
    return 'notRequired';
  }

  if (
    input.profileRestoreStartupMode !== 'validateRestoredProfile' ||
    input.profileRestoreJournal?.phase !== 'validationStarting' ||
    input.inspection.profileState !== 'existing' ||
    !Number.isSafeInteger(input.inspection.appliedMigrationCount) ||
    input.inspection.appliedMigrationCount < 1 ||
    !Number.isSafeInteger(input.inspection.pendingMigrationCount) ||
    input.inspection.pendingMigrationCount < 1 ||
    !sha256Pattern.test(input.inspection.migrationChainIdentity)
  ) {
    throw new RestoreFirstStartMigrationAuthorityError();
  }

  return 'authorized';
}
