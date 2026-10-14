import { readdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import { copyAttestedWorkspaceDatabase } from '../workspaceCandidate/copyAttestedWorkspaceDatabase.js';

import { createProfileInspectionDatabaseFactory } from './createProfileInspectionDatabase.js';
import { StagedProfileSnapshotInspector } from './inspectStagedProfileSnapshot.js';
import { isProfileMigrationInspectionPolicy, type ProfileMigrationInspectionPolicy } from './inspectSqliteProfileDatabase.js';
import type { InspectedProfileSnapshotMetadata } from './profileSnapshotTypes.js';
import { maximumProfileArtifactCatalogBytes, type ValidatedProfileArtifact } from './validateProfileArtifactCatalog.js';
import {
  bindProfileInspectionFile as bindFile,
  inspectProfileInspectionRoot as inspectRoot,
  sameProfileInspectionBinding as sameBinding,
  sameProfileInspectionPath as samePath,
} from './profileInspectionFileBinding.js';

export interface ProfileInspectionContentReceipt extends InspectedProfileSnapshotMetadata {
  readonly artifactIdentity: string;
  readonly migrationPolicy: ProfileMigrationInspectionPolicy;
  readonly database: { readonly byteSize: number; readonly sha256: string };
  readonly artifactCatalog: { readonly byteSize: number; readonly sha256: string };
}

export interface ProfileInspectionOperation {
  readonly kind: 'inspect' | 'prepareRestoreActivation';
  readonly migrationPolicy: ProfileMigrationInspectionPolicy;
  readonly operationId: string;
  readonly stagingRoot: string;
  readonly inspectionRoot: string;
  readonly migrationsDirectory: string;
  readonly nativeResourceRoot: string;
}

/** A fixed utility entrypoint only; never invoked in the business backend. */
export async function runProfileInspection(
  input: Readonly<ProfileInspectionOperation>,
  control: {
    readonly signal: AbortSignal;
    readonly assertOwned: () => Promise<void>;
    readonly createArtifactIdentity: (artifacts: readonly ValidatedProfileArtifact[]) => string;
  },
): Promise<ProfileInspectionContentReceipt> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.operationId) ||
      (input.kind !== 'inspect' && input.kind !== 'prepareRestoreActivation') ||
      !isProfileMigrationInspectionPolicy(input.migrationPolicy) ||
      [input.stagingRoot, input.inspectionRoot, input.migrationsDirectory, input.nativeResourceRoot]
        .some(path => typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || path.includes('\0')) ||
      !samePath(dirname(input.inspectionRoot), input.stagingRoot) ||
      !/^profile-inspection-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(basename(input.inspectionRoot))) {
    throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
  }
  const assertOwned = async () => {
    assertNotCancelled(control.signal);
    await control.assertOwned();
    assertNotCancelled(control.signal);
  };
  await assertOwned();
  // Native provenance and the process-global budget precede all imported reads.
  const databaseFactory = await createProfileInspectionDatabaseFactory(input.nativeResourceRoot);
  await assertOwned();
  const operationRoot = join(input.stagingRoot, input.operationId);
  const rootIdentity = await inspectRoot(operationRoot);
  const databasePath = join(operationRoot, 'profile.sqlite');
  const catalogPath = join(operationRoot, 'snapshot-catalog-v1.json');
  const databaseBefore = await bindFile(databasePath, Number.MAX_SAFE_INTEGER, control.signal);
  const catalogBefore = await bindFile(catalogPath, maximumProfileArtifactCatalogBytes, control.signal);
  const copyRootIdentity = await inspectRoot(input.inspectionRoot);
  if ((await readdir(input.inspectionRoot)).length !== 0) throw new Error('PROFILE_SNAPSHOT_VALIDATION_FAILED');
  await assertOwned();
  const copyPath = join(input.inspectionRoot, 'profile.sqlite');
  await copyAttestedWorkspaceDatabase({ sourcePath: databasePath, destinationPath: copyPath,
    expectedBytes: databaseBefore, signal: control.signal });
  const copyBefore = await bindFile(copyPath, Number.MAX_SAFE_INTEGER, control.signal);
  if (await inspectRoot(input.inspectionRoot) !== copyRootIdentity ||
      copyBefore.byteSize !== databaseBefore.byteSize || copyBefore.sha256 !== databaseBefore.sha256) {
    throw new Error('PROFILE_SNAPSHOT_VALIDATION_FAILED');
  }
  await assertOwned();
  const inspector = new StagedProfileSnapshotInspector({
    stagingRoot: input.stagingRoot,
    migrationsDirectory: input.migrationsDirectory,
    migrationPolicy: input.migrationPolicy,
    databaseSource: { kind: 'ownedInspectionCopy', databasePath: copyPath },
    databaseFactory,
  });
  const inspection = input.kind === 'inspect'
    ? await inspector.inspectProfileSnapshotWithArtifacts(input.operationId)
    : await inspector.inspectAndPrepareProfileRestoreActivation(input.operationId);
  await assertOwned();
  const databaseAfter = await bindFile(databasePath, Number.MAX_SAFE_INTEGER, control.signal);
  const catalogAfter = await bindFile(catalogPath, maximumProfileArtifactCatalogBytes, control.signal);
  const copyAfter = await bindFile(copyPath, Number.MAX_SAFE_INTEGER, control.signal);
  if (await inspectRoot(operationRoot) !== rootIdentity ||
      await inspectRoot(input.inspectionRoot) !== copyRootIdentity || !sameBinding(copyBefore, copyAfter) ||
      !sameBinding(databaseBefore, databaseAfter) || !sameBinding(catalogBefore, catalogAfter)) {
    throw new Error('PROFILE_SNAPSHOT_VALIDATION_FAILED');
  }
  await assertOwned();
  const artifactIdentity = control.createArtifactIdentity(inspection.artifacts);
  if (!/^[a-f0-9]{64}$/.test(artifactIdentity)) throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
  return Object.freeze({
    ...inspection.validation,
    artifactIdentity,
    migrationPolicy: input.migrationPolicy,
    database: Object.freeze({ byteSize: databaseAfter.byteSize, sha256: databaseAfter.sha256 }),
    artifactCatalog: Object.freeze({ byteSize: catalogAfter.byteSize, sha256: catalogAfter.sha256 }),
  });
}

function assertNotCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('PROFILE_INSPECTION_TIMEOUT');
}
