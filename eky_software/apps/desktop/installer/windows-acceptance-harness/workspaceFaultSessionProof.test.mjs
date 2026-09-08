import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';

import { runPackagedDesktopStartupProof } from '../../e2e-dist/src/main/desktopStartupCompletion.js';
import { createWorkspaceFaultSessionProof, loadWorkspaceSuccessSessionProtocol } from './workspaceSuccessSessionProof.mjs';

const protocol = await loadWorkspaceSuccessSessionProtocol();
const secret = () => randomBytes(32).toString('base64url');
const plans = {
  preUpdateRecoveryPointFailure: ['sourceHandoff'],
  activeWorkspaceFirstStartFailure: ['sourceHandoff', 'rollbackFirstStart'],
  acceptanceInterruption: ['sourceHandoff', 'targetAcceptanceRestart'],
  passiveWorkspaceMigrationFailure: ['sourceHandoff', 'targetFirstStart', 'switchToB', 'passiveWorkspaceRecovery'],
  binaryRollbackFailure: ['sourceHandoff'],
};

for (const [faultScenario, phases] of Object.entries(plans)) {
  test(`${faultScenario} probes only healthy phases through the existing memory and loopback contracts`, async (t) => {
    const backend = await createLoopbackContract(t);
    const proof = await createWorkspaceFaultSessionProof(protocol, faultScenario);
    t.after(() => proof.dispose());
    const secrets = [];
    const events = [];
    for (const phase of phases) {
      const session = secret(); secrets.push(session); backend.accept(session);
      const channel = await proof.start(phase);
      const order = [];
      const configuration = faultConfiguration(faultScenario, phase, channel.nonce);
      try {
        const result = await runPackagedDesktopStartupProof({
          configuration, controllerAvailable: true, logger: { write: (event) => events.push(event) },
          async validateSession(value) {
            assert.equal(value, configuration);
            await protocol.runW6b2PackagedSessionProbe({ configuration: value, backendPort: backend.port,
              runtimeInstanceId: randomUUID(), runtimeSessionSecret: session });
            order.push('sessionValidated');
          },
          async runController() {
            order.push('controller');
            return { formatVersion: 2, faultScenario, phase, status: phase === 'switchToB' ? 'relaunching' : 'completed' };
          },
        });
        assert.equal(result.phase, phase);
        assert.deepEqual(order, ['sessionValidated', 'controller']);
      } finally { await channel.finish(); }
    }
    assert.deepEqual(events, []);
    assert.deepEqual(proof.evidence().map((p) => [p.phase, p.priorSessionsRejected]), phases.map((phase, index) => [phase, index]));
    assert.equal(new Set(proof.evidence().map((p) => p.runtimeInstanceId)).size, phases.length);
    assert.equal(backend.requests(), phases.length * (phases.length + 1) / 2);
    const evidence = JSON.stringify(proof.evidence());
    for (const value of secrets) assert.equal(evidence.includes(value), false);
    assert.doesNotMatch(evidence, /port|session"|http:|pipe|password|nonce/);
    await assert.rejects(() => proof.start('sourceHandoff'), /sessionProofInvalid/);
    await assert.rejects(() => proof.start(undefined), /sessionProofInvalid/);
  });
}

test('an old session accepted over HTTP rejects the fault startup before controller side effects', async (t) => {
  const backend = await createLoopbackContract(t);
  const proof = await createWorkspaceFaultSessionProof(protocol, 'activeWorkspaceFirstStartFailure');
  t.after(() => proof.dispose());
  const firstSecret = secret(); backend.accept(firstSecret);
  const first = await proof.start('sourceHandoff');
  try {
    await protocol.runW6b2PackagedSessionProbe({
      configuration: faultConfiguration('activeWorkspaceFirstStartFailure', 'sourceHandoff', first.nonce),
      backendPort: backend.port, runtimeInstanceId: randomUUID(), runtimeSessionSecret: firstSecret,
    });
  } finally { await first.finish(); }
  const nextSecret = secret(); backend.accept(nextSecret, firstSecret);
  const next = await proof.start('rollbackFirstStart');
  let controllerCalls = 0;
  const events = [];
  try {
    await assert.rejects(() => runPackagedDesktopStartupProof({
      configuration: faultConfiguration('activeWorkspaceFirstStartFailure', 'rollbackFirstStart', next.nonce),
      controllerAvailable: true, logger: { write: (event) => events.push(event) },
      validateSession: (configuration) => protocol.runW6b2PackagedSessionProbe({ configuration,
        backendPort: backend.port, runtimeInstanceId: randomUUID(), runtimeSessionSecret: nextSecret }),
      async runController() { controllerCalls++; },
    }), { message: 'W6B2_PROOF_SESSION_VALIDATION_FAILED' });
  } finally { await assert.rejects(() => next.finish(), /sessionProofInvalid/); }
  assert.equal(controllerCalls, 0);
  assert.deepEqual(events, []);
  assert.equal(proof.evidence().length, 1);
});

test('the main probe rejects excluded phases and roles before reading or sending a secret', async () => {
  const valid = faultConfiguration('acceptanceInterruption', 'targetAcceptanceRestart', 'a'.repeat(64));
  for (const configuration of [
    { ...valid, phase: 'targetAcceptanceRecovery' }, { ...valid, phase: 'targetAcceptanceInterruption' },
    { ...valid, faultScenario: 'binaryRollbackFailure', phase: 'failedSafeVerification' },
    { ...valid, role: 'source' }, { ...valid, enabled: false },
    { ...valid, faultScenario: 'unknown' }, { ...valid, sessionProbeNonce: '' },
  ]) {
    let accesses = 0;
    await assert.rejects(() => protocol.runW6b2PackagedSessionProbe({ configuration,
      get runtimeSessionSecret() { accesses++; return secret(); },
    }), { message: 'W6B2_PROOF_SESSION_VALIDATION_FAILED' });
    assert.equal(accesses, 0);
  }
});

test('fault channels reject an unknown scenario, out-of-order phase and missing connection without a skip', async () => {
  await assert.rejects(() => createWorkspaceFaultSessionProof(protocol, 'unknown'), /W6B2_PROOF_CONFIGURATION_INVALID/);
  const proof = await createWorkspaceFaultSessionProof(protocol, 'binaryRollbackFailure');
  try {
    await assert.rejects(() => proof.start('failedSafeVerification'), /sessionProofInvalid/);
    const channel = await proof.start('sourceHandoff');
    await assert.rejects(() => channel.finish({ allowMissing: true }), /sessionProofInvalid/);
    assert.deepEqual(proof.evidence(), []);
  } finally { proof.dispose(); }
});

function faultConfiguration(faultScenario, phase, sessionProbeNonce) {
  return { controlFormatVersion: 2, enabled: true, faultScenario, phase, sessionProbeNonce,
    role: phase === 'sourceHandoff' || phase === 'rollbackFirstStart' ? 'source' : 'target' };
}

async function createLoopbackContract(t) {
  let accepted = [];
  let requests = 0;
  const server = createServer((request, response) => {
    requests++;
    const validRequest = request.url === '/customers' && request.method === 'GET';
    response.writeHead(validRequest && accepted.includes(request.headers['x-eky-local-session']) ? 200 : 401);
    response.end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    accepted.fill('');
  });
  return { port: server.address().port, accept(...sessions) { accepted = sessions; }, requests: () => requests };
}
