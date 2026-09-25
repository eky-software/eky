# E2E-testiympäristö

Tämä dokumentti määrittelee Eky R0:n Playwright-pohjaisen järjestelmätestauksen
turvarajat. E2E-runtime on testausinfrastruktuuria, ei liiketoimintamoduuli.

## Omistajuus

`apps/e2e` omistaa Playwright-konfiguraation, testien prosessien elinkaaren,
testikohtaiset polut, selainverkon estot ja turvalliset epäonnistumisartefaktit.

Backendin testikoostaminen kuuluu `apps/backend/e2e`-alueelle. Se saa koota
production-portteihin testiadaptereita, mutta sitä ei käännetä tavalliseen
backend-buildiin eikä pakata desktop-sovellukseen. Production-koodiin ei lisätä
testireittejä, reset-pintoja, testipainikkeita tai rendereristä ohjattavaa
fault injectionia.

## T-paketin valmistelu

**2026-09-25: T1 ja T2 hyväksytty PR/main-porttien jälkeen; T3:n
omistajuusmekanismi valmistelussa.** [M1-valmistelu](release-0.3.0-m1-preparation-plan.md)
rajaa R27-R29:n kolmeen erikseen todennettavaan sopimukseen. M0:n erillinen
Windows Job -supervisor ja Electronin lataus-/purkutodistus eivät sulje näitä.

### T1: Testien ajokytkentä

T1:n lähtötilan desktopin `test`-komento jätti
`e2e/electronE2eWorkspaceStartupFailure.test.ts`-tiedoston seitsemän tapausta
valinnan ulkopuolelle. Lisäksi seuraavat `installer/windows-acceptance-harness/`
-tiedostot olivat vain clean/upgrade-skripteissä, joita nykyiset workflowt eivät kutsu:

- `cleanInstallUninstallContracts.test.mjs`
- `cleanInstallUninstallLifecycle.test.mjs`
- `cleanInstallUninstallPayload.test.mjs`
- `localImmutableInstallerFixture.test.mjs`
- `upgradeRollbackBinaryHandoff.test.mjs`
- `upgradeRollbackProgress.test.mjs`

T1a lisää startup-testin tavalliseen desktop-valintaan. T1b liittää kuusi
harness-tiedostoa nykyiseen vaadittuun komentoketjuun niiden vastuun mukaan.
Hyväksytty täsmällinen jako, nykyiset testit säilyttäen:

- `pnpm --filter @eky/desktop test`: startup-failure-tiedosto nykyiseen
  Vitest-osaan ja uusi ajokytkennän sopimustesti nykyiseen `node --test` -osaan.
- `pnpm --filter @eky/desktop installer:test:unit`: yllä luetellut kolme
  `cleanInstallUninstall*`-tiedostoa, `localImmutableInstallerFixture.test.mjs`
  ja `upgradeRollbackProgress.test.mjs`.
- `pnpm --filter @eky/desktop installer:test:windows-process`:
  `upgradeRollbackBinaryHandoff.test.mjs` nykyiseen
  `node --test --test-concurrency=1` -kutsuun. Supervisor-build-esiehto säilyy.

Nykyinen `Windows installer contract tests` -jobi kutsuu kahta viimeistä
komentoa ja `windowsContracts`-aggregaatti vaatii niiden kummankin vaiheen
onnistumisen. Tavallinen desktop-testi kuuluu workspace-testien ketjuun.
Workflowta tai riskipolitiikkaa ei tarvitse muuttaa tätä kytkentää varten.
Uusi valinnan sopimustesti todistaa myös oman ajokytkentänsä, oikean
komentoryhmän ja native-komennon sarjallisuuden. Negatiivisiin tapauksiin
kuuluvat myös oma puuttuva kutsu, väärä ryhmä ja poistettu sarjallisuuslippu.

Tarkista koko ketju tiedostosta required-aggregaattiin; pelkkä käännös,
samanniminen workflow tai testattavan toteutuksen välillinen käyttö ei riitä.
Nykyinen sarjallisuus ja native-testien edellytykset säilyvät. Valinnan
negatiivinen sopimustesti hylkää puuttuvan tiedoston/kutsureunan. Varsinainen
komento suoritetaan ja sen tulos sidotaan täsmälliseen revisioon.

T1a/T1b:n `apps/desktop/scripts/test-command-wiring.test.mjs` sisältää
58 tapausta ja kuuluu itse tavalliseen desktop-komentoon. Todelliset
komentotulokset, valmistumisportin soveltuvuus ja PR/main-integraation
erillinen hyväksyntä ovat
[M1:n T1-checkpointissa](release-0.3.0-m1-preparation-plan.md#t1n-toteutus-ja-hyväksyntänäyttö).
Tämä ei sulje alla olevia projektivalinnan ja prosessipuun jatkorajoja.

### T2: Projektivalinta ja valmistelu

**Tila 2026-09-25: T2 toteutettu ja hyväksytty, myös Linux-CI ja
PR/main-portit.** Lähtörevisio ja hyväksyntänäyttö ovat
[M1-suunnitelmassa](release-0.3.0-m1-preparation-plan.md#t2n-integraatiohyväksyntä).

T2:n lähtötilassa `e2e:security` ja `e2e:fault` valitsivat tageilla myös
Electron-testejä mutta kutsuivat vain backendin valmistelua. Electron-runtime käyttää
desktopin `dist`- ja `e2e-dist`-tuotteita, webin `dist`-tuotetta ja
`e2e-backend-stage`-hakemistoa. Vanhojen tuotteiden olemassaolo voi peittää
puuttuvan valmistelun. Pelkkä vihreä CI ei todista näitä kahta komentoa:
nykyinen `System security E2E` ajaa koko system-projektin, ja Windowsin
Electron-critical käyttää omaa, jo täydellistä valmisteluaan.

#### T2:n hyväksytty muutosraja

`apps/e2e/package.json`:n kaksi aggregaattia muutettiin seuraaviksi;
juuripaketin nykyiset `test:e2e:security`- ja `test:e2e:fault`-aliakset säilyvät:

```text
e2e:security = pnpm e2e:electron:prepare && playwright test --project=system-api --project=web-chromium --project=electron-development --grep @security
e2e:fault = pnpm e2e:electron:prepare && playwright test --project=system-api --project=web-chromium --project=electron-development --grep @fault
```

Käytä olemassa olevaa `e2e:electron:prepare`-omistajaa. Älä monista sen
ketjua, lisää yleistä komentorunneria tai muuta build-/staging-toteutusta
ennakoivasti. Puuttuva runtime tai epäonnistunut valmistelu on virhe, ei
peruste pudottaa Electron-projektia valinnasta. Chromiumin asennus kuuluu
nykyisiin työkaluesiehtoihin; aggregate ei asenna uutta riippuvuutta.

Lähdekatselmuksessa löytyi lisäksi rajattu projektivalinnan päällekkäisyys:
`endurance-baseline`-projektin `/stress\/.*\.spec\.ts/` osuu myös
`electron-stress`-hakemistoon. Hyväksytty T2-rajaus korjaa tämän
`testMatch`-ehdon hakemistorajan samassa konfiguraatiossa.
Omistajan hyväksyntä kattaa myös tämän korjauksen: desktopin stress/soak
säilyy omassa `electron-endurance`-projektissaan, eikä testiä poisteta.
Muuta projektivalintaa tai tagitusta ei laajenneta samalla.

Säilytettävät valinnat:

| Komentoperhe | Projektit ja suodatus |
| --- | --- |
| security / fault | Kolme standardiprojektia ja vastaava tagi; ei lisäehtoa `@critical`. Myös nykyiset ei-kriittiset security/fault-tapaukset säilyvät. |
| critical | Nykyiset system + web; Electron-critical pysyy omana komentonaan. |
| all / electron | Nykyiset standardiprojektit / Electron-development ilman uutta tagirajausta. Tavallinen diagnostic-contract säilyy. |
| stress / desktop-stress / desktop-soak | Omat endurance-projektit; desktopin kaksi komentoa säilyttävät nykyiset taginsa ja sarjallisuuden. |

Erillinen first-start-diagnostic-konfiguraatio ei tule normaaliin valintaan.
Aikarajat, workerit, retry-/flaky-ehdot, CI-jobit, riskiluokitus ja vaaditut
toistot eivät muutu. Laajempi komentojen jakaminen tarvitsee uuden päätöksen.

#### T2:n valmisteluketju

Puhtaan lähtötilan nykyinen edellytysketju hyväksyttyjen työkalujen jälkeen:

- system/web: permissions -> auth -> backendin `e2e:build`; web tarvitsee
  myös Playwrightin Chromiumin, mutta Vite käyttää webin lähdettä
- Electron: Electron-runtime -> permissions -> auth -> backendin
  `e2e:build` -> web build -> desktop build -> desktop `e2e:build` ->
  backend staging; staging tekee vielä tavallisen backend-buildin,
  production-deployn, E2E-backendin kopioinnin ja native-SQLite-tarkistuksen.

Stagingin omistaja on desktopin `prepare-electron-e2e-backend.mjs`.
Se poistaa vanhan stagen, rakentaa tavallisen backendin, tekee production-
deployn, kopioi E2E-backendin ja tarkistaa native-SQLiten. T2 todentaa tämän
ketjun käytön; SQLite-ajuria tai sovelluksen paketointia ei muuteta.

#### T2:n regressiosuoja

Todistus jaetaan kolmeen tasoon, joita ei merkitä toistensa korvikkeiksi:

1. **Tavallinen Node-sopimustesti.** Lisää E2E-paketin omistama pieni
   `scripts/e2e-command-wiring.test.mjs` ja sen `test`-kytkentä nykyiseen
   workspace-testiketjuun. Käytä Node-vakiokirjastoa ja jäsennettyjä
   package-manifesteja. Rajaa komentojen tulkinta nykyisiin nimettyihin
   kutsuihin ja `&&`-ketjuun, älä rakenna shell-parseria. Todista oma
   ajokytkentä, juurialiakset, projektit/tagit, valmistelun omistaja ja
   vaiheiden järjestys. Testi ei käynnistä buildia, selainta tai Electronia.
2. **Oikean konfiguraation sopimustesti.** Lisää system-projektiin puhdas
   Playwright-testi, joka importtaa nykyisen konfiguraation Playwrightin
   omalla tuella ja käyttää base-`test`-rajapintaa ilman runtime-fixtureä.
   Tarkista oikeat `testMatch`-ehdot ja projektien erillisyys sekä nykyiset
   worker-/retry-/flaky-rajat. Älä jäsennä TypeScript-lähdettä regexillä
   tai lisää tätä varten uutta parseririippuvuutta.
3. **Todellinen discovery ja suoritus.** Valmistelun jälkeen aja native-
   Playwrightin `--list --reporter=json` vastaavilla projektien ja tagien
   valinnoilla. Tarkista exit-koodi, virheet sekä jäsenyys tunnisteella
   projekti + repository-relative-tiedosto + koko suite/test-otsikko.
   Huomioi parametrisoidut tapaukset ja suitesta perityt tagit. Pelkkä
   määrä tai onnistunut listaus ei ole testiläpäisy. Älä liitä discoverya
   sokkona ennen buildia ajettavaan workspace-unit-vaiheeseen, sillä se
   lataa myös testien importit.

Kielteiset sopimuskokeet poistavat valmistelun, vaihtavat kutsujärjestyksen,
katkaisevat oman testikytkennän tai muuttavat projektin, tagin tai muun
suodattimen. Tuntematon projekti, ylimääräinen positional filter tai
`grepInvert` ei saa huomaamatta kaventaa valintaa. Synteettiset
ei-`@critical`-Electron-tapaukset säilyvät security/fault-valinnassa;
endurance-tapaukset jäävät pois myös tageilla `@security`, `@fault` ja
`@critical`. Poistettu critical-tagi ei saa laajentaa critical-komentoa
automaattisesti. Nämä kokeet muuttavat testisyötettä, eivät oikeiden
skenaarioiden tageja. Endurance-hakemistoraja testataan molempien
alustojen poluilla ja todellisella discoverylla.

Ennen/jälkeen-listauksen hyväksytyt erot ovat uudet sopimustapaukset ja
desktop-endurancen poistuminen väärästä baseline-projektista. Sen omat
desktop-stress/soak-tapaukset säilyvät. Muu kadonnut, yllättävästi lisätty
tai kahteen projektiperheeseen osuva tapaus vaatii selvityksen; tyhjä
lista tai import-virhe ei läpäise sopimusta.

#### T2:n ajotodistus ja hyväksyntä

| Lähtötila | Koe ja vaadittu näyttö |
| --- | --- |
| Puhdas | Eristetyssä checkoutissa ei ole ketjun aiempia build-/stage-tuotteita. Oikea valmistelu tuottaa ne; molemmat juurialiakset suorittavat tarkoitetut tapaukset. |
| Vanhat tuotteet | Samassa synteettisessä koealueessa tuotteisiin lisätään tunnistettava vanha sisältö ja ylimääräinen sentinel. Valmistelu korvaa sisällön ja poistaa vanhan sentinelin; testiruntimen kopiot vastaavat uusia tuotteita. Pelkkä tiedoston olemassaolo tai mtime ei riitä. |
| Valmistelun virhe | Rajattu komentofixture tuottaa ei-nollatuloksen vuorollaan nimetyissä esiehdoissa ja todistaa, ettei myöhempi vaihe tai Playwright-launch käynnisty. Oikeasta ketjusta todetaan lisäksi vähintään yksi hallittu build-virhe ja yksi staging-virhe vanhojen tuotteiden ollessa olemassa. Mockettua koetta ei nimetä oikeaksi build-todisteeksi. |

Kokeiden faultit elävät vain kopioidussa testialueessa tai testifixturessa;
ei uusia tuotannon fault-kytkimiä, muutoksia käyttäjäprofiileihin tai
hyväksyttyihin release-artifacteihin. Kopiot ovat itsenäisiä tiedostotavuja,
eivät hardlinkkejä. Alkuperäinen valmisteluvirhe ja komennon ei-nollatulos
säilytetään; puuttuva valmistelu ei saa käyttää vanhaa stagea.
Rinnakkaisia build-/E2E-ajoja samaan työpuuhun ei käynnistetä.

Etene sopimustesteistä discoveryyn ja valmistelukokeisiin, sitten molempiin
oikeisiin aggregate-ajoihin Windowsissa. Nykyinen Linux-CI todentaa
Node-/system-sopimukset; polkusopimus kattaa molempien alustojen muodot.
T2 ei vaadi uutta workflowta: nykyisen CI:n system-ajo löytää system-
sopimuksen ja recursive test löytää E2E-paketin Node-sopimuksen.
Niiden onnistuminen ei yksin korvaa kahden aggregaatin omaa ajotodistusta.
Nykyiset muut required-portit säilyvät.

Seuraa jokaista ajoa alusta loppuun
[CI-seurantaohjeen](../ai/workflow.md#ci-ajon-seuranta-ja-virhetodisteet)
mukaan ja säilytä ensimmäinen virhe ennen mahdollista uusintaa. Kirjaa
revisio, tarkka valinta, valmistelun tulos, valmiit/ohitetut/flaky-tapaukset
ja siivouksen tulos erikseen. Raakatulosteet ja konekohtainen näyttö
pysyvät paikallisina; yhteiseen checkpointiin vain turvallinen yhteenveto.

T3:n tunnettu prosessipuun puute pysyy avoimena: T2:n vihreä ajo ei todista
sitä korjatuksi. Jos ajon siivous jää epävarmaksi, kyseistä ajoa ei hyväksytä,
testijuuri säilytetään ja uusi launch odottaa omistettujen prosessien
selvittämistä. T2 ei korjaa lifecycleä sivutyönä. Myöhempi A:n lopullinen
oikeaprosessihyväksyntä tarvitsee edelleen T3:n korjauksen.

R29 suljetaan vasta rajauksen toteutuksen, yllä eritellyn näytön,
riippumattoman diff-katselmuksen ja normaalien PR/main-porttien jälkeen.
Jos nykyisessä build-/staging-toteutuksessa paljastuu korjattavaa, pysäytä
juuri sen vaikutusalue ja rajaa korjaus ennen toteutusta. Tuotannon
Diagnostics-, Activity-, tukipaketti- tai backup-sopimus ei muutu T2:ssa;
uudet testihavainnot kuuluvat testirunnerin raporttiin, eivät business-auditiin.

Paikallisen toteutuksen ja kokeiden kooste on
[T2-checkpointissa](release-0.3.0-m1-preparation-plan.md#t2n-toteutus-ja-paikallinen-näyttö).
Suunnitelman todistusrajat säilyvät myös myöhemmissä muutoksissa.

### T3: Koko prosessipuun poistumistodiste

**Tila 2026-09-25: lähdekatselmus ja rajattu koesuunnitelma valmisteltu;
T3a:n toteutuspäätös avoin.** Lähtökohta on hyväksytty T2-main;
[M1:n päätösportti](release-0.3.0-m1-preparation-plan.md#t3n-toteutukseen-siirtymisen-portti)
erottaa valmistelun, teknisen kokeen ja varsinaisen kuluttajien siirron.

`stopManagedProcessTree` hyväksyy nyt poistuneen root-prosessin liian
aikaisin. Portittoman jälkeläisen poistumista ei todista rootin exit,
vapautunut portti tai `taskkill`-apuprosessin valmistuminen. POSIXissa
rootin poistuminen kesken stopin ei saa jättää jälkeläisiä eskalaation ulkopuolelle.

Ennen korjausta rajataan launch-hetkestä säilyvä omistajuus ja todistuksen
antava mekanismi Windowsille ja POSIXille sekä saman apurajapinnan Electron-
kuluttajille. Installerin Job-omistajuutta ei oleteta Playwrightin omistajuudeksi.
Pelkkä PID-luku tai jälkikäteen arvaava prosessihaku ei oikeuta tappamaan
prosessia. Tuntematon kyselytulos ei ole poissaolon todiste.

Hyväksyntään kuuluvat root-exits-first, root-exits-during-stop, elävä
portiton jälkeläinen, pysäytystä vastustava jälkeläinen, launch-/taskkill-/
kyselyvirhe, PID-uudelleenkäyttö ja riippumattoman sentinel-prosessin säilyminen.
Oikeat prosessit käynnistetään vain eristettyyn testijuureen. Jos koko puun
poistumista ei todenneta, cleanup epäonnistuu, juuri säilyy eikä restart
käynnistä uutta omistajaa. Alkuperäinen virhe, cleanup ja rajatun näytön
tallennus arvioidaan erikseen. Tuotantolifecycleen ei tehdä sivukorjausta.

T1:n katselmuksessa kirjattiin myös erillinen jatkotarkistus:
`upgradeRollbackBinaryHandoff.test.mjs` käynnistää yhdessä tapauksessa
suoran synteettisen Node-lapsen ilman virhepolun erillistä `finally`-siivousta.
Normaalipolku todentaa lapsen `close`-tapahtuman, mutta testin timeout tai
komennon supervisor-build ei todista tämän lapsen virhepolun omistajuutta.
Tarkistus kuuluu T3:n rajaukseen ennen fixturen laajentamista; T1 ei muuta
testin elinkaarta eikä sen läpäisy osoita tätä jatkokohtaa ratkaistuksi.

T1/T2/T3 tarvitsevat omat todelliset läpäisynsä. Testikattavuutta, aikarajoja,
flaky-hylkäystä, pakollisia jobeja tai toistoja ei kevennetä tämän työn vuoksi.
T3:n puute korjataan ennen sen fixturen käyttämistä A:n lopullisena
oikeaprosessi-/E2E-hyväksyntänä. Alemmat puhtaat sopimustestit voidaan
valmistella rinnalla. Tämä valmistelu ei ole uusi testitulos.

#### T3:n lähdehavainnot ja kuluttajat

Lähdekatselmus kohdistui T2-mainiin `5cc58b7139a6616bc9403a5724f93d929e90cf25`.
Windows- ja Linux-vaihtoehdot arvioitiin erillisillä read-only-agenteilla.
Havainnot ovat koodista pääteltyjä puutteita, eivät tässä valmistelussa ajettuja
vikatoistoja tai väite siitä, että aiempi ajo jätti prosesseja eloon.

| Vastuu | Nykyinen raja ja suunnittelun vaikutus |
| --- | --- |
| `src/environment/startManagedProcess.ts`, `stopManagedProcessTree.ts` | Node-kahva ja POSIXin `detached` eivät muodosta koko puun säilyvää omistajaa. Sekä alkupaluu että eskalaation ehto riippuvat rootista. Myös epäonnistuneen ryhmäsignaalin root-only-fallback on arvioitava. |
| `runBoundedWindowsTaskkill.ts` | Apuprosessin `exit` ratkaisee promisen ilman exit-koodin tarkistusta. Sen valmistuminen ei joka tapauksessa todista omistetun puun tyhjyyttä. Ei pelkkää exit-koodipaikkausta R28:n sulkemiseksi. |
| `startE2eBackendProcess.ts`, `startE2eWebProcess.ts`, service-fixturet | Health ja rootin exit säilyvät runtime-havaintoina; tree-stop saa oman todistusrajansa. Nykyinen alkuperäisen virheen säilytys, juuren säilytys ja restartin esto pidetään. |
| `isolatedElectronTest.ts`, `launchElectronRuntime.ts`, `stopOwnedElectronRuntime.ts` | Playwright käynnistää Electronin; nykyinen kahva saadaan vasta launch-promisen valmistuttua. Jälkikäteen liittäminen ei sulje ennen yhteyttä syntyvää omistajuusaukkoa. |
| `isolatedElectronTest.ts` / `launchSecondElectronInstance`, `tests/electron/desktopCapabilities.spec.ts` / `runElectronProcess` | Suorat Electron-lapset hyväksyvät rootin exitin; timeout pyytää tappoa mutta ei odota koko puun poistumistodistetta. Nämä kuuluvat samaan siirtokarttaan. |
| `tests/system/restartAndRecovery.spec.ts`, backup import/replacement -testit, `tests/stress/enduranceBaseline.spec.ts` | Rootin exit ja rootien lukumäärä eivät yksin tue koko puun poissaoloväitettä. Päivitä assertiot omistavan rajapinnan mukana, älä poista nykyisiä data-, session- tai porttiehtoja. |
| Desktopin `upgradeRollbackBinaryHandoff.test.mjs` | Suora Node-lapsi tarvitsee virhepolun välittömän cleanup-rekisteröinnin, poistumisen odotuksen ja oman regressionsa. Ei installerin tuotantokorjausta. |

E2E-polut ovat suhteessa `apps/e2e`-kansioon. RSS-kyselyn ja synkronisen
testiapukomennon omat rajatut elinkaaret tarkistetaan siirron yhteydessä;
niitä ei nimetä business-runtimen jälkeläisomistajiksi.

#### T3:n omistajuusehdotus

Tämä on hyväksyttävä ehdotus, ei jo toteutettu yleinen prosessipalvelu:

1. `apps/e2e` omistaa testikohtaisen, sukupolveen sidotun puukahvan.
   Stop ei hyväksy mielivaltaista PID:tä tai jälkikäteen adoptoitua
   `ChildProcess`-oliota omistajuustodisteeksi. Rootin tila ja stdout/stderr
   ovat erillisiä havaintoja, eivät puun omistajuus.
2. Omistajuus syntyy ennen kuin varsinainen workload voi luoda jälkeläisiä.
   Alustan omistusobjekti ja sen kontrolliyhteys säilyvät rootin poistuessa.
   Suljettua objektia ei avata uudelleen samalla nimellä, polulla tai PID:llä.
3. Yksi omistaja hoitaa kyseisen puun stopin, eskalaation ja poistumistodisteen.
   Nykyisten turvabudjettien sisäinen jako kuvataan ennen kytkentää;
   ei pidempiä aikarajoja, rinnakkaisia tappajia tai hiljaista retryä.
4. Rootin poistuminen, koko puun tyhjyys, valvojan poistuminen, portin
   vapautuminen ja tuloksen tallennus ovat erillisiä ehtoja. Käynnistysvirhe
   tai myöhäinen pending-launch ei saa tuottaa valheellista tyhjyyttä.
5. Virheellinen, vanhan sukupolven tai puuttuva omistajuus-/terminal-kuitti,
   kyselyvirhe ja katkennut kontrolliyhteys ovat varmentamattomia tuloksia.
   Ne estävät uuden launchin ja testijuuren poiston; aiempi epävarmuus ei
   katoa myöhemmällä onnistumisella. Toistettu stop ei kohdista uutta
   signaalia mahdollisesti uudelleen käytettyyn tunnisteeseen.
6. Testin alkuperäinen virhe säilyy ensisijaisena. Puun cleanup ja rajatun
   näytön kirjoitus raportoidaan erikseen nykyiseen turvalliseen
   service-/Electron-fixtureketjuun. Ei raakaa ympäristöä, polkuja, PID:itä,
   sessionia tai vapaata virhetekstiä julkaistavaan liitteeseen.

Windowsin ensisijainen koesuunta on nykyisten native Job- ja suspended-launch-
primitiivien uudelleenkäyttö erillisessä **testisessiossa**.
`WindowsJob`, `ProcessCreationJobAttribute` ja `SuspendedWindowsProcess`
ovat lähdekatselmuksen perusteella hyödyllinen pohja. Nykyinen installer-
supervisor vaatii kuitenkin suljetun batch-requestin, scenario-/artifact-
sidonnan ja worker-resultin. Sillä ei ole E2E:n tarvitsemaa elävää stop-
kanavaa eikä request-kohtaista stdio-/environment-sopimusta. Tavalliselle
palvelimelle ei valmisteta tekaistua installer-tulosta. Installerin nykyiset
moodit, tulosschema, deadline ja käyttäytyminen säilytetään.

Kokeessa erotetaan varsinainen runtime, käynnistysadapteri ja puun omistaja.
`electron.launch({ executablePath })`-adapteri on vasta vaihtoehto:
argumenttien, ympäristön, stdion, `process()`-kahvan merkityksen sekä
`exit`/`close`-järjestyksen säilyminen on todistettava oikealla Electronilla.
Playwrightin yksityiseen toteutukseen ei tehdä monkey patchia, eikä
production-fuseja, sandboxia tai preloadia muuteta. Omistajan pitää olla
tavoitettavissa jo launchin epäonnistuessa ennen `ElectronApplication`-kahvaa.
Mahdollinen valvojan pakkopoistuminen ei itsessään kelpaa terminal-kuitiksi.

Linuxin nykyiset system-/web-CI-ajot tarvitsevat oman mekanismin; Windowsin
Job-ratkaisu ei kata niitä. Ensisijainen **selvitettävä** vaihtoehto on
launchista omistettu cgroup v2: sama omistusobjekti, periytyvä jäsenyys,
ryhmäkohtainen lopetus ja erillinen live-jäsenten tyhjyystodiste.
Ensin selvitetään vain lukemalla nykyisen suoritusympäristön saatavuus,
delegointi ja mahdollinen systemd-reitti. `ubuntu-latest` tai paikallinen
WSL ei yksin todista CI:n käyttöoikeuksia. Cgroup ei ole tässä hyväksytty
riippuvuus tai käyttöönotto. Cgroup-kirjoitus, transient-service, delegointi,
oikeusmuutos tai uusi native-toolchain vaatii nimetyn jatkopäätöksen.
Myös jäsenyyden ulkopuolelle siirtyminen, owner-loss ja zombie/reaping-raja
ratkaistaan ennen oikeaprosessikokeen hyväksyntää.

Pelkkä saved-PGID, parent-PID-snapshot, prosessinimi, vapaa portti tai
yksittäisen rootin pidfd ei korvaa puun omistajuutta. Ryhmässä pysyvään
keeperiin tai Linux-subreaperiin perustuva vaihtoehto tarvitsee oman
identiteetti-, poistumis- ja karkaamisrajansa todistuksen. Yleistä POSIX-
tukea tai muun alustan poistamista ei päätetä tämän Linux-selvityksen nojalla.

#### T3a: Rajattu toteutettavuuskoe

Suositus on hyväksyä seuraava pieni checkpoint ennen kuluttajien siirtoa:

- Test-only Windows-sessiokoe nykyisillä Job-primitiiveillä ja jo hyväksytyllä
  .NET-työkalupohjalla. Ei uusia npm-/NuGet-riippuvuuksia, tuotantokoodia,
  installer-protokollan laajennusta tai yleistä prosessikirjastoa.
- Sama koe tarkistaa yhden synteettisen Node-puun ja eristetyn Electron-
  launchin yhteensopivuuden. Tavallisten testien launch-ketjua ei vielä vaihdeta.
  Negatiivinen koe saa alkaa vasta, kun sen itsenäisesti omistettu cleanup
  on valmis; testattavan viallisen helperin varaan ei jätetä orpoa prosessia.
- Linuxista tässä checkpointissa vain rajattu, read-only-edellytystarkistus
  ja nimetty jatkoehdotus. Ei palvelujen, kernel-kontrollien, oikeuksien,
  asennusten tai CI-vaatimusten muutoksia.
- Kokeen jälkeen päätetään täsmälliset Windows-/Linux-adapterit, niiden
  tiedostorajat, kontrolliprotokolla, tuetut alustat ja testikomentojen
  build-edellytykset. Ennen tätä ei siirretä backend-, Vite- tai Electron-
  kuluttajia eikä merkitä R28:aa korjatuksi. Epäonnistunut koe rajataan,
  ei laajenneta arkkitehtuuria automaattisesti.

T3a:n lupa ei hyväksy hiljaisesti Linux-cgroup-kirjoituksia tai uutta
testipalvelua. Jos nykyinen Windows-pohja vaatii hyväksytyn rajauksen
ulkopuolisen muutoksen, myös se palautuu päätettäväksi ennen toteutusta.

#### T3:n lopullinen hyväksyntänäyttö

Pysyvä [testimatriisi](r0-e2e-test-matrix.md#t3-prosessipuun-omistajuus)
erottaa tulevat puhtaat sopimukset, oikeaprosessikokeet ja Electron-
integraation. Pakollisia tapauksia ovat:

- root exits first / during stop; portiton ja TERM:iä vastustava jälkeläinen;
  jälkeläisen myöhäinen fork ja uuden sessionin/ryhmän yritys
- launch-, resume-, kysely-, kontrolli- ja terminal-julkaisuvirhe sekä
  myöhäinen prosessinluonti, caller-/owner-loss ja samanaikainen/toistettu stop
- vanha omistajuuskuitti, PID-/ryhmätunnisteen uudelleenkäytön hallittu
  simulaatio ja puun ulkopuolinen, omalla kahvallaan elävä sentinel
- restartin esto ja juuren säilytys epävarmuudessa sekä alkuperäisen virheen,
  cleanupin ja näyttövirheen erillisyys myös todellisessa fixtureketjussa
- Electronin normaali sulku, launch-virhe ennen yhteyttä, first-window-virhe,
  relaunch, toinen instanssi ja synteettinen bootstrap; handoff-testin
  assertion-/timeout-/release-virheen varma cleanup.

Älä pakota käyttöjärjestelmän PID-avaruutta loppuun uudelleenkäyttökokeessa.
Simulaatio todistaa virheellisen identiteetin torjunnan, oikea prosessikoe
omistetun puun poistumisen ja sentinelin säilymisen. Niitä ei sekoiteta.
Oikeat kokeet ajetaan vasta hyväksytyn mekanismin sisällä erillisessä
synteettisessä testijuuressa. Mekanismin edellytyksen puuttuminen on
avoin/hylätty näyttö, ei onnistunut skip.

Kuluttajien siirron jälkeen vaaditaan niiden kohdetestit, workspace/typecheck,
nykyiset Linux system/web- ja Windows Electron -portit sekä muuttuneen
Windows-primitiivin installer-regressiot. Uudet build-esiehdot on sidottava
todellisiin testikomentoihin ja CI:hin, ei oletettava T2:n perusteella.
Raskaan matriisin nykyinen riskivalinta, aikarajat ja flaky-hylkäys säilyvät.
Ajoseuranta nimetään ennen ensimmäistä koetta; normaali PR ja täsmällisen
main-revision omat portit tarvitaan ennen R28:n sulkemista.

Tuotannon UI, HTTP, business audit, Diagnostics, Activity, tukipaketti,
backup-formaatti ja sovellusversio eivät muutu tässä testiharness-rajauksessa.
Tuleva testisession evidence ei kuulu business-backupiin tai tuotannon
lokiketjuun. Jos toteutus ulottuu tuotantolifecycleen, packaged-artifactiin
tai profiilin sopimukseen, työ pysähtyy kyseisen erillisen portin ratkaisuun.

Tekniset lähteet: [Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects),
[Playwright Electron launch](https://playwright.dev/docs/api/class-electron),
[ElectronApplication process](https://playwright.dev/docs/api/class-electronapplication#electron-application-process)
ja [Linux cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html).
Niiden alustakyvykkyydet eivät yksin todista EKY-adapterin oikeellisuutta.

## Testikohtainen runtime

Ensimmäinen versio käyttää yhtä workeria ja lähtökohtaisesti testikohtaista
runtimea. Jokainen runtime saa oman juuren:

```text
<os-temp>/eky-e2e/<run-id>/<scenario-id>/
  database/
  documents/
  logs/
  incidents/
  temp/
  support-bundles/
  artifacts/
  runtime-config.json
```

Runtime saa lisäksi omat loopback-portit, runtime-sessionin, synteettisen
yrityksen, synteettisen käyttäjän ja testikellon vain silloin, kun skenaario
sitä tarvitsee.

Käynnistys estetään, jos:

- `EKY_E2E` ei ole täsmälleen `1`
- backend- tai web-host ei ole `127.0.0.1`
- URL ei osoita loopbackiin
- yksikin kirjoituspolku ei ole realpath-tarkistetun testijuuren alla
- polku on symlinkki tai osoittaa `%APPDATA%\Eky`-hakemistoon
- SMTP-adapteri ei ole testikoostamisen fake-adapteri
- runtime yrittää käyttää repositorion pysyvää kantaa, storagea tai lokeja

E2E ei käytä oikeita salaisuuksia, SMTP-yhteyttä, DNS-kyselyitä, asiakas- tai
laskudataa, käyttäjän SQLite-kantaa eikä production-runtime-sessionia.

Tulevat backup/restore- ja installer/update-E2E:t lisäävät saman
testikohtaisen juuren alle omat `backups`, `recovery-points`, `staging` ja
`update`-hakemistonsa. Niitä ei saa koskaan osoittaa `%APPDATA%\Eky`-
hakemistoon, oikeaan asennushakemistoon tai käyttäjän valitsemaan
tuotantokohteeseen. Windows-installerin E2E käyttää eristettyä testiasennusta
ja synteettistä profiilia.

## Prosessien elinkaari

Testiruntime käynnistää backendin ja webin hallittuina lapsiprosesseina. Se:

- odottaa eksplisiittistä health-valmiutta
- palautuu heti health-ehdon täyttyessä eikä käytä kiinteää odotusta
- keskeyttää ja terminalisoi keskeneräisen health-tarkistuksen, jos omistettu
  lapsiprosessi poistuu ennen valmiutta
- rajaa ja redaktoi stdout/stderr-keräyksen
- pysäyttää koko prosessipuun testin, keskeytyksen ja runner-virheen jälkeen
- tarkistaa, ettei portteja tai lapsiprosesseja jää käyttöön
- poistaa onnistuneen testin väliaikaiset tiedot
- säilyttää epäonnistuneen testin synteettiset artefaktit raportissa

Windowsissa temp-root poistetaan vasta Electronin, backendin ja muun
testiharnessin omistaman prosessipuun pysäytyksen sekä loopback-portin
vapautumisen jälkeen. Poisto hyväksyy vain realpath-tarkistetun suoran
`eky-e2e/run-*`-hakemiston. Rajattu tiedostojärjestelmä-retry saa käsitellä
vain Windowsin hetkellistä kahvan vapautumista; pysyvä `EPERM` tai muu
cleanup-virhe epäonnistaa testin eikä sitä nielaista.

Satunnaisia odotuksia tai `waitForTimeout`-kutsuja ei käytetä valmiuden
todistamiseen. Nimetty backend-startupin enimmäisaika on vain fail-closed-
turvaraja. Electron-testin oma enimmäisaika koostetaan mahdollisen synteettisen
backend-fixturen, Electron-yhteyden, ensimmäisen ikkunan, sulkemisen ja
skenaarion turvabudjeteista; mikään näistä ajoista ei ole onnistumisen
valmis-signaali.

Playwrightin Electron-sulkemisen jälkeen testiruntime odottaa omistetun
juuriprosessin todellista exit-tapahtumaa. Pakotettu prosessipuun cleanup on
rajattu varmistus vain silloin, kun tapahtumaa ei saada turvallisen
enimmäisajan sisällä; kiinteä odotus ei ole onnistumissignaali.

Electron-fixture erottaa `playwrightConnect`-, `firstWindow`- ja
`domContentLoaded`-vaiheet. Virheen luokka perustuu Playwrightin timeout-tyyppiin
tai havaittuun prosessin poistumiseen / sivun sulkeutumiseen; tuntematon syy
säilyy tuntemattomana. Vaihehavainto ei muuta aikarajoja eikä toimi readiness-
signaalina. Runtime- ja prosessikahva siirtyvät fixturen omistukseen heti
yhteyden valmistuttua, ennen ikkunan odottamista. Sama prosessikahva säilyy
virheluokitusta ja siivousta varten; sitä ei haeta uudelleen jo suljetun
Playwright-yhteyden kautta. Myös restart käyttää nykyistä omistetun runtimen
sulkemista ennen uuden sukupolven käynnistämistä.
Sovelluksen oman relaunchin jo sulkema kahva käsitellään olemassa olevalla
suljetun kahvan siivouspolulla vasta havaitun `close`-tapahtuman jälkeen.
Tapahtuma ei korvaa prosessisiivouksen tai portin vapautumisen tarkistusta.

Epäonnistuneen yrityksen `electron-lifecycle`-liite sisältää vain version,
yritysnumeron, rajatun vaiheluettelon ja erilliset API-, runtime-, portti- ja
testijuuren siivoustulokset. Se kerätään myös ensimmäisestä yrityksestä,
ei vain retrystä. Raakavirheitä, URL:eja, sessionia, prosessitulostetta tai
ympäristöä ei kopioida liitteeseen. Playwrightin testivirhe säilyy ensisijaisena;
myöhempi siivous ei muuta sitä onnistumiseksi.
Sama turvallinen sisältö tallentuu yrityskohtaiseen
`electron-lifecycle.json`-tiedostoon. Electron-CI säilyttää vain nämä tiedostot
yhden päivän artifactina, myös ensimmäisestä epäonnistumisesta ennen retryä.
Koko `test-results`-kansiota, tracea, profiilia tai raakaa lokia ei julkaista.

M0.3:n `DESK-WORKSPACE-FIRST-START-001` tallentaa lisäksi first-start-proofin
suljetut vaihehavainnot ja kuluneen ajan runtime-kohtaiseen testitiedostoon.
Se sijaitsee validoidussa E2E-userData-juuressa, erillään proofin poistettavasta
alihakemistosta. Tiedoston yksityinen nimi sidotaan olemassa olevaan runtime-
identiteettiin; tunniste ei tule sisältöön tai julkaistavaan liitteeseen.
Capability sallii vain yhden proof-kutsun per testiruntime, myös ensimmäisen
kutsun epäonnistuessa. Uusi runtime ei lue aiemman sukupolven havaintoja.

Writer sallii enintään 128 tietuetta ja 16 KiB; viimeinen paikka on varattu
katkaisumerkille. Lukija rajaa tavut ennen jäsennystä, torjuu linkitetyt juuret,
linkit ja ei-tavalliset tiedostot sekä rakentaa vain sallituista kentistä
uuden tilannekuvan. Kesken jäänyt viimeinen tietue näkyy `partial`-tilana,
puuttuva, virheellinen, liian suuri tai lukukelvoton näyttö erillisinä tiloina.
`captured` kertoo havaintojen luvusta, ei koko proofin valmistumisesta;
`proofFinallyReturned` ei todista cleanupin onnistumista.

Nykyinen fixture kerää snapshotin API:n sulkemisen, omistetun runtimen
pysäytyksen ja porttitarkistuksen jälkeen, ennen testijuuren mahdollista
poistamista. Lukeminen ei tarvitse toimivaa Electron-evaluate-kutsua.
Epävarma cleanup säilyttää juuren entiseen tapaan ja raportoidaan erikseen.
Validoitu `firstStartProof`-osa lisätään nykyiseen lifecycle-liitteeseen;
juuri tämä testi kirjoittaa sen myös onnistuessaan kytkennän todentamiseksi.
Luku- tai raportointivirhe ei korvaa alkuperäistä testivirhettä eikä estä
siivousta. Diagnostiikka ei muuta tuotannon lokitusta, runtime-käyttäytymistä,
testibudjetteja, retryä tai hyväksyntäassertioita. Paikallisen ajon
yksityiskohtaiset ajoitukset säilyvät paikallisina.

M0.4:n testikohtainen load-havainto liitetään saman first-start-proofin
neljään compositioniin. Ikkunahookki asennetaan ennen compositionin latausta
ja vapautetaan myös virheessä. Tavallinen `loadURL` delegoidaan välittömästi
samalla receiverillä ja argumenteilla; palautetaan alkuperäinen promise.
Testin virheadapteri ei avaa natiivia modaalia eikä heitä irrotetusta
callbackista. Odottamaton virhe hylkää normaalin testin omistajan tarkistuksessa.
Vaihe sisältää vain suljetun composition-paikan ja tapahtuman, ei dialogitekstiä.

[M0.6:n latauksen omistajuus](windows-installer-acceptance-harness-v2.md#m06-ehdotus-testin-latauksen-ja-purun-omistajuus)
edellyttää normaalissa proofissa, että oman ikkunan todellinen lataus päättyy
ennen backendin shutdownia ja protokollapurkua. Ei lisäviivettä, timeoutia
tai retryä. Latausvirhe säilyy ensivirheenä, mutta shutdown ja cleanup
yritetään silti. `SYS-FIRST-START-LOAD-SHUTDOWN-001` kattaa pending-,
onnistumis-, virhe-, peruutus- ja yhdistelmävirhepolut hallituilla promiseilla.
Pakotettu diagnostiikkakoe ohittaa vain tämän ennakko-odotuksen; sen oma
todellisen virheketjun hyväksyntä pysyy erillisenä.

`DESK-FIRST-START-LOAD-ORDER-001` on erillinen koe konfiguraatiossa
`apps/e2e/playwright.first-start-diagnostic.config.ts`, ei tavallisen CI:n
valitsema skenaario. Se käyttää samaa eristettyä fixtureä, cleanupia ja
aikarajoja; yhden todellisen latauksen kutsu vapautetaan vasta todennetun
protokollapurun jälkeen. [M0.5:n havaintosopimus](windows-installer-acceptance-harness-v2.md#m05-pakotetun-kokeen-havaintosopimuksen-täsmennys)
vaatii todellisen `loadURL`-rejectionin, täsmällisen virheadapterin ja
quit-pyynnön. `did-fail-load` säilyy täydentävänä havaintona: native-promise
voi epäonnistua ilman sitä. Normaali koe vaatii edelleen onnistuneen latauksen
ja torjuu main-frame-virheen sekä kaikki virhedialogi- ja quit-kutsut.
Älä tulkitse pakotetun kokeen havaintoa tavallisen testin läpäisyksi tai
alkuperäisen timeoutin syytodisteeksi. Myös tämän kokeen first-start-journal
kerätään omistetun cleanupin jälkeen ennen juuren poistoa.

Myös Electronin käynnistystä edeltävä workspace-backupin valmistelu säilyttää
ensimmäisen epäonnistumisen samassa liitteessä. Electronin omat API-, runtime-
ja porttivastuut ovat silloin `notStarted`, testijuuri `retained`. Erillinen
`preparation.backend` kertoo vain tunnetun backend-käynnistysvirheen,
todellisen `spawn`-havainnon, ennen siivousta havaitun poistumisen, olemassa
olevan kuunteluilmoituksen havaitsemisen sekä backendin prosessipuun ja portin
siivoustulokset. Tuntematon valmisteluvirhe ei väitä näitä varmistetuiksi.
Kuunteluilmoitus on rajatun diagnostiikkapuskurin havainto, ei health-signaali
tai ajastusprotokolla; sen puuttuminen ei todista kuuntelun puuttumista.
Raakaa tulostetta, alkuperää tai porttinumeroa ei kopioida liitteeseen.
Tulosteen lukijan tai raportoinnin virhe ei peitä käynnistysvirhettä;
prosessin tai portin epävarma siivous säilyy erillisenä epäonnistumisena.
Valmistelun raportointiraja ei omista siivousta eikä poista testijuurta.

Electronin erillinen E2E-entrypoint säilyttää vain muistissa enintään 16
nimettyä käynnistyshavaintoa ja niiden kuluneen ajan. Havainto erottaa appin
valmiuden, workspace-ratkaisun, backendin käynnistyspyynnön ja valmiuden,
ensimmäisen ikkunan luonnin sekä composition-kutsun valmistumisen. Se ei lue
yritysdataa, kirjoita konsoliin tai levylle eikä muuta tuotannon käynnistystä.
Havainnot eivät ole uusia valmius- tai hyväksymisehtoja.
Backendin nykyinen E2E-controller erottaa samalla muistihavainnolla
`fork`-pyynnön, prosessikahvan palautumisen, `spawn`-tapahtuman,
start-viestin lähetyksen ja validoidun ready-viestin vastaanoton.
Kahva tai lähetetty viesti ei todista backendin valmiutta. Nämä havainnot
käyttävät samaa 16 merkinnän rajaa ja nykyistä yksityistä lukukanavaa;
ne eivät lisää lokitusta, prosessivalvojaa, kuittausta tai aikarajaa.
Havaintokutsun poikkeus ei muuta controllerin onnistumista, alkuperäistä
käynnistysvirhettä tai sulkemista. Tuotannon käynnistyspolku ei muutu.
Erillinen `DESK-STARTUP-OBSERVATION-001` todistaa havaintojen todellisen
kytkennän nykyiseen main-prosessiin. Se ei lisää diagnostiikan saatavuutta
PDF-käyttäjäpolun onnistumisehdoksi. `DESK-RESTART-001` todistaa nykyisellä
yhteydellä keskeneräisen lukupyynnön päättymisen restartin siivouksessa.

Käynnistysvirheessä fixture pyytää muistihavainnon kerran nykyisen
Playwright-main-yhteyden kautta ja jatkaa nykyistä siivousta odottamatta
vastausta. Siivottava yhteys omistaa myös keskeneräisen lukupyynnön.
`startupCapture` on `captured`, `unavailable` tai `notRequested`; puuttuva
vastaus ei todista mainin jumittumista. Myöhäinen vastaus ei muuta jo
muodostettua raporttia. Suljettu projektio hyväksyy vain nimetyt vaiheet,
ei raakavirhettä, polkua, tunnisteita tai vapaata metadataa. Havainto ja sen
puuttuminen säilyvät erillisinä testivirheestä ja siivoustuloksesta.

Testijuurta ei poisteta, jos runtimen, portin tai API-kahvan siivous jäi
varmentamatta. Yhteyden epäonnistuessa ennen runtime-kahvan saamista sen
omistajuutta ei arvata portin vapautumisen perusteella. Aiemman epävarman
siivouksen jälkeinen onnistunut loppuyritys ei myöskään oikeuta aineiston
poistoon. Säilytetty aineisto jää yksityiseen testijuureen; se ei ole
julkaistava CI-artifact tai yleinen retention-järjestelmä.

System-fixture voi hallitussa recovery-testissä pysäyttää backendin ja
käynnistää sen uudelleen samalla testikohtaisella SQLite-kannalla ja samalla
loopback-portilla. Uusi runtime saa aina uuden sessionin ja
`runtimeInstanceId`-arvon. Vanha autentikoitu API-context säilytetään vain sen
todistamiseksi, ettei vanha session enää kelpaa, ja kaikki contextit suljetaan
fixture-cleanupissa.

System- ja web-fixtureiden yhteinen `finishServiceFixture` kokoaa vain
nykyisten API-, prosessipysäytys-, portti- ja artifact-vastuiden tulokset.
Se ei käynnistä tai valvo prosesseja eikä lisää aikarajoja. Yhden siivousvaiheen
virhe ei ohita muiden jo omistettujen resurssien siivousyrityksiä. Testijuuri
poistetaan nykyisellä validoidulla `removeE2eRunRoot`-vastuulla vain kaikkien
tarvittavien vaiheiden valmistuttua. Puuttuva käynnistyskahva tai aiempi
varmentamaton siivous ei muutu varmistetuksi pelkän vapaan portin tai
myöhemmän onnistuneen siivousyrityksen perusteella. Backendin tyypitetyn
käynnistysvirheen erillistä prosessi- ja porttitulosta voidaan käyttää;
tuntematon lopputila säilyttää aineiston.

Epäonnistunut restart tyhjentää jo suljetun backendin ja API:n aktiiviset
viitteet ennen seuraavaa käynnistystä. Varmentamaton sulkeminen tai uuden
käynnistyksen siivous estää uuden restartin ja testijuuren poiston.
Alkuperäinen setup-/testivirhe säilyy ensisijaisena. Playwrightin jo kirjaamaa
testivirhettä ei korvata teardown-poikkeuksella. Erillinen
`service-fixture-cleanup`-liite sisältää vain version ja suljetut
siivoustulokset; ei prosessitietoja, polkuja, sessionia tai raakavirheitä.
Säilytettyä testijuurta ei julkaista artifactina.

## Selainverkon raja

Selain sallii vain testiruntimen eksplisiittiset loopback-origin-osoitteet.
Muu pyyntö keskeytetään ja merkitään testivirheeksi. Telemetriaa tai ulkoista
testipalvelua ei käytetä.

Web-E2E käynnistää Viten omana hallittuna prosessinaan. Vite saa backend-
originin ja runtime-sessionin vain testiharnessin validoiduista
`EKY_E2E`-prosessiarvoista, lisää sessionin Node-puolen same-origin-proxyssa
eikä julkaise sitä rendererille. Prosessi ei peri tavallista kehitysympäristöä,
ja Viten `envDir` sekä cache osoittavat testin omaan OS-temp-juureen. Näin
testi ei lue tavallisia `.env`-tiedostoja eikä käytä portin 3000
kehitysbackendia.

Selainkontekstissa sallitaan:

- täsmälleen testin oma `http://127.0.0.1:<web-port>`-origin
- täsmälleen testin oma `http://127.0.0.1:<backend-port>`-origin
- Vite-HMR:n vastaava loopback-`ws:`-origin
- `about:blank`
- verkkoa käyttämättömät `data:`-resurssit
- vain sallitusta loopback-originista muodostetut `blob:`-resurssit

Muut HTTP-, WebSocket-, `file:`, `javascript:` ja ulkoiset blob-osoitteet
estetään. Estetty yritys epäonnistaa testin turvallisella kohdeyhteenvedolla.

Hyökkäyssyötteet ovat pieni, versionhallittu ja deterministinen korpus.
Porttiskannausta, brute forcea, palvelunestotestausta, rajatonta fuzzia tai
kolmansiin osapuoliin kohdistuvia testejä ei tehdä.

## Fault plan

Failure-testi saa yhden ennen backendin käynnistystä validoidun ja tarkasti
tyypitetyn fault planin. Production composition ei lue sitä. Ensimmäisen
vaiheen sallitut ryhmät ovat:

- fake SMTP:n tunnetut lopputilat
- PDF-varaston kirjoitusvirhe
- operational login kirjoitusvirhe
- nimetyn tietokantaoperaation deterministinen kirjoitusvirhe

Fault plan ei sisällä callbackia, eval-koodia, SQL:ää, tiedostopolkua tai
arbitrary-merkkijonoa. Faultia ei voi vaihtaa HTTP:n, preloadin tai rendererin
kautta.

## Artefaktit

Epäonnistumisesta voidaan säilyttää:

- Playwright-trace ja kuvakaappaus
- rajattu prosessiloki
- synteettinen SQLite-kanta
- synteettiset JSONL-lokit ja tukipaketti
- validoitu fault plan
- scenario ID, sovellusversio ja build revision

Artefakti ei saa sisältää oikeaa salasanaa, runtime-sessionia, AppData-polkua,
asiakasdataa tai ulkoisesta järjestelmästä saatua sisältöä. Videoita ei
tallenneta R0:ssa.

## Testitasot

- `system-api`: HTTP-, session-, tenant-, permission-, persistence- ja
  observability-rajat ilman selain-UI:ta
- `web-chromium`: käyttäjän kriittiset selainpolut Chromiumilla
- `electron-development`: rajattu main/preload/renderer-integraatio
- `electron-endurance`: vain käsin ajettavat Electron stress- ja soak-testit
- `endurance-baseline`: vain käsin ajettava rajattu system- ja web-työkuorma
- packaged smoke: nykyinen hardened Windows -artifact erillisen smoke-runnerin
  kautta, ei Playwrightin ohjaamana

Packaged-artifactin fuseja, sandboxia, preload-rajaa tai navigointipolitiikkaa
ei heikennetä testauksen vuoksi.

## Endurance-mittaus

`pnpm test:e2e:stress` käyttää samaa eristettyä loopback-, temp-root- ja
fake-adapterimallia kuin muut E2E-testit. Se mittaa kokonaiskeston, backendin
RSS:n alussa ja työkuorman jälkeen, SQLite-, dokumentti- ja lokikoot sekä
testin hallitsemien avoimien prosessien määrän lopussa.

Prosessin RSS luetaan testiharnessissa käyttöjärjestelmän prosessitiedoista.
Tuotantobackendiin ei lisätä mittausendpointia. Mittaus ei sisällä sessionia,
komentoriviä, ympäristömuuttujia tai prosessin muistisisältöä.

Jokainen ajo kirjoittaa synteettisen JSON-raportin tiedostoon
`apps/e2e/test-results/endurance-baseline.json` ja Playwrightin
HTML-raporttiliitteeseen. `test-results` ei ole tuotantodata- tai
versionhallintakansio. Ensimmäinen dokumentoitu vertailutaso on
`e2e-endurance-baseline.md`-tiedostossa.

`pnpm test:e2e:desktop-stress` käyttää eristettyä Electron
development-runtimea ja mittaa prosessi- ja ikkunamäärän, Electron-prosessien
yhteenlasketun working setin sekä desktopin SQLite-, dokumentti- ja
lokikoot. `pnpm test:e2e:desktop-soak` käyttää samaa turvallista runtimea
oletuksena 30 minuuttia. Molemmat ovat manuaalisia, eivätkä kuulu
`e2e:all`-komentoon tai pull request -CI:hin. Desktopin työkuorma ja
vertailutaso on dokumentoitu tiedostossa
`e2e-desktop-endurance-baseline.md`.

## CI-ajojen eristys

GitHub Actionsin concurrency-ryhmä sisältää workflow-nimen, tapahtumalajin ja
haaran tai pull requestin lähdehaaran. Näin eri tapahtumalajit eivät peruuta
toistensa ajoja:

| Tapahtuma | Ryhmän haaraosa | Uusi saman ryhmän ajo |
| --- | --- | --- |
| pull request | PR:n lähdehaara | peruuttaa vain saman PR-ryhmän aiemman ajon |
| branch push | push-haara | peruuttaa vain saman push-ryhmän aiemman ajon |
| `main` push | `main` | peruuttaa vain aiemman `main` push -ajon |
| workflow dispatch | valittu ref | peruuttaa vain saman ref-arvon käsin käynnistetyn ajon |

V2:n controller valitsee PR:n jobit riskisuunnitelman mukaan; `main`-,
ajastettu ja manuaalinen kokonaisajo ovat täysiä. Feature-push ei käynnistä
PR:n rinnalle toista raskasta matriisia. `ci.yml` on reusable core eikä sen
vihreä osatulos yksin täytä `V2 acceptance` -porttia. Sen E2E-jobit ovat
`System security E2E`, `Web critical E2E` ja
`Windows Electron critical E2E`. Windows-jobi paketoi desktop-sovelluksen,
ajaa packaged smoken ja sen jälkeen kriittiset Electron development -testit
yhdellä workerilla. Endurance-baselineja tai soakia ei ajeta automaattisesti
CI:ssä.
