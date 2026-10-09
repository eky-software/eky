import type { DesktopBackendFailureCode } from './backendMessages.js';

export type DesktopBackendStartupFailureCode = DesktopBackendFailureCode
  | 'BACKEND_EXITED_BEFORE_READY'
  | 'BACKEND_READINESS_TIMEOUT'
  | 'DESKTOP_START_FAILED';

export interface DesktopBackendStartupOwnership {
  readonly processState: 'absent' | 'unknown';
  readonly migrationGateSettled: boolean;
  readonly reservationReclaimed: boolean;
}

export class DesktopBackendStartupError extends Error {
  readonly ownership: Readonly<DesktopBackendStartupOwnership>;

  constructor(code: DesktopBackendStartupFailureCode, ownership: DesktopBackendStartupOwnership) {
    super(code);
    this.name = 'DesktopBackendStartupError';
    this.ownership = Object.freeze({ ...ownership });
  }
}

export class DesktopBackendStartupStoppedError extends DesktopBackendStartupError {
  constructor() {
    super('BACKEND_MIGRATION_STARTUP_GATE_FAILED', {
      processState: 'absent', migrationGateSettled: true, reservationReclaimed: true,
    });
    this.name = 'DesktopBackendStartupStoppedError';
    this.message = 'The backend startup runtime was stopped by the desktop coordinator.';
  }
}
