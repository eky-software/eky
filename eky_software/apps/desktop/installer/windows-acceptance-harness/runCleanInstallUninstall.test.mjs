import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import {
  parseCleanInstallUninstallArguments,
} from './runCleanInstallUninstall.mjs';
import {
  runCleanInstallUninstallWorker,
} from './runCleanInstallUninstallWorker.mjs';

test('command line accepts exactly one explicit local manifest', () => {
  assert.equal(
    parseCleanInstallUninstallArguments([
      '--fixture-manifest',
      join(process.cwd(), 'fixture.manifest.json'),
    ]).manifestPath,
    join(process.cwd(), 'fixture.manifest.json'),
  );
  assert.throws(
    () => parseCleanInstallUninstallArguments([]),
    /WINDOWS_ACCEPTANCE_CLEAN_ARGUMENTS_INVALID/,
  );
  assert.throws(
    () =>
      parseCleanInstallUninstallArguments([
        '--fixture-manifest',
        'manifest.json',
        '--extra',
      ]),
    /WINDOWS_ACCEPTANCE_CLEAN_ARGUMENTS_INVALID/,
  );
  assert.throws(
    () =>
      parseCleanInstallUninstallArguments([
        '--',
        '--fixture-manifest',
        'manifest.json',
      ]),
    /WINDOWS_ACCEPTANCE_CLEAN_ARGUMENTS_INVALID/,
  );
});

test('worker rejects malformed invocation before reading the filesystem', async () => {
  assert.equal(await runCleanInstallUninstallWorker([]), 64);
  assert.equal(
    await runCleanInstallUninstallWorker(['--request', null]),
    64,
  );
});
