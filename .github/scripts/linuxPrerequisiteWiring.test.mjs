import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { win32 } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const core = read('../workflows/ci.yml');
const cadence = read('../workflows/ci-cadence-contracts.yml');
const manifest = JSON.parse(read('../../eky_software/package.json'));
const consumers = [
  { job: 'e2e-system-security', step: 'Run isolated system security E2E tests',
    consumer: 'system-api', command: 'pnpm test:e2e:system', timeout: 10 },
  { job: 'e2e-web-critical', step: 'Run critical web E2E journeys',
    consumer: 'web-chromium', command: 'pnpm --filter @eky/e2e e2e:web:critical', timeout: 15 },
];

function windowsGitBash(searchPath, isFile) {
  const gitDirectory = searchPath.split(';').find((directory) => directory
    && win32.isAbsolute(directory) && isFile(win32.join(directory, 'git.exe')));
  assert.ok(gitDirectory, 'WINDOWS_GIT_NOT_FOUND');
  // Standard and portable Git expose cmd/git.exe or bin/git.exe, not bash on PATH.
  const bash = win32.resolve(gitDirectory, '..', 'bin', 'bash.exe');
  assert.ok(isFile(bash), 'GIT_BASH_NOT_FOUND');
  return bash;
}

function fixtureShell() {
  if (process.platform !== 'win32') return '/bin/bash';
  return windowsGitBash(process.env.Path ?? '', (path) => {
    try { return statSync(path).isFile(); } catch { return false; }
  });
}

test('Windows shell selection uses the discovered Git installation, never a WSL launcher', () => {
  for (const exposedDirectory of ['cmd', 'bin']) {
    const git = `C:\\Program Files\\Git\\${exposedDirectory}\\git.exe`;
    const bash = 'C:\\Program Files\\Git\\bin\\bash.exe';
    const existing = new Set([git, bash, 'C:\\Windows\\System32\\bash.exe']);
    assert.equal(windowsGitBash(`C:\\Windows\\System32;C:\\Program Files\\Git\\${exposedDirectory}`,
      (path) => existing.has(path)), bash);
  }
  assert.throws(() => windowsGitBash('C:\\Windows\\System32', () => false), /WINDOWS_GIT_NOT_FOUND/u);
  assert.throws(() => windowsGitBash('C:\\ExampleGit\\cmd', (path) => path.endsWith('git.exe')), /GIT_BASH_NOT_FOUND/u);
});

function jobBlock(source, name) {
  const start = source.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1);
  return source.slice(start + 1).split(/\n(?=  [\w-]+:\n)/u)[0];
}

function stepScript(source, name) {
  const step = source.split(`      - name: ${name}\n`)[1]?.split(/\n      - name:/u)[0];
  assert.ok(step);
  assert.doesNotMatch(step, /continue-on-error:|if:|shell:|timeout-minutes:/u);
  assert.match(step, /env:\n          EKY_E2E: '1'\n          EKY_LINUX_OWNERSHIP_PREREQUISITES: \$\{\{ inputs\.linux_ownership_prerequisites == true \}\}/u);
  const body = step.split('        run: |\n')[1]?.trimEnd();
  assert.ok(body);
  return body.split('\n').map((line) => {
    assert.ok(line.startsWith('          '));
    return line.slice(10);
  }).join('\n');
}

function expectedScript({ consumer, command }) {
  return [
    'if [ "$EKY_LINUX_OWNERSHIP_PREREQUISITES" = "true" ]; then',
    '  checkout_sha="$(git rev-parse --verify HEAD 2>/dev/null)" || checkout_sha=""',
    `  if node apps/e2e/experiments/processOwnership/probeLinuxPrerequisites.mjs --consumer=${consumer} --checkout-sha="$checkout_sha" 2>/dev/null; then`,
    "    printf '%s\\n' 'LINUX_PREREQUISITE_EXIT_OK'",
    '  else',
    "    printf '%s\\n' 'LINUX_PREREQUISITE_EXIT_UNVERIFIED'",
    '  fi',
    'fi',
    command,
  ].join('\n');
}

test('Linux prerequisite observation requires explicit manual opt-in across the workflow boundary', () => {
  assert.match(cadence.split('permissions:')[0], /linux_ownership_prerequisites:\n        description: [^\n]+\n        type: boolean\n        default: false/u);
  assert.match(core.split('permissions:')[0], /linux_ownership_prerequisites:\n        required: false\n        type: boolean\n        default: false/u);
  const caller = jobBlock(cadence, 'core');
  assert.match(caller, /risk_plan: \$\{\{ needs\.classification\.outputs\.plan \}\}/u);
  const expression = caller.match(/linux_ownership_prerequisites: \$\{\{ (.+) \}\}/u)?.[1];
  assert.equal(expression, "github.event_name == 'workflow_dispatch' && inputs.linux_ownership_prerequisites == true");
  for (const eventName of ['pull_request', 'push', 'schedule', 'workflow_dispatch']) {
    for (const enabled of [undefined, false, true, 'false', 'true']) {
      const selected = runInNewContext(expression, {
        github: { event_name: eventName }, inputs: { linux_ownership_prerequisites: enabled },
      }, { timeout: 1000 });
      assert.equal(selected, eventName === 'workflow_dispatch' && enabled === true);
    }
  }
});

test('observation remains in each existing Linux test step after its prerequisites', () => {
  for (const consumer of consumers) {
    const block = jobBlock(core, consumer.job);
    assert.match(block, /if: inputs\.risk_plan != ''\n    runs-on: ubuntu-latest/u);
    assert.ok(block.includes(`timeout-minutes: ${consumer.timeout}\n`));
    assert.match(block, /working-directory: eky_software/u);
    assert.equal(stepScript(block, consumer.step), expectedScript(consumer));
    assert.ok(block.indexOf('pnpm install --frozen-lockfile') < block.indexOf(consumer.step));
    if (consumer.consumer === 'web-chromium') {
      assert.ok(block.indexOf('playwright install --with-deps chromium') < block.indexOf(consumer.step));
    }
  }
  assert.equal(core.match(/probeLinuxPrerequisites\.mjs/gu)?.length, 2);
  assert.doesNotMatch(core, /continue-on-error:/u);
});

test('both the local CI command and CI cadence run the new wiring and pure probe contracts', () => {
  const command = jobBlock(cadence, 'cadence_contracts').match(/        run: (node --test[^\n]+)/u)?.[1];
  assert.ok(command);
  for (const file of ['.github/scripts/linuxPrerequisiteWiring.test.mjs',
    'eky_software/apps/e2e/experiments/processOwnership/linuxPrerequisiteContract.test.mjs',
    'eky_software/apps/e2e/experiments/processOwnership/probeLinuxPrerequisites.test.mjs']) {
    assert.ok(command.split(' ').includes(file));
    const local = file.startsWith('eky_software/') ? file.slice('eky_software/'.length) : `../${file}`;
    assert.ok(manifest.scripts['test:ci'].split(' ').includes(local));
  }
  assert.match(command, /--test-concurrency=1/u);
});

for (const consumer of consumers) {
  test(`${consumer.consumer}: the real step preserves test execution and status after probe failures`, () => {
    const bash = fixtureShell();
    const script = stepScript(jobBlock(core, consumer.job), consumer.step);
    assert.equal(script, expectedScript(consumer));
    // Execute the exact workflow shell with inert functions, never the host probe or E2E workload.
    const inert = [
      'git() { printf "%s\\n" "0123456789abcdef0123456789abcdef01234567"; return "$GIT_STATUS"; }',
      'node() { printf "probe:%s:%s\\n" "$2" "$3"; return "$PROBE_STATUS"; }',
      'pnpm() { printf "test:%s\\n" "$*"; return "$TEST_STATUS"; }',
      script,
    ].join('\n');
    for (const enabled of ['false', 'true']) {
      for (const probeStatus of [0, 1, 124, 137]) {
        for (const testStatus of [0, 23]) {
          const result = spawnSync(bash,
            ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', inert], {
              encoding: 'utf8', timeout: 5000,
              env: { ...process.env, EKY_LINUX_OWNERSHIP_PREREQUISITES: enabled,
                PROBE_STATUS: String(probeStatus), TEST_STATUS: String(testStatus), GIT_STATUS: '0' },
            });
          assert.ifError(result.error);
          assert.equal(result.signal, null);
          assert.equal(result.status, testStatus);
          assert.equal(result.stderr, '');
          const expected = [...(enabled === 'true'
            ? [`probe:--consumer=${consumer.consumer}:--checkout-sha=0123456789abcdef0123456789abcdef01234567`,
              probeStatus === 0 ? 'LINUX_PREREQUISITE_EXIT_OK' : 'LINUX_PREREQUISITE_EXIT_UNVERIFIED'] : []),
          `test:${consumer.command.slice('pnpm '.length)}`];
          assert.deepEqual(result.stdout.trim().split(/\r?\n/u), expected);
        }
      }
    }
    const failedCheckout = spawnSync(bash,
      ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', inert], {
        encoding: 'utf8', timeout: 5000,
        env: { ...process.env, EKY_LINUX_OWNERSHIP_PREREQUISITES: 'true',
          GIT_STATUS: '1', PROBE_STATUS: '1', TEST_STATUS: '23' },
      });
    assert.ifError(failedCheckout.error);
    assert.equal(failedCheckout.status, 23);
    assert.equal(failedCheckout.stderr, '');
    assert.deepEqual(failedCheckout.stdout.trim().split(/\r?\n/u), [
      `probe:--consumer=${consumer.consumer}:--checkout-sha=`, 'LINUX_PREREQUISITE_EXIT_UNVERIFIED',
      `test:${consumer.command.slice('pnpm '.length)}`,
    ]);
  });
}
