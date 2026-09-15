import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { link, lstat, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createWorkspaceSuccessArtifactTestFixture as fixture } from './workspaceSuccessArtifactTestFixture.mjs';
import { buildWorkspaceSuccessArtifact, parseWorkspaceSuccessArtifactBuildArguments,
  workspaceArtifactBuildFailureSummary } from './buildWorkspaceSuccessArtifact.mjs';
import { hashWorkspaceSuccessArtifactFile, verifyWorkspaceSuccessArtifact } from './workspaceSuccessArtifact.mjs';
import {
  WORKSPACE_SUCCESS_DESCRIPTOR_FILENAME,
  WORKSPACE_SUCCESS_VERSIONS,
  validateWorkspaceSuccessArtifactDescriptor,
} from './workspaceSuccessArtifactDescriptor.mjs';
import { parseWorkspaceSuccessArtifactVerifyArguments } from './verifyWorkspaceSuccessArtifact.mjs';
import { materializeWorkspaceSuccessArtifactFixture, prepareWorkspaceSuccessRunFixture,
  workspaceSuccessRunContext } from './workspaceSuccessRunFixture.mjs';
import { createWorkspaceSuccessRequest } from './workspaceSuccessContracts.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REVISION = '0123456789abcdef0123456789abcdef01234567';
const INVALID = /^WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_/;

test('build-once pair is independently copied and verified twice without building or changing source bytes', async (t) => {
  const f = await fixture(t);
  const before = await readFile(f.descriptorPath);
  assert.equal(f.getBuildCount(), 1);
  assert.deepEqual((await readdir(f.artifactRoot)).sort(), [WORKSPACE_SUCCESS_DESCRIPTOR_FILENAME, 'source', 'target'].sort());
  for (let run = 0; run < 2; run += 1) {
    const result = await verifyWorkspaceSuccessArtifact(f.verification);
    assert.equal(result.status, 'completed');
    assert.equal(result.buildRevision, REVISION);
    for (const role of ['source', 'target']) {
      assert.equal(result[role].appVersion, WORKSPACE_SUCCESS_VERSIONS[role]);
      assert.equal(result[role].buildRevision, REVISION.slice(0, 12));
      const original = await lstat(f.pair[role].installerPath, { bigint: true });
      const copy = await lstat(result[role].installerPath, { bigint: true });
      assert.equal(copy.nlink, 1n);
      assert.notEqual(`${copy.dev}:${copy.ino}`, `${original.dev}:${original.ino}`);
      assert.deepEqual(await readFile(result[role].installerPath), await readFile(f.pair[role].installerPath));
    }
  }
  assert.deepEqual(await readFile(f.descriptorPath), before);
  assert.equal(f.getBuildCount(), 1);
});

for (const alternateCase of [false, true]) {
  test(`consumer materialization binds independent canonical copies: ${alternateCase ? 'alternate Windows casing' : 'normal path'}`, {
    skip: alternateCase && process.platform !== 'win32',
  }, async (t) => {
    const f = await fixture(t, { temporaryRoot: alternateCase ? tmpdir().toLowerCase() : tmpdir() });
    assert.equal(f.root, await realpath(f.root));
    const runRoot = resolve(f.root, 'run');
    await mkdir(runRoot);
    const copied = await materializeWorkspaceSuccessArtifactFixture(f.verification, resolve(runRoot, 'fixture'));
    const scenarioRoot = resolve(runRoot, 'scenario');
    await mkdir(scenarioRoot);
    const request = createWorkspaceSuccessRequest({ fixtureRoot: copied.artifactRoot, buildRevision: copied.buildRevision,
      artifactDescriptorSha256: copied.descriptorSha256 });
    const context = workspaceSuccessRunContext(resolve(scenarioRoot, 'worker-request.json'), request, copied);
    await prepareWorkspaceSuccessRunFixture(context);
    for (const role of ['source', 'target']) {
      const paths = [f.pair[role].installerPath, copied[role].installerPath, context.runFixture[role].installerPath];
      const identities = [];
      for (const path of paths) {
        const metadata = await lstat(path, { bigint: true });
        assert.equal(metadata.nlink, 1n);
        identities.push(`${metadata.dev}:${metadata.ino}`);
        assert.deepEqual(await readFile(path), await readFile(paths[0]));
      }
      assert.equal(new Set(identities).size, paths.length);
    }
    assert.deepEqual(await readdir(resolve(context.proofRoot, 'user-data')), []);
    assert.equal(f.getBuildCount(), 1);
    await verifyWorkspaceSuccessArtifact(f.verification);
    await assert.rejects(prepareWorkspaceSuccessRunFixture(context));
  });
}

test('consumer rejects an artifact identity mismatch without creating its fixture root', async (t) => {
  const f = await fixture(t);
  const destination = resolve(f.root, 'rejected-copy');
  await assert.rejects(materializeWorkspaceSuccessArtifactFixture({ ...f.verification,
    expectedDescriptorSha256: 'f'.repeat(64) }, destination));
  await assert.rejects(lstat(destination), { code: 'ENOENT' });
});

for (const [name, change] of [
  ['unknown descriptor field', (d) => { d.path = 'private'; }],
  ['unknown role field', (d) => { d.source.companyId = 'private'; }],
  ['unknown payload field', (d) => { d.target.payloadInventory.path = 'private'; }],
  ['unknown schema', (d) => { d.schemaVersion = 2; }],
  ['foreign artifact kind', (d) => { d.artifactKind = 'windowsAcceptanceLegacyUpgrade'; }],
  ['short harness revision', (d) => { d.buildRevision = d.buildRevision.slice(0, 12); }],
  ['uppercase revision', (d) => { d.buildRevision = d.buildRevision.toUpperCase(); }],
  ['different source revision', (d) => { d.source.buildRevision = 'f'.repeat(12); }],
  ['different target revision', (d) => { d.target.buildRevision = 'f'.repeat(12); }],
  ['historical source version', (d) => { d.source.appVersion = '0.2.6'; }],
  ['different numeric target version', (d) => { d.target.appVersion = '0.2.9'; }],
  ['wrong MSI version', (d) => { d.target.msiProductVersion = '0.2.7'; }],
  ['wrong product code', (d) => { d.target.productCode = d.source.productCode; }],
  ['wrong upgrade code', (d) => { d.upgradeCode = 'foreign'; }],
  ['path traversal', (d) => { d.source.manifestPath = '../installer.manifest.json'; }],
  ['absolute manifest path', (d) => { d.target.manifestPath = 'C:/private/manifest.json'; }],
  ['swapped manifest roles', (d) => { d.source.manifestPath = d.target.manifestPath; }],
  ['same package bytes', (d) => { d.target.packageSha256 = d.source.packageSha256; }],
  ['same manifest bytes', (d) => { d.target.manifestSha256 = d.source.manifestSha256; }],
  ['same payload bytes', (d) => { d.target.payloadInventory.identity = d.source.payloadInventory.identity; }],
  ['invalid hash', (d) => { d.target.packageSha256 = 'z'.repeat(64); }],
  ['zero size', (d) => { d.target.packageSize = 0; }],
  ['fractional size', (d) => { d.target.packageSize = 2.5; }],
  ['oversized package', (d) => { d.target.packageSize = 536_870_913; }],
  ['empty inventory', (d) => { d.target.payloadInventory.fileCount = 0; }],
  ['oversized inventory', (d) => { d.target.payloadInventory.fileCount = 2_801; }],
  ['wrong inventory stage', (d) => { d.target.payloadInventory.stage = 'backendStage'; }],
  ['oversized payload', (d) => { d.target.payloadInventory.totalByteSize = 536_870_913; }],
]) {
  test(`descriptor rejects ${name}`, async (t) => {
    const f = await fixture(t);
    const descriptor = await f.descriptor();
    change(descriptor);
    assert.throws(() => validateWorkspaceSuccessArtifactDescriptor(descriptor), {
      message: 'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_DESCRIPTOR_INVALID',
    });
  });
}

for (const name of ['source', 'target']) {
  test(`rejects changed ${name} package bytes`, async (t) => {
    const f = await fixture(t);
    await writeFile(resolve(f.artifactRoot, name, `Eky-${WORKSPACE_SUCCESS_VERSIONS[name]}-x64.msi`), 'changed');
    await assert.rejects(verifyWorkspaceSuccessArtifact(f.verification), { message: INVALID });
  });
}

test('strict parser rejects duplicate keys even with a matching descriptor hash', async (t) => {
  const f = await fixture(t);
  const bytes = await readFile(f.descriptorPath, 'utf8');
  await writeFile(f.descriptorPath, bytes.replace('{', '{"schemaVersion":1,'));
  f.verification.expectedDescriptorSha256 = (await hashWorkspaceSuccessArtifactFile(f.descriptorPath)).sha256;
  await assert.rejects(verifyWorkspaceSuccessArtifact(f.verification), { message: INVALID });
});

test('rejects a self-consistent descriptor whose role identity differs from its manifest', async (t) => {
  const f = await fixture(t);
  const descriptor = await f.descriptor();
  descriptor.target.packageSize += 1;
  await f.rewriteDescriptor(descriptor);
  await assert.rejects(verifyWorkspaceSuccessArtifact(f.verification), { message: INVALID });
});

for (const extra of ['private.log', 'source/workspace.sqlite', 'target/extra-directory']) {
  test(`closed inventory rejects extra ${extra}`, async (t) => {
    const f = await fixture(t);
    if (extra.endsWith('directory')) await mkdir(resolve(f.artifactRoot, extra));
    else await writeFile(resolve(f.artifactRoot, extra), 'synthetic excluded content');
    await assert.rejects(verifyWorkspaceSuccessArtifact(f.verification), { message: INVALID });
  });
}

for (const relativePath of [WORKSPACE_SUCCESS_DESCRIPTOR_FILENAME, 'source/installer.manifest.json', 'target/Eky-0.2.8-x64.msi']) {
  test(`hardlink rejected for ${relativePath}`, async (t) => {
    const f = await fixture(t);
    await link(resolve(f.artifactRoot, relativePath), resolve(f.root, 'extra-link'));
    await assert.rejects(verifyWorkspaceSuccessArtifact(f.verification), { message: INVALID });
  });
}

test('linked role directory is rejected without following it', async (t) => {
  const f = await fixture(t);
  const target = resolve(f.artifactRoot, 'target');
  await rm(target, { recursive: true });
  await symlink(resolve(f.root, 'staged-target'), target, 'junction');
  await assert.rejects(verifyWorkspaceSuccessArtifact(f.verification), { message: INVALID });
});

test('existing artifact is preserved and prevents any build', async (t) => {
  const f = await fixture(t);
  const before = await readFile(f.descriptorPath);
  await assert.rejects(buildWorkspaceSuccessArtifact(f.options), { code: 'EEXIST' });
  assert.deepEqual(await readFile(f.descriptorPath), before);
  assert.equal(f.getBuildCount(), 1);
});

test('staged revision mismatch removes only the incomplete artifact', async (t) => {
  const f = await fixture(t, { build: false });
  f.pair.buildRevision = 'f'.repeat(12);
  await assert.rejects(buildWorkspaceSuccessArtifact(f.options), {
    message: 'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_STAGED_IDENTITY_INVALID',
  });
  await assert.rejects(lstat(f.artifactRoot), { code: 'ENOENT' });
  assert.equal((await lstat(f.pair.source.installerPath)).isFile(), true);
});

test('build failure preserves its original error and does not remove sibling data', async (t) => {
  const f = await fixture(t, { build: false });
  const sentinel = resolve(f.root, 'foreign-sentinel');
  await writeFile(sentinel, 'preserved');
  const original = new Error('SYNTHETIC_BUILD_FAILURE');
  await assert.rejects(buildWorkspaceSuccessArtifact({
    ...f.options, createInstallerPair: async () => { throw original; },
  }), (error) => error === original);
  await assert.rejects(lstat(f.artifactRoot), { code: 'ENOENT' });
  assert.equal(await readFile(sentinel, 'utf8'), 'preserved');
});

test('producer failure preserves its original platform error and exposes only its closed code', async (t) => {
  const f = await fixture(t, { build: false });
  const original = Object.assign(new Error('synthetic private path and command'), {
    code: 'ENOENT', path: 'synthetic-private-path',
  });
  let observed;
  await assert.rejects(buildWorkspaceSuccessArtifact({
    ...f.options, createInstallerPair: async () => { throw original; },
  }), (error) => { observed = error; return error === original; });
  assert.deepEqual(workspaceArtifactBuildFailureSummary(observed), {
    schemaVersion: 1, status: 'failed',
    errorCode: 'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_BUILD_FAILED',
    failureCode: 'ENOENT', cleanupFailureCode: null,
  });
  await assert.rejects(lstat(f.artifactRoot), { code: 'ENOENT' });
  assert.equal((await lstat(f.pair.source.installerPath)).isFile(), true);
});

test('producer diagnostics separate inventory rejection, unknown failure and secondary cleanup failure', () => {
  const original = new Error('PACKAGE_ARTIFACT_INVENTORY_INVALID:FILE_COUNT');
  const cleanup = Object.assign(new Error('synthetic private cleanup detail'), { code: 'EBUSY' });
  const aggregate = new AggregateError([original, cleanup],
    'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_BUILD_CLEANUP_FAILED');
  assert.deepEqual(workspaceArtifactBuildFailureSummary(aggregate), {
    schemaVersion: 1, status: 'failed',
    errorCode: 'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_BUILD_FAILED',
    failureCode: original.message, cleanupFailureCode: 'EBUSY',
  });
  assert.equal(aggregate.errors[0], original);
  assert.equal(aggregate.errors[1], cleanup);
  for (const message of ['synthetic private detail',
    'PACKAGE_ARTIFACT_INVENTORY_INVALID:PRIVATE_UNREVIEWED_VALUE',
    'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_PRIVATE_UNREVIEWED_VALUE']) {
    const error = Object.assign(new Error(message), { code: 'UNREVIEWED_PRIVATE_CODE' });
    const result = workspaceArtifactBuildFailureSummary(error);
    assert.equal(result.failureCode, 'unclassifiedBuildFailure');
    assert.equal(JSON.stringify(result).includes(message), false);
  }
});

test('producer CLI keeps failure exit and reports only safe argument classification', () => {
  const result = spawnSync(process.execPath,
    [resolve(ROOT, 'buildWorkspaceSuccessArtifact.mjs'), '--synthetic-private-argument'],
    { encoding: 'utf8', timeout: 10_000, windowsHide: true });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr), {
    schemaVersion: 1, status: 'failed',
    errorCode: 'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_BUILD_FAILED',
    failureCode: 'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_ARGUMENTS_INVALID',
    cleanupFailureCode: null,
  });
});

test('producer CLI diagnostic delivery failure cannot replace the failed build exit', () => {
  const entry = new URL('./buildWorkspaceSuccessArtifact.mjs', import.meta.url);
  const script = `console.error = () => { throw new Error('synthetic output failure'); };
    process.argv = [process.execPath, ${JSON.stringify(fileURLToPath(entry))}];
    await import(${JSON.stringify(entry.href)});`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', timeout: 10_000, windowsHide: true,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('rejected Git preflight does not build or create an artifact', async (t) => {
  const f = await fixture(t, { build: false });
  await assert.rejects(buildWorkspaceSuccessArtifact({
    ...f.options, readGitState: async () => { throw new Error('SYNTHETIC_DIRTY_BUILD'); },
  }), { message: 'SYNTHETIC_DIRTY_BUILD' });
  assert.equal(f.getBuildCount(), 0);
  await assert.rejects(lstat(f.artifactRoot), { code: 'ENOENT' });
});

test('HEAD changing during build rejects publication', async (t) => {
  const f = await fixture(t, { build: false });
  let reads = 0;
  await assert.rejects(buildWorkspaceSuccessArtifact({
    ...f.options, readGitState: async () => (++reads === 1 ? REVISION : 'f'.repeat(40)),
  }), { message: 'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_BUILD_IDENTITY_INVALID' });
  await assert.rejects(lstat(f.artifactRoot), { code: 'ENOENT' });
});

test('build and verifier arguments reject unpinned inputs and summary inside artifact', () => {
  const root = resolve(tmpdir(), 'synthetic-v26-artifact');
  assert.throws(() => parseWorkspaceSuccessArtifactBuildArguments(['--artifact-root', root, '--summary-path', resolve(root, 'summary.json')]), { message: INVALID });
  assert.throws(() => parseWorkspaceSuccessArtifactVerifyArguments(['--artifact-root', root]), { message: INVALID });
  assert.throws(() => parseWorkspaceSuccessArtifactBuildArguments(['--artifact-root', resolve(ROOT, '../../.stage/v26'), '--summary-path', resolve(tmpdir(), 'summary.json')]), { message: INVALID });
  const summary = resolve(tmpdir(), 'summary.json');
  assert.equal(parseWorkspaceSuccessArtifactBuildArguments(['--artifact-root', root, '--summary-path', summary]).summaryPath, summary);
});

test('verifier command emits only safe artifact evidence and never path or raw failure', async (t) => {
  const f = await fixture(t);
  const args = [resolve(ROOT, 'verifyWorkspaceSuccessArtifact.mjs'), '--artifact-root', f.artifactRoot,
    '--expected-descriptor-sha256', f.summary.descriptorSha256, '--expected-build-revision', REVISION];
  const success = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 5_000, windowsHide: true });
  assert.equal(success.status, 0);
  assert.equal(success.stderr, '');
  const evidence = JSON.parse(success.stdout);
  assert.equal(evidence.resultCode, 'workspaceSuccessArtifactVerified');
  assert.deepEqual(Object.keys(evidence).sort(), ['schemaVersion', 'status', 'resultCode', 'buildRevision', 'descriptorSha256', 'sourcePackageSha256', 'targetPackageSha256', 'sourcePayloadIdentity', 'targetPayloadIdentity'].sort());
  args[4] = createHash('sha256').update('wrong descriptor').digest('hex');
  const failure = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 5_000, windowsHide: true });
  assert.equal(failure.status, 1);
  assert.equal(failure.stdout, '');
  assert.deepEqual(JSON.parse(failure.stderr), { schemaVersion: 1, status: 'failed', errorCode: 'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_VERIFICATION_FAILED' });
});
