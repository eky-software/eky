import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  prepareMsiFileVersionPolicyFixture,
  readMsiFileVersionPolicyAuthoring,
} from './buildMsiFileVersionPolicyFixture.mjs';

const INSTALLER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPOSITORY_ROOT = resolve(INSTALLER_ROOT, '..', '..', '..');
const NONCE = 'ab'.repeat(32);
const GUID = /^\{[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}\}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'eky-msi-policy-unit-'));
  const root = join(directory, 'preparation');
  await mkdir(root);
  const environment = {
    SystemRoot: process.env.SystemRoot,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    EKY_DOTNET_EXE: process.env.EKY_DOTNET_EXE,
  };
  process.env.SystemRoot = join(directory, 'synthetic-windows');
  process.env.LOCALAPPDATA = join(directory, 'synthetic-app-data');
  process.env.EKY_DOTNET_EXE = join(directory, 'synthetic-dotnet.exe');
  t.after(async () => {
    for (const [name, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(directory, { recursive: true, force: true });
  });
  return { root, directory, runNonce: NONCE };
}

// Only model filesystem products of successful tools. Never spawn, compile or install.
function fakeExecutor({ before, after } = {}) {
  const calls = [];
  const execute = async (executable, args, options) => {
    const call = { executable, args, ...options };
    calls.push(call);
    const override = await before?.(call);
    if (override !== undefined) return override;
    if (basename(executable) === 'csc.exe') {
      const text = await readFile(args.at(-1), 'utf8');
      await writeFile(args.find(value => value.startsWith('/out:')).slice(5), `fake-dll\n${text}`, { flag: 'wx' });
    } else if (args[0] === 'build') {
      const output = args.find(value => value.startsWith('-p:OutputPath=')).slice('-p:OutputPath='.length);
      const text = await readFile(join(options.cwd, 'Package.wxs'), 'utf8');
      await writeFile(join(output, 'policy.msi'), `fake-msi\n${text}`, { flag: 'wx' });
    } else {
      assert.equal(args[0], 'restore');
    }
    await after?.(call);
    return 0;
  };
  return { calls, execute };
}

function closedError(expected) {
  return error => {
    assert.equal(error.message, expected);
    assert.equal(error.cause, undefined);
    return true;
  };
}

test('prepares independent synthetic MSI pairs through only the injected executor', async t => {
  const input = await fixture(t);
  const fake = fakeExecutor();
  const result = await prepareMsiFileVersionPolicyFixture({ ...input, execute: fake.execute });
  assert.deepEqual(Object.keys(result).sort(), [
    'files', 'installRoot', 'productName', 'registryKey', 'root', 'runNonce',
    'schemaVersion', 'source', 'target', 'upgradeCode',
  ]);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.root, input.root);
  assert.equal(result.runNonce, NONCE);
  assert.equal(result.productName, 'Eky MSI Policy Probe');
  assert.equal(result.installRoot, join(process.env.LOCALAPPDATA, `EkyMsiPolicy-${NONCE}`));
  assert.equal(result.registryKey, `Software\\EkyMsiPolicy\\${NONCE}`);
  assert.deepEqual(result.files.map(({ name, sourceVersion, targetVersion }) => [name, sourceVersion, targetVersion]), [
    ['older.dll', '1.0.0.0', '2.0.0.0'], ['equal.dll', '2.0.0.0', '2.0.0.0'],
    ['newer.dll', '3.0.0.0', '2.0.0.0'],
  ]);
  assert.equal(result.source.version, '1.0.0');
  assert.equal(result.target.version, '1.0.1');
  for (const code of [result.source.productCode, result.target.productCode, result.upgradeCode]) assert.match(code, GUID);
  assert.equal(new Set([result.source.productCode, result.target.productCode, result.upgradeCode]).size, 3);

  const compilations = fake.calls.filter(({ executable }) => basename(executable) === 'csc.exe');
  assert.equal(compilations.length, 4);
  const versions = [];
  const markers = [];
  for (const { executable, args, cwd } of compilations) {
    assert.equal(executable, join(process.env.SystemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'));
    assert.deepEqual(args.slice(0, 5), ['/nologo', '/target:library', '/platform:x64', '/optimize+', '/debug-']);
    assert.equal(args.length, 7);
    assert.equal(args[5], `/out:${join(cwd, 'Payload.dll')}`);
    assert.equal(args[6], join(cwd, 'Payload.cs'));
    const source = await readFile(args[6], 'utf8');
    assert.match(source, /AssemblyVersion\("1\.0\.0\.0"\)/);
    versions.push(source.match(/AssemblyFileVersion\("([\d.]+)"\)/)[1]);
    markers.push(source.match(/Marker = "([^"]+)"/)[1]);
    assert.doesNotMatch(source, /DllImport|Process|Main\(/);
  }
  assert.deepEqual(versions, ['1.0.0.0', '2.0.0.0', '3.0.0.0', '2.0.0.0']);
  assert.equal(new Set(markers).size, 4);
  assert.equal(fake.calls.length, 8);
  const production = await readFile(join(INSTALLER_ROOT, 'wix', 'Package.wxs'), 'utf8');
  const action = readMsiFileVersionPolicyAuthoring(production);
  const identities = [];
  for (const role of ['source', 'target']) {
    const descriptor = result[role];
    const directory = join(input.root, role);
    const project = await readFile(join(directory, 'Fixture.wixproj'), 'utf8');
    assert.equal(project, (await readFile(join(INSTALLER_ROOT, 'Eky.Installer.wixproj'), 'utf8'))
      .replace('<OutputName>Eky-$(EkyAppVersion)-x64</OutputName>', '<OutputName>policy</OutputName>')
      .replace(/\s*<DefineConstants>[^<]*<\/DefineConstants>/, ''));
    const xml = await readFile(join(directory, 'Package.wxs'), 'utf8');
    assert.ok(xml.includes(action));
    assert.ok(xml.includes(`ProductCode="${descriptor.productCode}" UpgradeCode="${result.upgradeCode}"`));
    assert.match(xml, /Language="1033"/);
    assert.match(xml, /Scope="perUser"/);
    assert.match(xml, /AllowDowngrades="no" AllowSameVersionUpgrades="no"/);
    assert.match(xml, /IgnoreRemoveFailure="no" Schedule="afterInstallExecute"/);
    assert.match(xml, /Directory Id="INSTALLFOLDER"/);
    assert.match(xml, /RemoveFolder Id="RemoveInstallFolder" Directory="INSTALLFOLDER" On="uninstall"/);
    assert.equal((xml.match(/<RemoveFolder\b/g) ?? []).length, 1);
    assert.doesNotMatch(xml, /<RemoveFolder[^>]*Directory="PolicyPrograms"/);
    assert.equal((xml.match(/<File\b/g) ?? []).length, 3);
    assert.equal((xml.match(/<RegistryValue\b/g) ?? []).length, 3);
    const components = [...xml.matchAll(/<Component Id="([^"]+)" Guid="([^"]+)" Bitness="always64">/g)];
    assert.equal(components.length, 3);
    identities.push(components.map(([, id, code]) => [id, code]));
    for (const [, id, code] of components) {
      assert.match(code, GUID);
      assert.ok(xml.includes(`Key="${result.registryKey}" Name="${id}" Type="integer" Value="1" KeyPath="yes"`));
      assert.ok(xml.includes(`<File Id="File_${id}" Source="payload\\${id}.dll" Vital="yes" />`));
    }
    assert.doesNotMatch(xml, /CustomAction|REINSTALL=|ForceDowngrade|NeverOverwrite|Permanent=|Assembly=|<Property\b|Software\\Eky\\|Name="Eky"/);
    assert.equal(descriptor.payloadRoot, join(directory, 'payload'));
    assert.equal(descriptor.installerPath, join(directory, 'policy.msi'));
    assert.equal(descriptor.installerSha256, hash(await readFile(descriptor.installerPath)));
    assert.deepEqual(await readFile(join(directory, 'packages.lock.json')), await readFile(join(INSTALLER_ROOT, 'packages.lock.json')));
    const projectPath = join(directory, 'Fixture.wixproj');
    const commands = fake.calls.filter(call => call.cwd === directory);
    assert.deepEqual(commands.map(call => call.executable), [process.env.EKY_DOTNET_EXE, process.env.EKY_DOTNET_EXE]);
    assert.deepEqual(commands.map(call => call.args), [
      ['restore', projectPath, '--locked-mode', '--configfile', join(input.root, 'NuGet.Config'), `-flp:LogFile=${join(directory, 'restore.private.log')};Verbosity=minimal`, '--verbosity', 'minimal'],
      ['build', projectPath, '--no-restore', '--configuration', 'Release', `-p:OutputPath=${directory}${sep}`, '-p:DebugType=none', '--verbosity', 'minimal',
        '-p:CreateHardLinksForCopyFilesToOutputDirectoryIfPossible=false',
        '-p:CreateSymbolicLinksForCopyFilesToOutputDirectoryIfPossible=false',
        `-flp:LogFile=${join(directory, 'build.private.log')};Verbosity=minimal`],
    ]);
    for (const file of result.files) {
      const path = join(descriptor.payloadRoot, file.name);
      assert.equal(hash(await readFile(path)), file[`${role}Sha256`]);
      assert.equal((await lstat(path)).nlink, 1);
    }
  }
  assert.deepEqual(identities[0], identities[1]);
  assert.equal(new Set(identities[0].map(([, code]) => code)).size, 3);
  assert.ok(result.files.every(file => file.sourceSha256 !== file.targetSha256));
  assert.deepEqual(await readFile(join(input.root, 'NuGet.Config')), await readFile(join(INSTALLER_ROOT, 'NuGet.Config')));
  assert.deepEqual(await readFile(join(input.root, 'global.json')), await readFile(join(REPOSITORY_ROOT, 'global.json')));
  assert.ok(!(await readdir(input.root)).includes('descriptor.json'));
  await assert.rejects(lstat(result.installRoot), { code: 'ENOENT' });

  const secondRoot = join(input.directory, 'second');
  await mkdir(secondRoot);
  const second = await prepareMsiFileVersionPolicyFixture({ root: secondRoot, runNonce: 'cd'.repeat(32), execute: fakeExecutor().execute });
  const secondXml = await readFile(join(secondRoot, 'source', 'Package.wxs'), 'utf8');
  const secondGuids = new Set([...secondXml.matchAll(/(?:ProductCode|UpgradeCode|Guid)="([^"]+)"/g)].map(([, code]) => code));
  for (const code of [result.source.productCode, result.target.productCode, result.upgradeCode, ...identities[0].map(([, code]) => code)]) {
    assert.ok(!secondGuids.has(code));
  }
  assert.notEqual(second.installRoot, result.installRoot);
  assert.notEqual(second.registryKey, result.registryKey);
});

test('rejects production Type51 drift rather than silently authoring a different policy', async () => {
  const source = await readFile(join(INSTALLER_ROOT, 'wix', 'Package.wxs'), 'utf8');
  const action = readMsiFileVersionPolicyAuthoring(source);
  for (const changed of [
    source.replace('Value="emus"', 'Value="omus"'),
    source.replace('Sequence="both"', 'Sequence="execute"'),
    source.replace('Before="CostInitialize"', 'After="CostInitialize"'),
    source.replace('NOT Installed AND NOT REINSTALLMODE', 'NOT Installed'),
    source.replace('Action="EkySetReinstallMode"', 'Action="OtherAction"'),
    source.replace('Value="emus"', 'Value="emus" Overridable="yes"'),
    source.replace(action, ''), source.replace(action, action + action),
    source + '<Property Id="REINSTALLMODE" Value="emus" />',
    source + '<Property Id="REINSTALL" Value="ALL" />',
    source + '<CustomAction Id="Other" />', null,
  ]) assert.throws(() => readMsiFileVersionPolicyAuthoring(changed), closedError('msiPolicyAuthoringInvalid'));
  assert.equal(readMsiFileVersionPolicyAuthoring(source + `<!-- ${action} -->`), action);
});

test('invalid requests and nonempty or aliased roots never execute or delete anything', async t => {
  const input = await fixture(t);
  let called = false;
  const execute = async () => { called = true; return 0; };
  const occupied = join(input.directory, 'occupied');
  await mkdir(occupied);
  await writeFile(join(occupied, 'keep.txt'), 'keep');
  const alias = join(input.directory, 'alias');
  await symlink(input.root, alias, 'junction');
  for (const override of [
    { root: 'relative' }, { root: join(input.directory, 'missing') },
    { root: occupied }, { root: alias }, { runNonce: 'a'.repeat(63) },
    { runNonce: 'A'.repeat(64) }, { runNonce: '../unsafe' }, { runNonce: null }, { execute: null },
  ]) await assert.rejects(prepareMsiFileVersionPolicyFixture({ ...input, execute, ...override }), closedError('msiPolicyRequestInvalid'));
  await assert.rejects(prepareMsiFileVersionPolicyFixture(), closedError('msiPolicyRequestInvalid'));
  delete process.env.SystemRoot;
  await assert.rejects(prepareMsiFileVersionPolicyFixture({ ...input, execute }), closedError('msiPolicyRequestInvalid'));
  assert.equal(called, false);
  assert.deepEqual(await readdir(input.root), []);
  assert.equal(await readFile(join(occupied, 'keep.txt'), 'utf8'), 'keep');
});

test('compiler, restore and build failures are closed and partial preparation is retained', async t => {
  for (const [stage, expected] of [
    ['compile', 'msiPolicyCompileFailed'], ['restore', 'msiPolicyRestoreFailed'], ['build', 'msiPolicyBuildFailed'],
  ]) {
    for (const failure of ['exit', 'throw', 'invalidResult']) {
      await t.test(`${stage} ${failure}`, async child => {
        const input = await fixture(child);
        const fake = fakeExecutor({ before: ({ executable, args }) => {
          if ((stage === 'compile' && basename(executable) === 'csc.exe') || args[0] === stage) {
            if (failure === 'throw') throw new Error('private-tool-output-token');
            return failure === 'exit' ? 1 : { exitCode: 0 };
          }
        } });
        await assert.rejects(prepareMsiFileVersionPolicyFixture({ ...input, execute: fake.execute }), closedError(expected));
        assert.ok((await readdir(input.root)).includes('compiled'));
        assert.equal(fake.calls.filter(call => call.args[0] === 'build').length, stage === 'build' ? 1 : 0);
      });
    }
  }
});

test('rejects missing, empty and hardlinked compiler outputs or indistinguishable variants', async t => {
  for (const failure of ['missing', 'empty', 'hardlink', 'identical']) {
    await t.test(failure, async child => {
      const input = await fixture(child);
      const fake = fakeExecutor({ after: async ({ executable, args, cwd }) => {
        if (basename(executable) !== 'csc.exe') return;
        const output = args.find(arg => arg.startsWith('/out:')).slice(5);
        if (failure === 'missing') await rm(output);
        if (failure === 'empty') await writeFile(output, '');
        if (failure === 'hardlink') await link(output, join(cwd, 'alias.dll'));
        if (failure === 'identical') await writeFile(output, 'same-fake-bytes');
      } });
      await assert.rejects(prepareMsiFileVersionPolicyFixture({ ...input, execute: fake.execute }), closedError('msiPolicyPayloadInvalid'));
      assert.equal(fake.calls.filter(call => call.args[0] === 'restore').length, 0);
    });
  }
});

test('rejects missing installer artifacts and changed locked inputs or payloads', async t => {
  for (const failure of ['missingMsi', 'lockChanged', 'payloadChanged']) {
    await t.test(failure, async child => {
      const input = await fixture(child);
      const fake = fakeExecutor({ after: async ({ args, cwd }) => {
        if (args[0] !== 'build') return;
        if (failure === 'missingMsi') await rm(join(cwd, 'policy.msi'));
        if (failure === 'lockChanged') await writeFile(join(cwd, 'packages.lock.json'), '{}');
        if (failure === 'payloadChanged') await writeFile(join(cwd, 'payload', 'equal.dll'), 'changed');
      } });
      await assert.rejects(prepareMsiFileVersionPolicyFixture({ ...input, execute: fake.execute }),
        closedError(failure === 'missingMsi' ? 'msiPolicyOutputInvalid' : 'msiPolicyInputChanged'));
      assert.ok((await readdir(input.root)).includes('source'));
    });
  }
});
