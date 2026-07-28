import {
  existsSync,
  readdirSync,
  writeFileSync,
  type Dirent,
} from 'node:fs';
import { join } from 'node:path';

import type { TestInfo } from '@playwright/test';

import type { StartedE2eBackend } from './startE2eBackendProcess.js';
import { collectFailureArtifacts } from './collectFailureArtifacts.js';
import type { E2eWorkerPaths } from './e2eEnvironmentTypes.js';

export async function collectBackendFailureArtifacts(input: {
  backend: StartedE2eBackend;
  paths: E2eWorkerPaths;
  runRoot: string;
  scenarioId: string;
  testInfo: TestInfo;
}): Promise<void> {
  const stdoutPath = join(input.paths.tempRoot, 'backend-stdout.txt');
  const stderrPath = join(input.paths.tempRoot, 'backend-stderr.txt');
  writeFileSync(stdoutPath, input.backend.managedProcess.readStdout(), {
    encoding: 'utf8',
    mode: 0o600,
  });
  writeFileSync(stderrPath, input.backend.managedProcess.readStderr(), {
    encoding: 'utf8',
    mode: 0o600,
  });

  const sourceFiles = [
    ...(existsSync(input.paths.databaseFilePath)
      ? [input.paths.databaseFilePath]
      : []),
    ...listJsonlFiles(input.paths.logsRoot),
    stdoutPath,
    stderrPath,
  ];
  collectFailureArtifacts({
    appVersion: '0.0.0-e2e',
    buildRevision: 'development',
    files: sourceFiles,
    runRoot: input.runRoot,
    scenarioId: input.scenarioId,
    targetRoot: input.paths.artifactsRoot,
  });

  for (const entry of readdirSync(input.paths.artifactsRoot, {
    withFileTypes: true,
  })) {
    if (!entry.isFile()) {
      continue;
    }
    await input.testInfo.attach(`e2e-${entry.name}`, {
      contentType: resolveContentType(entry.name),
      path: join(input.paths.artifactsRoot, entry.name),
    });
  }
}

function listJsonlFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true }).flatMap(
    (entry: Dirent) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return listJsonlFiles(path);
      }
      return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : [];
    },
  );
}

function resolveContentType(fileName: string): string {
  if (fileName.endsWith('.json') || fileName.endsWith('.jsonl')) {
    return 'application/json';
  }
  if (fileName.endsWith('.sqlite')) {
    return 'application/vnd.sqlite3';
  }
  return 'text/plain';
}
