import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { tmpdir } from 'node:os';
import { assertInspectionProofResult, inspectionProofPaths, inspectionProofVariants,
  inspectionPreparationFailure, parseInspectionProofConfig } from './linuxProfileInspectionContract.mjs';
import { runLinuxInspectionCase } from './linuxProfileInspectionCase.mjs';
import { runLinuxInspectionOwner } from './runLinuxInspectionOwner.mjs';
import { inspectionNativeFailureMaximumBytes, inspectionPreparationEvidence,
  prepareMissingInspectionResource, readInspectionNativeBuildFailure } from './prepareLinuxInspectionProof.mjs';
import { profileInspectionNativeContract } from '../../../backend/src/database/connection/profileInspectionNativeContract.ts';

const controlPath = '/tmp/eky-e2e/run-synthetic/profile-inspection/inspection.json';
const configFor = (variant = 'current') => ({ schemaVersion: 1,
  generation: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', variant,
  operationId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
  activeContext: { activeProfileId: 'a'.repeat(64), activeProfileIsEmpty: true },
  expected: { database: { byteSize: 8192, sha256: 'b'.repeat(64) },
    artifactCatalog: { byteSize: 34, sha256: 'c'.repeat(64) }, migrationChainIdentity: 'd'.repeat(64) } });

test('missing-native fixture preserves the canonical loader directory but contains no payload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eky-inspection-missing-'));
  try {
    await mkdir(join(root, 'missing-resources'));
    await prepareMissingInspectionResource(root);
    const path = join(root, 'missing-resources', profileInspectionNativeContract.directoryName);
    assert.ok(await realpath(path));
    assert.deepEqual(await readdir(path), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('preparation preserves only exact known first causes without raw error fields', () => {
  for (const cause of ['PROFILE_INSPECTION_NATIVE_TOOLCHAIN_INVALID', 'PROFILE_INSPECTION_NATIVE_SOURCE_INVALID',
    'PROFILE_INSPECTION_NATIVE_BUILD_FAILED', 'PROFILE_INSPECTION_PROTOCOL_INVALID', 'LINUX_PROFILE_INSPECTION_PROOF_INVALID']) {
    assert.deepEqual(inspectionPreparationFailure('preparation', Error(cause)), {
      operation: 'linuxProfileInspection', status: 'failed', phase: 'preparation', causeCode: cause });
  }
  for (const error of [null, { message: 'PROFILE_INSPECTION_NATIVE_BUILD_FAILED' }, Error('/private/path'),
    Error('PROFILE_INSPECTION_NATIVE_BUILD_FAILED: /private/path')]) {
    const result = inspectionPreparationFailure('preparation', error);
    assert.equal(result.causeCode, 'unknown');
    assert.doesNotMatch(JSON.stringify(result), /private\/path|stack|message/u);
  }
});

async function nativeEvidenceFixture(t, bytes) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'eky-inspection-native-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const identity = await lstat(root);
  const work = join(root, 'inspection-native-ABC123');
  await mkdir(work, { mode: 0o700 });
  const path = join(work, 'build.private.log');
  if (bytes) await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
  return { root, identity, work, path };
}

for (const size of [120, inspectionNativeFailureMaximumBytes, inspectionNativeFailureMaximumBytes + 41]) {
  test(`approved preparation evidence preserves at most 64 KiB from its own ${size}-byte log`, {
    skip: process.platform !== 'linux',
  }, async t => {
    const bytes = Buffer.alloc(size, 65);
    bytes.fill(90, size - 50);
    const fixture = await nativeEvidenceFixture(t, bytes);
    const value = await readInspectionNativeBuildFailure(fixture.root, fixture.identity);
    const prefix = Buffer.from(value.prefixBase64, 'base64');
    const suffix = Buffer.from(value.suffixBase64, 'base64');
    assert.equal(value.status, 'retained');
    assert.equal(value.sourceBytes, size);
    assert.equal(value.complete, size <= inspectionNativeFailureMaximumBytes);
    assert.equal(value.retainedBytes, Math.min(size, inspectionNativeFailureMaximumBytes));
    assert.deepEqual(prefix, bytes.subarray(0, prefix.length));
    assert.deepEqual(suffix, suffix.length ? bytes.subarray(size - suffix.length) : Buffer.alloc(0));
    assert.equal((await lstat(fixture.path)).size, size);
  });
}

for (const variant of ['symlink', 'hardlink', 'mode', 'rootIdentity', 'extraRoot', 'workSymlink', 'missing']) {
  test(`native failure evidence rejects ${variant} without reading another attempt`, {
    skip: process.platform !== 'linux',
  }, async t => {
    const fixture = await nativeEvidenceFixture(t, variant === 'missing' ? null : Buffer.from('synthetic private output'));
    let identity = fixture.identity;
    if (variant === 'symlink') {
      await rm(fixture.path);
      const other = join(fixture.work, 'other.private');
      await writeFile(other, 'excluded content', { mode: 0o600 });
      await symlink(other, fixture.path);
    } else if (variant === 'hardlink') await link(fixture.path, join(fixture.work, 'alias.private'));
    else if (variant === 'mode') await chmod(fixture.path, 0o644);
    else if (variant === 'rootIdentity') identity = { dev: fixture.identity.dev, ino: fixture.identity.ino + 1 };
    else if (variant === 'extraRoot') await mkdir(join(fixture.root, 'inspection-native-DEF456'), { mode: 0o700 });
    else if (variant === 'workSymlink') {
      await rm(fixture.work, { recursive: true });
      const other = await mkdtemp(join(await realpath(tmpdir()), 'eky-unrelated-log-'));
      t.after(() => rm(other, { recursive: true, force: true }));
      await symlink(other, fixture.work);
    }
    assert.deepEqual(await readInspectionNativeBuildFailure(fixture.root, identity), {
      status: variant === 'missing' ? 'missing' : 'unverified' });
  });
}

test('raw native evidence is private and opt-in for only the approved preparation failure', {
  skip: process.platform !== 'linux',
}, async t => {
  const fixture = await nativeEvidenceFixture(t, Buffer.from('synthetic-private-build-output'));
  const failure = inspectionPreparationFailure('preparation', Error('PROFILE_INSPECTION_NATIVE_BUILD_FAILED'));
  const evidence = await inspectionPreparationEvidence(failure, { ...fixture, mode: 'sandboxProbe' });
  assert.equal(evidence.nativeCompilationEvidence.status, 'retained');
  assert.equal(Buffer.from(evidence.nativeCompilationEvidence.prefixBase64, 'base64').toString(), 'synthetic-private-build-output');
  assert.deepEqual(Object.keys(failure), ['operation', 'status', 'phase', 'causeCode']);
  assert.doesNotMatch(JSON.stringify(failure), /private|Base64|nativeCompilationEvidence/u);
  for (const change of [{ mode: undefined }, { mode: 'other' }, { phase: 'current' },
    { causeCode: 'unknown' }, { root: undefined }, { identity: undefined }]) {
    const publicValue = { ...failure, ...('phase' in change ? { phase: change.phase } : {}),
      ...('causeCode' in change ? { causeCode: change.causeCode } : {}) };
    assert.equal(await inspectionPreparationEvidence(publicValue, { ...fixture, mode: 'sandboxProbe', ...change }), publicValue);
  }
});

test('actual runner writes approved evidence privately and emits only the unchanged safe failure', async () => {
  const source = await readFile(new URL('./runLinuxProfileInspectionProof.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes('nativeIdentity = await lstat(nativeRoot)'));
  assert.ok(source.includes('mode: process.env.EKY_INSPECTION_BUILD_FAILURE_EVIDENCE'));
  assert.ok(source.includes("JSON.stringify(evidence),\n          { flag: 'wx', mode: 0o600 }"));
  assert.ok(source.includes("process.stderr.write(JSON.stringify(failure) + '\\n')"));
  assert.doesNotMatch(source, /process\.(?:stdout|stderr)\.write\(JSON\.stringify\(evidence\)/u);
});

function scenario(variant = 'current', change = {}) {
  const config = configFor(variant);
  const paths = inspectionProofPaths(controlPath, config, '/tmp');
  const observation = { forkCount: 0, exitObserved: false, exitCode: null, contextReads: 0,
    receiptVerified: false, sourcePreserved: false, mainExclusionProved: false, ownerReleaseProved: false };
  let held = false;
  let closed = false;
  let phase;
  let sourceReads = 0;
  let closeCalls = 0;
  let releaseCalls = 0;
  class WorkspaceProcessReservationError extends Error { reason = 'busy'; cleanupFailed = change.busyCleanupFailed ?? false; }
  class ProfileInspectionProcessError extends Error {
    constructor(causeCode) {
      super('safe'); this.causeCode = causeCode;
      this.cleanup = { processAbsent: true, reservationReclaimed: true, forced: false };
    }
  }
  const ports = {
    WorkspaceProcessReservationError, ProfileInspectionProcessError,
    readProfileInspectionFailureCause: error => error instanceof ProfileInspectionProcessError ? error.causeCode : undefined,
    async acquireDesktopWorkspaceReservation(input) {
      assert.equal(input.userDataRoot, paths.operationRoot);
      input.assertSingleInstanceOwnership(); held = true;
      return {
        async assertMainOwned() { assert.equal(held, true); if (change.ownerLost) throw Error('ownership lost'); },
        async close() {
          closeCalls++;
          if (change.closeFailed) throw Error('close failed');
          held = false; closed = true;
        },
      };
    },
    async acquireWorkspaceProcessReservation(input) {
      assert.equal(input.userDataRoot, paths.operationRoot);
      if (held) throw new WorkspaceProcessReservationError();
      assert.equal(closed, true);
      return { async assertOwned() { if (change.recheckFailed) throw Error('recheck failed'); },
        async release() { releaseCalls++; } };
    },
    async createProfileInspectionDeployment(value) { await Promise.resolve(); return value; },
    async runProfileSnapshotInspection(input) {
      assert.equal(input.kind, 'inspect');
      assert.equal(input.migrationPolicy, 'restoreCompatible');
      assert.equal(input.runnerPath, '/source/apps/desktop/dist/runtime/profileInspectionRunner.js');
      assert.equal(input.deployment.resourcesRoot, paths.resourcesRoot);
      assert.equal(input.signal.aborted, false);
      await input.readActiveContext({ kind: 'inspect', operationId: config.operationId });
      observation.forkCount = change.extraFork ? 2 : 1;
      observation.exitObserved = !change.noExit;
      observation.exitCode = variant === 'current' ? 0 : 1;
      if (change.wrongExit) observation.exitCode = 9;
      if (variant !== 'current') {
        const error = new ProfileInspectionProcessError(variant === 'schemaChanged'
          ? 'PROFILE_SCHEMA_UNSUPPORTED' : 'PROFILE_INSPECTION_PROTOCOL_INVALID');
        if (change.wrongCause) error.causeCode = 'PROFILE_INSPECTION_TIMEOUT';
        if (change.cleanup) Object.assign(error.cleanup, change.cleanup);
        throw error;
      }
      if (!change.noFinalContext) await input.readActiveContext({ kind: 'inspect', operationId: config.operationId });
      return { receipt: { ...config.expected, databaseHealth: 'healthy', migrationPolicy: 'restoreCompatible',
        ...(change.wrongReceipt ? { database: { ...config.expected.database, sha256: '0'.repeat(64) } } : {}) },
      validation: { type: 'profileSnapshotValidation', activeProfileIsEmpty: true, artifactCount: 0,
        artifactTotalByteSize: 0, databaseHealth: 'healthy', migrationChainIdentity: config.expected.migrationChainIdentity,
        profileId: config.activeContext.activeProfileId, profileMatchesActive: !change.wrongProfile } };
    },
  };
  return { config, observation, async run() {
    const terminal = await runLinuxInspectionCase({ config, paths, repository: '/source', ports, observation,
      assertAuthority() {}, signal: new AbortController().signal, recordPhase: value => { phase = value; },
      async readSource(path) {
        sourceReads++;
        const identity = posix.basename(path) === 'profile.sqlite' ? config.expected.database : config.expected.artifactCatalog;
        return change.changedSource ? { ...identity, byteSize: identity.byteSize + 1 } : identity;
      } });
    return { schemaVersion: 1, generation: config.generation, variant, ...terminal, phase, observation };
  }, read: () => ({ held, closed, sourceReads, closeCalls, releaseCalls }) };
}

test('inspection config permits only the three synthetic cases and derived private paths', () => {
  for (const variant of inspectionProofVariants) {
    const config = parseInspectionProofConfig(JSON.stringify(configFor(variant)));
    const paths = inspectionProofPaths(controlPath, config, '/tmp');
    assert.equal(paths.operationRoot, '/tmp/eky-e2e/run-synthetic/profile-inspection/staging/' + config.operationId);
    assert.equal(paths.resourcesRoot.endsWith('/missing-resources'), variant === 'missingNative');
  }
  for (const mutate of [v => { v.args = []; }, v => { v.variant = 'other'; },
    v => { v.generation = 'old'; }, v => { v.operationId = '../../private'; },
    v => { v.activeContext.companyId = 'not-needed'; }, v => { v.expected.database.byteSize = -1; },
    v => { v.expected.database.sha256 = 'bad'; }]) {
    const value = configFor(); mutate(value);
    assert.throws(() => parseInspectionProofConfig(JSON.stringify(value)));
    assert.throws(() => inspectionProofPaths(controlPath, value, '/tmp'));
  }
  const json = JSON.stringify(configFor());
  for (const text of ['null', '{}', json + '\n', json.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    ' '.repeat(65_537)]) assert.throws(() => parseInspectionProofConfig(text));
  for (const path of ['/tmp/other/profile-inspection/inspection.json', controlPath + '.old',
    controlPath.replace('/tmp/', '/private/'), controlPath.replace('run-synthetic', 'case-synthetic')]) {
    assert.throws(() => inspectionProofPaths(path, configFor(), '/tmp'));
  }
});

for (const variant of inspectionProofVariants) {
  test(`inspection ${variant} requires port outcome, source preservation and reservation release`, async () => {
    const fixture = scenario(variant);
    const result = await fixture.run();
    assertInspectionProofResult(result, fixture.config);
    assert.deepEqual(fixture.read(), { held: false, closed: true, sourceReads: 2, closeCalls: 1, releaseCalls: 1 });
  });
}

for (const change of [{ noExit: true }, { wrongExit: true }, { extraFork: true }, { wrongReceipt: true },
  { noFinalContext: true }, { wrongProfile: true }, { changedSource: true }, { closeFailed: true },
  { ownerLost: true }, { recheckFailed: true }, { busyCleanupFailed: true }]) {
  test(`inspection never accepts incomplete success: ${Object.keys(change)[0]}`, async () => {
    const fixture = scenario('current', change);
    const result = await fixture.run();
    assert.equal(result.status, 'failed');
    assert.throws(() => assertInspectionProofResult(result, fixture.config));
    if (change.closeFailed || change.ownerLost) assert.equal(result.ownerReleased, false);
    if (change.ownerLost) assert.equal(fixture.read().closeCalls, 0);
    if (change.recheckFailed) assert.equal(fixture.read().releaseCalls, 1);
  });
}

for (const change of [{ wrongCause: true }, { cleanup: { processAbsent: false } },
  { cleanup: { reservationReclaimed: false } }, { cleanup: { forced: true } }]) {
  test(`inspection rejection preserves its cause separately from failed verification: ${JSON.stringify(change)}`, async () => {
    const fixture = scenario('schemaChanged', change);
    const result = await fixture.run();
    assert.equal(result.status, 'failed');
    assert.equal(result.causeCode, change.wrongCause ? 'PROFILE_INSPECTION_TIMEOUT' : 'PROFILE_SCHEMA_UNSUPPORTED');
    assert.equal(result.ownerReleased, true);
    assert.throws(() => assertInspectionProofResult(result, fixture.config));
  });
}

test('result receipt rejects stale generation and missing or contradictory terminal evidence', async () => {
  const fixture = scenario();
  const original = await fixture.run();
  for (const mutate of [v => { v.generation = 'old'; }, v => { v.variant = 'schemaChanged'; },
    v => { v.extra = true; }, v => { v.status = 'failed'; }, v => { v.phase = 'inspection'; },
    v => { v.causeCode = 'PROFILE_INSPECTION_TIMEOUT'; }, v => { v.ownerReleased = false; },
    v => { v.observation.exitObserved = false; }, v => { v.observation.ownerReleaseProved = false; },
    v => { v.observation.sourcePreserved = false; }, v => { v.observation.raw = 'must not publish'; }]) {
    const value = structuredClone(original); mutate(value);
    assert.throws(() => assertInspectionProofResult(value, fixture.config));
  }
});

test('Linux inspection host stays outside production and uses the real port without a native or sandbox fallback', async () => {
  const host = await readFile(new URL('./linuxProfileInspectionHost.mjs', import.meta.url), 'utf8');
  assert.match(host, /guardLinuxService\(\)/u);
  assert.match(host, /app\.requestSingleInstanceLock\(\)/u);
  assert.match(host, /profileBackup\/runProfileSnapshotInspection\.js/u);
  assert.match(host, /main\/desktopComposition\.js/u);
  assert.match(host, /child\.once\('exit'/u);
  assert.doesNotMatch(host, /better-sqlite3|--no-sandbox|disable-sandbox|spawn\(|execFile\(|setTimeout\(/u);
  const main = await readFile(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /linuxProfileInspectionHost/u);
});

test('finite inspection caller requires host evidence and the existing owner stop separately', async () => {
  for (const mode of ['passed', 'missingResult', 'staleResult', 'unavailable', 'cleanupFailed',
    'bothFailed', 'expired', 'startFailedStopped', 'startFailedUnverified']) {
    const fixture = scenario();
    const result = await fixture.run();
    const events = [];
    let reads = 0;
    let stopCalls = 0;
    let resultCalls = 0;
    const output = { readStdout: () => 'bounded synthetic stdout', readStderr: () => 'bounded synthetic stderr' };
    const paths = inspectionProofPaths(controlPath, fixture.config, '/tmp');
    const lifetime = { readRemainingWorkMilliseconds: () => mode === 'expired' ? 0 : 100 };
    const outcome = await runLinuxInspectionOwner({ config: fixture.config, paths, repository: '/source',
      lifetime, startupDeadline: 100 }, {
      async start(profile, input) {
        assert.equal(profile, 'profileInspection');
        assert.equal(input.lifetime, lifetime);
        assert.equal(input.inspectionConfigPath, controlPath);
        assert.deepEqual(input.redactedValues, []);
        if (mode.startsWith('startFailed')) throw Object.assign(Error('safe'), output,
          { evidence: { processTree: mode === 'startFailedStopped' ? 'stopped' : 'unverified' } });
        return { ...output,
          workload: { async readState() { events.push('read'); reads++;
            return mode === 'unavailable' ? 'unavailable' : reads === 1 ? 'running' : 'exited'; } },
          async stop() { events.push('stop'); stopCalls++;
            if (mode === 'cleanupFailed' || mode === 'bothFailed') throw Error('unverified'); },
        };
      },
      async readResult(path) {
        resultCalls++; events.push('result'); assert.equal(path, paths.result);
        if (mode === 'missingResult' || mode === 'bothFailed') throw Error('missing');
        return mode === 'staleResult' ? { ...result, generation: 'old' } : result;
      },
      async wait(milliseconds) { assert.equal(milliseconds, 25); events.push('wait'); },
    });
    assert.equal(outcome.status, mode === 'passed' ? 'passed' : 'failed', mode);
    assert.equal(outcome.originalFailure, !['passed', 'cleanupFailed'].includes(mode), mode);
    assert.equal(outcome.cleanupFailure, ['cleanupFailed', 'bothFailed'].includes(mode), mode);
    assert.equal(outcome.processTree,
      ['cleanupFailed', 'bothFailed', 'startFailedUnverified'].includes(mode) ? 'unverified' : 'stopped', mode);
    assert.equal(stopCalls, mode.startsWith('startFailed') ? 0 : 1, mode);
    assert.equal(resultCalls, ['unavailable', 'expired', 'startFailedStopped', 'startFailedUnverified'].includes(mode) ? 0 : 1, mode);
    assert.deepEqual(outcome.output, { stdout: 'bounded synthetic stdout', stderr: 'bounded synthetic stderr' });
    if (mode === 'passed') assert.deepEqual(events, ['read', 'wait', 'read', 'result', 'stop']);
  }
});
