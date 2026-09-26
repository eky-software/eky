import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const readManifest = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const root = readManifest('../../../package.json');
const e2e = readManifest('../package.json');
const desktop = readManifest('../../desktop/package.json');
const backend = readManifest('../../backend/package.json');
const preparations = [
  'pnpm --filter @eky/desktop e2e:prepare-electron-runtime',
  'pnpm --filter @eky/permissions build',
  'pnpm --filter @eky/auth build',
  'pnpm --filter @eky/backend e2e:build',
  'pnpm --filter @eky/web build',
  'pnpm --filter @eky/desktop build',
  'pnpm --filter @eky/desktop e2e:build',
  'pnpm --filter @eky/desktop e2e:prepare-backend',
];
const projects = '--project=system-api --project=web-chromium --project=electron-development';
const contractCommand = 'node --test scripts/e2e-command-wiring.test.mjs experiments/processOwnership/playwrightElectronLaunch.test.mjs experiments/processOwnership/adapterContract.test.mjs experiments/processOwnership/adapterControl.test.mjs experiments/processOwnership/adapterRootExitOrdering.test.mjs experiments/processOwnership/boundedChildOutput.test.mjs experiments/processOwnership/pidNamespaceContract.test.mjs experiments/processOwnership/runPidNamespaceExperiment.test.mjs experiments/processOwnership/managedNamespaceContract.test.mjs experiments/processOwnership/managedNamespaceControl.test.mjs experiments/processOwnership/managedNamespaceObservation.test.mjs experiments/processOwnership/managedNamespacePreflight.test.mjs experiments/processOwnership/managedNamespaceCommand.test.mjs experiments/processOwnership/managedNamespaceSession.test.mjs';

function assertWiring(rootManifest, e2eManifest) {
  assert.equal(rootManifest.scripts.test, 'pnpm --recursive test');
  assert.equal(e2eManifest.scripts.test, contractCommand);
  assert.deepEqual(e2eManifest.scripts['e2e:electron:prepare'].split(' && '), preparations);
  for (const tag of ['security', 'fault']) {
    assert.equal(rootManifest.scripts[`test:e2e:${tag}`], `pnpm --filter @eky/e2e e2e:${tag}`);
    assert.equal(
      e2eManifest.scripts[`e2e:${tag}`],
      `pnpm e2e:electron:prepare && playwright test ${projects} --grep @${tag}`,
    );
  }
}

test('the recursive workspace chain reaches this contract and both complete aggregates', () => {
  assertWiring(root, e2e);
  assert.ok(readFileSync(new URL('../scripts/e2e-command-wiring.test.mjs', import.meta.url)).length > 0);
});

test('preparation delegates to existing build and staging owners', () => {
  const manifests = new Map([
    ['@eky/desktop', desktop], ['@eky/backend', backend],
    ['@eky/auth', readManifest('../../../packages/auth/package.json')],
    ['@eky/permissions', readManifest('../../../packages/permissions/package.json')],
    ['@eky/web', readManifest('../../web/package.json')],
  ]);
  // Only these literal named pnpm calls are a supported contract, not arbitrary shell syntax.
  for (const command of preparations) {
    const [pnpm, filter, name, script, ...extra] = command.split(' ');
    assert.deepEqual([pnpm, filter, extra.length], ['pnpm', '--filter', 0]);
    assert.ok(manifests.get(name)?.scripts[script], command);
  }
  assert.equal(desktop.scripts['e2e:prepare-backend'], 'node scripts/prepare-electron-e2e-backend.mjs');
  assert.equal(
    desktop.scripts['e2e:prepare-electron-runtime'],
    'pnpm exec install-electron --no && node scripts/assert-electron-development-runtime.mjs',
  );
  assert.equal(backend.scripts['e2e:build'],
    'node scripts/clean-e2e-dist.mjs && tsc -p tsconfig.e2e.json && node scripts/copy-e2e-migrations.mjs');
});

const mutations = [
  ['missing preparation', (r, e) => { e.scripts['e2e:security'] = e.scripts['e2e:security'].split(' && ')[1]; }],
  ['backend-only preparation', (r, e) => { e.scripts['e2e:fault'] = e.scripts['e2e:fault'].replace('e2e:electron:prepare', 'e2e:prepare'); }],
  ['unconditional launch', (r, e) => { e.scripts['e2e:security'] = e.scripts['e2e:security'].replace(' && ', ' ; '); }],
  ['unknown project', (r, e) => { e.scripts['e2e:security'] = e.scripts['e2e:security'].replace('system-api', 'unknown-project'); }],
  ['missing project', (r, e) => { e.scripts['e2e:fault'] = e.scripts['e2e:fault'].replace(' --project=electron-development', ''); }],
  ['endurance included', (r, e) => { e.scripts['e2e:fault'] += ' --project=electron-endurance'; }],
  ['wrong tag', (r, e) => { e.scripts['e2e:security'] = e.scripts['e2e:security'].replace('@security', '@critical'); }],
  ['extra positional filter', (r, e) => { e.scripts['e2e:fault'] += ' selected.spec.ts'; }],
  ['inverted tag', (r, e) => { e.scripts['e2e:fault'] += ' --grep-invert @slow'; }],
  ['launch before preparation', (r, e) => { e.scripts['e2e:security'] = e.scripts['e2e:security'].split(' && ').reverse().join(' && '); }],
  ['omitted stage', (r, e) => { e.scripts['e2e:electron:prepare'] = preparations.slice(0, -1).join(' && '); }],
  ['changed prerequisite order', (r, e) => { e.scripts['e2e:electron:prepare'] = preparations.toReversed().join(' && '); }],
  ['unconditional prerequisite', (r, e) => { e.scripts['e2e:electron:prepare'] = preparations.join(' ; '); }],
  ['missing recursive hook', (r) => { r.scripts.test = 'pnpm --filter @eky/backend test'; }],
  ['missing self hook', (r, e) => { delete e.scripts.test; }],
  ['missing dependency regression', (r, e) => { e.scripts.test = 'node --test scripts/e2e-command-wiring.test.mjs'; }],
  ['missing adapter control regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/adapterControl.test.mjs', ''); }],
  ['missing adapter ordering regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/adapterRootExitOrdering.test.mjs', ''); }],
  ['missing bounded output regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/boundedChildOutput.test.mjs', ''); }],
  ['missing namespace regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/pidNamespaceContract.test.mjs', ''); }],
  ['missing managed namespace regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/managedNamespaceContract.test.mjs', ''); }],
  ['missing managed control regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/managedNamespaceControl.test.mjs', ''); }],
  ['missing managed observation regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/managedNamespaceObservation.test.mjs', ''); }],
  ['missing managed preflight regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/managedNamespacePreflight.test.mjs', ''); }],
  ['missing managed command regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/managedNamespaceCommand.test.mjs', ''); }],
  ['missing managed session regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/managedNamespaceSession.test.mjs', ''); }],
  ['missing wiring regression', (r, e) => { e.scripts.test = 'node --test experiments/processOwnership/playwrightElectronLaunch.test.mjs'; }],
  ['wrong self hook', (r, e) => { e.scripts.test = 'node --test scripts/other.test.mjs'; }],
  ['wrong root alias', (r) => { r.scripts['test:e2e:security'] = 'pnpm --filter @eky/e2e e2e:critical'; }],
];
for (const [name, mutate] of mutations) {
  test(`rejects command drift: ${name}`, () => {
    const rootCopy = structuredClone(root);
    const e2eCopy = structuredClone(e2e);
    mutate(rootCopy, e2eCopy);
    assert.throws(() => assertWiring(rootCopy, e2eCopy), assert.AssertionError);
  });
}

test('a failed named prerequisite prevents every later phase and launch in a bounded shell fixture', () => {
  assertWiring(root, e2e);
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'eky-command-contract-'));
  const directory = join(fixtureRoot, "literal $SHELL $(exit 42) `exit 42` 'quoted'");
  try {
    mkdirSync(directory);
    const step = join(directory, 'step.mjs');
    const ledger = join(directory, 'steps.jsonl');
    writeFileSync(step, [
      "import { appendFileSync } from 'node:fs';",
      'const [index, failure, ledger] = process.argv.slice(2);',
      "appendFileSync(ledger, JSON.stringify(Number(index)) + '\\n');",
      'process.exit(index === failure ? 17 : 0);',
    ].join('\n'));
    // Substitute only known calls with inert processes; preserve the actual && chain.
    const commands = e2e.scripts['e2e:electron:prepare'].split(' && ');
    for (const failedStep of [...commands.keys(), -1]) {
      rmSync(ledger, { force: true });
      const windows = process.platform === 'win32';
      const quote = (value) => {
        if (!windows) return `'${value.replaceAll("'", "'\\''")}'`;
        assert.ok(!/["\r\n%]/u.test(value), 'fixture paths must be safe literal shell arguments');
        return `"${value}"`;
      };
      const inert = (index) => [quote(process.execPath), quote(step), index, failedStep, quote(ledger)].join(' ');
      const chain = [...commands.map((_, index) => inert(index)), inert(commands.length)].join(' && ');
      const result = spawnSync(windows ? process.env.ComSpec ?? 'cmd.exe' : '/bin/sh',
        windows ? ['/d', '/v:off', '/s', '/c', `"${chain}"`] : ['-c', chain],
        { encoding: 'utf8', windowsVerbatimArguments: windows });
      assert.ifError(result.error);
      assert.equal(result.status, failedStep === -1 ? 0 : 17, result.stderr);
      const observed = readFileSync(ledger, 'utf8').trim().split('\n').map(JSON.parse);
      const expectedLength = failedStep === -1 ? commands.length + 1 : failedStep + 1;
      assert.deepEqual(observed, Array.from({ length: expectedLength }, (_, index) => index));
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
