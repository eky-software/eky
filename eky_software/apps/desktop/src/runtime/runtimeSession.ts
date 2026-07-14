import { randomBytes } from 'node:crypto';

const runtimeSessionBytes = 32;
const runtimeSessionLength = 43;
const runtimeSessionPattern = /^[A-Za-z0-9_-]+$/;

export function createDesktopRuntimeSession(): string {
  return randomBytes(runtimeSessionBytes).toString('base64url');
}

export function isDesktopRuntimeSession(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === runtimeSessionLength &&
    runtimeSessionPattern.test(value)
  );
}
