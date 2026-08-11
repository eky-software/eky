import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createInstallerBuildArguments,
  parseInstallerBuildArguments,
} from './buildWindowsInstaller.mjs';

test('accepts only the named synthetic build path overrides', () => {
  assert.deepEqual(
    parseInstallerBuildArguments([
      '--release-config',
      'release.json',
      '--desktop-package',
      'package.json',
      '--artifacts-root',
      'artifacts',
    ]),
    {
      artifactsRoot: 'artifacts',
      desktopPackagePath: 'package.json',
      releaseConfigPath: 'release.json',
    },
  );
});

test('rejects unknown, missing and duplicate build path overrides', () => {
  for (const args of [
    ['--payload-root', 'payload'],
    ['--release-config'],
    ['--release-config', 'one', '--release-config', 'two'],
  ]) {
    assert.throws(
      () => parseInstallerBuildArguments(args),
      /INSTALLER_BUILD_ARGUMENTS_INVALID/,
    );
  }
});

test('isolates intermediate WiX output for each artifact root', () => {
  const release = {
    appVersion: '1.2.3',
    msiProductVersion: '1.2.3',
  };
  const first = createInstallerBuildArguments({
    artifactsRoot: 'artifacts/first',
    payloadRoot: 'payload',
    productCode: '11111111-1111-1111-1111-111111111111',
    release,
  });
  const second = createInstallerBuildArguments({
    artifactsRoot: 'artifacts/second',
    payloadRoot: 'payload',
    productCode: '22222222-2222-2222-2222-222222222222',
    release,
  });

  const firstIntermediate = first.find((argument) =>
    argument.startsWith('-p:IntermediateOutputPath='),
  );
  const secondIntermediate = second.find((argument) =>
    argument.startsWith('-p:IntermediateOutputPath='),
  );
  assert.match(firstIntermediate, /artifacts[/\\]first[/\\]\.intermediate/);
  assert.match(secondIntermediate, /artifacts[/\\]second[/\\]\.intermediate/);
  assert.notEqual(firstIntermediate, secondIntermediate);
});
