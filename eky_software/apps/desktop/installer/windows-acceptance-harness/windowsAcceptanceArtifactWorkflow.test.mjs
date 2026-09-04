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
  assert.doesNotMatch(producer, /installer:v2-clean/u);

  assert.match(consumer, /needs: artifact_producer/u);
  assert.match(consumer, /repetition: \[1, 2\]/u);
  assert.match(consumer, /max-parallel: 2/u);
  assert.equal(occurrenceCount(consumer, 'timeout-minutes: 12'), 1);
  assert.equal(occurrenceCount(consumer, 'timeout-minutes: 7'), 1);
  assert.equal(occurrenceCount(consumer, 'installer:v2-clean'), 1);
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
