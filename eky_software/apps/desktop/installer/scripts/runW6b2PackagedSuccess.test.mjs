import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createW6b2PackagedSuccessArguments,
  runW6b2PackagedSuccess,
} from './runW6b2PackagedSuccess.mjs';

const buildRevision = '123456789abc';
const pair = Object.freeze({
  buildRevision,
  source: packageIdentity('0.2.7', 'source'),
  target: packageIdentity('0.2.8', 'target'),
});

test('builds once and runs the same installer pair twice in isolated fixtures', async () => {
  let buildCount = 0;
  let createdCount = 0;
  let pairVerificationCount = 0;
  const processArguments = [];
  const removedTokens = [];
  const verifiedTokens = [];

  const result = await runW6b2PackagedSuccess({
    dependencies: {
      async buildInstallerPair() {
        buildCount += 1;
        return pair;
      },
      async createRunFixture() {
        createdCount += 1;
        return runFixture(String(createdCount).repeat(64));
      },
      async removeRunFixture(input) {
        removedTokens.push(input.token);
      },
      resolveElectronRuntime() {
        return { executablePath: 'C:\\fixture\\electron.exe' };
      },
      async runProcess(command, arguments_) {
        assert.equal(command, 'powershell.exe');
        processArguments.push(arguments_);
      },
      temporaryRoot() {
        return 'C:\\fixture-temp';
      },
      async verifyInstallerPair(value) {
        assert.equal(value, pair);
        pairVerificationCount += 1;
      },
      async verifyProfileApplication(path) {
        assert.equal(path, 'C:\\fixture\\profile');
      },
      async verifyRunFixture(input) {
        verifiedTokens.push(input.token);
      },
    },
    profileApplicationPath: 'C:\\fixture\\profile',
  });

  assert.deepEqual(result, {
    runCount: 2,
    sourceVersion: '0.2.7',
    status: 'completed',
    targetVersion: '0.2.8',
  });
  assert.equal(buildCount, 1);
  assert.equal(createdCount, 2);
  assert.equal(pairVerificationCount, 3);
  assert.deepEqual(verifiedTokens, ['1'.repeat(64), '2'.repeat(64)]);
  assert.deepEqual(removedTokens, ['1'.repeat(64), '2'.repeat(64)]);
  assert.equal(processArguments.length, 2);
  assert.notDeepEqual(processArguments[0], processArguments[1]);
  for (const arguments_ of processArguments) {
    assert.ok(arguments_.includes(pair.source.installerPath));
    assert.ok(arguments_.includes(pair.target.installerPath));
    assert.equal(arguments_.includes('-ProofRoot'), false);
  }
});

test('cleans the current fixture and stops after a failed run', async () => {
  let createdCount = 0;
  const removedTokens = [];

  await assert.rejects(
    runW6b2PackagedSuccess({
      dependencies: {
        async buildInstallerPair() {
          return pair;
        },
        async createRunFixture() {
          createdCount += 1;
          return runFixture('a'.repeat(64));
        },
        async removeRunFixture(input) {
          removedTokens.push(input.token);
        },
        resolveElectronRuntime() {
          return { executablePath: 'C:\\fixture\\electron.exe' };
        },
        async runProcess() {
          throw new Error('private process failure');
        },
        temporaryRoot() {
          return 'C:\\fixture-temp';
        },
        async verifyInstallerPair() {},
        async verifyProfileApplication() {},
        async verifyRunFixture() {},
      },
      profileApplicationPath: 'C:\\fixture\\profile',
    }),
    /private process failure/u,
  );
  assert.equal(createdCount, 1);
  assert.deepEqual(removedTokens, ['a'.repeat(64)]);
});

test('rejects malformed proof tokens before creating process arguments', () => {
  assert.throws(
    () =>
      createW6b2PackagedSuccessArguments({
        buildRevision,
        electronPath: 'C:\\fixture\\electron.exe',
        profileApplicationPath: 'C:\\fixture\\profile',
        run: { ...runFixture('a'.repeat(64)), token: '../foreign' },
        sourcePayloadRoot: pair.source.packagedApplicationPath,
        targetPayloadRoot: pair.target.packagedApplicationPath,
        temporaryRoot: 'C:\\fixture-temp',
      }),
    /W6B2_SUCCESS_ARGUMENTS_INVALID/u,
  );
});

test('accepts bounded release revisions and rejects invalid revision shapes', () => {
  assert.doesNotThrow(() =>
    createW6b2PackagedSuccessArguments({
      buildRevision,
      electronPath: 'C:\\fixture\\electron.exe',
      profileApplicationPath: 'C:\\fixture\\profile',
      run: runFixture('a'.repeat(64)),
      sourcePayloadRoot: pair.source.packagedApplicationPath,
      targetPayloadRoot: pair.target.packagedApplicationPath,
      temporaryRoot: 'C:\\fixture-temp',
    }),
  );
  for (const invalidBuildRevision of [
    '1'.repeat(6),
    '1'.repeat(41),
    'ABCDEF123456',
  ]) {
    assert.throws(
      () =>
        createW6b2PackagedSuccessArguments({
          buildRevision: invalidBuildRevision,
          electronPath: 'C:\\fixture\\electron.exe',
          profileApplicationPath: 'C:\\fixture\\profile',
          run: runFixture('a'.repeat(64)),
          sourcePayloadRoot: pair.source.packagedApplicationPath,
          targetPayloadRoot: pair.target.packagedApplicationPath,
          temporaryRoot: 'C:\\fixture-temp',
        }),
      /W6B2_SUCCESS_ARGUMENTS_INVALID/u,
    );
  }
});

function packageIdentity(appVersion, role) {
  return Object.freeze({
    appVersion,
    buildRevision,
    installerPath: `C:\\fixture\\${role}.msi`,
    manifestPath: `C:\\fixture\\${role}.json`,
    packageSha256: role === 'source' ? 'a'.repeat(64) : 'b'.repeat(64),
    packageSize: role === 'source' ? 10 : 20,
    packagedApplicationPath: `C:\\fixture\\${role}-app`,
    productCode:
      role === 'source'
        ? '11111111-1111-5111-8111-111111111111'
        : '22222222-2222-5222-8222-222222222222',
  });
}

function runFixture(token) {
  return Object.freeze({
    proofRoot: `C:\\fixture-temp\\eky-w6b2\\${token}`,
    source: pair.source,
    target: pair.target,
    token,
  });
}
