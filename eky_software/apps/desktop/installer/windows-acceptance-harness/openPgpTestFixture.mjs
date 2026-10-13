import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const gpgPath = (value) => /^[A-Za-z]:[\\/]/u.test(value)
  ? `/${value[0].toLowerCase()}${value.slice(2).replaceAll('\\', '/')}` : value;
const windows = process.platform === 'win32';
const powershell = windows ? 'pwsh.exe' : 'pwsh';

// Shared only by crypto tests: isolated TEST keys, bounded private child output and agent cleanup.
export async function createOpenPgpTestFixture(ROOT) {
  await mkdir(join(ROOT, '.eky-local'), { recursive: true });
  // Linux test-key agents need short Unix socket paths; failure evidence stays outside builds.
  const root = await mkdtemp(windows ? join(ROOT, '.eky-local', 'openpgp-test-') : join(tmpdir(), 'eky-gpg-'));
  const homes = [];
  let gpg;
  let gpgconf;
  let sequence = 0;
  const run = async (executable, args, timeout = 30_000, options = {}) => {
    const result = spawnSync(executable, args, {
      encoding: 'buffer', timeout, maxBuffer: 128 * 1024, windowsHide: true,
      cwd: options.cwd,
      env: { ...process.env, ...options.env, GNUPGHOME: gpgPath(join(root, 'unused-home')), GPG_AGENT_INFO: '' },
    });
    const prefix = join(root, `process-${sequence++}`);
    await writeFile(`${prefix}.stdout.private.log`, result.stdout ?? Buffer.alloc(0));
    await writeFile(`${prefix}.stderr.private.log`, result.stderr ?? Buffer.alloc(0));
    if (result.error) {
      await writeFile(`${prefix}.failure.private.log`, String(result.error));
      throw new Error('OPENPGP_TEST_PROCESS_FAILED');
    }
    return result;
  };
  const ps = async (body, timeout) => run(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(`$ErrorActionPreference = 'Stop'; ${body}`, 'utf16le').toString('base64')], timeout);
  const invokeGpg = async (home, args, expectSuccess = true) => {
    const result = await run(gpg, ['--no-options', '--homedir', gpgPath(home), '--batch', '--no-tty',
      '--disable-dirmngr', '--no-auto-key-retrieve', '--auto-key-locate', 'clear', ...args.map(gpgPath)]);
    if (expectSuccess) assert.equal(result.status, 0, 'OPENPGP_TEST_GPG_FAILED');
    return result;
  };
  const generate = async (label, options = []) => {
    const home = join(root, label);
    await mkdir(home, { mode: 0o700 });
    homes.push(home);
    // Pin TEST-key preferences to the approved MDC profile, not GPG's changing AEAD default.
    // Only ephemeral, passphrase-free TEST keys; never a user's GnuPG home.
    await invokeGpg(home, [...options, '--default-preference-list', 'AES256 SHA256 Uncompressed',
      '--pinentry-mode', 'loopback', '--passphrase', '',
      '--quick-generate-key', `Evidence TEST ${label} <${label}@example.invalid>`, 'ed25519', 'cert,sign', '1d']);
    const listing = await invokeGpg(home, ['--with-colons', '--list-keys']);
    const fingerprint = listing.stdout.toString('utf8').split(/\r?\n/u)
      .find((line) => line.startsWith('fpr:'))?.split(':')[9];
    assert.equal(/^[A-F0-9]{40}$/u.test(fingerprint), true, 'OPENPGP_TEST_FINGERPRINT_MISSING');
    return { home, fingerprint };
  };
  const exportKey = async (key, name, secret = false) => {
    const path = join(root, name);
    await invokeGpg(key.home, ['--pinentry-mode', 'loopback', '--passphrase', '', '--armor', '--output', path,
      secret ? '--export-secret-keys' : '--export', key.fingerprint]);
    return path;
  };
  const discovered = await ps(windows ? `$git = (Get-Command git.exe -CommandType Application | Select-Object -First 1).Source;
    $dir = [IO.Path]::GetDirectoryName($git); $gpg = $null;
    foreach ($relative in @('../usr/bin/gpg.exe', '../../usr/bin/gpg.exe')) {
      $candidate = [IO.Path]::GetFullPath([IO.Path]::Combine($dir, $relative));
      if ([IO.File]::Exists($candidate)) { $gpg = $candidate; break }
    }
    if (!$gpg) { throw 'OPENPGP_TEST_GPG_UNAVAILABLE' }
    @{ gpg = $gpg; gpgconf = (Join-Path ([IO.Path]::GetDirectoryName($gpg)) 'gpgconf.exe') } | ConvertTo-Json -Compress`
    : `@{ gpg = (Get-Command gpg -CommandType Application | Select-Object -First 1).Source;
      gpgconf = (Get-Command gpgconf -CommandType Application | Select-Object -First 1).Source } | ConvertTo-Json -Compress`);
  assert.equal(discovered.status, 0, 'OPENPGP_TEST_TOOL_DISCOVERY_FAILED');
  ({ gpg, gpgconf } = JSON.parse(discovered.stdout.toString('utf8')));

  return {
    root, run, ps, invokeGpg, generate, exportKey, gpg,
    get sequence() { return sequence; },
    async finish({ completed, failed }) {
      let stopped = true;
      for (const home of homes) {
        try {
          const result = await run(gpgconf, ['--homedir', gpgPath(home), '--kill', 'gpg-agent'], 5000);
          stopped &&= result.status === 0;
        } catch { stopped = false; }
      }
      await appendFile(join(root, 'outcome.private.log'), JSON.stringify({ completed, failed, stopped }));
      assert.equal(stopped, true, 'OPENPGP_TEST_AGENT_STOP_UNVERIFIED');
      if (completed && !failed) await rm(root, { recursive: true });
    },
  };
}
