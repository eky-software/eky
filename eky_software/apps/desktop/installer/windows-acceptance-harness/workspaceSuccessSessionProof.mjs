import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { hasWorkspaceSuccessExactKeys, readWorkspaceSuccessObject, writeJsonAtomicExclusive } from './workspaceSuccessContracts.mjs';

const invalid = () => { throw new Error('sessionProofInvalid'); };
const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_FILE = 'workspace-success-sessions.json';
const PHASES = ['sourceHandoff', 'targetFirstStart', 'switchToB', 'verifyBRestart', 'verifyBRestart', 'switchToA', 'rejectC'];

export const loadWorkspaceSuccessSessionProtocol = () => import(pathToFileURL(resolve(
  DIRECTORY, '../../e2e-dist/src/main/w6b2PackagedSessionProbe.js')).href);

export function createWorkspaceSuccessSessionProof(protocol, options) {
  return createWorkspaceSessionProof(protocol, PHASES, options, true);
}

export async function loadWorkspaceFaultSessionPhases(faultScenario) {
  const { getW6b2PackagedFaultSessionPhases } = await import(pathToFileURL(resolve(
    DIRECTORY, '../../e2e-dist/src/main/w6b2PackagedProof.js')).href);
  return getW6b2PackagedFaultSessionPhases(faultScenario);
}

export async function createWorkspaceFaultSessionProof(protocol, faultScenario, options) {
  return createWorkspaceSessionProof(protocol, await loadWorkspaceFaultSessionPhases(faultScenario), options);
}

function createWorkspaceSessionProof(protocol, phases, { request = fetch } = {}, canSkipMissing = false) {
  const sessions = [];
  const proofs = [];
  let active = false;

  async function status(port, session, signal) {
    const response = await request(`http://127.0.0.1:${port}/customers`, {
      method: 'GET', redirect: 'error', signal, headers: protocol.packagedSessionProbeHeaders(session),
    });
    await response.body?.cancel();
    return response.status;
  }

  async function start(phase) {
    if (active || sessions.length >= phases.length || phase !== phases[sessions.length]) invalid();
    active = true;
    const nonce = randomBytes(32).toString('hex');
    const sockets = new Set();
    const tasks = new Set();
    const abort = new AbortController();
    let count = 0;
    let accepted = false;
    let failed = false;
    const server = createServer({ allowHalfOpen: true }, (socket) => {
      count += 1;
      sockets.add(socket);
      socket.on('error', () => { failed = true; });
      socket.once('close', () => sockets.delete(socket));
      const task = (async () => {
        try {
          if (count !== 1) invalid();
          const value = protocol.parsePackagedSessionProbeRequest(
            await protocol.readPackagedSessionProbeMessage(socket), nonce, phase);
          socket.on('data', () => { failed = true; socket.destroy(); });
          if (sessions.includes(value.session) || proofs.some((p) => p.runtimeInstanceId === value.runtimeInstanceId)) invalid();
          if (await status(value.port, value.session, abort.signal) !== 200) invalid();
          for (const prior of sessions) if (await status(value.port, prior, abort.signal) !== 401) invalid();
          proofs.push({ phase, runtimeInstanceId: value.runtimeInstanceId, priorSessionsRejected: sessions.length });
          sessions.push(value.session);
          accepted = true;
          socket.end(`${JSON.stringify({ schemaVersion: 1, nonce, status: 'validated' })}\n`);
        } catch {
          failed = true;
          socket.destroy();
        }
      })();
      tasks.add(task);
      void task.finally(() => tasks.delete(task));
    });
    server.on('error', () => { failed = true; });
    try {
      await new Promise((ready, reject) => {
        server.once('error', reject);
        server.listen(protocol.packagedSessionProbePipe(nonce), () => { server.off('error', reject); ready(); });
      });
    } catch {
      active = false;
      invalid();
    }
    return Object.freeze({ nonce,
      async finish({ allowMissing = false } = {}) {
        // The child has already exited. Close only this run's memory channel;
        // no PID lookup, process termination or second deadline is introduced.
        abort.abort();
        for (const socket of sockets) socket.destroy();
        await Promise.all(tasks);
        await new Promise((done) => server.close(done));
        active = false;
        if (failed || (allowMissing && !canSkipMissing) ||
          (count === 0 ? !allowMissing : count !== 1 || !accepted)) invalid();
      },
    });
  }

  return Object.freeze({ start,
    evidence: () => proofs.map((value) => ({ ...value })),
    dispose() { sessions.fill(''); sessions.length = 0; },
  });
}

export async function writeWorkspaceSuccessSessionEvidence({ proofRoot, request }, proof) {
  await writeJsonAtomicExclusive(resolve(proofRoot, 'evidence', EVIDENCE_FILE), {
    schemaVersion: 1, runNonce: request.runNonce, artifactDescriptorSha256: request.artifactDescriptorSha256,
    proofs: proof.evidence(),
  });
}

export async function verifyWorkspaceSuccessSessionEvidence({ proofRoot, request }, events) {
  const value = await readWorkspaceSuccessObject(resolve(proofRoot, 'evidence', EVIDENCE_FILE), 'sessionProofInvalid');
  if (!hasWorkspaceSuccessExactKeys(value, ['schemaVersion', 'runNonce', 'artifactDescriptorSha256', 'proofs']) ||
    value.schemaVersion !== 1 || value.runNonce !== request.runNonce ||
    value.artifactDescriptorSha256 !== request.artifactDescriptorSha256 || !Array.isArray(value.proofs)) invalid();
  const starts = events.filter((event) => event.eventName === 'desktop.started');
  if (value.proofs.length !== PHASES.length || starts.length !== PHASES.length) invalid();
  for (const [index, proof] of value.proofs.entries()) {
    if (!hasWorkspaceSuccessExactKeys(proof, ['phase', 'runtimeInstanceId', 'priorSessionsRejected']) ||
      proof.phase !== PHASES[index] || proof.priorSessionsRejected !== index ||
      starts.filter((event) => event.runtimeInstanceId === proof.runtimeInstanceId).length !== 1 ||
      value.proofs.some((other, otherIndex) => otherIndex !== index && other.runtimeInstanceId === proof.runtimeInstanceId)) invalid();
  }
}
