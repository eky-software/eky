import {
  ElectronDevelopmentRuntimeError,
  resolveElectronDevelopmentRuntime,
} from './electron-development-runtime.mjs';

try {
  const runtime = resolveElectronDevelopmentRuntime();
  process.stdout.write(
    `Electron development runtime ready (${runtime.version}).\n`,
  );
} catch (error) {
  const code =
    error instanceof ElectronDevelopmentRuntimeError
      ? error.code
      : 'ELECTRON_PACKAGE_INVALID';
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
}
