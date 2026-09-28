import { fileURLToPath } from 'node:url';

import { prepareWindowsBackendOwner } from './windowsBackendOwnerBuild.mjs';

try {
  const result = prepareWindowsBackendOwner({
    repositoryRoot: fileURLToPath(new URL('../../..', import.meta.url)),
  });
  console.log(`E2E_WINDOWS_BACKEND_OWNER_${result === 'prepared' ? 'PREPARED' : 'NOT_APPLICABLE'}`);
} catch {
  console.error('E2E_BACKEND_OWNER_PREPARATION_FAILED');
  process.exitCode = 1;
}
