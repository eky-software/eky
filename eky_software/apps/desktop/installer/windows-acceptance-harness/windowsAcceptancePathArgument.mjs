import { isAbsolute, resolve } from 'node:path';

const DOT_SEGMENT_PATTERN = /(?:^|[\\/])(?:\.|\.\.)(?:[\\/]|$)/u;

export function parseAbsoluteWindowsAcceptancePath(value, errorCode) {
  if (
    typeof value !== 'string' ||
    value.includes('\0') ||
    !isAbsolute(value) ||
    value.endsWith('\\') ||
    value.endsWith('/') ||
    DOT_SEGMENT_PATTERN.test(value)
  ) {
    throw new Error(errorCode);
  }
  return resolve(value);
}
