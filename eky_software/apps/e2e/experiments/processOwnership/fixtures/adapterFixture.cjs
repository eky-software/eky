'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function workspace() {
  assert.equal(process.env.EKY_E2E, '1');
  const root = process.env.EKY_T3C_ROOT;
  const base = process.env.EKY_T3C_TEMP_BASE;
  const generation = process.env.EKY_T3C_GENERATION;
  const scenario = process.env.EKY_T3C_CASE;
  assert.match(generation, /^[a-f0-9]{64}$/);
  assert.ok(['normal', 'beforeReady', 'rootFirst', 'bridgeExit'].includes(scenario));
  assert.ok(path.isAbsolute(root) && path.isAbsolute(base));
  assert.equal(fs.realpathSync(root), root);
  assert.equal(fs.realpathSync(base), base);
  assert.equal(path.dirname(root), base);
  assert.ok(path.basename(root).startsWith('eky-t3a-'));
  const cwd = process.cwd();
  assert.equal(cwd, path.join(root, 'electronNormal'));
  for (let cursor = cwd; ; cursor = path.dirname(cursor)) {
    const info = fs.lstatSync(cursor);
    assert.ok(info.isDirectory() && !info.isSymbolicLink());
    assert.equal(fs.realpathSync(cursor), cursor);
    if (path.dirname(cursor) === cursor) break;
  }
  assert.equal(__dirname, cwd);
  assert.equal(fs.realpathSync(require('node:os').tmpdir()), path.join(cwd, 'tmp'));
  return { root, cwd, generation, scenario };
}

function writeOnce(name, value) {
  const { cwd } = workspace();
  assert.match(name, /^[a-z-]+\.json$/);
  const target = path.join(cwd, name);
  const pending = `${target}.pending`;
  assert.equal(fs.existsSync(target), false);
  fs.writeFileSync(pending, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 });
  fs.renameSync(pending, target);
}

module.exports = { workspace, writeOnce };
