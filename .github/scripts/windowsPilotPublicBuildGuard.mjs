import { lstat, readFile } from 'node:fs/promises';
import { assertPublicBuildBaseline, denied, maximumBytes } from './windowsPilotPublicBuildPolicy.mjs';

const desktop = new URL('../../eky_software/apps/desktop/', import.meta.url);

async function manifest(relativePath) {
  const url = new URL(relativePath, desktop);
  const stat = await lstat(url);
  if (!stat.isFile() || stat.size > maximumBytes) throw new Error(denied);
  return readFile(url);
}

try {
  if (process.argv.length !== 2) throw new Error(denied);
  assertPublicBuildBaseline(process.env.GITHUB_REPOSITORY, process.env.GITHUB_SERVER_URL,
    await manifest('package.json'), await manifest('installer/installer-release.json'));
} catch {
  process.stderr.write(denied + '\n');
  process.exitCode = 1;
}
