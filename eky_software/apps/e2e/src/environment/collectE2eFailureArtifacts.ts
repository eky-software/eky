import {
  existsSync,
  readdirSync,
  writeFileSync,
  type Dirent,
} from 'node:fs';
import { join } from 'node:path';

import type { TestInfo } from '@playwright/test';

import type { E2eWorkerPaths } from './e2eEnvironmentTypes.js';
import type { ManagedProcess } from './startManagedProcess.js';
import { collectFailureArtifacts } from './collectFailureArtifacts.js';

export async function collectE2eFailureArtifacts(input: {
  paths: E2eWorkerPaths;
  processes: readonly {
    artifactName: string;
    managedProcess: ManagedProcess;
  }[];
  runRoot: string;
  scenarioId: string;
  testInfo: TestInfo;
}): Promise<void> {
  const processOutputPaths = input.processes.flatMap((process) => {
    const stdoutPath = join(
      input.paths.tempRoot,
      `${process.artifactName}-stdout.txt`,
    );
    const stderrPath = join(
      input.paths.tempRoot,
      `${process.artifactName}-stderr.txt`,
    );
    writeFileSync(stdoutPath, process.managedProcess.readStdout(), {
      encoding: 'utf8',
      mode: 0o600,
    });
    writeFileSync(stderrPath, process.managedProcess.readStderr(), {
      encoding: 'utf8',
      mode: 0o600,
    });
    return [stdoutPath, stderrPath];
  });

  const sourceFiles = [
    ...(existsSync(input.paths.databaseFilePath)
      ? [input.paths.databaseFilePath]
      : []),
    ...listJsonlFiles(input.paths.logsRoot),
    ...processOutputPaths,
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
