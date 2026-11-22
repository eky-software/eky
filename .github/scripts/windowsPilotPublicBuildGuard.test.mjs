import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertPublicBuildBaseline } from './windowsPilotPublicBuildPolicy.mjs';

const repository = 'eky-software/eky';
const server = 'https://github.com';
const pkg = { name: '@eky/desktop', private: true, version: '0.2.81' };
const release = { appIdentity: 'Eky', appVersion: '0.2.81', msiProductVersion: '0.2.81',
  releaseChannel: 'pilot', platform: 'win32', architecture: 'x64' };
const bytes = value => Buffer.from(JSON.stringify(value));
const denial = { message: 'WINDOWS_PUBLIC_BUILD_BASELINE_DENIED' };

test('only the canonical public repository and matching desktop and installer identities pass', () => {
  const check = (p, r) => assertPublicBuildBaseline(repository, server, bytes(p), bytes(r));
  check({ ...pkg, scripts: {} }, release);
  for (const [repo, host] of [[undefined, server], ['elsewhere/eky', server],
    [repository, undefined], [repository, 'https://example.invalid']]) {
    assert.throws(() => assertPublicBuildBaseline(repo, host, bytes(pkg), bytes(release)), denial);
  }
  for (const [target, field] of [[pkg, 'name'], [pkg, 'private'], [pkg, 'version'],
    ...Object.keys(release).map(field => [release, field])]) {
    for (const value of [undefined, null, false, 81, 'unknown', target[field] + ' ']) {
      const changed = { ...target, [field]: value };
      assert.throws(() => check(target === pkg ? changed : pkg, target === release ? changed : release), denial);
    }
  }
  for (const version of ['0.2.80', '0.2.82', '0.3.0', '0.3.2', '0.3.1-rc.1', '0.3.1+build',
    '0.3.01', '0.2.81-rc.1', '0.2.81+build', '0.2.081']) {
    assert.throws(() => check({ ...pkg, version }, { ...release, appVersion: version, msiProductVersion: version }), denial);
  }
});

test('0.3.1 is explicitly allowed only as a matching test build, not a public release candidate', () => {
  const check = (p, r, candidate) => assertPublicBuildBaseline(repository, server, bytes(p), bytes(r), candidate);
  const candidatePkg = { ...pkg, version: '0.3.1' };
  const candidateRelease = { ...release, appVersion: '0.3.1', msiProductVersion: '0.3.1' };
  check(candidatePkg, candidateRelease, false);
  check(pkg, release, true);
  assert.throws(() => check(candidatePkg, candidateRelease, true), denial);
  assert.throws(() => check(candidatePkg, candidateRelease, 'false'), denial);
  assert.throws(() => check(candidatePkg, release, false), denial);
  assert.throws(() => check(pkg, candidateRelease, false), denial);
  assert.throws(() => check(candidatePkg, { ...candidateRelease, msiProductVersion: '0.2.81' }, false), denial);
  assert.throws(() => check(candidatePkg, { ...candidateRelease, releaseChannel: 'stable' }, false), denial);
});

test('unavailable, malformed or ambiguous manifests are denied independently', () => {
  for (const [valid, key] of [[pkg, 'version'], [release, 'appVersion']]) {
    const duplicate = JSON.stringify(valid).replace('{', `{"${key}":"other",`);
    for (const invalid of [undefined, Buffer.alloc(0), bytes(null), bytes([]), Buffer.from('{'),
      Buffer.from([0xff]), Buffer.from(duplicate), Buffer.from(JSON.stringify(valid) + ' '.repeat(65536))]) {
      assert.throws(() => assertPublicBuildBaseline(repository, server,
        valid === pkg ? invalid : bytes(pkg), valid === release ? invalid : bytes(release)), denial);
    }
  }
});

test('importing the policy outside CI does not execute the guard', () => {
  const policy = new URL('./windowsPilotPublicBuildPolicy.mjs', import.meta.url);
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `await import(${JSON.stringify(policy.href)})`], {
    encoding: 'utf8', timeout: 5000, env: { ...process.env, GITHUB_REPOSITORY: '', GITHUB_SERVER_URL: '' },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('the CLI checks the fixed checkout files, rejects an override and emits only a bounded denial', () => {
  const desktop = new URL('../../eky_software/apps/desktop/', import.meta.url);
  const current = JSON.parse(readFileSync(new URL('package.json', desktop), 'utf8'));
  const installer = JSON.parse(readFileSync(new URL('installer/installer-release.json', desktop), 'utf8'));
  const expected = ['0.2.81', '0.3.1'].includes(current.version) &&
    [installer.appVersion, installer.msiProductVersion].every(v => v === current.version) ? 0 : 1;
  const script = fileURLToPath(new URL('./windowsPilotPublicBuildGuard.mjs', import.meta.url));
  for (const [repo, args, status] of [[repository, [], expected], ['', [], 1], [repository, ['--private=true'], 1]]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      cwd: fileURLToPath(desktop), encoding: 'utf8', timeout: 5000,
      env: { ...process.env, GITHUB_REPOSITORY: repo, GITHUB_SERVER_URL: server, REQUIRE_RELEASE_CANDIDATE: 'false' },
    });
    assert.ifError(result.error);
    assert.equal(result.status, status);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.trimEnd(), status === 0 ? '' : denial.message);
  }
});

test('the CLI admits only the named test versions and denies the new release-candidate path', t => {
  const root = mkdtempSync(join(tmpdir(), 'eky-public-producer-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scripts = '.github/scripts';
  const desktop = 'eky_software/apps/desktop';
  for (const path of [scripts + '/windowsPilotPublicBuildGuard.mjs', scripts + '/windowsPilotPublicBuildPolicy.mjs',
    desktop + '/installer/windows-acceptance-harness/strictJsonObject.mjs']) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    copyFileSync(fileURLToPath(new URL('../../' + path, import.meta.url)), join(root, path));
  }
  for (const [version, mode, status] of [
    ['0.2.81', undefined, 0], ['0.2.81', 'true', 0], ['0.3.1', 'false', 0],
    ['0.3.1', 'true', 1], ['0.3.1', 'False', 1], ['0.3.1', '', 1],
    ['0.3.0', 'false', 1], ['0.3.2', 'false', 1],
  ]) {
    writeFileSync(join(root, desktop, 'package.json'),
      JSON.stringify({ ...pkg, version, description: 'x'.repeat(24 * 1024) }));
    writeFileSync(join(root, desktop, 'installer/installer-release.json'),
      JSON.stringify({ ...release, appVersion: version, msiProductVersion: version }));
    const env = { ...process.env, GITHUB_REPOSITORY: repository, GITHUB_SERVER_URL: server };
    if (mode === undefined) delete env.REQUIRE_RELEASE_CANDIDATE;
    else env.REQUIRE_RELEASE_CANDIDATE = mode;
    const result = spawnSync(process.execPath, [join(root, scripts, 'windowsPilotPublicBuildGuard.mjs')], {
      cwd: root, encoding: 'utf8', timeout: 5000,
      env,
    });
    assert.ifError(result.error);
    assert.equal(result.status, status);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.trimEnd(), status === 0 ? '' : denial.message);
  }
});

const readWorkflow = family => readFileSync(new URL(`../workflows/windows-acceptance-v2-${family}.yml`, import.meta.url), 'utf8');
const command = 'node .github/scripts/windowsPilotPublicBuildGuard.mjs';
const candidateEnv = "        env:\n          REQUIRE_RELEASE_CANDIDATE: ${{ github.event_name == 'workflow_dispatch' && inputs.release_candidate == true }}\n";
for (const [family, jobId] of [['clean', 'artifact_producer'], ['upgrade', 'upgrade_artifact_producer'],
  ['legacy-diagnostic', 'legacy_artifact_producer']]) {
  test(`${jobId} requires the guard immediately after checkout for reusable and manual runs`, () => {
    const yaml = readWorkflow(family).replaceAll('\r\n', '\n');
    const [header, jobs] = yaml.split('\njobs:\n');
    assert.match(header, /^  workflow_call:/mu);
    assert.match(header, /^  workflow_dispatch:/mu);
    assert.equal(yaml.split(command).length, 2);
    const job = jobs.split(/(?=^  [\w-]+:\n)/mu).find(block => block.startsWith(`  ${jobId}:\n`));
    const steps = job.split('\n    steps:\n')[1].split(/^      - /mu).slice(1).map(step => step.trimEnd());
    assert.match(steps[0], /^name: Check out [^\n]+\n        uses: actions\/checkout@[a-f0-9]{40}\n/u);
    assert.equal(steps[1], `name: Require public Windows producer baseline\n        working-directory: .\n` +
      (family === 'clean' ? candidateEnv : '') + `        run: ${command}`);
    for (const required of ['uses: actions/setup-node@', 'pnpm install --frozen-lockfile', 'id: produce', 'uses: actions/upload-artifact@']) {
      const matches = steps.filter(step => step.includes(required));
      assert.equal(matches.length, 1, required);
      assert.ok(steps.indexOf(matches[0]) > 1);
      assert.doesNotMatch(matches[0], /^        (?:if|continue-on-error):/mu);
    }
    const upload = steps.find(step => step.includes('uses: actions/upload-artifact@'));
    assert.match(upload, /^          retention-days: 1$/mu);
    assert.equal([...upload.matchAll(/^\s+retention-days:/gmu)].length, 1);
  });
}

test('the clean producer pins the dispatch-only release-candidate flag in both steps', () => {
  const yaml = readWorkflow('clean').replaceAll('\r\n', '\n');
  assert.equal(yaml.split('REQUIRE_RELEASE_CANDIDATE:').length, 3);
  const build = yaml.split(/^      - /mu).find(step => step.startsWith('name: Build acceptance artifact once\n'));
  assert.ok(build.includes(candidateEnv + '        run: |\n'));
  assert.match(build, /if \(\$env:REQUIRE_RELEASE_CANDIDATE -ceq 'true'\) \{\n            \$releaseArguments = @\('--release-candidate'\)/u);
});

test('workspace workflow remains outside the public producer guard', () => {
  assert.ok(!readWorkflow('workspace').includes(command));
});
