import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
  for (const version of ['0.2.80', '0.2.82', '0.3.1', '0.2.81-rc.1', '0.2.81+build', '0.2.081']) {
    assert.throws(() => check({ ...pkg, version }, { ...release, appVersion: version, msiProductVersion: version }), denial);
  }
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
  let expected = 0;
  try {
    assertPublicBuildBaseline(repository, server, readFileSync(new URL('package.json', desktop)),
      readFileSync(new URL('installer/installer-release.json', desktop)));
  } catch { expected = 1; }
  const script = fileURLToPath(new URL('./windowsPilotPublicBuildGuard.mjs', import.meta.url));
  for (const [repo, args, status] of [[repository, [], expected], ['', [], 1], [repository, ['--private=true'], 1]]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      cwd: fileURLToPath(desktop), encoding: 'utf8', timeout: 5000,
      env: { ...process.env, GITHUB_REPOSITORY: repo, GITHUB_SERVER_URL: server },
    });
    assert.ifError(result.error);
    assert.equal(result.status, status);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.trimEnd(), status === 0 ? '' : denial.message);
  }
});

const readWorkflow = family => readFileSync(new URL(`../workflows/windows-acceptance-v2-${family}.yml`, import.meta.url), 'utf8');
const command = 'node .github/scripts/windowsPilotPublicBuildGuard.mjs';
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
    assert.equal(steps[1], `name: Require public Windows producer baseline\n        working-directory: .\n        run: ${command}`);
    for (const required of ['uses: actions/setup-node@', 'pnpm install --frozen-lockfile', 'id: produce', 'uses: actions/upload-artifact@']) {
      const matches = steps.filter(step => step.includes(required));
      assert.equal(matches.length, 1, required);
      assert.ok(steps.indexOf(matches[0]) > 1);
      assert.doesNotMatch(matches[0], /^        (?:if|continue-on-error):/mu);
    }
  });
}

test('workspace workflow remains outside the public producer guard', () => {
  assert.ok(!readWorkflow('workspace').includes(command));
});
