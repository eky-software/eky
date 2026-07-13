import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const backendDirectory = resolve(scriptDirectory, '..');
const sourceDirectory = resolve(backendDirectory, 'src/database/migrations');
const targetDirectory = resolve(backendDirectory, 'dist/database/migrations');

await rm(targetDirectory, { force: true, recursive: true });
await mkdir(dirname(targetDirectory), { recursive: true });
await cp(sourceDirectory, targetDirectory, { recursive: true });
