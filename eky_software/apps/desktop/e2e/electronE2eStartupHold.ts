import type { ElectronE2eConfig } from './electronE2eConfig.js';

export interface ElectronE2eStartupHoldSnapshot {
  readonly held: boolean;
  readonly runtimeInstanceId: string;
}

export function createElectronE2eStartupHold(
  { startupMode, runtimeInstanceId }: Pick<
    ElectronE2eConfig,
    'startupMode' | 'runtimeInstanceId'
  >,
) {
  let pending: Promise<never> | undefined;

  return {
    afterAppReady(): Promise<never> | undefined {
      switch (startupMode) {
        case 'normal':
        case 'backendStartFailure':
          return undefined;
        case 'pendingFirstWindow':
          // Only the public firstWindow waiter owns the timeout; app quit stays available.
          pending ??= new Promise<never>(() => {});
          return pending;
        default:
          throw new Error('ELECTRON_E2E_STARTUP_MODE_INVALID');
      }
    },
    snapshot(): ElectronE2eStartupHoldSnapshot {
      return Object.freeze({ held: pending !== undefined, runtimeInstanceId });
    },
  };
}
