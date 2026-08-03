import {
  lstatSync,
  statSync,
} from 'node:fs';

import { test, expect } from '@playwright/test';

import { resolveElectronE2eRuntime } from '../../src/environment/resolveElectronE2eExecutable.js';

test('DESK-RUNTIME-001 @critical resolves the exact Electron runtime from the desktop package', () => {
  const runtime = resolveElectronE2eRuntime();

  expect(runtime.version).toBe('43.2.0');
  expect(lstatSync(runtime.executablePath).isSymbolicLink()).toBe(false);
  expect(statSync(runtime.executablePath).isFile()).toBe(true);
});
