import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const preparation = '        working-directory: .\n        run: node .github/scripts/prepareLockedPnpm.mjs';
const expectedJobs = {
  'ci.yml': 5,
  'dependency-security.yml': 1,
  'windows-acceptance-v2-clean.yml': 2,
  'windows-acceptance-v2-upgrade.yml': 2,
  'windows-acceptance-v2-workspace.yml': 4,
  'windows-acceptance-v2-legacy-diagnostic.yml': 3,
  'windows-acceptance-supervisor-feasibility.yml': 3,
};

test('every existing pnpm consumer prepares the same verified tool in its own preceding step', () => {
  for (const file of readdirSync(new URL('../workflows/', import.meta.url)).filter(name => name.endsWith('.yml'))) {
    const source = read(`../workflows/${file}`);
    assert.doesNotMatch(source, /\bcorepack\b/);
    let count = 0;
    for (const job of source.split(/^  [\w-]+:\s*$/m).slice(1)) {
      const steps = job.split(/^      - name: /m).slice(1);
      if (!steps.some(step => /\bpnpm\s+(?:--|[a-z])/.test(step))) continue;
      const prep = steps.findIndex(step => step.includes(preparation));
      assert.ok(prep >= 0, `${file}: missing verified preparation`);
      assert.equal(steps.filter(step => step.includes(preparation)).length, 1);
      assert.match(steps[prep], /^Prepare locked package manager/);
      assert.doesNotMatch(steps[prep], /continue-on-error:|timeout-minutes:|\|\| true/);
      assert.ok(steps.slice(0, prep).some(step => step.includes('uses: actions/setup-node@')));
      assert.ok(steps.slice(0, prep).every(step => !/\bpnpm\s+(?:--|[a-z])/.test(step)));
      if (steps[prep].includes('if:')) {
        assert.equal(file, 'windows-acceptance-supervisor-feasibility.yml');
        assert.match(steps[prep], /if: inputs.mode == 'legacy-contracts-diagnostic' \|\| inputs.mode == 'inspection-command-contracts' \|\| inputs.mode == 'clean-upgrade-command-diagnostic' \|\| inputs.mode == 'product-command-diagnostic'/);
      }
      count++;
    }
    assert.equal(count, expectedJobs[file] ?? 0, file);
  }
});

test('legacy acceptance retains its required preparation step name and ordinary commands', () => {
  const legacy = read('../workflows/windows-acceptance-v2-legacy-diagnostic.yml');
  const job = legacy.split('  legacy_contracts:')[1].split('  legacy_artifact_producer:')[0];
  assert.ok(job.includes(`      - name: Prepare locked package manager\n${preparation}`));
  assert.ok(job.includes('run: pnpm installer:supervisor:build'));
  assert.ok(job.includes('run: pnpm installer:test:windows-supervisor-v2-legacy-${{ matrix.group }}'));
  assert.match(job, /timeout-minutes: 10/);
});

test('bootstrap changes trigger dependency checks and both test entrypoints include these regressions', () => {
  const security = read('../workflows/dependency-security.yml').split('permissions:')[0];
  for (const path of ['.github/bootstrap/pnpm/**', '.github/scripts/lockedPnpmContract.mjs', '.github/scripts/prepareLockedPnpm.mjs']) {
    assert.ok(security.includes(`      - ${path}\n`));
  }
  const cadence = read('../workflows/ci-cadence-contracts.yml');
  const local = JSON.parse(read('../../eky_software/package.json')).scripts['test:ci'];
  for (const name of ['prepareLockedPnpm.test.mjs', 'lockedPnpmWiring.test.mjs']) {
    assert.ok(cadence.includes(`.github/scripts/${name}`));
    assert.ok(local.includes(`../.github/scripts/${name}`));
  }
});

test('Dependabot tracks the bootstrap separately from application dependencies', () => {
  const updates = read('../dependabot.yml').split(/^  - package-ecosystem: /m).slice(1);
  const bootstrap = updates.filter(block => block.startsWith('npm\n') &&
    /^    directory: \/\.github\/bootstrap\/pnpm$/m.test(block));
  assert.equal(bootstrap.length, 1);
  assert.match(bootstrap[0], /^      interval: weekly$/m);
  assert.match(bootstrap[0], /^    open-pull-requests-limit: 1$/m);
  assert.doesNotMatch(bootstrap[0], /^    (?:ignore|exclude-paths):/m);
  assert.ok(updates.some(block => block.startsWith('npm\n') && /^    directory: \/eky_software$/m.test(block)));
});
