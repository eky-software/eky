import { win32 } from 'node:path';

export class WindowsSystemRootError extends Error {
  constructor() {
    super('The Windows system root is not canonical.');
    this.name = 'WindowsSystemRootError';
  }
}

export function requireCanonicalWindowsSystemRoot(
  systemRoot: string | undefined,
): string {
  if (
    systemRoot === undefined ||
    systemRoot.includes('\0') ||
    !win32.isAbsolute(systemRoot) ||
    win32.resolve(systemRoot) !== systemRoot
  ) {
    throw new WindowsSystemRootError();
  }
  return systemRoot;
}
