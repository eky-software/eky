import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';

import {
  createPackageBuildPhaseObserver,
  createPackageLayout,
  packageWindowsApplication,
} from './packageWindowsApplication.mjs';

test('backend metadata wiring binds the source before deploy and normalizes after the hook', () => {
  const source = packageWindowsApplication.toString().replaceAll('\r\n', '\n');
  // Guard the real entry point without adding injectable build dependencies.
  const preparation = [
    "  observePhase('workspaceBuild');",
    '  const backendMetadataSource = await captureBackendBuildMetadataSource({',
    '    repositoryRoot,',
    '  });',
    '  await buildWorkspaceArtifacts(backendStage);',
    "  observePhase('backendPreparation');",
    '  await preparePackageBackendStage({',
    '    backendStage,',
    '    prepareBackendStage,',
    '  });',
    '  await normalizeBackendBuildMetadata({',
    '    backendStage,',
    '    source: backendMetadataSource,',
    '  });',
    "  observePhase('buildIdentity');",
  ].join('\n');
  assert.ok(source.includes(preparation), 'Backend preparation order or source binding changed');
  for (const name of ['captureBackendBuildMetadataSource', 'buildWorkspaceArtifacts',
    'preparePackageBackendStage', 'normalizeBackendBuildMetadata']) {
    assert.equal(source.split(`${name}(`).length, 2, `Expected exactly one ${name} call`);
  }
  const validation = [
    "  observePhase('backendValidation');",
    '  await assertSafeBackendStage(backendStage);',
    '  await inspectPackageArtifactInventory({',
    '    root: backendStage,',
    "    stage: 'backendStage',",
    '  });',
  ].join('\n');
  assert.ok(source.indexOf(validation) >= source.indexOf(preparation) + preparation.length,
    'Backend validation must follow metadata normalization');
});

test('package phase observation is ordered, closed and never awaited', async () => {
  const phases = [];
  const observe = createPackageBuildPhaseObserver((phase) => {
    phases.push(phase);
    return new Promise(() => undefined);
  });
  assert.equal(observe('backendValidation'), undefined);
  assert.equal(observe('applicationPreparation'), undefined);
  assert.equal(observe('private value'), undefined);
  assert.deepEqual(phases, ['backendValidation', 'applicationPreparation', null]);
  assert.doesNotThrow(() => createPackageBuildPhaseObserver(() => {
    throw new Error('private observer failure');
  })('electronPackaging'));
  createPackageBuildPhaseObserver(async () => {
    throw new Error('private asynchronous observer failure');
  })('electronPackaging');
  await setImmediate();
});

test('real package preparation keeps its filesystem failure when observation fails', async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), 'eky-package-preparation-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const obstacle = resolve(root, 'obstacle');
  await writeFile(obstacle, 'preserved');
  const layout = createPackageLayout({
    stagingRoot: resolve(obstacle, 'stage'),
    outputDirectory: resolve(root, 'out'),
  });
  const phases = [];
  let originalCode;
  await assert.rejects(packageWindowsApplication({ layout }), (error) => {
    assert.equal(typeof error.code, 'string');
    originalCode = error.code;
    return true;
  });
  await assert.rejects(packageWindowsApplication({
    layout,
    onBuildPhase(phase) {
      phases.push(phase);
      throw new Error('private observer failure');
    },
  }), (error) => {
    assert.equal(error.code, originalCode);
    return true;
  });
  assert.deepEqual(phases, ['stagingPreparation']);
  assert.equal(await readFile(obstacle, 'utf8'), 'preserved');
});
