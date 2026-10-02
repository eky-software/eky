import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTALLER_UPGRADE_CODE } from '../../installerIdentity.mjs';
import { createNativeProductInspectionCommand } from '../nativeMsiAdapterCommand.mjs';
import { runInstallerProductCommand } from '../installerProductOperationWorker.mjs';
import { validateInstallerProductStateResult } from '../cleanInstallUninstallWindowsRuntime.mjs';
import { parseStrictJsonObjectBytes } from '../strictJsonObject.mjs';
import { MSI_POLICY_VARIANTS, msiPolicyErrorCode, verifyMsiPolicyUiLog } from './msiFileVersionPolicyLifecycle.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const SHA256 = /^[0-9a-f]{64}$/;
const GUID = /^\{[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}\}$/;
const FILES = ['older.dll', 'equal.dll', 'newer.dll'];
export const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
const exactKeys = (value, keys) => value && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');

function decodeMsiLog(bytes) {
  return bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
}

export async function readPolicyBytes(path, limit = 64 * 1024) {
  const metadata = await lstat(path, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n ||
      metadata.size > BigInt(limit) || (await realpath(path)).toLowerCase() !== resolve(path).toLowerCase()) {
    throw new Error('msiPolicyFileInvalid');
  }
  const bytes = await readFile(path);
  const after = await lstat(path, { bigint: true });
  if (bytes.length > limit || ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'nlink']
    .some(key => metadata[key] !== after[key])) throw new Error('msiPolicyFileChanged');
  return bytes;
}

export function validateMsiPolicyDescriptor(value, descriptorPath, localAppData) {
  if (!exactKeys(value, ['schemaVersion', 'root', 'runNonce', 'productName', 'upgradeCode',
    'installRoot', 'registryKey', 'source', 'target', 'files']) ||
      value.schemaVersion !== 1 || !SHA256.test(value.runNonce) || !isAbsolute(descriptorPath) ||
      !isAbsolute(localAppData) || value.root !== dirname(descriptorPath) ||
      value.productName !== 'Eky MSI Policy Probe' || !GUID.test(value.upgradeCode) ||
      value.upgradeCode === `{${INSTALLER_UPGRADE_CODE}}` ||
      value.installRoot !== resolve(localAppData, `EkyMsiPolicy-${value.runNonce}`) ||
      value.registryKey !== `Software\\EkyMsiPolicy\\${value.runNonce}` ||
      !Array.isArray(value.files) || value.files.length !== 3) throw new Error('msiPolicyDescriptorInvalid');
  for (const [index, role] of ['source', 'target'].entries()) {
    const item = value[role];
    if (!exactKeys(item, ['productCode', 'version', 'installerSha256', 'installerPath', 'payloadRoot']) ||
        !GUID.test(item.productCode) || item.productCode === value.upgradeCode ||
        item.version !== `1.0.${index}` || !SHA256.test(item.installerSha256) ||
        item.installerPath !== resolve(value.root, role, 'policy.msi') ||
        item.payloadRoot !== resolve(value.root, role, 'payload')) throw new Error('msiPolicyDescriptorInvalid');
  }
  if (value.source.productCode === value.target.productCode) throw new Error('msiPolicyDescriptorInvalid');
  for (const [index, name] of FILES.entries()) {
    const file = value.files[index];
    if (!exactKeys(file, ['name', 'sourceVersion', 'targetVersion', 'sourceSha256', 'targetSha256']) ||
        file.name !== name || file.sourceVersion !== `${index + 1}.0.0.0` ||
        file.targetVersion !== '2.0.0.0' || !SHA256.test(file.sourceSha256) ||
        !SHA256.test(file.targetSha256) || file.sourceSha256 === file.targetSha256) {
      throw new Error('msiPolicyDescriptorInvalid');
    }
  }
  return value;
}

export async function readMsiPolicyDescriptor(path, expectedHash) {
  const bytes = await readPolicyBytes(path);
  if (!SHA256.test(expectedHash) || hashBytes(bytes) !== expectedHash) throw new Error('msiPolicyDescriptorChanged');
  return validateMsiPolicyDescriptor(parseStrictJsonObjectBytes(bytes,
    { maximumBytes: 64 * 1024, errorCode: 'msiPolicyDescriptorInvalid' }), path, process.env.LOCALAPPDATA ?? '');
}

export async function verifyMsiPolicyFixture(value) {
  for (const role of ['source', 'target']) {
    if (hashBytes(await readPolicyBytes(value[role].installerPath, 16 * 1024 * 1024)) !== value[role].installerSha256) {
      throw new Error('msiPolicyInstallerChanged');
    }
    for (const file of value.files) {
      if (hashBytes(await readPolicyBytes(resolve(value[role].payloadRoot, file.name))) !== file[role + 'Sha256']) {
        throw new Error('msiPolicyPayloadChanged');
      }
    }
  }
}

export function msiPolicyExpectedRole(name, variant) {
  if (!FILES.includes(name) || !MSI_POLICY_VARIANTS.includes(variant)) throw new Error('msiPolicyVariantInvalid');
  return name === 'newer.dll' || (name === 'equal.dll' && variant === 'uiOverride') ? 'source' : 'target';
}

// Every invocation here runs inside the existing native Job supervisor. This
// fixture adds no timers, process-tree owner, application start or payload bypass.
export function createMsiPolicyRuntime(value, descriptorPath, evidenceRoot) {
  let sequence = 0;
  let targetLog;
  const unique = suffix => resolve(evidenceRoot, `${++sequence}-${suffix}`);
  const execute = runInstallerProductCommand;
  const msi = resolve(process.env.SystemRoot, 'System32', 'msiexec.exe');
  const powershell = resolve(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

  async function inspectFiles(mode) {
    const output = unique('files.json');
    try {
      await execute(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
        resolve(DIRECTORY, 'inspectMsiFileVersionPolicy.ps1'), '-Mode', mode,
        '-DescriptorPath', descriptorPath, '-OutputPath', output], evidenceRoot);
    } catch (error) {
      let failure;
      try { failure = parseStrictJsonObjectBytes(await readPolicyBytes(output),
        { maximumBytes: 64 * 1024, errorCode: 'msiPolicyStateInvalid' }); } catch { /* Keep the command failure. */ }
      if (exactKeys(failure, ['schemaVersion', 'errorCode']) && failure.schemaVersion === 1) {
        throw new Error(msiPolicyErrorCode({ message: failure.errorCode }));
      }
      throw error;
    }
    return parseStrictJsonObjectBytes(await readPolicyBytes(output),
      { maximumBytes: 64 * 1024, errorCode: 'msiPolicyStateInvalid' });
  }

  async function inspectProduct(role) {
    const output = unique('product.json');
    const command = createNativeProductInspectionCommand(value[role].productCode, output);
    await execute(command.command, command.arguments, evidenceRoot);
    return validateInstallerProductStateResult(parseStrictJsonObjectBytes(await readPolicyBytes(output),
      { maximumBytes: 64 * 1024, errorCode: 'msiPolicyStateInvalid' }));
  }

  function expectProduct(state, role, installed) {
    if (installed ? state.productState !== 5 || state.productName !== value.productName ||
        state.productVersion !== value[role].version || !state.localPackagePresent
      : state.productState !== -1 || state.localPackagePresent || state.productName !== null || state.productVersion !== null) {
      throw new Error('msiPolicyProductStateInvalid');
    }
    // Real EKY registry/process observations are intentionally not fixture evidence.
  }

  async function compareFiles(expectedRole) {
    const state = await inspectFiles('Installed');
    if (state.schemaVersion !== 1 || state.registryPresent !== true || !state.versions ||
        Object.keys(state.versions).sort().join(',') !== [...FILES].sort().join(',')) {
      throw new Error('msiPolicyStateInvalid');
    }
    for (const file of value.files) {
      const role = expectedRole(file.name);
      if (state.versions[file.name] !== file[role + 'Version'] ||
          hashBytes(await readPolicyBytes(resolve(value.installRoot, file.name))) !== file[role + 'Sha256']) {
        throw new Error('msiPolicyInstalledFileMismatch');
      }
    }
  }

  return {
    async metadata() {
      await verifyMsiPolicyFixture(value);
      const result = await inspectFiles('Metadata');
      if (Object.keys(result).sort().join(',') !== 'metadataVerified,schemaVersion' ||
          result.schemaVersion !== 1 || result.metadataVerified !== true) throw new Error('msiPolicyMetadataInvalid');
    },
    async verifyAbsent() {
      for (const role of ['source', 'target']) expectProduct(await inspectProduct(role), role, false);
      const state = await inspectFiles('Installed');
      if (state.schemaVersion !== 1 || state.registryPresent !== false || !state.versions ||
          Object.keys(state.versions).sort().join(',') !== [...FILES].sort().join(',') ||
          Object.values(state.versions).some(version => version !== null)) throw new Error('msiPolicyFootprintRemains');
      await lstat(value.installRoot).then(() => { throw new Error('msiPolicyDirectoryRemains'); },
        error => { if (error?.code !== 'ENOENT') throw error; });
    },
    async install(role, variant) {
      await verifyMsiPolicyFixture(value);
      const log = unique(`${role}.log`);
      const args = ['/i', value[role].installerPath, '/qr', '/norestart', '/l*v', log];
      if (role === 'target') {
        targetLog = log;
        if (variant === 'uiOverride') args.push('REINSTALLMODE=omus');
      }
      await execute(msi, args, evidenceRoot);
      if (role === 'source') verifyMsiPolicyUiLog(decodeMsiLog(await readPolicyBytes(log, 32 * 1024 * 1024)), 'uiDefault', value.source.productCode);
    },
    async verifySource() {
      expectProduct(await inspectProduct('source'), 'source', true);
      expectProduct(await inspectProduct('target'), 'target', false);
      await compareFiles(() => 'source');
    },
    async verifyPolicy(variant) {
      expectProduct(await inspectProduct('source'), 'source', false);
      expectProduct(await inspectProduct('target'), 'target', true);
      await compareFiles(name => msiPolicyExpectedRole(name, variant));
      verifyMsiPolicyUiLog(decodeMsiLog(await readPolicyBytes(targetLog, 32 * 1024 * 1024)), variant, value.target.productCode);
      await verifyMsiPolicyFixture(value);
    },
    async removeIfOwned(role) {
      const state = await inspectProduct(role);
      if (state.productState === -1) { expectProduct(state, role, false); return; }
      expectProduct(state, role, true);
      await execute(msi, ['/x', value[role].productCode, '/qn', '/norestart', '/l*v', unique('uninstall.log')], evidenceRoot);
    },
  };
}
