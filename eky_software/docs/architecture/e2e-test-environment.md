# E2E-testiympäristö

Tämä dokumentti määrittelee Eky R0:n Playwright-pohjaisen järjestelmätestauksen
turvarajat. E2E-runtime on testausinfrastruktuuria, ei liiketoimintamoduuli.

T3:n jatkaminen: [nykyinen lähtötila, avoin puute ja seuraava työ](release-0.3.0-m1-preparation-plan.md#jatka-tästä).
Tämän dokumentin päivätyt koeraportit ovat historiallista näyttöä;
[lopullinen valmistumisportti](#t3n-lopullinen-hyväksyntänäyttö) koskee
myös oikeita testikuluttajia, ei vain erillistä koetta.

## Omistajuus

`apps/e2e` omistaa Playwright-konfiguraation, testien prosessien elinkaaren,
testikohtaiset polut, selainverkon estot ja turvalliset epäonnistumisartefaktit.

Backendin testikoostaminen kuuluu `apps/backend/e2e`-alueelle. Se saa koota
production-portteihin testiadaptereita, mutta sitä ei käännetä tavalliseen
backend-buildiin eikä pakata desktop-sovellukseen. Production-koodiin ei lisätä
testireittejä, reset-pintoja, testipainikkeita tai rendereristä ohjattavaa
fault injectionia.

## T-paketin valmistelu

**2026-09-27: T1 ja T2 hyväksytty PR/main-porttien jälkeen; T3c-W:n
rajattu koe sekä LM:n actor- ja Chromium-yhteensopivuuskokeet läpäisty.
Oikeiden fixturejen siirto ja lopullinen T3 ovat avoinna. Linuxin vanha
LS-hylkäys säilyy erillisenä havaintona.**
[M1-valmistelu](release-0.3.0-m1-preparation-plan.md)
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

**Tila 2026-09-26: T3/R28 kesken; T3c-W:n neljä rajattua koetta läpäisty,
Linuxin LS-koe hylätty ennen GO:ta; rajattu LM-sessionhallinta toteutuksessa.**
T3b-E:n ja T3b-P:n korjattu CI-lähtötila on todennettu niiden omissa
checkpointeissa. Uuden T3c-revision kokonaisajo on päättynyt hylätyksi;
[käynnistysvirhe](#t3c-ln-ensimmäisen-ci-kokeen-hylkäys) estää hyväksynnän.
[T3c-LD:n lisähavainto](#t3c-ldn-rajatun-ci-kokeen-havainto)
rajasi molempien uusien kokeiden hylkäyksen ennen READYä: wrapper exit 1,
stderr `other`, init-merkki puuttuu. [LS:n uusi havainto](#t3c-lsn-rajatun-ci-kokeen-havainto)
tunnisti UID-map-kirjoituseston; estävä taustapolitiikka on edelleen avoin.
T3a:n alkuperäinen 4/5 sekä myöhemmät erilliset hylkäykset jäävät historiaksi.
Omistaja hyväksyi [rajatun LM-sessionhallinnan](#t3c-lm-rajattu-ci-testisession-hallinta)
suunnittelun ja toteutuksen Goalin sisällä. Fixture-siirto odottaa todellisen
mekanismin ja koko matriisin näyttöä.
Integraation lähtökohta on hyväksytty T2-main;
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
Tämän valmistelucheckpointin aikaan vaihtoehtoa ei ollut hyväksytty.
Myöhempi erillinen patch-päätös ja sen näyttö ovat alla; upstream-version
käyttöönottoa ei hyväksytty tämän päätöksen mukana.

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

##### T3b-E:n kokonaisajon legacy-hylkäys

Revision `f007bda2219ad473fc20c3a948b08e4974641451`
[kokonaisajo 36167733407](https://github.com/eky-software/eky/actions/runs/36167733407),
yritys 1, päättyi hylättynä: 36 onnistunutta jobia, yksi ennalta valinnainen
ohitus sekä legacy run 1:n ja siitä riippuvan kokoavan hyväksyntäportin hylkäys.
Saman revision [riippuvuustarkistus 36167746427](https://github.com/eky-software/eky/actions/runs/36167746427)
läpäisi. Nykyisen sovelluksen Windows-paketointi, packaged smoke ja kaikki
38 kriittistä Electron-testiä läpäisivät ensimmäisillä yrityksillä.

Ensimmäinen varsinainen virhe oli `sourcePackagedSmokeFailed`, tarkennuksin
`applicationReportedFailure`, `backend`, `failed`, `initial`.
Se syntyi historiallisesta lähteestä uudelleen rakennetun 0.2.6-version
smokessa ennen varsinaista päivitystä. Lopun `processExitFailed` ja
`WINDOWS_ACCEPTANCE_LEGACY_LIFECYCLE_FAILED` välittävät hylkäyksen;
ne eivät yksilöi alkuperäistä syytä. Vaiheen kesto ei yksin todista timeoutia.
Lähtö- ja kohdeartifactien ennen/jälkeen-varmennus läpäisi. Saman artifactin
toinen legacy-consumer läpäisi, mutta se ei kumoa ensimmäisen hylkäystä.

Nykyinen turvallinen projektio säilytti ensimmäisen virheen vaiheen ja
syyluokan mutta ei sovelluksen tarkkaa virhekoodia. Historiallisen lähteen
`backend`-vaihe kattaa käynnistyksen lisäksi sen jälkeisiä valmius- ja
terveystarkistuksia, joten se ei yksin osoita backend-prosessin kaatumista.
Tämä havainto pidetään erillään aiemmasta development-Electronin
firstWindow-timeoutista. Seuraava rajaus tutkii ensin säilyneen aineiston
ja virheen projektion; uutta ajoa, arvattua korjausta tai aikarajamuutosta
ei käytetä puuttuvan syytiedon korvikkeena. T3b-P, T3c ja PR/main pysyvät
avoimina. Tämä checkpoint ei hyväksy baselinea eikä sulje R28:aa.

Rajattu harness-korjaus säilyttää jatkossa validoidusta virhetuloksesta
[suljetun sovellusvirheluokan](windows-installer-acceptance-harness-v2.md)
(`smokeFailureClass`) olemassa olevaan vaihehavaintoon. Luokitus käyttää
vain 16 täsmällisesti nimettyä historiallisen kirjoittajan startup-koodia;
muut arvot jäävät `unclassified`-luokkaan. `notReported` tarkoittaa, ettei
validoitua sovelluksen virhetulosta havaittu. Raakaa koodia tai polkua ei
julkaista. Alkuperäisen ajon tarkkaa luokkaa ei voida palauttaa jälkikäteen
sen säilyneestä suljetusta projektiosta.

Regressiot osoittivat puutteen ensin 27 hylkäyksellä ja läpäisivät saman
27 tapauksen sarjan korjauksen jälkeen. Omistavien smoke-, lifecycle- ja
Windows-runtime-sopimustestien kokonaisuus läpäisi 73/73 ilman ohituksia.
Virhetulos pysyy hylättynä myös havaintoketjun heittäessä poikkeuksen;
seuraavaa sukupolvea tai upgrade-vaihetta ei aloiteta. Tuotanto, historiallinen
0.2.6, tulostiedoston validaattori, aikarajat ja CI-ehdot säilyvät ennallaan.
Riippumaton katselmus ei löytänyt korjattavaa. Revision
`7e26f06906567a96a51a3c6ef1cf142bf17fe5e0`
[yksi kohdennettu legacy-koe 36176346468](https://github.com/eky-software/eky/actions/runs/36176346468)
läpäisi yrityksellä 1 saman epäonnistuneen kokonaisajon artifactilla
`10879996614`. Harnessin revisio oli `7e26f069`, mutta sovelluspakettien
build-revisio säilyi `f007bda2`: paketteja ei rakennettu uudelleen.
Ennen/jälkeen-tavusidos, historiallinen smoke, päivitys, kohteen kaksi
käynnistystä, siivous, tuloksen julkaisu ja pakollinen caller-varmennus
läpäisivät. Inspector-kaappausta ei käytetty.

Alkuperäinen virhe ei toistunut, joten uuden virheluokan toimitusta oikeasta
CI-virhehaarasta ei tässä ajossa havaittu. Sen luokitus- ja välityssopimus
on todennettu regressioissa, ei tämän onnistuneen ajon virherivillä.
Alkuperäisen hylkäyksen juurisyy jää avoimeksi. Kohdekoe ei korvaa normaalia
V2-hyväksyntää, muuta vanhan ajon hylkäystä tai sulje T3/R28:aa.

##### T3b-E:n normaalin baselinen rollback-sopimushylkäys

Diagnostiikkakorjauksen jälkeinen normaali
[V2-ajo 36178371145](https://github.com/eky-software/eky/actions/runs/36178371145)
käynnistettiin kerran revision `07021d5089715451623be774cf3f464fd44c0cac`
yrityksenä 1 ilman inspector-kaappausta tai Linuxin opt-in-probea.
Saman revision [riippuvuustarkistus 36178382747](https://github.com/eky-software/eky/actions/runs/36178382747)
läpäisi. V2 valmistui hylättynä: 36 onnistunutta jobia, yksi ennalta valinnainen
ohitus sekä Windowsin prosessisopimusjobin ja kokoavan hyväksyntäportin hylkäys.
`rollback bootstrap supervised handoff: completed` sai
supervisorilta paluukoodin 1 odotetun nollan sijaan. Kolme muuta handoff-tapausta
ja binary-handoff-sopimukset läpäisivät. Tämä ei ole sama havainto kuin
historiallisen lähtöversion smoke tai development-Electronin firstWindow.

Jobin ensimmäinen virheloki on säilytetty. Testin paluukoodiväite pysäytti
suorituksen ennen terminal-tuloksen ja handoff-vaiheiden lukemista. Niitä ei
tallennettu tämän jobin julkiseen lokiin tai artifactiin. Noin 30 sekunnin
kesto ei yksin todista `deadlineExceeded`-syytä tai yksilöi juurisyytä.

Rajattu jatkomuutos kuuluu vain rollbackin testiharnessiin: supervisorin
todellisen `close`-rajan jälkeen ja ennen entisiä assertioneita luetaan nykyisen
validaattorin sitoma terminal-tulos sekä vain tunnettu, järjestykseltään
kelvollinen handoff-vaihejono. Konsoliin projisoidaan suljetut tulosluokat ja
viimeinen vaihe, ei polkuja, noncea, raakavirheitä tai tiedostojen sisältöä.
Puuttuva tai virheellinen havainto näkyy sellaisena; alkuperäiset pakolliset
tarkistukset, hylkäys, cleanup ja aikarajat säilyvät. Tuntematonta protokollavikaa
ei korjata arvaamalla. Regressio, riippumaton katselmus ja rajattu Windows-näyttö
vaaditaan ennen tämän diagnostiikan hyväksyntää. Uutta kokonaista baselinea
ei käynnistetä pelkän vihreän uusinta-ajon hakemiseksi.

T3b-P:n toteutus, alustamekanismit ja PR/main-portti eivät etene tämän
hylätyn osatuloksen perusteella. Alkuperäiset erilliset havainnot pysyvät avoimina.

Rajattu diagnostiikka on toteutettu ja katselmoitu ilman korjattavia löydöksiä.
Puhtaat projektio- ja bootstrap-lukijasopimukset läpäisivät 8/8; yksi rajattu
Windows-prosessisopimussarja läpäisi 18/18 ilman ohituksia tai uusintaa.
Todellisesta nykyisestä supervisorista saatiin erikseen onnistumisen,
bootstrap-hylkäyksen, helperin ennenaikaisen poistumisen ja tarkoituksellisen
helper-jumituksen suljetut tulos- ja vaiherivit. Testikytkennän ja terminal-
validaattorin kohderegressiot läpäisivät myös 66/66. Kussakin handoff-tapauksessa puun poissaolo
varmennettiin nykyisellä sopimuksella. Tämä todistaa diagnostiikan kytkennän,
ei alkuperäisen CI-hylkäyksen syytä tai normaalin baselinen hyväksyntää.
Sovellus- ja MSI-käyttäytyminen, versiot, riippuvuudet, aikarajat ja CI-ehdot
eivät muuttuneet.

Säilytettyjen 38 V2-jobin lokien checkout- ja hash-sidokset tarkistettiin
erikseen ensimmäistä yritystä vasten; riippuvuustarkistuksen loki tarkistettiin
samoin. Kaikki muiden jobien läpäisyt jäävät tämän hylätyn kokonaisajon
osatuloksiksi. Jatkon yksi normaalin kadenssin täsmällisen korjausrevision
ajo todentaa myös uuden diagnostiikan CI-kytkennän; sitä ei nimetä vanhan
syyn korjaukseksi, vaikka virhe ei toistuisi. Ennen sitä checkpoint katselmoidaan
ja työkalujen seurantavastuu nimetään normaalin ohjeen mukaan. Uutta rajattua
CI-kytkintä tai workflowta ei lisätä tämän havainnon vuoksi.

##### T3b-E:n toistunut firstWindow-hylkäys ja backendStart-rajaus

Rollback-diagnostiikan revision
`66d6177004c6b871743093a24c9740507f1f6cfe` normaali
[V2-ajo 36182721794](https://github.com/eky-software/eky/actions/runs/36182721794),
yritys 1, päättyi hylättynä: 36 onnistunutta jobia, Electronin kriittisen
E2E-jobin ja koontiportin hylkäys sekä yksi ennalta valinnainen ohitus.
Saman revision [riippuvuustarkistus 36182729497](https://github.com/eky-software/eky/actions/runs/36182729497)
läpäisi. Inspector ja Linuxin opt-in-probe eivät olleet käytössä.

Windowsin rollback-prosessisopimukset läpäisivät 18/18 ja kaikki neljä
suljettua terminal-/handoff-projektiota tallentuivat CI:ssä. Myös molemmat
legacy-kuluttajat ja workspace-fault-toistot läpäisivät. Nämä osatulokset
eivät korvaa koko ajon hylkäystä tai ratkaise vanhojen hylkäysten syitä.

`DESK-WORKSPACE-MIGRATION-INVENTORY-001` sekä
`DESK-SUPPORT-001` / `DESK-LOGFOLDER-001` epäonnistuivat ensimmäisillä
yrityksillään fixturen `firstWindow`-odotukseen ennen testirunkoa. Nykyinen
automaattinen retry onnistui, joten tulos oli oikein 2 flaky / 36 passed
ja jobin paluukoodi 1. Uutta ajoa tai pidempää aikarajaa ei käytetty
tämän tuloksen korvaamiseen.

Alkuperäisen lifecycle-artifactin tiiviste ja puretut JSON-tavut varmennettiin.
Molempien ensimmäisten yritysten tallenne sisältää
`backendStartup.status=observed` ja `stage=backendStart`; kummankaan
havaintolistaa ei katkaistu kapasiteettirajaan. Testirunnerin
kirjoittajan mukaan käynnistyskomento siis vastaanotettiin, broker-clientit
luotiin ja backend-moduulin import valmistui. Havainto edeltää
`startE2eBackend`-kutsua eikä todista sen config-, tiedosto-, tietokanta-,
migraatio-, composition- tai kuunteluvaiheen valmistumista. Aiempi epävarmuus
pelkästä lähetetystä IPC-viestistä tarkentuu näissä kahdessa yrityksessä;
vanhan eri yrityksen puuttuvaa havaintoa ei täydennetä jälkikäteen.

Fixture raportoi API- ja runtime-siivouksen valmistuneeksi, portin
vapautuneeksi ja testijuuren poistetuksi. Tämä ei ole T3:n uuden koko
prosessipuun omistajuusmekanismin hyväksyntä. Kaikkien 38 suoritetun
V2-jobin alkuperäiset lokitiivisteet ja checkout-sidokset tarkistettiin;
isojen MSI-arkistojen paikallista tavutarkistusta ei väitetä tehdyksi.

Riippumaton lähdekatselmus erottaa kaksi ajoitussopimusta: fixturen
`firstWindow`-odotus ja backendin readiness-odotus alkavat eri kohdissa.
Ikkunaodotus voi päättyä ensin, joten `backendReadinessTimedOut`-havainnon
puuttuminen ei osoita backendin valmistuneen. Main-prosessin havaintoajat
eivät ole fixturen deadlinen lähtöaikoja. Lisäksi startup-havainto pyydetään
vasta launch-virheen jälkeen ilman odotusta, eikä myöhäistä vastausta
hyväksytä jo suljettuun raporttiin. Tämä havaintopyyntö ei siis kuluttanut
edeltävää firstWindow-aikabudjettia. Kumpikaan seikka ei yksilöi viiveen syytä.

Erillinen staattinen siivouspuute: `closeOwnedElectronRuntime` odottaa
`runtime.close()`-kutsua ennen nykyisen graceful-exit-turvarajan ja
prosessipuusiivouksen käynnistymistä. Päättymätön close voi estää fallbackin
ja lifecycle-raportoinnin. Tämä ei selitä näitä kahta yritystä, joiden
siivous valmistui, eikä sitä merkitä tämän diagnostiikan korjaamaksi.
T3:n cleanup-sopimuksen regressioon tarvitaan hallittu pending-close-tapaus:
fallback säilyy saavutettavana nykyisessä budjetissa, alkuperäinen
käynnistysvirhe säilyy ja varmentamaton siivous estää testijuuren poistamisen.
Toteutus sovitetaan T3:n omistajuusratkaisuun erillään tämän virheen rajauksesta.

Seuraava rajattu tutkimus kohdistuu testibackendin tähän käynnistysväliin
sekä fixturen ikkunaodotuksen ja havaintojen ajoitussopimukseen.
Pelkkä viimeinen havaittu vaihe tai hidas onnistuva uusinta ei yksilöi
juurisyytä. Tuotantokoodia, moduulien vastuita, deadlineja tai CI-ehtoja ei
muuteta arvaamalla. Mahdollinen lisähavainto pidetään testikerroksessa,
sidotaan todelliseen kirjoittajaan ja testataan ennen uutta kohdekoetta.

##### T3b-E:n rajattu backend-lokihavainto

Rajattu lisähavainto kuuluu `apps/e2e`-fixtureen, ei tuotannon
käynnistykseen. Ensimmäisen launch-virheen kohdalla, ennen fixture-siivousta,
otetaan yksi synkroninen otos kyseisen testiruntimen olemassa olevasta
backend-lokista. Onnistuva launch ei lue lokia. Main-prosessin nykyistä
valinnaista havaintopyyntöä ei odoteta; kumpikaan havainto ei
muuta ikkunan, backendin readinessin tai cleanupin aikarajaa.

Lukija hyväksyy vain testikohtaisen OS-temp-juuren oman userData-hakemiston
kiinteän `runtime/logs/backend`-alahakemiston. Se ei lue konfiguraatiota
uudelleen, etsi aktiivista työtilaa tai varahakemistoa eikä seuraa linkkejä.
Ei rekursiivista lukua: enintään 64 hakemistomerkintää, 16 JSONL-tiedostoa,
64 KiB yhdestä tiedostosta ja yhteensä 256 KiB sekä enintään 16 KiB rivistä
ennen JSON-jäsennystä. Tiedoston identiteetti ja yksittäinen linkki
tarkistetaan avatusta kahvasta; saman kahvan avaamishetken koko rajaa luvun.
Kasvua ei seurata eikä vajaata viimeistä riviä tulkita kokonaiseksi.

Jokainen tapahtuma kulkee nykyisen backend-validaattorin läpi ja sen
runtime-tunnisteen on vastattava epäonnistunutta testigeneraatiota. Raporttiin
projisoidaan vain suljetun käynnistysjoukon tapahtumanimi/tulos-parit ja
erillinen shutdown-havaintojoukko. Polut, runtime- ja tapahtumatunnisteet,
aikaleimat, virhepayloadit sekä raakaloki eivät siirry liitteeseen. Havainto
säilyy muistissa muuttumattomana nykyiseen `electron-lifecycle.json`-liitteeseen
asti, vaikka cleanup poistaisi lähteen tai kirjoittaisi shutdown-tapahtumia.

Tämä on havaittujen tapahtumien joukko, ei prosessien välinen aikajana.
Esimerkiksi `backend.starting`/`success` tarkoittaa vain kyseisen eventin
onnistunutta kirjausta, ei käynnistyksen valmistumista. Puuttuva, osittainen,
virheellinen tai rajaan osunut lähde erotetaan ehjästä luetusta otoksesta.
Myöskään ehjä otos ei todista lokin täydellisyyttä: writer on best-effort,
ja configin/faultin valmistelu ennen loggerin luontia jää tämän ulkopuolelle.
Rajattu tavumäärä ei ole tiedostojärjestelmän vasteajan takuu.

Regressio vaatii aidon backend-writerin, validaattorin, suljetun projektion,
launch-virheen observerin, cleanupin ja liitteen ketjun sekä onnistumispolun
muuttumattomuuden. Lisäksi tarkistetaan väärä runtime, linkit, ulkopuolinen
juuri, virheellinen sisältö ja lukurajat. Tämä ei muuta tuotannon Diagnostics-,
Activity-, tukipaketti- tai incident-sopimuksia, tietokantaa, backupia,
riippuvuuksia, testisuodatusta eikä CI:n ehtoja.

Kohdesarja läpäisi 52/52 ilman ohituksia tai uusintaa: 19 lukijan regressiota,
21 lifecycle-sopimusta ja 12 aiempaa backend-startup-sopimusta. Koko työtilan
normaalit testit läpäisivät 3 907 testillä ja 8 ennestään olevalla ohituksella;
E2E:n ja koko työtilan tyypitystarkistukset läpäisivät. Riippumaton koodin ja
dokumentaation katselmus ei löytänyt korjattavaa. Writer ja raportointiketju
ovat testeissä todellisia, mutta launch ja cleanup ohjattuja korvikkeita;
varsinaisen fixturen kytkentä tarkistettiin lähteestä. Tämä on sopimustodiste,
ei vielä uuden oikean Electron-ajon näyttö. Koko normaalin CI-baselinen
hyväksyntä, timeoutin syy ja T3/R28 ovat edelleen avoimia.

Tämä sopimuscheckpoint edeltää alla olevaa normaalia CI-todennusta.

##### T3b-E:n vihreä normaali baseline

Revision `1953b6b05dd7bdd4aaea24b509416fafa353d1ce`
[normaali V2-ajo](https://github.com/eky-software/eky/actions/runs/36191056763)
ja [riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/36191065180)
läpäisivät ensimmäisellä yrityksellä. Valinnaiset inspector- ja Linux-probe-
valinnat olivat pois. V2:n 38 valittua jobia läpäisi ja yksi tarkoituksellinen
probe-job ohitettiin; hyväksyntä ei yhdistä eri ajojen osatuloksia.

Pääagentti varmisti revision, todelliset checkoutit, valitut jobit ja vaiheet,
neljän producerin artifact-sidonnat kaikkiin kymmeneen consumeriin sekä
consumerien ennen/jälkeen-tarkistukset ja terminal-tulokset alkuperäisistä
lokeista. Electron läpäisi 38/38 ilman flaky-tuloksia ja system-sarja 218/218,
mukaan lukien 19 backend-lukijan, 21 lifecycle- ja 12 backend-startup-sopimusta.
Myös rollbackin 18 prosessisopimusta ja neljä odotettua diagnostista tulosta
läpäisivät. Suurten MSI-arkistojen tavuja ei tarkistettu erikseen paikallisesti;
niiden näyttö perustuu CI:ssä suoritettuihin ennen/jälkeen-verifioijiin.

Tämä täyttää seuraavan T3b-P-vaiheen normaalin baseline-portin. Vanhojen
firstWindow-, legacy-smoke- ja rollback-hylkäysten tarkkaa syytä ei merkitä
ratkaistuksi. Tässä ajossa ei tullut uutta launch-virhettä, joten backend-
lokihavainnon todellinen virhetilanne ei aktivoitunut; sen virheketjun näyttö
on edelleen yllä kuvattu sopimussarja. T3c-W/L:n päätökset, varsinainen
omistajuusratkaisu, fixture-siirrot ja PR/main-integraatio ovat avoinna.

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

Toteutus on aloitettu yllä varmennetun vihreän baselinen jälkeen.
Paketointiapuri omistaa lähdesidonnan ja metatietosäännön; build-ketju
kutsuu sitä ja sisältöportti käyttää samaa read-only-tarkistusta.
Lähdemanifestit sidotaan ennen deployta ja niiden muuttumattomuus tarkistetaan
ennen normalisointia. Vain deployn tuottama backend-juuren manifesti vaaditaan
lukitun pnpm-polun kanoniseen kahden välilyönnin ja loppurivinvaihdon JSON-
muotoon: tiukka UTF-8-luku ja jäsennetyn sisällön tavutarkka roundtrip torjuvat
epäselvän tai uudelleenserialisoinnissa muuttuvan sisällön. Tätä muotovaatimusta
ei uloteta lähde- tai vendor-manifesteihin eikä virheellistä sisältöä korjata
hiljaisesti.

Rajattu regressiosarja läpäisi 200/200 ilman ohituksia. Siihen kuuluu 86
apurin tapausta, molempien sisältöporttien regressiot, hookin sopimukset,
paketoinnin järjestyksen rakenteellinen suoja sekä testikomennon kytkentä.
Koko normaali testisarja läpäisi 4 009 testillä ja kahdeksalla ennestään
olevalla ohituksella; työtilan tyypitystarkistus läpäisi. Riippumaton
katselmus ei löytänyt toteutusvirhettä. Katselmuksessa havaittu järjestyksen
testiaukko täydennettiin ja lisäys katselmoitiin erikseen.

Ensimmäinen tuore build paljasti lähdesidonnan liian tiukan
metatietovertailun: deployn sisäinen staging voi lisätä read-only-
lähdemanifestiin kovan linkin muuttamatta tiedoston identiteettiä tai tavuja.
Korjattu vertailu sitoo lähteen edelleen identiteettiin, kokoon, muokkausaikaan
ja tavuihin; yksittäisen bounded-luvun aikana myös linkkimetadatan pitää
pysyä vakaana. Mutaatiokohteiden yhden linkin vaatimus säilyy. Yhdeksän
lisäregressiota erottaa linkin lisäämisen/poiston sisällön muuttamisesta tai
lähdetiedoston korvaamisesta. Tämä ei salli lopullisen artifactin jakamista
hardlinkillä lähteen kanssa. Ensimmäinen hylkäys säilyy erillisenä näyttönä;
korjatun vertailun ja erillisen smoke-ajurin riippumaton katselmus ei
löytänyt korjattavaa.

Rakenteellinen järjestystesti ei todista pnpm-deployn ajonaikaista muotoa tai
paketoidun sovelluksen toimintaa. Korjatusta puhtaasta revisiosta rakennettu
eristetty Windows-paketti läpäisi sisältöportit ja Playwrightin sekä oman
patchin poissulun. Sama muuttumaton paketti läpäisi nykyisen kaksivaiheisen
synteettisen backup/restore/restart-smoken. Molempien vaiheiden strict-
supervisor-tulos vahvisti normaalin päättymisen ja tyhjän prosessipuun;
palautetun vaiheen lopputulos oli `shutdown/ok`. Lopullisen paketin kaikki
tiedostot olivat itsenäisiä ennen ajoa ja sen jälkeen. Testijuuri poistettiin
vasta molempien terminal-kuittien jälkeen.

Tämä täyttää T3b-P:n paikallisen build- ja smoke-näytön, ei uuden revision
CI-, PR/main-, julkaisu- tai koko T3-porttia. Uuden revision normaali CI
havaitsi alla kuvatun erillisen komentoharnessin sopimushylkäyksen.
Tiedostotarkistukset torjuvat testatut linkit ja muuttuneet
identiteetit, mutta eivät lupaa atomista suojaa saman käyttäjän samanaikaista
vihamielistä hakemistojen vaihtamista vastaan.
T3c-W:n ja T3c-L:n erillisiä alustakokeita ei hyväksytä tällä päätöksellä.

##### T3b-P:n CI-sopimushylkäys ja havaintokytkentä

Revision `f110cf94` [normaalin CI-ajon](https://github.com/eky-software/eky/actions/runs/36234825253)
ensimmäinen hylkäys tuli `workspace-success`-komentoryhmän toisen ajon
`profileChanged`-sopimuksesta. `removal`-vaiheen terminal-tulos ja pakollinen
caller-tulos puuttuivat. Edeltävät vaihetulokset olivat validoituja ja
prosessiensa päättymisen vahvistavia. Tarkoituksellinen profiilimuutos kuuluu
myöhempään `inventoryAfter`-vaiheeseen; tätä haaraa ei vielä saavutettu.
Saman revision [riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/36234830235)
läpäisi. Ensimmäistä hylkäystä ei korvata uusinta-ajolla tai paikallisella
läpäisyllä eikä puuttuvaa tulosta tulkita onnistumiseksi.
Kokonaisajo päättyi hylätyksi: 33 jobia onnistui, tämä sopimus ja sitä
seuraava koonti hylättiin, ja kolme jobia ohitettiin. Historiallisen paketin
tuottaja ja kuluttajat eivät siten antaneet tämän revision hyväksyntänäyttöä.

Puuttuvan terminal-tuloksen juurisyy ei selviä tästä näytöstä. Rajattu
havainto-aukko on kuitenkin varmistettu: olemassa oleva turvallinen
boundary-observer oli kytketty vain `removalHold`- ja request-preparation-
tapauksiin, ei epäonnistuneeseen tapaukseen. Korjaus kytkee saman observerin
kaikkiin tavallisiin suoriin komentotesteihin; tarkoituksella tukittu
lokituloste ja erillinen CI-komentotulkkiketju säilyvät ennallaan.

Projektio ottaa vaiheiden nimet omistavasta budjettisopimuksesta, mukaan
lukien `removal`, ja säilyttää vain viimeiset 20 suljetun rakenteen havaintoa.
Raakavirheitä, polkuja tai prosessitunnisteita ei lisätä raporttiin.
Observerin virhe ei muuta komennon tulosta, aikarajoja tai pakollisia
terminal- ja cleanup-todisteita. Rekisteröintikytkennän rakenteellinen testi
ja projektion regressio täydentävät todellista prosessisopimusta; pelkkä
callbackin lähdetekstin tarkistus ei todista havaintojen ajonaikaista saapumista.
Rajattu diagnostiikka- ja kytkentäsarja läpäisi 7/7, mukaan lukien aidon
supervisorin observer-virhe ja muuttumaton terminal-tulos. Koko workspace-
success-komentoryhmä ja workflow-sopimukset läpäisivät yhteisessä ajossa
43/43 ilman ohituksia. Riippumaton katselmus ei löytänyt korjattavaa.
Revision `a1df082c8c53d06c5d3a3c9d727d4ed2aaf1f877`
[normaali CI-ajo](https://github.com/eky-software/eky/actions/runs/36236577596)
läpäisi ensimmäisellä yrityksellä: 38 jobia onnistui ja yksi valinnainen
koe ohitettiin suunnitellusti. Saman revision
[riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/36236581813)
läpäisi. Kaikki 12 komentoryhmäajoa, myös aiemmin hylänneen ryhmän molemmat
toistot, läpäisivät. Electronin 38 testiä läpäisi ilman retry- tai flaky-
tuloksia ja system-sarja 218/218. Kaikkien 38 suoritetun jobin lokit,
todellinen checkout sekä neljän producerin ja kymmenen consumerin
artifact-sidonnat ja before/after-verifioinnit tarkistettiin erikseen.
Pakollisia tuloksia tai checkout-todisteita ei puuttunut. Suuria
asennusarkistoja ei ladattu uudelleen tätä lokivarmennusta varten.

Tämä hyväksyy korjatun revision normaalin CI-lähtötilan, ei alkuperäisen
keskeytymisen juurisyytä: virhe ei toistunut, joten uuden havaintokytkennän
virhepolun näyttö säilyy sopimustesteissä. Aiempi hylkäys pysyy omana
havaintonaan. T3c:n alustakokeiden erilliset päätökset, koko T3/R28 ja
PR/main-integraatio ovat edelleen avoinna.

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

Windows-päätös rajataan erilliseen neljän tapauksen kokeeseen,
ei koko T3-matriisin toteutukseen. **Omistaja hyväksyi toteutuksen ja kokeet
2026-09-26. Rajattu neljän tapauksen koe on läpäisty; lopullinen mekanismi
ja fixture-siirto eivät sisälly tähän hyväksyntänäyttöön.** Korjattu
CI-lähtötila ja T3b-E-patchin todennus on saatu yllä kirjatuista ajoista.

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

Root-first-tapausten odotusjärjestys erottaa pääprosessin poistumisen
koko puun ja tulostekanavien loppumisesta: ajuri todistaa ensin oikean
root-exitin ja ei-tyhjän Jobin, pyytää omistajalta tree-stopin ja odottaa
vasta sitten bridgen sulkeutumista. Elossa oleva kirjoittaja voi pitää
tulostekanavan avoimena, joten bridge-closea ei odoteta tree-stopin
edellytyksenä. Before-ready-haarassa launchin hylkäys otetaan heti
valvontaan ja sama järjestys toteutetaan launchin vielä ollessa kesken.

Bridgen erillinen suljettu drain-kuitti kertoo vain tulostevälityksen
valmistumisesta ja aiotusta paluuarvosta ennen exit-vaihetta. Se ei korvaa
prosessin exit-havaintoa, kontrollikanavan terminalia tai omistajan
siivoustodistetta. Hylätty Playwright-launch ei palauta julkista
prosessikahvaa; sen bridgen todellista exit-koodia ei väitetä havaituksi.
Tulosteen katkaisu, välitysvirhe tai puuttuva kuitti ei kelpaa onnistuneen
välityksen todisteeksi. Native-drainin ja cleanupin aikarajat säilyvät.

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

##### T3c-W:n rajatun kokeen checkpoint

**2026-09-26: normaali, before-ready, root-first ja bridge-exit läpäisivät
rajatun kokeen hyväksyntäehdot, yhteensä 4/4.** Kunkin tapauksen näyttö
luettiin takaisin ja sidottiin samoihin native-artifactin tavuihin.
Sisemmän omistajan kuitti vahvisti jäsenyyden ennen resumea, valmistuneen
luonnin, nolla aktiivista Job-jäsentä ja `processTreeAbsent`-siivouksen.
Ulompi omistaja päättyi normaalisti ilman hätäinterventiota, ja erillisen
sentinelin vaaditut elossaolo- ja sulkuhavainnot läpäisivät. Bridge-failuren
artifactia ei ollut hyväksytyissä tapauksissa.

Before-ready todensi rootin tarkoituksellisen exit 29:n ja elävän
jälkeläisen ennen stopia, odotetun launch-hylkäyksen sekä sukupolveen sidotun
drain-kuitin. Sen `bridgeExitCode` jää `null`-arvoksi: kuitti kertoo vain
aiotun exit-koodin. Muissa tapauksissa todellinen bridge-close oli vaadittu
0 tai tarkoituksellinen 41. Virhehaaran kokeen läpäisy ei muuta sen
työkuorman virhettä onnistumiseksi.

Ajurin lähteestä osoitettu root-first-odotusjärjestyksen virhe on korjattu:
root-exit ja ei-tyhjä Job todetaan ennen tree-stopia, bridge-close vasta sen
jälkeen. Korjaus on suojattu sopimustesteillä ja todennettu rajatussa
oikeaprosessikokeessa. Tämä ei yksilöi, mikä prosessi piti perittyä
tulostekahvaa auki aiemmassa hylkäyksessä. Ensimmäisen ennen launchia
tapahtuneen T3c-W-hylkäyksen tarkka syy jää avoimeksi. Myös aikaisempi
puutteellinen before-ready-välitysnäyttö ja vanhat satunnaiset timeoutit
pysyvät erillisinä havaintoina; niitä ei nimetä tämän kokeen korjaamiksi.

Native-sopimustestit, Node-kohdetestit ja komentokytkentäsarja läpäisivät.
Myös viimeisen 1 KiB:n drain-kuitin lukurajatarkennuksen sisältävät koko
työtilan normaalit testit läpäisivät. Typecheck läpäisi ennen tätä viimeistä
JavaScript-muutosta; TypeScript-lähteet eivät muuttuneet sen jälkeen.
Aiemmat tarkoitukselliset testiohitukset säilyivät erillisinä eivätkä ole
läpäisyjä. Paikallinen CI-sopimussarja läpäisi 156/156.
Tämän checkpointin T3c-CI-todennus on aloitettu; Linuxin erillisen kokeen
[ensimmäinen hylkäys](#t3c-ln-ensimmäisen-ci-kokeen-hylkäys) estää uuden
baselinen hyväksynnän. Tämä checkpoint ei ole PR/main-hyväksyntä. Raakatodisteet ja ajokohtaiset
tiedot pysyvät yksityisinä. Lopullinen mekanismivalinta, tavallisten
fixturejen siirto ja koko T3/R28:n hyväksyntä ovat edelleen erillisiä
avoimia portteja.

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

Tässä paikallisessa checkpointissa todellinen Linux-CI-probe ja seurattu
kokonaisajo olivat vielä tekemättä; niiden myöhempi näyttö on seuraavassa
CI-checkpointissa.
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
saatavuudesta. Seuraava vaihe on yksi ehdollinen synteettinen koe
kummassakin nykyisessä Linux-jobissa. **Omistaja hyväksyi toteutuksen ja
kokeet 2026-09-26. Toteutus ja oletuksena suljettu CI-kytkentä kokeiltiin
CI:ssä; molemmat kuluttajat hylättiin ennen GO:ta.**
Ensimmäinen näyttö ja sen rajat ovat [hylkäyskirjauksessa](#t3c-ln-ensimmäisen-ci-kokeen-hylkäys).
Korjatun lähtörevision CI-portti on läpäissyt yllä kuvatusti.

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

Kytkentä on uusi oletuksena `false` oleva manuaalinen
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

##### T3c-L:n ensimmäisen CI-kokeen hylkäys

**Checkpoint 2026-09-26:** revision
`f47268de1699696c6fc5cd81ce65766b087f9d85`
[ensimmäisen ajon 36245273190](https://github.com/eky-software/eky/actions/runs/36245273190)
molemmat Linux-koevaiheet hylättiin. Todelliset checkoutit, ensimmäinen
yritys ja käynnistysvalinnat tarkistettiin: namespace-koe päällä, vanha
prerequisite-probe ja installer-inspector pois päältä.

| Kuluttaja | Nykyinen testisarja ennen koetta | Uuden kokeen tulos |
| --- | --- | --- |
| `system-api` | 218/218 läpäisi. | `bootstrapUnknown`, työkuorma `notStarted`, cleanup `unverified`, näyttö `incomplete`. |
| `web-chromium` | 35/35 läpäisi. | Sama käynnistysvaiheen hylkäys ennen GO:ta. |

Molemmissa erillinen sentinel säilyi ja synteettinen testijuuri jätettiin
poistamatta. Tämä ei todista namespacen syntymistä, saatavuutta tai
purkua eikä varsinaisen sovelluksen virhettä. Hylkäystä ei luokitella
todennetuksi puuttuvaksi edellytykseksi. Ensimmäisen ajon suljettu raportti ei
erota wrapperin käynnistysvirhettä initin omaa READY-kuittausta edeltävästä
virheestä; tarkkaa syytä ei voi päätellä tästä aineistosta.

Ensimmäiset täydet job-lokit ja suljetut tulosrivit säilytettiin.
Kokonaisajo päättyi: 35 onnistunutta jobia, kolme hylkäystä ja yksi ennalta
valinnainen ohitus. Hylkäykset ovat kaksi Linux-koetta ja niiden vuoksi
`V2 acceptance` (`workflowNotSuccessful`). Muut testiryhmät, myös Electronin
38/38 ilman retryä tai flaky-tulosta sekä nykyiset packaged-, päivitys-,
legacy- ja palautumiskokeet, läpäisivät. Tämä ei hyväksy revisiota.
Kaikkien 38 suoritetun jobin lokit ja checkout-sidonnat säilytettiin; mitään
Linuxin tarkempaa raakadiagnostiikka-artifactia ei syntynyt. Saman revision
[riippuvuustarkistus 36245277549](https://github.com/eky-software/eky/actions/runs/36245277549)
läpäisi, ja sen lähde-/lokisidonta sekä pakolliset vaiheet varmennettiin.
Uusintakoetta tai fallbackia ei ole aloitettu. Ensin rajataan tarvittava
turvallinen lisähavainto; suojausasetuksia, oikeuksia, mekanismia, aikarajoja
tai hyväksyntäehtoja ei muuteta hylkäyksen vuoksi. Lopullinen alustamekanismi,
fixture-siirto ja T3/R28 jäävät erillisiin päätös- ja hyväksyntäportteihin.

##### T3c-LD: rajatun käynnistysdiagnostiikan päätösehdotus

Riippumaton lähdekatselmus vahvisti havaintoaukon, ei ensimmäisen
CI-hylkäyksen juurisyytä. Ehdotus koskee vain samaa Linux-koetta:
diagnostiikan täydennys, regressiot ja katselmuksen jälkeen yksi uusi
seurattu CI-koe molemmissa nykyisissä kuluttajissa. **Omistaja hyväksyi
T3c-LD:n 2026-09-26. Toteutus, kohdetestit ja riippumaton katselmus ovat
valmiit, ja yksi uusi seurattu CI-koe on päättynyt.** Ensimmäinen
kokonaisajo on seurattu loppuun eikä sen tulosta muuteta.

Paikallinen kohdesarja läpäisi 92/92 ja CI-sopimukset 194/194. Työtilan
normaalit testit ja typecheck läpäisivät; aiemmat ohitukset säilyvät erillisinä.
Katselmuksessa korjattu diagnostisen aikabudjetin vanhentuminen on suojattu
ensin hylätyllä, sitten läpäisseellä regressiolla. Se ei muuta luokitteluporttia.
Suljetun raportin lukuketjun puhtaat testit läpäisivät. Oikeaa Linux-koetta
ei korvata näillä testeillä eikä uutta revisiota vielä merkitä hyväksytyksi.

Init yrittää ennen GO:ta tapahtuvasta ensimmäisestä virheestä yhden
enintään 128 tavun ASCII-stderr-merkinnän:
`EKY_T3CL_INIT_FAILURE_V1 <phase> <cause>`. Suljettu vaihe kertoo yritetyn
tarkistuksen, ei sen onnistumista: `context`, `arguments`, `deadline`,
`pid`, `identity`, `statusRead`, `statusValidation`, `responseOpen`,
`controlSetup`, `readyWrite` tai `awaitGo`. Suljettu syy erottaa nykyiset
hylkäykset sekä statusluvun, sen rakenteen, PID-/identiteettivastaavuuden
ja capability-portin. Syy johdetaan samasta nykyisestä ehdosta; ei uutta
proc-lukua tai hyväksymissääntöä. Ei fd3-viestiä tai onnistumispolun
stderr-tulostetta. Kirjoitus on best effort, ilman retryä, synkronista
blokattavaa kirjoitusta tai uutta flush-odotusta. Puuttuva merkki ei todista,
ettei init käynnistynyt, eikä exit 42 yksin osoita initin suorittamista.

Ajurin suljettu lisähavainto säilyttää alkuperäisen syyluokan, wrapperin
päättymisluokan, stderr-luokan ja mahdollisen validoidun init-vaiheen/syyn.
Luokittelun käyttämästä hetkestä tallennetaan myös virtojen valmistumisen
booleanit, vastaustavujen `none | present`, spawnin `none | enoent | other`,
työkalun puuttumisen tarkistustila, READY-/GO-/hätäkatkaisutila sekä
READY-budjetin ja luokitteluyrityksen tila. Raaka stderr, proc-sisältö,
polut, prosessi-/käyttäjätunnisteet, ympäristöarvot ja poikkeukset jäävät
pois julkaistavasta tuloksesta. Nykyiset 4 KiB:n stderr- ja tulosrajat säilyvät.

Kokeen suljetun JSON-tuloksen schema on 2; uusi `bootstrapDiagnostic` on
validoitu suljettu olio tai `null`, jos havaintoa ei ole. Ensimmäisen ajon
schema 1 -tulokset säilyvät alkuperäisinä eivätkä saa jälkikäteen uusia
havaintoja. Sovelluksen versiota tai tuotannon formaatteja ei muuteta.

Lisähavainto ei muuta alkuperäistä luokittelua: init-merkkiä ei poisteta
stderristä onnistumis- tai denial-vertailua varten. Unknown, post-GO-virhe,
puuttuva cleanup ja puutteellinen näyttö hylkäävät edelleen. Puhtaat testit
kattavat ensimmäisen syyn säilymisen, kaikki porttihylkäykset, väärän ja
ylisuuren merkinnän, puuttuvan kirjoituscallbackin sekä nykyiset deadline-,
READY-tail-, EOF-, sentinel- ja cleanup-ehdot. Riippumaton katselmus ja
nykyisten testikomentojen portit tarvitaan ennen koetta.

Tiedostoraja säilyy Linux-kokeen initissä, ajurissa, omistavassa suljetussa
sopimuksessa ja niiden testeissä sekä koetuloksen lukuketjussa ja ohjeissa.
Ei uutta riippuvuutta, oikeutta, palvelua, mekanismia, workflowta tai jobia;
ei aikarajojen, sovelluksen, nykyisten fixturejen tai CI-ehtojen muutosta.
Uusi havainto ratkaisee vasta seuraavan korjauksen tai alustapäätöksen,
ei etukäteen hyväksy fallbackia tai koko T3/R28:aa.

##### T3c-LD:n rajatun CI-kokeen havainto

**Lopputila 2026-09-26:** revisio
`9c92ca53c296f457168ee2bff934160884738501`,
[ajo 36249412552](https://github.com/eky-software/eky/actions/runs/36249412552),
yritys 1. Molemmat nykyiset Linux-testisarjat läpäisivät ensin: system-api
218/218 ja web-chromium 35/35. Niiden erilliset namespace-kokeet hylättiin.
Kokonaisajo päättyi hylätyksi: 35 onnistunutta jobia, kolme hylkäystä ja
yksi ennalta valinnainen ohitus. Hylkäykset ovat kaksi Linux-koetta ja niiden
vuoksi `V2 acceptance` (`workflowNotSuccessful`). Kaikki Windows-testiryhmät,
myös Electron 38/38 ilman retryä tai flaky-tulosta sekä packaged-, päivitys-,
legacy- ja palautumiskokeet, läpäisivät. Tämä ei ole revision hyväksyntä.

Molempien suljettu lisähavainto oli sama: alkuperäinen `unexpectedEof`,
wrapper `exit1`, stderr `other`, virrat päättyneet, vastaustavuja ei ollut,
READYä ei hyväksytty eikä GO:ta yritetty. Ei hätäkatkaisua tai READY-budjetin
ylitystä; luokittelua yritettiin. Initin diagnostiikkamerkki oli `absent`.
Näyttö ei erottele tuntematonta `unshare`-virhettä mahdollisesta Node-
bootstrap-virheestä; merkin puuttuminen ei todista initin jääneen käynnistymättä.
Samat luokat eivät myöskään todista samaa raakavirhettä tai juurisyytä.

Tulos säilyy `bootstrapUnknown` / `notStarted` / `unverified` / `incomplete`.
Sentinel säilyi ja juuret jätettiin poistamatta. Raw-lokien tiivisteet,
checkout-kuitit, schema 2 ja täsmälliset ajo-/kuluttaja-/input-sidonnat
varmennettiin erikseen. Rajattu diagnostiikka toimii, mutta mekanismin
toimivuutta, puuttuvaa edellytystä tai aiempaa virhettä ei merkitä ratkaistuksi.
Raaka stderr ei kuulu tulokseen eikä erillistä Linux-raakadiagnostiikkaa
ole tallennettu artifactiin; sitä ei voi täydentää tähän ajoon jälkikäteen.

Kaikkien 38 suoritetun jobin lokitiivisteet ja checkout-kuitit varmennettiin
riippumattomasti. Normaali hyväksyntälukija hylkäsi ajon odotetusti; sitä ei
muutettu hyväksymään epäonnistunutta kokonaisuutta. Saman revision
[riippuvuustarkistus 36249417179](https://github.com/eky-software/eky/actions/runs/36249417179)
läpäisi ja sen lähde-/lokisidonnat sekä pakolliset vaiheet varmennettiin.
Seuraava havainto rajataan alla erikseen hyväksyttyyn T3c-LS:ään;
ei automaattista uusintaa, suojausmuutosta tai fallbackia.
PR/main-integraatiota ei ole tehty.

##### T3c-LS: suljetun stderr-luokan tarkennuksen päätösehdotus

**Omistaja hyväksyi T3c-LS:n 2026-09-26. Toteutus, kohdetestit ja
riippumaton lähde- ja lukuketjukatselmus ovat valmiit.
Yksi uusi seurattu CI-kierros on päättynyt. Molempien Linux-kokeiden
tarkempi virheluokka on varmennettu; kokonaisajo pysyy hylättynä.**
Rajattu lähdekatselmus ei löytänyt
konkreettista virhettä, joka selittäisi CI-hylkäyksen. Seuraava ehdotus
tarkentaa vain kokeen nykyisen `stderrClass`-kentän tuntematonta luokkaa:
12 kiinteän kokonaisen stderr-viestin vertailutaulukko. Ei uutta Node-
virhepinojen jäsennintä, havaintoprosessia, raakaviestien julkaisua tai
käynnistysmekanismin muutosta.

Alla olevat viisi viestiosaa muodostavat kukin kaksi kokonaista literalia
muodossa `unshare: <viestiosa>: <errno-teksti>\n`. Errno-teksti on täsmälleen
`Operation not permitted` tai `Permission denied`. Toteutuksessa verrataan
valmiisiin kokonaisiin merkkijonoihin, ei poimita käyttäjäarvoja viestistä.

| Kiinteä viestiosa | Diagnostinen luokka |
| --- | --- |
| `mount /proc failed` | `unshareMountProcDenied` |
| `cannot change root filesystem propagation` | `unsharePropagationDenied` |
| `write failed /proc/self/uid_map` | `unshareUidMapDenied` |
| `write failed /proc/self/gid_map` | `unshareGidMapDenied` |
| `write failed /proc/self/setgroups` | `unshareSetgroupsDenied` |

Lisäksi täsmälleen `unshare: unshare failed: Permission denied\n` tuottaa
diagnostisen luokan `unshareCreatePermissionDenied`. Se **ei** laajenna
nykyistä `namespaceDenied`-hyväksyntäluokittelua. Kahdestoista literal on
`unshare: unrecognized option '--map-current-user'\nTry 'unshare --help' for more information.\n`,
jonka luokka on `unshareMapCurrentUserUnsupported`. Viimeinen rivinvaihto
vaaditaan. Viestimuodot perustuvat [util-linuxin lähteeseen](https://github.com/util-linux/util-linux/blob/v2.39.3/sys-utils/unshare.c),
[C-localen errno-teksteihin](https://github.com/bminor/glibc/blob/glibc-2.39/sysdeps/gnu/errlist.h),
[getoptin ilmoitukseen](https://github.com/bminor/glibc/blob/glibc-2.39/posix/getopt.c#L287-L302)
ja [help-kehotteeseen](https://github.com/util-linux/util-linux/blob/v2.39.3/include/c.h#L276-L280).
Nämä lähteet eivät osoita, mikä viesti CI:ssä todella syntyi.

Tarkennus tehdään vain nykyisestä ennen READYä ja GO:ta kerätystä puskurista,
kun wrapper ja stderr ovat jo päättyneet, luku on virheetön eikä nykyinen
4 KiB:n raja ylity. Ei lisäodotusta, trimmausta, osamerkkijonohakua tai
häntätavujen poistoa. Duplikaatti, katkaisu, lisätavu, muu errno, Node-virhe
tai tuntematon viesti jää `other`-luokkaan; lukematon tai ylisuuri sisältö
säilyy nykyisessä virheluokassaan. Alkuperäiset neljä stderr-luokkaa säilyvät.
Enum-sopimuksen laajennus versioidaan schema 3:ksi ja lukuketju päivitetään;
historiallisia schema 1/2 -tuloksia ei muuteta tai täydennetä jälkikäteen.

Puhtaat regressiot kattavat 12 osumaa ja niiden muunnelmien hylkäykset,
kesken olevan tai epäonnistuneen virran, tuntemattoman sisällön, kokorajan,
tuloksen suljetun validoinnin ja todellisen ajurikytkennän. Uusi diagnostinen
osuma ei saa muuttaa alkuperäistä hylkäystä, GO:ta, cleanupia tai juuren
säilyttämistä. Muutos rajoittuu kokeen diagnostiikkaan, sopimukseen, tarvittavaan
ajurikytkentään, testeihin, lukuketjuun ja ohjeisiin. Riippumaton katselmus ja
nykyiset portit vaaditaan ennen enintään yhtä uutta seurattua CI-kierrosta
molemmissa nykyisissä kuluttajissa. Ei muutosta tuotantoon, oikeuksiin,
riippuvuuksiin, komentoon, aikarajoihin, workflowhin tai hyväksyntäehtoihin.

Osuma rajaisi seuraavaa korjaus- tai alustapäätöstä, ei hyväksyisi sitä.
`other` voi edelleen jäädä tulokseksi: taulukko ei kata kaikkia käynnistys-,
exec-, Node- tai käyttöjärjestelmävirheitä. Silloin pysähdytään uuden päätöksen
valmisteluun; tästä ei synny automaattista uusinta- tai fallback-lupaa.

Kohdetestit läpäisivät 97/97, CI-sopimukset 199/199 sekä työtilan normaalit
testit ja typecheck. Uudet osumat, schema ja ajurikytkentä hylättiin ensin
vanhalla toteutuksella ja läpäisivät tarkennuksen jälkeen. Lukuketjun
puhtaat testit läpäisivät; schema 1/2 pysyvät erillisinä historiallisina
aineistoina. Tämä ei vielä ole oikean Linux-kokeen tai koko T3:n hyväksyntä.

##### T3c-LS:n rajatun CI-kokeen havainto

Revision `93ba537b26a95cc571d06fd5ed34429ebff7d439`
[V2-ajo 36255124661](https://github.com/eky-software/eky/actions/runs/36255124661)
käynnistettiin kerran, yrityksenä 1. Kummankin Linux-kuluttajan todellinen
checkout, käynnistysvalinnat, lokin tiiviste ja schema 3:n kanoninen tulos
tarkistettiin alkuperäisistä job-lokeista. Namespace-koe oli päällä;
vanha prerequisite-probe ja installer-inspector olivat pois päältä.

| Kuluttaja | Tavallinen testisarja | Rajatun kokeen havainto |
| --- | --- | --- |
| `system-api` | 218/218, ei retryä tai flaky-tulosta. | `unshareUidMapDenied` ennen READYä ja GO:ta. |
| `web-chromium` | 35/35, ei retryä tai flaky-tulosta. | Sama suljettu virheluokka. |

Molemmissa wrapper päättyi exit 1:een, stderr päättyi virheettä ja
vastauskanava päättyi ilman tavuja. READY-budjetti ei ylittynyt eikä
hätäkatkaisua käytetty. Init-merkkiä ei ollut. Alkuperäinen tulos säilyi
`bootstrapUnknown`-hylkäyksenä: työkuorma `notStarted`, cleanup `unverified`,
näyttö `incomplete`, sentinel `preserved` ja testijuuri `retained`.

Uusi luokka osoittaa täsmällisen, kokonaisesta viestistä tunnistetun
`/proc/self/uid_map`-kirjoituseston. Se yhdistää kaksi errno-tekstiä eikä
erota niitä toisistaan. Se ei yksilöi taustalla olevaa oikeus- tai
turvallisuuspolitiikkaa, todista omistajuutta/purkua tai selitä aiempien
revisioiden tuntematonta stderr-sisältöä jälkikäteen. `namespaceDenied`-
hyväksyntäluokkaa ei laajennettu eikä hylkäystä muutettu ohitukseksi.

Saman revision [riippuvuustarkistus 36255141048](https://github.com/eky-software/eky/actions/runs/36255141048)
läpäisi; lähde-/lokisidonta, pakolliset auditoinnit ja 160
rekisteriallekirjoituksen tarkistus varmennettiin. V2-kokonaisajo päättyi:
35 onnistunutta jobia, kolme hylkäystä ja yksi ennalta valinnainen ohitus.
Hylkäykset ovat kaksi Linux-koetta ja `V2 acceptance`
(`workflowNotSuccessful`). Muut ryhmät läpäisivät, myös Electron 38/38
ilman retryä tai flaky-tulosta sekä nykyiset packaged-, päivitys-, legacy-
ja palautumiskokeet.

Kaikkien 38 suoritetun V2-jobin ja riippuvuustarkistuksen alkuperäiset lokit,
tiivisteet, checkoutit ja ajosidonnat varmennettiin myös pääagentin erillisellä
takaisinluvulla. Hylkäyskirjaus on nimenomaisesti `accepted: false`;
muuttumaton normaalin baselinen tarkistin hylkäsi ajon odotetusti.
Tämä päättää LS:n rajatun diagnostiikkakierroksen, ei hyväksy revisiota,
namespace-omistajuutta, T3/R28:aa tai PR/main-integraatiota. Uusinta-ajoa
ei aloitettu eikä aikaisempia tuloksia muutettu.

Seuraava työ on rajattu alusta- ja oikeussopimuksen päätösvalmistelu,
ei uusi diagnostinen uusinta-ajo. Nykyinen identiteettisopimus tarvitsee
tunnistemäppäyksen säilyttääkseen muuttumattomat ei-nollaiset UID/GID-arvot.
Mäppäyksen poistaminen ei poista proc-mountin erillistä oikeusvaatimusta;
pelkkää `--map-current-user`-valinnan poistamista ei tulkita korjaukseksi.
Mahdollinen ympäristö- tai oikeusmuutos, uusi mekanismi, koe ja fixture-siirto
tarvitsevat omat päätöksensä. Nykyinen sovellus, testiaikarajat, CI-vaatimukset
ja hostin suojausasetukset säilyvät.

##### T3c-LS:n jälkeinen alusta- ja oikeuspäätös

**Päätösvalmistelu, ei toteutus- tai uusinta-ajolupa.** Riippumaton
lähdekatselmus ei löytänyt nykyisestä komennosta todistettua korjattavaa
argumenttivirhettä. [Linuxin tunnistemäppäyksen sopimus](https://man7.org/linux/man-pages/man7/user_namespaces.7.html)
edellyttää kelvollista mäppäystä; sen poistaminen ei säilytä nykyistä
identiteettisopimusta eikä poista proc-mountin oikeusvaatimusta.

[Ubuntun julkaisutiedot](https://discourse.ubuntu.com/t/ubuntu-24-04-lts-noble-numbat-release-notes/39890)
kuvaavat oletusprofiilin, joka sallii user-namespacen luonnin mutta rajoittaa
myöhempää capability-käyttöä. Tämä on havaintoon sopiva **hypoteesi**, ei
kyseisen CI-ajon aktiivisen politiikan tai virheen juurisyyn todiste.

Yleistä lupaa `unshare`- tai Node-ohjelmalle ei ehdoteta koekohtaisena
poikkeuksena. [AppArmorin profiilirajaus](https://www.apparmor.net/man/4.0/apparmor.d/)
ei yksin sido yleiskäyttöisen ohjelman käynnistystä hyväksyttyihin
koeargumentteihin. Erillinen polku, sama UID tai väliaikainen profiilinimi
eivät yksin muodosta tällaista valtuusrajaa. Luotetun käynnistyspisteen ja
suljettujen profiilisiirtymien rakentaminen olisi uusi turvallisuusratkaisu,
ei LS:n diagnostiikkakorjaus.

Suositeltu valmistelusuunta on hallittu, kertakäyttöinen Linux-testisessio:

- Nimeä todellinen palvelunhallinta, CI-ympäristö ja reaper-vastuu ennen
  toteutuspäätöstä. Nykyinen aineisto ei todista valmiin delegoinnin saatavuutta.
- Rajaa luonti-/stop-/wait-valtuus session luotetulle omistajalle. Työkuorma
  ei saa yleistä hallintaoikeutta tai oikeutta poistua omistetusta ryhmästä.
  [Systemd-delegointi](https://systemd.io/CGROUP_DELEGATION/) on arvioitava
  vaihtoehto, ei tässä hyväksytty mekanismi tai oletus sen saatavuudesta.
- Vaatimukset ovat jäsenyys ennen ensimmäistä työkuorman suoritusta,
  ulkopuolinen sentinel, ajurin/omistajan katoamisen käsittely ja erillinen
  reaping-todiste. [Cgroup v2:n](https://docs.kernel.org/admin-guide/cgroup-v2.html)
  `cgroup.kill` tai `populated=0` ei yksin todista kaikkea tätä.
- Suojaa puhtailla sopimuksilla ja rajatuilla oikeaprosessikokeilla
  root-first, myöhäinen fork, TERM-vastustus, poistumisyritys ja owner-loss.
  Myös nykyinen Chromium-polku jälkeläisineen ja sandbox-vaatimuksineen
  tarvitsee todellisen näytön ennen tavallisten fixturejen siirtoa.

Tässä päätösvalmistelussa omistajalta pyydettiin reunaehto: saako erillisen CI-session
hallintaan ehdottaa rajattuja uusia valtuuksia vai vaaditaanko ratkaisu
kokonaan ilman niitä. Kumpikaan vastaus ei vielä hyväksy toteutusta,
palvelun/profiilin asentamista, uutta riippuvuutta, suojausten poistamista,
runner-vaihtoa tai uutta CI-koetta. Lopulliset Windows-/Linux-mekanismit ja
T3-matriisi säilyvät omissa hyväksyntäporteissaan.

##### T3c-LM:n Chromium-yhteensopivuus

2026-09-27: rajattu koe läpäisty hyväksytyn LM-rajauksen sisällä. Lähtörevisio
`e3f647b2de9586868d678ae8c864a492f076630a` läpäisi normaalin V2-ajon
`36270550708` ja riippuvuustarkistuksen `36270558922`, molemmat yrityksellä 1.
Kaikki neljä kokeellista valitsinta olivat pois päältä. V2:n 38 ryhmää
onnistui ja yksi valinnainen kokeilu ohitettiin tarkoituksella. Tavalliset
system 218/218, web 35/35 ja Electron 38/38 läpäisivät ilman uusintoja.
Checkoutit, lokit ja producer/consumer-artifact-sidonnat takaisinluettiin.
Aiemmat LS-hylkäykset ja LM-ajon erillinen kytkentätestihylkäys säilyvät.

Tämä checkpoint käyttää samaa session omistajaa, kontrollikanavaa,
GO-porttia, nonroot-initia, määräaikoja ja sentineliä. Suljettu `actor` /
`chromium`-valinta sitoo vain yhden kiinteän sisäisen workerin käynnistykseen;
kutsuja ei anna komentoa, ympäristöä tai mielivaltaisia argumentteja.
Vanhat actor- ja LS-tulokset eivät saa uutta merkitystä.

Chromium-worker tekee yhden synteettisen loopback-Page-toiminnon ja yhden
API-tarkistuksen. Se käyttää lukittua Playwrightia ja nykyisen web-polun
oletuksia: ei uutta executable-, channel- tai sandbox-overridea. Nykyinen
web-polku ei ota Chromiumin sandboxia erikseen käyttöön; koe ei todista
sandboxillista Chromiumia. Electronin oma sandbox-vaatimus säilyy erillisenä.
Selain-Page ja API-oliot pysyvät workerin sisällä; uutta etäohjausprotokollaa
tai yleistä testirunneria ei rakenneta.

Import, käynnistys, tarkistukset, sulkeminen, omien scratch-hakemistojen
tarkistus ja aiempi root/leaf-handoff mahtuvat samaan alkuperäisestä
aloituksesta laskettuun 8 sekunnin työkuormarajaan. Playwrightin asennettua
cachea ei vaihdeta, mutta kaikki kirjoitettavat profiili-, temp- ja HOME/XDG-
polut rajataan alkuperäisen testijuuren alle. Browser API:n sulkeminen ei
yksin todista koko puun poistumista. Scratch-jäämä estää handoffin;
ulompi ajuri poistaa edelleen vain tyhjän alkuperäisen juuren.

Ensimmäinen worker-virhe kirjoittaa vain yhden enintään 256 tavun
kanonisen phase/reason-tiedoston private-juureen. Lukija tarkistaa rootin,
tiedostotyypin, oikeudet, linkit, generationin ja tavurajan. Puuttuva,
virheellinen ja lukematta jäänyt havainto erotetaan. Raakaa virhettä,
stackia, polkua tai selaimen tulostetta ei julkaista. Kokeen Chromium-
tulos saa oman suljetun evidence-arvonsa; vanhat actor-tavut säilyvät.

Ennen yhtä seurattua CI-koetta vaaditaan valinnan ja oikean käynnistyksen
sidonta, workerin injektoidut onnistumis-/virhe-/määräaikatestit, koko
kirjoitus/lukuketju sekä vanhojen actor-, init-, sentinel- ja T1/T2-sopimusten
regressiot ja riippumaton katselmus. Nykyisen manuaalisen LM-valinnan
web-kuluttaja käyttää Chromiumia jo asennetulla selaimella; system pysyy
actor-kokeena. Uutta CI-kadenssia, riippuvuutta tai host-asetusta ei lisätä.

Tämä todistaa vasta kiinteän browser-työkuorman yhteensopivuutta. Elävän
selaimen pakotettu teardown, owner-loss, oikeat fixturet ja koko T3:n
valmistumisportti ovat edelleen avoinna. Tuotanto-, business-, backup-,
Activity-, Diagnostics- ja tukipakettisopimukset eivät muutu: kokeen rajattu
diagnostiikka kuuluu vain testin tulosketjuun.

Paikallisen tarkistuksen checkpoint: workerin ja failure-tiedoston 66/66
injektoitua testiä, kanoninen E2E-sopimussarja 460/460, CI-sopimukset 315/315
ja koko projektin tyypitys läpäisivät. Workspace-sarja läpäisi 4 410 testiä;
kahdeksan aiempaa ohitusta säilyi. Launch-/init-/result-/outer-kytkennän
ristiinkatselmuksessa ei löytynyt korjattavaa. Paikalliset sopimustestit
eivät yksin ole oikean Chromiumin yhteensopivuusnäyttö.

Revision `c09e88668154f1712d53f39691212dd451564bb5` V2-ajo `36273631324`
ja riippuvuustarkistus `36273645184` läpäisivät ensimmäisellä yrityksellä.
V2:ssa oli 38 onnistunutta ryhmää ja yksi tarkoituksellinen ohitus. Vain
`linux_managed_namespace_experiment` oli päällä; muut kolme kokeellista
valitsinta olivat pois. Vanha PID-namespace-koe ei käynnistynyt.

System-kuluttajan rajattu actor-koe ja web-kuluttajan Chromium-koe
takaisinluettiin omista tavusidotuista lokeistaan ja suljetuista tuloksistaan:
molemmat `complete`, namespace `destroyed`, alkuperäinen juuri `removed`
ja sentinel säilynyt sekä sulkeutunut normaalisti. Chromiumin failure-havainto
oli `absent`, ei lukematta jäänyt tai virheellinen. Saman ajon tavalliset
system 218/218, web 35/35 ja Electron 38/38 läpäisivät ilman retryä tai
flaky-tulosta. Kaikkien 38 suoritetun ryhmän checkoutit ja lokisidonnat sekä
neljän tuottajan ja kymmenen kuluttajan artifact-sidonnat tarkistettiin.
Riippuvuusauditit ja registry-allekirjoitusten tarkistus läpäisivät.

Tämä on uusi vihreä lähderevision lähtötila, ei PR/main- tai koko T3-hyväksyntä.
Normaalit E2E-fixturet käyttivät edelleen vanhaa elinkaaripolkua; erillinen
Chromium-koe ei siirtänyt niitä. Aiemmat LS- ja timeout-havainnot säilyvät.

##### T3:n oikeiden kuluttajien siirtoraja

**2026-09-27: lähdeinventaarioon perustuva seuraavan toteutuspalan valmistelu,
ei vielä kuluttajasiirron hyväksyntänäyttö.** Nykyinen lähtötila on alla
varmennettu käynnistyshavainnon `83a94fad`; edeltävä `c09e8866` säilyy
rajatun Chromium-kokeen näyttönä. Uutta testialustaa, sovellusarkkitehtuuria tai riippuvuutta ei
perusteta. Moduulitestin kolme nykyistä `isolated*Test`-fixtureä säilyvät;
alustasopimus kuuluu niiden sisäiselle elinkaaren omistajalle.

Siirtojärjestys ja nykyisen lähteen kattavuus:

1. **Backend:** `startE2eBackendProcess` ja sen startup-/stop-polku ensin.
   Mukaan kuuluvat `isolatedBackendTest`, web-fixturen backend, restart,
   recovery, backup import/replacement, session boundaryn toinen backend,
   bootstrap, testikoostaminen ja endurance. `createElectronWorkspaceBackupFixture`
   käyttää samaa käynnistyspolkua, joten sen yhteensopivuus on todistettava
   samalla ennen muutoksen kutsumista pelkäksi system-testimuutokseksi.
2. **Web-palvelin ja selain:** `startE2eWebProcess` käyttää samaa palvelun
   omistajuussopimusta. Nykyinen `isolatedWebTest` saa Playwrightilta jo
   luodut `context`- ja `page`-oliot; pelkkä backendin/Viten siirto ei siis
   omista Chromiumia. Todellinen selainliitos ja sen elinkaari ratkaistaan
   erikseen nykyisten Page/API-olioiden ja loopback-estojen säilyessä.
   Ei itse rakennettua Page-välityspalvelua tai testin siirtämistä koeworkeriin.
3. **Electron:** `launchElectronRuntime` ja `stopOwnedElectronRuntime` sekä
   restart/relaunch, launch-/first-window-virheet ja handoff. Inventaario
   sisältää myös `isolatedElectronTest`-fixturen suoran toisen instanssin
   käynnistyksen sekä `desktopCapabilities.spec.ts`:n suoran bootstrap-ajon.
   Näitä ei jätetä vanhaan root-only-cleanupiin uuden pääpolun rinnalle.

Ennen ensimmäistä backend-siirtoa täsmennetään seuraavat sopimukset:

- **Elävä omistaja:** kokeen `runManagedSession` palaa vasta sulkemisen
  jälkeen. Sen tulos ei ole käynnissä olevan palvelun kahva. Fixture tarvitsee
  koko käyttöajan säilyvän omistajuuden, erillisen työkuorman exit-havainnon,
  idempotentin stopin ja varmennetun terminal-tuloksen. Stop-komennon kuittaus
  tai manageriprosessin poistuminen ei yksin hyväksy cleanupia.
- **Oikea prosessi:** nykyiset restart-/backup-/virhetestit lukevat
  `managedProcess.child`:n PID:n ja exit-tilan; endurance mittaa työkuorman
  muistia. Managerin, bridgen tai namespace-initin PID ei saa korvata
  backendin identiteettiä. Linuxin namespace-PID:tä ei käytetä hostin
  `/proc`-mittauksen PID:nä. Mittauksen omistajuus ja käynnistysidentiteetti
  ratkaistaan ennen rajapintamuutosta, ei tekaistulla ChildProcess-oliolla.
- **Ajat ja virheet:** säilytä nykyiset backendin 45 s ja Viten 15 s
  käynnistysrajat, Electronin vaihebudjetit sekä testikohtaiset kokonaisrajat.
  Kokeen 8/20 sekunnin vakioita ei kopioida tuotantotestien elinkaareksi.
  Omistajan alkuperäinen määräaika ei ala uudelleen adapteriin siirryttäessä.
  Ensimmäinen virhe, cleanup ja havainnon epävarmuus raportoidaan erillisinä.
- **Juuret ja restart:** kontrollijuurta ei sekoiteta fixtureen, jonka
  synteettinen tietokanta säilytetään restartissa. Varmistamaton puun poisto
  estää restartin ja datajuuren poiston. Tyhjän kokeellisen kontrollijuuren
  poistoehto ei oikeuta täyden fixturejuuren rekursiivista poistoa.
- **Ympäristöraja hyväksytty 28.9.:** LM on hyväksytty vain CI:hin.
  Paikalliset Windows-testit ja Linux-CI riittävät
  [Chromiumin ja ympäristön päätöksen](#chromiumin-kuluttajasiirron-avoin-omistajuusraja)
  mukaisesti. Hostin oikeuksia ei muuteta. Korvattu paikallispolku poistetaan
  vasta vastaavan kattavuuden jälkeen, ei ennen kuluttajasiirron näyttöä.

Jokainen siirtopala sisältää käynnistysvirheen, root-firstin, owner-lossin,
toistetun stopin ja epävarman cleanupin regressiot soveltuvalla tasolla.
Vasta saman revision vastaavan kattavuuden jälkeen poistetaan korvattu
aktiivinen toteutus ja sen kutsureunat. Kokeelliset työkuormat eivät jää
tavallisen fixturen toiseksi ohjauspoluksi. T1/T2-kytkentä, puhdas valmistelu,
ensimmäisen virheen säilytys ja [lopullinen T3-portti](#t3n-lopullinen-hyväksyntänäyttö)
säilyvät. Valmistelu ei muuta sovelluskoodia tai testien aikarajoja.

###### Backendin käynnistyshavainnon valmistelupala

**2026-09-27: toteutettu; regressiot ja täsmällisen revision CI-portti läpäisty.**
`waitForE2eBackendStartup` ja terveysodotus irrotetaan suorasta
`ChildProcess`-luvusta. Ne saavat pienen `readState`/`subscribe`-havainnon,
jonka nykyinen adapteri kytkee synkronisesti juuri käynnistettyyn työkuormaan.
Kytkentä kuuluu vain backendin käynnistäjälle; yhteinen `startManagedProcess`
ei muuta Viten tai muiden siirtämättömien kuluttajien virhehavaintoa.
Tila erottaa todetun spawnin, exitin, spawn-virheen ja havaintovirheen.
Ensimmäinen terminal-havainto säilyy; managerin PID:tä tai stdoutia ei
käytetä todisteena. Rekisteröinnin jälkeinen synkroninen tilaluku kattaa
myös ennen tilaajaa saapuneet tapahtumat. Onnistuminen tarkistetaan vielä
odotuksen lopetuksen jälkeen, ilman uutta aikarajaa.

`E2E_BACKEND_WORKLOAD_OBSERVATION_LOST` säilyy turvallisessa vaihehavainnossa
ja fixture-virheen mukana. `exitedBeforeCleanup=false` tarkoittaa, ettei
exit ole vahvistettu kyseisessä startup-havainnossa, ei todistetta elävästä
prosessista. Cleanupissa syntyvä exit ei muuta aiempaa virhenäyttöä.
Kuluttajan tilaus päättyy startupin jälkeen, mutta adapterin native-virheiden
kuuntelu vasta todellisen lapsen `close`-tapahtumassa. Tämän puuttuminen ei
ole cleanup-todiste. Tapahtuma on vain testiruntimen havainto, eikä kuulu
sovelluksen Diagnosticsiin, Activityyn tai tukipakettiin.

Tämä pala ei siirrä stop-omistajuutta, PID-/RSS-kuluttajia, Vite-readinessia,
Chromiumia tai Electronia uuteen alustamekanismiin. Niiden vanhoja polkuja
ei poisteta tämän osatodisteen perusteella. Hyväksyntään tarvitaan
startup-/close-/error-järjestysten sopimustestit, todellisen suoran lapsen
onnistumis- ja spawn-virhekytkentä, system-kuluttajat ja tyypitys sekä
backendia käyttävän web-/Electron-fixturen regressiot.

Toteutuksen katselmuksessa ei jäänyt korjattavia havaintoja. Kohdesarja
117/117, E2E-sopimukset 460/460, CI-kytkentäsopimukset 315/315 sekä koko
työtilan testit ja tyypitys läpäisivät. Normaali täysi E2E-ajo läpäisi
331/331: system 245, web 41 ja Electron 45, ilman retryä tai flaky-tulosta.
Yhteisen käynnistäjän siirtämättömien kuluttajien virhehavainto säilyi.

Ensimmäinen täysi ajo hylkäsi `DESK-RUNTIME-001`:n vanhentuneen tarkan
renderer-API-odotuksen. Jo hyväksytty W5B.2:n
`replaceActiveWorkspaceFromBackup` puuttui listasta, ja import-/inspect-nimien
järjestys poikkesi lajitellusta tuloksesta. Odotus korjattiin nykyiseen
hyväksyttyyn sopimukseen; tarkka yhtäsuuruus, tuotannon capability-raja ja
CI-valinta säilyivät. Alkuperäinen hylkäys säilytettiin, eikä sitä nimetä
startup-timeoutin tai prosessipuun omistajuuden viaksi.

Lähde `83a94fad77f48e8e48d7a50d4cb721d1a388e193` läpäisi normaalin V2-ajon
`36278433807` ja riippuvuustarkistuksen `36278443919`, kumpikin yrityksellä 1.
Kaikki neljä kokeellista valitsinta olivat pois. V2:ssa oli 38 onnistunutta
ryhmää ja yksi tarkoituksellinen valinnaisen kokeen ohitus; system 245/245,
web 35/35 ja kriittinen Electron 38/38 ilman retryä tai flaky-tulosta.
Kaikkien 38 suoritetun ryhmän lähdesidonta sekä neljän tuottajan ja kymmenen
kuluttajan artifact-todistusketju tarkistettiin. Molemmat vanhan version
päivityskuluttajat ja palautuksen virhepolut läpäisivät. Tämä ei osoita
aiempien satunnaisten timeoutien juurisyytä eikä uutta Linux-omistajuusnäyttöä.

Tämä valmistelupala ei sulje T3:a: stop-omistajuuden ja oikeiden kuluttajien siirto, korvattujen
polkujen poisto, koko hyväksyntämatriisi ja PR/main-portit ovat avoinna.

###### Backendin Windows-omistajan toteutusraja

**2026-09-27: backend-kuluttajat siirretty, E2E-regressio ja revision
aa377b46 normaali CI-portti läpäisty; koko T3-/PR/main-portti vielä avoinna.**
Käytetään nykyisen native-adapterin erikseen versioitua backend-palvelutilaa,
ei uutta koetyökuormaa tai yleistä komentokäynnistintä. Aiemman Electron-kokeen
konfiguraatio, bridge, tarkka tulosskeema ja 20 sekunnin koeraja säilyvät.
Yhteisiä Job-, creation-time assignment-, kahva-, framing- ja stdio-osia
käytetään uudelleen ilman installerin tuotantoprimitiivien muutosta.

- Native-palvelutila sallii vain nykyisen Node-ajurin ja kiinteän E2E-backendin
  entrypointin sekä `--config`-argumentin. Repositoryn lukemiseen tarkoitettu
  cwd, synteettinen fixturejuuri ja generation-kohtainen kontrollijuuri ovat
  erillisiä validoituja polkuja. Ei shelliä, vapaata argv:ta tai salaisuutta
  kontrollikehyksissä; writable temp/profile-polut pysyvät testijuuressa.
  E2E-backend saa omistajalta eksplisiittisen `EKY_E2E_OS_TEMP_ROOT`-ankkurin,
  koska sen oma `TEMP`/`TMP` on eristetty. Native tarkistaa ankkurin vastaavan
  launch-konfiguraation alkuperäistä OS-temp-juurta; backendin E2E-validator
  vaatii sekä datan että `TEMP`/`TMP`:n samaan `eky-e2e/run-*`-juureen.
  Sisarajon temp, suhteellinen polku ja samanaikainen Electronin erillinen
  root-override hylätään. Tämä ei ole tuotantoruntimen asetus tai uusi
  fallback, eikä alkuperäistä koko käyttäjän temp-kansiota anneta writableksi.
- Kontrolliyhteys perustetaan ennen yhden launchin sallimista. Sama native-
  omistaja säilyttää Jobin ja todellisen backendin prosessikahvan root-exitin
  yli. Käynnistyshavainto julkaistaan vasta onnistuneen luomisen, jäsenyyden
  tarkistuksen ja resumoinnin jälkeen. Muistimittaus käyttää tätä kahvaa,
  ei apuprosessin PID:tä tai uudelleen avattua PID-pohjaista kohdetta.
- Kuluttajille riittävät todettuun käynnistykseen sidottu instanssi,
  työkuorman asynkroninen `running`/`exited`/`unavailable`-havainto ja muistiluku.
  Havainto kysytään säilytetyn prosessikahvan kautta; yhteyden menettäminen
  ei jätä vanhaa `running`-arvoa voimaan. Todennettu exit saa säilyä normaalin
  sulkemisen jälkeen. Epävarma muistiluku hylätään, ei korvata nollalla. Bounded
  output-readerit, `stop()`, nykyiset `isolated*Test`-rajapinnat, API/Page-
  oliot ja business-assertiot säilyvät. Raakaa `ChildProcess`-oliota ei
  jäljitellä. Root-exit ei muutu cleanup-todisteeksi rajapinnan nimeämisellä.
- Yksi fixtureyrityksen monotonic-alkuhetki kulkee myös restarteihin ja
  backupin valmisteluun. Playwrightin julkinen `testInfo.timeout` on koko
  testin raja, ei jäljellä oleva aika. Siitä johdettu native-containment-raja
  on lisävarmistus; Playwright säilyy ensisijaisena myös aiemmin alkaneessa
  setupissa. Työmääräaikaa ei nollata siirrossa eikä testin timeoutia kasvateta.
  Ennen launchia kutsuja ottaa korreloidun native-statusnäytteen. Näytteen
  elapsed-arvo ja launchia muodostettaessa jäljellä oleva kutsujan työaika
  muodostavat konservatiivisen absoluuttisen native-elapsed-rajan.
  Native lukitsee rajan kerran ennen lapsen luomista ja vain aikaistaa
  alustavaa rajaansa; viivästynyt omistajan käynnistys tai viestin kulku
  ei aloita työbudjettia uudelleen. Erillinen watchdog lyhenee samaan
  rajaan nykyinen cleanup-varaus säilyttäen. Tämä työrajan sidonta ja
  jäljempänä kuvattu ensimmäisen stopin cleanup-kellosidonta ovat eri asioita.
  Cleanup saa ensimmäisestä stopista oman nykyisiin rajoihin sovitetun
  määräajan: työbudjetin loppuminen ei yksin estä cleanupin todentamista.
- Stop memoidaan. Luomisen loppu, launchin pysyvä sulkeminen, Jobin tyhjyys
  ja stdion asettuminen vaaditaan ennen puun poissaolokuittia. Lisäksi
  vaaditaan joko ettei lasta luotu tai että luodun rootin exit todennettiin.
  Kutsuja varmentaa lisäksi ownerin ja kanavan sulun sekä portin erikseen.
  Terminal-kuittaus ja kanavan/ownerin sulku kuuluvat samaan ensimmäisestä
  stopista alkavaan cleanup-määräaikaan, eivät koko työbudjettiin. Kutsujan
  stop, työmääräajan täyttyminen ja omistajuushäiriö eivät nollaa määräaikaa.
  Native-kellon alku ei ole sama kuin kutsujan prosessikäynnistyspyyntö.
  Korrelatoidun pyynnön lähetysaika ja vastauksen monotonic-elapsed sidotaan
  konservatiiviseksi alkuhetken alarajaksi; kokonaismillisekunnin pyöristys
  huomioidaan. Vastauksen vastaanottoaika ei anna lisäaikaa. Ilman pyyntöä
  saapuva tapahtuma ei tarkenna kellosidontaa, ja jo lukittu cleanup-raja
  saa vain aikaistua. Alkuperäinen paikallinen stop-raja säilyy rinnalla.
  Ensimmäinen toimintavirhe ja cleanupin tulos ovat eri asioita: myös
  epäonnistuneen startupin siivous voi olla todistettu. Myöhäinen tai
  epävarma kuitti estää restartin ja juuren poiston.
- Build-esiehto liitetään nykyisiin preparation-komentoihin ja sitä
  tarvitsevaan Windows CI -kuluttajaan. Vanhan kokeen guardit ja T1/T2:n
  epäonnistuneen tai vanhentuneen valmistelun torjunta säilyvät.

Saman kokonaisuuden native-sopimus ja kutsujan rajapinta on nyt kytketty
`startE2eBackendProcess`-käynnistäjään, ajoitus sen kaikkiin käynnistäjiin
sekä nykyisiin PID-/exit-/RSS-kuluttajiin. Kohdetestit kattavat strict-kontrollin, varhaisen
virheen, root-firstin, owner-lossin, toistetun stopin ja epävarman cleanupin.
Oikea backendin health/session/restart/backup-polku ja muistimittaus sekä
entisen kokeen regressiot todistetaan ennen Windowsin vanhan backend-
cleanup-reunan poistoa. Ei Windows-fallbackia vanhaan taskkill-polkuun.
Vite, Chromium ja Electron seuraavat omissa siirtopaloissaan. Linuxia ei
poisteta tai nimetä siirretyksi tämän Windows-todisteen perusteella.

Tämän keskeneräisen siirron testit on erotettu
[matriisissa](r0-e2e-test-matrix.md) aiemmasta hyväksytystä
käynnistyshavainnosta. Tuotantoruntime, käyttäjädiagnostiikka, business-audit,
backup-formaatti ja sovellusversio eivät muutu. Omistajan konfiguraatio ja
terminal ovat testikohtaisia teknisiä tiedostoja, eivät business-artifacteja
tai varmuuskopioita. Niitä ei sisällytetä tuotannon tukipakettiin.

Lopullisen työmääräaikakorjauksen jälkeen rajattu boot/health/session/RSS-sarja
läpäisi 5/5 ja kuuden nykyisen restart-, yrityksenluonti-, istuntaraja-,
HTTP-turvallisuus- ja backup import/replacement -tiedoston sarja 22/22.
Native-adapterin aiemmat 510 ja uuden backend-tilan 226 sopimustarkistusta
läpäisivät. Kutsujan kellosidonnan, kontrollin ja omistajan regressiosarja
läpäisi 96/96 ja paketin tyypitys läpäisi. Täysi tavallinen E2E läpäisi
484/484 (system 398, web 41, Electron 45) ilman retryä, flaky-tulosta tai
ohituksia. Tämä sisältää oikeita yhteisen backend-käynnistäjän kuluttajia,
mutta ei siirtämättömien selaimen tai Electronin puiden omistajuustodistetta.

Ennen viimeistä backend-tilan työmääräaikakorjausta läpäisivät myös
E2E-työkalujen 487 sopimusta, CI-kytkentöjen 315 sopimusta, workspacen
4 445 testiä (8 ennestään ohitettua) ja kaikkien 11 paketin tyypitys.
Aiemman Electron-adapterin neljä oikeaprosessitapausta läpäisivät ennen
tätä korjausta; niiden yhteinen toteutus ja vanha protokolla eivät muuttuneet
viimeisessä korjauksessa. Näitä aiempia ajoja ei nimetä lopullisten tavujen
koko regressioksi.

Revision `a2c826fc785cc2f9c6d678356e240f13e48611d6` normaali
[V2-yritys 36286489889](https://github.com/eky-software/eky/actions/runs/36286489889)
ei läpäissyt: workspace-success run 1 keskeytyi GitHubin vahvistamaan
30 minuutin job-rajaan ja loppukoonti hylkäsi ajon. System 398/398,
web 35/35 ja Electron 38/38 ilman retryä sekä erillinen
[riippuvuustarkistus 36286493376](https://github.com/eky-software/eky/actions/runs/36286493376)
läpäisivät, mutta eivät korvaa puuttuvaa packaged-hyväksyntää. Keskeytyneen
jobin loki ei ollut saatavilla myöskään koko ajon lokiarkistossa; sisäinen viimeinen vaihe, caller-result,
todellinen checkout ja prosessisiivous ovat sen osalta varmentamatta.
Jobin aikaraja ei yksilöi sovellus-, omistaja- tai runner-vikaa. Aiempi
samankaltainen timeout ei todista yhteistä syytä. Hyväksytty koko CI:n
lähtötila säilyy revisiona `83a94fad`; ennen seuraavaa toiminnallista siirtoa
rajataan puuttuva näyttö nykyisen harnessin vastuilla, ei uudella alustalla.
Rajattu jatko käyttää nykyisen erillisen workspace-diagnoosimoodin
[kutsurajahavaintoja](windows-installer-acceptance-harness-v2.md#workspace-diagnostiikan-kutsurajahavainnot)
yhdessä nykyisten native-vaiheiden kanssa. Kutsun alku ja paluu erotetaan
verifierin alusta ja paluusta ilman uutta prosessiomistajaa tai aikarajaa.
Tallennuksen puute raportoidaan erikseen: havaintoketju ei voi luvata
palauttaa menetetyn runnerin aineistoa. Kutsurajan 20 kohdetestiä ja nykyinen
62 testin artifact-/workflow-sarja läpäisivät ilman ohituksia. Ne todentavat
ohjausketjun ja alkuperäisen virheen säilymisen, eivät oikean prosessipuun
siivousta. Revision `3c992a26a71a0b78d6fd6199952a2036c85a4589`
[erillinen diagnoosi 36290415587](https://github.com/eky-software/eky/actions/runs/36290415587)
läpäisi yrityksellä 1. Sama aiempi workspace-artifact varmennettiin ennen
ja jälkeen, neljä kutsurajahavaintoa saatiin oikeassa järjestyksessä ja
nykyinen mandatory-result-verifier hyväksyi komennon tuloksen. Native-vaiheet
vahvistivat puiden poistumisen, fixture-siivouksen ja tuloksen julkaisun.
Diagnoosin checkout ja koko loki varmennettiin; havaintoaukkoja ei todettu.
Tämä ei hyväksy aiempaa V2-yritystä tai ratkaise sen timeoutia.
Seuraava uuden revision normaali hyväksyntäkierros noudattaa
[nykyisen V2-jatkopäätöksen rajaa](windows-installer-acceptance-harness-v2.md#workspace-diagnostiikan-kutsurajahavainnot):
eri yritysten osatuloksia ei yhdistetä, ja uusi hylkäys pysäyttää etenemisen.

Tämän jatkopäätöksen uusi jäädytetty revisio
`aa377b46378fc0eb1912db67ad734d1fdd30e119` läpäisi normaalin
[V2-ajon 36291090155](https://github.com/eky-software/eky/actions/runs/36291090155)
ja [riippuvuustarkistuksen 36291100866](https://github.com/eky-software/eky/actions/runs/36291100866),
kumpikin yrityksellä 1. V2:n kaikki 38 vaadittua ryhmää läpäisivät ja yksi
valinnainen diagnoosi ohitettiin tarkoituksellisesti. Kaikki neljä kokeellista
valitsinta olivat pois. System 398/398, web 35/35 ja kriittinen Electron
38/38 läpäisivät ilman retryä tai flaky-tulosta. Kaikkien suoritettujen
ryhmien lokit ja checkoutit, native-sopimusten 510/226 tarkistusta sekä
neljän tuottajan ja kymmenen kuluttajan artifact-sidonnat varmennettiin.
Tämä on uusi hyväksytty CI-lähtötila Windows-Viten siirtoon, ei aiemman
timeoutin juurisyy, Linuxin omistajuustodiste tai koko T3-/PR/main-hyväksyntä.

Ensimmäinen oikean backendin ajon hylkäys säilytettiin: native-kellon alku
oli sidottu virheellisesti kutsujan prosessinluontipyynnön alkuun. Edellä
kuvattu konservatiivinen kellosidonta ja sen viive-/määräaikaregressiot
korjaavat tämän rajatun syyn, eivät historiallisten timeoutien syytä.

Katselmus löysi erikseen suorien testikuluttajien tarpeettoman
cleanup-virheen nostamisen alkuperäiseksi testivirheeksi ja endurance-polun
aiemman epävarman pysäytyksen säilytyspuutteen. Nämä on korjattu, katselmoitu
ja regressioitu. Viimeinen katselmus korjasi lisäksi työbudjetin
nollaantumisen viivästyneessä native-startissa yllä kuvatulla prelaunch-
sidonnalla. Hallitut kellotestit eivät yksin todista oikean watchdogin
laukeamista pysähtyneen kutsujan aikana; koko T3-matriisi on edelleen avoin.
Lopullisissa rajatuissa katselmuksissa ei jäänyt avoimia löydöksiä.
Vanhaa Windows-backendin taskkill-polkuun palaavaa fallbackia ei ole;
siirtämättömien Vite-/Electron-/Linux-polkujen näyttö ei muutu tällä.

###### Viten Windows-omistajan toteutusraja

**2026-09-27: toteutettu; paikalliset portit ja revision 2b40dcd4 normaali
CI-portti läpäisty. Koko T3-/PR/main-portti on edelleen avoin.** Sama omistaja-, kontrolli-, kello-
ja tilakone palvelee backendia ja Viteä suljettuina sisäisinä profiileina.
Moduulitesti käyttää edelleen `isolatedWebTest`-fixtureä ja Page/API-rajapintaa.
Ei uutta alustaa, mielivaltaista komentoa tai Chromiumin/Electronin/Linuxin
siirtoa tämän palan osana.

- Backendin v1-protokolla ja `--backend-owner` säilyvät. Viten oma
  `eky.e2e.vite-service` v1 ja `--vite-owner` hylkäävät ristiin käytetyn
  profiilin. Molemmat käyttävät yhteistä yhden launchin ja terminalin
  omistajuuslogiikkaa; elinkaaritoteutusta ei kopioida.
- Käynnistys on kiinteä Node + nimetyn `apps/web/node_modules/vite`-paketin
  manifestiin sidottu `bin/vite.js`, cwd `apps/web`, config `vite.config.ts`,
  `--configLoader runner`, loopback, validoitu portti, `--strictPort` ja
  `--mode eky-e2e`. Vain tämän nimetyn pakettivalitsimen hallittu resolvointi
  sallitaan. Alkuperäiset vanhemmat ja kanoninen kohde tarkistetaan;
  ei yleistä linkkipoikkeusta, `.bin`-shimmiä tai callerin entrypointia.
- Vite saa vain eksplisiittiset E2E-, järjestelmä-, alkuperäisen OS-tempin,
  oman temp/profile-juuren sekä backend-originin ja ympäristöjuuren arvot.
  Ei perittyä PATHia, HOMEa tai NODE_OPTIONSia. Nykyinen synteettinen runtime-
  session kulkee erikseen validoidussa owner-to-child-ympäristössä ja Node-
  proxyssä, ei konfiguraatiossa, kontrollissa, argv:ssa tai rendererissä.
  Cache ja ympäristökansio validoidaan saman `run-*`-juuren alle. Tavallisen
  dev/build-konfiguraation toiminta ei muutu.
- Sama fixture-lifetime kulkee Viteen. Nykyinen 15 sekunnin startup lyhenee
  jäljellä olevaan työaikaan; native-raja sidotaan samaan konservatiiviseen
  kellonäytteeseen kuin backendillä. Cleanup saa vain nykyisen kolmen
  sekunnin ensimmäisen stopin rajan. Ensimmäinen virhe, puun poistuminen ja
  portin vapautuminen erotetaan, eikä epävarmaa juurta poisteta.
- Myös endurance-kuluttaja lukee todellisen Vite-työkuorman tilan, ei ownerin
  PID:tä tai tekaistua ChildProcess-oliota. Nykyinen yhteinen fixture-cleanup
  säilyttää ensimmäisen virheen. T1/T2:n valmistelun tuoreus ja backendin
  aiemman protokollan regressiosuoja säilyvät.

Hyväksyntä vaatii suljetun konfiguraation, profiilien erottelun, kellojen,
virheiden ja cleanupin sopimukset sekä oikean Viten runner-config-, sivu-,
proxy/session-, eristetyn temp/cache- ja stop/port-polun. Käynnistysvirhe,
root-first, owner-loss ja toistettu stop todistetaan soveltuvalla tasolla.
Viten mahdollinen apuprosessi kuuluu samaan Jobiin; mockattu config-koe ei
todista sitä. Korvattu Windowsin suora spawn/taskkill-polku on poistettu
oikean kuluttajan vastaavan rajatun näytön jälkeen. Linuxin suora polku ei
ole Windowsin fallback eikä koko puun omistajuustodiste. Linuxin tuettujen testiympäristöjen päätös on
erillinen, edelleen avoin. Tämä pala ei sulje koko T3-matriisia.

Paikallinen näyttö samasta jäädytetystä toteutuksesta:

- Normaali täysi E2E: 548/548 (system 462, web 41, Electron 45), ilman
  retryä, flaky-tulosta tai ohituksia. Nykyinen web-fixture käytti oikeaa
  Vite-omistajaa; Chromiumin oma omistajuuspolku on edelleen siirtämättä.
- `WEB-SERVICE-001` todensi oikean backendin ja Viten sivu-/moduuli-/proxy-
  polun, session-rajan, eristetyn cachen, työkuorman tilan sekä toistetun
  stopin ja saman generationin native-terminalin. `WEB-SERVICE-002`
  todensi oikean käynnistysvirheen varatulla portilla: Viten puu päättyi,
  erikseen omistettu portin varaaja säilyi eikä epävarmuutta hyväksytty
  normaaliksi cleanupiksi. Testi sulki vain oman varaajansa erikseen.
- Nykyinen endurance-kuluttaja läpäisi erillisen ajon ilman avoimia
  hallittuja prosesseja. Vanhat neljä Windows-adapterin oikeaprosessikoetta
  läpäisivät samoilla native-tavuilla; niiden näyttö on edelleen kokeellista.
- Native-sopimukset 510/226/285, yhteiset backend-/Vite-sopimukset 130/130,
  kanoniset E2E-työkalutestit 488/488 sekä CI-sopimukset 315/315 läpäisivät.
  Workspace-testit läpäisivät 4 446 testiä; kahdeksan aiempaa ohitusta
  säilyi. Koko projektin tyypitys läpäisi.

Katselmuksissa ei jäänyt rajatun toteutuksen avoimia löydöksiä. Sopimustestien
owner-loss-/root-first-havainnot ja vanha adapterikoe eivät yksin todista
elävän Viten watchdogia tai koko lopullista omistajuusmatriisia.

Lähde `2b40dcd4ac500c0f09b813f43737f7c2b18afe95` läpäisi normaalin
[V2-ajon 36295438797](https://github.com/eky-software/eky/actions/runs/36295438797)
ja [riippuvuustarkistuksen 36295441492](https://github.com/eky-software/eky/actions/runs/36295441492),
kumpikin yrityksellä 1. Kaikki 38 vaadittua ryhmää läpäisivät; yksi valinnainen
diagnoosi ohitettiin tarkoituksellisesti ja kaikki neljä kokeellista
valitsinta olivat pois. System 462/462, web 35/35 ja kriittinen Electron
38/38 läpäisivät ilman retryä tai flaky-tulosta. Kaikkien suoritettujen
ryhmien lokit ja checkoutit, native-sopimusten 510/226/285 tarkistusta sekä
neljän tuottajan ja kymmenen kuluttajan artifact-sidonnat varmennettiin.
Tämä on seuraavan rajatun siirtopalan hyväksytty CI-lähtötila. Se ei todista
Linuxin omistajuutta, Chromiumin/Electronin siirtoa, koko T3:a tai PR/main-
integraatiota eikä ratkaise aiemman revision packaged-workspace-timeoutia.

Tapahtumat ovat vain testiruntimen startup-/cleanup-havaintoja. Ne eivät
kuulu tuotannon Diagnosticsiin, Activityyn, tukipakettiin tai business-backupiin.
Tuotannon ominaisuuksia, versiota, riippuvuuksia, aikarajoja, CI-vaatimuksia
tai tavallisen Vite-dev/buildin käyttäytymistä ei muutettu.

###### Electronin suorien kuluttajien Windows-siirto

**2026-09-27: kaksi suoraa kuluttajaa toteutettu; rajatun revision
paikallinen näyttö ja normaali CI-portti läpäisty.**
Ensimmäinen Electron-pala siirtää nykyisen toisen instanssin käynnistyksen
ja `DESK-BOOTFAIL-001`:n suoran bootstrap-ajon samaan Windowsin palveluomistajaan
kuin backend ja Vite. Playwright-yhteyden bridge, pääfixturen restart/relaunch
ja Linux ovat erillistä keskeneräistä siirtotyötä. Tämä ei sulje T3:a.

- Suljettu `electron`-profiili käyttää nykyistä native-binääriä, Jobia,
  tilakonetta, kontrollikanavaa, kellosidontaa ja kolmen sekunnin cleanupia.
  Ei kolmatta prosessinvalvojaa tai yleistä executable/argv/env-rajapintaa.
- Sallittu suora käynnistys on vain nykyinen desktopin kehitys-Electron ja
  repositoryn `apps/desktop/e2e-dist`-entrypoint. Native tarkistaa nimetyn
  pnpm-paketin, desktopin lukitun version, manifestin ja `path.txt`:n sekä
  alkuperäiset polkusegmentit ennen prosessin luontia. Tavallista tuotanto-
  artifactia, vapaata komentoa tai lisäargumentteja ei hyväksytä.
- Runtime-konfiguraatio ja nykyinen eristetty Electron-profiili kuuluvat
  samaan synteettiseen run-juureen. Kontrollijuurta ei sekoiteta business-
  profiiliin. Nykyisen `createElectronEnvironment`-funktion suljettu ympäristö
  säilyy; sessionin sisältöä ei kopioida owner-konfiguraatioon tai viesteihin.
- Toisen instanssin 15 sekunnin ja bootstrapin 30 sekunnin alkuperäinen raja
  säilyvät. Native saa niiden ja saman fixture-eliniän pienemmän jäljellä
  olevan työajan. Omistajan käynnistys, kontrolli tai restart ei uusi aikaa.
- Suoran työkuorman nopea poistuminen on havainto, ei palvelun startup-
  virhe: toinen instanssi vaatii edelleen exit 0 ja bootstrap-testi exit 1.
  Native-omistajan onnistunut cleanup ja exit 0 ovat näistä erillisiä ehtoja.
  Backendin ja Viten ennen valmiutta poistumisen hylkäys ei muutu.
- Puun kuitti, kontrollin sulku ja ownerin todellinen poistuminen vaaditaan
  ennen onnistumista. Epävarmuus estää restartin ja testijuuren poiston;
  vapaa portti tai odotettu pääprosessin exit ei korvaa puutodistetta.
  Ensimmäinen toiminta- tai assertion-virhe säilyy cleanup-tuloksen rinnalla.

Todennus kattaa profiilin torjunnat, nopean exitin, kontrollikatkon,
alkuperäiset määräajat, toistetun stopin ja juuren säilytyksen sekä molemmat
oikeat Electron-kuluttajat. T1/T2-valmistelu sitoo uuden native-profiilin ja
sen selftestit samaan lähde-/artifact-identiteettiin. Vanhan suoran Windows-
polun poisto edellyttää saman revision vastaavaa näyttöä. Tuotantokoodi,
moduulitestien julkinen fixture, riippuvuudet ja CI-vaatimukset eivät muutu.

Rajattu paikallinen näyttö:

- Täysi normaali E2E läpäisi 602/602 (system 516, web 41, Electron 45),
  ilman retryä, flaky-tulosta tai ohituksia. Mukana olivat molemmat oikeat
  suorat kuluttajat ja vastaanottojärjestyksen säilyttävä rajattu tulostepuskuri.
- Tämän jälkeen korjattiin vain bootstrap-testin siivousraportin kytkentä
  nykyiseen `electron-lifecycle.json`-tiedostoon ja liitteeseen. Uusi 44/44
  kohdesarja sisälsi molemmat oikeat Electron-polut sekä onnistuneen ja
  epävarman siivouksen raportointiregressiot. Oikean bootstrap-ajon tiedosto
  luettiin takaisin: ei API-käynnistystä, puu ja portti suljettu, juuri poistettu.
  Aiemman täyden ajon lähdesidonta säilyy erillisenä; 604 testin täyttä
  uusinta-ajoa ei tämän raportointimuutoksen jälkeen ole tehty.
- Lopullisen lähteen workspace 4 447 läpäisyä ja kahdeksan aiempaa ohitusta,
  kaikkien 11 paketin tyypitys sekä CI-sopimukset 315/315 läpäisivät.
  E2E-työkalusopimukset ovat 489/489. Native-selftestit ovat 510/226/285/408;
  saman binäärin aiemmat neljä oikeaprosessikoetta läpäisivät.
- Korvatut Windowsin suorat spawn-kutsut eivät ole fallbackina. Linuxin
  vanha suora polku säilyy erikseen avoimena siirtona. Pääfixturen
  Playwright-käynnistys, restart ja relaunch eivät tällä muutu omistetuiksi.

Normaali kriittinen Electron-CI ei sisällä näitä kahta suoraa testiä;
niiden oikeaprosessinäyttö on yllä oleva erillinen paikallinen ajo.
Uudet alemmat sopimukset kuuluvat tavalliseen system-sarjaan. Näitä kahta
tasoa ei yhdistetä väitteeksi uudesta CI-kattavuudesta. Native-konfiguraatio
ja kontrollikuitti pysyvät testijuuressa; julkaistava lifecycle-raportti
sisältää vain suljetut tilat. Epävarma siivous säilyttää juuren ja ensimmäisen
virheen. Raportit eivät kuulu tuotannon diagnostiikkaan tai varmuuskopioihin.

Revision `aaef697fd2d33a10a4b16a6b9968d662b4e5fdca` normaali
[V2-ajo 36299990800](https://github.com/eky-software/eky/actions/runs/36299990800)
ja [riippuvuustarkistus 36299995946](https://github.com/eky-software/eky/actions/runs/36299995946)
läpäisivät ensimmäisellä yrityksellä. Kaikki neljä kokeellista valitsinta
olivat pois. V2:ssa oli 38 onnistunutta ryhmää ja yksi tarkoituksellinen
valinnaisen diagnostiikkakokeen ohitus. System 518/518, web 35/35 ja
kriittinen Electron 38/38 läpäisivät ilman retryä tai flaky-tulosta;
native-selftestit olivat 510/226/285/408. Kaikkien vaadittujen lokien
checkoutit, neljän tuottajan ja kymmenen kuluttajan artifact-sidonnat sekä
ennen/jälkeen-varmennukset tarkistettiin. Tämä hyväksyy rajatun normaalin
CI-lähtötilan, ei pääfixturen bridgeä, koko T3:a tai PR/main-integraatiota.
Aiemmat timeout-havainnot säilyvät ratkaisemattomina, eikä CI korvaa yllä
eriteltyä kahden suoran kuluttajan paikallista näyttöä.

###### Electronin pääkäynnistyksen avoimet päätösrajat

**2026-09-27: omistaja hyväksyi molemmat rajatut Electron-ehdotukset.**
Edellä hyväksytty suorien Electron-kuluttajien lähtötila ei muutu. Pääfixturen
siirtoa ei ole toteutettu. Hyväksyntä kattaa turvallisen CI-raportin
toteutuksen sekä nykyisen kirjastokorjauksen rajatun laajennuksen
valmistelun ja testauksen. Raportin paikallinen todennus ja revision
`fe893d6b` normaali CI-portti on läpäisty alla erotellulla näytöllä.
Tämä ei ole koko T3:n hyväksyntä.

1. **Epäonnistuneen launchin havaittavuus.** Lukittu Playwright palauttaa
   `ElectronApplication`- ja `process()`-kahvat vasta onnistuneen launchin
   jälkeen. Windowsissa se käynnistää erillisen shell-väliprosessin.
   Sisäinen cleanup odottaa sen sulkeutumista, mutta launchin aikakatkaisu
   voi katkaista tämän odotuksen. Julkisessa rajapinnassa ei ole erillistä
   failed-launch-kahvaa tai sulkeutumiskuittia. Autentikoidun pipe-peerin
   säilytetty kahva voisi todistaa bridgen poistumisen, ei tätä erillistä
   shelliä. Ehdotus on arvioida nykyisen `playwright-core@1.62.1`-korjauksen
   rajattua laajennusta native-EXE:n suoraan käynnistykseen. Se ei
   yksin ratkaise rekisteröintiä edeltävää aukkoa. Valmistelu ja testaus
   on hyväksytty, lopullista pääfixturen siirtoa ei vielä ole todennettu.
2. **Testivirheen julkaisuraja.** Nykyinen Electronin yhteyskatkovirhe voi
   sisältää debuggerin capability-osoitteen. Tavallinen konsoliraportti
   voi julkaista sen, vaikka debug-tulostus ei ole käytössä ja turvallisen
   lifecycle-artifactin allowlist säilyy. Ongelma ei synny ehdotetusta
   bridgestä. Ehdotus on rajattu CI-raportti Playwrightin julkisella
   Reporter-rajapinnalla: julkiset testitunnisteet, yritykset, tulokset ja
   turvalliset virheluokat erotetaan raakavirheistä ja prosessitulosteesta.
   Tämä muuttaa julkista virhediagnostiikkaa omistajan hyväksymässä rajassa.

Suoran käynnistyksen mahdollinen korjaus vaatii argumenttien, ympäristön,
kahvojen, streamien, varhaisten virheiden ja muiden alustojen regressiot.
Bridge rekisteröidään ennen työkuorman sallimista; puuttuva rekisteröinti
tai sulkeutumishavainto jää epävarmaksi. PID-/nimihaku, aikarajan pidennys,
uusi omistaja tai `unknown`-tilan nimeäminen onnistumiseksi eivät kuulu
ehdotukseen. Nykyisen epävarmuuden säilytys on turvallinen välitila, ei
koko T3:n valmistuminen.

Raportoinnin toteutettu korjaus ei muuta testin tulosta, ensimmäistä
virhettä, retry-/flaky-ehtoja, trace-asetusta tai artifactien julkaisulupaa.
Raakatuloksen säilyminen paikallisessa raportissa tai CI-runnerin levyllä
ei tarkoita uutta pitkäaikaista säilytystä tai lupaa julkaista raporttia.
Oikean runnerin virhekoe, turvalliset virhe- ja tuloskentät sekä julkisen
tulosteen ja julkaisemattoman aineiston erillisyys on todennettava ennen
kytkentää. Tutkimus, joka odottaa nykyistä puutetta, ei ole korjauksen
hyväksyntätesti. Nämä rajat koskevat testiharnessia, eivät sovelluksen
business-, Activity-, Diagnostics- tai backup-sopimuksia.

**CI-raportin toteutussopimus:** normaali `playwright.config.ts` valitsee
CI:ssä `apps/e2e/scripts/safeCiReporter.mjs`-raportin ja ennallaan säilyvän
julkaisemattoman HTML-raportin. Paikallinen list-raportti säilyy. Julkisen
`EKY_E2E_REPORT`-JSON-rivin versio on 1; tapahtumat ovat `begin`,
`testBegin`, `testEnd`, `runError`, `testOutcome` ja `end`. Tapauksen
ajokohtainen numero, sallittu projektinimi, testihakemistoon suhteutettu
lähdekohta ja toiston numero korvaavat vapaamuotoisen otsikon. Yrityksen
retry-numero, odotettu ja toteutunut tila, kesto, virhemäärä ja suljettu
virheluokka välitetään; tuntemattomia arvoja ei tulkita onnistumiseksi.
`testError` ei väitä juurisyytä. Alkuperäinen ensimmäinen virhe löytyy
samasta julkaisemattomasta raportista, ei julkisesta virhetekstistä.

Testin `timedOut` ja koko ajon `timedout` ovat Playwrightin kaksi eri
sopimusarvoa. Lopun yhteenveto erottaa expected/unexpected/flaky/skipped,
ajamatta jääneet tapaukset ja globaalit virheet. Raportti ei palauta
tilan ylikirjoitusta eikä muokkaa tuloksia, virheitä tai liitteitä.
Testien stdout/stderr, virheiden message/stack/value, otsikot, annotaatiot
ja liitepolut eivät kuulu tähän julkiseen projektioon.

CI-kokoonpano torjuu raportin ohittavan `--reporter`-valinnan sekä tunnetut
debug-, watch-, UI- ja HTML-ympäristöohitukset ennen testien aloitusta.
Tämä on nykyisen lukitun ajurin testiraportoinnin suoja, ei yleinen
konsolisalaisuuksien suodatin: ennen kokoonpanon latausta syntyvät virheet,
valmistelukomennot ja uudet ulkopuoliset tulostajat vaativat oman tarkistuksen.
CI:n ympäristö pidetään ilman debug-tulostusta jo ennen ajurin käynnistystä.
Raakaa HTML-, JSON-, trace- tai screenshot-aineistoa ei lisätä julkaistaviin
artifacteihin. Nykyinen lifecycle-allowlist ja säilytysajat eivät muutu.

Regressio käyttää julkisia Reporter-hookeja ja oikeaa Playwright-ajuria:
onnistuminen, odotettu ja odottamaton virhe, odottamaton onnistuminen,
retry/flaky, skip, testin ja koko ajon timeout sekä globaali virhe.
Kohdennettu Electronin main/renderer-yhteyskatko todentaa erikseen, että
todellinen capability-osoite säilyy raakavirheessä mutta ei konsolissa.
Tämä normaali sulkemiskoe ei ole äkillisen prosessikadon tai koko puun
omistajuuden todiste. Paikallinen normaali E2E läpäisi 604/604 (system 518,
web 41, Electron 45) ilman retryä tai flaky-tulosta. E2E-työkalujen
518 sopimustestiä, mukaan lukien 28 raporttitestiä, tyypitys ja 315
CI-sopimustestiä läpäisivät.
Uuden formaatin tuloslukija vaatii täydellisen tapausjoukon, ensimmäisen
yrityksen onnistumisen, virheettömän loppuyhteenvedon sekä täsmällisen
puhtaan lähderevision testiluettelon. Pelkkä vihreä loppurivi ei riitä;
vanhoja checkout-, artifact-, kattavuus- tai CI-portteja ei ohiteta.

**Normaalin CI:n tulos 2026-09-27:** revision
`fe893d6b0d01b38b83ae9dc89044d61cf9874619`
[V2 36313499358](https://github.com/eky-software/eky/actions/runs/36313499358)
läpäisi koko portin: 38 onnistunutta ryhmää, yksi tarkoituksellinen
valinnaisen kokeen ohitus ja kaikki neljä kokeellista valitsinta pois.
System 518/518, web 35/35 ja kriittinen Electron 38/38 todennettiin uuden
raporttimuodon täydellisistä tapahtumaketjuista ilman retryä, flaky-tulosta
tai globaalia virhettä. Kaikki vaaditut checkoutit, native-selftestit
510/226/285/408 sekä neljän tuottajan ja kymmenen kuluttajan artifactien
ennen/jälkeen-sidonnat tarkistettiin. Saman revision
[riippuvuustarkistus 36312191562](https://github.com/eky-software/eky/actions/runs/36312191562)
läpäisi auditointi- ja allekirjoitusportit. Tämä hyväksyy raporttimuutoksen
normaalin CI-lähtötilan, ei koko T3:a, pääfixturen bridgeä tai PR/mainia.

Saman revision ensimmäinen [V2 36312186210](https://github.com/eky-software/eky/actions/runs/36312186210)
säilyy hylättynä: yhden workspace fault recovery -jobin `Set up job`
epäonnistui lukitun GitHub-toiminnon arkiston latauksessa ennen checkoutia
ja testien suoritusta; yhteinen hyväksyntäportti hylkäsi ajon oikein.
Ensimmäisen virheen näyttö säilytettiin. Sama action-revisio löytyi
edelleen ja muut jobit käyttivät sitä onnistuneesti. Yksi uusi kokonaisajo
tehtiin muuttamatta lähdettä, action-pinniä, aikarajoja tai hyväksyntäehtoja;
eri V2-ajojen osatuloksia ei yhdistetty. Latauspalvelun virheen juurisyytä
ei väitetä ratkaistuksi eikä aiempia sovellustimeouteja suljeta tällä näytöllä.

**Suoran EXE-käynnistyksen valmistelutulos:** nykyisen lukitun bundle-version
muistiin sovitettu rajattu lisäys läpäisi 157/157 puhdasta sopimustestiä.
Valinta koskee Electron-launchin eksplisiittistä absoluuttista Windowsin
`.exe`-polkua; oletus-, suhteelliset ja skriptipolut sekä muut alustat
säilyttävät aiemman toiminnan. Tämä ei ole tiedostopolun turvallisuusvalidointi.
Argumentit, ympäristö, työskentelykansio, viisi stdio-kanavaa, ensimmäinen
virhe ja cleanupin epävarmuus tarkistettiin ilman oikean prosessin luontia.
Asennettua riippuvuutta, versionoitua patchia tai lockfilea ei muutettu.
Riippumaton rajattu lähde- ja regressiokatselmus ei löytänyt korjattavaa.

Valmistelu ei vielä todista Windowsin todellista argumenttiparsintaa,
kahvaperiytymistä, pipejen sulkeutumista tai elävää Electronia. Valitsin
vaikuttaisi kaikkiin eksplisiittisiin absoluuttisiin Windows-EXE-launcheihin,
ei vain tulevaan bridgeen. Rekisteröintiä edeltävä aukko säilyy avoimena.
**Omistajan erillinen hyväksyntä 2026-09-27:** rajattu lisäys nykyiseen
`playwright-core@1.62.1`-patchiin, sen regressiot ja oikeat Windows-kokeet
saavat edetä. Valinta koskee kaikkia eksplisiittisiä absoluuttisia
Windows-EXE-launcheja, ei vain tulevaa bridgeä. Patchin täsmällinen
pakettihallinnan hash-sidonta päivitetään; riippuvuusversio, tuotantokoodi,
aikarajat ja CI-ehdot eivät muutu. Valmistelun näyttö ei vielä hyväksy
asennettua korjausta. Pienin tarvittava näyttö kattaa synteettisen argv/env/cwd-
ja stdio-sopimuksen, tavallisen Electron-launchin sulun, varhaisen virheen
ja timeoutin sekä nykyisten neljän adapteriskenaarion regression. Tämä ei
oikeuta pääfixturen siirtoa pelkän puhtaan testinäytön perusteella.

**Käyttöönoton paikallinen tulos 2026-09-27:** kolmas rajattu hunkki on lisätty
nykyiseen patchiin pakettihallinnan työnkululla. Molemmat aiemmat
virheenkäsittelykorjaukset säilyvät. Lukittu asennus, riippuvuusauditoinnit
ja allekirjoitusten tarkistus läpäisivät. Katselmuksessa löytynyt testiapurin
Linux-hostin metadatapolkuvirhe korjattiin täsmällisellä oman `package.json`-
ja `browsers.json`-pyynnön sovituksella. Muita polkuja ei normalisoida.
Oikean bundlen alustuksen positiivinen ja puuttuvan browsers-sovituksen
negatiivinen regressio toistavat tämän rajan synteettisellä Linux-ankkurilla.
Lopulliset 163/163 kohdetestiä, E2E-työkalujen 638/638 sopimustestiä ja koko
työtilan testit sekä tyypitys läpäisivät. Työtilan kahdeksan ennestään
ohitettua testiä säilyivät erillisinä. Riippumaton uudelleenkatselmus ei
löytänyt korjattavaa. Simuloitu Linux-haara ei ole sama asia kuin Linux-hostilla
suoritettu testi; puhtaan revision CI-näyttö on erotettu alle.

Seitsemän rajattua oikeaa Windows-koetta läpäisi: tarkka argumenttijono,
ympäristö ja työkansio sekä normaali Electron-sulku; tarkoituksellinen
ennen-ready-aikakatkaisu; muuttumaton varhainen exit 29 -koe; ja nykyiset
neljä adapteritapausta. Normaalissa kokeessa palautettu lapsi oli todellinen
Electron-pääprosessi, viisi stdio-paikkaa säilyi ja kaikki neljä luettavaa
parent-streamia päättyivät EOF:ään ja sulkeutuivat virheettä. Kaksi
ylimääräistä streamia olivat tyhjiä: niiden käyttökelpoista periytymistä
tulevalle bridgelle ei tällä todisteta.

Aikakatkaisukoe tuotti todellisen Playwrightin `TimeoutError`-virheen ja
säilytti cleanup-epävarmuusmerkinnän. Muuttumaton ulompi testisession
omistaja todisti erikseen puun poissaolon ilman ulkoista pakkotoimea;
tämä ei luo Playwrightille puuttuvaa julkista failed-launch-sulkeutumiskuittia.
Kokeet eivät siirrä pääfixtureä, ratkaise rekisteröintiä edeltävää aukkoa
tai sulje T3/R28:aa. Tavalliset hyväksyntäportit ovat edelleen vaadittuja.

Tavallinen paikallinen E2E läpäisi tämän jälkeen 604/604 tapausta:
system 518, web 41 ja Electron 45, kaikki ensimmäisellä yrityksellä ilman
flaky-tulosta, ohituksia tai globaalia virhettä. Koko tapausjoukon tallennettu
raporttiketju ja ajon lähdesidonta tarkistettiin erikseen. CI-kytkennän
315/315 sopimustestiä läpäisi. Testiapurin erillinen Linux-hostin korjaus
ei kuulu näiden Playwright-käyttäjäpolkujen ajokoodiin; sen lopullinen
sopimusnäyttö on yllä, ja puhtaan revision CI on todennettu erikseen.

**Käyttöönoton normaali CI hyväksytty 2026-09-27:** revision
`587ba5403d6a3d1b19ddba607f664eb5d9e8930c`
[V2 36321641499](https://github.com/eky-software/eky/actions/runs/36321641499)
ja [riippuvuustarkistus 36321645670](https://github.com/eky-software/eky/actions/runs/36321645670)
läpäisivät ensimmäisellä yrityksellä. V2:n kaikki 38 vaadittua ryhmää
onnistuivat; yksi tarkoituksellinen valinnainen koe jäi pois ja kaikki
neljä kokeellista valitsinta olivat pois. Alkuperäisten lokien checkoutit,
neljän tuottajan ja kymmenen kuluttajan artifact-sidonnat sekä native-sarjat
510/226/285/408 tarkistettiin. System 518/518, web 35/35 ja kriittinen
Electron 38/38 täsmäsivät puhtaan revision koko testiluetteloon ilman retryä,
flaky-tulosta, ohituksia tai globaaleja virheitä.

Linuxin normaali työtilatesti suoritti myös 638/638 työkalutestiä, mukaan
lukien oikean bundlen alustuksen metadatapolkuregressiot. Riippuvuusportti
todensi molemmat auditoinnit ja 160 paketin rekisteriallekirjoitukset.
Tämä sulkee rajatun EXE-patchin normaalin CI-portin. Se ei ole pääfixturen
siirron, Linuxin prosessiomistajuuden, koko T3:n tai PR/mainin hyväksyntä.
Aiemmat satunnaiset timeoutit ja ensimmäiset hylkäykset säilyvät erillisinä.

###### Electronin varhaisen prosessihavainnon päätösehdotus

**2026-09-27: omistaja hyväksyi rajatun toteutuksen ja testit; toteutus kesken.**
Hyväksyntä kattaa kokeellisen Node-havainnon ja alla täsmennetyn
read-only-pipe-peer-sidonnan rekisteröinti/GO-portteineen. Se ei hyväksy
vielä fixturen siirron tulosta tai koko T3:a. Havaitsija, native-sidonta ja
niiden virhepolut toteutetaan ensin nykyiseen E2E-omistukseen; oikea
Windows-kytkentä todennetaan ennen tavallisen fixturen siirtoa.
Suoran EXE-patchin hyväksyntä ei yksin ratkaise ennen bridge-rekisteröintiä
tapahtuvaa virhettä. Vaihtoehto on rajattu havaitsija Noden sisäänrakennetulla
`node:diagnostics_channel`-rajapinnalla. Uutta riippuvuutta, Playwright-patchia,
globaalia `spawn`-korvausta tai uutta prosessien omistajaa ei ehdoteta.

Node luokittelee Process-kanavat kokeellisiksi. Projektin `.node-version`-
lukituksen lähteessä `child_process` julkaistaan jo konstruktorissa ennen
käynnistysmetatietoja. Sopivampi havaintokohta on
`tracing:child_process.spawn:start`: se tarjoaa todellisen `ChildProcess`-
olion ja käynnistysasetukset ennen käyttöjärjestelmän luontikutsua.
`spawn:end`/`spawn:error` eivät vielä takaa asetettua PID:tä; onnistunut
`spawn`-tapahtuma ja sulkeutumisen `close` ovat erillisiä havaintoja.
Tämä järjestys on version lähdekoodisopimus, ei pelkän PID-puutteen päätelmä.

Rajattu toteutettavuustarkistus läpäisi aidon lyhytikäisen Node-lapsen
olioidentiteetin ja sulun sekä julkisen Playwright-launchin puuttuvan
EXE:n virhehaaran. Jälkimmäisessä epäonnistuneen spawnin olio saatiin
talteen viimeistään launch-hylkäyksen käsittelijään mennessä ja sen `close`
havaittiin erikseen. Tämä ei ole luodun native-prosessin kahvatodiste.
`AsyncLocalStorage`-konteksti säilyi tarkistetussa in-process-kutsuketjussa;
sen ulkopuolinen sisarus jätettiin havainnon ulkopuolelle. Rinnakkaisia
launch-konteksteja, native-bridgeä, GO-porttia tai owner-lossia ei tällä
todennettu. Normaali fixture ja sen hyväksyntätila eivät muuttuneet.

Ehdotettu rajattu toteutussopimus:

1. Havaitsija aseistetaan ennen yhtä launch-kutsua ja sidotaan sen
   kertakäyttöiseen kontekstiin, generaatioon, nonceen, validoituun EXE:hen
   ja työkansioon. Kahva ja error/exit/close-havainnot otetaan talteen ennen
   metadatan tulkintaa; callback ei heitä eikä muuta käynnistysasetuksia.
   Pelkkä polku, PID, ajoitus tai prosessin nimi ei riitä sidonnaksi.
2. Rekisteröinti ja työkuorman salliva GO erotetaan nykyisen native-omistajan
   sisällä. Omistaja ei luo Electronia ennen saman bridgen autentikoitua
   rekisteröintiä ja kutsujan GO:ta. Rekisteröinnin pitää sitoa kaikki
   bridge-kanavat havaittuun instanssiin; nykyinen SID-/nonce-tarkistus ei
   yksin osoita tätä. Omistaja hyväksyi alla rajatun pipe-peer-sidonnan;
   oikean native-kytkennän todentaminen kuuluu edelleen toteutusporttiin.
3. Puuttuva, ristiriitainen, monistunut tai myöhäinen havainto estää GO:n.
   Stop, peruutus ja havaittu bridgen sulkeutuminen sulkevat käynnistysluvan
   pysyvästi. Node-/Playwright-päivitys vaatii havaintosopimuksen uuden
   todennuksen; hyväksymätön versio torjutaan ennen launchia. Kanavan
   puuttuminen ei muutu vanhan cleanupin fallbackiksi.
4. Ennen GO:ta epäonnistunut ajo tarvitsee havaitun bridgen sulun sekä
   saman omistajan terminal-kuittauksen päättyneestä luontivaiheesta ja
   työkuorman puuttumisesta. GO:n jälkeen nykyiset Job-, root-, stdio- ja
   terminal-ehdot säilyvät. Node-havaitsija ei omista tai pysäytä työkuormaa.
   Launchin hylkäys, pipe-EOF tai aiottu exit-koodi eivät yksin riitä.
5. Ensimmäinen launch-virhe, cleanup ja havaintovirhe pysyvät erillään.
   Epävarmuus estää restartin ja juuren poiston. Alkuperäiset absoluuttiset
   työ- ja siivousmääräajat eivät ala uudelleen rekisteröinnistä tai GO:sta.
   Prosessin elinkaarikuuntelijoita ei poisteta ennen vaadittua
   sulkeutumishavaintoa. Yksi passiivinen ALS-dispatcher jää reitittämään
   myös saman kontekstin myöhäiset havainnot; se ei ylläpidä launch-listaa.
   Tunnettujen lasten `close` ja launch-lupauksen päättyminen eivät todista
   kaiken mahdollisen myöhemmän asynkronisen työn päättymistä eivätkä yksin
   anna lupaa juuren poistoon. Native-omistajan suljettu luontivaihe ja
   erillinen terminal-todiste vaaditaan edelleen.
6. Havaintodata, argumentit, ympäristö, ohjausosoitteet ja raakavirheet
   eivät kuulu julkiseen raporttiin. Nykyinen turvallinen raportti ja
   alkuperäisen virheen julkaisematon lukuketju säilyvät. Ei muutoksia
   tuotantoon, Activityyn, Diagnosticsiin tai business-varmuuskopioihin.

**Sidonnan täsmällinen päätösraja:** JavaScriptin `ChildProcess` ei anna
native-omistajalle käyttöjärjestelmän luontikutsun palauttamaa Windows-
kahvaa. Sitä ei väitetä sellaiseksi. Ehdotettu bridge-sidonta on sen sijaan
autentikoidusta pipe-peeristä hankittu havaintokahva. Tämä on erillinen
testiharnessin sopimus; Electron-työkuorman luontikahva ja ennen resumea
varmistettu Job-omistajuus säilyvät muuttumattomina.

- Native-omistaja hyväksyy yhden yhteyden kuhunkin oman generaationsa
  control/output/error-pipeen. Kaikkien kolmen `GetNamedPipeClientProcessId`
  -arvon pitää täsmätä havaitsijan onnistuneesta spawnista saamaan bridgen
  PID:hen. Havaittu error/exit/close tai ristiriitainen ehdokas estää GO:n.
- Vain tähän autentikoituun pipe-ehdokkaaseen saa hankkia yhden
  `OpenProcess`-kahvan oikeuksin `SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION`.
  Kahva ei periydy eikä anna terminate-, kirjoitus- tai duplikointioikeutta.
  Ei prosessilistausta, nimi-/polkuhakua, mielivaltaista PID-parametria tai
  epäonnistuneen hankinnan korvaamista uuden PID-instanssin kahvalla.
- Saman säilytetyn kahvan PID, luontiaika ja elossaolo tarkistetaan.
  Vasta tämän hankinnan jälkeen omistaja lähettää tuoreet, erilliset
  kertakäyttöiset haasteet control/output/error-kanaviin. Output/error-
  kanavien ensimmäiset rajatut kehykset nimeävät kiinteän roolinsa; bridge
  validoi oikean roolin ennen datan välitystä ja palauttaa haasteet omissa
  nimetyissä kentissään control-vastauksessa. Vaihdettuja rooleja ei oikaista
  eikä näitä kehyksiä välitetä Playwrightin stdout/stderr-kanaviin.
  Vastauksen generaation ja launch-noncen pitää täsmätä, jokaisen haasteen
  vastata oman kanavansa arvoa sekä bridgen ilmoittaman oman PID:n ja
  luontiajan täsmätä hankitusta kahvasta luettuun identiteettiin.
  Pipejen peerit ja saman kahvan elossaolo tarkistetaan uudelleen ennen
  rekisteröinnin hyväksyntää. Bridgen tulee ennen GO:ta olla lapsiton eikä
  se saa siirtää pipe-kahvoja. Jos vanha peer kuolee ja PID käytetään
  uudelleen, vanhan kanavan uusi haaste ei saa hyväksyä korvaavaa prosessia.
- Kutsujan GO sidotaan täsmälliseen hyväksyttyyn rekisteröintiin ja
  käsitellään sarjallisesti stopin kanssa. Omistaja tarkistaa säilytetyn
  peer-kahvan ja käynnistysluvan ennen luontia sekä uudelleen ennen resumea.
  Fyysinen exit voi silti tapahtua viimeisen tarkistuksen jälkeen: tämä ei
  ole atominen elossaolotakuu. Tällainen in-flight-luonti kuuluu jo Jobiin,
  menettää jatkamisoikeuden ja kulkee nykyisen varmennetun tree-stopin kautta.
  Tulos on työkuorman virhe ja erillinen cleanup, ei onnistunut käynnistys.
- Havaitsijan ja native-omistajan alkuperäiset sulkeutumisehdot vaaditaan
  edelleen. Säilytetty peer-kahva ei korvaa Playwrightin streamien sulkua,
  eikä Node-havaitsija korvaa native-omistajan työkuormatodistetta.
  Puuttuvan EXE:n failed-spawn-olio ja jo luodun bridgen kato ovat eri tiloja.

Tämä rajaus koskee luotetun testiharnessin instanssien erottelua, ei
vihamielisen saman Windows-käyttäjän prosessin turvallisuuseristystä.
Mekanismin täytyy hylätä vaihdetut pipe-peerit, toistettu rekisteröinti,
vaihdetut output/error-roolit, vanha haaste, luontiaikaristiriita,
kahvan hankinnan epäonnistuminen ja
bridge-exit kaikissa GO/luonti/resume-rajoissa. Menettelyn toteutus ja testaus
on hyväksytty, mutta lähdekatselmus ei itsessään ole prosessi-identiteettitodiste.

Ennen tavallisen fixturen siirtoa vaaditaan katselmoidut sopimustestit
puuttuvalle/monistetulle/myöhäiselle havainnolle, callback-virheelle,
kahdelle rinnakkaiselle launch-kontekstille, stop/GO-kilpailulle sekä
versio- ja instanssiristiriidalle. Oikea Windows-koe kattaa bridgen kadon
ennen yhteyttä ja rekisteröinnin jälkeen ennen GO:ta, normaalin Page/API-
polun, launch-/connect-/window-virheet, relaunchin ja toisen instanssin.
Caller-loss ja native-owner-loss vaativat itsenäisen näyttönsä: kutsujan
mukana kuoleva havaitsija ei ole niiden siivoustodiste. Nykyiset neljä
adapterikoetta, suorat Electron-kuluttajat, T1/T2 ja normaali CI säilyvät.
Koko T3:n [valmistumisportti](#t3n-lopullinen-hyväksyntänäyttö) ei pienene.

Nykyisen kuluttajan muutosraja on pieni: havaitsija kuuluu
`apps/e2e/src/environment`-alueelle ja native-protokolla nykyiseen palvelu-
omistajaan. `isolatedElectronTest.ts` yhdistää nämä launch-/stop-polkuun;
`launchElectronRuntime.ts` säilyttää Page-/firstWindow-sopimuksen.
`ElectronApplication.process()` olisi bridgen, ei native-omistajan eikä
Electron-työkuorman kahva. Sitä ei saa käyttää työkuorman tila-, RSS- tai
puutodisteena. Moduulitestit käyttävät edelleen nykyistä fixture-rajapintaa.
Korvattu Windows-cleanup poistetaan vasta vastaavan kattavuuden jälkeen;
Linuxin vielä siirtämätöntä kuluttajaa ei samalla muuteta tai julisteta valmiiksi.

Omistajan hyväksyntä koskee yllä nimettyä sopimusta, ei väitettä, että
bridgellä olisi luontihetkestä säilytetty native-kahva. Muut T3:n avoimet
valinnat eivät ratkea tällä päätöksellä. Nykyinen cleanup-epävarmuus säilyy
avoimena, kunnes korvaava kytkentä on todennettu; sitä ei piiloteta
kirjaston lisäpatchilla.

**Rajattu toteutustilanne 2026-09-27:** havaitsijan 38 synteettistä
sopimustestiä, E2E-paketin tyyppitarkistus sekä nykyisen testituen 638
regressiotestiä läpäisivät. Native-sarjat läpäisivät 510/226/285/678
tarkistusta; viimeinen sisältää uudet peer- ja rekisteröintisopimukset.
Katselmuksessa löydetty viimeisen I/O-valmistumisen peruutuskilpailu on
korjattu ja testattu jokaisen kanavan luku- ja kirjoitusrajalla.
Version tarkistus vertaa sekä lukituksia että asennuksia erikseen
todennettuun Node/Playwright-sopimusversioon; pelkkä molempien päivittäminen
ei hyväksy uutta havaintorajapintaa. Aiempien tyyppivirheiden ensimmäinen
hylkäys säilyy erillisenä näyttönä, eikä sitä nimetä läpäisyksi.

**Saman omistajan kytkentä 2026-09-27:** nykyiselle palveluomistajalle on
lisätty rajattu Electron-bridge-profiili. Rekisteröinti etenee omistajan
sarjallisessa silmukassa; keskeneräinen yhteys tai haastevastaus ei estä
stop-pyynnön käsittelyä. Erillinen kertakäyttöiseen kuittaukseen sidottu GO
käyttää nykyistä Jobiin luontia ja ennen resumea tehtävää tarkistusta.
Nykyiset backend-, Vite- ja suoran Electron-käynnistyksen profiilit säilyvät.
Tiukka launch-kehys sallii vain tarkistetun Playwright-version eksplisiittisen
EXE-käynnistyksen argumentit, ei yleistä komento- tai ympäristörajapintaa.
Rekisteröinti käyttää alkuperäistä työmääräaikaa ja nykyistä siivousrajaa.

Katselmuksessa korjattiin virheen peittyminen stop-kilpailussa ja
mahdollinen päättymiskuittauksen uusinta epäselvän kirjoituksen jälkeen.
Valmistunut rekisteröinti- tai ohjauskanavavirhe tallennetaan ennen siivouksen
I/O:ta; myös myöhemmin valmistuva virhe säilyy erillään valmistumisen
todisteesta. Vain omistajan oman peruutuksen täsmällinen token hyväksytään
odotetuksi peruutukseksi. Output/error suljetaan vasta kyseisen välityksen
todellisen valmistumisen jälkeen, eikä pääprosessin poistuminen peitä
virheellistä ohjauskehystä. Päättymisviestin yritys kirjataan ennen
kirjoitusta: osittaista, epäonnistunutta tai onnistunutta viestiä ei uusita.

Uudet ja olemassa olevat native-sarjat läpäisivät 515/226/285/1457 tarkistusta;
nykyisen testituen regressiosarja läpäisi 638/638 ilman ohituksia.
Rajattu oikeaprosessikoe läpäisi pysäytyksen ennen rekisteröintiä,
yhteyttä odottaessa ja kolmen yhteyden muodostuttua ennen launch-kehystä.
Kaikissa työkuorma jäi luomatta, terminal todisti suljetun luontivaiheen
ja tyhjän puun, ja omistajan sulku todennettiin saman siivousrajan sisällä.
Koe ei lähettänyt GO:ta eikä todistanut bridge-peerin identiteettiä.

**Bridge-asiakkaan ja kutsujan kytkentä 2026-09-27:** lapsiton native-bridge
ja Node-kutsuja käyttävät nyt samaa palveluomistajaa. Julkinen Playwright-
launch jää odottamaan rekisteröintiä ja GO:ta; havaitsija säilyttää oikean
ChildProcess-olion. Tavallista fixtureä tai suoria Electron-kuluttajia ei
ole vielä siirretty. Moduulitesteihin ei lisätä prosessienhallintaa.

Omistajan ennen konfiguraation lukua aloittama monotonic-kello viedään
bridgeen rajattuna QPC-määräaikana ennen sen ensimmäistä yhteyttä.
Node-kutsujan alkuperäinen työraja vain lyhentää omistajan rajaa.
Bridgen konfiguraation luku ja pipe-yhteyden muodostaminen kuluttavat samaa
budjettia; stop välittää alkuperäisen siivousrajan, ei uutta odotusaikaa.
Kello-, generaatio-, nonce- tai kehysristiriita hylätään.

Katselmus tarkensi päättymiskehyksen jälkeistä luku- ja sulkusopimusta:
osittaisen kehyksen peruutus ei muutu onnistumiseksi, ja native-omistajan
oman datavälityksen päättyminen ei yksin todista bridgen stdout/stderr-
välityksen päättymistä. Omistaja käyttää jo säilytettyä read-only-peer-
kahvaa sulkukilpailun todentamiseen, ei uutta PID-hakua. Kutsuja vaatii
bridgen todellisen sulun ja sen exit-koodin vastaavuuden työkuorman
todelliseen exit-koodiin. Launch-virhe ja puun poissaolon näyttö säilyvät
erillisinä; onnistunut cleanup ei tee epäonnistuneesta launchista onnistunutta.

Native-sarjat läpäisivät 515/226/285/1791 tarkistusta, E2E-paketin
tyyppitarkistus ja testityökalujen regressiot 638/638 läpäisivät.
Olemassa olevien palveluomistajien ja uuden bridge-istunnon kohdesarja
läpäisi 134/134. Ensimmäinen kohdeajo paljasti suoran backend-profiilin
myöhäisen yhteyden hylkäyksen regression. Se korjattiin rajaten odotus vain
avoimeen bridge-käynnistykseen; vanha regressiotesti säilyi muuttumattomana
ja uuden istunnon vastaava hylkäys lisättiin. Ensimmäinen hylkäys säilytetään.

Yksi rajattu oikea Windows-koe läpäisi ensimmäisellä yrityksellä:
rekisteröinti/GO, oikean sovellusikkunan ja API:n käyttö, julkinen sulku,
bridgen sulku, työkuorman exit-koodin vastaavuus sekä saman omistajan
terminal-kuittaus tyhjästä Job-puusta ja valmistuneesta stdio-välityksestä.
Portin vapautuminen tarkistettiin erikseen. Riippumaton takaisinluku
vahvisti lähde- ja tulossidonnan. Tämä on normaali Page/API-polku, ei
negatiivisten peer-vaihtojen, caller-/owner-lossin, relaunchin, toisen
instanssin, tavallisen fixturen tai koko CI:n hyväksyntä.

Saman kytkennän kaksi varhaista virhekoetta läpäisivät ensimmäisellä
yrityksellä: virheellinen bootstrap torjuttiin ennen bridgen pipe-yhteyttä,
ja autentikoitu bridge poistettiin rekisteröinnin jälkeen ennen GO:n
välittämistä. Molemmissa alkuperäinen Playwright-hylkäys säilyi, GO:ta ei
välitetty, työkuorma jäi luomatta ja native-terminal, ohjauskanavan sulku
sekä bridgen ja omistajan todellinen sulku todensivat siivouksen erikseen.
Stopin operational-hylkäystä ei muutettu onnistumiseksi puun poissaolon
perusteella. Jälkimmäinen koe kattaa pidätetyn GO:n, ei native-omistajalle
jo saapuneen GO:n kilpailua. Ensimmäinen kattaa bootstrapin aiheuttaman
poistumisen, ei ulkoista tappoa täsmällisessä ennen-yhteyttä-rajassa.

Seuraavat kaksi kappaletta kuvaavat lisäpatchia edeltävää historiallista
rajaa. Ne eivät kumoa alla kirjattua lopetuspatchin ja ikkunakokeen uutta
hyväksyntänäyttöä.

Varhainen Playwright-hylkäys saattoi käynnistää kirjaston oman
PID-pohjaisen `taskkill`-polun jo poistuneelle bridgelle. Sen tulos ei ole
poissaolon todiste eikä poista PID:n uudelleenkäytön kohdistusriskiä.
Yllä hyväksytään vain kaksi täsmällistä hylkäys- ja siivoustulosta;
kirjaston tämä ohjausraja jää ratkaistavaksi ennen fixture-siirtoa.
Uutta riippuvuuspatchia tai poikkeusta ei hyväksytä koetuloksen perusteella.

Ikkunavaiheen koetta ei ajettu: jo suljetun sovelluksen palauttaminen
kutsujalle voi epäonnistua jo process-kahvan luvussa tai jäädä odottamaan
tulevaa ikkunatapahtumaa. Se ei luotettavasti todista tarkoitettua
firstWindow-virhettä. Seuraava työ on rajata tämä koe todelliseen odottavaan
ikkunavaiheeseen, jatkaa relaunch-/toinen instanssi-/katkeamisnäyttöön ja
vasta sitten pääfixturen siirtoon. Alemman tason näyttö tai normaali sulku
ei sulje T3:a.

###### Electron-bridgen lopetuspolun jatkoehdotus

**2026-09-27: rajattu lisäpatch, ikkunapidätys ja tavallisen Windows-Electron-
fixturen kytkentä paikallisesti todennettu; koko T3 avoin.** Omistajan hyväksyntä koskee alla kuvattua
`playwright-core@1.62.1`-lisäpatchia, sen regressioita sekä aitoa ikkunavaiheen
odotusvirheen koetta. Neljä oikeaa Windows-koetta on takaisinluettu
hyväksytysti; tarkka näyttö ja sen rajat ovat jäljempänä. Sama jatkolupa
sallii nykyisen T3:n loppuun viemisen ilman uusia välivaiheiden lupakysymyksiä;
uusia riippuvuuksia tai nykyisestä suunnitelmasta poikkeavaa arkkitehtuuria
ei lisätä. Goal on aktiivinen takaisinluvun perusteella. Tämä rajattu
hyväksyntä ja jäljempänä kirjattu tavallisen fixturen 45/45 eivät hyväksy
koko virhematriisia, endurancea, koko T3:a tai uuden revision etä-CI:tä ja
PR/main-integraatiota.

Alla oleva tutkimus on muutosta edeltävää historiallista näyttöä:
Muuttumattoman, tiivisteellä sidotun Playwright 1.62.1 -bundlen neljä
hallittua tutkimustapausta läpäisivät odotetun nykykäyttäytymisen.
Oikeaa prosessia ei käynnistetty tai lopetettu: käynnistys-, lopetus- ja
siivousrajat korvattiin inerteillä testivastauksilla, mutta tutkittu
`launchProcess` oli asennetun kirjaston toteutus.

Sekä exit-koodilla että signaalilla päättynyt lapsi ennen `close`-tapahtumaa
päätyi PID-pohjaiseen `taskkill /T /F` -haaraan. Jo toimitettu `close` esti
sen; elävän lapsen kontrollitapaus käytti samaa lopetuspolkua.
`kill()`-lupaus odotti edelleen sulkua ja hakemistosiivouksen valmistumista.
Tämä on ohjausvirran todennus, ei onnistunut korjaustesti, väärän prosessin
lopettamisen havainto tai todellisen Windows-puun poissaolon näyttö.

Toteutettu korjaus on nykyisen versionoidun riippuvuuspatchin
eksplisiittinen, vain Windowsin lapsittomaan testibridgeen valittava
prosessikohtainen lopetustapa. Tavallisen Electron-launchin, selainten ja
muiden alustojen oletukset säilyvät. Nimen, ympäristömuuttujan, PID:n tai
havaitsijan tekemän olion muokkauksen perusteella tilaa ei päätellä.

- Julkisen `Electron.launch`-kutsun `windowsProcessOnly?: boolean` kulkee
  protokollan valinnaisena booleanina palvelinpuolen kautta sisäiseen
  prosessikäynnistimeen. Arvo `true` hyväksytään vain Windowsissa
  eksplisiittiselle absoluuttiselle `.exe`-polulle ilman shelliä.
  Väärä tyyppi tai virheellinen opt-in-yhdistelmä hylätään ennen prosessin
  tai temp-juuren luontia; sisäinen käynnistin torjuu myös ei-Windows- ja
  shell-yhdistelmän ennen spawnia. Puuttuva tai `false` säilyttää oletushaaran.
  Pelkkä tuntemattoman kentän lisääminen kutsuun ei toteuta tätä ketjua.
  Kutsujan esiehto tarkistaa hyväksytyn patchatun bundlen tiivisteen ennen
  omistajan tai bridgen käynnistystä: sama versionumero vanhoissa tavuissa
  ei riitä, koska tuntematon valinta voisi muuten kadota protokollassa.
- Vain tässä tilassa kirjasto käyttää käynnistämänsä `ChildProcess`-olion
  julkista `kill('SIGKILL')`-metodia, ei PID-pohjaista työkalua. Projektin
  lukitun Noden Windows-toteutuksessa se käyttää luontihetkestä säilytettyä
  libuv-prosessikahvaa sen ollessa vielä saatavilla. Node vapauttaa kahvan
  ennen `exit`-tapahtumaa; exit-before-close voi siksi palauttaa `false`.
  Tämä ei ole POSIX-alustoja koskeva takuu.
- `false`, poikkeus tai virhetapahtuma ei oikeuta PID-fallbackiin eikä ole
  sulkeutumiskuitti. Myöskään `true` tai `killed` ei todista poistumista:
  todellinen `close`, kanavien valmistuminen ja erillinen native-omistajan
  puutodiste vaaditaan edelleen alkuperäisten määräaikojen sisällä.
  `false` kirjataan `windowsProcessOnlyKillNotDelivered`-merkkinä; nykyinen
  kill-virheen catch/log ei saa tuottaa synteettistä sulkua tai onnistumista.
- Bridge pysyy lapsittomana; nykyinen native-omistaja vastaa yksin
  Electronin ja backendin Job-puusta. Havaitsija säilyy passiivisena.
  Ensimmäinen käynnistysvirhe ja epävarma cleanup pysyvät erillisinä.

Pelkkä `exitCode`-tarkistus ennen nykyistä PID-komentoa ei sulje tarkistuksen
ja lopetuksen välistä kilpailua. Kaikkien Windows-kuluttajien muuttaminen
prosessikohtaisiksi voisi jättää niiden jälkeläiset eloon. Oma rinnakkainen
Electron-käynnistin tai private-API ei ole tämän rajatun muutoksen vaihtoehto.
Uutta pakettia, versiota tai transitiivista riippuvuutta ei tarvita, mutta
patchin ylläpitovastuu kasvaa: tyypitys, protokolla, kirjaston eri
lopetuspolut ja Node-kahvasopimus tarkistetaan jokaisella päivityksellä.
Omistajan nimenomainen hyväksyntä tälle lisäykselle on kirjattu yllä.

Kontrolloidut regressiot todentavat todellisten, digest-varmennettujen
patchattujen tavujen oletuskäyttäytymisen, saman version vanhojen tavujen
torjunnan ja julkisen opt-in-ketjun: elävä lapsi, exit ennen closea,
jo suljettu lapsi, epäonnistuva kill, graceful-close-virhe, toistuva sulku
sekä kutsujan signaali-/exit-haarat. Yksikään opt-in-haara ei saa palata
PID-lopetukseen; oletusten ja aiemman virhepatchin regressiot säilyvät.
Provenanssitesti palauttaa vain uudet opt-in-hunkit kääntämällä täsmälleen
aiemman patchatun bundlen ja säilyttää siitä alkuperäisen selector-deltan
käänteistodisteen. Kumpaakaan historiallista digestia ei hyväksytä runtimeen
eikä historiallisia tavuja evaluoida. Inertti harness ei käynnistä prosesseja
eikä tee tutkittavan koodin tiedosto- tai verkkosivuvaikutuksia.

**Ikkunavaiheen toteutettu koesopimus:** olemassa olevaan E2E-only-
käynnistysasetukseen on lisätty suljettu `pendingFirstWindow`-odotustila `app.whenReady()`-
vaiheen jälkeen ennen compositionia. Julkinen `evaluate()` lukee nykyisen
testiohjaimen kautta `hold: { held, runtimeInstanceId }` -pidätyksen,
runtime-identiteetin sekä nolla ikkunaa ja backend-käynnistystä.
Kokeen yksityinen Proxy kutsuu oikeaa julkista `firstWindow()`-metodia,
liittää alkuperäiseen promiseen vain passiivisen virhehavainnon ja palauttaa
täsmälleen saman promisen muuttumattomana. Snapshot käynnistyy vasta aidon
kutsun jälkeen. Havainto vaaditaan todelliseen ikkunaodotukseen
siirtymisen jälkeen mutta ennen sen valmistumista. Julkista waiter-asennuksen
kuittausta ei ole: ketju perustuu lukitun kirjaston synkroniseen odotuksen
rekisteröintiin, sen jälkeen ajoitettuun julkiseen arviointiin ja lopulliseen
aitoon virheeseen. Ennen odotusta vaaditaan alkuperäisessä omistajan
työbudjetissa tilaa nykyiselle ikkunaodotukselle ja graceful-close-varalle;
riittämätön budjetti hylkää kokeen eikä aloita uusia määräaikoja.
Muuttumaton `launchElectronRuntime` odottaa julkista `firstWindow()`-kutsua
nykyisellä aikarajallaan. Testi vaatii sen todellisen timeout-hylkäyksen ja
yksityisesti säilytetyn alkuperäisen `TimeoutError`-virheen; ulomman määräajan
tai ennen odotusta suljetun sovelluksen virhe ei kelpaa. Järjestys on
todellinen timeout, rajattu julkinen `application.close()` ja vasta sitten
omistajan stop sekä riippumaton puun ja bridgen sulkutodiste. Epäonnistunut
graceful close jää erilliseksi virheeksi, vaikka omistaja siivoaisi puun.
Julkinen `close`-kuuntelija asennetaan heti sovelluksen saannista ennen
budjettitarkistusta ja ikkunaodotusta, ja poistetaan vasta owner-stopin
jälkeen. Täsmälleen yhden tapahtuman pitää osua järjestykseen
`closeStarted <= closeEvent <= closeCompleted <= ownerStopStarted`;
jo suljetun sovelluksen onnistuva close-kutsu ei kelpaa todisteeksi.
Julkisen close-kutsun nykyinen 15 sekunnin katto rajataan jäljellä olevaan
alkuperäiseen työaikaan. Kokeen deadline-sovitin saa vain lyhentää
kutsukohtaista kattoa, ei uudistaa budjettia.
Virheen jälkeen todistetaan siis saman omistajan cleanup erikseen. Ei uutta
pidätyksen vapauttavaa ajastinta, tuotantohookia, palautettua valevirhettä tai
testin ohitusta.

**Patchin ja ikkunavaiheen aiempi hyväksyntänäyttö 2026-09-27:** havaitsijan ja bridge-istunnon kohdesopimukset
läpäisivät 82/82. E2E-työkalusarja läpäisi 678/678 sisältäen asennetun bundlen
regressiot ja 38 uutta prosessikohtaista lopetustestiä. Kanoninen E2E-valmistelu läpäisi native-sarjoin
515/226/285/1791. Lähdetilaan sidotut koko workspacen testit ja tyyppitarkistus
läpäisivät: API 144, permissions 6, desktop 1550 ja 253 Node-testiä,
E2E-työkalut 678, auth 12, web 665 sekä backend 1352. Desktopin kolme ja
backendin viisi ennestään alustakohtaista ohitusta säilyivät; uusia
ohituksia ei lisätty. Paikallinen `test:ci` läpäisi 315/315 ilman ohituksia
tai hylkäyksiä. Se todistaa CI-sopimukset, ei uutta etä-CI-ajoa.

Riippuvuusauditissa ei ollut tunnettuja löydöksiä, registry-allekirjoitukset
varmistettiin 160/160 ja frozen/offline-asennus läpäisi. Lockfile muuttui
vain kolmessa patch-hash-viitteessä; riippuvuusversiot sekä LICENSE/NOTICE
säilyivät. Staged backendin sisältöportti vahvisti testityökalujen poissulun.
Ensimmäinen sisältötarkistus hylättiin tarkistimen väärän schema-oletuksen
vuoksi; korjattu tarkistin läpäisi erillisen tarkistuksen. Ensimmäinen
hylkäys säilyy, eikä tarkistinkorjausta nimetä runtime-korjaukseksi.
Samoin ensimmäisen työkalusarjan provenance- ja komentoluettelohylkäykset
säilyvät: rajatut testikorjaukset säilyttivät vanhojen digestien torjunnan
ja alkuperäisen selector-todisteen ennen hyväksyttyä sarjaa.

Uudella patchilla tehdyt neljä oikeaa Windows-koetta läpäisivät ensimmäisellä
yrityksellä: ensin normaali Page/API/sulku ja kaksi varhaista virhepolkua,
sitten erillinen aidosti odottavan ikkunan timeout-koe. Ajot eivät olleet
päällekkäisiä. Riippumaton takaisinluku vahvisti lähdesidonnan, alkuperäiset
virheet, bridge-exit/close-havainnot, native-puutodisteen ja portin
vapautumisen. Varhaisvirheissä GO:ta ei välitetty eikä työkuormaa luotu;
stopin operational-hylkäys säilyi onnistuneesta siivouksesta erillään.
Ikkunakokeessa launch valmistui, pidätys ja runtime-identiteetti täsmäsivät,
ikkuna- ja backend-määrät olivat nolla ja alkuperäinen julkinen
`TimeoutError` säilyi `firstWindow`/`timeout`-vaiheena. Todellinen
close-tapahtuma edelsi owner-stopia; bridge ja työkuorma päättyivät
onnistuneesti, eikä graceful-close- tai cleanup-virhettä ollut.
Koelähteen myöhempi pelkkä pending-konfiguraation hash-rivin lisäys on
erotettu aiemmasta lähdehashista täsmällisellä käänteistarkistuksella;
alkuperäisiä lähdesidontoja tai tuloksia ei korvattu.

**Sukupolvien ja katkeamisten hyväksyntänäyttö 2026-09-27:** erillisten
restart/relaunch- ja toinen instanssi -kokeiden toiset yritykset on
takaisinluettu hyväksytysti, kumpikin yhdellä testiyrityksellä. Restart/relaunch
todensi ennen seuraavaa käynnistystä edellisen ownerin, bridgen ja portin
poissaolon, runtime-/omistaja-/session-identiteettien vaihtumisen, vanhan
session 401-hylkäyksen, pysyvän testidatan ja relaunch-kuittauksen.
Toinen instanssi päättyi oman täsmällisen omistajansa alla muuttamatta
pääinstanssin identiteettiä, toimivaa UI/API-yhteyttä tai yhtä backendia ja
ikkunaa. Restartin ensimmäinen yritys hylättiin, koska tarkistin odotti
observer-stopin jälkeen virheellisesti `null`-tilaa tarkoituksellisen
`stopped`-tilan sijaan. Toisen instanssin ensimmäinen yritys hylättiin
suoran profiilin puuttuvien rekisteröinti-/bootstrap-kenttien väärän
`null`-odotuksen vuoksi. Alkuperäiset lähdesnapshotit ja hylkäykset säilyvät;
korjatut tarkistimet ja uudet tulokset eivät muuta ensimmäisiä hyväksytyiksi.

Owner-lossin ensimmäinen ja caller-lossin toinen erillinen yritys on
takaisinluettu hyväksytysti. Owner-loss käytti vain säilytettyä elävän
omistajan lapsiprosessikahvaa: todelliset owner-, bridge- ja sovelluksen
close-havainnot edelsivät eksplisiittistä stopia, joka jäi oikein
`cleanupUnverified`-virheeksi. Äkillisen caller-lossin todellinen yhden
yrityksen worker-crash ja CLI-hylkäys säilyivät hylkäyksinä. Kummankin
kokeen hyväksyntä vaati erillisen ulomman omistajan `naturalExit`-todisteen:
juuri poistunut ja aktiivinen koko puu tyhjä ennen ulomman cleanupin
terminate-haaraa, ei interventiota, ulkopuolinen sentinel ennen/jälkeen ja
suljettuna sekä vapautunut portti. Tämä ei muuta sisemmän testin odotettua
virhettä onnistumiseksi.

Äkillinen kutsujan kato ei ole kooperatiivisen caller-EOF:n koe: kuolleelta
sisäomistajalta ei vaadita terminal-tiedostoa ulomman puutodisteen tilalle.
Vain tiedoston stat-luvun `ENOENT` sallii puuttumisen diagnostisena tilana;
olemassa olevan kuitin luku, JSON, schema, identiteetti ja tilat tarkistetaan.
Caller-lossin ensimmäinen yritys jäi hylätyksi raportin ANSI-muotoilun
tarkistimeen; jälkimmäinen sentinel-haaste ja porttitodiste puuttuivat.
Myöhempi onnistuminen ei hyväksy sitä jälkikäteen. Toisen yrityksen
alkuperäiset lähteet arkistoitiin ennen erillistä olemassa olevan JSON-`null`-
kuitin hylkäyskorjausta; korjausta ei nimetä uudeksi ajotulokseksi.

**Tavallisen fixturen nykyinen paikallinen hyväksyntä:** Windowsin
`isolatedElectronTest` säilyttää bridge-/native-omistajan ennen launchin
odotusta ja käyttää samaa alkuperäistä elinaikaa restartien, relaunchien ja
toisen instanssin yli. Julkinen rajattu close ja omistajan stop ovat eri
vastuut; Windowsissa ei palata legacy-cleanupiin. Cleanupin tai portin
epävarmuus estää seuraavan sukupolven ja juuren poiston pysyvästi.
Alkuperäisen timeoutin suljettu syyluokka säilyy; synkroninen välimuistiluku
luokittelee oikeaa työkuormaa eikä bridgen PID:tä tai vasta siivouksessa
syntynyttä poistumista. Diagnostiikka ei lisää odotusta. Turvallisen
lifecycle-artifactin valinnainen ownership-kenttä ei muuta moduulitestin
fixture-rajapintaa eikä muiden alustojen launch-/cleanup-haaraa.

Samaan nykyiseen lähdetilaan sidotut E2E-tyyppitarkistus ja kohdesopimukset
186/186 läpäisivät, mukaan lukien yhteisen backend-/Vite-omistajan regressiot.
Kanoninen `e2e:electron` valmisteluineen läpäisi tavallisen
`electron-development`-projektin 45/45 ensimmäisellä yrityksellä ilman retryä,
flaky-tulosta tai ohitusta. Riippumaton takaisinluku vahvisti talletetun
diffin ja uusien tiedostojen lähdesidonnan sekä raportin täsmällisen
tapausjoukon tavallista inventaariota vasten. Sarja sisältää sekä sopimus-
että oikeita kuluttajatestejä, ei 45 erillistä prosessikoetta. Aiemmat neljä
kohdennettua kuluttajatestiä edelsivät diagnostiikkakorjausta; ne ja yllä
kuvattu patchivaiheen workspace-/työkalunäyttö eivät ole tämän revision
uusinta-ajoja.

**Todellisen fixturen epävarmuus ja handoff:** erilliset rajatut kokeet
käyttävät muuttumatonta `isolatedElectronTest`-fixtureä ja oikeaa sovellusta.
Toisessa julkinen close raportoi virheen vasta oikean sulun jälkeen; toisessa
testin oma loopback-palvelin estää portin vapautumisen. Molemmissa myös
toinen restart torjutaan alkuperäisellä suljetulla virhekoodilla sen jälkeen,
kun sovellus ja portti ovat jo vapaat. Uutta omistajasukupolvea ei synny,
testijuuri säilyy myös todellisen teardownin jälkeen, ja teardownin
täsmällinen cleanup-hylkäys säilyy testiraportissa. Native-puun poissaolo,
bridgen täsmäävä sulku, puuttuva erillinen owner-/launch-virhe, ulomman
session puutodiste, sentinel ja portti tarkistetaan erikseen. Kyse ei ole
native-stopin epäonnistumisen simuloinnista tai CLI-virheen yleisestä
hyväksymisestä. Close-kokeen kolmas ja porttikokeen ensimmäinen yritys
läpäisivät, ja riippumaton takaisinluku hyväksyi niiden lähdesidonnat ja
todisteet. Ensimmäinen close-yritys hylättiin liian laajassa testiapurin
tiedostohaussa ennen faultia; toinen raportin lähdekoodikehyksen
virheellisessä tekstivertailussa. Ne ja alkuperäiset lähdesidonnat säilyvät
hylättyinä; vain nämä rajatut koeapurin virheet korjattiin ennen uusintaa.

Binary-handoffin lapsiton testiapuri käyttää olemassa olevaa rajattua
prosessinlopetusta, säilytettyä lapsikahvaa ja todellista `exit`-/`close`-
havaintoa. Alkuperäinen viiden sekunnin testiraja säilyy; neljän sekunnin
työ ja yhden sekunnin siivous jakavat saman rajan. Normaali release,
assertion, timeout, abort, väärä release ja stdin-kirjoitusvirhe on
todennettu kuudessa oikeaprosessitapauksessa. Kohdesarja 24/24 läpäisi,
ja riippumaton katselmus sekä lähdesidonnan takaisinluku hyväksyivät sen.
Tuotannon handoffiin, asennukseen tai sovellukseen ei tehty muutosta.

**Korvatun Windows-polun poisto:** `runBoundedWindowsTaskkill` ja sen kolme
korvattua sopimustestiä on poistettu. `stopManagedProcessTree` torjuu nyt
Windows-kutsun ennen pääprosessin tilan tai PID:n lukemista, myös jo
poistuneelle tai syntymättömälle lapselle. Backend, Vite ja Electron
käyttävät Windowsissa nykyistä omistajaa. Kahden lapsittoman process-output-
primitiivitestin cleanup käyttää vain niiden säilytettyä lapsikahvaa ja
rajattua todellista closea; tämä ei ole sovelluspuun fallback. POSIX-haara
säilyy ennallaan Linuxin hyväksyttyyn kuluttajasiirtoon asti.

Poistetun taskkill-apurin täydellisen sulun, timeoutin ja käynnistys-/owner-
virheiden korvaava kattavuus on `ownedWindowsBackend`-sopimuksissa.
Windows-kutsuportille lisättiin oma regressio; se on tarkoituksella vain
Windowsissa ajettava, ei Linuxin siivouksen onnistumisväite. Poiston jälkeen
E2E-tyyppitarkistus ja kanoninen `e2e:system` valmisteluineen läpäisivät
607/607 ensimmäisellä yrityksellä, ilman retryä, flaky-tulosta tai ohitusta.
Riippumaton takaisinluku vahvisti lähdediffin ja uudet tiedostot sekä kaikki
40 system-testitiedostoa ja korvaavan kattavuuden; vain ajon jälkeiset
dokumentointimuutokset erotettiin lähdevertailusta.
Tämä on poiston jälkeinen Windows-system-näyttö; aiempaa 45/45 Electron-
ajoa ei nimetä saman myöhemmän revision uusinta-ajoksi.

Jäljellä ovat erillinen endurance nykyisellä riskikadenssilla sekä muut
lopullisen matriisin portit. Endurance ei ole jokaisen checkpointin uusinta.
Nämä rajatut paikalliset hyväksynnät eivät sulje
[lopullista T3-matriisia](#t3n-lopullinen-hyväksyntänäyttö).
Chromiumin omistajuusvalinta ja Linuxin kuluttajasiirto/paikallisen tuen
ympäristöpäätös pysyvät erillisinä avoimina kohtina. Uuden revision etä-CI
sekä täsmälliset PR/main-portit ovat avoinna; historialliset timeoutit ja
niiden juurisyyt eivät ratkea tällä hyväksynnällä.

Lähdeperusta: projektin lukitun Noden
[ChildProcess-kill ja onexit](https://github.com/nodejs/node/blob/v24.19.0/lib/internal/child_process.js),
[ProcessWrap](https://github.com/nodejs/node/blob/v24.19.0/src/process_wrap.cc)
ja [libuv:n Windows-prosessikahva](https://github.com/nodejs/node/blob/v24.19.0/deps/uv/src/win/process.c).
Lähdetarkistus perustelee kahvasopimuksen, mutta ei korvaa yllä erikseen
kirjattuja patchin regressioita ja oikeaprosessinäyttöä.

Lähteet: [Noden Process-kanavien sopimus](https://nodejs.org/docs/latest-v24.x/api/diagnostics_channel.html#process)
ja [projektin lukituksen spawn-toteutus](https://github.com/nodejs/node/blob/v24.19.0/lib/internal/child_process.js).
Windowsin sidontarajat perustuvat [pipe-peerin PID-kyselyyn](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeclientprocessid)
ja [prosessikahvan ja PID:n eroon](https://learn.microsoft.com/en-us/windows/win32/procthread/process-handles-and-identifiers).
In-process-kontekstin lähde on tarkistettu asennettu Playwright-bundle;
ulkoinen dokumentaatio ei korvaa saman version kokeita.

Rajapintalähteet: [Electron launch](https://playwright.dev/docs/api/class-electron#electron-launch)
ja [Reporter](https://playwright.dev/docs/api/class-reporter). Lukittu
lähdekoodi omistaa version tarkan käyttäytymisen; verkkodokumentaatio ei
yksin todista korjauksen tai sulkeutumisen toimivuutta.

###### Windows Electron -valmistelun CI-hylkäys

**2026-09-28:** revision `4aececfd8a928075c195a4308850daed8748a18a`
[normaalin V2-ajon 36349083394](https://github.com/eky-software/eky/actions/runs/36349083394)
ensimmäisen yrityksen Electron-ryhmä hylättiin. 38 kriittisestä tapauksesta
14 läpäisi ja 24 pääfixturen tapausta epäonnistui valmistelussa sekä
ensiyrityksellä että CI:n ennestään määritellyssä retryssä. Nämä eivät ole
agentin käynnistämiä uusinta-ajoja. Paketointi, packaged smoke ja native-
valmistelu läpäisivät ennen tätä hylkäystä.

Kaikista 48 hylätystä yrityksestä säilytettiin turvallinen lifecycle-liite:
`playwrightConnect` epäonnistui tuntemattomalla syyllä, runtime-siivous jäi
varmentamatta ja testijuuri säilyi. Omistajuushavainto puuttui. Tämä rajaa
tutkimuksen ennen bridge-asiakkaan palautumista tapahtuvaan valmisteluun;
se ei yksilöi tarkkaa syytä eikä ratkaise historiallisia firstWindow-timeouteja.

Rajattu diagnostiikkamuutos välittää olemassa olevaan vaihehavaintoon vain
suljetut luokat: versio varmentamatta, omistajan valmistelu-, konfiguraatio-,
ympäristöarvo-, build- tai spawn-virhe sekä aiempi timeout/unknown.
Luokitus käyttää tyypitettyä valmisteluvirhettä ja täsmällisiä omistettuja
virhekoodeja, ei raakavirheen osittaista tekstihakua. Samat ympäristöarvon
koko-/NUL-rajat, launch-portit, määräajat ja epävarman siivouksen hylkäys
säilyvät. Polkuja, ympäristöarvoja tai yksityistä poikkeusta ei julkaista.

Riippumaton katselmus, tyyppitarkistus ja rajattu 98/98-sopimussarja
läpäisivät. Kahdeksan uutta
varhaisen hylkäyksen tapausta kytkee todellisen bridge-kutsujan virheen
launch-luokitukseen ja nykyisen lifecycle-writerin liitteeseen ilman
prosessien käynnistämistä. Tämä todentaa diagnostiikan, ei CI:n juurisyytä.

Revision `23b43c49` [rajattu ajo 36350757744](https://github.com/eky-software/eky/actions/runs/36350757744)
päättyi hylätyksi: kaikkien 48 lifecycle-liitteen tarkka syy on
`ownerEnvironmentValueInvalid`. Todellinen checkout varmennettiin lokista.
Diagnostiikan jälkimmäinen tarkistusvaihe ei käynnistynyt kriittisen sarjan
hylkäyksen vuoksi; sitä ei merkitä läpäistyksi. Alkuperäistä ympäristöarvoa
ei kerätty, joten yksittäistä CI:n muuttujaa ei voida nimetä varmasti.

Rajattu korjaus poistaa valinnaisen isäntäympäristön `PATH`-arvon perimisen
vain Windowsin `createElectronEnvironment`-apurista. Electron käynnistetään
validoidusta absoluuttisesta polusta, eikä sen utility-backend käytä
hakupolkua oman käynnistystiedostonsa löytämiseen. Linuxin nykyinen haara
säilyy. Windowsin 2048 merkin arvoraja, NUL-torjunta, sallitut avaimet,
profiilipolut, native-konfiguraation rajat ja alkuperäiset määräajat säilyvät
muuttumattomina; arvoa ei lyhennetä eikä hylkäystä muuteta onnistumiseksi.

Neljä generointi-/validointiregressiota kattaa tavallisen, liian pitkän
eri kirjainkoolla nimetyn, NUL-merkin sisältävän ja puuttuvan lähde-PATHin.
Ennen korjausta kolme hylättiin ja puuttuva arvo läpäisi; liian pitkä ja
NUL-arvo tuottivat saman tarkan ympäristövirheen. Korjauksen tyyppitarkistus
ja 102/102-kohdesopimukset sekä riippumaton katselmus läpäisivät. Tämä
todentaa synteettisen periytymisregression, ei jälkikäteen CI:n raakaa arvoa.
Tavallinen 45 tapauksen Electron-sarja päättyi 44/45-tulokseen:
`DESK-WORKSPACE-PASSWORD-001` hylättiin ennen testirunkoa vaiheessa
`firstWindow`, syy `processExited`. Tämä ei ole salasanadialogin testitulos.
Koko omistettu puu ja portti poistuivat varmennetusti. Ensimmäisen
epäonnistumisen liitteet säilytettiin. Tarkka käynnistyssyy jäi avoimeksi:
main-prosessin muistihavaintoa ei voitu enää lukea eikä backendin
`backend.started`-merkkiä ollut kaapatussa otteessa.

Rajattu testidiagnostiikan täydennys lukee olemassa olevan testinatiivi-
adapterin käynnistysvirheen ja virheikkunan suljetun syyluokan ennen
siivousta. Jokaisella runtime-sukupolvella on oma UUID:sta johdettu
havaintotiedosto; aiempaan yhteiseen tiedostoon ei palata. Luku rajautuu
testin omaan OS-temp-juureen, varmennettuihin hakemisto- ja tiedosto-
identiteetteihin, linkittömään tiedostoon, 64 KiB:iin ja 128 riviin.
Muuttunut tai turvaton lähde ei anna onnistunutta kaappausta. Julkiseen
lifecycle-liitteeseen viedään vain omistavan startup-suodattimen kiinteät
virhekoodit (vapaat smoke-päätteet supistetaan luokaksi), virheikkunan
syyluokat ja ennen cleanupia havaittu numeerinen exit-koodi tai `null`.
Raakatiedostoa, polkua, UUID:ta, tekstiä tai salaisuuksia ei julkaista.
Puuttuva havainto ei todista onnistumista. Diagnostiikka ei muuta alkuperäistä
virhettä, testiehtoja, cleanupia, määräaikoja tai moduulitestin rajapintaa.

Täydennyksen tyyppitarkistus, 136/136-kohdesarja ja riippumaton katselmus
läpäisivät. Katselmuksessa korjattiin exit-koodin rajaus: kelvollinenkin
koodi jää `null`-arvoksi, jos poistumista ei havaittu ennen omistajan
automaattista siivousta. Viisitoista uutta sopimusta sisältää todellisen
natiiviwriterin ja lifecycle-liitteen ketjun sekä tämän ajoitusrajan.
Kohdennettu restart-, boot-failure-, yrityksen vaihto- ja salasanan peruutus-
sarja läpäisi 4/4. Myös kanonisesti valmisteltu tavallinen Electron-sarja
läpäisi 45/45 ilman retryä, flaky-tulosta, ohitusta tai raporttivirhettä.
Takaisinluku vahvisti saman täydellisen tapausjoukon kuin aiemmassa
hylätyssä ajossa sekä tyyppitarkistuksen, kohdesopimusten ja Electron-ajojen
saman koodisisällön. Työkalusarja läpäisi 678/678 ja dokumenttilinkit 203/203.
Alkuperäinen poistuminen ei toistunut eikä sen syytä merkitä korjatuksi.
Paketin puhdas revisio `5f61f1863557f1e51b96cf705d9434feae91db8c`
läpäisi [normaalin V2-ajon 36354387346](https://github.com/eky-software/eky/actions/runs/36354387346)
ja [riippuvuustarkistuksen 36354390842](https://github.com/eky-software/eky/actions/runs/36354390842),
molemmat ensimmäisellä yrityksellä. V2:ssa 38 ryhmää läpäisi ja yksi
valinnainen koe ohitettiin tarkoituksella; kaikki neljä koevalitsinta olivat
pois. System valitsi 634 tapausta: 633 läpäisyä ja yksi tunnettu Windows-only-
suojan ohitus. Web 35/35 ja Electron 38/38 läpäisivät ilman retryä tai flakyä.
Täsmälliset tapausjoukot, checkoutit, neljän artifact-tuottajan ja kymmenen
kuluttajan sidonnat sekä lifecycle-tulokset takaisinluettiin. Native-portit
515/226/285/1791 läpäisivät; riippuvuusauditit olivat puhtaat ja registry-
allekirjoitukset 160/160 varmennettu. Tämä hyväksyy normaalin lähtöbaselinen,
ei aiemman poistumisen juurisyytä, endurancea tai koko T3/PR/main-porttia.

###### Windows Electronin endurance ja virheen säilymisen loppunäyttö

**2026-09-28: rajattu testikorjaus ja paikallinen loppunäyttö todennettu.**
Ensimmäinen normaali stress-ajo hylättiin tietokannan kokotarkistuksessa.
Testi mittasi vanhaa installation-scoped-tietokantapolkua, vaikka nykyinen
desktop käyttää aktiivisen workspacen runtimea. Myös salaisuustiedoston
poistotarkistus käytti vanhaa polkua. Mittauskorjaus käyttää olemassa olevaa
validoivaa `readElectronE2eActiveWorkspace`-apuria; operational-lokit pysyvät
asennuskohtaisina. Sovelluksen dataa, tuotantopolkuja, työkuormia,
määräaikoja tai hyväksyntärajoja ei muuteta. Regressio erottaa aktiivisen
työtilan vanhasta ja toisesta työtilasta, lukee valinnan uudelleen ja hylkää
virheellisen rekisterin ilman legacy-fallbackia. Tyypitys ja kolme
regressiotapausta läpäisivät. Korjatun kuluttajapolun kanoninen stress ja
täysi 30 minuutin soak läpäisivät ensimmäisillä yrityksillä ilman retryä,
flakyä tai raporttivirhettä. Koko alkuperäinen stress-työkuorma, soakin
täysi kesto, teardown ja raporttien lähdesidonta takaisinluettiin.
Vanha hylkäys säilyy; mittauskorjaus ei väitä ratkaisevansa aiempia
satunnaisia käynnistysvirheitä.

Alkuperäisen testivirheen ja cleanup-/näyttövirheen erillisyyden alempi
sopimus on jo testattu. Lopullinen T3-portti vaatii lisäksi kaksi rajattua
todellisen fixturen koetta: alkuperäinen testirungon virhe yhdessä oikean
sulun jälkeen palautetun close-virheen kanssa sekä alkuperäinen virhe
yhdessä lifecycle-liitteen julkaisuvirheen kanssa. Testirungon alkuperäinen
virhe saa säilyä ainoana varsinaisena testivirheenä; cleanupin ja erillisen
lifecycle-tiedoston tulokset tarkistetaan omista havainnoistaan. Oikea
omistajuus, ulomman session puun poistuminen, portti ja ulkopuolinen sentinel
säilyvät kokeiden ehtoina. Molemmat kokeet läpäisivät ensimmäisillä
yrityksillä: Playwright raportoi tarkoituksellisen alkuperäisen virheen
ainoana testivirheenä, ei onnistumisena. Close-virheessä runtime-sulku
jäi epävarmaksi ja testijuuri säilyi; liitevirheessä sulku valmistui,
testijuuri poistui ja erillinen lifecycle-tiedosto säilyi. Molemmissa
omistettu puu oli poistunut ennen ulomman omistajan pakkosiivousta,
portti vapautui ja sentinel säilyi; pakkotoimenpidettä ei tarvittu.
Tämä on rajattu todellisen fixtureketjun näyttö, ei kaikkien mahdollisten
levy- tai raportointivirheiden kattavuuslupaus. Ei kolmatta päällekkäistä
testialustaa tai tuotantokontrollia.

Mittauskorjauksen puhdas revisio `ab5de90bd28eda08cc5d871521a8a2d9f669deb3`
läpäisi [normaalin V2-ajon 36359605352](https://github.com/eky-software/eky/actions/runs/36359605352)
ja [riippuvuustarkistuksen 36359619205](https://github.com/eky-software/eky/actions/runs/36359619205),
molemmat ensimmäisellä yrityksellä. Kaikki 38 vaadittua ryhmää läpäisivät;
yksi valinnainen koe oli tarkoituksella pois käytöstä. System 637 valittua
(636 läpäisyä ja yksi tunnettu Windows-only-suojan ohitus), web 35/35 ja
Electron 38/38 todennettiin ilman retryä, flakyä tai raporttivirhettä.
Tarkat lähdekatalogit, todelliset checkoutit, neljä artifact-tuottajaa ja
kymmenen kuluttajaa sekä lifecycle-tulokset takaisinluettiin. Native-portit
515/226/285/1791 ja registry-allekirjoitukset 160/160 läpäisivät;
tuotanto- ja kokonaisauditissa ei tunnettuja löydöksiä.
Tämä yhdessä yllä rajatun paikallisen näytön kanssa sulkee Electronin
oikean kuluttajakohdan. Aiemmat hylkäykset ja ratkaisemattomat satunnaiset
virhesyyt säilyvät. Chromiumin/Linuxin päätösrajat, niiden kuluttajasiirrot
ja koko T3/PR/main-portti ovat edelleen avoinna tässä checkpointissa.
Seuraava 28.9. päätös ratkaisee päätösrajat, ei vielä näitä hyväksyntäportteja.

###### Chromiumin kuluttajasiirron avoin omistajuusraja

**2026-09-28: omistaja hyväksyi yhteisen worker-selaimen testikohtaisella
eristyksellä sekä paikalliset Windows-testit ja Linux-CI:n.** Valinta on
tehty; kuluttajasiirto ja sen hyväksyntänäyttö ovat kesken.
Alla oleva 27.9. valmistelu säilyttää päätöksen taustan.

Hyväksytty rajaus säilyttää worker-kohtaisen selaimen sekä jokaisen testin
omat context/page-oliot, datan, sessionin ja palvelut. Testin datajuuri
poistetaan vasta sen oman kontekstin, liitteiden ja palvelujen sulkeuduttua.
Selaimen erillinen synteettinen juuri poistetaan vasta omistetun koko puun
varmennetun päättymisen jälkeen. Viimeisen worker-siivouksen epäonnistuminen
hylkää ajon; yksittäisten testien vihreys ei korvaa puun poistumistodistetta.
Yhteys muodostetaan ennen testin trace-tallennusta julkisilla Playwright-
rajapinnoilla. Salainen ohjausosoite ei kuulu traceen, lokiin tai liitteeseen.
Alla täsmennetty määräaika- ja retry-sopimus ohjaa kytkentää.
Valinta ei hyväksy yksityistä instrumentointia,
riippuvuuspatchia, uusia aikarajoja tai uutta runneria.

Linuxin hyväksytty managerimekanismi siirretään oikeisiin CI-kuluttajiin.
Paikallisen Linux-/WSL-ajon tuki ei ole tämän T3:n hyväksyntävaatimus;
sen sijaan unsupported-ympäristö torjutaan selvästi ennen käynnistystä.
Hostin oikeuksia, palveluja tai suojausasetuksia ei muuteta. Korvattu
Linux-polku poistetaan vasta vastaavan CI-kattavuuden todennuksen jälkeen,
ei jätetä root-only-fallbackiksi. Sovelluskehityksen WSL-työkalukäyttöä
tämä E2E-ajoympäristön rajaus ei kiellä.

**Kuluttajatoteutuksen sopimus ja rajattu näyttö 28.9.:**

- Nykyinen yhden workerin ajotapa säilyy. Automaattinen worker-fixture
  avaa julkisen `BrowserType.connect`-yhteyden ennen testien tallennusta.
  Testin julkiset `context`/`page`-fixturet, asetukset ja moduulitestien
  rajapinta säilyvät; private-instrumentointia ei lisätä.
- Ensimmäinen Chromium-worker sitoo monotonic-kellon nykyiseen
  `globalTimeout`-kattoon. Tämä on omistajan turvakatto, ei väite CLI-ajon
  todellisesta jäljellä olevasta ajasta; Playwrightin oma alkuperäinen
  kokonaisaikaraja säilyy. Worker-käynnistys käyttää lisäksi nykyistä
  projektin testiaikarajaa, eikä uusinta luo uutta omistajan aikabudjettia.
- Ajokohtaisessa tuloskansiossa oleva keskeneräisen omistajuuden merkki
  estää korvaavan workerin, kun siivousta ei ole varmennettu. Vain saman
  omistajan todennettu siivous vapauttaa merkin. Uuden CLI-ajon tyhjentämä
  tuloskansio ei ole aiemman epävarman prosessipuun siivoustodiste.
- Julkinen kontekstin sulku odottaa Playwrightin trace-chunkin ja
  väliaikaisten virhekuvien keräyksen ennen testidatan poistoa.
  Raportin lopullinen yhdistäminen tapahtuu myöhemmin testidatan ulkopuolella.
  Kontekstin, palvelujen tai artifact-keräyksen epäonnistuminen estää
  testijuuren poiston; selaimen työjuuri vaatii erillisen puutodisteen.
- Windowsin suljettu Chromium-profiili käyttää samaa hyväksyttyä native-
  omistajaa. Ensimmäinen normaali web-käynnistys ja kahden todellisen testin
  eristys läpäisivät. Erillisessä tarkoituksellisessa virhe-/retry-kokeessa
  kuvakaappaus, trace, worker-vaihto, alkuperäinen omistajakello ja molempien
  workerien siivous todennettiin. Pakatut tallenteet ja raportti tarkistettiin:
  selaimen hallintayhteyden tallennusta tai ohjausosoitetta ei löytynyt.
  Tämä odotetun ensimmäisen virheen koe ei ole normaalin CI:n flaky-hyväksyntä.
- Tyypitys, native-profiilin 60 tarkistusta ja 71 kohdesopimusta läpäisivät.
  Uuden eristystestin ensimmäinen nimisopimukseen pysähtynyt ajo säilyy
  hylättynä; korjattu kahden tapauksen ajo läpäisi. Linux-kytkentä,
  kuluttajien laajempi virhe-/omistajuusmatriisi ja yhteinen CI ovat avoinna.
  Koko T3:a tai PR/main-porttia ei merkitä tällä valmiiksi.

**Saman kuluttajasiirron jatko 28.9.:** koko tavallinen Windows-web-sarja
läpäisi 43/43 ilman retryä (aiemmat 41 tapausta ja kaksi uutta eristystapausta).
Riippumaton katselmus hyväksyi artifact-/retry-näytön rajat mutta tunnisti
myöhäisen yhteyden ja epäonnistuneen sulkemisen regressioaukot. Niitä varten
Windows ja Linux käyttävät yhteistä `connectOwnedChromium`-vastuuta:
myöhäinenkin julkinen yhteys odotetaan suljetuksi saman omistajan alkuperäisen
cleanup-määräajan sisällä. Pelkkä `close`-kutsun ajoittaminen ei riitä.
Workerin todellinen suorituspolku on erotettu pieneksi testattavaksi
`runOwnedChromiumWorker`-funktioksi; moduulitestin rajapinta ei muutu.
Yhteys-, worker- ja admission-sopimukset läpäisivät 50/50 sekä tyypityksen.
Mukana ovat reject/throw/hang, myöhäinen connect, katkennut yhteys, toistettu
stop, alkuperäisen virheen säilyminen sekä juuren/varauksen säilyminen ja
uusinnan esto epävarmuudessa. Lisäregressio toisti normaalin owner-stopin
virheellisen tulkinnan aiemmaksi yhteyskatkoksi. Tila luetaan nyt ennen
omistajan tarkoituksellista sulkua; todellinen aiempi katkos hylätään edelleen.
Korjattu käynnistys ja kahden testin eristys läpäisivät oikealla selaimella
3/3. Tämän jälkeen sama yhteinen toteutus läpäisi koko tavallisen
Windows-systemin 689/689 ja webin 43/43 ilman retryä, flakyä tai ohituksia
sekä kanonisen system/web-stress-portin. Worker-siivous varmennettiin
ja selainjuuri poistettiin; aiempaa 43/43-tulosta ei käytetty myöhemmän
muutoksen hyväksyntänä.
Linuxin backend/Vite/Chromium-kytkentä ja valmistelun alemmat sopimukset
läpäisivät 734/734-työkalusarjan, mutta se ei ole oikeiden Linux-prosessien CI-näyttö.
Ensimmäisen testisimulaation polkuvirhe ja korjattu lähdetila pidetään erillään.
Yhteinen CI ja oikeiden Linux-kuluttajien näyttö ovat edelleen avoinna.

###### Chromiumin ja Linuxin ensimmäinen yhteinen CI

Revision `6e670190718ec6c73a2df13710945b1ef4729059`
[ensimmäinen normaali ajo](https://github.com/eky-software/eky/actions/runs/36419875442)
ei hyväksy kuluttajasiirtoa. Linux-system valitsi 689 tapausta:
648 läpäisi, 40 hylättiin ja yksi tunnettu Windows-only-suoja ohitettiin.
Kriittinen web valitsi 37 tapausta: 36 hylättiin ja yksi jäi sarjan
keskeytymisen vuoksi ajamatta. Virheet kohdistuvat oikeiden fixturejen
käynnistykseen. Pelkkä lyhyt kesto ei todista niiden täsmällistä syytä.
Turvallinen CI-reportteri tallensi tapausidentiteetit ja tulokset, mutta
ei tarkkaa käynnistyksen syykoodia. Linux-HTML-raporttia ei julkaistu
artifactina; tätä havaintoaukkoa ei saa nimetä puhtaaksi käynnistykseksi.

Rajattu havaintokorjaus tallentaa Linux-palvelun ensimmäisen epäonnistuneen
käynnistysvaiheen ennen siivousta ja julkaisee siivouksen jälkeen vain
suljetun `EKY_LINUX_SERVICE_FAILURE`-rivin. Profiili, vaihe, tunnettu syy,
mahdollinen tunnettu alitason syy/vaihe, spawn-havainto ja puun siivoustila
ovat ennalta sallittuja arvoja. Raakaviesti, prosessituloste, polku, session
tai ympäristöarvo ei kuulu riviin. CI-reportteri validoi rivin uudelleen,
kestää osittaiset tulostepalat ja hylkää ylimääräiset kentät. Raportin
kirjoitusvirhe ei korvaa alkuperäistä testivirhettä; rivin puuttuminen on
puuttuva havainto, ei onnistuminen. Tämä diagnoosi ei yksin ole omistajuuden
hyväksyntätodiste eikä muuta nykyistä `EKY_E2E_REPORT`-tulosskeemaa.
Todellisen testiajurin virhe-/retry-koe sekä alemmat elinkaari- ja
projektiotestit todentavat lukuketjun ilman oikean Linux-virhesyyn arvaamista.

Erillinen workspace-hylkäys oli olemassa olevan tukipaketin 25 MiB:n
kokonaisrajatestin aikakatkaisu. Sen rajattu korjaus koskee testiaineiston
rakennetta: samat todelliset osio- ja kokonaisrajat, suurimman mahtuvan
prefiksin säilyminen sekä checksumit todistetaan harvemmilla suuremmilla
merkinnöillä. Monen merkinnän osiorajatesti säilyy erillisenä. Tuotantokoodi,
kokorajat ja testiaikaraja eivät muutu. Korjaus tarvitsee oman kohdennetun
näytön, katselmuksen ja uuden revision CI-portin.

Kohdennettu arkistosarja 5/5, raportoinnin ja Linux-sessionin sopimukset
50/50 sekä koko workspace-testit ja tyyppitarkistus läpäisivät.
Riippumaton katselmus ei löytänyt avoimia korjaustarpeita. Tarkoituksellinen
ajurivirhe tapahtuu injektoidussa valmistelussa: se todentaa raportoinnin,
ei oikeaa Linux-käynnistystä tai sen virhesyytä. Uuden revision CI on vielä
avoin. Alkuperäinen normaali ajo päättyi hylättyyn tilaan; Electron 38/38
sekä kaikki neljä installer-artifactin tuottajaa ja kymmenen kuluttajaa
läpäisivät, mutta ne eivät korvaa hylättyjä Linux- ja workspace-portteja.

Saman revision [riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/36419886254)
läpäisi ensimmäisellä yrityksellä ilman tunnettuja löydöksiä; registry-
allekirjoitukset 160/160 tarkistettiin. Se ei korvaa hylättyjä testejä.
Ensimmäisen ajon virhetiedot säilyvät. Seuraava normaali CI käyttää rajattua
havaintoketjua Linuxin käynnistyssyyn selvittämiseen; se ei ole saman
revision sokkouusinta. T3/R28 ja PR/main pysyvät auki.

**Windowsin rajattu katoamis- ja artifact-näyttö 28.9.:** todellinen
worker-polku läpäisi erilliset native-omistajan ja kutsuvan Playwright-workerin
katoamiskokeet. Ulompi omistettu testisessio todensi koko puun päättymisen
ennen omaa loppusiivoustaan; selaimen loopback-portti vapautui ja
ulkopuolinen vertailuprosessi säilyi. Epävarma sisempi siivous ei muuttunut
onnistumiseksi: juuri ja keskeneräinen varaus säilyivät, eikä korvaava
worker saanut aloittaa. Sisemmän terminal-kuitin puuttuminen kirjattiin
puuttuvaksi, ei onnistuneeksi stop-kuittaukseksi. Kutsujan katoaminen
hylkäsi varsinaisen Playwright-ajon odotetusti ilman retryä.
Molempien kokeiden lähde- ja binaarisidonnat sekä lopputulokset
takaisinluettiin riippumattomasti.

Artifact-/retry-koe ajettiin uudelleen yhteisen sulkupolun jälkeisellä
toteutuksella. Odotettu ensimmäinen virhe, kuvakaappaus, uusinnan oikea
selaintrace, korvaava worker samalla omistajakellolla ja molempien puiden
varmennettu siivous todettiin. Ohjausosoite tai hallintayhteyden avaus ei
päätynyt tallenteisiin. Tämä on rajattu tarkoituksellisen virheen koe,
ei tavallisen CI:n flaky-hyväksyntä tai Linux-/T3-/PR/main-hyväksyntä.

Saman välipaketin koko workspace-testit ja tyyppitarkistus sekä
CI-sopimukset 315/315 läpäisivät. Workspacen kahdeksan ennestään
alustakohtaista ohitusta säilyi; uusia ohituksia ei lisätty. Seuraava portti
on tämän katselmoidun lähdetilan oma normaali CI, ei aiemman revision
vihreän tuloksen siirtäminen uudelle koodille.

**Valmisteluhistoria 2026-09-27:**
Nykyinen Playwright-selain on worker-kohtainen, mutta T3:n ehdotettu
puutodiste on testikohtainen. Ennen siirtoa pitää valita säilyykö jaettu
selain vai saako jokainen testi oman selainpuun. Tätä eroa ei ratkaista
hiljaisesti yhteisen fixture-rajapinnan sisällä.

Valmistelussa hylättiin oletus, että testin sisällä tehty `connect` olisi
turvallinen pelkällä lopullisen virheen sanitoinnilla: lukitun Playwrightin
API-tallennus voi kirjoittaa salaisen ohjausosoitteen traceen jo ennen
virheen käsittelyä. Tämä koskee ehdotettua testiliitosta, ei julkaistun
sovelluksen haavoittuvuutta. Private-instrumentointi, piilotettu
riippuvuuspatch tai artifactin jälkikäteinen siivous ei ole hyväksytty ratkaisu.

Valmisteltava vaihtoehto säilyttää nykyisen worker-selaimen, muodostaa
liitoksen ennen testikohtaista tallennusta ja erottaa selaimen oman
synteettisen juuren testien datajuurista. Testin juuren poisto vaatisi
sen kontekstin ja palvelujen sulun; selaimen juuren poisto vaatisi koko
omistetun puun varmennetun päättymisen. Viimeisen siivouksen epäonnistuminen
hylkäisi testiajon myös onnistuneiden testien jälkeen. Tämä on vielä ehdotus,
ei testikohtaisen puuvaatimuksen hyväksytty poikkeus.

Valinnan jälkeen täsmennetään alkuperäiset määräajat, retry-/worker-vaihdon
raja, hallintakanavan ja lokituksen suojaus sekä context/page- ja
trace/screenshot-kytkennän vastaavuus. Pelkkä lähdekoodin tarkastus ei
korvaa näiden todellista hyväksyntänäyttöä. Moduulikehittäjän Page/API-
rajapinta, T1/T2, nykyiset aikarajat ja selaimen turvallisuusasetukset
säilyvät. Electronin riippumaton valmistelu ja Linuxin erillinen
ympäristöpäätös eivät saa muuttaa tätä avointa valintaa.

##### T3c-LM: rajattu CI-testisession hallinta

Omistaja hyväksyi 2026-09-26 rajatun CI-testisession hallinnan suunnittelun
pohjaksi sekä jatkamisen toteutukseen ja Goalin loppuun ilman uusia
välikyselyjä tämän rajauksen sisällä. Edellinen päätöstä odottava tila on
historiallinen. Tämä ei hyväksy uusia riippuvuuksia, pysyvää palvelua,
runner-vaihtoa, hostin suojauspolitiikan muuttamista tai root-oikeuksin
ajettavaa Nodea, Playwrightia tai sovellusta. Vanha user-namespace-koe ja sen
hylätty näyttö säilyvät; LM ei muuta sitä onnistuneeksi tai skipiksi.

Rajattu mekanismi käyttää CI-runnerin valmista systemd-palvelunhallintaa,
cgroup v2:ta ja util-linux-työkaluja. Saatavuus ja valtuus todetaan ennen
käynnistystä, niitä ei asenneta tai korjata kokeessa. Omistaja saa luoda,
kysellä ja pysäyttää vain oman satunnaisen, kertakäyttöisen transient-unitin.
Työkuorma ei saa managerin kontrollikanavaa tai yleistä hallintavaltuutta.
Kyse on luotetun CI-testin prosessien elinkaaresta, ei vihamielisen saman
käyttäjätunnuksen rinnakkaisohjelman turvallisuuseristyksestä.

Toteutus- ja tarkistusjärjestys:

1. Puhtaat sopimustestit: kiinteä käynnistysketju, oikeuksien pudotus,
   suljettu unit-havainto, alkuperäinen määräaika ja virheellisten tai
   vanhentuneiden kuittien torjunta. Import ei käynnistä manageria.
2. Erillinen CI-only-ajuri ja private AF_UNIX -kontrollikanava. Tyyppi on
   `exec`, `ExitType=main`, `KillMode=control-group`, `Restart=no` ja
   `RemainAfterExit=no`. Namespace-initin odottava wrapper on main-prosessi.
   Nimetyn unitin `CollectMode=inactive` säilyttää failed-tilan havainnot;
   protokollan tarkoituksellista exit 41:tä ei lisätä systemd-success-listaan.
   Vain tarkasti sidottu `failed/failed`, `Result=exit-code`, `CLD_EXITED/41`
   voi olla odottavan wrapperin normaalin poistumisen osatodiste. Muut
   virheet eivät kelpaa. Ei stdout/stderr-protokollaa tai shell-komentoa.
3. Luotettu, kiinteä systemd -> unshare -> setpriv -ketju tekee vain
   mount-/PID-namespacen ja pudottaa identiteetin ennen ensimmäistä Node-execiä.
   Ei user-namespacea tai UID-mapin fallbackia. Init tarkistaa PID 1:n,
   kutsujan kaikki neljä UID/GID-arvoa, tyhjät lisäryhmät, `NoNewPrivs=1`
   sekä kaikki viisi nollattua capability-joukkoa, myös bounding-joukon.
   Vasta tämä ja saman unit-generationin käynnistyshavainto sallivat GO:n.
4. Normaalipolun näyttö erottaa työkuorman tuloksen, initin protokollan,
   odottavan wrapperin normaalin exitin ja managerin terminal-havainnon.
   [Kernelin namespace-teardown](https://github.com/torvalds/linux/blob/v6.8/kernel/pid_namespace.c#L160-L258)
   ja [unsharen wait](https://github.com/util-linux/util-linux/blob/v2.39.3/sys-utils/unshare.c#L936-L957)
   ovat reaping-perusta, eivät `populated=0`, root-exit tai unitin katoaminen.
   Credential-muutos voi poistaa PDEATHSIGin: `--kill-child` ei ole
   oikeuksien pudotuksen jälkeinen owner-loss-takuu.
   Katselmuksessa hylättiin `RemainAfterExit=yes`: systemdille puhdas
   SIGHUP voi jättää palvelun active/exited-tilaan ilman runtime-ajastinta
   ja pysäytyssiivousta. `RemainAfterExit=no` säilyttää pysäytyspolun myös
   puhtaan signaalin tapauksessa. Tämä perustuu
   [systemdin tilakoneeseen](https://github.com/systemd/systemd/blob/v255/src/core/service.c#L2032-L2062)
   ja [CollectMode-sopimukseen](https://github.com/systemd/systemd/blob/v255/man/systemd.unit.xml#L938-L952),
   ei vielä omaan oikeaprosessikokeeseen. Systemdin failed-tila tallennetaan
   sellaisenaan; vain erillinen testiprotokolla ratkaisee odotetun kokeen
   tuloksen. Receipt luetaan ennen oman unitin failed-tilan vapauttamista.
   Managerin `Result` voi säilyttää alkuperäisen exit-code-virheen myös
   cleanup-virheen yli: sitä tai failed-tilaa ei käytetä koko cgroupin
   tyhjyystodisteena. Unit-parseri todistaa vain nimetyn wrapperin poistumisen;
   ajuri yhdistää erikseen namespace-, protokolla- ja siivoushavainnot.
5. Private-kanavan katkeaminen ja riippumaton managerin runtime-/stop-raja
   sulkevat session myös kutsujan kadotessa. Wrapperin poikkeava päättyminen,
   aikaraja, tuntematon unit tai puuttuva havainto pysyvät hylkäyksenä.
   Alkuperäisestä monotonic-aloituksesta lasketut rajat eivät nollaudu
   managerikutsun tai credential-dropin kohdalla. Epävarmuus estää restartin
   ja testijuuren poiston. Ulkopuolinen sentinel säilytetään erillisenä.
   Managerin rajat (start 5 s, runtime 10 s, stop 1 s) ovat itsenäinen
   varmistus, eivät alkuperäisen absoluuttisen määräajan todiste:
   `RuntimeMaxSec` alkaa unitin aktivoitumisesta. Myöhäinen manager-cleanup
   voi rajoittaa vahinkoa, mutta ei antaa hyväksyntää tai juuren poistolupaa.
6. Katselmuksen ja kohdetestien jälkeen yksi seurattu rajattu CI-koe
   nykyisessä kadenssissa, ei vanhan kokeen automaattista uusintaa. Suljettu
   tulosskeema ja lukuketju valmistuvat ennen ajoa. Oikea system/web-
   integraatio, Chromiumin muuttumaton sandbox ja koko T3-matriisi vaaditaan
   ennen tavallisten fixturejen siirtoa ja R28:n hyväksyntää.

Managerin palveluasetukset estävät työkuorman kirjoitukset cgroup-hallintaan
ja suoran pääsyn managerin paikallisiin kontrollipolkuihin. NNP estää
execin kautta saatavan lisäoikeuden, mutta ei yksin estä ulkoisen palvelun
pyytämistä käynnistämään prosessia. Tätä ei saa kutsua yleiseksi sandboxiksi.
Kiinteät järjestelmäbinäärit, niiden root-omistus, todellinen unit-identiteetti,
ympäristön rajaaminen ja normal/owner-loss-polku tarkistetaan erikseen.
Uutta native-helper-riippuvuutta tai yleistä sudo-oikeusmuutosta ei tehdä.

Tämä vaihe on toteutuksessa, ei vielä oikeaprosessi-, CI- tai fixture-
hyväksyntä. Sovelluksen koodi, versio, business-data, tuotannon diagnostiikka
ja backup eivät muutu. Kokeen yksityinen näyttö ei kuulu tukipakettiin.

**Ensimmäinen sopimuscheckpoint (historiallinen):** kiinteän käynnistysketjun, oikeuksien
pudotuksen ja unit-havaintojen 11 puhdasta testiä sekä E2E-paketin koko
252 testin sopimussarja läpäisivät ilman ohituksia. Paketin tyypitys ja
168 dokumenttilinkkiä tarkistettiin. Riippumaton katselmus löysi yllä
kuvatun RemainAfterExit-riskin; korjaus ja regressio katselmoitiin uudelleen
ilman jäljelle jäänyttä löydöstä tässä rajatussa palassa. Tämä ei todista
managerin saatavuutta, kontrollikanavan toimintaa tai oikean prosessipuun
siivousta. Ajuria tai workflow-kytkentää ei ole vielä toteutettu eikä uutta
CI-koetta, palvelukutsua tai fixture-siirtoa tehty. Vanha LS-ajon hylkäys
säilyy hylkäyksenä; hyväksyttyä uutta CI-baselinea ei väitetä syntyneeksi.

**Toinen checkpoint: kontrollikanava ja nonroot-init.** Yksityisen
AF_UNIX-kanavan kuuntelija ja initin kytkentä on toteutettu erilliseen
koealueeseen. Testit injektoivat tiedostojärjestelmän, socketit, kellon ja
lapsiprosessit; oikeaa socketia, palvelua tai työkuormaa ei niissä käynnistetä.
Root on canonical OS-temp -juuren suora satunnainen `0700`-alihakemisto ja
socket sen kiinteä `0600`-tiedosto. Olemassa olevaa socket-polkua ei poisteta
uuden käynnistyksen tieltä. Omistajuus, oikeudet sekä rootin ja socketin
laite-/inode-identiteetti tarkistetaan uudelleen ennen kontrollin käyttöä.
Toinen yhteys ei koskaan korvaa ensimmäistä; se myrkyttää kokeen tuloksen.

Molemmat päät käyttävät half-open-kanavaa. Kutsujan odotettu kirjoituspuolen
sulkeminen jättää vastauksen lukuketjun auki initin poistumiseen asti.
Odottamaton EOF READY:n jälkeenkin hylkää avoimen kanavan portin.
Kontrollikerroksen sulkemiskuitti ei todista työkuorman onnistumista,
managerin poistumista tai namespace-puun tuhoutumista.

Katselmus löysi yhteisestä init-protokollasta GO:n perässä samassa chunkissa
tulevan ylimääräisen datan liian myöhäisen torjunnan. Sekä vanha että uusi
polku torjuvat nyt kokonaisen tai osittaisen hännän ennen ensimmäistä
käynnistystä; myöhemmät luvattomat tavut hylätään heti. Uudesta kanavasta
löytynyt ajoituspuute korjattiin tarkistamalla alkuperäinen ready-määräaika
tiedostotarkistusten jälkeen ennen connectia sekä connect-tapahtumassa ennen
READYä. Valmiusviestiä ei jonoteta odottavan yhteyden taakse. Terminaalisen
epäonnistumisen jälkeen tuleva connect ei voi julkaista valmiutta.

Korjattu checkpoint läpäisi 80 kohdetestiä (20 uutta kanava-/init-testiä ja
60 vanhan ajurin testiä), E2E-paketin 273 sopimustestiä sekä workspace-sarjan
4 220 testiä; kahdeksan ennestään ohitettua testiä säilyi ohitettuna.
Koko projektin tyypitys läpäisi. Ensimmäisen kohdeajon polkutarkistusvirhe
säilytettiin ja korjattiin. Riippumaton katselmus hyväksyi korjatun rajauksen
ilman jäljelle jäävää löydöstä. Tämä on injektoitujen adapterien näyttöä,
ei todellinen AF_UNIX-, systemd-, Chromium- tai prosessipuutodiste.
Managerin komentojen suoritin, preflight, session kokonaisajuri, suljettu
tulosskeema/lukuketju ja rajatun CI-kokeen kytkentä ovat seuraavat työt.
Uutta CI-ajoa, fixture-siirtoa, PR:ää tai mergeä ei tässä checkpointissa tehty.

**Kolmas checkpoint: suljettu managerihavainnon lukuketju.**
`managedNamespaceObservation` suorittaa vain kiinteän `systemctl show`
-kyselyn. Kutsuja ei anna komentoa, verbiä, ympäristöä tai lisäargumentteja.
Lukija ei käynnistä/pysäytä unitia eikä myönnä GO- tai poistovaltuutta.
Tuotantofixturet eivät vielä käytä sitä; todellista käyttöä edeltävä
esiehtotarkistus ja session omistaja ovat edelleen tekemättä.

Hyväksytty yksityinen havainto vaatii exit 0:n ilman signaalia, lapsen
`close`-tapahtuman, molempien tulostevirtojen EOF:n, tyhjän stderrin ja
alkuperäisen määräajan. Prosessin `exit` ei yksin sulje tulostevirtoja
([Node ChildProcess](https://nodejs.org/api/child_process.html#event-close)).
Stdout säilytetään alle olemassa olevan 8 192 tavun rajan, dekoodataan
tiukasti vasta kokonaisena ja validoidaan nykyisellä unit-parserilla.
Ensimmäinen virhe säilyy myös myöhemmän onnistuvan exitin yli.

Virheen jälkeen voidaan yrittää pysäyttää vain oma, vielä poistumaton
kyselylapsi kerran. Signaalin lähetys ei ole poistumistodiste; epäonnistunut
tai vielä sulkeutumaton kysely näkyy erillisenä `queryCleanup=unverified`
-tilana ilman uusintaa, PID-hakua tai kohdeunitin pysäytystä. `closed`-lupaus
odottaa todellista kyselylapsen sulkeutumista: tuleva session omistaja odottaa
sitä omalla alkuperäisellä aikarajallaan, ei rajattomasti. Sulkeutunut
kysely ei todista kysellyn unitin tai prosessipuun poistumista.

Kohdetestit käyttävät injektoituja prosesseja ja kelloa, eivät systemdiä tai
sudon todellisia oikeuksia. Lukija ja sen testit on kytketty normaaliin
E2E-sopimuskomentoon T1/T2:n regressiosuoja säilyttäen. Rajauksen
kohdesarja läpäisi 28/28 (17 uutta lukijatestiä ja 11 nykyistä unit-sopimusta),
E2E-paketin normaali sarja 291/291 ilman ohituksia sekä paketin tyypitys.
Riippumaton lähdekatselmus ei löytänyt korjattavaa tässä rajauksessa.
Koko workspacea ei toistettu tätä erillistä, tuotantoon kytkemätöntä
lukijaa varten; edellisen checkpointin workspace-näyttö pysyy erillisenä.
Managerin todelliset esiehdot, launch-/stop-omistaja, kokonaisajuri,
tulosskeema/lukija ja rajattu CI-koe ovat seuraavat työt. Tämä ei sulje T3:a.

**Neljäs checkpoint: kiinteiden host-polkujen metadataesitarkistus.**
`managedNamespacePreflight` tarkistaa CI-/nonroot-kontekstin ennen I/O:ta,
kiinteät järjestelmäbinäärit ja niiden canonical, root-omistetut,
kirjoitussuojatut esi-isähakemistot. Binäärit ovat tavallisia executable-
tiedostoja; vain sudolle hyväksytään sen tarvitsema setuid-bitti.
Tarkistus ei avaa tiedostosisältöjä, prosessilistoja, socket-yhteyttä tai
palvelua eikä muuta oikeuksia. Kutsuja ei anna tutkittavia polkuja.

Systemdin käynnistysmerkki ja private-socketin metadata eivät todista
toimivaa manageriyhteyttä: myös systemdin oma
[sd_booted-tarkistus](https://github.com/systemd/systemd/blob/v255/src/libsystemd/sd-daemon/sd-daemon.c#L665-L675)
lukee vain käynnistysmerkin. Cgroup v2 erotetaan tavallisesta hakemistosta
`statfs`-tyypillä ja kiinteiden v2-rajapintojen metadatalla. Rajapintojen
sisältöä tai ohjainten käyttöönottoa ei vaadita prosessien ryhmittelyyn.

Alkuperäinen ready-määräaika tarkistetaan jokaisen asynkronisen luvun
molemmin puolin ja vielä ennen onnistunutta paluuta. Kesken olevaa
tiedostojärjestelmäkutsua ei voida perua; myöhäinen paluu ei voi jatkaa
tarkistusketjua tai tuottaa hyväksyttyä kuittia. Virhe sisältää vain suljetun
syyn ja vaiheen, ei raakaa tiedostovirhettä tai polkuja.

13/13 injektoitua kohdetestiä, normaali E2E-sarja 305/305 ilman ohituksia
ja paketin tyypitys läpäisivät. Riippumaton lähdekatselmus ei löytänyt
korjattavaa. T1/T2-komentosuoja vaatii myös tämän testitiedoston mukanaolon.
Metadata ei anna launch-, GO-, stop- tai poistovaltuutta: todellinen
manageriyhteys, sudo-politiikka, komentojen tuki ja session elinkaari ovat
seuraavan integraation portteja. Oikeaa host-esitarkistusta, managerikutsua,
CI-koetta tai fixture-siirtoa ei tässä checkpointissa tehty.

**Viides checkpoint: rajattu komentoadapteri ja kertakäyttöinen launch.**
Vanhan show-only-lukijan prosessielinkaari on siirretty yhteen sisäiseen
`managedNamespaceCommand`-toteutukseen; vanha API ja sen 17 testiä säilyvät.
Suljettu operaatiovalinta sallii vain unit-havainnon, yhden managerin
Version-kyselyn sekä täsmällisen observation-/stop-komennon oikeuskyselyn.
Kutsuja ei anna komentoa, verbiä, ympäristöä tai tuloksen parseria.
Managerin arvo hylätään tuloksesta: kuitti kertoo vain yhteyden toimineen,
ei tuetuista ominaisuuksista, oikeuksista tai testipuun omistajuudesta.

Kertakäyttöinen launch-valmistelu sitoo konfiguroidut UID/GID-arvot kutsujan
kaikkiin neljään identiteettiarvoon ennen oikeuskyselyä ja käynnistystä.
Sama jäädytetty argumenttilista käytetään molemmissa; myöhempi kutsujan
konfiguraatiomuutos ei vaihda kohdetta. Tarkka `sudo -n -l -- komento ...`
vain kysyy politiikkaa, ei muuta sitä; sen tuloste rajataan ja hävitetään.
[Sudon listaus](https://github.com/sudo-project/sudo/blob/SUDO_1_9_15p5/docs/sudo.man.in)
ei takaa seuraavan noninteractive-suorituksen onnistumista. Kumpaakaan
operaatiota ei uusita saman valmistelun kautta. Epäonnistuneen launchin
jälkeen unitin syntyminen voi jäädä epävarmaksi: ei automaattista uutta
käynnistystä, GO:ta tai juuren poistoa. `commandCleanup` koskee vain
komentolapsen todellista sulkeutumista, ei unitia tai sen työkuormaa.

Kaikilla komennoilla säilyvät alkuperäinen määräaika, exit/close/EOF-portti,
tiukka dekoodaus, tavuraja, erillinen stderr ja ensimmäinen virhe. Launchin
exit 0 ja tyhjä tuloste tuottavat vain `launchCommandAccepted`-kuitin:
`--no-block` ei todista palvelun valmiutta. Stopin suoritus ei ole vielä
kytketty eikä pelkkä onnistunut oikeuskysely anna pysäytysvaltuutta.

13 uutta injektoitua testiä sekä muuttamattomat lukijatestit ovat normaalissa
319/319 läpäisseessä E2E-sopimussarjassa; tyypitys läpäisi. Katselmuksessa
löytynyt puuttuvan phase-parametrin oletusarvotus korjattiin säilyttämään
vanha hylkäys ennen spawnia. Regressio todettiin ensin hylkääväksi,
korjattiin ja katselmoitiin uudelleen ilman jäljelle jäänyttä löydöstä.
Ei todellista sudo-/systemd-kutsua, CI-ajoa, fixture-siirtoa tai koko
workspacen uusintaa. Seuraavaksi session omistaja yhdistää metadata- ja
komentotarkistukset, hyväksytyn launchin, READY:n ja tuoreen invocation-
kuitin; suljettu tulosskeema ja lukija valmistuvat ennen yhtä seurattua koetta.

**Session integraation checkpoint:** `managedNamespaceSession` yhdistää
metadataesitarkistuksen, managerin yhteyden, täsmälliset oikeuskyselyt,
private-kanavan ja kertakäyttöisen launchin. Hyväksytty käynnistyspyyntö,
READY ja sisäisesti kyselty tuore running-invocation vaaditaan ennen GO:ta.
Omistajuuskuittia ei vastaanoteta kutsujalta. Pysäytys lukee saman unitin
uudelleen ja vertaa invocationia sekä aloitusaikaa yksityiseen kuittiin;
nimen uudelleenkäytön tai kadonneen havainnon perusteella ei arvata kohdetta.
Tämä ei ole atominen vertaa-ja-pysäytä-operaatio vihamielistä manageria
vastaan: luotettu CI ja koskaan uudelleen käyttämätön generation säilyvät
reunaehtoina.

Saman omistajan havainnot ja stop suoritetaan sarjassa. Edellisen
komentolapsen pitää todella sulkeutua alkuperäisessä aikarajassa ennen uutta
komentoa; pelkkä tuloslupauksen hylkäys ei riitä. Loppuodotus sulkee uusien
operaatioiden sisäänoton ja huomioi myös jo jonotetun työn. Toistettu stop
jakaa saman lupauksen eikä käynnistä uutta komentoa. Odottava manageritila
ei tuota onnistumista: vain saman invocationin täsmällinen normaali exit 41
täyttää wrapper-osatodisteen. Ensimmäinen virhe, stopin hylkäys,
komentolasten sulkeutuminen ja kontrolliprotokolla säilyvät erillisinä.

24 uutta injektoitua testiä on mukana normaalissa 344/344 läpäisseessä
E2E-sopimussarjassa; koko projektin tyypitys läpäisi. Katselmuksen kolme
havaintoa todettiin ensin hylkäävillä regressioilla, korjattiin ja katselmoitiin uudelleen ilman
jäljelle jäävää löydöstä. Koko workspacen hyväksyntä on vielä avoin
hylätyn ajon vuoksi; kohdesarjan tai rajatun vertailuajon läpäisy ei korvaa
sitä eikä yksin todista hylkäyksen syytä. Alkuperäinen
aikaraja-apuri on yhteinen myös vanhalle koeajurille muuttamatta sen
sopimusta. Ei tuotanto-, riippuvuus-, aikaraja- tai CI-politiikkamuutosta.

Sisäinen session tulos ei vielä todista sentinel-eloisuutta, koko puun
poistumista tai oikeutta poistaa testijuurta. Ulompi ajuri, uusi suljettu
tuloksen kirjoitus-/lukuketju ja yksi seurattu oikea CI-koe ovat seuraavat
työt. Vanhan user-namespace-kokeen skeemaa tai hylkäystä ei tulkita uudelleen.
Ei fixture-siirtoa, uutta CI-ajoa, PR:ää tai mergeä tässä checkpointissa.

**Ulompi koeajuri ja suljettu lukuketju:** session ympärille on kytketty
erillinen sentinel, tuoreet ennen/jälkeen-haasteet, normaali sulkeutumiskuitti
sekä alkuperäisen private-juuren identiteetin tarkistus ennen tyhjän juuren
ei-rekursiivista poistoa. Odottava sisäinen session lupaus ei siirrä
sentinelin alkuperäistä 16 sekunnin hätäpysäytysrajaa. Pysäytys kohdistuu
vain omaan lapsikahvaan kerran; signaalin hyväksyntä ei todista sulkeutumista.
Raportin 20 sekunnin raja, ensimmäinen virhe ja siivousvirhe säilyvät.
Myöhäinen session paluu ei salli poistoa tai toista julkaisua.

Uusi `boundedManagedPidNamespaceOnly`-tulos (skeema 1) ja sen kanoninen
lukija sitovat saman consumerin, checkout-SHA:n, run ID:n ja yrityksen.
Vain suljettu, ristiriidaton ja tavurajaan mahtuva tulos kelpaa; ylimääräiset
kentät, kahdentuneet JSON-avaimet ja häntä hylätään. Sisäisen session
poistumishavainto ja koko kokeen hyväksyntä ovat eri kentät. Puuttuvaa
näyttöä ei korvata keksityllä ei-käynnistetty-kuittauksella. Vanha skeema 3
ja LS-hylkäys eivät muutu.

Oletuksena pois oleva manuaalinen `linux_managed_namespace_experiment`
-valinta suorittaa kokeen vain onnistuneen tavallisen system/web-testin
jälkeen. Molempien workflow-tasojen kytkentä ja virhestatus on suojattu
testeillä. LM-ajossa vanha user-namespace-valinta pidetään pois päältä.
61/61 yhdistettyä kohdetestiä, normaali E2E-sarja 383/383, CI-sopimukset
241/241 sekä koko projektin tyypitys läpäisivät. Katselmuksessa löydetty
odottavan session sentinel-siivouspuute toistettiin ensin kahdella
hylkäävällä regressiolla ja korjattiin. Riippumaton uudelleenkatselmus ei
löytänyt korjattavaa. Oikea CI-koe on vielä tekemättä. Workspace-portti säilyy avoinna;
alemman tason läpäisy ei korvaa sitä. Ei todellista managerikutsua,
Chromium-yhteensopivuustodistetta, fixture-siirtoa tai T3-hyväksyntää.

#### T3c-LM:n ensimmäinen CI-näyttö ja kytkentätestin korjaus

Revision `08e9a94d907f146f3f8910c219a0d1c45bc305bf` V2-ajo `36268511274`,
yritys 1, suoritti LM-kokeen molempien tavallisten Linux-testisarjojen
jälkeen. Vanha PID-namespace-koe, edellytysprobe ja inspector olivat pois
päältä. Päättyneen ajon, todellisen checkoutin, alkuperäisten lokitavujen,
käynnistysvalintojen ja omistavan kanonisen tuloslukijan kautta molemmat
`boundedManagedPidNamespaceOnly`-tulokset hyväksyttiin rajatusti:
session havainnot täydelliset, normaali wrapperin poistuminen, namespace
tuhoutunut, sentinel ennen/jälkeen elossa ja normaalisti sulkeutunut,
alkuperäinen tyhjä testijuuri poistettu. Ei ensimmäistä tai siivousvirhettä.
Tämä todistaa vain koetyökuorman, ei Chromiumia tai tavallisten fixturejen
siirtoa. Private-takaisinlukijan 37/37 regressiota läpäisi; se ei myönnä
koko T3:n hyväksyntää.

Tavalliset system 218/218, web 35/35 ja Windows Electron 38/38 läpäisivät
ilman retryä tai flaky-tulosta. Myös valitut installer-, legacy-, workspace-
ja rollback-jobit läpäisivät. Kokonaisajo jäi silti hylätyksi: core-jobin
T1-kytkentätestin täsmällisestä odotetusta caller-lohkosta puuttui uusi
manuaalisesti rajattu LM-valitsin, ja hyväksyntäaggregaatti hylkäsi tämän
oikein. Lopputila oli 36 onnistunutta, kaksi hylättyä ja yksi tarkoituksella
ohitettu valinnainen diagnostiikkajob. Kaikkien 38 suoritetun jobin lokit ja
checkoutit säilytettiin; puuttuvia lokeja tai havaittuja seurantakatkoja ei
raportoitu. Saman revision riippuvuustarkistus `36268521603`, yritys 1,
läpäisi. Vanhaa hylkäystä ei korvata toisesta ajosta poimitulla vihreydellä.

Rajattu kytkentätestikorjaus lisää puuttuvan odotuksen sekä puuttuvan,
ehdottoman ja ei-manuaalisen valinnan hylkäävät regressiot. Kohdesarja
70/70, workspace 4 333 läpäisyä ja 8 aiempaa ohitusta, CI-sopimukset
241/241 sekä koko projektin tyypitys läpäisivät. Riippumaton katselmus ei
löytänyt korjattavaa. Tuotanto, workflow-valinnat, aikarajat ja CI-vaatimukset
eivät muutu. Korjatun revision normaali CI-portti on seuraava työ ennen
Chromium-kokeen ja oikeiden kuluttajasiirtojen toteutusta. Aiemmat satunnaiset
timeoutit ja LS-kokeen `uid_map`-esto pysyvät erillisinä avoimina havaintoina.

#### T3:n lopullinen hyväksyntänäyttö

Moduulikehittäjän rajapinta pidetään pienenä: system-testit käyttävät
`isolatedBackendTest`-, selainpolut `isolatedWebTest`- ja Electron-polut
`isolatedElectronTest`-fixtureä. Alustamekanismi, hallintakuitit ja niiden
diagnostiset skeemat jäävät `apps/e2e`:n elinkaaren omistajalle, eivät uuden
laskutus-, kohde- tai tuntikirjaustestin vastuulle. Tämä tarkentaa nykyisen
T3:n hyväksyntää, ei perusta uutta testialustaa tai yleistä helper-kerrosta.

Kuluttajasiirron katselmuksessa tarkistetaan vähintään backendin ja webin
`startManagedProcess`/`stopManagedProcessTree`-ketju, Electronin
`launchElectronRuntime`/`stopOwnedElectronRuntime`-ketju sekä niitä kutsuvat
restart-, failure-, bootstrap-, handoff- ja endurance-polut. Inventaario
varmistetaan lähteestä siirron hetkellä, ei oleteta tämän nimilistan kattavan
myöhemmin lisättyjä kuluttajia. Korvaavan saman revision näytön jälkeen
poistetaan korvattu aktiivinen toteutus ja sen kutsureunat. Vanhaa PID- tai
pääprosessiin perustuvaa siivousta ei jätetä rinnakkaiseksi fallbackiksi.
Historialliset epäonnistumistodisteet säilyvät tästä erillään.

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
säilyy tuntemattomana. Windows-bridgen synkronisesta valmisteluhylkäyksestä
säilyy lisäksi yllä määritelty suljettu syyluokka ilman yksityistä virhettä.
Vaihehavainto ei muuta aikarajoja eikä toimi readiness-
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
