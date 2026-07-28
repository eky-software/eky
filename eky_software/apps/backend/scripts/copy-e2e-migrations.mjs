import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const backendDirectory = resolve(import.meta.dirname, '..');
const sourceDirectory = resolve(backendDirectory, 'src/database/migrations');
const targetDirectory = resolve(
  backendDirectory,
  'e2e-dist/src/database/migrations',
);

await rm(targetDirectory, { force: true, recursive: true });
await mkdir(dirname(targetDirectory), { recursive: true });
await cp(sourceDirectory, targetDirectory, { recursive: true });
