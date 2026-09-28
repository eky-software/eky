import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

// Check the original segments before canonicalization can hide a junction.
export function createWindowsServicePathChecks(errorCode: string) {
  const invalid = () => new Error(errorCode);
  function requirePath(path: string, directory: boolean): string {
    if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0') ||
      (process.platform === 'win32' && (!/^[A-Za-z]:\\/.test(path) || path.includes('/') ||
        path.indexOf(':', 2) >= 0 || path.split('\\').slice(1).some(part => part.endsWith('.') || part.endsWith(' '))))) {
      throw invalid();
    }
    if (!sameWindowsServicePath(path, resolve(path))) throw invalid();
    const stats = lstatSync(path);
    if (stats.isSymbolicLink() || (directory ? !stats.isDirectory() : !stats.isFile())) throw invalid();
    for (let cursor = directory ? path : dirname(path);;) {
      const parent = lstatSync(cursor);
      if (parent.isSymbolicLink() || !parent.isDirectory()) throw invalid();
      const next = dirname(cursor);
      if (next === cursor) break;
      cursor = next;
    }
    return realpathSync.native(path);
  }
  function requireDescendant(path: string, root: string): void {
    const rel = relative(root, path);
    if (rel === '' || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw invalid();
  }
  return { requirePath, requireDescendant };
}

export function sameWindowsServicePath(first: string, second: string): boolean {
  return process.platform === 'win32' ? first.toLowerCase() === second.toLowerCase() : first === second;
}
