import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateInstallerReleaseGitState } from './installerReleaseContext.mjs';

test('accepts only a clean worktree bound to a full Git revision', () => {
  const revision = 'a'.repeat(40);
  assert.equal(
    validateInstallerReleaseGitState({ revision: `${revision}\n`, status: '' }),
    revision,
  );
  assert.throws(
    () =>
      validateInstallerReleaseGitState({
        revision,
        status: ' M apps/desktop/package.json\n',
      }),
    /INSTALLER_RELEASE_GIT_STATE_INVALID/,
  );
  assert.throws(
    () => validateInstallerReleaseGitState({ revision: 'abcdef1', status: '' }),
    /INSTALLER_RELEASE_GIT_STATE_INVALID/,
  );
});
