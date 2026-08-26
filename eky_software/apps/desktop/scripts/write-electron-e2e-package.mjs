import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const desktopDirectory = resolve(import.meta.dirname, '..');
const packageMetadata = JSON.parse(
  await readFile(resolve(desktopDirectory, 'package.json'), 'utf8'),
);
const version = packageMetadata.version;

if (typeof version !== 'string' || version.length === 0) {
  throw new Error('Desktop package version is unavailable.');
}

await writeFile(
  resolve(desktopDirectory, 'e2e-dist/package.json'),
  `${JSON.stringify(
    {
      main: 'e2e/electronE2eEntrypoint.js',
      name: 'eky-desktop-e2e',
      private: true,
      type: 'module',
      version,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

const profilePackageDirectory = resolve(
  desktopDirectory,
  'e2e-dist/w6b2-profile',
);
await mkdir(profilePackageDirectory, { recursive: true });
await writeFile(
  resolve(profilePackageDirectory, 'package.json'),
  `${JSON.stringify(
    {
      main: '../e2e/w6b2PackagedWorkspaceProfileEntrypoint.js',
      name: 'eky-desktop-w6b2-profile-e2e',
      private: true,
      type: 'module',
      version,
    },
    null,
    2,
  )}\n`,
  'utf8',
);
