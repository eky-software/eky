import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = resolve(
  DIRECTORY,
  '..',
  '..',
  '..',
  '..',
  '..',
  '.github',
  'workflows',
  'windows-acceptance-v2-upgrade.yml',
);

test('V2.4 workflow builds once and fans identical bytes to two consumers', async () => {
  const source = await readFile(WORKFLOW_PATH, 'utf8');
  assert.match(source, /upgrade_artifact_producer:/u);
  assert.match(source, /upgrade_consumer:/u);
  assert.ok(source.includes("repetition: ${{ fromJSON(inputs.risk_plan != '' && fromJSON(inputs.risk_plan).repetitions == 1 && '[1]' || '[1, 2]') }}"));
  assert.match(source, /max-parallel: 2/u);
  assert.equal(
    source.match(/installer:v2-upgrade-artifact:build/gu)?.length,
    1,
  );
  assert.equal(
    source.match(/installer:v2-upgrade-rollback --artifact-descriptor/gu)
      ?.length,
    1,
  );
  assert.match(source, /retention-days: 1/u);
  assert.match(source, /compression-level: 0/u);
  assert.match(source, /pnpm install --frozen-lockfile/u);
  assert.match(
    source,
    /Remove producer staging after native loader process exit/u,
  );
  assert.match(source, /WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_STAGE_CLEANUP_FAILED/u);
  assert.doesNotMatch(source, /continue-on-error|retry|re-run/iu);
});

test('V2.4 workflow uses only approved immutable artifact actions', async () => {
  const source = await readFile(WORKFLOW_PATH, 'utf8');
  assert.match(
    source,
    /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/u,
  );
  assert.match(
    source,
    /actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c/u,
  );
  assert.equal(source.match(/actions\/upload-artifact@/gu)?.length, 1);
  assert.equal(source.match(/actions\/download-artifact@/gu)?.length, 1);
});

test('V2.4 consumers select the producer artifact ID independently of the consumer attempt', async () => {
  const source = await readFile(WORKFLOW_PATH, 'utf8');
  const [producer, consumer] = source.split('  upgrade_consumer:');
  assert.match(producer, /artifact_id: \$\{\{ steps\.upload\.outputs\.artifact-id \}\}/u);
  assert.match(producer, /name: Upload exact upgrade artifact\s+id: upload\s+uses: actions\/upload-artifact@/u);
  assert.match(producer, /overwrite: false/u);
  assert.match(consumer, /needs: upgrade_artifact_producer/u);
  const download = consumer.split('      - name: Download exact upgrade artifact')[1]
    .split('      - name: Verify downloaded artifact bytes')[0];
  assert.match(download, /artifact-ids: \$\{\{ needs\.upgrade_artifact_producer\.outputs\.artifact_id \}\}/u);
  assert.match(download, /merge-multiple: true/u);
  assert.doesNotMatch(download, /\b(?:name|pattern):/u);
  assert.doesNotMatch(consumer, /github\.run_attempt|EKY_V2_UPGRADE_ARTIFACT_NAME|upload-artifact|installer:v2-upgrade-artifact:build/u);
});

test('V2.4 consumers verify checkout and artifact before and after lifecycle', async () => {
  const source = await readFile(WORKFLOW_PATH, 'utf8');
  assert.match(source, /git rev-parse HEAD/u);
  assert.equal(
    source.match(/installer:v2-upgrade-artifact:verify/gu)?.length,
    3,
  );
  assert.match(source, /always\(\) && steps\.download\.outcome == 'success'/u);
  assert.match(source, /expected-descriptor-sha256/u);
  assert.match(source, /expected-build-revision/u);
});

test('existing diagnostic can consume the exact upgrade artifact without rebuilding or changing the normal matrix', async () => {
  const source = await readFile(resolve(dirname(WORKFLOW_PATH), 'windows-acceptance-supervisor-feasibility.yml'), 'utf8');
  const diagnostic = source.split('  packaged-boundary-diagnostic:')[1];
  assert.match(source, /options: \[legacy, workspace, upgrade\]/u);
  assert.equal(diagnostic.match(/'upgrade' \{ 'verifyUpgradeRollbackArtifact\.mjs' \}/gu)?.length, 2);
  assert.equal(diagnostic.match(/runUpgradeRollback\.mjs --artifact-descriptor/gu)?.length, 1);
  assert.match(diagnostic, /artifact-ids: \$\{\{ inputs\.artifact_id \}\}/u);
  assert.match(diagnostic, /run-id: \$\{\{ inputs\.artifact_run_id \}\}/u);
  assert.match(diagnostic, /if \(\$LASTEXITCODE -ne 0\) \{ throw 'WINDOWS_ACCEPTANCE_DIAGNOSTIC_CALLER_FAILED' \}/u);
  assert.doesNotMatch(diagnostic, /installer:v2-upgrade-artifact:build|upload-artifact|continue-on-error/u);
});
