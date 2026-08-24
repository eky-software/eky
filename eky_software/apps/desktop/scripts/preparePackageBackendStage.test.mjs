import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { preparePackageBackendStage } from './preparePackageBackendStage.mjs';

test('keeps the ordinary backend stage bytes unchanged when no preparation is requested', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-package-stage-'));
  context.after(() => rm(root, { force: true, recursive: true }));
  const stagedFile = join(root, 'inventory.json');
  await writeFile(stagedFile, '{"stage":"ordinary"}\n', 'utf8');
  const before = await sha256(stagedFile);

  await preparePackageBackendStage({ backendStage: root });

  assert.equal(await sha256(stagedFile), before);
  assert.equal(await readFile(stagedFile, 'utf8'), '{"stage":"ordinary"}\n');
});

test('invokes the explicitly provided backend stage preparation exactly once', async () => {
  const backendStage = resolve('backend-stage');
  const received = [];

  await preparePackageBackendStage({
    backendStage,
    prepareBackendStage(value) {
      received.push(value);
    },
  });

  assert.deepEqual(received, [backendStage]);
});

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

test('rejects malformed backend stage preparation inputs', async () => {
  await assert.rejects(
    () =>
      preparePackageBackendStage({
        backendStage: 'relative-stage',
      }),
    /PACKAGE_BACKEND_STAGE_INVALID/u,
  );
  await assert.rejects(
    () =>
      preparePackageBackendStage({
        backendStage: resolve('backend-stage'),
        prepareBackendStage: true,
      }),
    /PACKAGE_BACKEND_STAGE_PREPARATION_INVALID/u,
  );
});
