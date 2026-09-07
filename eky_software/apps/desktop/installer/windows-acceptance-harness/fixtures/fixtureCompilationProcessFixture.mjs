import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeFixtureCompilation, readCompilationContext } from './buildWindowsApplicationCloseFixture.mjs';

const [requestPath, mode] = process.argv.slice(2);
const context = readCompilationContext(requestPath, JSON.parse(await readFile(requestPath, 'utf8')));
const treeFixture = resolve(dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'windows-process-supervisor', 'tests', 'processTreeFixture.mjs');
if (!['compilerFailure', 'compilerTimeout'].includes(mode)) process.exit(64);
const compiler = {
  executable: process.execPath,
  arguments: mode === 'compilerFailure' ? ['-e', 'process.exit(23)'] : [
    treeFixture, '--mode=spawnGrandchildAndHold', '--role=root',
    '--scenario=' + context.scenario,
    '--artifactDescriptorSha256=' + context.artifactDescriptorSha256,
    '--runNonce=' + context.runNonce, '--runRoot=' + context.runRoot,
    '--workerResultPath=' + context.workerResultPath,
  ],
};
process.exitCode = await executeFixtureCompilation(context, compiler);
