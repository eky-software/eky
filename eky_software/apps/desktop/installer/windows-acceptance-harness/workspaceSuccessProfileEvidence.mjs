import { isDeepStrictEqual } from 'node:util';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { readDesktopLifecycleEvents } from './legacyUpgradeStartupObserver.mjs';
import { readWorkspaceSuccessObject, writeJsonAtomicExclusive } from './workspaceSuccessContracts.mjs';

export const WORKSPACE_SUCCESS_CHECKPOINTS = Object.freeze([
  'sourceBaseline', 'targetFirstStart', 'beforeBMigration',
  'firstBStartup', 'secondBStartup', 'rejectedC',
]);
const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const invalid = () => { throw new Error('profileEvidenceInvalid'); };

// Only the existing compiled, read-only profile contracts are loaded here.
// Store.read() is deliberately excluded: it can repair recovery slots.
export async function loadWorkspaceSuccessProfileSupport() {
  const load = (path) => import(pathToFileURL(resolve(DIRECTORY, '../../e2e-dist', path)).href);
  const { parseW6b2PackagedWorkspaceProfileState } = await load('e2e/w6b2PackagedWorkspaceProfileState.js');
  const { hydrateW6b2PackagedWorkspaceFixture } = await load('e2e/w6b2PackagedWorkspaceProfileFixture.js');
  const { snapshotW6b2PackagedWorkspaceEvidence, snapshotW6b2PackagedWorkspaceFileEvidence,
    w6b2PackagedWorkspaceContentPreserved } = await load('e2e/w6b2PackagedWorkspaceEvidence.js');
  const { validateWorkspaceRegistry } = await load('src/workspaces/registry/workspaceRegistryValidation.js');
  const { WORKSPACE_REGISTRY_FILE_NAME } = await load('src/workspaces/registry/workspaceRegistryPaths.js');
  const { deriveWorkspaceRoot } = await load('src/workspaces/registry/deriveWorkspaceRoot.js');
  const { createDesktopProfilePaths } = await load('src/runtime/desktopProfilePaths.js');
  const { createLocalUpdateRuntimePaths } = await load('src/update/localUpdateRuntimePaths.js');
  const { parseAcceptedBuildMetadata } = await load('src/update/acceptedBuildMetadata.js');
  const { parseUpdateJournal } = await load('src/update/updateJournal.js');
  return Object.freeze({
    parseW6b2PackagedWorkspaceProfileState, hydrateW6b2PackagedWorkspaceFixture,
    snapshotW6b2PackagedWorkspaceEvidence, snapshotW6b2PackagedWorkspaceFileEvidence,
    w6b2PackagedWorkspaceContentPreserved, validateWorkspaceRegistry, WORKSPACE_REGISTRY_FILE_NAME,
    deriveWorkspaceRoot, createDesktopProfilePaths, createLocalUpdateRuntimePaths,
    parseAcceptedBuildMetadata, parseUpdateJournal,
  });
}

export function workspaceSuccessCheckpointPath(proofRoot, checkpoint) {
  if (!WORKSPACE_SUCCESS_CHECKPOINTS.includes(checkpoint)) invalid();
  return resolve(proofRoot, 'evidence', `workspace-success-${checkpoint}.json`);
}

async function present(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; invalid(); }
}

async function directory(path) {
  const metadata = await lstat(path);
  const canonical = await realpath(path);
  const equal = process.platform === 'win32'
    ? canonical.toLowerCase() === resolve(path).toLowerCase() : canonical === resolve(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || !equal) invalid();
}

// At a completed success checkpoint, unresolved slots are not repaired or
// selected speculatively. Inspection must leave every byte untouched.
export async function readWorkspaceSuccessSettledSlot(path, parse, optional = false) {
  for (const suffix of ['.next', '.backup']) if (await present(`${path}${suffix}`)) invalid();
  if (!await present(path)) {
    if (optional) return null;
    invalid();
  }
  return parse(await readWorkspaceSuccessObject(path, 'profileEvidenceInvalid'));
}

export async function readWorkspaceSuccessProfileState(proofRoot, support) {
  return support.parseW6b2PackagedWorkspaceProfileState(await readWorkspaceSuccessObject(
    resolve(proofRoot, 'evidence', 'w6b2-profile-state-v1.json'), 'profileEvidenceInvalid'));
}

export async function captureWorkspaceSuccessProfileEvidence({
  request, proofRoot, checkpoint, support,
}, { readLifecycleEvents = readDesktopLifecycleEvents } = {}) {
  try {
    if (!WORKSPACE_SUCCESS_CHECKPOINTS.includes(checkpoint)) invalid();
    await directory(proofRoot);
    const userDataRoot = resolve(proofRoot, 'user-data');
    await directory(userDataRoot);
    const state = await readWorkspaceSuccessProfileState(proofRoot, support);
    if (state.buildRevision !== request.buildRevision.slice(0, 12)) invalid();
    const registry = await readWorkspaceSuccessSettledSlot(
      resolve(userDataRoot, support.WORKSPACE_REGISTRY_FILE_NAME), support.validateWorkspaceRegistry);
    if (registry.workspaces.length !== 3 || state.fixtures.some((fixture) =>
      registry.workspaces.filter((entry) => entry.workspaceId === fixture.workspaceId &&
        entry.lineageIdentity.profileId === fixture.profileId).length !== 1)) invalid();
    const profile = support.createDesktopProfilePaths(userDataRoot);
    const paths = support.createLocalUpdateRuntimePaths({ userDataPath: userDataRoot, legacyRuntimeRoot: profile.runtimeRoot });
    const accepted = await readWorkspaceSuccessSettledSlot(paths.acceptedBuildMetadataPath, support.parseAcceptedBuildMetadata);
    const journal = await readWorkspaceSuccessSettledSlot(paths.journalPath, support.parseUpdateJournal, true);
    for (const legacy of [paths.legacyAcceptedBuildMetadataPath, paths.legacyJournalPath]) {
      if (await readWorkspaceSuccessSettledSlot(legacy, (value) => value, true) !== null) invalid();
    }
    const fixtures = [];
    for (const persisted of state.fixtures) {
      const roots = support.deriveWorkspaceRoot(userDataRoot, persisted.workspaceId, 1);
      await directory(roots.workspacesRoot);
      await directory(roots.workspaceRoot);
      const workspaceProfile = support.createDesktopProfilePaths(roots.workspaceRoot);
      await directory(workspaceProfile.runtimeRoot);
      await directory(dirname(workspaceProfile.databaseFilePath));
      // Validate the database before the existing readonly SQLite adapter opens
      // it, then prove that the SQL inspection did not mutate the database.
      const before = await support.snapshotW6b2PackagedWorkspaceFileEvidence(
        workspaceProfile.databaseFilePath, roots.workspaceRoot);
      const fixture = support.hydrateW6b2PackagedWorkspaceFixture(userDataRoot, persisted);
      const evidence = await support.snapshotW6b2PackagedWorkspaceEvidence(fixture);
      if (!isDeepStrictEqual(before, evidence.database)) invalid();
      const workspacePaths = support.createLocalUpdateRuntimePaths({
        userDataPath: roots.workspaceRoot, legacyRuntimeRoot: workspaceProfile.runtimeRoot,
      });
      for (const path of [workspacePaths.acceptedBuildMetadataPath, workspacePaths.legacyAcceptedBuildMetadataPath,
        workspacePaths.journalPath, workspacePaths.legacyJournalPath]) {
        if (await readWorkspaceSuccessSettledSlot(path, (value) => value, true) !== null) invalid();
      }
      fixtures.push({ ...persisted, baseline: evidence });
    }
    const events = checkpoint === 'sourceBaseline' ? []
      : await readLifecycleEvents(resolve(profile.runtimeRoot, 'logs', 'desktop'));
    return {
      schemaVersion: 1, checkpoint, runNonce: request.runNonce,
      artifactDescriptorSha256: request.artifactDescriptorSha256,
      profileState: { ...state, fixtures }, registry, accepted, journal, events,
    };
  } catch { invalid(); }
}

export async function writeWorkspaceSuccessCheckpoint(input) {
  const evidence = await captureWorkspaceSuccessProfileEvidence(input);
  await writeJsonAtomicExclusive(workspaceSuccessCheckpointPath(input.proofRoot, input.checkpoint), evidence);
}
