import supervisorCommandBudgets from '../installer/windows-process-supervisor/supervisorCommandBudgets.json' with { type: 'json' };

export const packagedSmokeTimeoutMilliseconds = 120_000;
export const packagedSmokeWorkflowTimeoutMilliseconds = 300_000;
export const packagedSmokeJobStartupReserveMilliseconds = 1_000;
export const packagedSmokeJobPublicationReserveMilliseconds = supervisorCommandBudgets.exitReserveMilliseconds;
export const packagedSmokeJobTerminationReserveMilliseconds = 1_000;
export const packagedSmokeJobCallerReserveMilliseconds = packagedSmokeJobStartupReserveMilliseconds +
  packagedSmokeJobPublicationReserveMilliseconds + packagedSmokeJobTerminationReserveMilliseconds;
