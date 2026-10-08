import { app } from 'electron';
import { readFileSync } from 'node:fs';
import { runSafeDesktopStartup } from '../../../dist/main/earlyStartup.js';
import { createStartupExceptionCapture } from '../../../dist/main/startupExceptionEvidence.js';

const argument = process.argv.find(value => value.startsWith('--exception-proof-input='));
if (argument === undefined) app.exit(2);
const input = JSON.parse(readFileSync(argument.slice('--exception-proof-input='.length), 'utf8'));
if (input.appVersion !== app.getVersion()) app.exit(2);
app.setPath('userData', input.userDataPath);
const capture = createStartupExceptionCapture(input);
if (capture === undefined) app.exit(2);

void runSafeDesktopStartup({
  waitUntilReady: () => app.whenReady(),
  async loadRuntime() {
    throw new Error('synthetic first Electron startup exception', {
      cause: new Error('synthetic original Electron cause'),
    });
  },
  observeStartupException: error => capture(error, 'earlyStartup'),
  async onFailure(code) {
    if (code !== 'DESKTOP_START_FAILED' || await capture.waitForDelivery() !== 'recorded') app.exit(3);
  },
  startRuntime: async () => undefined,
  exitApplication: code => app.exit(code),
});
