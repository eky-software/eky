import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const INSPECTOR = fileURLToPath(new URL('./inspectWindowsInstaller.ps1', import.meta.url));
const ACTION = 'EkySetReinstallMode';
const CONDITION = 'NOT Installed AND NOT REINSTALLMODE';

function validPolicy() {
  const sequence = () => [
    { Action: ACTION, Condition: CONDITION, Sequence: '799' },
    { Action: 'CostInitialize', Condition: '', Sequence: '800' },
  ];
  return { properties: {}, actions: [{ Action: ACTION, Type: '51', Source: 'REINSTALLMODE',
    Target: 'emus', ExtendedType: '' }], sequences: {
    InstallUISequence: sequence(), InstallExecuteSequence: sequence(),
    AdminUISequence: [], AdminExecuteSequence: [], AdvtExecuteSequence: [],
  } };
}

test('MSI inspector admits only the approved Type 51 policy without exposing rejected values', {
  skip: process.platform !== 'win32',
}, async (t) => {
  const sentinel = `PRIVATE-INSTALLER-POLICY-${randomUUID()}`;
  const actionError = 'INSTALLER_CUSTOM_ACTION_FORBIDDEN';
  const sequenceError = 'INSTALLER_REINSTALL_SEQUENCE_INVALID';
  const cases = [];
  const add = (name, mutate, expected) => {
    const policy = validPolicy();
    mutate(policy);
    cases.push({ name, policy, expected });
  };
  add('approved policy', () => {}, 'accepted');
  add('legacy MSI schema without ExtendedType', ({ actions }) => { delete actions[0].ExtendedType; }, 'accepted');
  for (const value of [null, '0']) {
    add(`no extended flags: ${value}`, ({ actions }) => { actions[0].ExtendedType = value; }, 'accepted');
  }
  for (const property of ['REINSTALLMODE', 'REINSTALL']) {
    for (const [index, value] of ['emus', 'omus', 'amus', 'EMUS', '', null, sentinel].entries()) {
      add(`authored ${property}: ${index}`, ({ properties }) => { properties[property] = value; },
        property === 'REINSTALLMODE' ? 'INSTALLER_REINSTALL_MODE_INVALID' : 'INSTALLER_REINSTALL_FORBIDDEN');
    }
  }
  add('authored reinstall all', ({ properties }) => { properties.REINSTALL = 'ALL'; }, 'INSTALLER_REINSTALL_FORBIDDEN');
  add('property rejection precedes missing action', (policy) => {
    policy.properties.REINSTALLMODE = 'emus'; policy.actions = [];
  }, 'INSTALLER_REINSTALL_MODE_INVALID');
  add('missing action', (policy) => { policy.actions = []; }, actionError);
  add('duplicate action', ({ actions }) => { actions.push({ ...actions[0] }); }, actionError);
  add('additional action', ({ actions }) => { actions.push({ ...actions[0], Action: sentinel }); }, actionError);
  for (const [field, values] of Object.entries({
    Action: ['OtherAction', 'ekysetreinstallmode', sentinel],
    Type: ['1', '307', '563', '1075', '8243', sentinel],
    Source: ['OTHER_PROPERTY', 'reinstallmode', sentinel],
    Target: ['amus', 'EMUS', '[OTHER_PROPERTY]', sentinel],
    ExtendedType: ['1', sentinel],
  })) {
    for (const [index, value] of values.entries()) {
      add(`invalid ${field}: ${index}`, ({ actions }) => { actions[0][field] = value; }, actionError);
    }
  }
  for (const field of ['Action', 'Type', 'Source', 'Target']) {
    add(`missing ${field}`, ({ actions }) => { delete actions[0][field]; }, actionError);
  }
  for (const table of ['InstallUISequence', 'InstallExecuteSequence']) {
    add(`${table}: missing table`, ({ sequences }) => { delete sequences[table]; }, sequenceError);
    add(`${table}: empty table`, ({ sequences }) => { sequences[table] = []; }, sequenceError);
    add(`${table}: missing action`, ({ sequences }) => { sequences[table].shift(); }, sequenceError);
    add(`${table}: missing costing`, ({ sequences }) => { sequences[table].pop(); }, sequenceError);
    add(`${table}: duplicate action`, ({ sequences }) => {
      sequences[table].push({ ...sequences[table][0] });
    }, sequenceError);
    for (const value of ['800', '801', '0', '-1', sentinel]) {
      add(`${table}: invalid position ${value === sentinel ? 'private' : value}`, ({ sequences }) => {
        sequences[table][0].Sequence = value;
      }, sequenceError);
    }
    for (const [index, condition] of ['', 'NOT Installed', 'NOT REINSTALLMODE', '1', sentinel].entries()) {
      add(`${table}: invalid condition ${index}`, ({ sequences }) => {
        sequences[table][0].Condition = condition;
      }, sequenceError);
    }
    add(`${table}: conditional costing`, ({ sequences }) => { sequences[table][1].Condition = '0'; }, sequenceError);
    add(`${table}: nonnumeric costing`, ({ sequences }) => { sequences[table][1].Sequence = sentinel; }, sequenceError);
  }
  for (const table of ['AdminUISequence', 'AdminExecuteSequence', 'AdvtExecuteSequence']) {
    add(`${table}: unexpected scheduling`, ({ sequences }) => {
      sequences[table].push({ Action: ACTION, Condition: CONDITION, Sequence: '799' });
    }, sequenceError);
  }
  // Execute the real inspector's pure policy boundary, never its COM entrypoint.
  const command = `
    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    $tokens = $null
    $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile(
      $env:EKY_INSPECTOR_POLICY_TEST_SCRIPT, [ref]$tokens, [ref]$errors)
    if ($errors.Count -ne 0) { throw 'inspectorPolicyParseFailed' }
    $functions = @($ast.EndBlock.Statements | Where-Object {
      $_ -is [Management.Automation.Language.FunctionDefinitionAst] -and
      $_.Name -ceq 'Assert-ReinstallModePolicy'
    })
    if ($functions.Count -ne 1) { throw 'inspectorPolicyFunctionMissingOrDuplicated' }
    . ([scriptblock]::Create($functions[0].Extent.Text))
    function ConvertTo-PolicyMap($Value) {
      $map = @{}
      foreach ($property in $Value.PSObject.Properties) { $map[$property.Name] = $property.Value }
      return ,$map
    }
    $results = @(
      foreach ($testCase in (ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd()))) {
        $properties = ConvertTo-PolicyMap $testCase.properties
        $actions = @($testCase.actions | ForEach-Object { ConvertTo-PolicyMap $_ })
        $sequences = @{}
        foreach ($table in $testCase.sequences.PSObject.Properties) {
          $sequences[$table.Name] = @($table.Value | ForEach-Object { ConvertTo-PolicyMap $_ })
        }
        try {
          Assert-ReinstallModePolicy -Properties $properties -CustomActions $actions -Sequences $sequences
          'accepted'
        } catch { $_.Exception.Message }
      }
    )
    ConvertTo-Json -InputObject $results -Compress
  `;
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64'),
  ], {
    env: { ...process.env, EKY_INSPECTOR_POLICY_TEST_SCRIPT: INSPECTOR },
    input: JSON.stringify(cases.map(({ policy }) => policy)),
    encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  assert.equal(result.error === undefined, true, 'PowerShell policy process must start and finish');
  assert.equal(result.status, 0, 'PowerShell policy process must exit successfully');
  assert.equal(result.signal, null);
  assert.equal(result.stdout.includes(sentinel), false, 'stdout must not expose private policy values');
  assert.equal(result.stderr.includes(sentinel), false, 'stderr must not expose private policy values');
  assert.equal(result.stderr.trim().length, 0, 'PowerShell policy process must not write errors');
  let observed;
  try { observed = JSON.parse(result.stdout); }
  catch { assert.fail('PowerShell policy process must return only its case results'); }
  assert.equal(Array.isArray(observed), true);
  assert.equal(observed.length, cases.length);
  for (const [index, { name, expected }] of cases.entries()) {
    await t.test(name, () => {
      assert.equal(observed[index] === expected, true, 'Policy must return the exact fixed result');
    });
  }
});

test('MSI policy reader uses real COM column metadata and rejects unavailable tables', {
  skip: process.platform !== 'win32',
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'eky-installer-policy-'));
  // These databases contain only synthetic tables. No MSI action is executed.
  const command = `
    [Console]::Out.WriteLine('readerPhase:scriptEntered')
    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'
    $tokens = $null
    $errors = $null
    $installer = $null
    $database = $null
    $phase = 'parseReader'
    function Set-ReaderPhase([string]$Value) {
      $script:phase = $Value
      [Console]::Out.WriteLine('readerPhase:' + $Value)
    }
    $passed = $false
    try {
      $ast = [Management.Automation.Language.Parser]::ParseFile(
        $env:EKY_INSPECTOR_POLICY_TEST_SCRIPT, [ref]$tokens, [ref]$errors)
      if ($errors.Count -ne 0) { throw 'readerParseFailed' }
      $functions = @($ast.EndBlock.Statements | Where-Object {
        $_ -is [Management.Automation.Language.FunctionDefinitionAst] -and
        $_.Name -ceq 'Get-InstallerPolicyRows'
      })
      if ($functions.Count -ne 1) { throw 'readerFunctionMissingOrDuplicated' }
      . ([scriptblock]::Create($functions[0].Extent.Text))
      function Invoke-FixtureQuery($Database, [string]$Query) {
        $view = $null
        try {
          $view = $Database.OpenView($Query)
          [void]$view.Execute()
        } finally {
          if ($null -ne $view) {
            [void]$view.Close()
            [void][Runtime.InteropServices.Marshal]::ReleaseComObject($view)
          }
        }
      }
      Set-ReaderPhase 'createFixture'
      $installer = New-Object -ComObject WindowsInstaller.Installer
      $observations = @()
      foreach ($schema in @('current', 'legacy')) {
        $database = $installer.OpenDatabase(
          (Join-Path $env:EKY_INSPECTOR_POLICY_TEST_ROOT ($schema + '.msi')), 3)
        Set-ReaderPhase 'createTables'
        $extendedColumn = if ($schema -ceq 'current') { ', \`ExtendedType\` LONG' } else { '' }
        Invoke-FixtureQuery $database ('CREATE TABLE \`CustomAction\` (' +
          '\`Action\` CHAR(72) NOT NULL, \`Type\` SHORT NOT NULL, \`Source\` CHAR(72), ' +
          '\`Target\` CHAR(255)' + $extendedColumn + ' PRIMARY KEY \`Action\`)')
        Invoke-FixtureQuery $database (
          'INSERT INTO \`CustomAction\` (\`Action\`, \`Type\`, \`Source\`, \`Target\`) ' +
          'VALUES (''EkySetReinstallMode'', 51, ''REINSTALLMODE'', ''emus'')')
        Invoke-FixtureQuery $database ('CREATE TABLE \`InstallUISequence\` (' +
          '\`Action\` CHAR(72) NOT NULL, \`Condition\` CHAR(255), \`Sequence\` SHORT PRIMARY KEY \`Action\`)')
        Invoke-FixtureQuery $database (
          'INSERT INTO \`InstallUISequence\` (\`Action\`, \`Condition\`, \`Sequence\`) ' +
          'VALUES (''EkySetReinstallMode'', ''NOT Installed AND NOT REINSTALLMODE'', 799)')
        Invoke-FixtureQuery $database (
          'INSERT INTO \`InstallUISequence\` (\`Action\`, \`Sequence\`) VALUES (''CostInitialize'', 800)')
        Invoke-FixtureQuery $database ('CREATE TABLE \`AdminUISequence\` (' +
          '\`Action\` CHAR(72) NOT NULL, \`Condition\` CHAR(255), \`Sequence\` SHORT PRIMARY KEY \`Action\`)')
        [void]$database.Commit()
        Set-ReaderPhase 'readActionColumns'
        $actions = @(Get-InstallerPolicyRows -Database $database -TableName 'CustomAction')
        $observations += ($actions.Count -eq 1 -and
          $actions[0]['Action'] -ceq 'EkySetReinstallMode' -and
          $actions[0]['Type'] -ceq '51' -and
          $actions[0]['Source'] -ceq 'REINSTALLMODE' -and
          $actions[0]['Target'] -ceq 'emus')
        $observations += ($actions[0].ContainsKey('ExtendedType') -eq ($schema -ceq 'current'))
        if ($schema -ceq 'current') { $observations += ($actions[0]['ExtendedType'] -ceq '') }
        if ($observations -contains $false) { throw 'readerActionValuesInvalid' }
        Set-ReaderPhase 'readSequenceColumns'
        $rows = @(Get-InstallerPolicyRows -Database $database -TableName 'InstallUISequence')
        $setting = @($rows | Where-Object { $_['Action'] -ceq 'EkySetReinstallMode' })
        $costing = @($rows | Where-Object { $_['Action'] -ceq 'CostInitialize' })
        $observations += ($rows.Count -eq 2 -and $setting.Count -eq 1 -and $costing.Count -eq 1 -and
          $setting[0]['Sequence'] -ceq '799' -and
          $setting[0]['Condition'] -ceq 'NOT Installed AND NOT REINSTALLMODE' -and
          $costing[0]['Sequence'] -ceq '800' -and $costing[0]['Condition'] -ceq '')
        if ($observations -contains $false) { throw 'readerSequenceValuesInvalid' }
        Set-ReaderPhase 'readEmptyTable'
        $observations += (@(Get-InstallerPolicyRows -Database $database -TableName 'AdminUISequence').Count -eq 0)
        if ($observations -contains $false) { throw 'readerEmptyTableInvalid' }
        Set-ReaderPhase 'rejectMissingTable'
        $missingCode = 'accepted'
        try { $null = @(Get-InstallerPolicyRows -Database $database -TableName 'AdminExecuteSequence') }
        catch { $missingCode = $_.Exception.Message }
        $observations += ($missingCode -ceq 'INSTALLER_REINSTALL_POLICY_READ_FAILED')
        if ($observations -contains $false) { throw 'readerMissingTableCodeInvalid' }
        Set-ReaderPhase 'closeDatabase'
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($database)
        $database = $null
      }
      Set-ReaderPhase 'validateResultCount'
      if ($observations.Count -ne 11) { throw 'readerResultCountInvalid' }
      $passed = $true
      $phase = 'completed'
    } catch {
      $passed = $false
    } finally {
      [Console]::Out.WriteLine('readerPhase:closeCom')
      foreach ($com in @($database, $installer)) {
        if ($null -ne $com) {
          [void][Runtime.InteropServices.Marshal]::ReleaseComObject($com)
        }
      }
    }
    @{ passed = $passed; phase = $phase } | ConvertTo-Json -Compress
  `;
  const scriptPath = join(root, 'reader-fixture.ps1');
  await writeFile(scriptPath, command, { flag: 'wx' });
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath,
  ], {
    env: { ...process.env, EKY_INSPECTOR_POLICY_TEST_SCRIPT: INSPECTOR,
      EKY_INSPECTOR_POLICY_TEST_ROOT: root },
    encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await writeFile(join(root, 'reader-process.private.json'), JSON.stringify({
    code: result.error?.code, status: result.status, signal: result.signal,
    stdout: result.stdout, stderr: result.stderr,
  }), { flag: 'wx' });
  const phases = new Set(['scriptEntered', 'parseReader', 'createFixture', 'createTables', 'readActionColumns',
    'readSequenceColumns', 'readEmptyTable', 'rejectMissingTable', 'closeDatabase', 'closeCom',
    'validateResultCount', 'completed']);
  const lines = (result.stdout ?? '').trim().split(/\r?\n/);
  const lastPhase = lines.filter((line) => line.startsWith('readerPhase:'))
    .map((line) => line.slice('readerPhase:'.length)).filter((phase) => phases.has(phase)).at(-1) ?? 'unknown';
  assert.equal(result.error === undefined, true, `COM reader process must finish; last phase: ${lastPhase}`);
  assert.equal(result.status, 0, 'COM reader process must exit successfully');
  assert.equal(result.signal, null);
  assert.equal(result.stderr.trim().length, 0, 'COM reader process must not write raw errors');
  let observed;
  try { observed = JSON.parse(lines.at(-1)); }
  catch { assert.fail('COM reader process must return a safe result'); }
  assert.equal(phases.has(observed.phase), true, 'COM reader phase must be allowlisted');
  assert.equal(observed.passed === true, true, `COM reader proof failed at ${observed.phase}`);
  assert.equal(observed.phase, 'completed');
  // Failed or timed-out proof retains its synthetic databases for diagnosis.
  await rm(root, { recursive: true, force: true });
});
