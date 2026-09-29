# E2E-testin kirjoittajan pikaopas

Tämä opas kuvaa nykyisen `apps/e2e`-paketin tavallisen testin kirjoittamista.
Se ei lisää testipolitiikkaa, riippuvuushyväksyntää tai uusia ajovaltuuksia.
Tekniset runtime-sopimukset omistaa [E2E-testiympäristö](../architecture/e2e-test-environment.md).
Päivätyt checkpointit ja niiden ajotulokset ovat historiallista näyttöä,
eivät uuden muutoksen hyväksyntä tai vaihtoehtoinen valmistelureitti.

## Aloita oikeasta vastuusta

Lue [juuri-AGENTS](../../AGENTS.md), [työn aloitusjärjestys](workflow.md#työn-aloitusjärjestys)
ja [apps/e2e-ohje](../../apps/e2e/AGENTS.md) sekä muuttuvan moduulin ohjeet.
Testitason ja kattavuuden omistavat [testausohjeet](testing-rules.md),
[E2E-strategia](../architecture/e2e-testing-strategy.md) ja
[R0-matriisi](../architecture/r0-e2e-test-matrix.md).
[Turvallisuusperiaatteet](../architecture/security-principles.md) ja
[tarkistuslista](review-checklist.md) koskevat myös testikoodia ja raportointia.

| Todistettava asia | Ensisijainen taso |
| --- | --- |
| Laskenta, validointi, tilasiirtymän invariantti tai rajataulukko | Unit-, komponentti- tai integraatiotesti omistavan toteutuksen yhteyteen |
| HTTP, session, permission, yritysraja, persistence tai backend-recovery | `system-api`, ilman selainta |
| Käyttäjän lomake-, navigointi-, refresh- tai virhepolku | `web-chromium` |
| Main/preload/renderer-raja, native-capability tai desktop-restart | `electron-development` |
| Jaeltavan Windows-artifactin turvallisuus, backup/restore tai installer/update | Desktopin erillinen packaged-/hyväksyntäportti |

Testaa invariantti kattavasti alimmalla sopivalla tasolla ja valitse E2E:hen
edustava kerrokset yhdistävä polku. Browser-E2E tai Electron development ei
korvaa packaged-smokea; katso [testitasot](../architecture/e2e-testing-strategy.md#testitasot).

## Sijoitus, tunnisteet ja matriisi

Tavalliset skenaariot ovat `apps/e2e/tests/system/`, `apps/e2e/tests/web/`
ja `apps/e2e/tests/electron/`-hakemistoissa.
Käytä kuvaavaa englanninkielistä `*.spec.ts`-nimeä nykyisten esimerkkien tapaan.
[Playwright-konfiguraatio](../../apps/e2e/playwright.config.ts) valitsee projektin
hakemiston perusteella, ei testin tagin perusteella.

- Kirjoita matriisin scenario ID testin omaan otsikkoon, esimerkiksi
  `CUS-API-001`. Pelkkä `describe`-otsikko ei riitä fixturelle.
- [Tunnisteen lukija](../../apps/e2e/src/fixtures/readE2eScenarioId.ts) poimii
  ensimmäisen ID:n: isot A-Z-kirjainryhmät, väliviivat ja kolme numeroa.
  [Polkujen muodostaja](../../apps/e2e/src/environment/createE2eWorkerPaths.ts)
  rajaa tunnisteen enintään 64 merkkiin. Usean matriisirivin ketjussa ensimmäinen
  tunniste nimeää runtime-hakemiston; muut tunnisteet eivät luo lisäruntimeja.
- `@critical` valitsee kriittiset polut, `@security` turvallisuusrajat ja
  `@fault` hallitut virheet. `@recovery` kuvaa palautumispolkua; sille ei ole
  omaa juurikomentoa. Tagit voivat esiintyä yhdessä.
- Päivitä matriisia, kun skenaario lisätään, poistetaan, pilkotaan, estyy tai
  vaihtaa tasoa. Kirjaa lähtötila, toiminto/fault, odotus, pysyvä tila,
  audit-/diagnostiikkapäätös ja vuotokielto, ei pelkkää testin nimeä.
- Erota [matriisin tilat](../architecture/r0-e2e-test-matrix.md#tilat): esimerkiksi
  `covered-existing` ei tarkoita toteutettua Playwright-E2E:tä eikä
  `accepted-contract` muuta infrastruktuurin sopimustestiä E2E-testiksi.

Uusi moduuli tai merkittävä ominaisuus tarvitsee matriisin
[valmistumisehtojen](../architecture/r0-e2e-test-matrix.md#definition-of-done)
mukaiset onnistumis-, permission-/tenant-esto- ja failure-/recovery-polut sekä
tarvittaessa cross-module- ja packaged-rajat. Alla olevat lyhennelmät eivät
yksin täytä näitä ehtoja eivätkä korvaa nykyisiä kokonaisia testejä.

## Valitse yksi kolmesta eristetystä fixturestä

Tuo `test` ja `expect` valitusta fixturestä. Älä rakenna tavalliseen
skenaarioon omaa prosessikäynnistintä, session-bootstrapia tai cleanupia.

| Fixture | Testin saama rajapinta |
| --- | --- |
| [isolatedBackendTest.ts](../../apps/e2e/src/fixtures/isolatedBackendTest.ts) | `e2eBackend.api`, `anonymousApi`, `backend`, `paths`, `restartBackend()` |
| [isolatedWebTest.ts](../../apps/e2e/src/fixtures/isolatedWebTest.ts) | `e2eWeb.page`, `context`, `api`, `backend`, `web`, `paths`; sivu on jo avattu |
| [isolatedElectronTest.ts](../../apps/e2e/src/fixtures/isolatedElectronTest.ts) | `e2eElectron.page`, `api`, `electronApp`, `runtime`, `paths`, `restart()` |

Fixture omistaa testikohtaisen OS-temp-juuren, palvelut, sessionin ja purun.
Käytä nykyistä [synteettisen datan muodostajaa](../../apps/e2e/src/data/syntheticBusinessInputs.ts).
Tiedostotodisteisiin käytä `paths`-kenttiä; [testikohtainen runtime](../architecture/e2e-test-environment.md#testikohtainen-runtime)
määrittää sallitut juuret ja fake-adapterit.

Seuraavien kolmen esimerkin importit olettavat tiedoston suoraan vastaavassa
`tests/system`, `tests/web` tai `tests/electron`-hakemistossa. ID:t viittaavat
linkitettyihin nykyisiin skenaarioihin: älä lisää niiden rinnalle kopioita
samasta testistä. Anna uudelle skenaariolle matriisiin kuuluva oma tunniste.

### System: kirjoitus ja julkinen lukusopimus

Lyhennelmä [customerAndCompanyApi.spec.ts](../../apps/e2e/tests/system/customerAndCompanyApi.spec.ts)-testistä:

```ts
import { createSyntheticCustomerInput } from '../../src/data/syntheticBusinessInputs.js';
import { expect, test } from '../../src/fixtures/isolatedBackendTest.js';

test('CUS-API-001 @critical creates and lists a synthetic customer', async ({ e2eBackend }) => {
  const input = createSyntheticCustomerInput();
  const created = await e2eBackend.api.post('/customers', { data: input });
  expect(created.status()).toBe(201);
  const listed = await e2eBackend.api.get('/customers');
  expect(listed.status()).toBe(200);
  expect(await listed.json()).toMatchObject({
    customers: [{ customerNumber: input.customerNumber, name: input.name }],
  });
});
```

Valmis fixture hoitaa autentikoidun API-contextin. Session-eston laajempi malli
on [sessionBoundary.spec.ts](../../apps/e2e/tests/system/sessionBoundary.spec.ts).
Älä kopioi sessionia tulosteeseen tai rendererille.

### Web: käyttäjän toiminto ja havaittava valmistuminen

Lyhennelmä [customerAndCompanyJourneys.spec.ts](../../apps/e2e/tests/web/customerAndCompanyJourneys.spec.ts)-testistä:

```ts
import { expect, test } from '../../src/fixtures/isolatedWebTest.js';

test('CUS-UI-001 @critical creates a synthetic customer through the UI', async ({ e2eWeb }) => {
  const { page } = e2eWeb;
  await page.getByRole('button', { name: 'Uusi asiakas' }).click();
  await page.getByRole('group', { name: 'Asiakasnumero' })
    .getByText('Syötä itse', { exact: true }).click();
  await page.getByLabel('Asiakasnumero *').fill('E2E-2101');
  await page.getByLabel('Nimi *').fill('Synthetic Customer Oy');
  await page.getByLabel('Katuosoite').fill('Testikatu 1');
  await page.getByLabel('Postinumero').fill('00100');
  await page.getByRole('textbox', { name: 'Kaupunki', exact: true }).fill('Testikaupunki');
  const created = page.waitForResponse((response) =>
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === '/customers');
  await page.getByRole('button', { name: 'Lisää', exact: true }).click();
  expect((await created).status()).toBe(201);
  await expect(page.getByRole('heading', { level: 2, name: 'Synthetic Customer Oy' }))
    .toBeVisible();
});
```

Suosi role-, label-, teksti- ja placeholder-lokaattoreita tässä järjestyksessä.
Odota havaittavaa vastausta tai tilaehtoa, älä `waitForTimeout`-kutsua.
Fault-esimerkki on [invoiceFailureJourneys.spec.ts](../../apps/e2e/tests/web/invoiceFailureJourneys.spec.ts):
sen `test.use({ e2eFaultPlan: ... })` asetetaan ennen runtimen käynnistystä.
Sallitut faultit omistaa [fault plan](../architecture/e2e-test-environment.md#fault-plan).

### Electron: data säilyy restartissa

Lyhennelmä [desktopCapabilities.spec.ts](../../apps/e2e/tests/electron/desktopCapabilities.spec.ts)-testin
`DESK-RESTART-001`-polusta käyttäen yhteistä synteettisen asiakkaan muodostajaa:

```ts
import { createSyntheticCustomerInput } from '../../src/data/syntheticBusinessInputs.js';
import { expect, test } from '../../src/fixtures/isolatedElectronTest.js';

test('DESK-RESTART-001 @critical @recovery retains a synthetic customer', async ({ e2eElectron }) => {
  const input = createSyntheticCustomerInput();
  const created = await e2eElectron.api.post('/customers', { data: input });
  expect(created.status()).toBe(201);
  const previous = await e2eElectron.restart();
  expect(e2eElectron.runtime.runtimeInstanceId).not.toBe(previous.previousRuntimeInstanceId);
  const listed = await e2eElectron.api.get('/customers');
  expect(listed.status()).toBe(200);
  expect(await listed.json()).toMatchObject({
    customers: [{ customerNumber: input.customerNumber, name: input.name }],
  });
  await expect(e2eElectron.page.getByRole('heading', { name: 'Asiakkaat' })).toBeVisible();
});
```

Restart päivittää fixturen `api`-, `page`-, `electronApp`- ja `runtime`-viitteet.
Käytä niitä restartin jälkeen fixturen kautta. Kokonainen lähdetesti todistaa
myös vanhan sessionin hylkäyksen; yllä oleva lyhennelmä ei todista sitä.

## Jaettu selain ei jaa testitilaa

Nykyinen web-projekti käyttää yhtä workeria ja sen omistamaa Chromiumia.
Jokainen testi saa silti uuden Playwright-contextin ja pagen sekä oman
backendin, Viten, sessionin ja business-datan. Worker-juuressa ovat vain
selaimen profiili-, temp- ja kontrollitiedostot. Älä jaa contextia,
evästeitä tai dataa skenaarioiden kesken äläkä kutsu `browser.close()` itse.

Fixture sulkee testin contextin ja palvelut ennen testidatan poistoa.
Worker-juuri poistuu vasta varmennetun prosessipuun siivouksen jälkeen.
Epävarma cleanup ei saa muuttua uuden workerin onnistuneeksi retryksi.
Omistajuus on kuvattu [prosessien elinkaaressa](../architecture/e2e-test-environment.md#prosessien-elinkaari);
[sharedChromiumIsolation.spec.ts](../../apps/e2e/tests/web/sharedChromiumIsolation.spec.ts)
todistaa kahden oikean fixture-elinkaaren välisen eristyksen.

## Valmistelu ja komennot

Aja komennot lähdejuuresta, jossa [juuren package.json](../../package.json) on.
Se määrää Node- ja pnpm-versiot; [E2E-manifesti](../../apps/e2e/package.json)
määrää Playwright-version ja valmisteluketjut. Windowsin paikalliset ajot
käyttävät natiivia Windows-työkaluketjua ja nykyistä .NET 10 -testiomistajaa.
Noudata juuri-AGENTS:n paikallisen runbookin lukureittiä kopioimatta sen tietoja
yhteiseen dokumentaatioon. Puuttuva työkalu ei ole uusi asennushyväksyntä.

Lukitut riippuvuudet ja web-testejä varten hyväksytty Chromium:

```text
pnpm install --frozen-lockfile
pnpm --filter @eky/e2e exec playwright install chromium
```

| Tarkoitus | Lähdejuuren komento |
| --- | --- |
| Koko system-projekti | `pnpm test:e2e:system` |
| Koko web-projekti | `pnpm test:e2e:web` |
| Webin kriittiset polut | `pnpm --filter @eky/e2e e2e:web:critical` |
| System ja web, vain `@critical` | `pnpm test:e2e:critical` |
| Kaikki kolme tavallista projektia, vain `@security` | `pnpm test:e2e:security` |
| Kaikki kolme tavallista projektia, vain `@fault` | `pnpm test:e2e:fault` |
| Electron development | `pnpm test:e2e:electron` |
| Electronin kriittiset polut | `pnpm test:e2e:electron:critical` |
| Kolme tavallista projektia ilman tagirajausta | `pnpm test:e2e:all` |

Nämä ajokomennot tekevät oman valmistelunsa. `e2e:prepare` rakentaa permissions-,
auth- ja backend-E2E-tuotteet sekä Windowsissa prosessiomistajan.
`e2e:electron:prepare` valmistaa lisäksi Electron-runtimen, webin ja desktopin
buildit, desktop-E2E-buildin sekä backend-stagen. `security`, `fault` ja `all`
käyttävät Electron-valmistelua ja tarvitsevat Windowsin. Pelkkä `pnpm test`
ajaa workspace-testit, ei tätä Playwright-skenaariovalikoimaa.

Yksittäinen system- tai web-tiedosto valmistellaan ensin; suora `exec` ei buildaa:

```text
pnpm --filter @eky/e2e e2e:prepare
pnpm --filter @eky/e2e exec playwright test --project=system-api tests/system/customerAndCompanyApi.spec.ts --grep CUS-API-001
pnpm --filter @eky/e2e exec playwright test --project=web-chromium tests/web/isolatedWebRuntime.spec.ts
```

Electronin vastaava rajattu ajo Windowsissa:

```text
pnpm --filter @eky/e2e e2e:electron:prepare
pnpm --filter @eky/e2e exec playwright test --project=electron-development tests/electron/desktopCapabilities.spec.ts --grep DESK-RESTART-001
```

Linuxin todelliset backend-, Vite- ja Chromium-kuluttajat on rajattu nykyiseen
GitHub Actions -CI:hin: `EKY_E2E=1`, `CI=true`, `GITHUB_ACTIONS=true`, nonroot-
identiteetti sekä nykyisen systemd-/cgroup-eristyksen edellytykset tarkistetaan.
Tämä ei ole paikallisen Linuxin tai WSL:n ajoreitti; älä jäljittele CI:tä
ympäristömuuttujilla. Electron-fixture hyväksyy vain Windowsin.
Web-worker hyväksyy vain headless-Chromiumin ilman channel- tai omia
launchOptions-asetuksia; `DEBUG`, `PWDEBUG` ja `PW_TEST_REUSE_CONTEXT` torjutaan.

Nykyinen [CI-workflow](../../../.github/workflows/ci.yml) käyttää Linuxissa koko
system-projektia ja webin critical-komentoa sekä Chromiumin
`playwright install --with-deps chromium` -valmistelua. Windowsin Electron-
critical on erillinen portti. Jobin nimi ei yksin kerro tagivalintaa.
`tests/stress` ja `tests/electron-stress` sekä `test:e2e:stress`,
`test:e2e:desktop-stress` ja `test:e2e:desktop-soak` ovat erillistä manuaalista
endurance-työtä, eivät tavallisen `all`-ajon osa. Katso
[CI ja endurance](../architecture/e2e-testing-strategy.md#ci-ja-endurance).

## Kun testi epäonnistuu

Sovi ajon seuranta [workflow-ohjeen](workflow.md#ci-ajon-seuranta-ja-virhetodisteet)
mukaan ennen käynnistystä. Säilytä ensimmäisen epäonnistuneen yrityksen
revisio, komento, scenario ID, yritysnumero, vaihe, turvallinen virheluokka
ja erillinen cleanup-tulos ennen mahdollista uutta ajoa.

- Paikallinen HTML-raportti on `apps/e2e/playwright-report/`; avaa se komennolla
  `pnpm test:e2e:report`. Yrityskohtaiset tulokset ovat `apps/e2e/test-results/`.
- System/web-fixture liittää saatavilla olevat synteettiset virhetodisteet
  raporttiin ja tarvittaessa `service-fixture-cleanup`-tuloksen. Electronin
  vastaava todiste on `electron-lifecycle` / `electron-lifecycle.json`.
- Nykyinen config käyttää paikallisesti nollaa retryä ja CI:ssä yhtä;
  `failOnFlakyTests` hylkää CI:ssä vasta retryllä läpäisevän testin.
  `trace: on-first-retry` ei lupaa ensiyrityksen tracea. Kuvakaappausasetus on
  `only-on-failure`, video pois. Puuttuva liite ei todista onnistumista.
- Älä käynnistä sokkona uudelleen, pidennä timeoutia, lisää sleepiä tai löysennä
  assertionia. Uusi ajo voi tyhjentää aiemman tuloshakemiston; säilytä ensivirhe
  ensin. Tarkista setup, testin ehto ja cleanup erillisinä tuloksina.
- Epävarmasti siivottu testijuuri jää yksityiseen temp-alueeseen. Älä poista
  prosessinomistajan varauksia tai säilytettyä juurta onnistumisen saamiseksi.
  Raakaraportti ei ole julkaistava artifact: nykyinen Electron-CI julkaisee
  vain rajatut lifecycle-JSONit, ei koko tuloshakemistoa tai tracea.

Noudata [artefaktisopimusta](../architecture/e2e-test-environment.md#artefaktit),
[selainverkon rajaa](../architecture/e2e-test-environment.md#selainverkon-raja) ja
[julkaisurajaa](../architecture/security-principles.md#omistajan-tietojen-julkaisuraja).
Raportoi ajetut ja ajamatta jääneet tarkistukset erikseen
[valmistumisportissa](workflow.md#toiminnon-valmistumisportti).
