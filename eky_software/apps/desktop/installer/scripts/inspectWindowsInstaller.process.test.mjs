import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const INSPECTOR = fileURLToPath(new URL('./inspectWindowsInstaller.ps1', import.meta.url));

test('MSI inspector policy guards reject invalid reinstall properties without exposing values', {
  skip: process.platform !== 'win32',
}, async (t) => {
  const sentinel = `PRIVATE-INSTALLER-PROPERTY-${randomUUID()}`;
  const invalidMode = 'INSTALLER_REINSTALL_MODE_INVALID';
  const forbiddenReinstall = 'INSTALLER_REINSTALL_FORBIDDEN';
  const cases = [
    { name: 'missing mode', properties: {}, expected: invalidMode },
    { name: 'default mode', properties: { REINSTALLMODE: 'omus' }, expected: invalidMode },
    { name: 'forced overwrite mode', properties: { REINSTALLMODE: 'amus' }, expected: invalidMode },
    { name: 'empty mode', properties: { REINSTALLMODE: '' }, expected: invalidMode },
    { name: 'null mode', properties: { REINSTALLMODE: null }, expected: invalidMode },
    { name: 'noncanonical mode', properties: { REINSTALLMODE: 'EMUS' }, expected: invalidMode },
    { name: 'private mode', properties: { REINSTALLMODE: sentinel }, expected: invalidMode },
    { name: 'approved mode', properties: { REINSTALLMODE: 'emus' }, expected: 'accepted' },
    { name: 'authored reinstall all', properties: { REINSTALLMODE: 'emus', REINSTALL: 'ALL' },
      expected: forbiddenReinstall },
    { name: 'authored empty reinstall', properties: { REINSTALLMODE: 'emus', REINSTALL: '' },
      expected: forbiddenReinstall },
    { name: 'authored null reinstall', properties: { REINSTALLMODE: 'emus', REINSTALL: null },
      expected: forbiddenReinstall },
    { name: 'authored private reinstall', properties: { REINSTALLMODE: 'emus', REINSTALL: sentinel },
      expected: forbiddenReinstall },
    { name: 'mode failure precedes reinstall failure', properties: { REINSTALL: 'ALL' },
      expected: invalidMode },
  ];
  // Parse the real inspector, but execute only its two policy guards, never its COM entrypoint.
  const command = `
    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    $tokens = $null
    $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile(
      $env:EKY_INSPECTOR_POLICY_TEST_SCRIPT, [ref]$tokens, [ref]$errors)
    if ($errors.Count -ne 0) { throw 'inspectorPolicyParseFailed' }
    $outerTry = @($ast.EndBlock.Statements | Where-Object {
      $_ -is [Management.Automation.Language.TryStatementAst]
    })
    if ($outerTry.Count -ne 1) { throw 'inspectorPolicyTryMissing' }
    $guards = @(
      foreach ($code in @('INSTALLER_REINSTALL_MODE_INVALID', 'INSTALLER_REINSTALL_FORBIDDEN')) {
        $matching = @($outerTry[0].Body.Statements | Where-Object {
          $_ -is [Management.Automation.Language.IfStatementAst] -and
          $null -ne $_.Find({ param($node)
            $node -is [Management.Automation.Language.ThrowStatementAst] -and
            $null -ne $node.Pipeline -and $node.Pipeline.Extent.Text -ceq "'$code'"
          }, $false)
        })
        if ($matching.Count -ne 1) { throw 'inspectorPolicyGuardMissingOrDuplicated' }
        $matching[0]
      }
    )
    if ($guards[0].Extent.StartOffset -ge $guards[1].Extent.StartOffset) {
      throw 'inspectorPolicyGuardOrderChanged'
    }
    $guardScript = [scriptblock]::Create(($guards.Extent.Text -join "\n"))
    $results = @(
      foreach ($testCase in (ConvertFrom-Json -InputObject $env:EKY_INSPECTOR_POLICY_TEST_CASES)) {
        & {
          $properties = @{}
          foreach ($property in $testCase.PSObject.Properties) {
            $properties[$property.Name] = $property.Value
          }
          try {
            . $guardScript
            'accepted'
          } catch {
            $_.Exception.Message
          }
        }
      }
    )
    ConvertTo-Json -InputObject $results -Compress
  `;
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64'),
  ], {
    env: { ...process.env, EKY_INSPECTOR_POLICY_TEST_SCRIPT: INSPECTOR,
      EKY_INSPECTOR_POLICY_TEST_CASES: JSON.stringify(cases.map(({ properties }) => properties)) },
    encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(result.error === undefined, true, 'PowerShell guard process must start and finish');
  assert.equal(result.status, 0, 'PowerShell guard process must exit successfully');
  assert.equal(result.signal, null);
  assert.equal(result.stdout.includes(sentinel), false, 'stdout must not expose private property values');
  assert.equal(result.stderr.includes(sentinel), false, 'stderr must not expose private property values');
  assert.equal(result.stderr.trim().length, 0, 'PowerShell guard process must not write errors');
  let observed;
  try {
    observed = JSON.parse(result.stdout);
  } catch {
    assert.fail('PowerShell guard process must return only its case results');
  }
  assert.equal(Array.isArray(observed), true);
  assert.equal(observed.length, cases.length);
  for (const [index, { name, expected }] of cases.entries()) {
    await t.test(name, () => {
      assert.equal(observed[index] === expected, true, 'Guard must return the exact fixed result');
    });
  }
});
