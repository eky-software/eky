import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createW6b2PackagedFaultArguments,
  parseW6b2PackagedFaultCliArguments,
  runW6b2PackagedFaultRollback,
} from './runW6b2PackagedFaultRollback.mjs';
import { w6b2PackagedFaultScenarios } from './w6b2PackagedFaultRunFixture.mjs';

const installerPair = Object.freeze({
  buildRevision: '123456789abc',
  source: Object.freeze({
    appVersion: '0.2.7',
    packagedApplicationPath: 'source-payload',
  }),
  target: Object.freeze({
    appVersion: '0.2.8',
    packagedApplicationPath: 'target-payload',
  }),
});

test('runs every fault scenario twice with one immutable installer pair', async () => {
  const events = [];
  const dependencies = createDependencies(events);

  const result = await runW6b2PackagedFaultRollback({ dependencies });

  assert.deepEqual(result, {
    runCount: 10,
    scenarioCount: 5,
    sourceVersion: '0.2.7',
    status: 'completed',
    targetVersion: '0.2.8',
  });
  assert.equal(events.filter((event) => event.type === 'build').length, 1);
  assert.deepEqual(
    events
      .filter((event) => event.type === 'run')
      .map((event) => event.faultScenario),
    w6b2PackagedFaultScenarios.flatMap((scenario) => [scenario, scenario]),
  );
  assert.equal(events.filter((event) => event.type === 'remove').length, 10);
  assert.equal(events.filter((event) => event.type === 'verifyPair').length, 11);
});

test('runs one allowlisted scenario once and always removes its fixture', async () => {
  const events = [];
  const dependencies = createDependencies(events);

  await runW6b2PackagedFaultRollback({
    dependencies,
    runCount: 1,
    scenarios: ['binaryRollbackFailure'],
  });

  assert.deepEqual(
    events.filter((event) => event.type === 'run'),
    [{ faultScenario: 'binaryRollbackFailure', type: 'run' }],
  );
  assert.equal(events.filter((event) => event.type === 'remove').length, 1);
});

test('removes the private fixture without changing a failed process result', async () => {
  const events = [];
  const dependencies = createDependencies(events, {
    runProcess: async () => {
      events.push({ type: 'runFailed' });
      throw new Error('W6B2_PACKAGED_SCENARIO_PROCESS_EXIT_FAILED');
    },
  });

  await assert.rejects(
    runW6b2PackagedFaultRollback({
      dependencies,
      runCount: 1,
      scenarios: ['preUpdateRecoveryPointFailure'],
    }),
    /W6B2_PACKAGED_SCENARIO_PROCESS_EXIT_FAILED/u,
  );
  assert.equal(events.filter((event) => event.type === 'remove').length, 1);
  assert.equal(events.some((event) => event.type === 'verifyRun'), false);
});

test('accepts only a closed isolated-scenario CLI argument', () => {
  assert.deepEqual(
    parseW6b2PackagedFaultCliArguments([
      '--scenario=acceptanceInterruption',
    ]),
    { runCount: 1, scenarios: ['acceptanceInterruption'] },
  );
  assert.throws(
    () => parseW6b2PackagedFaultCliArguments(['--scenario=unknown']),
    /W6B2_FAULT_SCENARIO_INVALID/u,
  );
  assert.throws(
    () => parseW6b2PackagedFaultCliArguments(['--run-count=1']),
    /W6B2_FAULT_CLI_ARGUMENTS_INVALID/u,
  );
});

test('creates an exact PowerShell contract without a generic fault input', () => {
  const arguments_ = createW6b2PackagedFaultArguments({
    buildRevision: installerPair.buildRevision,
    electronPath: 'electron.exe',
    faultScenario: 'passiveWorkspaceMigrationFailure',
    profileApplicationPath: 'profile-app',
    run: createRun('passiveWorkspaceMigrationFailure'),
    sourcePayloadRoot: 'source-payload',
    targetPayloadRoot: 'target-payload',
    temporaryRoot: 'temporary-root',
  });

  assert.equal(arguments_.includes('-FaultScenario'), true);
  assert.equal(arguments_.includes('passiveWorkspaceMigrationFailure'), true);
  assert.equal(arguments_.some((value) => value === '-FaultMode'), false);
  assert.equal(arguments_.some((value) => value === '-UserDataPath'), false);
});

function createDependencies(events, overrides = {}) {
  let fixtureNumber = 0;
  return {
    async buildInstallerPair() {
      events.push({ type: 'build' });
      return installerPair;
    },
    async createRunFixture(input) {
      fixtureNumber += 1;
      events.push({ faultScenario: input.faultScenario, type: 'create' });
      return createRun(input.faultScenario, fixtureNumber);
    },
    async removeRunFixture() {
      events.push({ type: 'remove' });
    },
    resolveElectronRuntime() {
      return { executablePath: 'electron.exe' };
    },
    async resolveTemporaryRoot() {
      return 'temporary-root';
    },
    async runProcess(_command, arguments_) {
      events.push({
        faultScenario: arguments_[arguments_.indexOf('-FaultScenario') + 1],
        type: 'run',
      });
    },
    async verifyInstallerPair(value) {
      assert.equal(value, installerPair);
      events.push({ type: 'verifyPair' });
    },
    async verifyProfileApplication() {
      events.push({ type: 'verifyProfile' });
    },
    async verifyRunFixture() {
      events.push({ type: 'verifyRun' });
    },
    ...overrides,
  };
}

function createRun(faultScenario, number = 1) {
  return Object.freeze({
    faultScenario,
    proofRoot: `proof-${number}`,
    source: Object.freeze({
      installerPath: 'source.msi',
      packageSha256: 'a'.repeat(64),
      productCode: '11111111-1111-5111-8111-111111111111',
    }),
    target: Object.freeze({
      installerPath: 'target.msi',
      packageSha256: 'b'.repeat(64),
      productCode: '22222222-2222-5222-8222-222222222222',
    }),
    token: String(number % 10).repeat(64),
  });
}
