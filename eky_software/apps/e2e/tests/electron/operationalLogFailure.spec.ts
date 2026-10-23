import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createSyntheticCustomerInput } from '../../src/data/syntheticBusinessInputs.js';
import { readElectronNativeAdapterSnapshot } from '../../src/electron/electronMainCapabilities.js';
import { expect, test } from '../../src/fixtures/isolatedElectronTest.js';

const notice = 'Lokituksessa havaittiin häiriö. Osa teknisistä tapahtumista voi puuttua.';
const obstruction = 'synthetic H5 log obstruction';

for (const [id, blockIncident] of [['001', false], ['002', true]] as const) {
  test(`DESK-LOG-FAILURE-${id} @critical @fault @recovery retains a nonblocking notice through the real main/preload/UI chain (incident blocked: ${blockIncident})`, async ({ e2eElectron }) => {
    const { page, runtime, api, electronApp } = e2eElectron;
    const logsRoot = join(runtime.userDataPath, 'runtime', 'logs');
    const desktopRoot = join(logsRoot, 'desktop');
    const preservedDesktop = join(logsRoot, 'h5-preserved-desktop');
    const incidentRoot = join(logsRoot, 'incident-index');
    const preservedIncidents = join(logsRoot, 'h5-preserved-incidents');
    await expect(page.getByText(notice, { exact: true })).toHaveCount(0);
    expect(await readFailureStatus()).toEqual({ failureObserved: false });
    const before = await readElectronNativeAdapterSnapshot(electronApp);
    await rename(desktopRoot, preservedDesktop);
    await writeFile(desktopRoot, obstruction, { flag: 'wx' });
    if (blockIncident) {
      await mkdir(incidentRoot, { recursive: true });
      await rename(incidentRoot, preservedIncidents);
      await writeFile(incidentRoot, obstruction, { flag: 'wx' });
    }

    await page.getByRole('button', { name: 'Oma yritys', exact: true }).click();
    await page.getByRole('button', { name: 'Diagnostiikka', exact: true }).click();
    // The existing native test adapter returns success; its real main event fails to write.
    await page.getByRole('button', { name: 'Avaa lokikansio', exact: true }).click();
    await expect(page.getByText(notice, { exact: true })).toBeVisible();
    expect(await readFailureStatus()).toEqual({ failureObserved: true });
    const after = await readElectronNativeAdapterSnapshot(electronApp);
    expect(after.errorBoxCount).toBe(before.errorBoxCount);
    expect(after.messageBoxCount).toBe(before.messageBoxCount);
    await page.getByRole('button', { name: 'Asiakkaat', exact: true }).click();
    await expect(page.getByText(notice, { exact: true })).toBeVisible();
    const customer = await api.post('/customers', { data: createSyntheticCustomerInput() });
    expect(customer.status()).toBe(201);

    if (blockIncident) {
      expect(await readFile(incidentRoot, 'utf8')).toBe(obstruction);
      await unlink(incidentRoot);
      await rename(preservedIncidents, incidentRoot);
    } else {
      const bytes = await readFile(join(incidentRoot,
        `desktop-incident-index-${new Date().getUTCFullYear()}.jsonl`), 'utf8');
      const entries = bytes.trim().split('\n').map(line => JSON.parse(line));
      expect(entries.filter(entry => entry.fingerprint === 'LOG_WRITE_FAILED:desktop-info')).toHaveLength(1);
      expect(bytes).not.toContain(runtime.userDataPath);
    }
    expect(await readFile(desktopRoot, 'utf8')).toBe(obstruction);
    await unlink(desktopRoot);
    await rename(preservedDesktop, desktopRoot);
    await page.screenshot({ path: test.info().outputPath('logging-notice.png') });
    expect(await readFailureStatus()).toEqual({ failureObserved: true });
    await e2eElectron.restart();
    await expect(e2eElectron.page.getByText(notice, { exact: true })).toHaveCount(0);
    expect(await readFailureStatus()).toEqual({ failureObserved: false });

    function readFailureStatus() {
      return e2eElectron.page.evaluate(async () => {
        const bridge = (window as typeof window & { ekyDesktop?: {
          getOperationalLogFailureStatus(): Promise<unknown>;
        } }).ekyDesktop;
        if (!bridge) throw new Error('Synthetic log status capability missing.');
        return bridge.getOperationalLogFailureStatus();
      });
    }
  });
}
