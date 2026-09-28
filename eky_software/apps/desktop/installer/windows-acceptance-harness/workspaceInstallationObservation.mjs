const BOUNDARIES = new Set([
  'installation', 'installationWait', 'installedState', 'payload', 'artifactFixture',
  'activityBeforeCommand', 'activityBeforeResult', 'activityBeforeCleanup',
  'sourceProductCommand', 'sourceProductResult', 'sourceProductCleanup',
  'targetProductCommand', 'targetProductResult', 'targetProductCleanup',
  'activityAfterCommand', 'activityAfterResult', 'activityAfterCleanup',
  'rollbackProgressRead', 'nextObservation',
]);
const HEARTBEAT_MS = 60_000;
const MAX_RECORDS = 128;
const MAX_BUSY_COUNT = 1_000_000;
const UNOBSERVED = Object.freeze({ step: (_boundary, task) => task(), busy() {} });

// Only observation: no deadline, cancellation, process control or result authority.
export async function observeWorkspaceInstallation(role, report, task, {
  schedule = setInterval, cancel = clearInterval,
} = {}) {
  if (!['source', 'target'].includes(role) || typeof report !== 'function') return task(UNOBSERVED);
  const root = { phase: 'installation', status: 'started' };
  let current = root;
  let busyCount = 0;
  let records = 0;
  let finished = false;
  let timer;
  const seen = new Set();

  function publish(observation) {
    if (finished || records >= MAX_RECORDS) return;
    records++;
    try {
      report(Object.freeze({ schemaVersion: 1, operation: 'workspaceInstallationObservation',
        role, phase: current.phase, status: current.status,
        observation: records === MAX_RECORDS ? 'truncated' : observation, busyCount }));
    } catch { /* Diagnostic delivery must not change the observed operation. */ }
  }
  function first() {
    const key = `${current.phase}:${current.status}`;
    if (seen.has(key)) return;
    seen.add(key);
    publish('first');
  }
  const observation = Object.freeze({
    async step(boundary, action) {
      if (!BOUNDARIES.has(boundary)) return action();
      const parent = current;
      const frame = { phase: boundary, status: 'started' };
      current = frame;
      first();
      try {
        const value = await action();
        frame.status = 'completed';
        first();
        return value;
      } catch (error) {
        frame.status = 'failed';
        first();
        throw error;
      } finally { current = parent; }
    },
    busy() { busyCount = Math.min(MAX_BUSY_COUNT, busyCount + 1); },
  });

  first();
  try {
    timer = schedule(() => publish('heartbeat'), HEARTBEAT_MS);
    timer?.unref?.();
  } catch { /* A missing heartbeat is not a failed installation. */ }
  try {
    const value = await task(observation);
    root.status = 'completed';
    return value;
  } catch (error) {
    root.status = 'failed';
    throw error;
  } finally {
    current = root;
    publish('terminal');
    finished = true;
    try { if (timer !== undefined) cancel(timer); } catch { /* No result authority. */ }
  }
}
