import { readFile } from 'node:fs/promises';
import { readWindowsAcceptanceSupervisorResult } from '../windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';

const HANDOFF_PHASES = Object.freeze([
  'bootstrapExited', 'helperStarted', 'helperAliveAfterBootstrapExit',
  'helperTerminalReceived', 'bootstrapClosed',
]);

function validateHandoffEvidence(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'phases,schemaVersion' ||
      value.schemaVersion !== 1 || !Array.isArray(value.phases) ||
      value.phases.length < 1 || value.phases.length > HANDOFF_PHASES.length) return false;
  const rejectedBootstrap = value.phases.length === 2 &&
    value.phases[0] === 'bootstrapExited' && value.phases[1] === 'bootstrapClosed';
  return rejectedBootstrap || value.phases.every((phase, index) => phase === HANDOFF_PHASES[index]);
}

// Read only after supervisor completion. Diagnostics never authorize success,
// cleanup or a retry, and never print raw result files or exception messages.
export async function readRollbackBootstrapContractDiagnostics(resultPath, handoffPath, expected) {
  const diagnostic = { schemaVersion: 1, operation: 'rollbackBootstrapContract',
    supervisorResult: 'unavailableOrInvalid', handoffEvidence: 'unavailableOrInvalid' };
  try {
    const result = await readWindowsAcceptanceSupervisorResult(resultPath, expected);
    Object.assign(diagnostic, { supervisorResult: 'validated', status: result.status,
      processResultCode: result.processResultCode, workerResultCode: result.workerResultCode,
      cleanupResultCode: result.cleanupResultCode, processTreeAbsent: result.processTreeAbsent });
  } catch {
    // The original test still validates its mandatory result independently.
  }
  try {
    const serialized = await readFile(handoffPath, 'utf8');
    if (serialized.length <= 1024) {
      const evidence = JSON.parse(serialized);
      if (validateHandoffEvidence(evidence)) Object.assign(diagnostic, {
        handoffEvidence: 'validated', lastHandoffPhase: evidence.phases.at(-1),
        handoffPhaseCount: evidence.phases.length,
      });
    }
  } catch {
    // A missing or partial observation is not a completed phase.
  }
  return diagnostic;
}
