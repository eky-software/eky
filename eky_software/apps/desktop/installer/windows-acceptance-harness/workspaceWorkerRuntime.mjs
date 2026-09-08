import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveElectronDevelopmentRuntime } from '../../scripts/electron-development-runtime.mjs';
import { verifyW6b2PackagedSuccessRunFixture } from '../scripts/w6b2PackagedSuccessRunFixture.mjs';
import { validateWorkspaceFaultRequest } from './workspaceFaultContracts.mjs';
import { loadWorkspaceFaultProfileSupport, writeWorkspaceFaultCheckpoint } from './workspaceFaultProfileEvidence.mjs';
import { writeWorkspaceFaultSessionEvidence } from './workspaceFaultSessionEvidence.mjs';
import { createWorkspaceSuccessWindowsRuntime, createWorkspaceFaultWindowsRuntime } from './workspaceSuccessWindowsRuntime.mjs';
import { workspaceSuccessRunContext } from './workspaceSuccessRunFixture.mjs';
import { loadWorkspaceSuccessProfileSupport, writeWorkspaceSuccessCheckpoint } from './workspaceSuccessProfileEvidence.mjs';
import { createWorkspaceSuccessSessionProof, createWorkspaceFaultSessionProof, loadWorkspaceSuccessSessionProtocol,
  writeWorkspaceSuccessSessionEvidence } from './workspaceSuccessSessionProof.mjs';

const DESKTOP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function createWorkspaceSuccessWorkerRuntime(requestPath, request, artifact, dependencies) {
  if (Object.hasOwn(request, 'faultScenario')) throw new Error('requestInvalid');
  return createWorkspaceWorkerRuntime(requestPath, request, artifact, dependencies);
}

export function createWorkspaceFaultWorkerRuntime(requestPath, request, artifact, dependencies) {
  return createWorkspaceWorkerRuntime(requestPath, validateWorkspaceFaultRequest(request), artifact, dependencies);
}

// Both workers compose the same Windows ports. Only the closed scenario's
// lifecycle, checkpoint and session contracts differ; ownership stays outside.
async function createWorkspaceWorkerRuntime(requestPath, request, artifact, {
  resolveElectronRuntime = resolveElectronDevelopmentRuntime,
} = {}) {
  const fault = Object.hasOwn(request, 'faultScenario');
  const context = workspaceSuccessRunContext(requestPath, request, artifact);
  await verifyW6b2PackagedSuccessRunFixture({ ...context.runFixture, temporaryRoot: context.temporaryRoot });
  const proofProtocol = await import(pathToFileURL(resolve(DESKTOP_ROOT, 'e2e-dist/src/main/w6b2PackagedProof.js')).href);
  const profileProtocol = await import(pathToFileURL(resolve(DESKTOP_ROOT, 'e2e-dist/e2e/w6b2PackagedWorkspaceProfileCommand.js')).href);
  const support = await (fault ? loadWorkspaceFaultProfileSupport() : loadWorkspaceSuccessProfileSupport());
  let electron;
  try { electron = resolveElectronRuntime({ desktopPackageJsonPath: resolve(DESKTOP_ROOT, 'package.json') }); }
  catch { throw new Error('electronRuntimeUnavailable'); }
  const protocol = await loadWorkspaceSuccessSessionProtocol();
  const sessionProof = fault ? await createWorkspaceFaultSessionProof(protocol, request.faultScenario)
    : createWorkspaceSuccessSessionProof(protocol);
  try {
    const runtime = await (fault ? createWorkspaceFaultWindowsRuntime : createWorkspaceSuccessWindowsRuntime)({
      ...context, proofProtocol, profileProtocol, sessionProof,
      profileRuntime: { executablePath: electron.executablePath, applicationPath: resolve(DESKTOP_ROOT, 'e2e-dist/w6b2-profile') },
      async captureCheckpoint(checkpoint) {
        if (checkpoint === (fault ? 'faultTerminal' : 'rejectedC')) {
          await (fault ? writeWorkspaceFaultSessionEvidence : writeWorkspaceSuccessSessionEvidence)(context, sessionProof);
        }
        await (fault ? writeWorkspaceFaultCheckpoint : writeWorkspaceSuccessCheckpoint)({
          request, proofRoot: context.proofRoot, checkpoint, support,
        });
      },
    });
    return { ...runtime, disposeSessionEvidence: () => sessionProof.dispose() };
  } catch (error) {
    sessionProof.dispose();
    throw error;
  }
}
