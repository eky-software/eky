import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { classifyCiChanges, parseCiDiff, publishCiRiskPlan } from './classifyCiChanges.mjs';

const environment = { GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/1/merge',
  CI_BASE_SHA: 'a'.repeat(40), CI_HEAD_SHA: 'b'.repeat(40) };
const file = 'eky_software/apps/web/src/example name.tsx';
const diff = (files) => Buffer.from(files.map((value) => `${value}\0`).join(''));

test('Git comparison uses a complete NUL-delimited merge-base diff without rename folding or a shell', () => {
  let calls = 0;
  const plan = classifyCiChanges(environment, { git(command, args, options) {
    calls += 1;
    assert.equal(command, 'git');
    assert.deepEqual(args, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z',
      `${environment.CI_BASE_SHA}...${environment.CI_HEAD_SHA}`, '--']);
    assert.equal(options.shell, false);
    assert.equal(options.timeout, 10_000);
    return { status: 0, stdout: diff([file]) };
  } });
  assert.equal(calls, 1);
  assert.equal(plan.risk, 'fast');
});

test('removed and renamed source paths retain their compatibility requirements', () => {
  const plan = classifyCiChanges(environment, { git: () => ({ status: 0,
    stdout: diff(['eky_software/apps/desktop/src/main/old.ts', file]),
  }) });
  assert.equal(plan.gates.legacyUpgrade, true);
  assert.equal(plan.gates.workspaceFault, true);
});

test('Git error, signal, truncated output, invalid UTF-8 and byte overflow select the full matrix', () => {
  for (const result of [
    { status: 1, stdout: diff([file]) }, { status: null, stdout: diff([file]) },
    { status: 0, error: new Error('synthetic failure'), stdout: diff([file]) },
    { status: 0, stdout: Buffer.from(file) }, { status: 0, stdout: Buffer.from([0xff, 0]) },
    { status: 0, stdout: Buffer.alloc(4 * 1024 * 1024 + 1) },
    { status: 0, stdout: diff(['a/../b']) },
  ]) {
    const plan = classifyCiChanges(environment, { git: () => result });
    assert.equal(plan.risk, 'full');
    assert.equal(plan.reason, 'comparisonUnavailable');
  }
  assert.equal(classifyCiChanges(environment, { git() { throw new Error('failed'); } }).risk, 'full');
});

test('untrusted revision strings never reach Git and release events never depend on a changed-file list', () => {
  let calls = 0;
  for (const env of [{ ...environment, CI_HEAD_SHA: '--output=outside' },
    { ...environment, CI_BASE_SHA: undefined },
    { ...environment, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main' }]) {
    assert.equal(classifyCiChanges(env, { git() { calls += 1; return { status: 1 }; } }).risk, 'full');
  }
  assert.equal(calls, 0);
});

test('diff parser preserves spaces and Unicode and distinguishes empty data from invalid terminators', () => {
  assert.deepEqual(parseCiDiff(diff([file, 'docs/n\u00e4kym\u00e4.md'])), [file, 'docs/n\u00e4kym\u00e4.md']);
  assert.deepEqual(parseCiDiff(Buffer.alloc(0)), []);
  for (const bytes of [Buffer.from('a'), diff(['']), diff(['a\nb']), 'not bytes']) {
    assert.throws(() => parseCiDiff(bytes));
  }
});

test('published output is one closed plan without paths or environment details', () => {
  const plan = classifyCiChanges(environment, { git: () => ({ status: 0, stdout: diff([file]) }) });
  let output;
  publishCiRiskPlan(plan, 'synthetic-output', (path, value) => {
    assert.equal(path, 'synthetic-output');
    output = value;
  });
  assert.equal(output, `plan=${JSON.stringify(plan)}\n`);
  assert.ok(!output.includes(file));
  assert.ok(!output.includes(environment.CI_HEAD_SHA));
  assert.throws(() => publishCiRiskPlan(plan, ''), /CI_OUTPUT_UNAVAILABLE/);
  assert.throws(() => publishCiRiskPlan({ ...plan, secret: 'forbidden' }, 'output', () => assert.fail()));
});

test('actual CLI writes the required plan and exits; unsupported input fails with no raw output', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'eky-ci-contract-'));
  const command = fileURLToPath(new URL('./classifyCiChanges.mjs', import.meta.url));
  try {
    const output = resolve(root, 'output');
    const env = { ...process.env, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_OUTPUT: output };
    const result = spawnSync(process.execPath, [command], { env, encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    const text = await readFile(output, 'utf8');
    assert.equal(JSON.parse(text.slice(5)).risk, 'full');
    for (const invalid of [{ ...env, GITHUB_EVENT_NAME: 'pull_request_target' },
      { ...env, GITHUB_OUTPUT: root }]) {
      const failure = spawnSync(process.execPath, [command], { env: invalid, encoding: 'utf8', timeout: 10_000 });
      assert.equal(failure.status, 1);
      assert.equal(failure.stdout, '');
      assert.equal(failure.stderr, '');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('one cadence entry calls existing owners and always aggregates without replacing required checks', async () => {
  const source = await readFile(new URL('../workflows/ci-cadence-contracts.yml', import.meta.url), 'utf8');
  assert.match(source, /name: V2 risk-based CI/);
  assert.match(source, /push:\s+branches: \[main\]/);
  assert.match(source, /schedule:\s+- cron:/);
  assert.match(source, /name: V2 acceptance\s+if: always\(\)/);
  assert.match(source, /CI_NEEDS: \$\{\{ toJSON\(needs\) \}\}/);
  assert.match(source, /actions: read/);
  assert.match(source, /contents: read/);
  assert.match(source, /fetch-depth: 0/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /os: \[ubuntu-latest, windows-latest\]/);
  assert.match(source, /timeout-minutes: 5/);
  assert.match(source, /CI_BASE_SHA: \$\{\{ github.event.pull_request.base.sha \}\}/);
  assert.match(source, /CI_HEAD_SHA: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.doesNotMatch(source, /pull_request_target|continue-on-error|msiexec|installer:|upload-artifact|: write/);
  for (const action of [...source.matchAll(/uses: (\S+)/g)].map((match) => match[1])) {
    if (action.startsWith('./.github/workflows/')) {
      const child = await readFile(new URL(`../../${action}`, import.meta.url), 'utf8');
      assert.match(child, /workflow_call:/);
      if (!action.endsWith('/ci.yml')) assert.doesNotMatch(child.split('permissions:')[0], /pull_request:|push:/);
      continue;
    }
    assert.ok(['actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
      'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020'].includes(action));
  }
});
