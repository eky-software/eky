import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { test, expect } from '@playwright/test';

import {
  assertElectronLaunchPrerequisites,
  ElectronLaunchPrerequisiteError,
  type ElectronLaunchPrerequisiteErrorCode,
} from '../../src/environment/assertElectronLaunchPrerequisites.js';

interface LaunchFixture {
  applicationPath: string;
  configPath: string;
  cwd: string;
  executablePath: string;
  profileDirectories: string[];
  runRoot: string;
}

test('DESK-LAUNCH-PREFLIGHT-001 @critical accepts complete launch prerequisites', () => {
  const fixture = createLaunchFixture();
  try {
    expect(() => assertElectronLaunchPrerequisites(fixture)).not.toThrow();
  } finally {
    rmSync(fixture.runRoot, { force: true, recursive: true });
  }
});

for (const scenario of [
  {
    code: 'ELECTRON_EXECUTABLE_MISSING',
    mutate: (fixture: LaunchFixture) => {
      fixture.executablePath = join(fixture.runRoot, 'missing-electron.exe');
    },
  },
  {
    code: 'ELECTRON_APPLICATION_MISSING',
    mutate: (fixture: LaunchFixture) => {
      fixture.applicationPath = join(fixture.runRoot, 'missing-application');
    },
  },
  {
    code: 'ELECTRON_MAIN_MISSING',
    mutate: (fixture: LaunchFixture) => {
      writeFileSync(
        join(fixture.applicationPath, 'package.json'),
        `${JSON.stringify({ main: '../outside-main.js' })}\n`,
        'utf8',
      );
    },
  },
  {
    code: 'ELECTRON_CWD_MISSING',
    mutate: (fixture: LaunchFixture) => {
      fixture.cwd = join(fixture.runRoot, 'missing-cwd');
    },
  },
  {
    code: 'ELECTRON_CONFIG_MISSING',
    mutate: (fixture: LaunchFixture) => {
      fixture.configPath = join(fixture.runRoot, 'missing-config.json');
    },
  },
  {
    code: 'ELECTRON_PROFILE_MISSING',
    mutate: (fixture: LaunchFixture) => {
      fixture.profileDirectories = [
        join(fixture.runRoot, 'missing-profile'),
      ];
    },
  },
] satisfies readonly {
  code: ElectronLaunchPrerequisiteErrorCode;
  mutate(fixture: LaunchFixture): void;
}[]) {
  test(`DESK-LAUNCH-PREFLIGHT-002 @critical reports ${scenario.code} without paths`, () => {
    const fixture = createLaunchFixture();
    try {
      scenario.mutate(fixture);
      let actualError: unknown;
      try {
        assertElectronLaunchPrerequisites(fixture);
      } catch (error) {
        actualError = error;
      }

      expect(actualError).toBeInstanceOf(ElectronLaunchPrerequisiteError);
      expect(actualError).toMatchObject({ code: scenario.code });
      expect((actualError as Error).message).toBe(scenario.code);
      expect((actualError as Error).message).not.toContain(fixture.runRoot);
    } finally {
      rmSync(fixture.runRoot, { force: true, recursive: true });
    }
  });
}

function createLaunchFixture(): LaunchFixture {
  const runRoot = mkdtempSync(join(tmpdir(), 'eky-electron-preflight-'));
  const applicationPath = join(runRoot, 'application');
  const profilePath = join(runRoot, 'profile');
  mkdirSync(applicationPath, { mode: 0o700 });
  mkdirSync(profilePath, { mode: 0o700 });

  const executablePath = join(runRoot, 'electron.exe');
  const configPath = join(runRoot, 'electron-config.json');
  writeFileSync(executablePath, 'synthetic executable', {
    encoding: 'utf8',
    mode: 0o700,
  });
  writeFileSync(
    join(applicationPath, 'package.json'),
    `${JSON.stringify({ main: 'main.js' })}\n`,
    'utf8',
  );
  writeFileSync(join(applicationPath, 'main.js'), 'export {};\n', 'utf8');
  writeFileSync(configPath, '{}\n', 'utf8');

  return {
    applicationPath,
    configPath,
    cwd: runRoot,
    executablePath,
    profileDirectories: [profilePath],
    runRoot,
  };
}
