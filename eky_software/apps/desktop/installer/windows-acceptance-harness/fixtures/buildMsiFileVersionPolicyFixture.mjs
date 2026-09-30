import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const INSTALLER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPOSITORY_ROOT = resolve(INSTALLER_ROOT, '..', '..', '..');
const CASES = Object.freeze([
  { name: 'older.dll', sourceVersion: '1.0.0.0' },
  { name: 'equal.dll', sourceVersion: '2.0.0.0' },
  { name: 'newer.dll', sourceVersion: '3.0.0.0' },
]);
const TARGET_FILE_VERSION = '2.0.0.0';
const PRODUCT_NAME = 'Eky MSI Policy Probe';
const guid = () => `{${randomUUID().toUpperCase()}}`;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Deliberately recognize only the approved authoring, not arbitrary WiX XML.
export function readMsiFileVersionPolicyAuthoring(packageSource) {
  if (typeof packageSource !== 'string') throw new Error('msiPolicyAuthoringInvalid');
  const source = packageSource.replace(/<!--[\s\S]*?-->/g, '');
  const actions = source.match(/<SetProperty\b[^>]*\/>/g) ?? [];
  if (actions.length !== 1 || (source.match(/<SetProperty\b/g) ?? []).length !== 1 ||
      !/^<SetProperty\s+Action="EkySetReinstallMode"\s+Id="REINSTALLMODE"\s+Value="emus"\s+Before="CostInitialize"\s+Sequence="both"\s+Condition="NOT Installed AND NOT REINSTALLMODE"\s*\/>$/.test(actions[0]) ||
      /<CustomAction\b/.test(source) ||
      (source.match(/\bId\s*=\s*["']REINSTALL(?:MODE)?["']/g) ?? []).length !== 1) {
    throw new Error('msiPolicyAuthoringInvalid');
  }
  return actions[0];
}

function fixtureProject(source) {
  // Preserve the owning project's SDK and validation settings byte-for-byte.
  const required = [
    '<Project Sdk="WixToolset.Sdk/7.0.0">',
    '<InstallerPlatform>x64</InstallerPlatform>', '<AcceptEula>wix7</AcceptEula>',
    '<OutputType>Package</OutputType>',
    '<RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>',
    '<RestoreLockedMode>true</RestoreLockedMode>', '<SuppressIces>ICE91</SuppressIces>',
    '<SuppressValidation>false</SuppressValidation>',
    '<TreatWarningsAsErrors>true</TreatWarningsAsErrors>',
    '<OutputName>Eky-$(EkyAppVersion)-x64</OutputName>',
  ];
  if (required.some(value => !source.includes(value)) ||
      (source.match(/<DefineConstants>/g) ?? []).length !== 1) {
    throw new Error('msiPolicyToolchainInvalid');
  }
  return source
    .replace('<OutputName>Eky-$(EkyAppVersion)-x64</OutputName>', '<OutputName>policy</OutputName>')
    .replace(/\s*<DefineConstants>[^<]*<\/DefineConstants>/, '');
}

function renderPackage({ productCode, version, upgradeCode, componentCodes, folderName, registryKey, action }) {
  return `<?xml version="1.0" encoding="utf-8"?>
<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs" RequiredVersion="7.0.0">
  <Package Name="${PRODUCT_NAME}" Manufacturer="Eky Test Fixture" Version="${version}"
    ProductCode="${productCode}" UpgradeCode="${upgradeCode}" Language="1033"
    Scope="perUser" InstallerVersion="500" Compressed="yes">
    ${action}
    <MajorUpgrade AllowDowngrades="no" AllowSameVersionUpgrades="no"
      DowngradeErrorMessage="A newer synthetic fixture is installed."
      IgnoreRemoveFailure="no" Schedule="afterInstallExecute" />
    <MediaTemplate EmbedCab="yes" CompressionLevel="high" />
    <StandardDirectory Id="LocalAppDataFolder">
      <Directory Id="INSTALLFOLDER" Name="${folderName}">
${CASES.map(({ name }) => {
    const id = name.replace('.dll', '');
    return `          <Component Id="${id}" Guid="${componentCodes[id]}" Bitness="always64">
            <File Id="File_${id}" Source="payload\\${name}" Vital="yes" />${id === 'older' ? `
            <RemoveFolder Id="RemoveInstallFolder" Directory="INSTALLFOLDER" On="uninstall" />` : ''}
            <RegistryValue Root="HKCU" Key="${registryKey}" Name="${id}" Type="integer" Value="1" KeyPath="yes" />
          </Component>`;
  }).join('\n')}
      </Directory>
    </StandardDirectory>
    <Feature Id="PolicyFiles" Title="Synthetic file policy" Level="1" AllowAbsent="no" AllowAdvertise="no">
${Object.keys(componentCodes).map(id => `      <ComponentRef Id="${id}" />`).join('\n')}
    </Feature>
  </Package>
</Wix>
`;
}

async function fileBytes(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size === 0) {
    throw new Error('msiPolicyOutputInvalid');
  }
  return readFile(path);
}

/** The parent owns the Job, bounded execution, evidence retention and eventual cleanup. */
export async function prepareMsiFileVersionPolicyFixture({ root, runNonce, execute } = {}) {
  let errorCode = 'msiPolicyRequestInvalid';
  try {
    if (typeof root !== 'string' || !isAbsolute(root) || typeof execute !== 'function' ||
        typeof runNonce !== 'string' || !/^[0-9a-f]{64}$/.test(runNonce)) throw new Error();
    root = resolve(root);
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() ||
        relative(root, await realpath(root)) !== '' || (await readdir(root)).length !== 0) throw new Error();
    const { SystemRoot: systemRoot, LOCALAPPDATA: localAppData } = process.env;
    if (!systemRoot || !isAbsolute(systemRoot) || !localAppData || !isAbsolute(localAppData)) throw new Error();
    const compiler = join(systemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    const dotnet = process.env.EKY_DOTNET_EXE ?? 'dotnet';
    const folderName = `EkyMsiPolicy-${runNonce}`;
    const registryKey = `Software\\EkyMsiPolicy\\${runNonce}`;

    errorCode = 'msiPolicyAuthoringInvalid';
    const action = readMsiFileVersionPolicyAuthoring(await readFile(join(INSTALLER_ROOT, 'wix', 'Package.wxs'), 'utf8'));
    errorCode = 'msiPolicyToolchainInvalid';
    const project = fixtureProject(await readFile(join(INSTALLER_ROOT, 'Eky.Installer.wixproj'), 'utf8'));
    const policyFiles = [
      ['global.json', await readFile(join(REPOSITORY_ROOT, 'global.json'))],
      ['NuGet.Config', await readFile(join(INSTALLER_ROOT, 'NuGet.Config'))],
    ];
    const lock = await readFile(join(INSTALLER_ROOT, 'packages.lock.json'));
    const pinnedInputs = [];
    const saveInput = async (path, bytes) => {
      await writeFile(path, bytes, { flag: 'wx' });
      pinnedInputs.push([path, sha256(bytes)]);
    };
    const invoke = async (executable, args, cwd, code) => {
      errorCode = code;
      if (await execute(executable, args, { cwd }) !== 0) throw new Error();
      errorCode = 'msiPolicyPreparationFailed';
    };

    errorCode = 'msiPolicyPreparationFailed';
    for (const [name, bytes] of policyFiles) await saveInput(join(root, name), bytes);
    const compiledRoot = join(root, 'compiled');
    await mkdir(compiledRoot);
    const variants = [...CASES.map(({ name, sourceVersion }) => ({
      id: name.replace('.dll', ''), version: sourceVersion,
    })), { id: 'target', version: TARGET_FILE_VERSION }];
    const payloads = new Map();
    for (const { id, version } of variants) {
      const directory = join(compiledRoot, id);
      await mkdir(directory);
      const sourcePath = join(directory, 'Payload.cs');
      const dllPath = join(directory, 'Payload.dll');
      await saveInput(sourcePath, `using System.Reflection;
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("${version}")]
public static class FileVersionPolicyPayload {
  public const string Marker = "synthetic-${id}";
}
`);
      await invoke(compiler, [
        '/nologo', '/target:library', '/platform:x64', '/optimize+', '/debug-',
        `/out:${dllPath}`, sourcePath,
      ], directory, 'msiPolicyCompileFailed');
      errorCode = 'msiPolicyPayloadInvalid';
      const hash = sha256(await fileBytes(dllPath));
      pinnedInputs.push([dllPath, hash]);
      payloads.set(id, { path: dllPath, hash });
      errorCode = 'msiPolicyPreparationFailed';
    }
    if (new Set([...payloads.values()].map(({ hash }) => hash)).size !== 4) {
      errorCode = 'msiPolicyPayloadInvalid';
      throw new Error();
    }

    const upgradeCode = guid();
    const componentCodes = Object.fromEntries(['older', 'equal', 'newer'].map(id => [id, guid()]));
    const packages = {};
    for (const [role, version] of [['source', '1.0.0'], ['target', '1.0.1']]) {
      const directory = join(root, role);
      const sourceDirectory = join(directory, 'payload');
      await mkdir(directory);
      await mkdir(sourceDirectory);
      const productCode = guid();
      await saveInput(join(directory, 'Fixture.wixproj'), project);
      await saveInput(join(directory, 'packages.lock.json'), lock);
      await saveInput(join(directory, 'Package.wxs'), renderPackage({
        productCode, version, upgradeCode, componentCodes, folderName, registryKey, action,
      }));
      for (const { name } of CASES) {
        const payload = payloads.get(role === 'target' ? 'target' : name.replace('.dll', ''));
        const destination = join(sourceDirectory, name);
        await copyFile(payload.path, destination, constants.COPYFILE_EXCL);
        pinnedInputs.push([destination, payload.hash]);
      }
      const projectPath = join(directory, 'Fixture.wixproj');
      await invoke(dotnet, [
        'restore', projectPath, '--locked-mode', '--configfile', join(root, 'NuGet.Config'),
        `-flp:LogFile=${join(directory, 'restore.private.log')};Verbosity=minimal`,
        '--verbosity', 'minimal',
      ], directory, 'msiPolicyRestoreFailed');
      await invoke(dotnet, [
        'build', projectPath, '--no-restore', '--configuration', 'Release',
        `-p:OutputPath=${directory}${sep}`, '-p:DebugType=none', '--verbosity', 'minimal',
        '-p:CreateHardLinksForCopyFilesToOutputDirectoryIfPossible=false',
        '-p:CreateSymbolicLinksForCopyFilesToOutputDirectoryIfPossible=false',
        `-flp:LogFile=${join(directory, 'build.private.log')};Verbosity=minimal`,
      ], directory, 'msiPolicyBuildFailed');
      errorCode = 'msiPolicyOutputInvalid';
      const installerPath = join(directory, 'policy.msi');
      const hash = sha256(await fileBytes(installerPath));
      pinnedInputs.push([installerPath, hash]);
      packages[role] = Object.freeze({
        productCode, installerPath, installerSha256: hash, payloadRoot: sourceDirectory, version,
      });
      errorCode = 'msiPolicyPreparationFailed';
    }
    // Restores/builds may not rewrite locked inputs or the prepared source bytes.
    errorCode = 'msiPolicyInputChanged';
    for (const [path, hash] of pinnedInputs) {
      if (sha256(await fileBytes(path)) !== hash) throw new Error();
    }
    return Object.freeze({
      schemaVersion: 1, root, runNonce, productName: PRODUCT_NAME, upgradeCode,
      installRoot: join(localAppData, folderName), registryKey,
      ...packages,
      files: Object.freeze(CASES.map(({ name, sourceVersion }) => Object.freeze({
        name, sourceVersion, targetVersion: TARGET_FILE_VERSION,
        sourceSha256: payloads.get(name.replace('.dll', '')).hash,
        targetSha256: payloads.get('target').hash,
      }))),
    });
  } catch {
    // No raw executor/filesystem errors escape, and failed preparation is retained.
    throw new Error(errorCode);
  }
}
