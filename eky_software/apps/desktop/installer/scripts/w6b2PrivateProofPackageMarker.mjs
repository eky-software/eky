import { writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export const W6B2_PRIVATE_PROOF_PACKAGE_MARKER_FILE =
  'w6b2-private-proof-v1.json';

const expectedVersions = Object.freeze({
  source: '0.2.7',
  target: '0.2.8',
});

export function createW6b2PrivateProofPackageMarker(input) {
  if (
    typeof input !== 'object' ||
    input === null ||
    (input.role !== 'source' && input.role !== 'target') ||
    input.appVersion !== expectedVersions[input.role]
  ) {
    throw new Error('W6B2_PRIVATE_PROOF_PACKAGE_MARKER_INVALID');
  }

  return Object.freeze({
    appVersion: input.appVersion,
    formatVersion: 1,
    role: input.role,
  });
}

export async function writeW6b2PrivateProofPackageMarker(input) {
  if (
    typeof input !== 'object' ||
    input === null ||
    typeof input.backendStage !== 'string' ||
    !isAbsolute(input.backendStage)
  ) {
    throw new Error('W6B2_PRIVATE_PROOF_PACKAGE_MARKER_PATH_INVALID');
  }

  const marker = createW6b2PrivateProofPackageMarker(input);
  await writeFile(
    join(input.backendStage, W6B2_PRIVATE_PROOF_PACKAGE_MARKER_FILE),
    `${JSON.stringify(marker)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  return marker;
}
