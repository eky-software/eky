import {
  verifyExactLocalHistoricalWindowsInstallerFixture,
  withHistoricalSourceWindowsInstallerFixture,
} from './historicalWindowsInstallerFixtureBuilder.mjs';

const exactLocal = await verifyExactLocalHistoricalWindowsInstallerFixture();
const rebuild = await withHistoricalSourceWindowsInstallerFixture((fixture) =>
  Object.freeze({
    appVersion: fixture.appVersion,
    artifactClass: fixture.artifactClass,
    buildRevision: fixture.buildRevision,
    matchesApprovedArtifact: fixture.matchesApprovedArtifact,
    packageSha256: fixture.packageSha256,
    packageSize: fixture.packageSize,
    productCode: fixture.productCode,
    sourceArchiveManifestSha256:
      fixture.provenance.sourceArchiveManifestSha256,
    upgradeCode: fixture.upgradeCode,
  }),
);

console.log(
  JSON.stringify({
    exactLocal: {
      appVersion: exactLocal.appVersion,
      artifactClass: exactLocal.artifactClass,
      buildRevision: exactLocal.buildRevision,
      matchesApprovedArtifact: exactLocal.matchesApprovedArtifact,
      packageSha256: exactLocal.packageSha256,
      packageSize: exactLocal.packageSize,
      productCode: exactLocal.productCode,
      upgradeCode: exactLocal.upgradeCode,
    },
    rebuild,
    verified: true,
  }),
);
