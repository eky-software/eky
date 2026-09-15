export const INSPECTOR_TIMEOUT_MILLISECONDS = 30_000;
export const SEMANTIC_CLEANUP_TIMEOUT_MILLISECONDS = 120_000;
export const DIRECT_PROCESS_TERMINATION_TIMEOUT_MILLISECONDS = 5_000;

export function areProductProcessesAbsent(runtime) {
  if (runtime === null) return true;
  try { return runtime.outcome().productProcessAbsent === true; }
  catch { return false; }
}
