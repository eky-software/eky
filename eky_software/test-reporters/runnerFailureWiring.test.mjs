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

test('real runner fixtures run after locked dependencies, never in dependency-free cadence coverage', async () => {
  const cadence = await read('../.github/workflows/ci-cadence-contracts.yml');
  assert.ok(cadence.includes('test-reporters/runnerFailureWiring.test.mjs'));
  assert.ok(!cadence.includes('test-reporters/runnerFailureReporters.test.mjs'));
  const desktop = JSON.parse(await read('apps/desktop/package.json'));
  assert.ok(desktop.scripts['installer:test:encrypted-evidence'].includes('../../test-reporters/runnerFailureReporters.test.mjs'));
  assert.ok(desktop.scripts['installer:test:encrypted-evidence'].includes('installer/windows-acceptance-harness/originalFailureEvidenceOpenPgp.test.mjs'));
  const workflow = await read('../.github/workflows/windows-acceptance-v2-workspace.yml');
  const install = workflow.indexOf('run: pnpm install --frozen-lockfile');
  const fixture = workflow.indexOf('run: pnpm --filter @eky/desktop installer:test:encrypted-evidence');
  assert.ok(install >= 0 && fixture > install);
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
