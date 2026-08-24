import {
  installHistoricalDependencies,
  packageHistoricalApplication,
} from './historicalWindowsApplicationBuilder.mjs';
import {
  buildHistoricalInstallerRelease,
  inspectWindowsInstallerIdentity,
  restoreHistoricalInstaller,
} from './historicalWindowsInstallerBuilder.mjs';
import { validateHistoricalWindowsInstallerIdentity } from './historicalWindowsInstallerFixturePolicy.mjs';
import { withMaterializedHistoricalWindowsInstallerSource } from './materializeHistoricalWindowsInstallerSource.mjs';
import {
  assertHistoricalDependenciesAreIsolated,
  assertHistoricalLockedInputsUnchanged,
  assertHistoricalSourceHasNoInstalledDependencies,
  captureHistoricalLockedInputHashes,
  validateHistoricalWindowsInstallerSource,
} from './historicalWindowsInstallerToolchain.mjs';
import {
  createVerifiedHistoricalSourceFixture,
  verifyHistoricalInstallerRelease,
  verifyHistoricalPackagedApplication,
} from './historicalWindowsInstallerVerifier.mjs';

export { verifyExactLocalHistoricalWindowsInstallerFixture } from './historicalWindowsInstallerVerifier.mjs';

export async function withHistoricalSourceWindowsInstallerFixture(
  task,
  dependencies = {},
) {
  if (typeof task !== 'function') {
    throw new Error('HISTORICAL_FIXTURE_TASK_INVALID');
  }
  return withMaterializedHistoricalWindowsInstallerSource(
    async (materialized) => {
      const sourceMetadata = await validateHistoricalWindowsInstallerSource(
        materialized.workspaceRoot,
      );
      const lockedInputs = await captureHistoricalLockedInputHashes(
        materialized.workspaceRoot,
      );

      await assertHistoricalSourceHasNoInstalledDependencies(
        materialized.workspaceRoot,
      );
      await (
        dependencies.installDependencies ?? installHistoricalDependencies
      )({ workspaceRoot: materialized.workspaceRoot });
      await assertHistoricalDependenciesAreIsolated(materialized.workspaceRoot);
      await verifyLockedInputs(materialized.workspaceRoot, lockedInputs);

      await (dependencies.packageApplication ?? packageHistoricalApplication)({
        workspaceRoot: materialized.workspaceRoot,
      });
      const packagedApplicationIdentity =
        await verifyHistoricalPackagedApplication(materialized.workspaceRoot);
      await verifyLockedInputs(materialized.workspaceRoot, lockedInputs);

      await (dependencies.restoreInstaller ?? restoreHistoricalInstaller)({
        workspaceRoot: materialized.workspaceRoot,
      });
      await verifyLockedInputs(materialized.workspaceRoot, lockedInputs);

      const built = await (
        dependencies.buildInstallerRelease ?? buildHistoricalInstallerRelease
      )({ workspaceRoot: materialized.workspaceRoot });
      await verifyHistoricalInstallerRelease(built);
      const identity = await (
        dependencies.inspectInstallerIdentity ?? inspectWindowsInstallerIdentity
      )(built.installerPath);
      validateHistoricalWindowsInstallerIdentity(identity);
      await verifyLockedInputs(materialized.workspaceRoot, lockedInputs);

      const fixture = await createVerifiedHistoricalSourceFixture({
        built,
        identity,
        materialized,
        packagedApplicationIdentity,
        sourceMetadata,
      });
      return task(fixture);
    },
  );
}

async function verifyLockedInputs(workspaceRoot, expected) {
  await assertHistoricalLockedInputsUnchanged({ expected, workspaceRoot });
}
