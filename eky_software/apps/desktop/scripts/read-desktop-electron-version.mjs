import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const desktopPackageJsonPath = fileURLToPath(
  new URL('../package.json', import.meta.url),
);
const stableExactSemVerPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function readDesktopElectronVersionFromMetadata(value) {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('devDependencies' in value) ||
    typeof value.devDependencies !== 'object' ||
    value.devDependencies === null ||
    !('electron' in value.devDependencies) ||
    typeof value.devDependencies.electron !== 'string' ||
    !stableExactSemVerPattern.test(value.devDependencies.electron)
  ) {
    throw new Error(
      'Desktop Electron dependency must be an exact stable SemVer version.',
    );
  }

  return value.devDependencies.electron;
}

export async function readDesktopElectronVersion() {
  const packageMetadata = JSON.parse(
    await readFile(desktopPackageJsonPath, 'utf8'),
  );

  return readDesktopElectronVersionFromMetadata(packageMetadata);
}
