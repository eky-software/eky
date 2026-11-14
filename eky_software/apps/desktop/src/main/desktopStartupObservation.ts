// General startup observations: failure cleanup can precede backend readiness.
export const desktopStartupStagePhases = Object.freeze({
  snapshotReady: 'work',
  snapshotStatus: 'work',
  restoreValidation: 'work',
  restoreRelaunchHandling: 'work',
  backendHealth: 'work',
  activeProfileAdmission: 'work',
  sessionIsolation: 'work',
  restoredAcceptance: 'work',
  workspaceAcceptance: 'work',
  registryTransition: 'work',
  packagedFaultGate: 'work',
  buildAcceptance: 'work',
  selectorFreshness: 'work',
  migrationCompletion: 'work',
  schedulerInitialCheck: 'work',
  windowPreparation: 'work',
  windowCreation: 'work',
  startupCatch: 'failure',
  secretDrain: 'cleanup',
  schedulerStop: 'cleanup',
  inspectionShutdown: 'cleanup',
  backendStop: 'cleanup',
  brokerClose: 'cleanup',
  recoveryAdmission: 'recovery',
  recoveryHandling: 'recovery',
} as const);

export type DesktopStartupStage = keyof typeof desktopStartupStagePhases;
export type DesktopStartupSignal = Readonly<{
  stage: DesktopStartupStage;
  phase: typeof desktopStartupStagePhases[DesktopStartupStage];
  event: 'entered' | 'returned';
}>;
export type DesktopStartupObserver = (signal: DesktopStartupSignal) => void;

export function isDesktopStartupStage(value: unknown): value is DesktopStartupStage {
  return typeof value === 'string' && Object.hasOwn(desktopStartupStagePhases, value);
}

// Returned means control returned from the original group, not verified success.
export function emitDesktopStartupObservation(
  observer: DesktopStartupObserver | undefined,
  stage: DesktopStartupStage,
  event: DesktopStartupSignal['event'],
): void {
  try { observer?.(Object.freeze({ stage, phase: desktopStartupStagePhases[stage], event })); }
  catch { /* Observation cannot change startup outcome or authority. */ }
}
