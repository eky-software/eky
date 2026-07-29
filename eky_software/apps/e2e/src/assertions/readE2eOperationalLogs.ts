import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function readE2eOperationalLogs(logsRoot: string): string {
  return readFilesRecursively(logsRoot).join('\n');
}

function readFilesRecursively(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);

    return entry.isDirectory()
      ? readFilesRecursively(path)
      : [readFileSync(path, 'utf8')];
  });
}
