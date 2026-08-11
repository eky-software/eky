import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const fullRevisionPattern = /^[0-9a-f]{40}$/;

export function validateInstallerReleaseGitState({ revision, status }) {
  const normalizedRevision = revision.trim();
  if (!fullRevisionPattern.test(normalizedRevision) || status.trim() !== '') {
    throw new Error('INSTALLER_RELEASE_GIT_STATE_INVALID');
  }
  return normalizedRevision;
}

export async function readInstallerReleaseGitState({ repositoryRoot }) {
  const options = {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
  };
  const [revisionResult, statusResult] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], options),
    execFileAsync(
      'git',
      ['status', '--porcelain=v1', '--untracked-files=all'],
      options,
    ),
  ]);
  return validateInstallerReleaseGitState({
    revision: revisionResult.stdout,
    status: statusResult.stdout,
  });
}
