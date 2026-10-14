import { basename } from 'node:path';
import contract from '../windows-process-supervisor/msiWindowObservationContract.json' with { type: 'json' };

export { contract as msiWindowEvidenceContract };
const failure = () => new Error('MSI_WINDOW_EVIDENCE_INVALID');
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const integer = (value, minimum, maximum) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;

export function validateMsiWindowEvidence(value, binding, sourcePath) {
  if (!exact(value, ['schemaVersion', 'operation', 'binding', 'runNonce', 'scenario', 'artifactDescriptorSha256',
    'sequence', 'elapsedMs', 'clients']) || value.schemaVersion !== contract.schemaVersion || value.operation !== contract.operation ||
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
      if (!exact(window, ['role', 'text', 'enabled']) || !['title', 'message', 'button'].includes(window.role) ||
        typeof window.text !== 'string' || window.text.length > contract.maximumTextCharacters ||
        typeof window.enabled !== 'boolean') throw failure();
      characters += window.text.length;
      windows++;
    }
  }
  if (characters > contract.maximumTotalCharacters || windows > contract.maximumWindows) throw failure();
  return value;
}
