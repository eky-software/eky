import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const packages = ['package.json', 'apps/backend/package.json', 'apps/desktop/package.json',
  'apps/e2e/package.json', 'apps/web/package.json', 'packages/api-client/package.json',
  'packages/auth/package.json', 'packages/permissions/package.json'];

function assertPreparedWorkspaceRunners(workflow) {
  for (const [owner, name, script] of [
    ['workspace_artifact_contracts', 'Verify encrypted evidence contracts without MSI', 'installer:test:encrypted-evidence:core'],
    ['workspace_artifact_producer', 'Verify packaged smoke driver contracts without MSI', 'installer:test:packaged-smoke-driver'],
  ]) {
    const jobs = workflow.replaceAll('\r\n', '\n').split(`\n  ${owner}:\n`);
    assert.equal(jobs.length, 2, `Missing or duplicate runner owner: ${owner}`);
    const job = jobs[1].split(/\n  [\w-]+:\n/u)[0];
    const steps = job.split(/(?=^      - )/mu);
    const step = name => {
      const matches = steps.filter(value => value.startsWith(`      - name: ${name}\n`));
      assert.equal(matches.length, 1, `Missing or duplicate preparation: ${owner}:${name}`);
      return matches[0].trimEnd();
    };
    assert.equal(step('Set up Node.js'), [
      '      - name: Set up Node.js',
      '        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
      '        with:', '          node-version-file: eky_software/.node-version',
      '          package-manager-cache: false',
    ].join('\n'));
    assert.equal(step('Prepare locked package manager'),
      '      - name: Prepare locked package manager\n        working-directory: .\n        run: node .github/scripts/prepareLockedPnpm.mjs');
    assert.equal(step('Install dependencies'),
      '      - name: Install dependencies\n        run: pnpm install --frozen-lockfile');
    assert.equal(step(name), `      - name: ${name}\n        run: pnpm --filter @eky/desktop ${script}`);
    let previous = -1;
    for (const value of ['Set up Node.js', 'Prepare locked package manager', 'Install dependencies', name]) {
      const position = job.indexOf(step(value));
      assert.ok(position > previous, `Runner preparation order changed: ${owner}`);
      previous = position;
    }
  }
}

test('real runner fixtures run after locked dependencies, never in dependency-free cadence coverage', async () => {
  const cadence = await read('../.github/workflows/ci-cadence-contracts.yml');
  assert.ok(cadence.includes('test-reporters/runnerFailureWiring.test.mjs'));
  assert.ok(!cadence.includes('test-reporters/runnerFailureReporters.test.mjs'));
  const desktop = JSON.parse(await read('apps/desktop/package.json'));
  assert.ok(desktop.scripts['installer:test:encrypted-evidence'].includes('../../test-reporters/runnerFailureReporters.test.mjs'));
  assert.ok(desktop.scripts['installer:test:encrypted-evidence'].includes('installer/windows-acceptance-harness/originalFailureEvidenceOpenPgp.test.mjs'));
  assert.ok(desktop.scripts['installer:test:encrypted-evidence'].includes('../../test-reporters/tests/d2SecretBrokerFailureEvidenceOpenPgp.test.mjs'));
  assert.ok(desktop.scripts['installer:test:encrypted-evidence'].includes('../../test-reporters/tests/fHttpFailureEvidenceOpenPgp.test.mjs'));
  for (const path of ['../../test-reporters/runnerFailureReporters.test.mjs',
    'installer/windows-acceptance-harness/originalFailureEvidenceOpenPgp.test.mjs',
    '../../test-reporters/tests/d2SecretBrokerFailureEvidenceOpenPgp.test.mjs',
    '../../test-reporters/tests/fHttpFailureEvidenceOpenPgp.test.mjs']) {
    assert.equal(desktop.scripts['installer:test:encrypted-evidence:core'].split(' ').filter(value => value === path).length, 1);
  }
  assert.equal(desktop.scripts['installer:test:packaged-smoke-driver'],
    'node --test --test-concurrency=1 --test-reporter=../../test-reporters/nodeFailureReporter.mjs scripts/packagedSmokeFailureEvidence.test.mjs');
  const root = JSON.parse(await read('package.json'));
  assert.ok(root.scripts['test:ci'].includes('test-reporters/tests/d2SecretBrokerFailureEvidence.test.mjs'));
  assert.ok(root.scripts['test:ci'].includes('test-reporters/tests/fHttpFailureEvidence.test.mjs'));
  assert.ok(!cadence.includes('test-reporters/tests/d2SecretBrokerFailureEvidence.test.mjs'));
  assert.ok(!cadence.includes('test-reporters/tests/fHttpFailureEvidence.test.mjs'));
  const workflow = await read('../.github/workflows/windows-acceptance-v2-workspace.yml');
  assertPreparedWorkspaceRunners(workflow);
});

test('runner preparation rejects whole-workflow prefix matches and preparation borrowed from another job', async () => {
  const source = (await read('../.github/workflows/windows-acceptance-v2-workspace.yml')).replaceAll('\r\n', '\n');
  assertPreparedWorkspaceRunners(source);
  for (const [owner, script] of [
    ['workspace_artifact_contracts', 'installer:test:encrypted-evidence:core'],
    ['workspace_artifact_producer', 'installer:test:packaged-smoke-driver'],
  ]) {
    const job = source.split(`\n  ${owner}:\n`)[1].split(/\n  [\w-]+:\n/u)[0];
    for (const changed of [
      job.replace('      - name: Install dependencies\n        run: pnpm install --frozen-lockfile', ''),
      job.replace('run: pnpm install --frozen-lockfile', 'if: false\n        run: pnpm install --frozen-lockfile'),
      job.replace('run: pnpm install --frozen-lockfile', 'run: pnpm install'),
      job.replace('run: node .github/scripts/prepareLockedPnpm.mjs', 'run: node --version'),
      job.replace(`run: pnpm --filter @eky/desktop ${script}`, 'run: pnpm --filter @eky/desktop installer:test:encrypted-evidence'),
      job.replace(`run: pnpm --filter @eky/desktop ${script}`, `run: pnpm --filter @eky/desktop ${script}-unrelated`),
      job.replace('      - name: Install dependencies\n        run: pnpm install --frozen-lockfile', '')
        .replace(`        run: pnpm --filter @eky/desktop ${script}`,
          `        run: pnpm --filter @eky/desktop ${script}\n      - name: Install dependencies\n        run: pnpm install --frozen-lockfile`),
    ]) {
      assert.notEqual(changed, job);
      assert.throws(() => assertPreparedWorkspaceRunners(source.replace(job, changed)), { code: 'ERR_ASSERTION' });
    }
  }
});

test('Linux delivery keeps the old dependency-free crypto suite and excludes installed runner proofs', async () => {
  const workflow = await read('../.github/workflows/windows-acceptance-supervisor-feasibility.yml');
  const job = workflow.split('\n  linux-encrypted-evidence-delivery-proof:\n')[1]?.split(/\n  [a-z][a-z0-9-]+:\n/)[0];
  assert.ok(job);
  assert.ok(job.includes('installer/windows-acceptance-harness/encryptedEvidenceOpenPgp.test.mjs'));
  assert.doesNotMatch(job, /originalFailureEvidenceOpenPgp|runnerFailureReporters|pnpm install|prepareLockedPnpm/);
  const oldSuite = await read('apps/desktop/installer/windows-acceptance-harness/encryptedEvidenceOpenPgp.test.mjs');
  assert.doesNotMatch(oldSuite, /prepareSmokeExceptionEvidence|legacyUpgradeDatabaseEvidence\.fixture|node_modules|vitest|@playwright/);
});

test('old crypto suite and shared key helper load with external package resolution forbidden', async () => {
  const parent = fileURLToPath(new URL('../.eky-local/reporter-fixtures/', import.meta.url));
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'no-deps-import-'));
  const hook = `import { registerHooks, isBuiltin } from 'node:module';
    import { isAbsolute } from 'node:path';
    registerHooks({ resolve(specifier, context, next) {
      if (!isBuiltin(specifier) && !specifier.startsWith('.') && !specifier.startsWith('file:') &&
          !specifier.startsWith('data:') && !isAbsolute(specifier))
        throw new Error('EXTERNAL_PACKAGE_FORBIDDEN: ' + specifier);
      return next(specifier, context);
    } });`;
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(hook),
    '--test', '--test-name-pattern=^DEPENDENCY_FREE_IMPORT_ONLY$',
    fileURLToPath(new URL('../apps/desktop/installer/windows-acceptance-harness/encryptedEvidenceOpenPgp.test.mjs', import.meta.url))],
  { env, encoding: 'utf8', timeout: 30_000, maxBuffer: 128 * 1024, windowsHide: true });
  await writeFile(join(directory, 'result.private.json'), JSON.stringify(result), { flag: 'wx', mode: 0o600 });
  assert.equal(result.error, undefined, 'DEPENDENCY_FREE_IMPORT_PROCESS_FAILED');
  assert.equal(result.status, 0, 'DEPENDENCY_FREE_IMPORT_FAILED');
});

test('every canonical Node and Vitest command retains its runner and attaches private observation', async () => {
  for (const path of packages) {
    const { scripts } = JSON.parse(await read(path));
    const prefix = path === 'package.json' ? './test-reporters/' : '../../test-reporters/';
    for (const command of Object.values(scripts)) {
      for (const member of command.split(' && ')) {
        if (member.startsWith('node --test ')) {
          assert.ok(member.includes('--test-reporter=' + prefix + 'nodeFailureReporter.mjs'), path);
          assert.equal((member.match(/--test-reporter=/g) ?? []).length, 1, path);
        }
        if (member.startsWith('vitest run ')) {
          assert.ok(member.startsWith('vitest run --reporter=default --reporter=' + prefix + 'vitestFailureReporter.mjs '), path);
        }
      }
    }
  }
});

test('direct workflow Node commands use the same reporter without changing their selection flags', async () => {
  for (const [path, prefix] of [
    ['../.github/workflows/ci-cadence-contracts.yml', './eky_software/test-reporters/'],
    ['../.github/workflows/windows-acceptance-supervisor-feasibility.yml', '../../test-reporters/'],
  ]) {
    const source = await read(path);
    const commands = source.split('\n').filter(line => /\bnode --test(?: |$)/.test(line));
    assert.ok(commands.length > 0);
    for (const command of commands) {
      assert.ok(command.includes('--test-reporter=' + prefix + 'nodeFailureReporter.mjs'), path);
      assert.equal((command.match(/--test-reporter=/g) ?? []).length, 1);
    }
  }
});
