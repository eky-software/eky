'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { workspace, writeOnce } = require('./adapterFixture.cjs');
// The experiment copies this module beside the driver and its closed protocol.
const { lateForkFiles, lateForkLimit, lateForkRole, validateLateForkPermission,
  validateLateForkReceipt } = require('./adapterContract.mjs');
const { cwd, generation, scenario } = workspace();

function readPermission(name) {
  const filename = path.join(cwd, name);
  const info = fs.lstatSync(filename);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size <= lateForkLimit);
  const bytes = fs.readFileSync(filename);
  assert.ok(bytes.length <= lateForkLimit);
  return validateLateForkPermission(JSON.parse(bytes.toString('utf8')), generation);
}

process.on('SIGTERM', () => {});
// A final synthetic fail-safe, not an ownership or cleanup proof.
setTimeout(() => process.exit(73), 24_000);

if (process.argv.length === 4 && process.argv[2] === lateForkRole) {
  assert.equal(scenario, 'rootFirst');
  const permission = readPermission(lateForkFiles.consumed);
  assert.equal(process.argv[3], permission.challenge);
  // Only the new process writes this receipt; the leaf never claims its readiness.
  writeOnce(lateForkFiles.receipt, validateLateForkReceipt({ schemaVersion: 1, generation,
    challenge: permission.challenge, kind: 'grandchildReady' }, permission));
} else {
  assert.equal(process.argv.length, 2);
  writeOnce('adapter-leaf.json', { schemaVersion: 1, generation, ready: true });
  if (scenario === 'rootFirst') {
    let consumed = false;
    const polling = setInterval(() => {
      if (consumed) return;
      try {
        let permission;
        try { permission = readPermission(lateForkFiles.permission); }
        catch (error) { if (error.code === 'ENOENT') return; throw error; }
        consumed = true;
        clearInterval(polling);
        assert.equal(fs.existsSync(path.join(cwd, lateForkFiles.consumed)), false);
        fs.renameSync(path.join(cwd, lateForkFiles.permission), path.join(cwd, lateForkFiles.consumed));
        assert.deepEqual(readPermission(lateForkFiles.consumed), permission);
        const child = spawn(process.execPath, [__filename, lateForkRole, permission.challenge], {
          cwd, env: process.env, detached: true, shell: false, windowsHide: true, stdio: 'ignore',
        });
        child.on('error', () => process.exit(72));
        child.unref();
      } catch {
        clearInterval(polling);
        process.exit(72);
      }
    }, 20);
  }
}
