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

**Tila 2026-09-25: rajattu T3a-koe suoritettu (4/5); omistaja hyväksyi
T3b-valmistelun ja sen jälkeen T3b-L:n toteutuksen.** T3:n loppuosa etenee
Goalina erilliset päätösportit säilyttäen. Varhainen Electron-virhe ja käyttöönoton päätös ovat
avoimia. Lähtökohta on hyväksytty T2-main;
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

Omistaja hyväksyi seuraavan pienen checkpointin ennen kuluttajien siirtoa:

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

#### T3a:n tulos ja jatkopäätös

2026-09-25: omistajan hyväksymä erillinen toteutettavuuskoe on suoritettu.
[Koelähteet ja manuaalinen ajo-ohje](../../apps/e2e/experiments/processOwnership/README.md)
eivät ole tavallisen testifixturen tai CI:n ajoketjussa. Installerin lähteet
ja protokolla, tuotantokoodi, sovellusversio sekä riippuvuudet säilyivät.
Tulos on päätösaineistoa, ei R28:n sulkeminen tai PR/main-hyväksyntä.

| Näyttö | Tulos ja raja |
| --- | --- |
| Erillinen native-koe | Käännös läpäisi ilman uusia pakettiriippuvuuksia. Job-jäsenyys tarkistetaan ennen suspended-prosessin resumea; keskeneräinen luonti estää poistumiskuitin. |
| Sopimukset ja nykyinen komentokytkentä | Kokeen 6 sopimusta ja olemassa olevat 20 komentokytkennän regressiota läpäisivät. E2E-alueen typecheck läpäisi. Nämä eivät korvaa oikeaprosessinäyttöä. |
| Synteettiset Node-puut | Pysäytys, root ensin pois ja rootin virheellinen exit läpäisivät. Portiton detached-jälkeläinen jäi rootin jälkeen eloon ja koko Job tyhjennettiin. Alkuperäinen exit 23 säilyi erillisenä. |
| Normaali Electron | Käynnistys, eristetyt polut, args/env, rajattu stdio, sandbox ja normaali close läpäisivät. `application.process()` ei tässä sopimuskokeessa tunnistanut Electronin main-prosessia; adapteri ei saa rinnastaa niitä. |
| Varhainen Electron-launch-virhe | **Hylätty.** Before-ready-virhe saavutettiin, mutta Playwrightin launch-ketju tuotti käsittelemättömän `Process failed to launch!` -rejectionin. Se ei ollut fixturen odotettu, launch-catchissa käsitelty virhe. Ensimmäinen näyttö ja kaksi vaihe/origin-diagnostiikkaa säilytettiin; ehtoja, vikaa tai aikarajoja ei muutettu. |
| Epäonnistuneen kokeen cleanup | Native-kuitti raportoi valmistuneen luonnin ja tyhjän Jobin. Kokonaiskoe pysyi hylättynä; käynnistin ei hyväksy myöhäistä raakakuittia restart-/poistoluvaksi. |
| Linux | Read-only-edellytysselvitys tehtiin. Varsinaisen CI-runnerin testikohtainen delegointi, launch-hetken jäsenyys ja zombie/reaping-sopimus ovat todentamatta. Ei oikeaprosessinäyttöä tai alustahyväksyntää. Konekohtaiset havainnot pysyvät paikallisina. |

Windows-koe omistaa koko synteettisen Playwright-ajurin ennen sen suoritusta.
Se ei todista läpinäkyvää Electron-executable-wrapperia tai tavallisen
testifixturen käyttökelpoista session-rajapintaa. Virhehaaran lähdekatselmus
osoittaa Playwrightin luovan launch-rivien promisensa ennen niiden kaikkien
odottamista; havaitun käsittelemättömän rejectionin tarkka korjaus ratkaistaan
erikseen. Riippuvuuden lähdettä ei paikattu eikä poikkeusta vaimennettu.

**Omistajan hyväksymä seuraava rajaus on T3b-valmistelu, ei fixturejen siirto:**

1. Rajaa varhaisen Electron-launch-virheen yhteensopivuus nykyisellä lukitulla
   Playwrightilla ja päätä omistava virhe-/cleanup-sopimus. Mahdollinen
   riippuvuuspäivitys tarvitsee erillisen riippuvuusportin; virheen
   vaimentamista, timeoutin nostoa tai tapauksen poistamista ei hyväksytä.
2. Valmistele erillinen read-only-prerequisite-koe todelliselle Linux-CI-
   runnerille. Sen ajokytkentä hyväksytään ennen workflow-muutosta; ei
   cgroup-kirjoituksia, systemd-palvelua tai oikeuksien nostoa tämän nojalla.
3. Valitse ennen toteutusta Windowsin koko testisession worker-raja tai
   erillinen native-launch-adapteri sekä Linuxin vastaava omistajuusraja.
   Nimeä tiedostot, kontrolli-/terminal-sopimus, build-esiehdot ja jäljelle
   jäävän alla olevan matriisin testausjärjestys.

Tavalliset fixturet, A1:n E2E-hyväksyntä, Linux-tuki ja lopullinen T3 jäävät
avoimiksi. Koerajaus ei itsessään edellytä tuotannon Diagnostics-, Activity-,
audit-, tukipaketti-, käyttöohje- tai backup-muutosta: kyse on vain
synteettisestä testiharnessista. Uutta tuotantolifecycleä ei toteutettu,
joten packaged backup/restore- tai installer-hyväksyntää ei väitetä tehdyksi.

#### T3b: Virhehaaran ja alustarajan valmistelu

Omistaja hyväksyi 2026-09-25 tämän rajatun valmistelun. Lähdebaseline on
T3a:n `babb9557`; aiemman kokeen tuloksia ei nimetä uusiksi testeiksi.
Tässä vaiheessa luetaan lähteet ja säilynyt näyttö, arvioidaan vaihtoehdot
sekä valmistellaan seuraavat päätökset. Ei riippuvuuksien tai asennettujen
pakettien muutoksia, uusia prosessikokeita, CI-ajoa tai fixturejen siirtoa.

##### Electronin virhehaara

Nykyinen `apps/e2e/package.json` lukitsee `@playwright/test`-version 1.62.1.
Lukitun `playwright-core`-paketin `lib/coreBundle.js`-tiedoston
`waitForLine` ja `Electron.launch` sekä saman version
[alkuperäinen lähde](https://github.com/microsoft/playwright/blob/v1.62.1/packages/playwright-core/src/server/electron/electron.ts#L238-L297)
osoittavat seuraavan käsittelyaukon:

- Node-, Chromium-, X-server- ja debugger-disconnect-odotukset aloitetaan
  rinnakkain. `nodeMatchPromise` odotetaan ensin, sen jälkeen Node-yhteys.
- Chromium- ja X-server-promiset liitetään odotettuun raceen vasta tämän
  jälkeen. Disconnect-promisen catch kytketään vasta Node-yhteyden jälkeen.
- `waitForLine` hylkää myös prosessin exitin ja stderrin sulkeutumisen
  vuoksi. Sisäisen promisen käsittely ei käsittele automaattisesti
  async-funktion palauttaman promisen hylkäystä.

Tämä lähdehavainto selittää T3a:ssa tallennetun Chromium-odotuksen
käsittelemättömän rejectionin mahdollisen reitin. Muiden odotusten sama
riski on lähdehavainto, ei väite niiden toteutuneesta virheestä.
Tarkkaa kaikkien tapahtumien ajoitusjärjestystä ei todistettu uudella ajolla.
Node kuvaa [unhandledRejection-tapahtuman](https://nodejs.org/docs/latest-v24.x/api/process.html#event-unhandledrejection)
promisen omaksi käsittelyrajaksi; pelkkä ulomman `launch()`-promisen catch
ei korjaa erillisen sisäisen promisen käsittelyä.

Kokeen `fixtures/electronDriver.cjs` hylkää käsittelemättömän virheen
tarkoituksella. Sen muuttaminen onnistumiseksi, globaalin virheen nieleminen,
Node-virhetilan lieventäminen tai before-ready-vian siirtäminen myöhemmäksi
ei kelpaa korjaukseksi. Varhainen käynnistysvirhe ja prosessipuun siivous
ovat eri sopimuksia; native-kuitti ei korjaa Playwrightin virheketjua.

**Rajattu korjauspäätös valmisteltavaksi:** ensin arvioidaan täsmällinen
ylläpitäjän korjausversio, jos sellainen voidaan osoittaa lähdediffillä ja
regressiotestillä. Uudempi versionumero ei yksin riitä. Muussa tapauksessa
vaihtoehto on erikseen hyväksyttävä, versionoitu ja toistettavasti asentuva
minimikorjaus vain `playwright-core@1.62.1`:n tähän launch-odotusketjuun.
Se ei ole ajonaikainen monkey patch tai käsin muutettu `node_modules`.

Korjauksen pitää omistaa kaikkien heti käynnistettyjen odotusten hylkäykset
alusta asti ja välittää alkuperäinen launch-virhe edelleen. Myös abort,
stdio-close ja cleanupin virhe kuuluvat regressioon. Uutta yleistä
Electron-ohjauskirjastoa ei rakenneta tämän vuoksi. Oma riippuvuuskorjaus
kasvattaa ylläpito- ja toimitusketjuvastuuta: tarvitaan tarkka patch/digest,
lukittu asennus, lisenssi-/NOTICE-tarkistus, poistoehto upstream-korjauksen
jälkeen sekä [riippuvuuspolitiikan](dependency-policy.md) tarkistukset.
Tämän vaihtoehdon hyväksyntää tai korjattua julkaisuversiota ei vielä ole.

Hyväksytyn korjauksen ensimmäinen näyttö on hallittu hylkäysjärjestyksen
regressio; sen jälkeen nykyinen normaali Electron-koe ja sama before-ready-
virhe muuttamattomilla ehdoilla itsenäisesti omistetussa Jobissa.
Alkuperäinen T3a-hylkäys säilyy. Vasta todellinen launch-catch, ei timeout
tai unhandled rejection, sekä erillinen hyväksytty cleanup-kuitti voivat
täyttää virhekokeen odotuksen. Koko T3-matriisi on edelleen erillinen portti.

##### T3b-E:n täsmällinen riippuvuusehdotus

2026-09-25 lähdearviossa ei varmennettu korjaavaa upstream-julkaisua.
Myös tarkastettu [1.63.0:n launch-lähde](https://github.com/microsoft/playwright/blob/v1.63.0/packages/playwright-core/src/server/electron/electron.ts#L238-L323)
säilyttää olennaisen odotusjärjestyksen; pelkkää versiopäivitystä ei siksi
ehdoteta tämän virheen ratkaisuksi. Omistajalta pyydettiin erillinen päätös
nykyisen `playwright-core@1.62.1`:n rajattuun korjaukseen. Korjausta ei tämän
ehdotuksen perusteella vielä asenneta.

Ehdotettu patch koskee vain `lib/coreBundle.js`:n Electron-launchia:
X-server-odotuksen johdetulle promiselle sekä Chromium- ja disconnect-
odotuksille kytketään heti paikallinen rejection-vastaanottaja. Alkuperäiset
promiset ja niiden hylkäykset säilyvät myöhemmille kuluttajille. Launch-catch
säilyttää alkuperäisen virheen myös cleanupin hylkäyksessä ja ilmoittaa
cleanupin epävarmuuden suljetulla merkillä `electronLaunchCleanupUnverified`.
Nykyisen kokeen pitää hylätä tämä merkki, ei hyväksyä sitä odotettuna
launch-virheenä. Myöhempi native-kuitti ei nollaa epävarmuutta.

Toimitustapa on [pnpm:n versionoitu patch](https://pnpm.io/cli/patch),
`patches/playwright-core@1.62.1.patch`, täsmällinen `patchedDependencies`-
avain ja lockfilen patch-identiteetti. Ei uutta suoraa core-riippuvuutta,
uutta kirjastoa, selainta, ajonaikaista monkey patchia tai postinstall-
uudelleenkirjoitusta. Alkuperäinen registry-integrity ja Apache-2.0-
LICENSE/NOTICE säilyvät; oma muutos merkitään. Patchin digest ja frozen-
asennuksen todennus syntyvät vasta hyväksytyssä toteutuksessa.

Korjaus vaikuttaa kaikkiin tämän core-version workspace-kuluttajiin.
Ylläpitovastuu jää projektille: molemmat muutoskohdat tarkistetaan jokaisessa
päivityksessä ja patch poistetaan vasta vastaavan upstream-korjauksen
regressionäytön jälkeen. Auditointi, allekirjoitustarkistus ja testikirjaston
poissulku tuotantoartifactista ovat hyväksyntäportteja, eivät vielä tuloksia.

Regressiot kohdistuvat todelliseen lukittuun riippuvuuskoodiin, eivät sen
kopioon: jokaisen odotuksen varhainen hylkäys, exit/error/stderr-close,
normaalipolku ja disconnect, abort eri vaiheissa, myöhäinen valmistuminen,
listenerien purku sekä cleanupin throw/reject/abort. Alkuperäinen virhe ja
cleanup-merkki pitää todentaa myös palautusketjussa. Vasta tämän jälkeen
ajetaan nykyinen normaali Electron-koe ja sama before-ready exit 29 -koe.
R28, alustaratkaisu ja tavallisten fixturejen siirto jäävät erillisiksi porteiksi.

**Omistajan päätös 2026-09-25:** yllä nimetty nykyisen
`playwright-core@1.62.1`:n versionoitu minimikorjaus, regressiotestit ja
kahden nykyisen Electron-kokeen todennus hyväksyttiin. Tämä korvaa
ehdotuksen odottavan päätöksen, ei sen teknisiä rajoja. Toteutus aloitettiin
korjatun T3b-L-revision oman CI-varmennuksen läpäistyä. Ei uutta
kirjastoa, versionostoa, tuotantokoodia tai aikarajojen lievennystä.

##### T3b-E:n paikallinen korjausnäyttö

Hyväksytty kaksikohtainen patch on toteutettu ja asennettu pnpm:n kautta.
Version `1.62.1` registry-integrity sekä LICENSE/NOTICE säilyivät ennallaan;
pakettiversiot eivät muuttuneet. Patchin SHA-256 on
`e118d6303857130ea2d3cd7aee5c4075935522224cc6df0955f77d3a986a831c` ja
asennetun `coreBundle.js`:n tarkistettu SHA-256
`0d8b43a8e50f5453ddde5e5055ca1102ffdd927acf785fb88f90fd00dc94eb85`.
Nämä ovat toistettavuustunnisteita, eivät upstreamin hyväksyntä tai oman
muutoksen julkaisija-allekirjoitus.

Todelliseen asennettuun riippuvuuteen kohdistettu 43 testin sarja antoi
ennen patchia 17 läpäisyä ja 26 hylkäystä: 21 käsittelemätöntä rejectionia
ja viisi puuttuvaa cleanup-merkkiä. Ensimmäinen RED säilyy. Patchin jälkeen
sama sarja läpäisi 43/43 ja testikytkennän sarja 22/22. Testit käyttävät
riippuvuuden omaa launchia, odotuksia, Progressia ja virheen palautusketjua;
vain ulkoiset prosessi- ja transport-rajat korvataan hallituilla vastineilla.
Versio/digest-portti vaatii lähdekatselmuksen jokaisessa päivityksessä.

Nykyiset `electronNormal` ja ennen ready-vaihetta exit 29:n tuottava
`electronLaunchFailure` läpäisivät muuttamattomilla aikarajoilla. Kummankin
erillinen native-kuitti hyväksyttiin: luonti päättynyt, root poistunut,
Job tyhjä ja omistaja sulkeutunut ilman hätäpysäytystä. Virhehaaran oikea
launch-catch ja driver-session jälkeläinen havaittiin. Tulos ei väitä
jälkeläistä Electronin lapseksi eikä tee wrapperista Electron-mainia.
Alkuperäinen T3a-hylkäys ja sen diagnostiset yritykset säilyvät erillään.

Koko paikallinen `pnpm test` läpäisi 3907 testiä; kahdeksan aikaisempaa
alustakohtaista ohitusta säilyi. Frozen-asennus läpäisi, tuotanto- ja kaikki
riippuvuudet kattavat auditoinnit eivät löytäneet tunnettuja haavoittuvuuksia,
ja 160 registry-allekirjoitusta varmistettiin. Riippumattomat patch- ja
regressiokatselmukset eivät löytäneet estäviä puutteita.

Workspace-typecheck ja erillinen ei-julkaistava paketointi läpäisivät.
Payloadin metatiedot kattava poissulkuportti ei kuitenkaan läpäissyt:
nykyinen `deploy --prod` ja koko backend-stagen extraResource-kopiointi
säilyttävät myös rakentamisen metatietoja. Pelkkä Playwrightin suoritettavien
tiedostojen puuttuminen ei ole tämän laajemman portin hyväksyntä.
Metatietojen rajaus erotettiin omaksi paketointipäätöksekseen, jonka
omistaja hyväksyi 25.9.2026. Playwright-luvasta ei johdettu tätä valtuutta.
Tarkistuspakettia ei julkaista tai korvata hyväksytyksi artifactiksi.
Oman uuden revision CI hylättiin alla kuvatun käynnistyshavainnon vuoksi.
Ei PR/main-hyväksyntää, alustamekanismin käyttöönottoa, tavallisten fixturejen
siirtoa tai R28:n sulkemista.

##### T3b-E:n ensimmäinen CI-havainto

Revision `59ff56b01d6cbb44af4831901229ac1206c4cb64` ajo `36149261286`,
yritys 1, päättyi hylkäykseen: 36 jobia onnistui, Electronin kriittinen
E2E-jobi hylättiin, kokoava hyväksyntäportti hylättiin tämän seurauksena ja
yksi ennalta valinnainen jobi ohitettiin. Saman revision erillinen
riippuvuustarkistus `36149272461` läpäisi.

`DESK-WORKSPACE-PASSWORD-001`:n ensimmäinen yritys epäonnistui fixturen
käynnistyksessä, ennen salasanan perumista testaavaa testirunkoa:
`E2E_ELECTRON_STARTUP_FAILED phase=firstWindow reason=timeout`.
Nykyisen CI-asetuksen automaattinen retry läpäisi; tulos jäi silti oikein
flakyksi ja hylätyksi. Testisarjassa oli lisäksi 37 läpäissyttä testiä.
Uutta ajoa ei käynnistetty hylkäyksen peittämiseksi.

Ensimmäisen yrityksen talteen otettu, katkaisematon `electron-lifecycle`
osoittaa Playwright-yhteyden valmistuneen. Käynnistyshavainto päättyy
`backendStartMessageSent`-vaiheeseen; backendin valmiuskuittausta,
ensimmäistä ikkunaa tai compositionin valmistumista ei ole havaittu.
Fixture raportoi oman runtime-siivouksensa valmistuneeksi, portin
vapautuneeksi ja testijuuren poistetuksi. Tämä on nykyisen fixturen näyttö,
ei uusi todiste R28:n tavoitellusta koko prosessipuun omistajuudesta.

Juurisyy on avoin. Testibackend kertoo nykyisin sisäisen käynnistysvaiheen
vain valmistuneessa virhevastauksessa, ei vielä kesken olevassa odotuksessa.
Talteen saatu näyttö ei siis erota esimerkiksi moduulin latausta backendin
käynnistystyöstä. Sitä ei tulkita salasanatoiminnon virheeksi, Playwright-
patchin syyksi tai pelkäksi CI-kuormaksi ilman lisätodistetta.
Seuraava vianrajaus rajataan ensin tähän puuttuvaan testiharnessin havaintoon
ja sen sopimuksiin. Tuotantokäyttäytymistä, aikarajoja, retryä tai CI-ehtoja
ei muuteta tämän havainnon perusteella. T3b-P:n toteutus ja uudet
alustakokeet odottavat korjattua ja todennettua baselinea.

Rajattu jatkoehdotus on välittää testibackendin nykyisen suljetun
käynnistysvaiheluettelon havainto olemassa olevaan rajattuun lifecycle-
keräykseen. Puuttuva havainto erotetaan ilmoitetusta vaiheesta. Progress ei
saa toimia valmiuskuittauksena, nollata aikarajaa tai viivyttää siivousta.
Eri prosessien kuluneita aikoja ei vähennetä toisistaan yhteisenä kellona.
Virheelliset ja myöhäiset havainnot sekä havaitsijan virhe testataan ennen
yhtä seurattua Windows-koetta. Omistaja hyväksyi 25.9.2026 tämän rajatun
Electron-vian selvityksen ja korjauksen. Ensimmäinen toteutus koskee vain
testiharnessin puuttuvaa havaintoa ja sen regressiosuojaa. Käynnistyksen
juurisyytä ei merkitä korjatuksi pelkän onnistuvan kokeen perusteella.

Muistiprojektion versio 2 säilyttää nykyiset enintään 16 checkpointia ja
erillisen viimeisen backend-vaiheen: `unobserved` tai `observed` sekä suljettu
vaihenimi ja main-prosessin havaitsemishetken kulunut aika. Lapsiprosessi ei
lähetä aikaleimaa, polkua, virhetekstiä tai konfiguraatiota tässä viestissä.
Valmiusodotuksen alku ja mahdollinen aikarajan täyttyminen erotetaan
checkpointteina muuttamatta odotuksen aloituskohtaa tai kestoa.
Nämä ovat vain testien lifecycle-todisteita, eivät sovelluksen Diagnostics-,
Activity-, tukipaketti- tai incident-tapahtumia. Punaisen CI-baselinen
hyväksyntä ei muutu tällä päätöksellä.

##### T3b-E:n käynnistysdiagnostiikan paikallinen todennus

Rajattu testimuutos on toteutettu ja katselmoitu riippumattomasti. Suljetut
progress-viestit välittyvät nykyisestä utility-runnerista mainin muistikuvaan
ja aiempaan lifecycle-keräykseen. Valmius tulee edelleen vain validoidusta
`ready`-viestistä; progress ei nollaa readiness-aikarajaa. Lähettäjän tai
havaitsijan virhe ei korvaa alkuperäistä tulosta, ja terminalin jälkeen
saapuva progress sivuutetaan.

- 31 kohdistettua sopimustestiä läpäisi. Mukana ovat kenttien rajaus,
  muuttumaton valmiusbudjetti, myöhäiset havainnot, havaitsijan virhe,
  muuttumaton muistikuva ja ensivirheen näyttö siivouksen yli.
- Sama sopimusjoukko sekä `DESK-STARTUP-OBSERVATION-001` ja aiemmin
  epäonnistunut `DESK-WORKSPACE-PASSWORD-001` läpäisivät yhden 33 testin
  Windows-ajon, ilman retryä. Todellinen utility/main/lukija-kytkentä
  tuotti version 2 havainnon. Alkuperäinen aikakatkaisu ei toistunut.
- Workspace-typecheck, tarvittavat buildit ja koko `pnpm test` läpäisivät.
  Jälkimmäisessä oli 3907 läpäissyttä testiä ja kahdeksan ennestään
  määriteltyä alustakohtaista ohitusta. Riippumaton katselmus ei löytänyt
  tämän rajatun kokeen estäviä puutteita.

Tämä todentaa diagnostiikkakorjauksen, ei alkuperäisen timeoutin juurisyytä
tai korjausta. Omistaja hyväksyi 25.9.2026 muutoksen commitin ja pushin
nykyiseen kehityshaaraan sekä yhden seuratun Windows-CI-diagnostiikka-ajon.
Hyväksytyn rajauksen tavalliset tallennus-, julkaisu- ja CI-työvaiheet eivät
vaadi uutta lupakysymystä. Alla kirjattu rajattu CI-todennus ei korvaa koko
V2-hyväksyntää tai hyväksy main-mergeä.
T3b-P ja T3c pysyvät edellä määriteltyjen hyväksyntäporttien takana.

##### T3b-E:n rajattu Windows-CI-todennus

Revision `cba3fa3db304024c55c76838cd99637d0e1bc0ef`
[Windows-diagnostiikka-ajo 36164733794](https://github.com/eky-software/eky/actions/runs/36164733794),
yritys 1, läpäisi. Sekä ajon metatiedot että checkout-lokin lopullinen
Git-revisio vastaavat tätä lähdettä. Seuranta oli nimetty ennen käynnistystä;
tilaseuranta ja valmistunut jobiloki tarkistettiin erikseen.

- Nykyinen Windows-paketointi ja packaged smoke läpäisivät.
- Kaikki 38 kriittistä Electron-testiä läpäisivät ensimmäisellä yrityksellä,
  myös aiemmin käynnistykseen pysähtynyt `DESK-WORKSPACE-PASSWORD-001`.
  Ei flaky-tulosta tai testien uusintayrityksiä.
- Erillinen `DESK-STARTUP-OBSERVATION-001` läpäisi ilman retryä. Se todentaa
  version 2 utility/main/lukija-kytkennän ja readiness-checkpointit.
- Yksi valittu jobi onnistui; neljä muuta ohitettiin tarkoituksellisesti
  nykyisen `electron_diagnostic`-valinnan perusteella. Kyse ei ole koko
  V2-ajosta, system-/web-sarjan tai installer-matriisin todennuksesta.
- Virheen lifecycle-artifactia ei syntynyt: tässä ajossa ei havaittu
  epäonnistunutta yritystä. Tämä ei ole uusi CI-todiste virhehaaran
  artifactista; aiempi ensivirhe ja sen todisteet säilyvät erillään.

Tulos hyväksyy diagnostiikkamuutoksen rajatun CI-todennuksen. Alkuperäinen
timeout ei toistunut, eikä sen juurisyytä tai korjausta ole osoitettu.
Myöskään riippumaton rajattu lähdekatselmus ei yksilöinyt sen syytä.
Koko baselinen, T3b-P:n, alustakokeiden ja PR/main-integraation portit
pysyvät avoimina. T3/R28:aa ei suljeta tällä ajolla.

Mahdollisen seuraavan todellisen käynnistysvirheen ensisijainen lukureitti
on nyt olemassa oleva `backendStartup`-projektio ja readiness-checkpointit.
`unobserved` tarkoittaa puuttuvaa havaintoa, ei todistettua kadonnutta IPC:tä.
Vaiheilmoitus edeltää nimettyä operaatiota eikä todista sen valmistumista.
Näyttö rajaa jatkotutkimuksen ennen lisämuutoksia; vihreitä uusinta-ajoja,
arvattua korjausta tai pidempiä aikarajoja ei käytetä syyn korvikkeena.

##### T3b-P: hyväksytty metatietorajaus

Omistajan erillinen hyväksyntä koskee vain backend-paketoinnin tuottamia
rakennusmetatietoja, niiden regressiosuojaa ja uuden eristetyn paketin
tarkistusta. Riippuvuuksia, versioita, sovellustoimintoja, tietokantoja,
installeria tai olemassa olevia käyttäjäprofiileja ei muuteta.

- Normalisointi kuuluu desktopin paketointiketjuun nykyisen valinnaisen
  `preparePackageBackendStage`-hookin jälkeen ja ennen sisällön validointia.
  Hookin nykyinen no-op-sopimus säilyy.
- Vain backend-juuren `pnpm-lock.yaml`, `pnpm-workspace.yaml` ja
  `node_modules/.modules.yaml` poistetaan rakennustiedostoina.
- Backend-juuren manifestista palautetaan vain tunnistetut buildin
  tuottamat absoluuttiset paikalliset riippuvuusviitteet saman buildin
  auktoritatiivisiin lähdemäärityksiin. Tuntematon muunnos hylätään.
  Muut kentät, järjestys ja asennetut runtime-riippuvuudet säilyvät.
- Tiedosto-operaatiot pysyvät validoidussa staging-juuressa. Manifesti
  korvataan atomisesti; jaettuja tiedostotavuja ei muokata paikallaan.
  Vendor-manifesteja, lisenssejä, NOTICE-tiedostoja, natiivibinaareja tai
  riippuvuuksien omia patcheja ei siivota rekursiivisesti.
- Regressiot todistavat täsmällisen muutosjoukon, toistettavuuden,
  virheellisten manifestien ja linkkien torjunnan sekä muiden tavujen ja
  moduulien ratkeamisen säilymisen. Sisältöportti estää metatietojen
  palaamisen sekä backend-stagessa että valmiissa paketissa.
- Uusi eristetty Windows-paketti, sen sisältötarkistus ja synteettinen
  packaged smoke vaaditaan. Tämä ei ole käyttäjälle toimitettava julkaisu.

Toteutus ja näyttö ovat vielä avoinna. T3c-W:n ja T3c-L:n erillisiä
alustakokeita ei hyväksytä tällä päätöksellä.

##### Windowsin omistajuusrajan valinta

| Vaihtoehto | Vaikutus ja päätösraja |
| --- | --- |
| Koko Playwright-ajuri tai testisessio omassa Jobissa | T3a:n kokeilema containment-raja. Nykyiset `Page`- ja `ElectronApplication`-oliot toimivat vain niitä omistavassa ajurissa. Koko session lopetus ei todista yhden runtime-sukupolven poistumista kesken testin ennen restartia; tarvitaan vielä erillinen runtime-raja. |
| Oma ajuriworker ja rajattu viestirajapinta | Omistus ennen launchia on mahdollinen, mutta nykyiset testit käyttävät suoraan `evaluate`-, `Page`- ja window-kahvoja. Niitä ei voi siirtää JSON-viesteinä. Tämä olisi laajempi testirajapinnan muutos, ei pieni fixture-apuri; ei ensisijainen seuraava pala. |
| Native-launch-adapteri nykyisen Playwright-kahvan alla | Säilyttäisi nykyiset testien API:t parhaiten. Se on vasta seuraavan kokeen ehdokas: stdio, shell-wrapper, virheketju, ulkopuolinen Job-omistaja ja terminal-kuitti pitää todistaa. `application.process()` ei saa muuttua väitteeksi Electron-mainin tai koko puun identiteetistä. |

Suositus on korjata tai rajata riippuvuuden virheketju ensin ja kokeilla
sen jälkeen nykyiset testien API:t säilyttävää adapteria erillisellä luvalla.
T3a:n koko ajurin Job säilyy kokeen turvarajana, ei valmiiksi valittuna
yleisratkaisuna. Playwrightin sisäinen kill ja omistajan tree-stop eivät
saa muodostaa kilpailevia siivoojia; omistajaa ei saa menettää wrapperin
poistuessa. Ellei julkisella rajapinnalla saada tätä todistettua, palataan
worker-rajan päätökseen eikä yksityistä Playwright-protokollaa kopioida.

##### T3c-W:n neljän tapauksen adapterikoe: päätösehdotus

Seuraava Windows-päätös rajataan erilliseen neljän tapauksen kokeeseen,
ei koko T3-matriisin toteutukseen. **Ei vielä hyväksytty tai toteutettu.**
Ensin vaaditaan korjattu CI-lähtötila ja hyväksytyn T3b-E-patchin todennus.

Kokeen ajuri käynnistää itsenäisen native-omistajan ennen Playwright-launchia.
Playwright saa `executablePath`-arvoksi oman `bridge.exe`-apurin.
Omistaja, ei bridge, luo ennalta sidotun Electronin suspended-tilassa
atomisesti omaan Jobiin ja varmistaa jäsenyyden ennen resumea. Omistaja
pysyy shell/bridge-alipuun ulkopuolella mutta T3a:n ulomman turva-Jobin
sisällä. Electronin jälkeläiset kuuluvat myös sisempään Jobiin.
[Sisäkkäiset Jobit](https://learn.microsoft.com/en-us/windows/win32/procthread/nested-jobs)
on todennettava normaalikokeessa ennen virheinjektiota.

Bridge välittää stdout/stderrin tavuina omilla kanavillaan; debugger-
protokollaa ei parsita tai kopioida. Nykyiset `ElectronApplication`/`Page`-
kutsut säilyvät. Erilliset, yhdelle asiakkaalle rajatut nykykäyttäjän
kontrolliputket sitovat sukupolven, kertakäyttöisen launchin ja idempotentin
stopin; etäasiakkaat, väärät sukupolvet ja replay hylätään. Kontrollikehys
on enintään 4 KiB ja kummankin tulosteen puskuri 64 KiB. Ylivuoto tai
jumittunut välitys on virhe. `application.process()` ei todista puun
identiteettiä. Playwrightin shell-kill ei saa hävittää Job-omistajaa.

Erikseen hyväksyttävä uusi kokeen apphost-build käyttää nykyistä .NET SDK:ta
ja vain jo saatavilla olevia Windows-apphostin build-edellytyksiä.
Nykyinen T3a-projekti ei tuota apphostia. Puuttuva edellytys pysäyttää;
uuden työkalun tai paketin asennusta ei hyväksytä tämän kokeen osana.
`WindowsJob.cs` ja nykyiset native-primitiivit voidaan linkittää muuttamatta
installerin lähteitä. Yhden attribuutin nykyinen builder ei kuitenkaan
riitä: kokeen erillinen assembly jättäisi sen pois ja käyttäisi omaa
samansopimuksista `ProcessCreationJobAttribute`-tyyppiä, jossa on sekä
`JOB_LIST` että rajattu stdio-`HANDLE_LIST`: kapasiteetti kaksi molemmissa
alustusvaiheissa, nykyinen namespace ja konstruktorisopimus säilyttäen.
Job-kahva ei periydy.
[Attribuuttilistan ja kahvaperinnän sopimus](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)
sekä [putkien paikallinen rajaus](https://learn.microsoft.com/en-us/windows/win32/api/namedpipeapi/nf-namedpipeapi-createnamedpipew)
kuuluvat toteutuksen katselmukseen. Tämä on uutta koekohtaista native-koodia,
ei väite kaikkien nykyisten luokkien muuttumattomasta uudelleenkäytöstä.

| Ensimmäinen koetapaus | Vaadittu näyttö |
| --- | --- |
| Normaali | Todellinen Page/API, argumentit, ympäristö, cwd, sandbox, stdio ja normaali close; erikseen hyväksytty sisemmän Jobin terminal. |
| Before-ready-virhe | Electron itse luo eloon jäävän leafin ja poistuu edelleen ennen readyä tarkoituksellisella virhekoodilla; launch-catch ei ole timeout/unhandled rejection. |
| Root poistuu ensin | Launch onnistuu, Electron-root poistuu mutta sisempi Job on havaittavasti vielä ei-tyhjä; omistaja siivoaa sen. |
| Bridge poistuu | Electron on yhä elossa, caller-owner-kontrolli toimii ja omistaja pysyy käytössä; bridge-virhe ei muutu workload-onnistumiseksi. |

Before-ready-adapterikoe on lisätapaus; se ei korvaa tai muuta T3b-E:n
alkuperäistä ajurin luomaa leafiä käyttävää virhekoetta. Leaf-kuittaus ei
saa päästää Electronia ready-tilaan ennen vikaa.

Ulompi ohjain omistaa sentinelin kummankin Jobin ulkopuolella. Ajuri pysyy
elossa sisemmän terminalin ja omistajan hallitun exitin yli. Sisemmän työn
pitää mahtua ulomman kokeen 25 sekunnin työbudjettiin; sen 5 sekunnin
cleanup-varaus ja 35 sekunnin hätäraja eivät kasva. Ulompi interventio on
aina hätäsiivousta, ei sisemmän omistajuuden hyväksyntä.

Tiedostoraja on `apps/e2e/experiments/processOwnership`-alueen erillinen
owner/bridge-projekti, runner, synteettiset fixturet ja sopimustestit sekä
omistavat ohjeet. Ei tuotanto-/installerimuutosta, uutta riippuvuutta,
nykyisten fixturejen siirtoa tai R28:n sulkua. Launch/stop-tilakone ja
viestisopimukset katselmoidaan ja testataan ennen oikeita prosesseja.
Työkuorma, cleanup ja näyttö säilyvät erillisinä; epävarmuus estää restartin
ja juuren poiston. Tarkoitukselliset caller-/owner-lossit ja muut lopullisen
T3-matriisin viat ratkaistaan erikseen, ei oleteta tämän kokeen kattamiksi.

##### Linuxin CI-edellytysten rajattu selvitys

T3a:n paikallinen read-only-havainto ei osoita hosted-CI:n delegointia.
Suositeltu seuraava pala on siksi erikseen hyväksyttävä, pelkästään lukeva
prerequisite-probe nykyisissä `e2e-system-security`- ja `e2e-web-critical`-
jobeissa. Se ei käynnistä synteettistä prosessipuuta tai omistajuusadapteria.

Ensimmäinen probe käyttää Node-standardikirjastoa ja lukee vain oman
prosessin `/proc/self/cgroup`- ja `/proc/self/mountinfo`-kytkennän sekä siitä
yksiselitteisesti ratkaistun cgroup v2 -kohteen tyyppi-, events- ja
käyttöoikeusmetadatan. Mountin juuri ja namespace huomioidaan; epäselvä
kohdistus on `unknown`, ei arvattu juurihakemisto. `cgroup.kill` on
write-only: siitä tarkistetaan vain olemassaolo ja pääsyvihje, ei sisältöä.
Ei `cgroup.procs`-jäsenlistaa, PID-inventaariota tai hakemistopuun kiertoa.

Probe ei luo cgroupia, avaa kohdetta kirjoittamista varten, siirrä tai
signaloi prosessia, aktivoi palvelua eikä nosta oikeuksia. Myös systemd-
kyselyt jätetään tästä ensimmäisestä rajauksesta pois (`notAttempted`).
Niiden tarve ja hallintaväylän saatavuus ratkaistaan myöhemmin; systemd:n
pelkkä asennus ei osoita omistajuuden edellytyksiä.

Ehdotettu suljettu tulossopimus:

- `schemaVersion: 1`, `evidence: ciPrerequisiteOnly`, kuluttaja
  `system-api` tai `web-chromium`, todellinen checkout-SHA sekä CI-ajon
  tunniste ja yritys. PR:n head-SHA ei korvaa checkoutin mahdollista merge-SHA:ta.
- `observation: complete | incomplete`; v2-kohdistus, cgroup-tyyppi,
  mountin `rw | ro | unknown` ja kill-tiedoston saatavuus suljetuilla enum-arvoilla.
- `accessHints` erottaa hakemistoon luomisen sekä nykyisten procs-/kill-
  kohteiden pääsyvihjeet `allowed | denied | unknown`. Ne eivät todista
  tulevan lapsiryhmän luontia, migraatiota tai kill-operaatiota.
- `systemd: notAttempted`, `ownershipProof: notAttempted`. Ei `supported`
  tai cleanup-hyväksyntää pelkän metadatan perusteella.

Lukukohtainen enimmäismäärä on 256 KiB, kokonaisbudjetti 10 sekuntia ja
julkaistava tulos yksi enintään 4 KiB:n JSON-rivi. Rajanylitys tai lukuvirhe
tuottaa rajatun syykoodin ja puutteellisen havainnon, ei retryä tai raakaa
stderr-tulostetta. Ei erillistä tiedostoartifactia, polkuja, PID/UID-arvoja,
palvelunimiä, kone-/versioinventaarioa tai ympäristömuuttujien sisältöä.
Puuttuva kyvykkyys on kelvollinen kielteinen havainto, ei Linux-tuen läpäisy.
Proben oma virhe ei ohita tavallisia testejä tai heikennä niiden statusta;
puuttuva/puutteellinen havainto ei kelpaa jatkopäätöksen myönteiseksi näytöksi.

**Toteutuksen ehdotettu tiedostoraja ja ajokytkentä:**

1. `apps/e2e/experiments/processOwnership/probeLinuxPrerequisites.mjs`
   sekä saman alueen `linuxPrerequisiteContract.mjs` ja
   `linuxPrerequisiteContract.test.mjs`. Puhtaat parseri-, schema-,
   redaktio-, kokoraja- ja virhetestit ennen CI:tä; synteettiset mountroot-,
   namespace-, escaped-path-, read-only-, threaded- ja puuttuvan tiedon tapaukset.
2. Git-juuren `.github/workflows/ci-cadence-contracts.yml` ja sen kutsuma
   `.github/workflows/ci.yml`: uusi oletuksena `false` oleva manuaalinen
   `linux_ownership_prerequisites`-valinta välitetään eksplisiittisesti.
   Nykyiset riskivalinnat, required checkit ja aikarajat säilyvät.
3. Luku tapahtuu nykyisten `Run isolated system security E2E tests`- ja
   `Run critical web E2E journeys` -askelten samassa ajokontekstissa juuri
   ennen nykyistä komentoa; webissä Chromium-asennuksen jälkeen.
   Askelten nimet ja varsinaiset testikomennot eivät muutu.
   CI-kytkennän sopimustesti lisätään nykyisten workflow-sopimusten rinnalle;
   se suojaa oletusarvon, välityksen sekä tavallisen testikomennon suorituksen
   ja exit-statuksen säilymisen myös proben virheessä tai aikakatkaisussa.
4. Kytkentä ja yksi seurattu manuaalinen CI-ajo hyväksytään ennen toteutusta.
   Tämä ei ole kevyt probe-only-workflow: normaali manuaalinen kadenssi
   ajaa myös nykyiset asennukset, buildit ja testit. Ensimmäinen virhe ja
   proben puuttuva näyttö säilytetään erikseen, ei uusintaa vihreän hakemiseksi.

[Kernelin cgroup v2 -sopimus](https://docs.kernel.org/admin-guide/cgroup-v2.html)
erottaa prosessin jäsenyyden ja reapingin: `populated=0` ei todista zombie-
prosessien odottamista. Käynnistä-ja-siirrä-malli jättää forkkiraon eikä
siirrä valmiita jälkeläisiä automaattisesti. Migraatio riippuu myös lähteen
ja kohteen yhteisen esivanhemman oikeudesta, jota tulevan kohteen puuttuessa
ei ole todistettu. Kill käsittelee operaation aikaiset forkit, ei korjaa
aiempaa sallittua poistumista omistetusta ryhmästä.

Vasta CI-havainnon jälkeen valitaan erikseen delegoitu cgroup + native-
omistaja tai hallittu systemd-palveluraja. Systemd-ympäristössä noudatetaan
[delegointisopimusta](https://systemd.io/CGROUP_DELEGATION/), ei kirjoiteta
palvelunhallinnan omistamaa puuta mielivaltaisesti. Päätös nimeää syntymisen
omistettuun ryhmään ennen työkuormaa, build-työkalut, reapingin, poistumisen
estot ja caller-/owner-lossin siivouksen. Pelkkä cgroup ei anna Windowsin
kill-on-close-sopimusta. Ensimmäinen oikeaprosessikoe on synteettinen Node-
puu ja erikseen omistettu ulkopuolinen sentinel, ei tavallisten fixturejen siirto.

##### Jatkon kontrolli- ja tulossopimus

Ennen adapterikoodia hyväksytään yhteinen, testikohtainen sopimus:

- Omistaja luodaan ennen workloadia, sidotaan uuteen sukupolveen ja
  testijuureen. Omistuskuitti ei ole health/readiness-kuitti.
- Kontrollikanava on erillinen stdout/stderristä. Rajattu start/stop ja
  suljettu schema; tuntematon, väärän sukupolven tai toistettu komento ei
  käynnistä tai kohdista signaalia uuteen prosessiin.
- Tuloksessa erotetaan `workloadOutcome`, `cleanupOutcome` ja
  `evidenceOutcome`. Virhe jää virheeksi onnistuneesta cleanupista huolimatta.
- Terminal vaatii valmistuneen luonnin, suljetun launch-portin, saman
  omistusobjektin tyhjyystodisteen ja omistajan hallitun sulun. Linuxin
  reaping-raja ratkaistaan erikseen. Puuttuva tai myöhäinen kuitti ei
  nollaa jo kirjattua epävarmuutta.
- Cleanupin epävarmuus estää restartin ja juuren poiston. Säilyvä alkuperäinen
  virhe ei oikeuta keskeyttämään cleanupia. Julkaistava havainto käyttää vain
  suljettuja syykoodeja, ei PID:itä, polkuja, ympäristöä tai raakaa virhettä.

Nämä ovat tulevan toteutuksen hyväksyttäväksi valmisteltuja ehtoja, eivät
T3a:n raakakuittien uusi hyväksymistapa. Tuotannon Diagnostics-, Activity-,
audit-, tukipaketti- ja backup-sopimukset eivät muutu.

##### Seuraavat päätökset ja työn järjestys

| Pala | Ennen toteutusta hyväksyttävä rajaus | Mitä se ei hyväksy |
| --- | --- | --- |
| T3b-E | Täsmällinen Playwright-korjausversio tai versionoitu minimipatch, riippuvuusarvio, kohdistetut regressiot sekä nykyisen normaalin ja varhaisen virhekokeen todennus. Lähderaja riippuvuuden odotusketjuun ja nykyiseen `processOwnership`-koealueeseen. | Globaalin virheen vaimennus, muuttunut fault, uusi yleinen Electron-ajuri, fixturejen siirto tai R28:n sulkeminen. |
| T3b-L | Yllä rajattu read-only-probe, sen testit ja oletuksena suljettu CI-kytkentä sekä yksi seurattu nykyisen kadenssin ajo. Voi edetä E:stä riippumatta. | cgroup-kirjoitus, systemd-palvelu, delegoinnin/oikeuksien muutos, native-omistaja tai väite Linux-tuen valmistumisesta. |
| Seuraava alustakoe | E:n ja Linux-havainnon jälkeen oma päätös Windows-adapterin ja Linux-mekanismin lähteistä, build-esiehdoista, kontrollista, terminalista ja testeistä. Windowsin ehdokas on nykyisen koealueen erillinen native-adapteri; Linuxin toteutuspolku päätetään vasta mekanismin mukana. | Kuluttajien siirto ilman lopullista T3-matriisia ja normaaleja hyväksyntäportteja. |

T3b-valmistelun lupa ei itsessään hyväksy mitään näistä toteutuspaloista.
Seuraavaa koetta ei käynnistetä ennen asianomaisen päätösrajan ratkaisua.
T3a:n 4/5 jää historiaksi ja R28 avoimeksi. Tässä dokumentointivaiheessa
ei suoritettu uusia Windows-/Linux-prosessikokeita tai CI-ajoja.

##### T3b-L:n toteutusvaltuus

Omistaja hyväksyi 2026-09-25 yllä rajatun Linux-proben, sen CI-kytkennän
ja yhden seuratun normaalin kadenssin CI-ajon. Samalla luotiin Goal koko
T3:n loppuun viemiselle; tämä ei ohita taulukon riippuvuus-, alustamekanismi-
tai oikeusmuutospäätöksiä. T3b-E:stä valmistellaan täsmällinen ehdotus ennen
riippuvuusmuutosta. R28 jää avoimeksi lopullisiin hyväksyntäportteihin asti.

T3b-L:n aloitusrajat: vain koealueen Node-standardikirjastoprobe ja sen
sopimustestit sekä kahden nykyisen workflow'n oletuksena suljettu kytkentä.
Ei synteettisiä työkuormia, cgroup-kirjoituksia, systemd-kyselyjä tai uusia
riippuvuuksia. Pääagentti vastaa paikallisten kohdetestien seurannasta;
CI:lle nimetään erillinen lukuseuranta ennen käynnistystä. Ensimmäinen
epäonnistunut näyttö säilytetään. Tarkka checkout sidotaan CI:n Git-lukuun,
ei oletukseen PR:n head-revisiosta. Proben tulos erotetaan testien tuloksesta.

CI-askel kirjaa JSON-havainnon lisäksi vain suljetun päättymismerkin
`LINUX_PREREQUISITE_EXIT_OK` tai `LINUX_PREREQUISITE_EXIT_UNVERIFIED`.
Havainnon käyttö edellyttää sekä täydellistä oikeaan ajoon sidottua JSONia
että normaalia exit-merkkiä. Esimerkiksi jo jonoon kirjoitettu tulos ei
poista tulostuksen aikakatkaisua. Puuttuva rivi tai merkki on varmentamaton;
varsinaisen testikomennon tulos säilyy tästä riippumatta.

##### T3b-L:n toteutuscheckpoint

2026-09-25: Node-standardikirjastoon rajattu probe, puhdas sopimus ja
erilliset lukijan testit toteutettu `processOwnership`-koealueelle.
CI-kadenssin kaksi nykyistä Linux-askelta kutsuvat probea vain manuaalisella
opt-in-valinnalla. `EKY_E2E=1`, GitHub-konteksti ja tarkka checkout/run/attempt
validoidaan ennen host-lukuja. Proben JSON ja päättymismerkki ovat eri todisteita;
varsinaiset testikomennot ja niiden exit-status säilyvät.

Katselmuksessa havaittu myöhäisen stdout-kuittauksen järjestysvirhe
todennettiin ensin hylkäävällä regressiolla ja korjattiin tarkistamalla
monotoninen aikaraja myös ennen onnistunutta exit-tilaa. Erillinen katselmus
korjasi Windows-sopimustestin Bash-valinnan sitoutumaan löydettyyn Git-
asennukseen. Täydellinen paikallinen `pnpm test:ci` läpäisi 95/95:
aiemmat CI-sopimukset, uusi kytkentä sekä parseri-, lukija- ja CLI-guard-
testit. Ei ohitettuja tai peruttuja testejä. Ensimmäiset havainnot säilyvät
erillään korjauksen jälkeisestä tuloksesta.

Todellinen Linux-CI-probe ja seurattu kokonaisajo ovat vielä tekemättä.
Sopimustestit eivät ole cgroup-omistajuusnäyttöä. Tuotantokoodi,
riippuvuudet, asennettu sovellus, aikarajat ja normaalin CI:n valinta eivät
muuttuneet. Käyttäjän UI-, Diagnostics-, audit-, tukipaketti- ja backup-
sopimuksiin ei tule muutosta; niiden tuotantohyväksyntää ei väitetä tehdyksi.
R28 ja lopullinen T3-matriisi jäävät avoimiksi.

##### T3b-L:n ensimmäinen CI-havainto ja sopimuskorjaus

[Seurattu ajo 36137467962](https://github.com/eky-software/eky/actions/runs/36137467962),
yritys 1, checkout `a49904afb32f6d12a5fbf0c291bbbc47d48f7b7b`:
molempien Linux-kuluttajien sidottu JSON-havainto ja normaali
`LINUX_PREREQUISITE_EXIT_OK` saatiin niiden omista testiaskeleista.
Kummassakin v2-kohdistus oli `mapped`, tyyppi `domain`, mount `rw`,
events `observed` ja kill `present`; kaikki kolme pääsyvihjettä olivat
`denied`. `systemd` ja `ownershipProof` pysyivät `notAttempted`-tilassa.
Havainto ei hyväksy suoraa cgroup-kirjoitusta eikä osoita Linux-ratkaisua
mahdottomaksi. Hallintaväylä, valtuudet ja mekanismi tarvitsevat oman päätöksen.

CI:n ensimmäinen hylkäys tuli `core / Test, typecheck and build` -jobin
`Run tests` -vaiheesta: desktopin T1-kytkentätestin literal-odotuksesta puuttui
uusi hyväksytty opt-in-rivi. Tyyppitarkistus ja buildit jäivät tässä jobissa
ajamatta. Ajorevisio pysyy hylättynä; sitä ei ajeta uudelleen vihreän hakemiseksi.
Loppukoonti vahvisti saman hylkäyksen: 36 jobia läpäisi, tämä core-job
ja sen vuoksi `V2 acceptance` hylättiin; yksi valinnainen diagnostiikkajob
ohitettiin suunnitellusti. Muita epäonnistuneita jobeja ei ollut.

Virhe toistettiin paikallisesti ennen korjausta. Odotukseen lisättiin vain
hyväksytty rivi ja kolme mutaatiotestiä: puuttuva, aina päällä oleva ja
manuaalirajan ohittava valinta hylätään. Tiukka yhtäsuuruusvertailu, vanhat
testit ja CI:n hyväksyntäehdot säilyvät. Riippumaton katselmus ei löytänyt
korjattavaa. Kohdesarja läpäisi 61/61, koko paikallinen `pnpm test` 3862
testiä ja kahdeksan ennestään määriteltyä ohitusta sekä workspace-typecheck.
Backendin, webin ja desktopin paikalliset buildit läpäisivät myös.
Korjatun revision `0235d7270bde2edf43dc4c998ff9bf86f23ec401`
[oma seurattu CI-ajo 36140255216](https://github.com/eky-software/eky/actions/runs/36140255216),
yritys 1, läpäisi: 38 onnistunutta jobia, yksi ennalta valinnainen ohitus,
ei epäonnistuneita jobeja ja `V2 acceptance` hyväksytty. Molemmat manuaaliset
diagnostiikkavalinnat olivat pois päältä. Tämä sulkee CI-sopimuskorjauksen,
ei muuta alkuperäistä hylkäystä tai todenna myöhemmin aloitettua Playwright-
patchia. Linuxin pääsyhavainto tulee edelleen ensimmäisestä ajosta.

##### T3c-L:n rajattu namespace-koe: päätösehdotus

T3b-L:n kielteiset cgroup-pääsyvihjeet eivät kerro user/PID-namespacejen
saatavuudesta. Seuraavaksi ehdotetaan yhtä ehdollista synteettistä koetta
kummassakin nykyisessä Linux-jobissa. **Tätä ei ole vielä hyväksytty eikä
toteutettu.** Ensin vaaditaan korjatun lähtörevision CI-portti.

Erikseen hyväksyttävä työkalu on runnerilla ennestään oleva util-linux
`unshare`; ei asennusta, kääntäjää, systemd-palvelua, cgroup-kirjoitusta,
sudoa, suojausrajoituksen löysennystä tai vaihtoehtoiseen tapaan siirtymistä.
Kiinteä argumenttijono on `--user --map-current-user --setgroups=deny
--mount --propagation=private --mount-proc=/proc --pid --fork
--kill-child=SIGKILL --`, jonka jälkeen tulevat nykyinen Node ja oma
synteettinen init-scripti validoituine koeargumentteineen. Ei shelliä tai
ulkopuolelta valittavaa ohjelmaa. [Util-linuxin sopimus](https://man7.org/linux/man-pages/man1/unshare.1.html)
määrittää tämän luonnin ja normaalin lapsen odotuksen.

Hyväksyntä koskee nimenomaisesti uuden user-namespacen sisäisiä
luontioikeuksia sekä sen yksityistä proc-mountia. Numerollinen käyttäjä
pysyy samana eikä host-root-oikeuksia hankita. Uuden namespacen luonnissa
syntyy silti [namespace-kohtaisia capability-oikeuksia](https://man7.org/linux/man-pages/man7/user_namespaces.7.html).
Init hyväksyy vain PID 1:n, muuttumattomat ei-nollatunnisteet ja nollatut
`CapEff`, `CapPrm`, `CapInh` ja `CapAmb` -arvot ennen työkuormaa.
`CapBnd` ei ole sama asia. `--keep-caps` ja root-mäppäys ovat kiellettyjä.

Ulkoinen havaitsija omistaa erillisen sentinelin ja `unshare`-wrapperin.
Wrapper odottaa namespace-initin päättymistä. Init käynnistää vasta tuoreen
sukupolven `READY`/`GO`-vaihdon jälkeen yhden rootin ja sen irrotetun,
TERM-signaalia vastustavan leafin. Kontrollille luodaan oma stdin-putki;
CI:n stdin ei periydy. Vastaukset kulkevat rajatulla fd3-kanavalla ja
stdout/stderr pidetään erillään. Root/leaf eivät peri näitä kontrolli- tai
vastauskahvoja; niiden rajatut kuittaukset kulkevat initin omistamien omien
kanavien kautta. Ympäristö sulkee preload- ja muut suoritus-hookit pois.

Leaf-yhteyden siirto määritellään ennen toteutusta: init käynnistää rootin
stdio-valinnalla `['ignore', 'ignore', 'ignore', 'ipc', 'pipe']` ja säilyttää
oman fd4-kanavan pään. Root välittää vain vastapään leafille valinnalla
`['ignore', 'ignore', 'ignore', 'ignore', 4]`, sulkee oman kopionsa ja poistuu.
Leaf käyttää fd4:ää kaksisuuntaisena `net.Socket`-kanavana. Init luo tuoreen
haasteen vasta rootin odotetun **exit**-tapahtuman jälkeen; vasta oikean
sukupolven leaf-vastaus saman 8 sekunnin budjetin sisällä kelpaa.
Rootin **close**-tapahtumaa ei odoteta ennen haastetta, koska leaf pitää
kanavaa tarkoituksella auki. Kanava ei anna GO-/stop-valtuutta tai cleanup-
todistetta. [Noden stdio- ja exit/close-sopimus](https://nodejs.org/docs/latest-v24.x/api/child_process.html)
sekä [fd-pohjainen Socket](https://nodejs.org/docs/latest-v24.x/api/net.html#new-netsocketoptions)
ohjaavat toteutusta. Ennen exit-tapahtumaa puskuroidut vastaukset, väärä tai
toistettu haaste, EOF, kanavavirhe ja myöhäinen vastaus hylätään testeissä.

Rootin odotetun exitin jälkeen vaaditaan tuore leaf-elossa-kuittaus, joka
syntyy vasta TERM-käsittelijän asentamisen jälkeen. Vasta sitten havaitsija
sulkee kontrollin. Initin exit 41 varataan vain ajoissa käsitellylle,
odotetulle EOF:lle; expiry, virhe ja puuttuva näyttö eivät saa käyttää sitä.
Hyväksytty normaali wrapper-wait ja sulkeutuneet virrat tukevat vain tämän
namespace-instanssin purkuhavaintoa. Initin oma ennakkokuitti tai wrapperin
tappaminen eivät riitä. [Kernelin purkukoodi](https://github.com/torvalds/linux/blob/v6.8/kernel/pid_namespace.c#L160-L258)
ja [util-linuxin wait-ketju](https://github.com/util-linux/util-linux/blob/v2.39.3/sys-utils/unshare.c#L936-L941)
ovat tämän lähdepäättelyn peruste, eivät vielä EKY:n koetulos.

Kaikki rajat lasketaan samasta prosessien välillä vertailukelpoisesta
monotonisesta aloitushetkestä: READY 5 s, työkuorman näyttö 8 s, initin
expiry 10 s, leafin 12 s, wrapperin rajattu hätäkatkaisu 14 s, sentinelin
expiry 16 s ja raportointiraja 20 s. Deadline tarkistetaan myös ennen GO:ta,
EOF:n hyväksymistä, exit 41:tä ja onnistumispäätöstä. Nämä ovat uuden kokeen
valvontabudjetteja, eivät lupaus kovasta seinäkelloajasta tai nykyisten
testien aikarajojen muutos. Ei rajatonta forkkia, busy-loopia, SIGSTOPia tai
ptracea. Hätäkatkaisu kohdistuu vain omaan yhä avoimeen lapsiprosessiin,
ei PID-hakuun. Epävarmuus estää seuraavan kokeen ja testijuuren poiston.
Sentinelin on vastattava tuoreeseen haasteeseen ennen ja jälkeen purun,
ja se pysäytetään sekä odotetaan erikseen.

Kytkentä olisi uusi oletuksena `false` oleva manuaalinen
`linux_pid_namespace_experiment` nykyisessä caller/reusable-CI-ketjussa,
vasta kummankin nykyisen Linux-testikomennon onnistumisen jälkeen.
Nykyinen testivirhe säilyy. Todennettu puuttuva edellytys on kielteinen
havainto; tuntematon bootstrap-virhe jää epäselväksi, eikä GO:n jälkeistä
virhettä tulkita puuttuvaksi edellytykseksi. Odottamaton koevirhe hylkää
ajon. Ei uutta workflowta, jobia, retryä tai heikennettyä hyväksyntää.

Tiedostoraja on nykyisen kokeen alueen `runPidNamespaceExperiment.mjs`,
`pidNamespaceInit.mjs`, `pidNamespaceActor.mjs`, rajattu sopimus ja testit;
lisäksi nykyiset kaksi workflowta, niiden kytkentätestit ja omistavat ohjeet.
Puhtaat testit suojaavat argumentit, kahvat, launch-portin, deadlinet,
virheet, sentinelin erottelun ja normaalin CI-komennon statuksen.
Julkaistaan vain rajattu suljettu JSON, sidottuna kuluttajaan, checkoutiin,
ajoon ja yritykseen. Työkuorma, cleanup ja näyttö erotetaan.

Tämä ei kokeile wrapperin pakkokuolemaa, todellista caller-/owner-lossia,
Chromiumia tai tuotantoprofiilia eikä hyväksy fixture-siirtoa tai R28:aa.
Node ei muutu yleiseksi orphan-reaperiksi; lyhyt koe nojaisi lopussa
kernelin namespace-purkuun. Pitkäikäisen initin reaping ja omistajan
kuoleman yli säilyvä odotustodiste tarvitsevat edelleen oman ratkaisunsa.

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
