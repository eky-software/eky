import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

import config from '../../playwright.config.js';
import { ELECTRON_E2E_TEST_TIMEOUT_MILLISECONDS } from '../../src/fixtures/electronLaunchBudgets.js';

const { scripts } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { scripts: Record<string, string> };
const standardProjects = ['system-api', 'web-chromium', 'electron-development'];
const projectDirectories = {
  'system-api': 'system',
  'web-chromium': 'web',
  'electron-development': 'electron',
  'electron-endurance': 'electron-stress',
  'endurance-baseline': 'stress',
};
const ordinaryCommands = [
  'e2e:system', 'e2e:web', 'e2e:web:critical', 'e2e:electron',
  'e2e:electron:critical', 'e2e:critical', 'e2e:security', 'e2e:fault', 'e2e:all',
];

test.describe('TEST-PROJECT-SELECTION-001 @critical @security', () => {
  test('keeps all five project families separate and excludes the diagnostic-only directory', () => {
    expect(config.projects?.map((project) => project.name)).toEqual(Object.keys(projectDirectories));
    expect(config.testDir).toBe('./tests');
    expect(config.testIgnore).toBeUndefined();
    expect(config.grep).toBeUndefined();
    expect(config.grepInvert).toBeUndefined();
    for (const project of config.projects ?? []) {
      expect(project.testDir).toBeUndefined();
      expect(project.testIgnore).toBeUndefined();
      expect(project.grep).toBeUndefined();
      expect(project.grepInvert).toBeUndefined();
      expect(project.dependencies).toBeUndefined();
    }
    for (const [projectName, directory] of Object.entries(projectDirectories)) {
      for (const file of [`tests/${directory}/candidate.spec.ts`, `tests/${directory}/nested/candidate.spec.ts`]) {
        expect(matchingProjects(file), file).toEqual([projectName]);
      }
      expect(matchingProjects(`tests/${directory}/candidate.test.ts`)).toEqual([]);
    }
    expect(matchingProjects('tests/diagnostics/firstStartLoadOrder.spec.ts')).toEqual([]);
  });

  test('baseline stress matching requires a complete directory on both path forms', () => {
    const pattern = projectPattern('endurance-baseline');
    for (const separator of ['/', '\\']) {
      for (const prefix of ['', `tests${separator}`]) {
        expect(pattern.test(`${prefix}stress${separator}nested${separator}candidate.spec.ts`)).toBe(true);
        for (const directory of ['electron-stress', 'load-stress', 'stressful', 'stresses']) {
          expect(pattern.test(`${prefix}${directory}${separator}candidate.spec.ts`), directory).toBe(false);
        }
      }
    }
  });

  test('preserves serial execution, retry evidence and flaky rejection in the active environment', () => {
    const isCi = Boolean(process.env.CI);
    expect(config.workers).toBe(1);
    expect(config.fullyParallel).toBe(false);
    expect(config.forbidOnly).toBe(isCi);
    expect(config.retries).toBe(isCi ? 1 : 0);
    expect(config.failOnFlakyTests).toBe(isCi);
    expect(config.timeout).toBe(60_000);
    const isDesktopSoak = process.argv.some((argument) => argument.includes('@soak'));
    expect(config.globalTimeout).toBe(isDesktopSoak ? 40 * 60_000 : 30 * 60_000);
    expect(config.expect?.timeout).toBe(10_000);
    expect(config.use).toMatchObject({ trace: 'on-first-retry', screenshot: 'only-on-failure', video: 'off' });
    for (const project of config.projects ?? []) {
      expect(project.workers ?? config.workers).toBe(1);
      expect(project.fullyParallel ?? config.fullyParallel).toBe(false);
      expect(project.retries ?? config.retries).toBe(isCi ? 1 : 0);
      expect(project.timeout ?? config.timeout).toBe(
        project.name === 'electron-development' ? ELECTRON_E2E_TEST_TIMEOUT_MILLISECONDS : 60_000,
      );
    }
  });

  for (const tag of ['@security', '@fault']) {
    test(`${tag} preserves all standard projects including noncritical Electron candidates`, () => {
      const selection = commandSelection(`e2e:${tag.slice(1)}`);
      expect(selection.projectNames).toEqual(standardProjects);
      expect(selection.grep?.source).toBe(tag);
      for (const projectName of standardProjects) {
        const file = projectFile(projectName);
        expect(selectedProjects(selection, file, ['Synthetic suite', `candidate ${tag}`])).toEqual([projectName]);
        expect(selectedProjects(selection, file, [
          `Synthetic suite ${tag}`, 'candidate without own tag',
        ])).toEqual([projectName]);
        expect(selectedProjects(selection, file, ['Synthetic suite', 'unrelated @critical'])).toEqual([]);
      }
    });
  }

  test('critical commands keep their existing projects and do not broaden when a tag is removed', () => {
    for (const [commandName, projectNames] of [
      ['e2e:critical', ['system-api', 'web-chromium']],
      ['e2e:web:critical', ['web-chromium']],
      ['e2e:electron:critical', ['electron-development']],
    ] as const) {
      const selection = commandSelection(commandName);
      expect(selection.projectNames).toEqual(projectNames);
      expect(selection.grep?.source).toBe('@critical');
      for (const projectName of standardProjects) {
        const file = projectFile(projectName);
        const expected = projectNames.some((name) => name === projectName) ? [projectName] : [];
        expect(selectedProjects(selection, file, ['Synthetic suite', 'candidate @critical'])).toEqual(expected);
        expect(selectedProjects(selection, file, ['Synthetic suite @critical', 'candidate'])).toEqual(expected);
        expect(selectedProjects(selection, file, ['Synthetic suite', 'candidate'])).toEqual([]);
      }
    }
  });

  test('ordinary commands exclude endurance even when candidates carry every ordinary tag', () => {
    for (const commandName of ordinaryCommands) {
      for (const projectName of ['electron-endurance', 'endurance-baseline']) {
        expect(selectedProjects(commandSelection(commandName), projectFile(projectName), [
          'Synthetic suite @critical @security @fault', 'candidate',
        ]), commandName).toEqual([]);
      }
    }
  });

  test('unfiltered standard commands retain ordinary and diagnostic-contract candidates', () => {
    for (const [commandName, projectNames] of [
      ['e2e:system', ['system-api']],
      ['e2e:web', ['web-chromium']],
      ['e2e:electron', ['electron-development']],
      ['e2e:all', standardProjects],
    ] as const) {
      const selection = commandSelection(commandName);
      expect(selection.projectNames).toEqual(projectNames);
      expect(selection.grep).toBeUndefined();
      for (const projectName of standardProjects) {
        const expected = projectNames.some((name) => name === projectName) ? [projectName] : [];
        for (const title of ['untagged candidate', 'candidate @diagnostic-contract']) {
          expect(selectedProjects(selection, projectFile(projectName), [title])).toEqual(expected);
        }
      }
      expect(selectedProjects(selection, 'tests/diagnostics/firstStartLoadOrder.spec.ts', ['candidate'])).toEqual([]);
    }
  });

  test('manual endurance commands retain their own family and desktop tag filters', () => {
    const baseline = commandSelection('e2e:stress');
    expect(baseline.projectNames).toEqual(['endurance-baseline']);
    expect(baseline.grep).toBeUndefined();
    expect(selectedProjects(baseline, projectFile('endurance-baseline'), ['candidate']))
      .toEqual(['endurance-baseline']);
    expect(selectedProjects(baseline, projectFile('electron-endurance'), ['candidate @desktop-stress @soak']))
      .toEqual([]);
    for (const [commandName, tag] of [
      ['e2e:desktop-stress', '@desktop-stress'], ['e2e:desktop-soak', '@soak'],
    ] as const) {
      const selection = commandSelection(commandName);
      expect(selection.projectNames).toEqual(['electron-endurance']);
      expect(selection.grep?.source).toBe(tag);
      expect(selectedProjects(selection, projectFile('electron-endurance'), [`candidate ${tag}`]))
        .toEqual(['electron-endurance']);
      expect(selectedProjects(selection, projectFile('electron-endurance'), ['candidate @critical'])).toEqual([]);
      expect(selectedProjects(selection, projectFile('endurance-baseline'), [`candidate ${tag}`])).toEqual([]);
    }
  });
});

interface CommandSelection {
  projectNames: string[];
  grep?: RegExp;
}

// This bounded candidate model is not Playwright discovery. Actual discovery
// separately verifies real declarations after preparation, including imports.
function selectedProjects(selection: CommandSelection, file: string, titles: string[]): string[] {
  return selection.projectNames.filter((projectName) =>
    projectPattern(projectName).test(file) &&
    (!selection.grep || selection.grep.test([projectName, file, ...titles].join(' '))),
  );
}

function matchingProjects(file: string): string[] {
  return Object.keys(projectDirectories).filter((name) => projectPattern(name).test(file));
}

function projectPattern(name: string): RegExp {
  const projects = config.projects?.filter((project) => project.name === name) ?? [];
  assert.equal(projects.length, 1, 'Expected one configured project');
  const pattern = projects[0]?.testMatch;
  assert.ok(pattern instanceof RegExp, 'This contract supports the current RegExp project selectors only');
  assert.equal(pattern.global || pattern.sticky, false, 'Project selectors must not have stateful flags');
  return pattern;
}

function projectFile(name: string): string {
  const directory = Object.entries(projectDirectories).find(([projectName]) => projectName === name)?.[1];
  assert.ok(directory, 'Unknown synthetic project family');
  return `tests/${directory}/candidate.spec.ts`;
}

function commandSelection(name: string): CommandSelection {
  const script = scripts[name];
  assert.ok(script, 'Missing E2E command');
  const invocation = script.split(' && ').at(-1);
  assert.ok(invocation, 'Missing Playwright invocation');
  assert.ok(invocation.startsWith('playwright test '), 'Expected the current literal Playwright invocation');
  const arguments_ = invocation.slice('playwright test '.length).split(' ');
  const selection: CommandSelection = { projectNames: [] };
  let workersSeen = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    assert.ok(argument, 'Empty selection argument');
    if (argument.startsWith('--project=')) {
      const projectName = argument.slice('--project='.length);
      projectPattern(projectName);
      assert.ok(!selection.projectNames.includes(projectName), 'Duplicate project selection');
      selection.projectNames.push(projectName);
    } else if (argument === '--grep') {
      const tag = arguments_[++index];
      assert.ok(tag && ['@critical', '@security', '@fault', '@desktop-stress', '@soak'].includes(tag), 'Unexpected tag filter');
      assert.equal(selection.grep, undefined, 'Duplicate tag filter');
      selection.grep = new RegExp(tag);
    } else {
      assert.equal(argument, '--workers=1', 'Unexpected option or positional filter');
      assert.equal(workersSeen, false, 'Duplicate worker option');
      workersSeen = true;
    }
  }
  assert.ok(selection.projectNames.length > 0, 'Project selection must remain explicit');
  return selection;
}
