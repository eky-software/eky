import { expect, test } from '../../src/fixtures/isolatedWebTest.js';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const warning =
  'Yrityslistassa on samannimisiä yrityksiä. Tiedot säilyvät erillään. Voit nimetä yrityksen uudelleen.';

test('WORKSPACE-DUPLICATE-NAMES-UI-001 @critical distinguishes historical names without blocking selection', async ({ e2eWeb }, testInfo) => {
  const { page } = e2eWeb;
  await page.addInitScript(({ activeId, passiveId }) => {
    const status = {
      activeWorkspaceId: activeId,
      formatVersion: 1,
      operationState: 'idle',
      workspaces: [
        { availability: 'ready', isActive: true, workspaceId: activeId, workspaceLabel: 'Yritys  A' },
        { availability: 'ready', isActive: false, workspaceId: passiveId, workspaceLabel: 'yritys\u00a0a' },
      ],
      duplicateWorkspaceLabelIds: [activeId, passiveId],
    };
    const selected: string[] = [];
    const target = window as Omit<typeof window, 'ekyDesktop'> & {
      ekyDesktop: unknown;
      __ekyWorkspaceNameSelections: string[];
    };
    const unexpectedMutation = async () => { throw new Error('Unexpected workspace mutation.'); };
    target.ekyDesktop = Object.freeze({
      async getWorkspaceManagementStatus() { return structuredClone(status); },
      createEmptyWorkspace: unexpectedMutation,
      importWorkspaceBackupAsNew: unexpectedMutation,
      renameWorkspace: unexpectedMutation,
      async switchWorkspace(input: { workspaceId: string }) {
        selected.push(input.workspaceId);
        return { formatVersion: 1, status: 'completed' };
      },
    });
    target.__ekyWorkspaceNameSelections = selected;
  }, { activeId: firstId, passiveId: secondId });
  await page.reload();
  await page.getByRole('button', { name: 'Vaihda yritystä. Aktiivinen yritys: Yritys A' }).click();
  const dialog = page.getByRole('dialog', { name: 'Yritykset', exact: true });
  await expect(dialog.getByRole('status').filter({ hasText: warning })).toBeVisible();
  const first = dialog.getByRole('listitem').filter({ hasText: firstId });
  const second = dialog.getByRole('listitem').filter({ hasText: secondId });
  expect(await first.locator('strong').textContent()).toBe('Yritys  A');
  expect(await second.locator('strong').textContent()).toBe('yritys\u00a0a');
  await expect(second.getByRole('button', { name: 'Avaa yritys', exact: true })).toBeEnabled();
  await expect(first.getByRole('button', { name: 'Nimeä uudelleen', exact: true })).toBeEnabled();

  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return element.scrollWidth <= element.clientWidth && rect.left >= 0 && rect.right <= window.innerWidth;
    })).toBe(true);
    await dialog.screenshot({ path: testInfo.outputPath(`historical-names-${viewport.width}.png`) });
  }

  await second.getByRole('button', { name: 'Nimeä uudelleen', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Yrityksen nimi', exact: true })).toHaveValue('yritys\u00a0a');
  await dialog.getByRole('button', { name: 'Takaisin', exact: true }).click();
  await second.getByRole('button', { name: 'Avaa yritys', exact: true }).click();
  await dialog.getByRole('button', { name: 'Vaihda yritys', exact: true }).click();
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { __ekyWorkspaceNameSelections: string[] }).__ekyWorkspaceNameSelections))
    .toEqual([secondId]);
});
