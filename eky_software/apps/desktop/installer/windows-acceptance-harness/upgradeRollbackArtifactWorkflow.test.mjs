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
  assert.match(source, /repetition: \[1, 2\]/u);
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
