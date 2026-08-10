import { createHash } from 'node:crypto';
import { lstat, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectPackageArtifactInventory } from '../../scripts/package-artifact-inventory.mjs';
import {
  createInstallerComponentCode,
  createInstallerRegistryValueName,
  INSTALLER_REGISTRY_ROOT,
} from '../installerIdentity.mjs';

const installerDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultOutputPath = join(installerDirectory, 'wix', 'GeneratedPayload.wxs');
const requiredPayloadPaths = Object.freeze([
  'Eky.exe',
  'resources/app.asar',
  'resources/backend/dist/index.js',
]);

export async function generateInstallerPayload({
  outputPath = defaultOutputPath,
  payloadRoot,
}) {
  const resolvedPayloadRoot = resolve(payloadRoot);
  const inventory = await inspectPackageArtifactInventory({
    root: resolvedPayloadRoot,
    stage: 'packagedApp',
  });
  const files = await listPayloadFiles(resolvedPayloadRoot);
  assertRequiredPayload(files);
  const xml = renderPayloadWxs(files);
  await writeFile(outputPath, xml, 'utf8');
  return Object.freeze({ inventory, outputPath, payloadFileCount: files.length });
}

export function renderPayloadWxs(files) {
  const tree = createDirectoryTree(files);
  const components = files.map((file) => createPayloadComponent(file));
  const directoryComponents = [
    createDirectoryComponent('install-parent'),
    createDirectoryComponent('install-root'),
    ...listDirectoryNodes(tree).map(({ logicalPath }) =>
      createDirectoryComponent(`payload/${logicalPath}`),
    ),
    createDirectoryComponent('start-menu'),
  ];
  const componentByPath = new Map(
    components.map((component) => [component.logicalPath, component]),
  );
  const directoryComponentByPath = new Map(
    directoryComponents.map((component) => [component.logicalPath, component]),
  );

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs" RequiredVersion="7.0.0">',
    '  <Fragment>',
    '    <DirectoryRef Id="EkyProgramsDirectory">',
    ...renderDirectoryComponent(
      directoryComponentByPath.get('install-parent'),
      3,
    ),
    '    </DirectoryRef>',
    '  </Fragment>',
    '  <Fragment>',
    '    <DirectoryRef Id="EkyInstallFolder">',
    ...renderDirectoryComponent(
      directoryComponentByPath.get('install-root'),
      3,
    ),
    ...renderDirectoryChildren(
      tree,
      componentByPath,
      directoryComponentByPath,
      3,
    ),
    '    </DirectoryRef>',
    '  </Fragment>',
    '  <Fragment>',
    '    <DirectoryRef Id="ApplicationProgramsFolder">',
    ...renderDirectoryComponent(
      directoryComponentByPath.get('start-menu'),
      3,
    ),
    '    </DirectoryRef>',
    '  </Fragment>',
    '  <Fragment>',
    '    <ComponentGroup Id="EkyPayloadComponents">',
    ...components.map(
      ({ componentId }) => `      <ComponentRef Id="${componentId}" />`,
    ),
    ...directoryComponents.map(
      ({ componentId }) => `      <ComponentRef Id="${componentId}" />`,
    ),
    '    </ComponentGroup>',
    '  </Fragment>',
    '</Wix>',
    '',
  ].join('\n');
}

async function listPayloadFiles(root) {
  const files = [];
  const seenCaseInsensitivePaths = new Set();

  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) {
        throw new Error('INSTALLER_PAYLOAD_SYMLINK_FORBIDDEN');
      }
      if (metadata.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!metadata.isFile()) {
        throw new Error('INSTALLER_PAYLOAD_FILE_TYPE_FORBIDDEN');
      }
      const logicalPath = relative(root, path).split(sep).join('/');
      if (logicalPath.includes('$(')) {
        throw new Error('INSTALLER_PAYLOAD_PATH_INVALID');
      }
      const comparisonPath = logicalPath.toLowerCase();
      if (seenCaseInsensitivePaths.has(comparisonPath)) {
        throw new Error('INSTALLER_PAYLOAD_CASE_COLLISION');
      }
      seenCaseInsensitivePaths.add(comparisonPath);
      files.push(Object.freeze({ logicalPath }));
    }
  };

  await visit(root);
  return files;
}

function assertRequiredPayload(files) {
  const paths = new Set(files.map(({ logicalPath }) => logicalPath));
  if (requiredPayloadPaths.some((path) => !paths.has(path))) {
    throw new Error('INSTALLER_PAYLOAD_REQUIRED_FILE_MISSING');
  }
}

function createDirectoryTree(files) {
  const root = { directories: new Map(), files: [] };
  for (const file of files) {
    const segments = file.logicalPath.split('/');
    const fileName = segments.pop();
    let node = root;
    let logicalDirectory = '';
    for (const segment of segments) {
      logicalDirectory = logicalDirectory === '' ? segment : `${logicalDirectory}/${segment}`;
      if (!node.directories.has(segment)) {
        node.directories.set(segment, {
          directories: new Map(),
          files: [],
          logicalPath: logicalDirectory,
          name: segment,
        });
      }
      node = node.directories.get(segment);
    }
    node.files.push({ ...file, fileName });
  }
  return root;
}

function createPayloadComponent(file) {
  const suffix = stableIdentifier(file.logicalPath);
  return Object.freeze({
    componentGuid: createInstallerComponentCode(file.logicalPath),
    componentId: `Cmp_${suffix}`,
    fileId: `Fil_${suffix}`,
    logicalPath: file.logicalPath,
    registryValueName: createInstallerRegistryValueName(file.logicalPath),
  });
}

function createDirectoryComponent(logicalPath) {
  const identity = `installer-directory/${logicalPath}`;
  const suffix = stableIdentifier(identity);
  return Object.freeze({
    componentGuid: createInstallerComponentCode(identity),
    componentId: `DirCmp_${suffix}`,
    logicalPath,
    registryValueName: createInstallerRegistryValueName(identity),
    removeFolderId: `RmDir_${suffix}`,
  });
}

function listDirectoryNodes(node) {
  const directories = [];
  for (const directory of node.directories.values()) {
    directories.push(directory, ...listDirectoryNodes(directory));
  }
  return directories;
}

function renderDirectoryChildren(
  node,
  componentByPath,
  directoryComponentByPath,
  depth,
) {
  const indent = '  '.repeat(depth);
  const lines = [];
  for (const file of node.files) {
    lines.push(...renderFileComponent(file, componentByPath.get(file.logicalPath), depth));
  }
  for (const directory of node.directories.values()) {
    lines.push(
      `${indent}<Directory Id="Dir_${stableIdentifier(directory.logicalPath)}" Name="${escapeXml(directory.name)}">`,
      ...renderDirectoryComponent(
        directoryComponentByPath.get(`payload/${directory.logicalPath}`),
        depth + 1,
      ),
      ...renderDirectoryChildren(
        directory,
        componentByPath,
        directoryComponentByPath,
        depth + 1,
      ),
      `${indent}</Directory>`,
    );
  }
  return lines;
}

function renderFileComponent(file, component, depth) {
  const indent = '  '.repeat(depth);
  const sourcePath = file.logicalPath.replaceAll('/', '\\');
  const lines = [
    `${indent}<Component Id="${component.componentId}" Guid="${component.componentGuid}" Bitness="always64">`,
    `${indent}  <File Id="${component.fileId}" Source="$(EkyPayloadRoot)\\${escapeXml(sourcePath)}">`,
  ];
  if (file.logicalPath === 'Eky.exe') {
    lines.push(
      `${indent}    <Shortcut Id="EkyStartMenuShortcut" Directory="ApplicationProgramsFolder" Name="Eky" Description="Eky" WorkingDirectory="EkyInstallFolder" />`,
    );
  }
  lines.push(
    `${indent}  </File>`,
    `${indent}  <RegistryValue Root="HKCU" Key="${escapeXml(INSTALLER_REGISTRY_ROOT)}\\Components" Name="${component.registryValueName}" Type="integer" Value="1" KeyPath="yes" />`,
  );
  lines.push(`${indent}</Component>`);
  return lines;
}

function renderDirectoryComponent(component, depth) {
  const indent = '  '.repeat(depth);
  return [
    `${indent}<Component Id="${component.componentId}" Guid="${component.componentGuid}" Bitness="always64">`,
    `${indent}  <RemoveFolder Id="${component.removeFolderId}" On="uninstall" />`,
    `${indent}  <RegistryValue Root="HKCU" Key="${escapeXml(INSTALLER_REGISTRY_ROOT)}\\Directories" Name="${component.registryValueName}" Type="integer" Value="1" KeyPath="yes" />`,
    `${indent}</Component>`,
  ];
}

function stableIdentifier(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 24);
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
