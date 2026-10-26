import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { expect, test } from '@playwright/test';

import { assertElectronSelectorFixtureCombination, prepareElectronSelectorProfile } from '../../../desktop/e2e/electronSelectorProfileFixture.js';
import { selectorImportScenarioId } from '../../../desktop/e2e/electronSelectorTestRelease.js';
import { acceptedBuildMetadataFileName } from '../../../desktop/src/update/acceptedBuildMetadataStore.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../../../desktop/src/workspaces/registry/workspaceRegistryPaths.js';
import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';

const syntheticEnvironment = { EKY_E2E: '1' };

test('SYS-SELECTOR-FIXTURE-004 @security allows only the named empty selector to use an isolated synthetic import source', () => {
  const input = { scenarioId: selectorImportScenarioId, state: 'empty' as const,
    hasLegacyInvoiceProfile: false, backup: 'synthetic' as const, nativeDialogPurpose: 'workspaceBackupImport' };
  expect(() => assertElectronSelectorFixtureCombination(input)).not.toThrow();
  for (const state of ['empty', 'ready', 'recoveryRequired'] as const) {
    expect(() => assertElectronSelectorFixtureCombination({ ...input, state, backup: 'none' })).not.toThrow();
  }
  for (const changed of [
    { scenarioId: `${selectorImportScenarioId}-OTHER` }, { scenarioId: 'DESK-SELECTOR-CREATE-001' },
    { state: 'ready' as const }, { state: 'recoveryRequired' as const },
    { hasLegacyInvoiceProfile: true }, { backup: 'activeReplacement' as const },
    { nativeDialogPurpose: 'workspaceBackupReplacement' }, { nativeDialogPurpose: 'invoicePdfArchive' },
  ]) {
    expect(() => assertElectronSelectorFixtureCombination({ ...input, ...changed })).toThrow('COMBINATION_INVALID');
  }
});

test('SYS-SELECTOR-FIXTURE-001 @security creates only an unselected synthetic registry and metadata', async () => {
  for (const state of ['empty', 'ready', 'recoveryRequired'] as const) {
    const runRoot = createE2eRunRoot();
    const userDataPath = join(runRoot, 'selector-profile');
    mkdirSync(userDataPath);
    try {
      await prepareElectronSelectorProfile({ runRoot, userDataPath, state }, syntheticEnvironment);
      const bytes = readFileSync(join(userDataPath, WORKSPACE_REGISTRY_FILE_NAME), 'utf8');
      expect(JSON.parse(bytes)).toMatchObject({ formatVersion: 2, activeWorkspaceId: null });
      expect(JSON.parse(bytes).workspaces).toHaveLength(state === 'empty' ? 0 : 1);
      expect(readdirSync(userDataPath).sort()).toEqual(['update-state', WORKSPACE_REGISTRY_FILE_NAME]);
      await expect(prepareElectronSelectorProfile({ runRoot, userDataPath, state }, syntheticEnvironment)).rejects.toThrow('ALREADY_EXISTS');
      expect(readFileSync(join(userDataPath, WORKSPACE_REGISTRY_FILE_NAME), 'utf8')).toBe(bytes);
    } finally { rmSync(runRoot, { recursive: true, force: true }); }
  }
});

test('SYS-SELECTOR-FIXTURE-003 @security rejects a linked dot-segment path without changing existing metadata', async () => {
  const runRoot = createE2eRunRoot();
  const userDataPath = join(runRoot, 'profile');
  const other = join(runRoot, 'other');
  const linked = join(runRoot, 'linked');
  mkdirSync(userDataPath);
  mkdirSync(join(other, 'child'), { recursive: true });
  mkdirSync(join(other, 'profile'));
  try {
    await prepareElectronSelectorProfile({ runRoot, userDataPath, state: 'ready' }, syntheticEnvironment);
    const registryPath = join(userDataPath, WORKSPACE_REGISTRY_FILE_NAME);
    const metadataPath = join(userDataPath, 'update-state', acceptedBuildMetadataFileName);
    const registryBefore = readFileSync(registryPath);
    const metadataBefore = readFileSync(metadataPath);
    symlinkSync(join(other, 'child'), linked, process.platform === 'win32' ? 'junction' : 'dir');
    const ambiguousPath = `${linked}${sep}..${sep}profile`;
    await expect(prepareElectronSelectorProfile({ runRoot, userDataPath: ambiguousPath, state: 'empty' }, syntheticEnvironment))
      .rejects.toThrow('ROOT_INVALID');
    expect(readFileSync(registryPath)).toEqual(registryBefore);
    expect(readFileSync(metadataPath)).toEqual(metadataBefore);
    expect(readdirSync(join(other, 'profile'))).toEqual([]);
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test('SYS-SELECTOR-FIXTURE-002 @security rejects outside, linked and nonempty profiles before writing', async () => {
  const runRoot = createE2eRunRoot();
  const outside = mkdtempSync(join(tmpdir(), 'eky-selector-negative-'));
  const userDataPath = join(runRoot, 'profile');
  mkdirSync(userDataPath);
  const linked = join(runRoot, 'linked-profile');
  try {
    await expect(prepareElectronSelectorProfile({ runRoot, userDataPath, state: 'empty' }, {})).rejects.toThrow('FIXTURE_INVALID');
    expect(readdirSync(userDataPath)).toEqual([]);
    await expect(prepareElectronSelectorProfile({ runRoot, userDataPath: outside, state: 'empty' }, syntheticEnvironment)).rejects.toThrow('ROOT_INVALID');
    symlinkSync(userDataPath, linked, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(prepareElectronSelectorProfile({ runRoot, userDataPath: linked, state: 'empty' }, syntheticEnvironment)).rejects.toThrow('ROOT_INVALID');
    expect(readdirSync(userDataPath)).toEqual([]);
    writeFileSync(join(userDataPath, 'retained.txt'), 'retain');
    await expect(prepareElectronSelectorProfile({ runRoot, userDataPath, state: 'ready' }, syntheticEnvironment)).rejects.toThrow('ALREADY_EXISTS');
    expect(readdirSync(userDataPath)).toEqual(['retained.txt']);
    expect(readdirSync(outside)).toEqual([]);
  } finally {
    rmSync(linked, { force: true });
    rmSync(runRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
