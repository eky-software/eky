import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { packageDefaultWindowsApplication } from './packageWindowsApplication.mjs';

async function packageWindowsSpike() {
  if (process.argv.slice(2).some((argument) => argument !== '--pilot')) {
    throw new Error('Unsupported Windows package argument.');
  }
  return packageDefaultWindowsApplication({
    pilotBuild: process.argv.slice(2).includes('--pilot'),
    reportPackagedPath: true,
  });
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await packageWindowsSpike();
}
