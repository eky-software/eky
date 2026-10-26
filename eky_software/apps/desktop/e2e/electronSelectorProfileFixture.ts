import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, readdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { createDesktopProfilePaths } from '../src/runtime/desktopProfilePaths.js';
import { AcceptedBuildMetadataStore } from '../src/update/acceptedBuildMetadataStore.js';
import { createLocalUpdateRuntimePaths } from '../src/update/localUpdateRuntimePaths.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../src/workspaces/registry/workspaceRegistryPaths.js';
import { serializeWorkspaceRegistry } from '../src/workspaces/registry/workspaceRegistrySerializer.js';
import { validateWorkspaceRegistry } from '../src/workspaces/registry/workspaceRegistryValidation.js';

export type ElectronSelectorProfileState = 'empty' | 'ready' | 'recoveryRequired';

// Offline registry-only input: absence of workspace roots proves that listing
// and renaming do not open a database. This is not business/build acceptance.
export async function prepareElectronSelectorProfile(input: {
  runRoot: string;
  userDataPath: string;
  state: ElectronSelectorProfileState;
}, environment: Readonly<{ EKY_E2E?: string }> = process.env): Promise<void> {
  if (environment.EKY_E2E !== '1' || !['empty', 'ready', 'recoveryRequired'].includes(input.state)) {
    throw new Error('ELECTRON_SELECTOR_FIXTURE_INVALID');
  }
  if (!isAbsolute(input.runRoot) || !isAbsolute(input.userDataPath) ||
      resolve(input.runRoot) !== input.runRoot || resolve(input.userDataPath) !== input.userDataPath) {
    throw new Error('ELECTRON_SELECTOR_FIXTURE_ROOT_INVALID');
  }
  const base = await realpath(join(tmpdir(), 'eky-e2e'));
  const runRoot = await realpath(input.runRoot);
  const runRelative = relative(base, runRoot);
  const profileRelative = relative(runRoot, input.userDataPath);
  if (runRoot !== input.runRoot ||
      dirname(runRelative) !== '.' || !basename(runRelative).startsWith('run-') ||
      (await lstat(input.runRoot)).isSymbolicLink() || profileRelative === '' ||
      isAbsolute(profileRelative) || profileRelative === '..' || profileRelative.startsWith(`..${sep}`)) {
    throw new Error('ELECTRON_SELECTOR_FIXTURE_ROOT_INVALID');
  }
  let current = runRoot;
  for (const segment of profileRelative.split(sep)) {
    current = join(current, segment);
    const stats = await lstat(current);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('ELECTRON_SELECTOR_FIXTURE_ROOT_INVALID');
  }
  const userDataPath = await realpath(input.userDataPath);
  if (userDataPath !== input.userDataPath) throw new Error('ELECTRON_SELECTOR_FIXTURE_ROOT_INVALID');
  if ((await readdir(userDataPath)).length !== 0) throw new Error('ELECTRON_SELECTOR_FIXTURE_ALREADY_EXISTS');
  const registry = validateWorkspaceRegistry({
    formatVersion: 2, activeWorkspaceId: null,
    workspaces: input.state === 'empty' ? [] : [{
      workspaceId: randomUUID(), workspaceLabel: 'Synthetic selector company',
      lineageIdentity: { formatVersion: 1, profileId: randomBytes(32).toString('hex') },
      layoutVersion: 1, lifecycleState: input.state, createdAt: '2026-01-01T00:00:00.000Z',
    }],
  });
  const paths = createLocalUpdateRuntimePaths({ userDataPath,
    legacyRuntimeRoot: createDesktopProfilePaths(userDataPath).runtimeRoot });
  await new AcceptedBuildMetadataStore(paths.acceptedBuildMetadataPath).write({
    formatVersion: 1, acceptedAt: '2026-01-01T00:00:00.000Z',
    appVersion: '0.2.0', buildRevision: 'a'.repeat(40), releaseChannel: 'pilot',
  });
  await writeFile(join(userDataPath, WORKSPACE_REGISTRY_FILE_NAME), serializeWorkspaceRegistry(registry),
    { flag: 'wx', mode: 0o600 });
}
