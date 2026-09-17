import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(DIRECTORY, '..', '..', '..', '..', '..');
const WORKFLOW_PATH = resolve(
  WORKSPACE_ROOT,
  '.github',
  'workflows',
  'windows-acceptance-v2-clean.yml',
);
const UPLOAD_ARTIFACT_ACTION =
  'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a';
const DOWNLOAD_ARTIFACT_ACTION =
  'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c';

function occurrenceCount(source, value) {
  return source.split(value).length - 1;
}

test('exact-release lifecycle has one V2 command and no retired orchestration entrypoint', async () => {
  const core = await readFile(resolve(WORKSPACE_ROOT, '.github/workflows/ci.yml'), 'utf8');
  const { scripts } = JSON.parse(await readFile(resolve(DIRECTORY, '../../package.json'), 'utf8'));
  assert.doesNotMatch(core, /installer-windows:|installer-w6b|installer:upgrade/u);
  for (const retired of ['installer:lifecycle', 'installer:release-lifecycle',
    'installer:upgrade', 'installer:w6b-legacy', 'installer:w6b2-success',
    'installer:w6b2-fault-rollback']) {
    assert.equal(Object.hasOwn(scripts, retired), false);
  }
  assert.match(scripts['installer:v2-clean'], /dotnet .* --clean-command$/u);
  assert.match(scripts['installer:v2-upgrade-rollback'], /dotnet .* --upgrade-command$/u);
  assert.match(scripts['installer:v2-legacy'], /dotnet .* --legacy-command$/u);
  assert.match(scripts['installer:v2-workspace-success'], /dotnet .* --workspace-success-command$/u);
  assert.match(scripts['installer:v2-workspace-fault'], /dotnet .* --workspace-fault-command$/u);
});

test('CI transfers one exact short-lived artifact to two isolated consumers', async () => {
  const workflow = await readFile(WORKFLOW_PATH, 'utf8');
  const producerIndex = workflow.indexOf('  artifact_producer:');
  const consumerIndex = workflow.indexOf('  clean_consumer:');
  const producer = workflow.slice(producerIndex, consumerIndex);
  const consumer = workflow.slice(consumerIndex);

  assert.ok(producerIndex >= 0);
  assert.ok(consumerIndex > producerIndex);
  assert.equal(occurrenceCount(workflow, UPLOAD_ARTIFACT_ACTION), 1);
  assert.equal(occurrenceCount(workflow, DOWNLOAD_ARTIFACT_ACTION), 1);
  assert.doesNotMatch(workflow, /actions\/(?:upload|download)-artifact@v\d/u);
  assert.match(workflow, /retention-days: 1/u);
  assert.match(workflow, /compression-level: 0/u);
  assert.match(workflow, /if-no-files-found: error/u);
  assert.match(workflow, /overwrite: false/u);
  assert.match(workflow, /include-hidden-files: false/u);
  assert.match(
    workflow,
    /EKY_V2_ARTIFACT_NAME: eky-v2-clean-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/u,
  );

  assert.equal(
    occurrenceCount(producer, 'installer:v2-artifact:build'),
    1,
  );
  assert.equal(
    occurrenceCount(producer, 'installer:v2-artifact:verify'),
    1,
  );
  assert.match(producer, /timeout-minutes: 25/u);
  assert.match(producer, /timeout-minutes: 15/u);
  assert.match(producer, /'pilotBundleResultCode'/u);
  assert.match(producer, /\$summary\.pilotBundleResultCode -cne 'pilotBundleVerified'/u);
  assert.match(workflow, /release_candidate:\s+description: [^\n]+\s+type: boolean\s+default: false/u);
  assert.ok(producer.includes("github.event_name == 'workflow_dispatch' && inputs.release_candidate == true"));
  assert.match(producer, /\$releaseArguments = @\('--release-candidate'\)/u);
  assert.match(producer, /--summary-path \$summaryPath @releaseArguments/u);
  assert.match(producer, /'releaseCandidateResultCode'/u);
  assert.match(producer, /\$summary\.releaseCandidateResultCode -cne/u);
  assert.match(producer, /'releaseCandidateVerified' \} else \{ 'notRequested'/u);
  assert.doesNotMatch(producer, /installer:v2-clean/u);

  assert.match(consumer, /needs: artifact_producer/u);
  assert.match(producer, /artifact_id: \$\{\{ steps\.upload\.outputs\.artifact-id \}\}/u);
  assert.match(consumer, /artifact-ids: \$\{\{ needs\.artifact_producer\.outputs\.artifact_id \}\}/u);
  assert.match(consumer, /merge-multiple: true/u);
  assert.ok(consumer.includes("repetition: ${{ fromJSON(inputs.risk_plan != '' && fromJSON(inputs.risk_plan).repetitions == 1 && '[1]' || '[1, 2]') }}"));
  assert.match(consumer, /max-parallel: 2/u);
  assert.equal(occurrenceCount(consumer, 'timeout-minutes: 27'), 1);
  assert.equal(occurrenceCount(consumer, 'timeout-minutes: 17'), 1);
  assert.equal(occurrenceCount(consumer, 'timeout-minutes: 3'), 1);
  assert.equal(occurrenceCount(consumer, 'installer:supervisor:build'), 1);
  assert.equal(occurrenceCount(consumer, ' --clean-command '), 1);
  assert.equal(occurrenceCount(consumer, 'verifyCleanCallerResult.mjs'), 1);
  assert.match(consumer, /\$commandExit -ne 0 -or \$LASTEXITCODE -ne 0/u);
  assert.doesNotMatch(consumer, /runCleanInstallUninstall\.mjs/u);
  assert.equal(
    occurrenceCount(consumer, 'installer:v2-artifact:verify'),
    2,
  );
  assert.doesNotMatch(
    consumer,
    /installer:v2-artifact:build|package:windows|installer:release/u,
  );
  assert.doesNotMatch(workflow, /installer:w6b/u);
  assert.doesNotMatch(workflow, /\bretry\b/ui);
});

test('CI pins the existing checkout, Node, and .NET setup actions', async () => {
  const workflow = await readFile(WORKFLOW_PATH, 'utf8');

  assert.equal(
    occurrenceCount(
      workflow,
      'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    ),
    2,
  );
  assert.equal(
    occurrenceCount(
      workflow,
      'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
    ),
    2,
  );
  assert.equal(
    occurrenceCount(
      workflow,
      'actions/setup-dotnet@26b0ec14cb23fa6904739307f278c14f94c95bf1',
    ),
    2,
  );
  assert.equal(occurrenceCount(workflow, 'dotnet-version: 10.0.302'), 2);
  assert.equal(occurrenceCount(workflow, 'persist-credentials: false'), 2);
  assert.equal(occurrenceCount(workflow, 'fetch-depth: 0'), 2);
  assert.doesNotMatch(
    workflow,
    /actions\/(?:checkout|setup-node|setup-dotnet)@v\d/u,
  );
});
