import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import {
  assertNoBuildTools,
  generateInstallerPayload,
} from './generateInstallerPayload.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

test('generates deterministic per-file components without absolute source paths', async () => {
  const root = await createPayloadFixture();
  const outputPath = join(root, '..', 'GeneratedPayload.wxs');
  const first = await generateInstallerPayload({ outputPath, payloadRoot: root });
  const firstXml = await readFile(outputPath, 'utf8');
  const second = await generateInstallerPayload({ outputPath, payloadRoot: root });
  const secondXml = await readFile(outputPath, 'utf8');

  assert.equal(first.inventory.stage, 'packagedApp');
  assert.equal(first.payloadFileCount, 4);
  assert.deepEqual(first.inventory, second.inventory);
  assert.equal(firstXml, secondXml);
  assert.equal((firstXml.match(/<Component Id=/g) ?? []).length, 10);
  assert.equal((firstXml.match(/KeyPath="yes"/g) ?? []).length, 10);
  assert.equal((firstXml.match(/<RemoveFolder Id=/g) ?? []).length, 6);
  assert.match(firstXml, /Source="\$\(EkyPayloadRoot\)\\Eky\.exe"/);
  assert.match(firstXml, /EkyStartMenuShortcut/);
  assert.match(firstXml, /DirectoryRef Id="EkyProgramsDirectory"/);
  assert.match(firstXml, /DirectoryRef Id="EkyInstallFolder"/);
  assert.doesNotMatch(firstXml, /INSTALLFOLDER/);
  assert.match(firstXml, /DirectoryRef Id="ApplicationProgramsFolder"/);
  const fileComponents =
    firstXml.match(/<Component Id="Cmp_[\s\S]*?<\/Component>/g) ?? [];
  assert.equal(fileComponents.length, 4);
  assert.ok(fileComponents.every((component) => !component.includes('<RemoveFolder')));
  assert.doesNotMatch(firstXml, new RegExp(escapeRegExp(root)));
});

test('escapes directory and file names in generated XML', async () => {
  const root = await createPayloadFixture();
  await mkdir(join(root, 'resources', 'vendor & tools'));
  await writeFile(join(root, 'resources', 'vendor & tools', 'a&b.txt'), 'ok');
  const outputPath = join(root, '..', 'GeneratedPayload.wxs');

  await generateInstallerPayload({ outputPath, payloadRoot: root });
  const xml = await readFile(outputPath, 'utf8');
  assert.match(xml, /Name="vendor &amp; tools"/);
  assert.match(xml, /a&amp;b\.txt/);
});

test('rejects installer build tools from the application payload', () => {
  for (const logicalPath of [
    'dotnet.exe',
    'tools/MSBuild.exe',
    'tools/NuGet.exe',
    'tools/wix.exe',
    'packages/WixToolset.Sdk/7.0.0/tool.dll',
    'packages/WixToolset.Sdk.7.0.0.nupkg',
  ]) {
    assert.throws(
      () => assertNoBuildTools([{ logicalPath }]),
      /INSTALLER_PAYLOAD_BUILD_TOOL_FORBIDDEN/,
    );
  }
  assert.doesNotThrow(() =>
    assertNoBuildTools([
      { logicalPath: 'Eky.exe' },
      { logicalPath: 'resources/backend/dist/index.js' },
    ]),
  );
});

async function createPayloadFixture() {
  const parent = await mkdtemp(join(tmpdir(), 'eky-installer-payload-'));
  temporaryDirectories.push(parent);
  const root = join(parent, 'Eky-win32-x64');
  await mkdir(join(root, 'resources', 'backend', 'dist'), { recursive: true });
  await writeFile(join(root, 'Eky.exe'), 'synthetic executable');
  await writeFile(join(root, 'resources', 'app.asar'), 'synthetic asar');
  await writeFile(
    join(root, 'resources', 'backend', 'dist', 'index.js'),
    'export {};',
  );
  await writeFile(
    join(root, 'resources', 'backend', 'dist', 'worker.js'),
    'export {};',
  );
  return root;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
