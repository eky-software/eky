import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function measurePathBytes(path: string): number {
  let totalBytes = 0;
  const pendingPaths = [path];

  while (pendingPaths.length > 0) {
    const currentPath = pendingPaths.pop();
    if (currentPath === undefined) {
      continue;
    }

    let entry;
    try {
      entry = lstatSync(currentPath);
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        continue;
      }
      throw error;
    }

    if (entry.isSymbolicLink()) {
      throw new Error('Endurance metrics refuse symbolic links.');
    }
    if (entry.isDirectory()) {
      for (const childName of readdirSync(currentPath)) {
        pendingPaths.push(join(currentPath, childName));
      }
      continue;
    }
    if (entry.isFile()) {
      totalBytes += entry.size;
    }
  }

  return totalBytes;
}
