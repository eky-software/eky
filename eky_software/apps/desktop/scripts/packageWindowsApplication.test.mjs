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
