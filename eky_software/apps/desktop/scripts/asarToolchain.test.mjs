import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, posix, resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const asarEntry = require.resolve('@electron/asar');
const packagerEntry = require.resolve('@electron/packager');
const asarRequire = createRequire(asarEntry);
const { Minimatch } = asarRequire('minimatch');
const globEntry = asarRequire.resolve('glob');
const globManifestPath = asarRequire.resolve('glob/package.json');
const globManifest = JSON.parse(await readFile(globManifestPath, 'utf8'));
const globImplementations = [
  ['import', await import(new URL(globManifest.exports['.'].import.default,
    pathToFileURL(globManifestPath)).href)],
  ['require', asarRequire('glob')],
];
const asar = await import(pathToFileURL(asarEntry).href);
const { createAsarOpts } = await import(new URL('./common.js', pathToFileURL(packagerEntry)).href);

test('the real packager and direct ASAR reader use the same coordinated matching chain', () => {
  assert.equal(createRequire(packagerEntry).resolve('@electron/asar'), asarEntry);
  assert.equal(createRequire(globEntry).resolve('minimatch'), asarRequire.resolve('minimatch'));
  assert.deepEqual(createAsarOpts({ asar: true }), { unpack: '**/{.**,**}/**/*.node' });
});

test('optimized parent traversals obey the existing pattern expansion budget', () => {
  const matcher = new Minimatch('a/**/../b/**/../c/**/../d/**/../e/f', {
    optimizationLevel: 2,
    braceExpandMax: 2,
  });
  assert.ok(matcher.globParts.length <= 2);
  const ordinary = new Minimatch('**/*.js', { optimizationLevel: 2, braceExpandMax: 2 });
  assert.equal(ordinary.match('dist/main.js'), true);
  assert.equal(ordinary.match('dist/main.js.map'), false);
});

for (const [entry, { Glob }] of globImplementations) {
  test(`glob ${entry} enforces the expansion budget in the implementation ASAR actually loads`, () => {
    const traversal = new Glob('a/**/../b/**/../c/**/../d/**/../e/f', { braceExpandMax: 2 });
    assert.ok(traversal.patterns.length <= 2, 'An embedded matcher must honor the same expansion budget');
  });
}

for (const mode of ['packager', 'legacy']) {
  test(`real ${mode} ASAR preserves the exact members, contents and native placement`, async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'eky-asar-toolchain-'));
    let completed = false;
    context.after(async () => {
      if (completed) await rm(root, { recursive: true, force: true });
    });
    const source = join(root, 'application space \u00e4\u00f6');
    const archive = join(root, 'app.asar');
    context.after(() => asar.uncache(archive));
    const files = new Map([
      ['package.json', Buffer.from('{"name":"synthetic-app","main":"dist/main.js"}')],
      ['dist/main.js', Buffer.from('export const value = 1;')],
      ['dist/build-info.json', Buffer.from('{"schemaVersion":1}')],
      ['ui/assets/name with space \u00e4\u00f6.js', Buffer.from('synthetic web asset')],
      ['.hidden/config.json', Buffer.from('{"synthetic":true}')],
      ['node_modules/plain/addon.node', Buffer.from([0, 1, 2, 255])],
      ['node_modules/.pnpm/native/node_modules/native/addon.node', Buffer.from([255, 2, 1, 0])],
      ['node_modules/.pnpm/native/node_modules/native/addon.node.txt', Buffer.from('not native')],
    ]);
    const expectedMembers = new Set();
    for (const [name, bytes] of files) {
      await mkdir(dirname(join(source, name)), { recursive: true });
      await writeFile(join(source, name), bytes, { flag: 'wx' });
      let member = name;
      while (member !== '.') {
        expectedMembers.add(`/${member}`);
        member = posix.dirname(member);
      }
    }
    if (mode === 'packager') {
      await asar.createPackageWithOptions(source, archive, createAsarOpts({ asar: true }));
    } else {
      await asar.createPackage(source, archive);
    }
    assert.deepEqual(asar.listPackage(archive).map((name) => name.replaceAll('\\', '/')).sort(),
      [...expectedMembers].sort());
    for (const [name, expected] of files) {
      const member = normalize(name);
      const info = asar.statFile(archive, member);
      const unpacked = mode === 'packager' && name.endsWith('.node');
      assert.equal(info.size, expected.length);
      assert.equal(info.unpacked === true, unpacked, name);
      assert.ok(asar.extractFile(archive, member).equals(expected), name);
      if (unpacked) {
        assert.ok((await readFile(join(`${archive}.unpacked`, name))).equals(expected), name);
      } else {
        assert.equal(info.integrity.hash, createHash('sha256').update(expected).digest('hex'), name);
      }
    }
    completed = true;
  });
}

// Exercise the dependency's public cancellation boundary, not a claimed EKY user-input path.
for (const [entry, { glob, globStream }] of globImplementations) {
  for (const mode of ['promise', 'stream']) {
    test(`ASAR glob ${entry} ${mode} stops descending when cancelled before its first directory result`, async () => {
      const controller = new AbortController();
      const reason = new Error('synthetic traversal cancellation');
      let reads = 0;
      const directory = {
        name: 'child',
        isDirectory: () => true,
        isFile: () => false,
        isSymbolicLink: () => false,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isFIFO: () => false,
        isSocket: () => false,
      };
      const options = {
        cwd: resolve('.'),
        signal: controller.signal,
        fs: {
          readdir(_path, _options, callback) {
            reads += 1;
            if (reads === 1) controller.abort(reason);
            queueMicrotask(() => callback(null, reads === 1 ? [directory] : []));
          },
        },
      };
      const task = mode === 'promise' ? glob('**/*', options) : globStream('**/*', options).collect();
      await assert.rejects(task, (error) => error === reason);
      await setImmediate();
      assert.equal(reads, 1, 'Cancellation must not start a child directory read');
    });
  }
}
