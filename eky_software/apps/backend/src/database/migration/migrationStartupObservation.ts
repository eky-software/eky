export const migrationStartupStages = [
  'manifestRead',
  'initialAttestation',
  'historyPreparation',
  'migrationExecution',
  'finalAttestation',
  'postRunInspection',
  'identityRead',
] as const;

export type MigrationStartupStage = (typeof migrationStartupStages)[number];
export type MigrationStartupPhase = 'entered' | 'returned';
export type MigrationStartupObserver = (
  stage: MigrationStartupStage,
  phase: MigrationStartupPhase,
) => void;

// Internal synchronous observation only. Callers must not perform I/O or wait
// for acknowledgements here; an observer never authorizes migration work.
export function observeMigrationStartupStep<T>(
  observer: MigrationStartupObserver | undefined,
  stage: MigrationStartupStage,
  work: () => T,
): T {
  if (observer === undefined) return work();
  const record = (phase: MigrationStartupPhase): void => {
    try { observer(stage, phase); }
    catch { /* Optional evidence cannot change the original outcome. */ }
  };
  record('entered');
  const result = work();
  record('returned');
  return result;
}
