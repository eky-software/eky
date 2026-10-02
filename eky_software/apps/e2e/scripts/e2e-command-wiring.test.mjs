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
  'pnpm --filter @eky/e2e e2e:prepare-owner',
  'pnpm --filter @eky/permissions build',
  'pnpm --filter @eky/auth build',
  'pnpm --filter @eky/backend e2e:build',
  'pnpm --filter @eky/web build',
  'pnpm --filter @eky/desktop build',
  'pnpm --filter @eky/desktop e2e:build',
  'pnpm --filter @eky/desktop e2e:prepare-backend',
];
const projects = '--project=system-api --project=web-chromium --project=electron-development';
const contractCommand = 'node --test scripts/e2e-command-wiring.test.mjs scripts/windowsBackendOwnerBuild.test.mjs scripts/safeCiReporter.test.mjs scripts/electronLifecycleProjection.test.mjs scripts/e2eRunArtifacts.test.mjs experiments/processOwnership/playwrightElectronLaunch.test.mjs experiments/processOwnership/playwrightElectronProcessKill.test.mjs experiments/processOwnership/adapterContract.test.mjs experiments/processOwnership/adapterControl.test.mjs experiments/processOwnership/adapterRootExitOrdering.test.mjs experiments/processOwnership/boundedChildOutput.test.mjs experiments/processOwnership/pidNamespaceContract.test.mjs experiments/processOwnership/runPidNamespaceExperiment.test.mjs experiments/processOwnership/managedNamespaceContract.test.mjs experiments/processOwnership/managedNamespaceControl.test.mjs experiments/processOwnership/managedNamespaceObservation.test.mjs experiments/processOwnership/managedNamespacePreflight.test.mjs experiments/processOwnership/managedNamespaceCommand.test.mjs experiments/processOwnership/managedNamespaceSession.test.mjs experiments/processOwnership/managedNamespaceResult.test.mjs experiments/processOwnership/runManagedNamespaceExperiment.test.mjs experiments/processOwnership/managedChromiumFailure.test.mjs experiments/processOwnership/managedChromiumActor.test.mjs experiments/processOwnership/linuxServiceContract.test.mjs experiments/processOwnership/linuxServiceControl.test.mjs experiments/processOwnership/linuxServiceSession.test.mjs';

function assertWiring(rootManifest, e2eManifest) {
  assert.equal(rootManifest.scripts.test, 'pnpm --recursive test');
  assert.equal(e2eManifest.scripts.test, contractCommand + ' && pnpm test:consumer-loss');
  assert.equal(e2eManifest.scripts['test:consumer-loss'], consumerContractCommand);
  assert.equal(e2eManifest.scripts['linux:consumer:build'],
    'node experiments/processOwnership/linuxConsumerLossBuildCli.mjs');
  assert.equal(e2eManifest.scripts['linux:consumer:loss'],
    'node experiments/processOwnership/runLinuxConsumerLoss.mjs');
  assert.deepEqual(e2eManifest.scripts['e2e:electron:prepare'].split(' && '), preparations);
  assert.equal(e2eManifest.scripts['e2e:prepare-owner'], 'node scripts/prepare-windows-backend-owner.mjs');
  assert.deepEqual(e2eManifest.scripts['e2e:prepare'].split(' && '), preparations.slice(1, 5));
  for (const tag of ['security', 'fault']) {
    assert.equal(rootManifest.scripts[`test:e2e:${tag}`], `pnpm --filter @eky/e2e e2e:${tag}`);
    assert.equal(
      e2eManifest.scripts[`e2e:${tag}`],
      `pnpm e2e:electron:prepare && playwright test ${projects} --grep @${tag}`,
    );
  }
}

const consumerContracts = ['linuxConsumerLossContract', 'linuxConsumerLossRecords', 'linuxConsumerLossOutcome',
  'linuxConsumerSessionProbe', 'linuxConsumerLossInit', 'linuxConsumerExchange', 'linuxConsumerCommandGate',
  'linuxConsumerAttachments', 'linuxConsumerObserver', 'linuxConsumerSentinel', 'linuxConsumerLossBuild',
  'linuxConsumerLossBuildCli', 'runLinuxConsumerLossCase', 'runLinuxConsumerLoss'];
const consumerContractCommand = 'node --test ' + consumerContracts
  .map(name => `experiments/processOwnership/${name}.test.mjs`).join(' ');

for (const name of consumerContracts) {
  test(`the recursive contract gate cannot omit ${name}`, () => {
    const modified = structuredClone(e2e);
    modified.scripts['test:consumer-loss'] = modified.scripts['test:consumer-loss']
      .replace(` experiments/processOwnership/${name}.test.mjs`, '');
    assert.throws(() => assertWiring(root, modified), assert.AssertionError);
  });
}

test('manual consumer faults cannot join ordinary or endurance project commands', () => {
  for (const name of ['e2e:all', 'e2e:system', 'e2e:web', 'e2e:web:critical', 'e2e:stress']) {
    assert.doesNotMatch(e2e.scripts[name], /linux:consumer|runLinuxConsumerLoss/u);
  }
  assert.equal(e2e.scripts['e2e:stress'], 'pnpm e2e:prepare && playwright test --project=endurance-baseline');
});

test('the recursive workspace chain reaches this contract and both complete aggregates', () => {
  assertWiring(root, e2e);
  assert.ok(readFileSync(new URL('../scripts/e2e-command-wiring.test.mjs', import.meta.url)).length > 0);
});

test('preparation delegates to existing build and staging owners', () => {
  const manifests = new Map([
    ['@eky/desktop', desktop], ['@eky/backend', backend], ['@eky/e2e', e2e],
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

function assertWindowsOwnerCiPreparation(source) {
  const job = source.split('\n  e2e-electron-windows-critical:\n')[1]?.split(/\n  [\w-]+:\n/u)[0];
  assert.ok(job, 'the actual Windows consumer must remain reachable');
  const name = '      - name: Set up existing Windows test owner SDK\n';
  const steps = job.split(name);
  assert.equal(steps.length, 2, 'the owner SDK must be prepared exactly once');
  const sdk = steps[1].split('\n      - name:')[0].trimEnd();
  assert.equal(sdk, [
    '        uses: actions/setup-dotnet@26b0ec14cb23fa6904739307f278c14f94c95bf1',
    '        with:',
    '          dotnet-version: 10.0.302',
  ].join('\n'));
  const consumer = job.indexOf('        run: pnpm test:e2e:electron:critical\n');
  assert.ok(consumer > job.indexOf(name), 'the SDK must precede the normal consumer');
  assert.match(job, /    runs-on: windows-latest\n/u);
  assert.equal(root.scripts['test:e2e:electron:critical'], 'pnpm --filter @eky/e2e e2e:electron:critical');
  assert.equal(e2e.scripts['e2e:electron:critical'],
    'pnpm e2e:electron:prepare && playwright test --project=electron-development --grep @critical --workers=1');
}

const ci = readFileSync(new URL('../../../../.github/workflows/ci.yml', import.meta.url), 'utf8');
test('the normal Windows consumer prepares the existing SDK before its actual owner build', () => {
  assertWindowsOwnerCiPreparation(ci);
});

for (const [name, mutate] of [
  ['missing SDK', source => source.replace('Set up existing Windows test owner SDK', 'Missing SDK')],
  ['conditional SDK', source => source.replace('Set up existing Windows test owner SDK\n',
    'Set up existing Windows test owner SDK\n        if: inputs.electron_diagnostic\n')],
  ['ignored SDK failure', source => source.replace('Set up existing Windows test owner SDK\n',
    'Set up existing Windows test owner SDK\n        continue-on-error: true\n')],
  ['different SDK', source => source.replace('dotnet-version: 10.0.302', 'dotnet-version: 9.0.0')],
  ['missing actual consumer', source => source.replace('run: pnpm test:e2e:electron:critical', 'run: echo skipped')],
]) {
  test(`rejects Windows preparation drift: ${name}`, () => {
    assert.throws(() => assertWindowsOwnerCiPreparation(mutate(ci)), assert.AssertionError);
  });
}

const mutations = [
  ['missing Linux service contract', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/linuxServiceContract.test.mjs', ''); }],
  ['missing Linux service control', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/linuxServiceControl.test.mjs', ''); }],
  ['missing Linux service lifecycle', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/linuxServiceSession.test.mjs', ''); }],
  ['missing process-only kill regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/playwrightElectronProcessKill.test.mjs', ''); }],
  ['missing reporter regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' scripts/safeCiReporter.test.mjs', ''); }],
  ['missing lifecycle projection regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' scripts/electronLifecycleProjection.test.mjs', ''); }],
  ['missing artifact retention regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' scripts/e2eRunArtifacts.test.mjs', ''); }],
  ['missing owner build regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' scripts/windowsBackendOwnerBuild.test.mjs', ''); }],
  ['missing native owner preparation', (r, e) => { e.scripts['e2e:prepare'] = preparations.slice(2, 5).join(' && '); }],
  ['wrong native owner build', (r, e) => { e.scripts['e2e:prepare-owner'] = 'node unrelated.mjs'; }],
  ['missing Chromium diagnostic regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/managedChromiumFailure.test.mjs', ''); }],
  ['missing Chromium worker regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/managedChromiumActor.test.mjs', ''); }],
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
  ['missing managed result regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/managedNamespaceResult.test.mjs', ''); }],
  ['missing managed experiment regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/runManagedNamespaceExperiment.test.mjs', ''); }],
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
