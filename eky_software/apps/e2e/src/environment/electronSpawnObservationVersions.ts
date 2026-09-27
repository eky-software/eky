import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

// Intentional evidence baseline for the reviewed early-spawn/ALS contract.
// Updating manifests/installations alone must not approve a new channel contract.
export const verifiedElectronSpawnNodeVersion = '24.19.0';
export const verifiedElectronSpawnPlaywrightVersion = '1.62.1';
export const verifiedElectronSpawnBundleSha256 = 'bc492ac4a38bfdd44a530be7ad32ad16151ffc66e4904ef1adba1301627e8d06';

interface VersionEvidence {
  readonly nodePin: string;
  readonly nodeVersion: string;
  readonly playwrightPin: string;
  readonly playwrightVersions: readonly string[];
  readonly bundleSha256: string;
}

// Read the same package chain used by the Electron bundle contracts, without
// loading their test harness. Pins AND installations must match the baseline.
export function readElectronSpawnObservationVersions(): VersionEvidence {
  const manifest = new URL('../../package.json', import.meta.url);
  const e2eRequire = createRequire(manifest);
  const playwrightRequire = createRequire(e2eRequire.resolve('@playwright/test'));
  const coreRequire = createRequire(playwrightRequire.resolve('playwright'));
  const version = (filename: string): string => JSON.parse(readFileSync(filename, 'utf8')).version;
  return {
    nodePin: readFileSync(new URL('../../../../.node-version', import.meta.url), 'utf8').trim(),
    nodeVersion: process.versions.node,
    playwrightPin: JSON.parse(readFileSync(manifest, 'utf8')).devDependencies['@playwright/test'],
    playwrightVersions: [
      version(e2eRequire.resolve('@playwright/test/package.json')),
      version(playwrightRequire.resolve('playwright/package.json')),
      version(coreRequire.resolve('playwright-core/package.json')),
    ],
    bundleSha256: createHash('sha256').update(readFileSync(coreRequire.resolve('playwright-core/lib/coreBundle'))).digest('hex'),
  };
}

export function assertElectronSpawnObservationVersions(
  read: () => VersionEvidence = readElectronSpawnObservationVersions,
): void {
  try {
    const evidence = read();
    const exact = (value: unknown) => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
    if (!exact(evidence.nodePin) || evidence.nodePin !== verifiedElectronSpawnNodeVersion ||
      evidence.nodeVersion !== evidence.nodePin ||
      !exact(evidence.playwrightPin) || evidence.playwrightPin !== verifiedElectronSpawnPlaywrightVersion ||
      evidence.playwrightVersions.length !== 3 ||
      evidence.bundleSha256 !== verifiedElectronSpawnBundleSha256 ||
      !evidence.playwrightVersions.every(value => value === evidence.playwrightPin)) throw new Error();
  } catch {
    throw new Error('E2E_ELECTRON_OBSERVATION_VERSION_UNVERIFIED');
  }
}
