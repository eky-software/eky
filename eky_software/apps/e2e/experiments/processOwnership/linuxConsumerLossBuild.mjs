import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire, isBuiltin } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';

const rootRequire = createRequire(new URL('../../../../package.json', import.meta.url));
const ts = rootRequire('typescript');
const configName = 'experiments/processOwnership/tsconfig.linux-consumer-loss.json';
const outputName = '.artifacts/linux-consumer-loss';
const failure = 'E2E_LINUX_CONSUMER_BUILD_REJECTED';
const maximumFiles = 128;
const maximumFileBytes = 1024 * 1024;
const hash = value => createHash('sha256').update(value).digest('hex');
const requireBuild = condition => { if (!condition) throw new Error(failure); };
const portable = value => value.split(sep).join('/');

export function linuxConsumerLossBuildPaths(repositoryRoot) {
  const root = resolve(repositoryRoot, 'apps/e2e');
  return Object.freeze({ root, config: join(root, configName), output: join(root, outputName) });
}

function readBounded(path) {
  const stat = lstatSync(path);
  requireBuild(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximumFileBytes);
  return readFileSync(path);
}

function checkAncestors(root, path) {
  const parts = relative(root, path).split(sep);
  requireBuild(parts.length > 0 && parts.every(part => part !== '..' && part !== ''));
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    if (!existsSync(current)) break;
    requireBuild(lstatSync(current).isDirectory() && !lstatSync(current).isSymbolicLink());
  }
}

function readInputs(repositoryRoot) {
  const paths = linuxConsumerLossBuildPaths(repositoryRoot);
  const configBytes = readBounded(paths.config);
  const config = ts.parseConfigFileTextToJson(paths.config, configBytes.toString('utf8'));
  requireBuild(!config.error);
  const raw = config.config;
  requireBuild(Object.keys(raw).sort().join(',') === 'compilerOptions,extends,files,include' &&
    raw.extends === '../../tsconfig.json' && Array.isArray(raw.include) && raw.include.length === 0 &&
    Array.isArray(raw.files) && raw.files.length > 0 && raw.files.length <= maximumFiles);
  const parent = JSON.parse(readBounded(join(paths.root, 'tsconfig.json')));
  const base = JSON.parse(readBounded(resolve(repositoryRoot, 'tsconfig.base.json')));
  requireBuild(parent.extends === '../../tsconfig.base.json' && base.extends === undefined &&
    JSON.parse(readBounded(join(paths.root, 'package.json'))).type === 'module');
  const parsed = ts.parseJsonConfigFileContent(raw, ts.sys, dirname(paths.config));
  requireBuild(parsed.errors.length === 0);
  const options = parsed.options;
  requireBuild(options.rootDir === paths.root.replaceAll('\\', '/') &&
    options.outDir === paths.output.replaceAll('\\', '/') &&
    options.module === ts.ModuleKind.ESNext && options.target === ts.ScriptTarget.ES2022 &&
    options.noEmit === false && options.noEmitOnError === true && options.noResolve === true &&
    options.noCheck === true && options.isolatedModules === true && options.allowJs === true &&
    options.checkJs === false && options.declaration === false && options.declarationMap === false &&
    options.sourceMap === false && options.inlineSourceMap === false && options.incremental === false &&
    options.composite === false && options.emitDeclarationOnly !== true && options.outFile === undefined &&
    options.paths === undefined && options.rootDirs === undefined && options.plugins === undefined &&
    options.types?.length === 0);
  const files = raw.files.map(name => {
    requireBuild(typeof name === 'string' && !name.includes('\\'));
    const path = resolve(dirname(paths.config), name);
    const source = portable(relative(paths.root, path));
    requireBuild(/^(?:playwright\.config\.ts|(?:src|scripts|experiments)\/[A-Za-z0-9_./-]+\.(?:ts|mjs))$/u.test(source) &&
      !source.split('/').includes('..') && !source.endsWith('.d.ts') && !source.includes('.test.'));
    checkAncestors(paths.root, path);
    return { source, output: source.replace(/\.ts$/u, '.js'), identity: hash(readBounded(path)) };
  }).sort((a, b) => a.source.localeCompare(b.source));
  requireBuild(new Set(files.map(file => file.output)).size === files.length &&
    parsed.fileNames.length === files.length);
  const configuration = ['tsconfig.base.json', 'apps/e2e/tsconfig.json', 'apps/e2e/package.json']
    .map(name => [name, hash(readBounded(resolve(repositoryRoot, name)))]);
  const compiler = ['typescript/package.json', 'typescript/lib/typescript.js',
    'typescript/lib/tsc.js', 'typescript/lib/_tsc.js']
    .map(name => [name, hash(readFileSync(rootRequire.resolve(name)))]);
  return { paths, files, sourceIdentity: hash(JSON.stringify({
    config: hash(configBytes), configuration, compiler, files,
  })) };
}

function inspectOutputs(inputs) {
  const { paths, files } = inputs;
  checkAncestors(paths.root, join(paths.output, 'entry.js'));
  requireBuild(lstatSync(paths.output).isDirectory() && !lstatSync(paths.output).isSymbolicLink());
  const expected = new Set(files.map(file => file.output));
  const directories = new Set();
  for (const file of expected) {
    let directory = portable(dirname(file));
    while (directory !== '.') {
      directories.add(directory);
      directory = portable(dirname(directory));
    }
  }
  const found = [];
  const visit = directory => {
    for (const entry of readdirSync(join(paths.output, directory), { withFileTypes: true })) {
      const name = directory ? `${directory}/${entry.name}` : entry.name;
      requireBuild(!entry.isSymbolicLink());
      if (entry.isDirectory()) {
        requireBuild(directories.has(name));
        visit(name);
      } else {
        requireBuild(entry.isFile() && expected.has(name));
        const bytes = readBounded(join(paths.output, name));
        inspectImports(name, bytes.toString('utf8'), paths.output, expected);
        found.push([name, hash(bytes)]);
      }
    }
  };
  visit('');
  requireBuild(found.length === expected.size);
  return hash(JSON.stringify(found.sort(([a], [b]) => a.localeCompare(b))));
}

function inspectImports(name, source, output, expected) {
  const path = join(output, name);
  const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  requireBuild(ast.parseDiagnostics.length === 0);
  const check = specifier => {
    requireBuild(specifier && ts.isStringLiteral(specifier));
    const id = specifier.text;
    if (id.startsWith('./') || id.startsWith('../')) {
      const target = portable(relative(output, resolve(dirname(path), id)));
      requireBuild(!id.includes('\\') && expected.has(target) && /\.(?:js|mjs)$/u.test(id));
      requireBuild(createRequire(path).resolve(id) === join(output, target));
    } else {
      requireBuild((id.startsWith('node:') && isBuiltin(id)) || id === '@playwright/test');
      createRequire(path).resolve(id);
    }
  };
  const visit = node => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) check(node.moduleSpecifier);
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        requireBuild(node.arguments.length === 1);
        check(node.arguments[0]);
      }
      // This is an ESM-only closure, not a CommonJS loader or bundler.
      requireBuild(!(ts.isIdentifier(node.expression) && node.expression.text === 'require'));
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
}

function guarded(task) {
  try { return task(); } catch { throw new Error(failure); }
}

// The caller owns a clean output directory and a successful, unchanged tsc -p invocation.
// These read-only guards neither build nor delete files, and never import consumer code.
export function captureLinuxConsumerLossBuildInputs(repositoryRoot) {
  return guarded(() => {
    const inputs = readInputs(repositoryRoot);
    checkAncestors(inputs.paths.root, join(inputs.paths.output, 'entry.js'));
    requireBuild(!existsSync(inputs.paths.output) || readdirSync(inputs.paths.output).length === 0);
    return Object.freeze({ sourceIdentity: inputs.sourceIdentity });
  });
}

export function verifyLinuxConsumerLossBuild(repositoryRoot, before) {
  return guarded(() => {
    const inputs = readInputs(repositoryRoot);
    requireBuild(before?.sourceIdentity === inputs.sourceIdentity);
    const outputIdentity = inspectOutputs(inputs);
    if (before.outputIdentity !== undefined) requireBuild(before.outputIdentity === outputIdentity);
    return Object.freeze({
      sourceIdentity: inputs.sourceIdentity, outputIdentity, fileCount: inputs.files.length,
    });
  });
}
