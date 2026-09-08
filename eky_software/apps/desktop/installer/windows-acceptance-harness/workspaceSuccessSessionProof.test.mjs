import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import { runPackagedDesktopStartupProof } from '../../e2e-dist/src/main/desktopStartupCompletion.js';

import { createWorkspaceSuccessSessionProof, loadWorkspaceSuccessSessionProtocol,
  verifyWorkspaceSuccessSessionEvidence, writeWorkspaceSuccessSessionEvidence } from './workspaceSuccessSessionProof.mjs';

const protocol = await loadWorkspaceSuccessSessionProtocol();
const phases = ['sourceHandoff', 'targetFirstStart', 'switchToB', 'verifyBRestart', 'verifyBRestart', 'switchToA', 'rejectC'];
const secret = () => randomBytes(32).toString('base64url');
const client = (channel, phase, session, runtimeInstanceId = randomUUID()) => protocol.runW6b2PackagedSessionProbe({
  configuration: { sessionProbeNonce: channel.nonce, phase }, backendPort: 3000, runtimeInstanceId,
  runtimeSessionSecret: session,
});

test('real memory channel validates seven new sessions and rejects every retained prior session', async (t) => {
  let current;
  const calls = [];
  const proof = createWorkspaceSuccessSessionProof(protocol, { request: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:3000/customers');
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'GET');
    const token = options.headers.get('x-eky-local-session');
    calls.push(token);
    return new Response(null, { status: token === current ? 200 : 401 });
  } });
  t.after(() => proof.dispose());
  const secrets = [];
  const events = [];
  for (const phase of phases) {
    current = secret(); secrets.push(current);
    const channel = await proof.start(phase);
    const identity = { appVersion: phase === 'sourceHandoff' ? '0.2.7' : '0.2.8',
      buildRevision: 'b'.repeat(40), runtimeInstanceId: randomUUID() };
    const previousEventCount = events.length;
    let sessionValidated = false;
    try {
      const result = await runPackagedDesktopStartupProof({
        configuration: { controlFormatVersion: 1, sessionProbeNonce: channel.nonce, phase },
        controllerAvailable: true, identity, startedAt: Date.now(),
        logger: { write(event) { assert.equal(sessionValidated, true); events.push(event); } },
        async validateSession() {
          await client(channel, phase, current, identity.runtimeInstanceId);
          sessionValidated = true;
        },
        async runController() {
          assert.equal(events.length, previousEventCount + 1);
          const event = events.at(-1);
          assert.equal(event.eventName, 'desktop.started');
          assert.equal(event.outcome, 'success');
          for (const key of Object.keys(identity)) assert.equal(event[key], identity[key]);
          assert.equal(JSON.stringify(event).includes(current), false);
          assert.equal(JSON.stringify(event).includes(channel.nonce), false);
          return { formatVersion: 1, phase, status: 'completed' };
        },
      });
      assert.deepEqual(result, { formatVersion: 1, phase, status: 'completed' });
    }
    finally { await channel.finish(); }
  }
  assert.equal(calls.length, 28);
  assert.deepEqual(proof.evidence().map((p) => p.priorSessionsRejected), [0, 1, 2, 3, 4, 5, 6]);
  const root = await mkdtemp(resolve(await realpath(tmpdir()), 'eky-v26-session-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(resolve(root, 'evidence'));
  const input = { proofRoot: root, request: { runNonce: 'a'.repeat(64), artifactDescriptorSha256: 'b'.repeat(64) } };
  await writeWorkspaceSuccessSessionEvidence(input, proof);
  const path = resolve(root, 'evidence', 'workspace-success-sessions.json');
  const text = await readFile(path, 'utf8');
  for (const token of secrets) assert.equal(text.includes(token), false);
  assert.doesNotMatch(text, /port|session"|http:|pipe|password/);
  await assert.doesNotReject(() => verifyWorkspaceSuccessSessionEvidence(input, events));
  for (const invalidEvents of [events.slice(1), [...events, events[0]],
    events.map((event, index) => index === 0 ? { ...event, runtimeInstanceId: randomUUID() } : event)]) {
    await assert.rejects(() => verifyWorkspaceSuccessSessionEvidence(input, invalidEvents), /sessionProofInvalid/);
  }
  for (const change of [
    (v) => { v.proofs.pop(); },
    (v) => { v.proofs[1].priorSessionsRejected = 0; },
    (v) => { v.proofs[1].runtimeInstanceId = v.proofs[0].runtimeInstanceId; },
    (v) => { v.proofs[1].phase = 'switchToA'; },
    (v) => { v.proofs[0].session = secret(); },
    (v) => { v.runNonce = 'f'.repeat(64); },
  ]) {
    const value = JSON.parse(text); change(value); await writeFile(path, JSON.stringify(value));
    await assert.rejects(() => verifyWorkspaceSuccessSessionEvidence(input, events), /sessionProofInvalid/);
  }
});

for (const mode of ['oldAccepted', 'newRejected', 'sessionReused', 'runtimeReused', 'requestFailure']) {
  test(`a ${mode} failure cannot be acknowledged as session acceptance`, async (t) => {
    let current = secret(); let second = false;
    const original = current;
    const id = randomUUID();
    const proof = createWorkspaceSuccessSessionProof(protocol, { request: async (_, options) => {
      if (second && mode === 'requestFailure') throw new Error('private detail');
      const valid = options.headers.get('x-eky-local-session') === current;
      return new Response(null, { status: second && mode === 'oldAccepted' ? 200
        : second && mode === 'newRejected' ? 401 : valid ? 200 : 401 });
    } });
    try {
      const first = await proof.start('sourceHandoff');
      t.after(() => first.finish().catch(() => undefined));
      await client(first, 'sourceHandoff', current, id); await first.finish();
      second = true; current = mode === 'sessionReused' ? original : secret();
      const next = await proof.start('targetFirstStart');
      t.after(() => next.finish().catch(() => undefined));
      await assert.rejects(() => client(next, 'targetFirstStart', current, mode === 'runtimeReused' ? id : randomUUID()),
        { message: 'W6B2_PROOF_SESSION_VALIDATION_FAILED' });
      await assert.rejects(() => next.finish(), { message: 'sessionProofInvalid' });
    } finally { proof.dispose(); }
  });
}

test('missing connection and unexpected phase are rejected without a retry', async () => {
  const proof = createWorkspaceSuccessSessionProof(protocol);
  await assert.rejects(() => proof.start('switchToB'), /sessionProofInvalid/);
  const channel = await proof.start('sourceHandoff');
  await assert.rejects(() => channel.finish(), /sessionProofInvalid/);
  proof.dispose();
});

for (const mode of ['unknownKey', 'wrongNonce', 'wrongPhase', 'badPort', 'oversized', 'earlyClose']) {
  test(`private channel rejects ${mode} without exposing the message`, async () => {
    let calls = 0;
    const proof = createWorkspaceSuccessSessionProof(protocol, { request: async () => { calls++; return new Response(null); } });
    const channel = await proof.start('sourceHandoff');
    const socket = createConnection({ path: protocol.packagedSessionProbePipe(channel.nonce), allowHalfOpen: true });
    const response = protocol.readPackagedSessionProbeMessage(socket).catch(() => null);
    const value = { schemaVersion: 1, nonce: channel.nonce, phase: 'sourceHandoff', port: 3000,
      runtimeInstanceId: randomUUID(), session: secret() };
    if (mode === 'unknownKey') value.companyId = 'foreign';
    if (mode === 'wrongNonce') value.nonce = 'f'.repeat(64);
    if (mode === 'wrongPhase') value.phase = 'rejectC';
    if (mode === 'badPort') value.port = -1;
    socket.end(mode === 'oversized' ? 'x'.repeat(2048) : mode === 'earlyClose' ? '' : `${JSON.stringify(value)}\n`);
    await response; socket.destroy();
    await assert.rejects(() => channel.finish(), /sessionProofInvalid/);
    assert.equal(calls, 0);
    proof.dispose();
  });
}

test('duplicate connection fails even after the first valid acknowledgement', async (t) => {
  const proof = createWorkspaceSuccessSessionProof(protocol, { request: async () => new Response(null) });
  const channel = await proof.start('sourceHandoff');
  t.after(() => channel.finish().catch(() => undefined));
  await client(channel, 'sourceHandoff', secret());
  await assert.rejects(() => client(channel, 'sourceHandoff', secret()), /W6B2_PROOF_SESSION_VALIDATION_FAILED/);
  await assert.rejects(() => channel.finish(), /sessionProofInvalid/);
  proof.dispose();
});

test('channel cleanup aborts an in-flight probe and keeps failure instead of accepting cleanup as success', async () => {
  const started = Promise.withResolvers();
  let aborted = false;
  const proof = createWorkspaceSuccessSessionProof(protocol, { request: async (_, { signal }) => {
    started.resolve();
    return new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error()); }, { once: true }));
  } });
  const channel = await proof.start('sourceHandoff');
  const result = client(channel, 'sourceHandoff', secret()).then(() => 'accepted', () => 'rejected');
  await started.promise;
  await assert.rejects(() => channel.finish(), /sessionProofInvalid/);
  assert.equal(await result, 'rejected'); assert.equal(aborted, true);
  proof.dispose();
});

test('ordinary configuration does not open the probe or handle a session', async () => {
  await assert.doesNotReject(() => protocol.runW6b2PackagedSessionProbe({ configuration: {} }));
});
