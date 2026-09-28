import { spawnSync } from 'node:child_process';
import * as filesystem from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  captureLinuxConsumerLossBuildInputs, linuxConsumerLossBuildPaths, verifyLinuxConsumerLossBuild,
} from './linuxConsumerLossBuild.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const rootRequire = createRequire(new URL('../../../../package.json', import.meta.url));
const ts = rootRequire('typescript');
const failure = 'E2E_LINUX_CONSUMER_BUILD_FAILED';
const requireBuild = condition => { if (!condition) throw new Error(failure); };
const sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino;

export function linuxConsumerLossBuildReceiptPath(root = repositoryRoot) {
  return `${linuxConsumerLossBuildPaths(root).output}.build.json`;
}

function existing(fs, path) {
  try { return fs.lstatSync(path); }
  catch (error) { if (error?.code === 'ENOENT') return undefined; throw error; }
}

function directory(fs, path) {
  const stat = fs.lstatSync(path);
  requireBuild(stat.isDirectory() && !stat.isSymbolicLink() && relative(fs.realpathSync(path), path) === '');
  return stat;
}

function inspectAncestors(fs, path) {
  const volume = parse(path).root;
  let current = volume;
  const identities = [[current, directory(fs, current)]];
  for (const part of relative(volume, path).split(sep).filter(Boolean)) {
    current = join(current, part);
    identities.push([current, directory(fs, current)]);
  }
  return () => {
    for (const [name, identity] of identities) requireBuild(sameIdentity(identity, directory(fs, name)));
  };
}

function projectBudget(fs, root) {
  const path = join(root, 'apps/e2e/playwright.config.ts');
  const stat = fs.lstatSync(path);
  requireBuild(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1024 * 1024);
  const source = fs.readFileSync(path, 'utf8');
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  requireBuild(ast.parseDiagnostics.length === 0);
  const exports = ast.statements.filter(ts.isExportAssignment);
  requireBuild(exports.length === 1 && !exports[0].isExportEquals);
  const call = exports[0].expression;
  requireBuild(ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === 'defineConfig' &&
    call.arguments.length === 1 && ts.isObjectLiteralExpression(call.arguments[0]));
  const properties = call.arguments[0].properties;
  requireBuild(properties.every(value => !ts.isSpreadAssignment(value) && value.name &&
    (ts.isIdentifier(value.name) || ts.isStringLiteral(value.name))));
  const entries = properties.filter(value => value.name.text === 'timeout');
  // Read this one canonical numeric setting; do not evaluate TypeScript or load a stale emitted config.
  requireBuild(entries.length === 1 && ts.isPropertyAssignment(entries[0]) && ts.isNumericLiteral(entries[0].initializer));
  const milliseconds = Number(entries[0].initializer.text);
  requireBuild(Number.isSafeInteger(milliseconds) && milliseconds > 0 && milliseconds <= 2_147_483_647);
  return { milliseconds, source, path };
}

function inspectOutput(fs, path, checkTime) {
  checkTime();
  const stat = fs.lstatSync(path);
  requireBuild(!stat.isSymbolicLink());
  if (!stat.isDirectory()) { requireBuild(stat.isFile()); return; }
  directory(fs, path);
  const entries = fs.opendirSync(path, { bufferSize: 1 });
  try {
    for (let entry; (entry = entries.readSync()) !== null;) inspectOutput(fs, join(path, entry.name), checkTime);
  } finally { entries.closeSync(); }
}

// Single-writer preparation only. The parent owns explicit invalidation of any prior receipt.
// A successful emit is not a typecheck; the canonical noEmit typecheck remains a separate gate.
export function buildLinuxConsumerLoss(root = repositoryRoot, {
  fs = filesystem, run = spawnSync, now = () => performance.now(), environment = process.env,
} = {}) {
  let receiptIdentity;
  let checkParents;
  let marker;
  try {
    requireBuild(typeof root === 'string' && isAbsolute(root));
    root = resolve(root);
    const paths = linuxConsumerLossBuildPaths(root);
    const checkRepository = inspectAncestors(fs, paths.root);
    const budget = projectBudget(fs, root);
    let previous = now();
    requireBuild(Number.isFinite(previous));
    const until = previous + budget.milliseconds;
    const remaining = () => {
      const current = now();
      requireBuild(Number.isFinite(current) && current >= previous && current < until);
      previous = current;
      const value = Math.floor(until - current);
      requireBuild(value > 0);
      return value;
    };
    const artifacts = dirname(paths.output);
    checkRepository();
    if (!existing(fs, artifacts)) fs.mkdirSync(artifacts);
    checkParents = inspectAncestors(fs, artifacts);
    marker = linuxConsumerLossBuildReceiptPath(root);
    requireBuild(existing(fs, marker) === undefined);
    const output = existing(fs, paths.output);
    if (output) {
      requireBuild(output.isDirectory() && !output.isSymbolicLink());
      inspectOutput(fs, paths.output, remaining);
      checkParents();
      requireBuild(sameIdentity(output, directory(fs, paths.output)));
      fs.rmSync(paths.output, { recursive: true, force: false, maxRetries: 0 });
    }
    checkParents(); remaining();
    requireBuild(existing(fs, marker) === undefined);
    const before = captureLinuxConsumerLossBuildInputs(root);
    requireBuild(fs.readFileSync(budget.path, 'utf8') === budget.source);
    const env = Object.fromEntries(Object.entries(environment)
      .filter(([key]) => !['NODE_OPTIONS', 'NODE_PATH'].includes(key.toUpperCase())));
    const result = run(process.execPath, [rootRequire.resolve('typescript/lib/tsc.js'), '-p', paths.config], {
      cwd: root, env, shell: false, windowsHide: true, stdio: 'ignore',
      timeout: remaining(), killSignal: 'SIGKILL',
    });
    requireBuild(result && result.error === undefined && result.status === 0 && result.signal === null);
    remaining(); checkParents();
    const verified = verifyLinuxConsumerLossBuild(root, before);
    const receipt = Object.freeze({ ...verified });
    const bytes = JSON.stringify(receipt) + '\n';
    remaining(); checkParents();
    const fd = fs.openSync(marker, 'wx', 0o600);
    try {
      receiptIdentity = fs.fstatSync(fd);
      requireBuild(receiptIdentity.isFile() && receiptIdentity.nlink === 1 && receiptIdentity.size === 0);
      fs.writeFileSync(fd, bytes);
      const written = fs.fstatSync(fd);
      requireBuild(sameIdentity(written, receiptIdentity) && written.nlink === 1 && written.size === Buffer.byteLength(bytes));
    } finally { fs.closeSync(fd); }
    remaining(); checkParents();
    const published = fs.lstatSync(marker);
    requireBuild(published.isFile() && !published.isSymbolicLink() && published.nlink === 1 &&
      sameIdentity(published, receiptIdentity) && fs.readFileSync(marker, 'utf8') === bytes);
    verifyLinuxConsumerLossBuild(root, receipt);
    remaining(); checkParents();
    return receipt;
  } catch {
    // Never remove someone else's receipt, or follow a changed ancestor during failed publication.
    if (receiptIdentity) {
      try {
        checkParents();
        const current = existing(fs, marker);
        if (current?.isFile() && !current.isSymbolicLink() && sameIdentity(current, receiptIdentity)) fs.unlinkSync(marker);
      } catch { /* A path whose ownership cannot be revalidated is retained. */ }
    }
    throw new Error(failure);
  }
}

export function runLinuxConsumerLossBuildCli(args = process.argv.slice(2), {
  build = buildLinuxConsumerLoss, writeError = value => process.stderr.write(value),
} = {}) {
  try {
    requireBuild(Array.isArray(args) && args.length === 0);
    build();
    return 0;
  } catch {
    try { writeError(failure + '\n'); } catch { /* Reporting cannot expose the original failure. */ }
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runLinuxConsumerLossBuildCli();
}
