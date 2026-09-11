import { INSPECTOR_TIMEOUT_MILLISECONDS, SEMANTIC_CLEANUP_TIMEOUT_MILLISECONDS,
  DIRECT_PROCESS_TERMINATION_TIMEOUT_MILLISECONDS } from './upgradeRollbackPostSupervisorWindowsRuntime.mjs';
import { CALLER_RESULT_TIMEOUT_MS, CALLER_RESULT_TERMINATION_MS } from './callerResultProcess.mjs';
import commandBudgets from '../windows-process-supervisor/supervisorCommandBudgets.json' with { type: 'json' };
const SUPERVISOR_EXIT_RESERVE_MS = commandBudgets.exitReserveMilliseconds;

// These are sequential reservations, not successful-readiness waits.
export const LEGACY_SUPERVISOR_TIMEOUT_MS = 600_000;
export const LEGACY_SUPERVISOR_CLEANUP_MS = 30_000;
export const LEGACY_PHASE_WRITER_TIMEOUT_MS = 600_000;
export const LEGACY_PHASE_WRITER_TERMINATION_MS = 5_000;
export const LEGACY_FILESYSTEM_TIMEOUT_MS = Object.freeze({
  inventory: 30_000,
  materialize: 120_000,
  semantic: 30_000,
  artifact: 30_000,
  remove: 30_000,
});
export const LEGACY_FILESYSTEM_TERMINATION_MS = 5_000;
const productInspection = 2 * (INSPECTOR_TIMEOUT_MILLISECONDS + DIRECT_PROCESS_TERMINATION_TIMEOUT_MILLISECONDS);
const productCleanup = productInspection + 2 * (SEMANTIC_CLEANUP_TIMEOUT_MILLISECONDS + DIRECT_PROCESS_TERMINATION_TIMEOUT_MILLISECONDS);
// Precondition, supervisor, post-failure inspection/cleanup/reinspection,
// required result prepare/publish/verify, writer stop and six filesystem calls.
export const LEGACY_COMMAND_RESERVATION_MS =
  productInspection + LEGACY_SUPERVISOR_TIMEOUT_MS + 2 * productInspection + productCleanup +
  3 * (CALLER_RESULT_TIMEOUT_MS + CALLER_RESULT_TERMINATION_MS) + LEGACY_PHASE_WRITER_TERMINATION_MS +
  2 * (LEGACY_FILESYSTEM_TIMEOUT_MS.inventory + LEGACY_FILESYSTEM_TERMINATION_MS) +
  ['materialize', 'semantic', 'artifact', 'remove'].reduce((sum, key) =>
    sum + LEGACY_FILESYSTEM_TIMEOUT_MS[key] + LEGACY_FILESYSTEM_TERMINATION_MS, 0) +
  // Ten product calls and one scenario host. The first forced host stop blocks
  // all later product operations, so only one additional stop reserve is possible.
  12 * SUPERVISOR_EXIT_RESERVE_MS;
export const LEGACY_LIFECYCLE_STEP_MINUTES = 27;
export const LEGACY_SUPERVISOR_BUILD_MINUTES = 3;
export const LEGACY_CONSUMER_JOB_MINUTES = 37;
