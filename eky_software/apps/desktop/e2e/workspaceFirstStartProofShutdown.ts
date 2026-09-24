// Cleanup still runs after shutdown fails, but diagnostics cannot replace the
// primary failure or wait for an experiment whose prerequisite did not finish.
export async function runFirstStartProofShutdown(input: {
  beforeShutdown?(): Promise<void>;
  shutdown(): Promise<void>;
  cleanup(shutdownFailed: boolean): Promise<void>;
  reportSecondaryFailure(): Promise<void> | void;
}): Promise<void> {
  let failed = false;
  let primary: unknown;
  const recordFailure = async (error: unknown) => {
    if (!failed) {
      failed = true;
      primary = error;
    } else {
      try { await input.reportSecondaryFailure(); } catch { /* Preserve primary. */ }
    }
  };
  try { await input.beforeShutdown?.(); } catch (error) {
    await recordFailure(error);
  }
  let shutdownFailed = false;
  try { await input.shutdown(); } catch (error) {
    shutdownFailed = true;
    await recordFailure(error);
  }
  try { await input.cleanup(shutdownFailed); } catch (error) {
    await recordFailure(error);
  }
  if (failed) throw primary;
}
