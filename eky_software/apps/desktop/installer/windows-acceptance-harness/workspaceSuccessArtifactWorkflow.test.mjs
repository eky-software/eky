import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = dirname(fileURLToPath(import.meta.url));
const WORKFLOW = resolve(ROOT, '../../../../../.github/workflows/windows-acceptance-v2-workspace.yml');

test('V2.6 contract checkpoint is a bounded read-only-permission Windows job with pinned actions', async () => {
  const source = await readFile(WORKFLOW, 'utf8');
  assert.match(source, /contents: read/);
  assert.doesNotMatch(source, /(?:contents|actions|pull-requests): write/);
  assert.match(source, /runs-on: windows-latest/);
  assert.match(source, /timeout-minutes: 10/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /pnpm install --frozen-lockfile/);
  const actions = [...source.matchAll(/uses: ([^\s]+)/g)].map((match) => match[1]);
  assert.deepEqual(actions, [
    'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
  ]);
});

test('V2.6 fast checkpoint runs its executable contracts, not a packaged acceptance substitute', async () => {
  const source = await readFile(WORKFLOW, 'utf8');
  const desktop = JSON.parse(await readFile(resolve(ROOT, '../../package.json'), 'utf8'));
  assert.match(source, /pnpm --filter @eky\/desktop installer:test:windows-acceptance-workspace-artifact/);
  const script = desktop.scripts['installer:test:windows-acceptance-workspace-artifact'];
  assert.equal(script, 'node --test --test-concurrency=1 installer/windows-acceptance-harness/workspaceSuccessArtifact.test.mjs installer/windows-acceptance-harness/workspaceSuccessArtifactWorkflow.test.mjs');
  assert.doesNotMatch(source, /installer:v2-workspace-artifact:build|msiexec|upload-artifact|installer:w6b2/);
});

test('V2.6 runtime checkpoint executes lifecycle, failure and read-only Windows adapter behavior', async () => {
  const source = await readFile(WORKFLOW, 'utf8');
  const desktop = JSON.parse(await readFile(resolve(ROOT, '../../package.json'), 'utf8'));
  assert.match(source, /pnpm --filter @eky\/desktop installer:test:windows-acceptance-workspace\s/);
  const script = desktop.scripts['installer:test:windows-acceptance-workspace'];
  assert.equal(script, 'pnpm e2e:build && node --test --test-concurrency=1 ' + [
    'workspaceSuccessContracts', 'workspaceSuccessLifecycle', 'workspaceSuccessWindowsRuntime',
    'workspaceSuccessFailureBoundary', 'inspectWorkspaceSuccessMsiActivity',
    'workspaceSuccessProfileEvidence', 'workspaceSuccessPostcondition',
    'runWorkspaceSuccessWorker', 'runWorkspaceSuccess',
  ].map((name) => `installer/windows-acceptance-harness/${name}.test.mjs`).join(' '));
  assert.equal(desktop.scripts['installer:v2-workspace-success'],
    'pnpm installer:supervisor:build && pnpm e2e:build && node installer/windows-acceptance-harness/runWorkspaceSuccess.mjs');
});
