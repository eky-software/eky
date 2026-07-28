import {
  copyFileSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';

import { assertPathUnderRoot } from './assertE2eSafetyBoundary.js';

export function collectFailureArtifacts(input: {
  appVersion: string;
  buildRevision: string;
  files: readonly string[];
  runRoot: string;
  scenarioId: string;
  targetRoot: string;
}): string {
  const runRoot = realpathSync(input.runRoot);
  assertPathUnderRoot(input.targetRoot, runRoot);
  mkdirSync(input.targetRoot, { mode: 0o700, recursive: true });

  for (const sourcePath of input.files) {
    assertPathUnderRoot(sourcePath, runRoot);
    copyFileSync(sourcePath, join(input.targetRoot, basename(sourcePath)));
  }

  const manifestPath = join(input.targetRoot, 'failure-manifest.json');
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        appVersion: input.appVersion,
        buildRevision: input.buildRevision,
        scenarioId: input.scenarioId,
      },
      null,
      2,
    )}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );

  return manifestPath;
}
