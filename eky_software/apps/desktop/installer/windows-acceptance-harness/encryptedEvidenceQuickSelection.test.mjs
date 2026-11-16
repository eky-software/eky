import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const selectionTestName = 'encrypted evidence quick selection contract';
const harness = 'installer/windows-acceptance-harness/';
const reporterCommand = 'node --test --test-concurrency=1 --test-reporter=../../test-reporters/nodeFailureReporter.mjs';
const contractNames = {
  'msiResourceTimingEvidence.test.mjs': [
    'RM timing binding is opt-in and limited to the two actual hosted contract repetitions',
    'RM timing schema accepts late, empty and incomplete queries without inventing a latency SLA',
    'RM timing schema rejects extra raw fields, missing values, invalid ordering and forged bindings',
    'RM success collector takes exactly one projected report before original fixture removal and no other successful data',
    'RM success delivery rejects missing, changed, overlarge and linked reports rather than falling back',
    'RM success restriction preserves the existing named MSI policy success report only in its original hosted context',
  ],
  'ciFailureEvidence.test.mjs': [
    'only matching hosted Windows or Linux contexts select their native Git',
    'source allowlist excludes databases, requests, config, environment, traces and profiles',
    'binding rejects missing attempts, invalid job names and unknown revisions',
  ],
};

test(selectionTestName, async () => {
  const { scripts } = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  const names = [selectionTestName, ...Object.values(contractNames).flat()];
  const pattern = `^(?:${names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`;
  const files = ['encryptedEvidenceQuickSelection.test.mjs', ...Object.keys(contractNames)];
  assert.equal(scripts['installer:test:encrypted-evidence:quick'],
    `${reporterCommand} --test-name-pattern="${pattern}" ${files.map(file => harness + file).join(' ')}`);
  assert.equal(new Set(names).size, 10);

  const selected = new RegExp(pattern);
  for (const [file, expected] of Object.entries(contractNames)) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    // These owners register their named contracts as top-level literal tests.
    const declared = [...source.matchAll(/^test\('([^'\r\n]+)'\s*,/gm)].map(match => match[1]);
    assert.deepEqual(declared.filter(name => selected.test(name)), expected);
  }
  const rmSource = await readFile(new URL('msiResourceTimingEvidence.test.mjs', import.meta.url), 'utf8');
  const cryptoName = 'RM timing projection survives real existing OpenPGP encryption and byte-exact decryption';
  assert.ok(rmSource.includes(`test('${cryptoName}',`));
  for (const name of [...names, cryptoName, 'future OpenPGP contract', 'RM success future contract']) {
    assert.equal(selected.test(name), names.includes(name));
    assert.equal(selected.test(`prefix ${name}`), false);
    assert.equal(selected.test(`${name} suffix`), false);
  }

  const fullFiles = [
    `${harness}workspaceEncryptedEvidence.test.mjs`,
    `${harness}ciFailureEvidence.test.mjs`,
    `${harness}startupExceptionEvidence.test.mjs`,
    'scripts/packagedSmokeFailureEvidence.test.mjs',
    `${harness}encryptedEvidenceOpenPgp.test.mjs`,
    `${harness}originalFailureEvidenceOpenPgp.test.mjs`,
    '../../test-reporters/runnerFailureReporters.test.mjs',
    '../../test-reporters/tests/d2SecretBrokerFailureEvidenceOpenPgp.test.mjs',
    '../../test-reporters/tests/fHttpFailureEvidenceOpenPgp.test.mjs',
    '../../test-reporters/tests/workspaceDeletionFailureEvidenceOpenPgp.test.mjs',
    '../../test-reporters/tests/electronStartupObservationOpenPgp.test.mjs',
  ];
  assert.equal(scripts['installer:test:encrypted-evidence'], `${reporterCommand} ${fullFiles.join(' ')}`);
  const coreFiles = fullFiles.filter(file => file !== 'scripts/packagedSmokeFailureEvidence.test.mjs');
  assert.equal(coreFiles.length, 10);
  assert.equal(scripts['installer:test:encrypted-evidence:core'], `${reporterCommand} ${coreFiles.join(' ')}`);
  assert.equal(scripts.test.includes('installer:test:encrypted-evidence:quick'), false);
});
