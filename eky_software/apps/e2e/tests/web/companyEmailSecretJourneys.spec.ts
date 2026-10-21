import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../../src/fixtures/isolatedWebTest.js';
import { mountCompanyEmailSecretProbe } from './companyEmailSecretMount.js';

const text = {
  loading: 'Tarkistetaan SMTP-salasanan tilaa...',
  configured: 'Salasana asetettu',
  empty: 'Salasanaa ei ole asetettu',
  unknown: 'Salasanan tila on tuntematon',
  set: 'Aseta salasana',
  change: 'Vaihda salasana',
  remove: 'Poista salasana',
  saving: 'Tallennetaan...',
  saveSuccess: 'SMTP-salasana tallennettu turvallisesti.',
  removeSuccess: 'SMTP-salasana poistettu.',
  saveError: 'SMTP-salasanaa ei voitu tallentaa turvallisesti. Tarkista tieto ja yrit\u00e4 uudelleen.',
  removeError: 'SMTP-salasanaa ei voitu poistaa turvallisesti. Yrit\u00e4 hetken kuluttua uudelleen.',
  unknownError: 'Salasanamuutoksen lopputulosta ei voitu varmistaa. \u00c4l\u00e4 toista muutosta t\u00e4ss\u00e4 ajossa. Sulje Eky ja avaa se uudelleen ennen salasanan tarkistamista tai uudelleensy\u00f6tt\u00f6\u00e4.',
  auditError: 'Salasanamuutoksen tapahtumamerkint\u00e4\u00e4 ei voitu viimeistell\u00e4. Muutos on voinut tallentua. Sulje Eky ja avaa se uudelleen ennen jatkamista.',
};

test('COMPANY-SECRET-UI-001 @critical @fault ignores stale status loads after client reuse and remount', async ({ e2eWeb }) => {
  await withProbe(e2eWeb.page, async (probe) => {
    const { view } = probe;
    await test.step('Reuse the original client while older loads remain pending', async () => {
      await probe.selectClient(1);
      await probe.selectClient(0);
      await probe.expectCalls(['load', 'load', 'load']);
      await probe.release(0, 'configured');
      await expectLoading(view);
      await probe.release(1, 'failure');
      await expectLoading(view);
      await probe.release(2, 'empty');
      await expect(view.getByText(text.empty, { exact: true })).toBeVisible();
      await expect(view.getByRole('button', { name: text.set, exact: true })).toBeEnabled();
    });
    await test.step('Complete an abandoned remount load after the current load', async () => {
      await probe.selectClient(0, true);
      await probe.selectClient(0, true);
      await probe.release(4, 'configured');
      await probe.release(3, 'failure');
      await expect(view.getByText(text.configured, { exact: true })).toBeVisible();
      await expect(view.getByRole('button', { name: text.change, exact: true })).toBeEnabled();
      await expectNoMutationMessage(view);
      await expect(view.getByText('SMTP-salasanan tilaa ei voitu tarkistaa.', { exact: false })).toHaveCount(0);
      await probe.expectCalls(['load', 'load', 'load', 'load', 'load']);
    });
  });
});

for (const [id, operation, staleOutcome] of [
  ['002', 'save', 'configured'], ['003', 'remove', 'unknown'],
] as const) {
  test(`COMPANY-SECRET-UI-${id} @critical @fault ignores stale ${operation} completion and finally in a reused client session`, async ({ e2eWeb }) => {
    await withProbe(e2eWeb.page, async (probe) => {
      const { view } = probe;
      const initialStatus = operation === 'save' ? 'empty' : 'configured';
      await probe.release(0, initialStatus);
      await startMutation(view, operation);
      await test.step('Start a newer mutation using the exact original client object', async () => {
        await probe.selectClient(1);
        await probe.selectClient(0);
        await probe.release(3, initialStatus);
        await startMutation(view, operation);
        await probe.expectCalls(['load', operation, 'load', 'load', operation]);
      });
      await test.step('Old completion cannot change current status, messages or pending admission', async () => {
        await probe.release(1, staleOutcome);
        await expect(view.getByText(text[initialStatus], { exact: true })).toBeVisible();
        await expect(view.getByRole('button', { name: text.saving, exact: true })).toBeDisabled();
        await expect(view.getByLabel(/SMTP-salasana$/, { exact: false })).toBeDisabled();
        await expectNoMutationMessage(view);
        await submitBurst(view);
        await probe.expectCalls(['load', operation, 'load', 'load', operation]);
      });
      await test.step('Only the current mutation supplies its final result', async () => {
        await probe.release(4, operation === 'save' ? 'configured' : 'empty');
        await probe.release(2, 'failure');
        await expect(view.getByText(operation === 'save' ? text.saveSuccess : text.removeSuccess, { exact: true })).toBeVisible();
        await expect(view.getByText(operation === 'save' ? text.configured : text.empty, { exact: true })).toBeVisible();
        await expect(view.getByRole('button', { name: operation === 'save' ? text.change : text.set, exact: true })).toBeEnabled();
        await probe.expectCalls(['load', operation, 'load', 'load', operation]);
      });
    });
  });
}

for (const [id, operation, terminalOutcome] of [
  ['004', 'save', 'unknown'], ['005', 'remove', 'auditIncomplete'],
] as const) {
  test(`COMPANY-SECRET-UI-${id} @critical @fault @recovery permits manual ${operation} retry only after noEffect`, async ({ e2eWeb }) => {
    await withProbe(e2eWeb.page, async (probe) => {
      const { view } = probe;
      await probe.release(0, 'configured');
      await test.step('Pending admission rejects same-turn and later duplicate submissions', async () => {
        if (operation === 'save') await submitBurst(view);
        else await startMutation(view, operation);
        await expect(view.getByRole('button', { name: text.saving, exact: true })).toBeDisabled();
        await expect(view.getByRole('button', { name: text.remove, exact: true })).toBeDisabled();
        await submitBurst(view);
        await probe.expectCalls(['load', operation]);
      });
      await test.step('Known noEffect preserves known status without retrying automatically', async () => {
        await probe.release(1, 'noEffect');
        await probe.selectClient(0);
        await expect(view.getByText(operation === 'save' ? text.saveError : text.removeError, { exact: true })).toBeVisible();
        await expect(view.getByText(text.configured, { exact: true })).toBeVisible();
        await expect(view.getByRole('button', { name: text.change, exact: true })).toBeEnabled();
        await expect(view.getByRole('button', { name: text.remove, exact: true })).toBeEnabled();
        await expect(view.getByText('Synthetic company email', { exact: false })).toHaveCount(0);
        await probe.expectCalls(['load', operation]);
      });
      await test.step('Explicit retry with an uncertain outcome closes this session', async () => {
        await startMutation(view, operation);
        await probe.expectCalls(['load', operation, operation]);
        await probe.release(2, terminalOutcome);
        await probe.selectClient(0);
        await expect(view.getByText(text.unknown, { exact: true })).toBeVisible();
        await expect(view.getByText(terminalOutcome === 'unknown' ? text.unknownError : text.auditError, { exact: true })).toBeVisible();
        await expect(view.getByText(text.empty, { exact: true })).toHaveCount(0);
        await expect(view.getByRole('button', { name: text.set, exact: true })).toBeDisabled();
        await expect(view.getByRole('button', { name: text.remove, exact: true })).toHaveCount(0);
        await expect(view.getByLabel('SMTP-salasana', { exact: true })).toBeDisabled();
        await expect(view.getByText('Synthetic company email', { exact: false })).toHaveCount(0);
        await submitBurst(view);
        await probe.expectCalls(['load', operation, operation]);
        await expect(view.getByText(text.saveSuccess, { exact: true })).toHaveCount(0);
        await expect(view.getByText(text.removeSuccess, { exact: true })).toHaveCount(0);
      });
    });
  });
}

type Probe = Awaited<ReturnType<typeof mountCompanyEmailSecretProbe>>;

async function withProbe(page: Page, run: (probe: Probe) => Promise<void>): Promise<void> {
  test.info().annotations.push({ type: 'coverage', description:
    'Synthetic browser-component panel/hook coverage; no desktop generation or persisted credential proof.' });
  // Empty submissions exercise form dispatch only, not credential validation/storage.
  // Never fill, read back, retain or attach a credential or request body.
  const probe = await mountCompanyEmailSecretProbe(page);
  const acceptConfirmation = (dialog: import('@playwright/test').Dialog) => dialog.accept();
  page.on('dialog', acceptConfirmation);
  let failure: { error: unknown } | undefined;
  try { await run(probe); }
  catch (error) { failure = { error }; }
  finally {
    page.off('dialog', acceptConfirmation);
    try { await test.step('Dispose browser probe and settle abandoned calls', () => probe.close()); }
    catch (error) {
      test.info().annotations.push({ type: 'company-email-secret-cleanup', description: 'Browser probe cleanup failed.' });
      failure ??= { error };
    }
  }
  if (failure) throw failure.error;
}

async function startMutation(view: Locator, operation: 'save' | 'remove'): Promise<void> {
  await view.getByRole('button', {
    name: operation === 'save' ? /^(Aseta|Vaihda) salasana$/ : text.remove,
    exact: true,
  }).click();
}

async function submitBurst(view: Locator): Promise<void> {
  // Deliberately bypass disabled-button admission, reaching the real form handler twice
  // in one browser task. The hook itself must enforce its synchronous pending gate.
  await view.getByLabel(/SMTP-salasana$/, { exact: false }).evaluate((element) => {
    const form = (element as HTMLInputElement).form;
    if (!form) throw new Error('Company email probe form is missing.');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

async function expectLoading(view: Locator): Promise<void> {
  await expect(view.getByText(text.loading, { exact: true })).toBeVisible();
  await expect(view.getByRole('button')).toHaveCount(0);
}

async function expectNoMutationMessage(view: Locator): Promise<void> {
  for (const message of [text.saveSuccess, text.removeSuccess, text.saveError, text.removeError, text.unknownError, text.auditError]) {
    await expect(view.getByText(message, { exact: true })).toHaveCount(0);
  }
}
