import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import contract from '../windows-process-supervisor/msiWindowObservationContract.json' with { type: 'json' };

export async function publishWorkspaceMsiResourceSelection({ directory, root, request, scenario, inventory, files }, publish = writeFile) {
  if (!Array.isArray(files) || files.length < 1 || files.length > contract.maximumResourceFiles ||
    new Set(files).size !== files.length || files.some(file => typeof file !== 'string' ||
      Buffer.byteLength(file) > contract.maximumResourcePathBytes || file.includes('\\') || file.includes(':') ||
      file.split('/').some(part => part === '' || part === '.' || part === '..' || /[.\s]$/u.test(part))) ||
    !/^[a-f0-9]{64}$/u.test(inventory.identity) || !/^[a-f0-9]{64}$/u.test(request.runNonce) ||
    !/^[a-f0-9]{64}$/u.test(request.artifactDescriptorSha256) ||
    !['packagedWorkspaceSuccess', 'packagedWorkspaceFaultRollback'].includes(scenario)) return;
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, runNonce: request.runNonce, scenario,
    artifactDescriptorSha256: request.artifactDescriptorSha256, root, selectionIdentity: inventory.identity, files }));
  if (bytes.length > contract.maximumSelectionBytes) return;
  await publish(join(directory, contract.resourceSelectionFilename), bytes, { flag: 'wx' });
}
