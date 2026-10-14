import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { posix } from 'node:path';

const { join } = posix;

export async function readInspectionSourceIdentity(path) {
  const hash = createHash('sha256');
  let byteSize = 0;
  for await (const chunk of createReadStream(path)) {
    byteSize += chunk.length;
    hash.update(chunk);
  }
  return { byteSize, sha256: hash.digest('hex') };
}

// The host supplies actual compiled production ports. Unit tests substitute only
// those ports; the Linux acceptance caller must also prove the outer tree stopped.
export async function runLinuxInspectionCase({ config, paths, repository, ports, observation,
  assertAuthority, signal, recordPhase, readSource = readInspectionSourceIdentity }) {
  let owner;
  let ownerReleased = false;
  let firstFailure;
  let causeCode = null;
  try {
    recordPhase('reservation');
    owner = await ports.acquireDesktopWorkspaceReservation({ userDataRoot: paths.operationRoot,
      assertSingleInstanceOwnership: assertAuthority, signal });
    await owner.assertMainOwned();
    recordPhase('inspection');
    let returned;
    let rejected;
    try {
      returned = await ports.runProfileSnapshotInspection({ operationId: config.operationId,
        kind: 'inspect', migrationPolicy: 'restoreCompatible',
        runnerPath: join(repository, 'apps/desktop/dist/runtime/profileInspectionRunner.js'),
        deployment: await ports.createProfileInspectionDeployment({
          backendRoot: join(repository, 'apps/backend'), resourcesRoot: paths.resourcesRoot }),
        reservation: owner, assertAuthority, signal,
        async readActiveContext(request) {
          assert.equal(request.operationId, config.operationId);
          assert.equal(request.kind, 'inspect');
          observation.contextReads += 1;
          return config.activeContext;
        },
      });
    } catch (error) { rejected = error; }
    recordPhase('resultVerification');
    const expectedCause = config.variant === 'schemaChanged' ? 'PROFILE_SCHEMA_UNSUPPORTED'
      : config.variant === 'missingNative' ? 'PROFILE_INSPECTION_PROTOCOL_INVALID' : null;
    if (expectedCause !== null) {
      assert.ok(rejected instanceof ports.ProfileInspectionProcessError);
      causeCode = ports.readProfileInspectionFailureCause(rejected) ?? null;
      assert.equal(causeCode, expectedCause);
      assert.equal(rejected.cleanup.processAbsent, true);
      assert.equal(rejected.cleanup.reservationReclaimed, true);
      assert.equal(rejected.cleanup.forced, false);
    } else {
      if (rejected) throw rejected;
      const { receipt, validation } = returned;
      assert.deepEqual(receipt.database, config.expected.database);
      assert.deepEqual(receipt.artifactCatalog, config.expected.artifactCatalog);
      assert.equal(receipt.migrationChainIdentity, config.expected.migrationChainIdentity);
      assert.equal(receipt.databaseHealth, 'healthy');
      assert.equal(receipt.migrationPolicy, 'restoreCompatible');
      assert.deepEqual(validation, { type: 'profileSnapshotValidation',
        activeProfileIsEmpty: config.activeContext.activeProfileIsEmpty, artifactCount: 0,
        artifactTotalByteSize: 0, databaseHealth: 'healthy',
        migrationChainIdentity: config.expected.migrationChainIdentity,
        profileId: config.activeContext.activeProfileId, profileMatchesActive: true });
      observation.receiptVerified = true;
    }
    assert.equal(observation.forkCount, 1);
    assert.equal(observation.exitObserved, true);
    assert.equal(observation.exitCode, expectedCause === null ? 0 : 1);
    assert.equal(observation.contextReads, expectedCause === null ? 2 : 1);
    recordPhase('sourceAndReservation');
    await owner.assertMainOwned();
    await assert.rejects(ports.acquireWorkspaceProcessReservation({ userDataRoot: paths.operationRoot, signal }),
      error => error instanceof ports.WorkspaceProcessReservationError && error.reason === 'busy' &&
        error.cleanupFailed === false);
    observation.mainExclusionProved = true;
    assert.deepEqual(await readSource(join(paths.operationRoot, 'profile.sqlite')), config.expected.database);
    assert.deepEqual(await readSource(join(paths.operationRoot, 'snapshot-catalog-v1.json')), config.expected.artifactCatalog);
    observation.sourcePreserved = true;
  } catch (error) {
    firstFailure = error;
    causeCode ??= ports.readProfileInspectionFailureCause(error) ?? null;
  } finally {
    if (owner) {
      try {
        await owner.assertMainOwned();
        await owner.close();
        ownerReleased = true;
      } catch (error) { firstFailure ??= error; }
    }
  }
  if (!firstFailure) {
    try {
      recordPhase('ownerRelease');
      const recheck = await ports.acquireWorkspaceProcessReservation({ userDataRoot: paths.operationRoot, signal });
      try { await recheck.assertOwned(); }
      finally { await recheck.release(); }
      observation.ownerReleaseProved = true;
      recordPhase('completed');
    } catch (error) { firstFailure = error; }
  }
  return { status: firstFailure ? 'failed' : 'passed', causeCode, ownerReleased };
}
