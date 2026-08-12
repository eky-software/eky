import {
  FirstStartUpdateError,
  type FirstStartUpdateFailureStage,
} from './firstStartUpdateCoordinator.js';

export type FirstStartPreMigrationFailureStage = Exclude<
  FirstStartUpdateFailureStage,
  'acceptance' | 'packageCacheRotation'
>;

export const firstStartPreMigrationFailureStages = Object.freeze([
  'preMigrationBuildIdentity',
  'preMigrationCoordinatedJournalTransition',
  'preMigrationCoordinatedPackageValidation',
  'preMigrationDirectSetup',
  'preMigrationInstallerNotApplied',
  'preMigrationJournalConsistency',
  'preMigrationPendingMigrations',
  'preMigrationRecoveryPoint',
  'preMigrationRollback',
  'preMigrationRunningBuildIdentity',
  'preMigrationSecretIdentity',
  'preMigrationStateRead',
] as const satisfies readonly FirstStartPreMigrationFailureStage[]);

const firstStartPreMigrationFailureStageSet = new Set<string>(
  firstStartPreMigrationFailureStages,
);

export function readFirstStartPreMigrationFailureStage(
  error: unknown,
): FirstStartPreMigrationFailureStage | undefined {
  if (
    !(error instanceof FirstStartUpdateError) ||
    !firstStartPreMigrationFailureStageSet.has(error.failureStage)
  ) {
    return undefined;
  }
  return error.failureStage as FirstStartPreMigrationFailureStage;
}
