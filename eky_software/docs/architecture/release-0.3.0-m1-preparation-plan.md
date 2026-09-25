# 0.3.0 M1 -valmistelu

## Tila ja valtuus

Omistajan hyväksymä suunnittelu-Goal, valmisteltu ja katselmoitu 2026-09-24. Tämä dokumentti
omistaa M1:n rajauksen ja toteutukseen siirtymisen portin. Julkaisun sisältö
ja työpakettien kokonaistila pysyvät [roadmapissa](release-0.3.0-plan.md).
Omistavat dokumentit alla määrittävät tarkat ehdot, eivät rinnakkaista backlogia.

Valmistelu ei toteuta sovellus- tai testikoodia, schemaa, riippuvuuksia,
versiota, CI-politiikkaa tai uusia turvallisuus-/liiketoimintasopimuksia.
Toteutus aloitetaan rajatun suunnitelman hyväksynnän jälkeen. Yksittäisen
päätösportin keskeneräisyys ei estä muun riippumattoman palan valmistelua.

**T1a/T1b 2026-09-25: toteutettu ja hyväksytty PR/main-porttien jälkeen.** Omistaja hyväksyi
vain alla rajatun testien ajokytkennän ja sen regressiosuojan sekä normaalin
PR/main-integraation vaadittujen porttien jälkeen. T2/T3/A/W7 eivät kuulu
tähän toteutus-Goaliin. Suunnittelu säilyy erillisenä checkpointina;
toteutuksen näyttö ja valmistuneen integraation viite ovat alla.

**T2 2026-09-25: toteutettu ja hyväksytty PR/main-porttien jälkeen.** Komentovalinta,
build-esiehdot ja regressiosuoja on toteutettu hyväksytyn
suunnitelman mukaan. Linux-CI ja täsmällisen merge-revision portit läpäisivät.
[Toteutusportti](#t2n-toteutukseen-siirtymisen-portti) erottaa tämän
T1:n hyväksynnästä sekä T3:n ja tuotantokorjausten jatkotyöstä.

**T3 2026-09-25: T3a-koe suoritettu; neljä tapausta läpäisi, yksi hylättiin.**
[Koetulos ja jatkopäätös](e2e-test-environment.md#t3an-tulos-ja-jatkopäätös)
koskevat vain rajattua toteutettavuuskoetta. Varsinainen
Windows-/POSIX-/Electron-omistajuusratkaisu ja tavallisten testien siirto
päätetään edelleen erikseen kokeen näytön perusteella.

## Lähtötilan näyttö

- M0:n hyväksytty main on `38082dffe1772f099c4b9bb7495bed6c6b9b067b`.
  Paikallinen ja etäinen main sekä juuri tämän revision V2- ja
  riippuvuustarkistusten onnistuminen varmistettiin ennen valmistelua.
  Viitteet ovat [roadmapin nykytilassa](release-0.3.0-plan.md#päätös-ja-nykyinen-tila).
- M0:n integraatiota varten tehdyt harness-korjaukset koskevat erillistä
  supervisor- ja Electron-testiharnessia. Ne eivät sulje R27-R29:ää tai
  tuotantokoodin korjauspaketteja. M0 sisälsi myös aiemman hotfix-haaran integraation.
- Aiempi R01-R31-katselmus ja keskeytetyn Deep Scanin 13 tallennettua
  havaintoa luettiin. S030-01-S030-05 ovat suunnitteluryhmiä, eivät uusi
  skanneriluokitus. Keskeytettyä ajoa ei jatkettu tai käynnistetty uudelleen.
- Skannauksen tuotantolähdealueet ja A:n web-lähteet eivät ole muuttuneet
  katselmusrevisiosta. Staattinen vastaavuus ei korvaa korjauksen regressiota.
- Testikytkennät, A-suunnitelma ja W7-pohja katselmoitiin kolmella erillisellä
  read-only-agentilla. Täsmennykset tarkistettiin vielä korjausten jälkeen.
  Tässä valmistelussa ei ajettu sovellusta, testimatriisia, asenninta tai
  oikeita profiileja. Aiemmat läpäisyt pysyvät historiallisina tuloksina.

## Lukureitit

Jokainen toteutuspala aloittaa juuri-`AGENTS.md`:stä ja
[workflow'n aloitusjärjestyksestä](../ai/workflow.md#työn-aloitusjärjestys).
Paikallinen työkalurunbook ja inventaario luetaan, kun työ käyttää
Windows/WSL/Git/Node- tai release-työkaluja; ne eivät kuulu julkaistaviin tietoihin.

| Alue | Omistavat ohjeet ja tähän valmisteluun liittyvä tarkennus |
| --- | --- |
| T | [Desktop-ohje](../../apps/desktop/AGENTS.md), [E2E-ohje](../../apps/e2e/AGENTS.md), [testaus](../ai/testing-rules.md), [E2E-strategia](e2e-testing-strategy.md), [testimatriisi](r0-e2e-test-matrix.md), [T-suunnitelma](e2e-test-environment.md#t-paketin-valmistelu), [Windows-harness](windows-installer-acceptance-harness-v2.md). |
| A | [Invoicing](../modules/invoicing.md), [UI-roadmapin A-suunnitelma](invoicing-ui-roadmap.md#a-paketin-valmistelu), [frontend-rakenne](web-frontend-structure.md), [UI-periaatteet](../design/ui-principles.md), [luonnoksen sopimus](invoicing-mvp-implementation-plan.md), [hyväksyntä](invoice-approval-numbering-plan.md), [virheketju](error-handling-principles.md). |
| W7 | [ADR-0011](../decisions/ADR-0011-local-multi-workspace-company-model.md), [ADR-0008](../decisions/ADR-0008-local-desktop-company-workspaces.md), [ADR-0009](../decisions/ADR-0009-local-backup-encryption-and-recovery-points.md), [W7-päätösportti](local-company-workspace-plan.md#w7-valmistelu-ja-paatosportti), [backup/restore](local-backup-and-restore-plan.md), [recovery-runbook](local-restore-recovery-runbook.md). |
| Yhteiset portit | [Turvallisuus](security-principles.md), [katselmointi](../ai/review-checklist.md), [observability/audit](observability-and-audit-plan.md), [moduulien integraatiomatriisi](module-integration-matrix.md), [valmistumisportti](../ai/workflow.md#toiminnon-valmistumisportti). |

Toteutus lukee lisäksi jokaisen todellisuudessa muuttuvan kansion ohjeet.
Tämä taulukko ei anna lupaa ohittaa tarkempaa backup-, salaisuus-, päivitys-
tai riippuvuusporttia, jos rajaus myöhemmin koskettaa niitä.

## Rajattu toteutusjärjestys

| Pala | Muutos ja valmistumisen näyttö | Edellytys ja päätösraja |
| --- | --- | --- |
| T1a / R27 | Startup-failure-testit tavalliseen desktop-testivalintaan ja valinnan regressiosopimus. | Hyväksytty; paikallisen näytön lisäksi PR/main-portit läpäisty. Ei tuotantokoodia. |
| T1b / R27 | Kuusi puuttuvaa installer-harness-testitiedostoa nykyisten vaadittujen komentojen kautta ajettaviksi, myös ajokytkentää suojaava testi. | Hyväksytty T1a:n kanssa; R27 suljettu. Ei raskaan CI:n kevennystä. |
| T2 / R29 | `security`/`fault`-projektivalinnan ja koko build-ketjun vastaavuus puhtaasta, vanhentuneesta ja epäonnistuneesta valmistelusta. | Hyväksytty; paikallinen näyttö, Linux-CI sekä PR/main-portit läpäisty. [Integraatio](#t2n-integraatiohyväksyntä). |
| T3 / R28 | Omistajuus käynnistyksestä todettuun koko puun poistumiseen; epävarma cleanup ei hyväksy restartia tai poista fixtureä. | T3a:n erillinen koe suoritettu: 4/5; varhainen Electron-launch-virhe hylättiin. Varsinainen mekanismi ja kuluttajien siirto odottavat [jatkopäätöstä](e2e-test-environment.md#t3an-tulos-ja-jatkopäätös). R28 avoin. |
| A1 / R01 | Luonnoksen avaamisen kohde, näkyvät arvot ja tallennuksen kohde pysyvät samana myös vastausten valmistuessa väärässä järjestyksessä. | T1 ensin; hyväksyntään käytettävän E2E-fixturen T3-puute korjattu ja sen build-valinta todennettu. |
| A2 / R05, A3 / R06 | Ensimmäisen createn tunnisteen säilyminen ja muokatun lomakkeen vanhentunut readiness. | Omat rajatut jatkopalat; A1:n hyväksyntä ei sulje niitä. Backendin hyväksyntäauktoriteetti säilyy. |
| W7-valmistelu | Omistajan hyväksyttävä poisto-, karanteeni-, palautus- ja nollan työtilan sopimus. | Suunnittelu kulkee rinnalla; toteutus tarvitsee C/K/G/H:n nimetyt kyvykkyydet. |

T3:n mekanismin selvitys voidaan tehdä T1/T2:n rinnalla. A1:n alemman tason
regressioita voidaan valmistella ennen T3:a, mutta tunnetusti puutteellinen
cleanup ei kelpaa lopullisen oikeaprosessiajon onnistumistodisteeksi.
Kaikkia I-paketin CI-uudistuksia ei tehdä ennen A:ta. Myöhemmät B/C/K-rajat
säilyvät roadmapin mukaisina, eivät muutu tämän taulukon sivuvaikutuksena.

## Ensimmäinen hyväksytty toteutuspala

**T1a + T1b, vain olemassa olevien testien ajokytkentä ja sen suojaus.**
Omistaja hyväksyi tämän rajauksen ennen koodimuutoksia. Muutospinta on
desktopin scripts-valinta ja sen nykyinen testisopimus, sekä tarpeelliset
dokumentti-/testimatriisitäsmennykset. Nykyiseen vaadittuun komentoon
liittäminen on ensisijainen; uutta workflowta tai yleistä testirunneria ei
lisätä vain tätä varten.

Seitsemän tiedoston lähtöluettelo ja ehdotettu komentojako on kirjattu
[T1:n omistavaan suunnitelmaan](e2e-test-environment.md#t1-testien-ajokytkentä).
Startup-testi ja uuden wiring-testin oma kytkentä tulevat tavalliseen
desktop-`test`-komentoon. Viisi installer-tiedostoa tulee
`installer:test:unit`-komentoon ja binary-handoff-tiedosto nykyiseen
sarjalliseen `installer:test:windows-process`-komentoon. Molemmat installer-
vaiheet kuuluvat nykyiseen `windowsContracts`-hyväksyntäketjuun.
Toteutuksessa todennetaan koko reitti testitiedostosta package-komennon ja
workflow/job-vaiheen kautta required-aggregaattiin. Nykyiset testit,
native-esiehdot ja prosesseja omistavan testin sarjallisuus säilyvät.

Hyväksyntä ei perustu pelkkään `package.json`:in tekstihakuun:

1. Valinnan sopimustesti tunnistaa puuttuvan, väärän tai katkenneen
   komentoreunan. Negatiivinen fixture poistaa yhden vaaditun tiedoston tai
   kutsun ja todistaa, että tarkistus hylkää sen. Myös wiring-testin oma
   ajokytkentä, väärä komentoryhmä ja sarjallisuuslipun puuttuminen testataan.
2. Tavallinen desktop-komento todella suorittaa startup-failure-tiedoston.
   Sen nykyiset seitsemän tapausta eivät saa muuttua ohitetuiksi.
3. `installer:test:unit` suorittaa viisi ja `installer:test:windows-process`
   yhden aiemmin irrallisen tiedoston; tarkka valinta ja päättynyt tulos kirjataan.
4. Tarpeelliset typecheck-, workspace- ja CI-sopimukset läpäisevät.
   Käytä nykyistä riskiluokitusta. Jos manifestimuutos valitsee raskaan
   matriisin, sitä ei kierretä docs-only-luokituksella tai suodattamalla.
5. Riippumaton diff-katselmus, yksityisyyden tarkistus, täsmällisen PR-pään
   vaaditut portit, normaali merge ja täsmällisen mainin omat portit.
   Ajonaikainen [CI-seuranta](../ai/workflow.md#ci-ajon-seuranta-ja-virhetodisteet)
   alkaa ajon alussa; ensimmäinen virhe säilytetään ennen uusintaa.

Hylätty testi pysäyttää tämän palan hyväksynnän. Korjausta ei naamioida
testin poisjättämiseksi, pidemmäksi aikarajaksi tai retry-läpäisyksi.
Jos testi paljastaa tuotantovirheen, se rajataan ja päätetään erikseen.

### T1:n toteutus ja hyväksyntänäyttö

2026-09-25: seitsemän olemassa olevaa tiedostoa on kytketty yllä nimettyihin
komentoihin. `scripts/test-command-wiring.test.mjs` suojaa tiedostojen,
runnerien, build-esiehdon, sarjallisuuden ja required-CI-ketjun vastaavuuden.
Sen 58 tapausta sisältävät oman ajokytkennän sekä puuttuvien, väärien,
ohitettujen ja epäonnistuneiden vaiheiden kielteiset kokeet. Kaikki
aiemmat manifestin testivalinnat säilyvät. Riippumaton diff-katselmus ei
löytänyt korjattavaa tästä rajauksesta.

Valmistuneet paikalliset tarkistukset:

- Tavallinen desktop-komento suoritti startup-failure-tiedoston kaikki
  seitsemän tapausta. Desktop: 1529 Vitest-läpäisyä, kolme ennestään
  alustarajattua ohitusta ja 139 Node-läpäisyä; ohitukset eivät ole läpäisyjä.
- Installer-unit 113/113, mukaan liitettyjen viiden tiedoston 19 tapausta
  mukaan lukien. Sarjallinen Windows-prosessikomento 13/13, joista kuusi
  binary-handoff-tapauksia; supervisorin build-esiehto säilyi.
- Koko workspace 3839 läpäisyä ja kahdeksan ennestään alustarajattua
  ohitusta. Typecheck, backend/web/desktop-buildit ja 55 CI-sopimusta
  läpäisivät. Ajot valmistuivat ensimmäisillä yrityksillä.

Tämä on testiajokytkennän näyttö, ei tuotannon backup-, lifecycle- tai
asennushyväksyntä. Muutos ei lisää tuotannon tapahtumia, käyttöliittymää,
schemaa, salaisuuskäsittelyä tai pysyviä business-artifacteja, joten niiden
Diagnostics-/Activity-/tukipakettiketjut ja packaged backup -portti eivät
muutu T1:n vuoksi. Testitulokset ja virheet kulkevat nykyisten runnerien
ja CI:n kautta. Riippuvuudet, sovellusversio, aikarajat ja CI-ehdot säilyvät.

R27:n integraatio on hyväksytty
[PR #276:n integraatiocheckpointissa](https://github.com/eky-software/eky/pull/276#issuecomment-5822861572).
Se yksilöi PR-headin, todellisen checkoutin, ajot ja yritykset sekä
valitut required-portit. Normaali merge tuotti main-revision
`da896643d5cc1895174e508bee4f6141f4489d56`, jonka oma
[V2-ajo](https://github.com/eky-software/eky/actions/runs/36064323922) ja
[riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/36064323269)
läpäisivät ensimmäisellä yrityksellä. Paikallinen/etäinen main, ajot ja
checkpoint luettiin uudelleen T2-valmistelun alussa 2026-09-25.
T2/R29, T3/R28, A ja W7 pysyvät erillisinä avoimina jatkopaloina.

## T2:n toteutukseen siirtymisen portti

Omistaja hyväksyi 2026-09-25 seuraavaksi rajatuksi toteutus-Goaliksi
[T2:n projektivalinta ja valmistelu](e2e-test-environment.md#t2-projektivalinta-ja-valmistelu):

- Molemmat tagiaggregaatit käyttävät nykyistä täydellistä Electron-
  valmistelua ja nimeävät kolme standardiprojektia. Ei uutta runneria.
- Korjataan `endurance-baseline`-valinnan hakemistoraja, jotta se ei ota
  myös `electron-stress`-tapauksia. Desktop-stress ja soak säilyvät omissa
  komennoissaan; niiden kestoa tai testejä ei vähennetä.
- Lisätään E2E-paketin Node-ajokytkentäsopimus ja oikeaa Playwright-
  konfiguraatiota käyttävä system-sopimus. Varsinainen discovery sekä
  puhdas/vanhentunut/epäonnistunut valmistelu todennetaan erikseen.
- Molempien juurialiasten todellinen ajotodistus, katselmointi, normaali
  PR-integraatio ja uuden main-revision omat required-portit.

Hyväksyntä kattaa myös löydetyn endurance-päällekkäisyyden korjauksen.
Ei tuotantokoodia, riippuvuuslisäyksiä,
versionnostoa, aikarajamuutoksia tai CI-vaatimusten kevennystä.
Build-/staging-toteutuksen mahdollinen lisäkorjaus tai T3:n prosessiomistus
ei tule hyväksytyksi sivuvaikutuksena. Tuntematon siivoustulos keskeyttää
kyseisen ajon hyväksynnän; vihreä T2 ei sulje T3:a.

Suunnittelun näyttö oli lähdekatselmus, ei testitulos. Toteutuksen
[T2-rivien](r0-e2e-test-matrix.md#t2-testivalinnan-ja-valmistelun-sopimukset)
paikallinen näyttö ja valmistunut integraatioportti ovat alla. Lähtörevisio on yllä varmennettu
T1-main; se ja työpuun muutokset tarkistettiin uudelleen toteutuksen alussa.

### T2-valmistelun checkpoint

2026-09-25: komentoketju ja tuotteiden kuluttajat tarkistettu lähteistä;
erillinen read-only-agentti tarkisti projektien ja tagien valinnan sekä
valmiin neljän dokumentin suunnitelmadiffin. Katselmuksessa ei jäänyt
korjattavia huomautuksia. Muutettujen dokumenttien 67 suhteellista linkkiä,
otsikkoankkurit ja kuusi ohjeiden lukureittiä tarkistettiin; diffin muotoilu
ja julkaistavan sisällön yksityisyys tarkistettiin. Ei buildia, discoverya,
testiajoa tai T2-integraatiota. Tämä päättää suunnittelun, ei toteutusporttia.

### T2:n toteutus ja paikallinen näyttö

Toteutusrevisio on `aada2b67c6353a54b96c629cb90652fb7f3f5834`.
Security/fault käyttää nyt yhteistä täydellistä valmistelua ja kolmea
standardiprojektia. Baseline-stressin hakemistoraja ei enää valitse
desktop-endurancea. Valintoja, aikarajoja, toistoja tai CI-ehtoja ei kevennetty.

| Tarkistus | Tulos ja rajaus |
| --- | --- |
| Node-ajokytkentäsopimus | 20/20 läpäisi sekä oman pnpm-komennon että workspace-testiketjun kautta. Kielteiset manifestimuutokset ja jokaisen nimetyn valmisteluvaiheen pysähtyminen testattiin inertillä komentofixturellä. Tämä ei korvaa oikeaa build-koetta. |
| Konfiguraatiosopimus | 9/9 oikeaa konfiguraatiota käyttävää tapausta läpäisi normaalissa ja CI-moodissa. Paikallinen CI-moodi ei ole Linux-CI:n todistus. |
| Todellinen discovery | Kymmenen ennen/jälkeen-valinnan tarkka jäsenyys tarkistettiin. Ainoat erot: uudet sopimustapaukset ja kaksi desktop-endurance-tapausta pois väärästä baseline-projektista. Desktop-stress/soak säilyivät omissa valinnoissaan. |
| Puhdas valmistelu ja aggregaatit | Molemmat juurialiakset suoritettiin erikseen ilman aiempia build-/stage-tuotteita synteettisessä Windows-koeympäristössä. Security 141/141, fault 17/17; ei ohituksia, retryjä tai flaky-tuloksia. Vain raportointia täydennettiin erillisiä todisteita varten. |
| Vanhentuneet tuotteet | Kahdeksan tuoteryhmän tunnistettava vanha sisältö korvautui ja ylimääräiset sentinelit poistuivat. Oikean runtime-materialisoijan kopioiden sisältö vastasi uudelleen rakennettuja tuotteita; pelkkää mtimea ei käytetty. |
| Oikea valmisteluvirhe | Hallittu käännösvirhe pysäytti security-ketjun ennen myöhempiä vaiheita. Erillinen hallittu staging-tiedostolukko pysäytti fault-ketjun. Vanha stage oli olemassa, mutta Playwright ei käynnistynyt. Alkuperäiset virheet säilytettiin eikä näitä ajoja nimetty testiläpäisyiksi. |
| Workspace | Nykyinen `pnpm test` ja koko workspacen typecheck läpäisivät. Buildit ja staging todennettiin yllä olevilla oikeilla valmisteluajoilla. Olemassa olevia alustakohtaisia unit-ohituksia ei muutettu. |
| Katselmointi | Riippumaton koodikatselmointi: POSIX-fixturepolun lainaus korjattiin ja erikoismerkkipolku lisättiin regressioksi. Ensimmäisen kohdeajon Windows-lainausvirhe ja uuden specin tyypitysvirhe korjattiin ennen hyväksyttyjä ajoja; alkuperäinen näyttö säilytettiin. |

Ajoja seurattiin alusta loppuun; aggregateilla oli myös riippumaton
lukuseuranta. Todellisen Electron first-start -tapauksen siivousliite
vahvisti nykyisen fixturen cleanupin, portin vapautuksen ja juuren poiston.
Tämä ei todista koko prosessipuun omistajuuden T3-puutetta korjatuksi.
Raakatulosteet, synteettiset koealueet ja yksityiskohtaiset paikalliset
todisteet pysyvät Gitistä ohitettuina.

Tuotantokoodi, UI-ilmoitukset, Diagnostics/Activity, tukipaketti, backup-
formaatti ja tietokantamigraatiot eivät muutu. Siksi tuotannon packaged
backup/restore-porttia tai uutta asennuspakettia ei tuoteta T2:ssa.
Koodin peruminen ei ole testiprosessin siivouskeino. Uusia riippuvuuksia,
versionnostoa tai lukitustiedoston muutosta ei ole.

### T2:n integraatiohyväksyntä

R29 on hyväksytty [PR #277:n integraatiocheckpointissa](https://github.com/eky-software/eky/pull/277#issuecomment-5826768078).
Hyväksytty lähde on `6b323284bf671ad684e8b5774d22bc566cf709c2`,
todellinen PR-checkout `0714504914cd1b43c4fae73bfb3da0cbd39c0e14`
ja normaali merge `5cc58b7139a6616bc9403a5724f93d929e90cf25`.
Checkpoint erottaa paikalliset aggregaatit, Linuxin Node-/system-sopimukset
sekä PR:n ja mainin omat portit. Mainin
[V2-ajo](https://github.com/eky-software/eky/actions/runs/36094675603) ja
[riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/36094675166)
läpäisivät ensimmäisellä yrityksellä. Paikallinen/etäinen main, merge,
ajojen revisio ja valmistunut tila sekä checkpoint tarkistettiin uudelleen
T3-valmistelun alussa. T3/R28, A ja W7 jäävät avoimiksi.

## T3:n toteutukseen siirtymisen portti

2026-09-25: omistaja salli suunnittelun ja toteutuksen ilman uutta kysymystä,
jos uusia hyväksyttäviä päätöksiä ei tarvita. T3:n aiemmin nimetty
omistajuusmekanismin päätös on kuitenkin avoin. Tätä ehtoa ei tulkita
Windowsin installer-supervisorin yleiskäyttöluvan tai Linuxin uuden
alustavaatimuksen hyväksynnäksi.

[Omistava T3-suunnitelma](e2e-test-environment.md#t3-koko-prosessipuun-poistumistodiste)
sisältää lähdehavainnot, kuluttajaluettelon, vaihtoehdot ja hyväksyntätestit.
Windowsin Job-primitiivejä voidaan selvittää uudelleenkäytettäviksi, mutta
nykyinen installerin batch-protokolla ei ole elävän E2E-session rajapinta.
Electronin launchia ei voi nimetä launch-hetkestä omistetuksi pelkän
myöhemmin saadun prosessikahvan perusteella. Linuxin nykyiset CI-kuluttajat
tarvitsevat oman todistettavan ratkaisunsa.

**Omistajan hyväksyntä 2026-09-25: vain T3a-toteutettavuuskoe.** Se kattaa
erillisen test-only Windows Job -session ja Electron-liitännän kokeen
nykyisellä työkalupohjalla sekä Linux-edellytysten read-only-tarkistuksen.
Ei uusia riippuvuuksia, tuotantokoodia, installerin nykyisen protokollan
muutosta, tavallisten fixturejen siirtoa, pidempiä aikarajoja, kevyempiä
CI-ehtoja tai koneen suojaus-/palveluasetusten muutosta.
Linuxin cgroup-kirjoitukset, systemd-palvelu, delegointi, oikeusmuutos tai
uusi native-toolchain eivät kuulu tähän hyväksyntään. Tarvittava täsmällinen
jatkopäätös valmistellaan näytön perusteella ennen niitä.

Kokeen lähteet rajataan `apps/e2e/experiments/processOwnership`-alueelle.
Nykyisiä Job-primitiivejä käytetään muuttamatta installerin lähteitä tai
protokollaa. Erillinen session omistaja käynnistää synteettisen Node-puun
tai Playwright/Electron-ajurin ennen työkuorman suoritusta omistettuun
Jobiin. Ajurin omistaminen ei vielä ole tavallisen Electron-fixturen
läpinäkyvä adapteri. Koe raportoi tämän rajan ja `process()`-kahvan
todellisen merkityksen; käyttöönottoa ei päätellä pelkästä launch-läpäisystä.
Pääagentti vastaa ajoseurannasta ja ensimmäisen virheen säilyttämisestä.
Koedata ja tulokset pidetään eristetyssä temp-juuressa, paikallinen näyttö
Gitistä ohitettuna. Kokeelle ei lisätä tavallisen testikomennon tai CI:n
automaattista ajokytkentää.

T3a:n valmistuminen tarkoittaa päätöskelpoista näyttöä valituista
mekanismeista ja niiden rajoista, ei R28:n korjausta. Varsinaisen siirron
portti vaatii omistajan hyväksymät alustamekanismit, session/stop-
sopimuksen, tiedostorajat, build-esiehdot ja omistavan suunnitelman testit.
Alkuperäisessä suunnittelussa ei tehty koodimuutoksia tai oikeaprosessikokeita.
Myöhemmän hyväksytyn kokeen todellinen näyttö on
[T3a-tuloskirjauksessa](e2e-test-environment.md#t3an-tulos-ja-jatkopäätös).
Se ei ole sovelluksen julkaisu- tai integraatiohyväksyntä.

### T3-valmistelun checkpoint

2026-09-25: Windowsin ja Linuxin vaihtoehdot sekä lopullinen neljän
dokumentin suunnitelmadiffi katselmoitiin kahdella erillisellä read-only-
agentilla. Katselmuksiin ei jäänyt korjattavia huomautuksia. Muuttuneiden
dokumenttien 79 suhteellista linkkiä ja niiden otsikkoankkurit sekä diffin
muotoilu ja julkaistavan sisällön yksityisyys tarkistettiin.
T2:n integraatiotila varmistettiin uudelleen; aiempia testituloksia ei ajettu
uudelleen tässä dokumentointivaiheessa. T3a odotti silloin omistajan päätöstä;
yllä kirjattu myöhempi hyväksyntä koskee vain erillistä koetta.
Tämä päättää vain valmistelun, ei T3:n toteutusta tai R28:n hyväksyntää.

### T3a-kokeen checkpoint

2026-09-25: erillinen test-only-koe ja tuloskirjaus katselmoitu kahdella
aliagentilla. Katselmuksessa korjattiin testityökuorman temp-rajaus,
havaintojen odotus, hätäkatkaisun epävarman tilan raportointi ja myöhäisen
tuloksen hyväksymisriski. Koetuloksen sanamuoto ja vanhentunut tilateksti
korjattiin. Viiden muuttuneen ohjetiedoston 84 suhteellista linkkiä ja
otsikkoankkuria sekä diffin muotoilu ja julkaistavan sisällön rajaus
tarkistettiin. Tämä checkpoint säilyttää myös hylätyn koetapauksen ja
jatkopäätökset; se ei ole kaikkien kokeiden, tavallisten fixturejen tai
PR/main-integraation hyväksyntä.

## Skannaushavaintojen vaikutus jatkoon

S030-01-S030-05:n omistus ja tarkat päätösrajat ovat
[roadmapin skannaustäydennyksessä](release-0.3.0-plan.md#skannauksen-tuoma-täydennys).
M1 vahvistaa työjärjestyksen kannalta seuraavat rajat:

- K:n schema-attestointi ja eristetty tarkistus ovat eri velvoitteita.
  Pelkkä salaus, migraatioledger, readonly tai Promise-timeout ei korvaa niitä.
  Myös pelkkä Inspect kuuluu tarkistuksen rajaukseen, ei vain import/restore.
- B ratkaisee toimitusrevision, PDF:n ehdollisen julkaisun ja peruutuksen
  atomisen varauksen yhteensopivasti, pieninä erikseen testattuina paloina.
  SMTP-verkkokutsua ei pidetä SQLite-transaktion sisällä.
- Skannerin schema-uudelleenrakennusehdotus ei hyväksy koko kannan
  uudelleenkirjoitusta. Attestoinnin omistaja, kanonisointi, historian
  yhteensopivuus ja mahdollinen metadata hyväksytään ennen toteutusta.
- Vanhentunut sähköpostiesikatselu, saman scheman rollback, body-/lokimäärärajat
  ja testipolkujen containment säilyvät rajattuina tarkistustehtävinä,
  eivät uusina vahvistettuina löydöksinä.

Tulevat testit käyttävät synteettisiä nyky- ja historiallisia backuppeja,
muutettuja schema-objekteja, rajattua raskasta kyselyä ja fake-providerin
hallittuja välivaiheita. Näitä ei ajettu tämän valmistelun yhteydessä.

## Valmistumisportti pala kerrallaan

| Näkökulma | T1-T3 | A1-A3 | W7 |
| --- | --- | --- | --- |
| Testit | Valinta, prerequisite, failure ja todellinen cleanup. | Hallitut vastausjärjestykset, todellinen UI sekä backendin jälkiluku; ei PASS tarkoittaa bugia -probea hyväksynnäksi. | Jokainen durable-raja, muut yritykset ja saman artifactin hardened Windows -polku. |
| Ilmoitukset | Testin alkuperäinen virhe erillään cleanup-/näyttövirheestä. | Nykyisen kohteen turvallinen suomenkielinen tila; vanha vastaus ei poista virhettä tai busy-tilaa. | Vahvistus, peruutus, recovery, lopullisuus ja ulkopuolelle jäävät kopiot ymmärrettäviksi. |
| Diagnostiikka | Testiharnessin rajattu näyttö, ei tuotannon business-auditia. | Vanhentuneen lukutuloksen hylkäys ei ole business-muutos. Nykyinen virheketju tarkistetaan; ei laskun sisältöä teknisiin lokeihin. | G/H:n todellinen observer- ja lukuketju; journalin virhe erotetaan best-effort-lokin virheestä. |
| Palautettavuus | Epävarma siivous säilyttää testijuuren; koodirevert ei siivoa orpoa prosessia. | Ei DB/schema-migraatiota A1:ssä; koodin peruminen ei korjaa aiemmin väärään kohteeseen tallennettua tietoa automaattisesti. | Oma hyväksytty quarantine/recovery/purge-sopimus; ei arvaavaa palautusta. |
| Dokumentaatio | Komennot, E2E-ympäristö ja matriisin todellinen taso. | Omistava UI-suunnitelma, testimatriisi ja muuttuneen toiminnon käyttöohje. | ADR-täsmennykset, workspace/backup/secret/retention/diagnostiikka ja käyttö-/recovery-ohje. |

Muuttunut tuotantolifecycle, backup/restore, SQLite, business-artifact,
`safeStorage` tai aktiivisen profiilin polku vaatii juuri-AGENTS:n packaged
backup -> inspect -> restore -> restart -> compare -portin. Installer ja
automaattipäivitys ovat erillisiä portteja. Testiharness-only-muutoksen
soveltuvuus perustellaan erikseen; T:n testiajot eivät todista W7:n tuotantoa.

## Päätösjono ja valmistelun lopetus

Ensimmäinen hyväksytty toteutusraja T1a/T1b on valmis.
Myös T2:n paikallinen näyttö, Linux-CI ja PR/main-integraatio on hyväksytty.
T3a on tutkittu ja sen varhaisen Electron-virheen yhteensopivuusraja kirjattu.
T3:n omistajuusmekanismi ratkaistaan edelleen ennen tavallisten fixturejen
muutoksia. A1 käyttää nykyistä
feature-/API-sopimusta; jos rajaus vaatii
backendin tai navigoinnin uuden liiketoimintasäännön, se palautuu suunnitteluun.
W7:n päätöksiä ei kysytä yhtenä epämääräisenä lupana, vaan sen omistavan
suunnitelman päätöstaulukon mukaan ennen kunkin vaikutusalueen toteutusta.

M1-valmistelu voidaan päättää, kun lähtötila, lähdehavainnot, ensimmäinen
pala, päätösjono ja hyväksyntäportit on kirjattu ja riippumattomasti
katselmoitu sekä muutettujen ohjeiden lukureitit tarkistettu. Tämä sulkee
vain suunnittelu-Goalin. T/A/W7 tai 0.3.0 eivät silloin ole toteutettuja.

### Valmistelun checkpoint

2026-09-24: rajaus, lähdehavainnot ja päätösjono katselmoitu. T1:n täsmällinen
komentojako, A2:n tallennetun revision ehto ja W7:n kielteiset backup-testit
sekä artifact-kohtaiset lopputilat täsmennettiin katselmusten perusteella.
Muuttuneiden viiden dokumentin suhteelliset linkit ja otsikkoankkurit
tarkistettiin; diff- ja julkaisusisällön tarkistus tehtiin.
Tämä on dokumentointinäyttöä, ei sovelluksen testiläpäisy.
T1a/T1b valmistui rajattuun toteutuspäätökseen; myöhempi hyväksyntä ja
toteutustila ovat dokumentin alussa. T2/T3/W7:n nimetyt
päätösportit säilyvät auki ennen kyseisten sopimusten toteutusta.
