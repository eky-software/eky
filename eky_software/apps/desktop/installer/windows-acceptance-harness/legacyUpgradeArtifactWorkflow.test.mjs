import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const WORKFLOW_URL = new URL(
  '../../../../../.github/workflows/windows-acceptance-v2-legacy-diagnostic.yml',
  import.meta.url,
);

test('shared feasibility binds the verified SDK before every process-contract mode', async () => {
  const source = await readFile(new URL(
    '../../../../../.github/workflows/windows-acceptance-supervisor-feasibility.yml',
    import.meta.url,
  ), 'utf8');
  const bindingIndex = source.indexOf('      - name: Bind the verified SDK executable for all process contracts');
  assert.ok(bindingIndex >= 0);
  const nextStep = source.indexOf('\n      - name:', bindingIndex + 1);
  const binding = source.slice(bindingIndex, nextStep);
  assert.doesNotMatch(binding, /\bif:\s|inputs\.mode/u);
  assert.match(binding, /Get-Command dotnet\.exe -CommandType Application -ErrorAction Stop/u);
  assert.match(binding, /IsPathFullyQualified\(\$dotnet\)/u);
  assert.match(binding, /& \$dotnet --version/u);
  assert.match(binding, /EKY_DOTNET_EXE=\$dotnet/u);
  assert.equal(source.match(/EKY_DOTNET_EXE=\$dotnet/gu)?.length, 1);
  assert.ok(bindingIndex < source.indexOf('      - name: Build Windows process supervisor'));
  assert.ok(bindingIndex < source.indexOf('      - name: Run supervisor unit and process contracts'));
});

test('V2.5 phase acceptance requires the same revision full contracts before its producer', async () => {
  const source = await readFile(WORKFLOW_URL, 'utf8');
  const contracts = source.slice(source.indexOf('  legacy_contracts:'), source.indexOf('  legacy_artifact_producer:'));
  const producer = source.slice(source.indexOf('  legacy_artifact_producer:'), source.indexOf('  legacy_consumer:'));
  assert.match(source, /name: V2\.5 packaged legacy phase acceptance/u);
  assert.match(source, /acceptanceScope = 'V2\.5-phase'/u);
  assert.match(source, /workflow_call:\s+inputs:\s+risk_plan:/u);
  assert.doesNotMatch(source.split('permissions:')[0], /push:/u);
  assert.doesNotMatch(source, /pull_request:|\bmain\b|continue-on-error|retry|workflow_run:/u);
  assert.match(source, /cancel-in-progress: false/u);
  assert.ok(contracts.includes("repetition: ${{ fromJSON(inputs.risk_plan != '' && fromJSON(inputs.risk_plan).repetitions == 1 && '[1]' || '[1, 2]') }}"));
  assert.match(contracts, /run: pnpm installer:test:windows-supervisor-v2-legacy/u);
  assert.match(producer, /needs: legacy_contracts/u);
  assert.equal(source.match(/ref: \$\{\{ github\.sha \}\}/gu)?.length, 3);
  assert.equal(source.match(/EKY_DOTNET_EXE=\$dotnet/gu)?.length, 3);
});

test('V2.5 phase acceptance builds once and both consumers only verify and consume', async () => {
  const source = await readFile(WORKFLOW_URL, 'utf8');
  const consumer = source.slice(source.indexOf('  legacy_consumer:'));
  assert.equal(source.match(/installer:v2-legacy-artifact:build /gu)?.length, 1);
  assert.equal(source.match(/installer:v2-legacy-artifact:verify /gu)?.length, 3);
  assert.match(consumer, /needs: legacy_artifact_producer/u);
  assert.ok(consumer.includes("repetition: ${{ fromJSON(inputs.risk_plan != '' && fromJSON(inputs.risk_plan).repetitions == 1 && '[1]' || '[1, 2]') }}"));
  assert.match(consumer, /max-parallel: 2/u);
  assert.equal(consumer.match(/runLegacyUpgrade\.mjs --artifact-descriptor/gu)?.length, 1);
  const command = consumer.slice(consumer.indexOf('      - name: Run existing supervised legacy lifecycle once'),
    consumer.indexOf('      - name:', consumer.indexOf('      - name: Run existing supervised legacy lifecycle once') + 1));
  assert.match(command, /\$commandExit = \$LASTEXITCODE/u);
  assert.match(command, /verifyLegacyCallerResult\.mjs.*--command-exit \$commandExit/u);
  assert.equal(command.match(/--expected-descriptor-sha256 \$env:EXPECTED_DESCRIPTOR_SHA256/gu)?.length, 2);
  assert.equal(command.match(/--expected-build-revision \$env:EXPECTED_BUILD_REVISION/gu)?.length, 2);
  assert.equal(command.match(/--result-path \$resultPath/gu)?.length, 2);
  assert.match(command, /\$commandExit -ne 0 -or \$LASTEXITCODE -ne 0/u);
  assert.doesNotMatch(consumer, /artifact:build|package:windows|installer:release/u);
  assert.match(consumer, /always\(\) && steps\.download\.outcome == 'success'/u);
  assert.match(consumer, /needs\.legacy_artifact_producer\.outputs\.descriptor_sha256/u);
  assert.match(consumer, /needs\.legacy_artifact_producer\.outputs\.build_revision/u);
  assert.doesNotMatch(source, /installer:w6b|installer:upgrade|installer:update-e2e/u);
});

test('V2.5 phase acceptance transfers only the verified short lived artifact with approved actions', async () => {
  const source = await readFile(WORKFLOW_URL, 'utf8');
  const consumer = source.slice(source.indexOf('  legacy_consumer:'));
  assert.equal(source.match(/actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/gu)?.length, 1);
  assert.equal(source.match(/actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c/gu)?.length, 1);
  assert.match(source, /EKY_V25_ARTIFACT_NAME: eky-v25-phase-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/u);
  assert.equal(source.match(/name: \$\{\{ env\.EKY_V25_ARTIFACT_NAME \}\}/gu)?.length, 1);
  assert.match(consumer, /artifact-ids: \$\{\{ needs\.legacy_artifact_producer\.outputs\.artifact_id \}\}/u);
  assert.equal(source.match(/path: \$\{\{ runner\.temp \}\}\/eky-v25-legacy-artifact/gu)?.length, 2);
  for (const setting of ['retention-days: 1', 'compression-level: 0', 'if-no-files-found: error', 'overwrite: false', 'include-hidden-files: false']) {
    assert.ok(source.includes(setting));
  }
  assert.doesNotMatch(source, /upload.*(?:log|profile)|actions\/[a-z-]+@v\d/iu);
  assert.ok(source.indexOf('Verify produced artifact before upload') < source.indexOf('uses: actions/upload-artifact@'));
});

test('V2.5 phase acceptance preserves bounded V2 jobs and locked toolchain', async () => {
  const source = await readFile(WORKFLOW_URL, 'utf8');
  for (const minutes of [10, 30, 22, 37, 27, 3]) {
    assert.match(source, new RegExp(`timeout-minutes: ${minutes}\\b`, 'u'));
  }
  assert.equal(source.match(/pnpm install --frozen-lockfile/gu)?.length, 2);
  assert.equal(source.match(/persist-credentials: false/gu)?.length, 3);
  assert.equal(source.match(/dotnet-version: 10\.0\.302/gu)?.length, 3);
  assert.match(source, /installer:verify-restore-lock/u);
  assert.match(source, /sourceArtifactClass -cne 'historical-source-rebuild'/u);
  assert.match(source, /targetPayloadIdentity -cnotmatch/u);
  assert.doesNotMatch(source, /permissions:\s+contents: write|pull-requests: write/u);
});
