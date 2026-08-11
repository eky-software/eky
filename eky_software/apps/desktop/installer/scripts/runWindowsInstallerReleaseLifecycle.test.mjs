import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createInstallerLifecycleArguments } from './runWindowsInstallerReleaseLifecycle.mjs';

test('passes only the verified MSI, payload root and derived product code', () => {
  const args = createInstallerLifecycleArguments({
    installerPath: 'C:\\release\\Eky.msi',
    payloadPath: 'C:\\payload\\Eky-win32-x64',
    productCode: '5D93DBC6-ECBC-5725-83F0-EFBB131D42D0',
  });
  assert.deepEqual(args.slice(-6), [
    '-MsiPath',
    'C:\\release\\Eky.msi',
    '-PayloadRoot',
    'C:\\payload\\Eky-win32-x64',
    '-ProductCode',
    '5D93DBC6-ECBC-5725-83F0-EFBB131D42D0',
  ]);
  assert.equal(args.includes('cmd.exe'), false);
  assert.equal(args.includes('/c'), false);
});
