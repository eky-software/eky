import { basename } from 'node:path';
import contract from '../windows-process-supervisor/msiWindowObservationContract.json' with { type: 'json' };

export { contract as msiWindowEvidenceContract };
const failure = () => new Error('MSI_WINDOW_EVIDENCE_INVALID');
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const integer = (value, minimum, maximum) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;

function validateResources(value) {
  if (value === null) return;
  if (!exact(value, ['status', 'phase', 'selectionIdentity', 'resourceCount', 'nativeCode', 'endSessionCode', 'processes']) ||
    !contract.resourceStatuses.includes(value.status) || !contract.resourcePhases.includes(value.phase) ||
    (value.selectionIdentity !== null && (typeof value.selectionIdentity !== 'string' || value.selectionIdentity.length !== 64 ||
      !/^[a-f0-9]{64}$/.test(value.selectionIdentity))) ||
    !integer(value.resourceCount, 0, contract.maximumResourceFiles) ||
    [value.nativeCode, value.endSessionCode].some(code => code !== null && !integer(code, 0, 0xffffffff)) ||
    !Array.isArray(value.processes) || value.processes.length > contract.maximumClients ||
    (['unavailable', 'cancelled'].includes(value.status) && value.processes.length > 0) ||
    (value.status === 'observed' && (value.nativeCode !== 0 || value.endSessionCode !== 0 ||
      value.selectionIdentity === null || value.resourceCount < 1))) throw failure();
  const identities = new Set();
  for (const process of value.processes) {
    if (!exact(process, ['processId', 'startTimeLow', 'startTimeHigh', 'membership']) ||
      !integer(process.processId, 1, 0xffffffff) || !integer(process.startTimeLow, 0, 0xffffffff) ||
      !integer(process.startTimeHigh, 0, 0xffffffff) || (process.startTimeLow === 0 && process.startTimeHigh === 0) ||
      !contract.resourceMemberships.includes(process.membership)) throw failure();
    const identity = `${process.processId}:${process.startTimeLow}:${process.startTimeHigh}`;
    if (identities.has(identity)) throw failure();
    identities.add(identity);
  }
}

export function validateMsiWindowEvidence(value, binding, sourcePath) {
  const keys = ['schemaVersion', 'operation', 'binding', 'runNonce', 'scenario', 'artifactDescriptorSha256',
    'sequence', 'elapsedMs', 'clients'];
  if (value?.schemaVersion === contract.schemaVersion) keys.push('resources');
  if (!exact(value, keys) || ![1, 2, contract.schemaVersion].includes(value.schemaVersion) || value.operation !== contract.operation ||
    !exact(value.binding, ['kind', 'runId', 'attempt', 'job', 'sourceRevision']) || value.binding.kind !== 'github' ||
    ['runId', 'attempt', 'job', 'sourceRevision'].some(key => value.binding[key] !== binding[key]) ||
    !/^[a-f0-9]{64}$/.test(value.runNonce) || !/^[a-f0-9]{64}$/.test(value.artifactDescriptorSha256) ||
    !['packagedWorkspaceSuccess', 'packagedWorkspaceFaultRollback'].includes(value.scenario) ||
    !integer(value.sequence, 1, contract.maximumSamples) || !integer(value.elapsedMs, 0, 14_400_000) ||
    basename(sourcePath) !== `${contract.filenamePrefix}${String(value.sequence).padStart(3, '0')}.private.json` ||
    !Array.isArray(value.clients) || value.clients.length > contract.maximumClients) throw failure();
  let characters = 0;
  let windows = 0;
  for (const client of value.clients) {
    if (!exact(client, ['processId', 'status', 'windows']) || !integer(client.processId, 0, 0xffffffff) ||
      !['observed', 'partial', 'unavailable'].includes(client.status) || !Array.isArray(client.windows) ||
      (client.status === 'unavailable' && client.windows.length > 0)) throw failure();
    for (const window of client.windows) {
      const roles = value.schemaVersion === 1 ? ['title', 'message', 'button'] : ['title', 'message', 'button', 'application'];
      if (!exact(window, ['role', 'text', 'enabled']) || !roles.includes(window.role) ||
        typeof window.text !== 'string' || window.text.length > contract.maximumTextCharacters ||
        typeof window.enabled !== 'boolean') throw failure();
      characters += window.text.length;
      windows++;
    }
  }
  if (characters > contract.maximumTotalCharacters || windows > contract.maximumWindows) throw failure();
  if (value.schemaVersion === contract.schemaVersion) validateResources(value.resources);
  return value;
}
