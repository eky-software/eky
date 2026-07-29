import { expect, test } from '../../src/fixtures/isolatedWebTest.js';

test('WEB-BOOT-001 @critical renders the customer workspace through the isolated session proxy', async ({
  e2eWeb,
}) => {
  await expect(
    e2eWeb.page.getByRole('heading', { name: 'Asiakkaat' }),
  ).toBeVisible();
  await expect(
    e2eWeb.page.getByText('Asiakkaita ei ole vielä.'),
  ).toBeVisible();

  const renderedHtml = await e2eWeb.page.content();
  expect(renderedHtml).not.toContain(e2eWeb.backend.sessionSecret);
  expect(e2eWeb.web.managedProcess.readStdout()).not.toContain(
    e2eWeb.backend.sessionSecret,
  );
  expect(e2eWeb.web.managedProcess.readStderr()).not.toContain(
    e2eWeb.backend.sessionSecret,
  );
});
