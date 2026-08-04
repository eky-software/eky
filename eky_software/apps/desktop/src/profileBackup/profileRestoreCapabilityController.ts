import type { ProfileBackupInspectionSummary } from './profileBackupInspectionTypes.js';
import type { BackupPasswordWindowController } from './passwordWindow/backupPasswordWindow.js';
import type {
  ActivatePreparedProfileRestoreResult,
  PrepareProfileRestoreResult,
  ProfileProtectionStatus,
} from './portableProfileBackupTypes.js';
import type { ProfileRestoreActivationService } from './restore/profileRestoreActivationService.js';
import type {
  PreparedProfileRestore,
  ProfileRestoreStagingService,
} from './restore/profileRestoreStagingService.js';

interface ProfileRestoreCapabilityControllerOptions {
  confirmActivation(
    restore: Pick<
      PreparedProfileRestore,
      'summary' | 'targetDisposition'
    >,
  ): Promise<boolean>;
  confirmReplacement(
    summary: ProfileBackupInspectionSummary,
  ): Promise<boolean>;
  passwordWindow: BackupPasswordWindowController;
  restoreActivationService: Pick<
    ProfileRestoreActivationService,
    'activate'
  >;
  restoreStagingService: Pick<
    ProfileRestoreStagingService,
    'discardPreparedRestore' | 'inspect' | 'stage'
  >;
  selectSource(): Promise<string | null>;
  showSafeError(): void;
}

export interface ProfileRestoreCapabilityController {
  activate(): Promise<ActivatePreparedProfileRestoreResult>;
  getOperationState(): ProfileProtectionStatus['restoreOperationState'];
  prepare(): Promise<PrepareProfileRestoreResult>;
}

export function createProfileRestoreCapabilityController(
  options: ProfileRestoreCapabilityControllerOptions,
): ProfileRestoreCapabilityController {
  let pendingRestore:
    | {
        inspectionId: string;
        summary: ProfileBackupInspectionSummary;
      }
    | undefined;
  let operationState: ProfileProtectionStatus['restoreOperationState'] =
    'idle';

  return {
    async activate() {
      const restore = pendingRestore;
      if (restore === undefined) {
        throw new Error('PROFILE_RESTORE_NOT_PREPARED');
      }

      operationState = 'restoring';
      if (!(await options.confirmReplacement(restore.summary))) {
        pendingRestore = undefined;
        operationState = 'idle';
        return 'cancelled';
      }

      const password = await options.passwordWindow.requestPassword(
        'enter',
      );
      if (password === null) {
        pendingRestore = undefined;
        operationState = 'idle';
        return 'cancelled';
      }

      pendingRestore = undefined;
      let prepared: PreparedProfileRestore | undefined;
      try {
        prepared = await options.restoreStagingService.stage({
          inspectionId: restore.inspectionId,
          password,
        });
        if (!(await options.confirmActivation(prepared))) {
          await options.restoreStagingService.discardPreparedRestore(
            prepared.operationId,
          );
          operationState = 'idle';
          return 'cancelled';
        }

        return await options.restoreActivationService.activate(
          prepared.operationId,
        );
      } catch {
        if (prepared !== undefined) {
          await options.restoreStagingService
            .discardPreparedRestore(prepared.operationId)
            .catch(() => undefined);
        }
        operationState = 'idle';
        options.showSafeError();
        throw new Error('PROFILE_RESTORE_ACTIVATION_FAILED');
      }
    },
    getOperationState() {
      return operationState;
    },
    async prepare() {
      operationState = 'restoring';
      pendingRestore = undefined;
      const sourcePath = await options.selectSource();
      if (sourcePath === null) {
        operationState = 'idle';
        return { status: 'cancelled' };
      }
      const password = await options.passwordWindow.requestPassword(
        'enter',
      );
      if (password === null) {
        operationState = 'idle';
        return { status: 'cancelled' };
      }

      try {
        const inspection = await options.restoreStagingService.inspect({
          containerPath: sourcePath,
          password,
        });
        pendingRestore = inspection;
        operationState = 'ready';
        return {
          status: 'inspected',
          summary: inspection.summary,
        };
      } catch {
        operationState = 'idle';
        options.showSafeError();
        throw new Error('PROFILE_RESTORE_INSPECTION_FAILED');
      }
    },
  };
}
