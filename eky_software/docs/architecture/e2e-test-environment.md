# E2E-testiympäristö

Tämä dokumentti määrittelee Eky R0:n Playwright-pohjaisen järjestelmätestauksen
turvarajat. E2E-runtime on testausinfrastruktuuria, ei liiketoimintamoduuli.

Tämä on voimassa oleva tekninen ohje. Uusi testi aloitetaan
[testinkirjoittajan pikaohjeesta](../ai/e2e-test-authoring-guide.md).
[R0-matriisi](r0-e2e-test-matrix.md) omistaa kattavuuden,
[M1:n jatkamiskohta](release-0.3.0-m1-preparation-plan.md#jatka-tästä)
nykyisen hyväksytyn lähtörevision ja seuraavan työn.
T1/T2/T3:n päätökset ja päivätyt koetulokset on erotettu
[historiaan](e2e-test-environment-history.md). Niiden vanhat ehdotukset tai
koekohtaiset rajat eivät korvaa tämän sivun nykyistä sopimusta.

## Omistajuus

`apps/e2e` omistaa Playwright-konfiguraation, testien prosessien elinkaaren,
testikohtaiset polut, selainverkon estot ja turvalliset epäonnistumisartefaktit.

Backendin testikoostaminen kuuluu `apps/backend/e2e`-alueelle. Se saa koota
production-portteihin testiadaptereita, mutta sitä ei käännetä tavalliseen
backend-buildiin eikä pakata desktop-sovellukseen. Production-koodiin ei lisätä
testireittejä, reset-pintoja, testipainikkeita tai rendereristä ohjattavaa
fault injectionia.

### Testinkirjoittajan rajapinta

Moduulin testi käyttää yhtä kolmesta fixturestä:

| Testipolku | Omistava fixture |
| --- | --- |
| HTTP, session, persistence, fault ja recovery ilman selainta | [isolatedBackendTest](../../apps/e2e/src/fixtures/isolatedBackendTest.ts) |
| Selainpolku | [isolatedWebTest](../../apps/e2e/src/fixtures/isolatedWebTest.ts) |
| Electron development -polku | [isolatedElectronTest](../../apps/e2e/src/fixtures/isolatedElectronTest.ts) |

Fixture omistaa testin palvelut, eristyksen ja siivouksen. Uusi laskutus-,
kohde- tai tuntikirjaustesti ei rakenna omaa prosessienhallintaa tai tunne
Job Objectia, Linuxin eristysmekanismia tai diagnostiikan tulosskeemoja.
Hardened packaged -todistus säilyy erillisenä desktopin hyväksyntäporttina.

Desktopin first-start-/activation-kokeiden
[profiilivalmistelija](../../apps/desktop/e2e/workspaceFirstStartMigrationProofFixtures.ts)
erottaa historiallisen pending-syötteen ja jo nykyiseen skeemaan siirretyn
syötteen. `createCurrentFixture` kylvää historiallisen business/PDF-aineiston,
käyttää staged backendin omistamaa migraatioajuria ja vertaa säilyvää
business/PDF-snapshotia. Olemassa oleva kandidaattilukija vaatii nykyisen
historian, katalogin ja nolla-pending-tilan. Testattavan first-start- tai
activation-polun historiallisia syötteitä ei valmistelussa migroida.
Tämä offline-valmistelu on vain E2E-buildissa; se ei anna tuotannon Electron
mainille tietokantakäyttöoikeutta eikä lisää uutta testipohjaa tai julkista
rajapintaa.

Laskutuksen vanhan aineiston native-kokeessa sama Electron-fixture tarjoaa
`e2eLegacyInvoiceProfile: 'sent'` -valinnan. Se luo vain testijuureen
synteettisen 038-profiilin; tuotannon startup suorittaa migraation.
Valintaa ei yhdistetä workspace-backup-fixtureen eikä profiilia kylvetä
uudelleen restartissa. [Valmistelija](../../apps/e2e/src/data/createLegacyInvoiceProfile.ts)
torjuu vieraat juuret, linkit ja olemassa olevan runtimen. Valmisteluvirhe
säilyttää aineiston ja `legacyInvoiceProfile`-vaiheen nykyisessä
`electron-lifecycle`-liitteessä; raportointivirhe ei korvaa ensivirhettä.
Tämä ei lisää tuotantoon testiohjausta tai muodosta uutta testipohjaa.

Paketoidun legacy-palautuksen syöte muodostetaan erillisellä
[salatun legacy-backupin valmistelijalla](../../apps/e2e/src/data/createLegacyInvoiceBackup.ts).
Se käyttää samaa juuriltaan validoitua 038-fixtureä ja nykyistä
snapshot/container-ketjua. Vain tämä kutsuja valitsee eksplisiittisen
historiallisen prefixin; tavallisen varmuuskopioapurin oletus on edelleen
`exactCurrentManifest`. Valmistelija vaatii `EKY_E2E=1`, ei migroi kantaa,
ei lue käyttäjäprofiileja eikä kirjoita desktopin production-buildiin.
Salasanan antaa synteettisen kokeen kutsuja; sitä ei tallenneta
koordinaatiotiedostoon tai julkaista raportissa. Autentikoidun backupin
038-skeema, alkuperäinen tapahtuma ja täsmällinen PDF todennetaan
[valmistelijan sopimustestissä](../../apps/e2e/tests/system/legacyInvoiceBackup.spec.ts).
Tämä syötteen todiste ei vielä ole paketoidun palautuksen hyväksyntä.

[Paketoidun kokeen valmistelija](../../apps/e2e/src/data/prepareLegacyInvoicePackagedSmoke.ts)
siirtää tästä vain suljetun kannan, alkuperäisen PDF:n ja salatun backupin
itsenäisinä tavuina nykyisen packaged-smoken uuteen token-juureen.
Kohde varataan yksinoikeudella; käytetty tai linkitetty juuri ei kelpaa.
Se ei kirjoita työtilarekisteriä, hyväksyttyä buildia tai sessionia eikä
tee migraatiota. Lähde ja epäonnistuneen valmistelun kohde säilytetään.
[Sopimustesti](../../apps/e2e/tests/system/legacyInvoicePackagedInput.spec.ts)
todistaa kopioiden erillisyyden myös kohdekannan oikean migraation jälkeen.
Sovelluksen käyttöönotto ja saman lineagen palautus on edelleen todennettava
paketoidussa runtimessa, ei tällä valmistelutestillä.

Varsinainen [legacy-palautuskoe](../../apps/e2e/tests/packaged/legacyInvoiceRecovery.spec.ts)
ajetaan Windowsissa komennolla `pnpm --filter @eky/e2e e2e:packaged:legacy`.
Komento valmistelee nykyisen E2E-backendin ja rakentaa tuoreen hardened-paketin.
Windowsin nykyinen CI-jobi käyttää juuri edeltävässä askeleessa rakentamaansa
samaa pakettia: `Prepare packaged legacy recovery runtime` valmistelee
E2E-apurit ja `Run packaged legacy recovery` ajaa eksplisiittisen configin.
Ajokytkentäregressio vaatii tämän järjestyksen ilman ehtoja tai virheohitusta;
CI:n hyväksyntäkoonti vaatii molempien askeleiden onnistumisen.
Erillinen Playwright-projekti käyttää nykyistä packaged-smoke-ajuria ja sen
kahta 120 sekunnin vaihetta ilman uusintaa; tavallinen `e2e:all` ei valitse sitä.
Todellinen startup ottaa vanhan profiilin käyttöön ja migroi sen. Koe tarkistaa
salatun alkuperäisen backupin, luo palautuksessa poistuvan muutoksen ja käyttää
workspace-managementin saman lineagen korvausta. Relaunchin jälkeen vaaditaan
`workspaceReplacement`-palautusvaltuus, uusi runtime/session sekä säilyneet
lasku-, historia- ja PDF-tiedot, konekohtainen synteettinen salaisuus ja toinen
onnistunut backup/inspect.

Migraatio muuttaa tietokannan tavut. Siksi ennen seuraavaa backend-käynnistystä
[vertailija](../../apps/e2e/src/data/legacyInvoiceRecoveryComparison.ts) vaatii
lähteen lasku-, laskurivi-, dokumentti- ja toimitustapahtumataulujen kaikkien
alkuperäisten rivien ja kenttien säilymisen. Vasta sen jälkeen suljetun
palautuskannan hash sidotaan seuraavan käynnistyksen tavutarkistukseen.
PDF-katalogi ja PDF-tavut verrataan edelleen alkuperäiseen odotukseen;
muuttunutta historiakenttää hylkäävä regressio on erillinen system-testi.
Epäonnistuneen kokeen aineisto säilyy nykyisissä yksityisissä testijuurissa.
Nykyinen salattu CI-keräin poimii vain nimetyn smoke-tuloksen ja rajatun
prosessitulosteen sekä Playwrightin virheraportin. Legacy-syötteen backup,
identiteettitiedosto, vertailutila ja profiili eivät kuulu keräykseen.
Kehityspaketin läpäisy ei korvaa puhtaan releasekandidaatin hyväksyntää.

### Ajokytkentä ja puhdas valmistelu

T1:n suoja yhdistää vaaditun testitiedoston todelliseen package-komentoon,
workflow-vaiheeseen ja hyväksyntäkoontiin. T2:n suoja yhdistää kanonisen
komennon oikeaan projektivalintaan ja build-esiehtoihin. Puuttuva,
vanhentunut tai epäonnistunut valmistelu ei saa käyttää aiempaa buildia
onnistumisena. Uusi testi lisätään matriisin lisäksi oikeaan ajovalintaan;
pelkkä tiedoston olemassaolo tai `--list` ei ole testiläpäisy.

Käytä [pikaohjeen kanonisia komentoja](../ai/e2e-test-authoring-guide.md).
Valinnan tai valmistelun muutos päivittää myös sen regressiosuojan.
Historialliset [T1](e2e-test-environment-history.md#t1-testien-ajokytkentä)- ja
[T2](e2e-test-environment-history.md#t2n-regressiosuoja)-todisteet eivät hyväksy
myöhempää muuttunutta komentoa automaattisesti.

## Tuetut suoritusympäristöt

| Ympäristö | Nykyinen tuki |
| --- | --- |
| Windows | Paikalliset system-, web- ja Electron development -ajot sekä nykyiset Windows-CI-portit. |
| Hyväksytty Linux-CI | System, Vite ja Chromium hyväksytyn CI-testisession sisällä. Todelliset mekanismiesiehdot varmennetaan ennen työkuormaa. |
| Paikallinen Linux tai WSL | Ei hyväksyttyä paikallista E2E-prosessinomistajaa. Tämä ei estä muuta kehitystyötä WSL:ssä eikä tarkoita, että Windows-ajo olisi Linux-näyttöä. |
| Muut Electron-alustat | Electron-E2E hylätään ennen resurssien varausta; tuki on nyt Windows-only. |

Linux-omistaja vaatii `EKY_E2E=1`, `CI=true`, `GITHUB_ACTIONS=true` ja
validoidun nonroot-identiteetin sekä varsinaiset käyttöjärjestelmäesiehdot.
Lippujen asettaminen ei tee paikallisesta ympäristöstä hyväksyttyä CI:tä.
Puuttuva esiehto on hylkäys, ei onnistunut skip tai lupa vaihtaa fallbackiin.
Uusi alustatuki tai oikeusmuutos käsitellään erillisenä päätöksenä.

## Koko prosessipuun omistajuus

Pääprosessin poistuminen, vapaa portti tai onnistunut kill-kutsu ei yksin
todista koko puun poistumista. Omistajuus säilyy käynnistyksestä saman
sukupolven loppukuittaukseen, myös ennen yhteyden valmistumista ja rootin
poistuttua. Vanhaa PID-/process-group-only-siivoamista ei palauteta
rinnakkaiseksi fallbackiksi.

### Windows

Nykyinen omistaja liittää prosessin Jobiin atomisesti jo luonnissa,
varmentaa jäsenyyden ennen resumea ja säilyttää alkuperäisen prosessikahvan.
`processTreeAbsent` vaatii suljetun
launch-portin, päättyneen luonnin, poistuneen tai luomatta jääneen rootin,
tyhjän Jobin ja valmistuneen stdio-siivoamisen. Kutsuja varmentaa lisäksi
kontrollikanavan ja ownerin sulun; loopback-portti tarkistetaan erikseen.
Sopimus ei muutu todeksi vain siksi, että Playwright-yhteys sulkeutui.

Palveluomistaja on [startOwnedWindowsService](../../apps/e2e/src/environment/startOwnedWindowsService.ts).
Electronin [fixture](../../apps/e2e/src/fixtures/isolatedElectronTest.ts)
säilyttää bridge-omistajan jo ennen Playwright-yhteyden valmistumista.
Playwrightin bridge-kahva ja todellisen Electron-työkuorman prosessikahva
ovat eri asioita. Käynnistys käyttää hyväksyttyä rajattua Playwright-patchia;
patchin versionvaihto tarvitsee sen sopimusten uudelleentodennuksen.

### Linux-CI

Omistaja käyttää kertakäyttöistä transient-unitia ja kiinteää
systemd -> unshare -> setpriv -ketjua. Node, Playwright ja työkuorma
käynnistyvät vasta oikeuksien pudotuksen jälkeen. Namespace-initin PID 1,
odotetut UID/GID-arvot, tyhjät lisäryhmät, `NoNewPrivs` ja nollatut
capability-joukot tarkistetaan. Tämä on rajattu CI-testisopimus, ei yleinen
sandbox-lupaus. Hostin oikeuksia ei korjata eikä user-namespace-fallbackia
oteta käyttöön testin läpäisemiseksi.

Poistumistodiste sitoo saman generationin `InvocationID`:n ja alkuhetken,
kontrolliprotokollan sulun, namespace-init/wait-ketjun ja täsmällisen
wrapperin terminal-havainnon. Root-exit, `populated=0`, unitin katoaminen
tai onnistunut emergency-stop eivät yksin oikeuta juuren poistoon.
Omistavat [käynnistysketju](../../apps/e2e/experiments/processOwnership/linuxServiceManager.mjs)
ja [siivousketju](../../apps/e2e/experiments/processOwnership/linuxServiceSession.mjs)
ovat edelleen kyseisessä lähdepolussa; kansion nimi ei tee nykykuluttajien
käyttämästä sopimuksesta valinnaista koetta.

### Chromiumin worker- ja testikohtainen eristys

Yksi Playwright-worker omistaa yhden yhteisen Chromium-selaimen.
Jokainen testi saa oman contextin ja pagen sekä oman tietokannan,
sessionin ja backend/Vite-palvelut. Testien business-dataa tai selaincontextia
ei jaeta. Selaimen profiili, temp ja hallintatiedostot ovat erillisessä
workerin OS-temp-juuressa.

Testijuuri poistetaan vasta contextin, palvelujen ja artifact-keräyksen
valmistuttua. Worker-juuri poistetaan vasta selaimen koko puun ja yhteyden
varmennetun sulun jälkeen. Julkinen selainyhteys muodostetaan ennen
testikohtaista tracea; yksityistä ohjausosoitetta ei julkaista.
Omistavat [selainyhteys ja sulku](../../apps/e2e/src/environment/connectOwnedChromium.ts)
sekä [worker-admission](../../apps/e2e/src/fixtures/chromiumWorkerAdmission.ts)
pitävät alustamekanismin poissa liiketoimintatestistä.

Sama monotonic-lifetime kulkee fixturen setupin ja restartien läpi.
Worker-vaihto ei uusi Chromiumin alkuperäistä aikabudjettia. Epävarma cleanup
säilyttää admission-merkin ja estää korvaavan workerin samassa ajossa;
uusi worker ei saa muuttaa epäonnistumista onnistuneeksi retryksi.
Containment-katto ja jäljellä oleva testiaika ovat eri rajoja.
Cleanupin määräaika lukitaan kerran; se saa tiukentua, mutta toistettu stop
ei uusi tai pidennä sitä. Työbudjetin loppuminen ei yksin estä cleanupin
todentamista sille varatussa ajassa. Terminal, kanavan ja ownerin sulku
sekä myös myöhäisen Chromium-yhteyden todellinen sulkeutuminen on
varmennettava alkuperäisen cleanup-rajan sisällä.
Historiallisen LM-kokeen 5/10/1 sekunnin rajoja ei käytetä nykykuluttajien
yleisinä aikarajoina.

### Omistajuuden regressioportti

[Pysyvä T3-matriisi](r0-e2e-test-matrix.md#t3-prosessipuun-omistajuus)
omistaa pakolliset root-exit-, late-fork-, launch-/resume-/control-loss-,
restart-, virheprioriteetti- ja todellisten kuluttajien katkeamistapaukset.
PID-uudelleenkäytön simulaatio ja todellinen prosessikoe todistavat eri
asioita; käyttöjärjestelmän PID-avaruutta ei pakoteta loppuun.

Omistajan muutos vaatii pure-contract- ja oikeaprosessinäytön sekä oikeiden
kuluttajien regressiot samalle lähteelle. Nykyiset workspace/typecheck-,
Linux system/web-, Windows Electron- ja soveltuvat installer-portit säilyvät.
Ajokytkentä ja puhtaan valmistelun suoja tarkistetaan samalla.
Erillinen koetulos ei yksin hyväksy fixturen todellista kytkentää.
Tuotantolifecycle, packaged-artifact ja profiilin sopimus ovat erillisiä
hyväksyntärajoja; niitä ei muuteta testiharness-työn sivuvaikutuksena.

## Testikohtainen runtime

Nykyinen konfiguraatio käyttää yhtä workeria. Testikohtainen runtime saa
oman juuren; yhteisen Chromium-workerin juuri on tästä erillinen:

```text
<os-temp>/eky-e2e/run-<id>/<scenario-id>/
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

Omistaja välittää alkuperäisen OS-temp-ankkurin `EKY_E2E_OS_TEMP_ROOT`-
arvona, erillään lapsen omista eristetyistä `TEMP`/`TMP`-hakemistoista.
[Backendin](../../apps/backend/e2e/e2eBackendConfig.ts) ja
[Viten](../../apps/web/viteE2eRuntime.ts) readerit varmentavat, että nämä
kirjoitettavat hakemistot kuuluvat samaan `run-*`-juureen, eivät sisartestiin.
Backend torjuu OS-temp-ankkurin ja `EKY_ELECTRON_E2E_RUN_ROOT`-ohituksen
yhdistelmän. Moduulin testi ei aseta näitä ankkureita itse.

Backup/restore-testien eristetyt hakemistot ja installer-harnessin omat
`backups`-, `recovery-points`-, `staging`- ja `update`-polut kuuluvat
omistavan testifixturen validoituun juureen. Niitä ei saa koskaan osoittaa `%APPDATA%\Eky`-
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

Testijuuri poistetaan vasta sen omien context-, API-, palvelu-, portti- ja
artifact-vastuiden valmistuttua ilman aiempaa cleanup-epävarmuutta.
Jaettu Chromium-worker voi jatkaa seuraavaan testiin; sen erillinen juuri
poistetaan vasta workerin omien sulku- ja puutodisteiden jälkeen.
Worker-virhe ei yksin määrää jo turvallisesti siivotun testijuuren säilytystä.
Windowsissa Electron-testijuuri vaatii oman Electron-/backend-puunsa
pysäytyksen ja loopback-portin vapautumisen. Poisto hyväksyy vain realpath-tarkistetun suoran
`eky-e2e/run-*`-hakemiston. Rajattu tiedostojärjestelmä-retry saa käsitellä
vain Windowsin hetkellistä kahvan vapautumista; pysyvä `EPERM` tai muu
cleanup-virhe epäonnistaa testin eikä sitä nielaista.

Satunnaisia odotuksia tai `waitForTimeout`-kutsuja ei käytetä valmiuden
todistamiseen. Nimetty backend-startupin enimmäisaika on vain fail-closed-
turvaraja. Electron-testin oma enimmäisaika koostetaan mahdollisen synteettisen
backend-fixturen, Electron-yhteyden, ensimmäisen ikkunan, sulkemisen ja
skenaarion turvabudjeteista; mikään näistä ajoista ei ole onnistumisen
valmis-signaali.

Electronin julkisen sulun jälkeen suoritetaan aina omistajan stop ja
koko puun poistumisen varmennus, myös sovelluksen jo sulkeuduttua tai
Playwright-sulun epäonnistuttua. Tämä ei ole pelkkä puuttuvan root-exitin
timeout-fallback. [Sulun omistaja](../../apps/e2e/src/fixtures/closeOwnedWindowsElectronRuntime.ts)
erottaa julkisen close-virheen koko puun siivouksesta; kiinteä odotus ei
ole kummankaan onnistumissignaali.

Julkisen sulun ensimmäinen hylkäys säilyy nykyisen lifecycle-liitteen
valinnaisessa `publicCloseFailure`-kentässä: `failed` tai `timedOut` sekä
testin sisäinen `startupGeneration`. Havainto tallennetaan vain muistiin
ennen omistajan stop-kutsua; siivouksen myöhempi virhe ei hävitä sitä.
Havaintopoikkeus ei estä stop-kutsua tai korvaa alkuperäistä virhettä.
Fixturen yleinen cleanup-hylkäys, omistajuustodiste ja porttitulos säilyvät
erillisinä. `failed` voi tarkoittaa myös sulkukellon validointivirhettä,
eikä kumpikaan luokka yksin nimeä sovelluksen juurisyytä. Puuttuvasta
havainnosta ei päätellä onnistunutta sulkua. Turvallinen CI-projektio
hyväksyy vain samasta katalogista nimetyt luokat ja positiivisen sukupolven;
raakaa poikkeusta, polkua tai prosessitietoa ei lisätä julkaistavaan raporttiin.

Electron-fixture erottaa `playwrightConnect`-, `firstWindow`- ja
`domContentLoaded`-vaiheet. Virheen luokka perustuu Playwrightin timeout-tyyppiin
tai havaittuun prosessin poistumiseen / sivun sulkeutumiseen; tuntematon syy
säilyy tuntemattomana. Windows-bridgen synkronisesta valmisteluhylkäyksestä
säilyy lisäksi rajattu syyluokka ilman yksityistä virhettä.
Vaihehavainto ei muuta aikarajoja eikä toimi readiness-
signaalina. Bridge-omistaja säilytetään jo ennen yhteyden valmistumista;
valmistunut yhteys luovutetaan fixturelle ennen ikkunan odottamista.
Todellisen työkuorman tilaa ja cleanupia luetaan säilytetyltä omistajalta,
ei uudella process-kutsulla jo suljetusta Playwright-yhteydestä.
Myös restart käyttää nykyistä omistetun runtimen
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

V1:n rajattu toteutus täydentää tätä ketjua. Revisiokohtainen näyttö ja
integraation tila ovat [M1:n omistavassa checkpointissa](release-0.3.0-m1-preparation-plan.md#v1bn-toteutus-ja-todennus).
Testibackend luokittelee alkuperäisen poikkeuksen ennen brokerien sulkemista.
Status sisältää vain omistavan katalogin `reason`-arvon tai `unknown`:in,
vaiheen ja erillisen `brokerCleanupFailures`-luettelon. Kaikki omistetut
brokerit yritetään sulkea, vaikka yksi sulku epäonnistuisi. Viestin
toimitusvirhe ei muutu onnistuneeksi käynnistykseksi.

Controller säilyttää ensimmäisen hyväksytyn failure-viestin ja backendin
suoritusyrityksen (`backendAttempt`). Sama tiukka parseri tarkistaa native-
kirjoittajan ja lukijan rakenteen. Vaihevirhekoodin ja rakenteisen vaiheen on
vastattava toisiaan; myöhemmän virheen syytä ei lainata ensimmäiseen.
Fixturen `firstLaunchFailure` säilyttää ensimmäisen epäonnistuneen vaiheen,
luokan ja testin sisäisen käynnistyskerran (`startupGeneration`) riippumatta
vaiheluettelon täyttymisestä. Puuttuva sukupolvi on `null`, ei arvattu numero.
Playwrightin `attempt` erottaa testin suoritusyritykset; mikään näistä ei ole
asiakasyrityksen tai runtime-sessionin tunniste. Onnistuva käynnistys ei
käynnistä virheen lisähavaintoa.

Ketjun rajattu oikeaprosessikoe käyttää vain Electron-fixturen
`e2eBackendStartupFault: 'missingIncidentsDirectory'` -valintaa. Se muuttaa
backendin testikonfiguraation incident-polun olemattomaan alihakemistoon
testin oman incident-juuren sisällä; mitään ei poisteta eikä uutta
palvelua käynnistetä. Oletus on `none` ja desktopin startupMode pysyy
`normal`-tilassa. Backendin todellinen reader tuottaa `ENOENT`:in utility-
prosessissa. Koe odottaa normaalia setup-hylkäystä ennen testirunkoa ja
varmentaa syyn, yrityssidonnan ja cleanupin lopullisesta raportista;
pelkkä exit 1 tai odotetuksi merkitty testihylkäys ei riitä näytöksi.
Tavalliset moduulitestit eivät käytä tätä infrastruktuurin vikavalintaa.

V1b käyttää samaa lifecycle-sisältöä tiedostossa ja Playwrightin
muistiliitteessä. Sen `reportElectronLifecycleEvidence.ts`-apuri omistaa
raportin muodostuksen ilman sovelluspakettien runtime-importteja;
Electron-fixture käyttää samaa toteutusta. Raportoinnin sopimustesti ei
lataa koko runtime-fixtureä eikä edellytä backendin tai auth-paketin
valmista buildia. CI-raportoija ei avaa liitepolkuja eikä jäsennä raakaa
poikkeusta: se projektoi rajatusta muistiliitteestä suoritusyrityksen,
käynnistyskerran, vaiheen, native-havainnon saatavuuden, katalogin mukaisen
backend-syyn, alkuperäisen exit-koodin ja erilliset cleanup-tulokset.
Backendin syykatalogi on yhteinen lähettäjälle ja raportoijalle.
Native-lukijan virhekoodit ovat lajiteltu joukko, eivät tapahtumajärjestys.
Projektio tarkistaa syyn vaihevirhekoodin kuulumisen tähän joukkoon;
ensimmäisen syyn valinta kuuluu native-lukijalle. Ilman ensimmäisen
tapahtuman tunnettua syytä projektio ei käytä myöhemmän tapahtuman syytä.
Puuttuva, virheellinen, liian suuri tai väärän yrityksen liite ei muutu
arvatuksi syyksi. CI:n testitulos ja flaky-hylkäys säilyvät ennallaan.

Tiedostokirjoitus ja muistiliitteen toimitus yritetään kumpikin kerran;
toisen epäonnistuminen ei estä toista. Suljetut `fileWriteFailed`-,
`attachmentFailed`-, `captureFailed`- ja `reportFailed`-merkinnät kulkevat
testin suoritusyrityskohtaisissa metadatahavainnoissa ilman raakavirhettä.
Alkuperäinen testivirhe pysyy ensisijaisena. Jos varsinainen testi onnistui
mutta todisteen julkaisu epäonnistuu, testi ei saa hyväksyntää.

Jokainen tavallinen Playwright-komennon käynnistys saa oman
`test-results/run-<uuid>`- ja `playwright-report/run-<uuid>`-hakemistonsa.
Saman komennon workerit ja retryt käyttävät samaa run-juurta, jonka alla
Playwright erottaa testit ja suoritusyritykset. Uusi CLI-ajo ei hyväksy
vanhaa perittyä run-tunnistetta. Nykyiset build-siivoukset eivät omista näitä
hakemistoja. Erillinen `--output`-valinta jää kutsujan vastuulle: saman
manuaalisen hakemiston uudelleenkäyttö voi edelleen poistaa aiempaa näyttöä.
Paikallinen HTML-override on vastaavasti kutsujan vastuulla; CI estää sen
sekä JSON-reporterin ympäristöohjaukset. Ajokohtainen yksityinen
`results.private.json` säilyttää alkuperäiset virheet, stdout/stderr-kentät
ja kaikki retry-tulokset samalla nykyisellä Playwright-reporterilla.
CI:n salaamaton julkaisu kattaa edelleen vain nimetyt turvalliset lifecycle-JSONit
samalla yhden päivän säilytysajalla, ei koko ajohakemistoa.

Valinnainen [salattu virheaineisto](ci-encrypted-evidence.md#testiperheiden-virheaineisto)
on pakollisesta lifecycle-todisteesta erillinen. Sen fixturekohtaiset
`backend-startup.private.json`- ja `process-output.private.json`-tiedostot
luetaan nykyisistä rajatuista redaktoiduista puskureista jälkiraportoinnissa.
Kirjoitus-/liitevirhe merkitään saatavuushavaintoon eikä korvaa ensivirhettä.
Windows-Electronin omistajaprosessin tulostetta ei nimetä workloadin omaksi
tulosteeksi. JSON-raportista salataan vain määritelty virhetietoprojektio,
ei konfiguraatiota tai inline-liitteiden sisältöä. Tämän toimituksen puute
ei muuta sovellustestiä onnistuneeksi eikä itsessään todista sovellusvikaa.

Epäonnistuneen testin tai epäonnistuneen capture-vaiheen lähdejuuri jää
talteen riippumatta raportoinnin onnistumisesta. Prosessien ja porttien
siivous yritetään silti; tahallinen aineiston säilyttäminen ei tarkoita
prosessisiivouksen epäonnistumista. Tavallinen onnistunut testi poistaa
juurensa varmennetun siivouksen jälkeen. Pelkkä sen jälkeinen raportointivirhe
ei palauta jo poistettua onnistuneen ajon juurta; se ei myöskään muuta
todistamatonta raporttia hyväksytyksi. Tämä erotetaan aiemmin epäonnistuneen
ajon ensivirheen säilyttämisestä.

V1b:n sopimus- ja prosessirajan näytöt eivät yksin hyväksy Electron-päivitystä
tai integraatiota. Niiden ajantasainen tila ylläpidetään M1-checkpointissa,
ei tämän teknisen sopimuksen rinnakkaisena työjonona.

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
`preparation.backend.lastHealthProbe` säilyttää viimeisen valmistuneen
valmiuskyselyn luokan: `healthy`, `connectionRefused`, `requestTimedOut`,
`responseNotOk` tai `transportFailed`. `notObserved` tarkoittaa, ettei
valmistunutta kyselyhavaintoa ole; kesken oleva kysely ei ole aikakatkaisu.
Kyselyn oma aikaraja erotetaan kutsujan peruutuksesta. `healthy` kertoo
vain kyselyn vastauksesta, ei koko käynnistyksen tai omistajan hyväksynnästä.
Havainto päivittyy vain muistissa ja jäädytetään ennen siivousta; myöhäinen
tulos ei korvaa ensivirheen aineistoa. Ei uutta kirjoitusta tai kuittauksen
odotusta kriittiselle polulle. Vastauskoodia, bodya, otsakkeita tai raakaa
transport-virhettä ei julkaista. Luokka on lisähavainto, ei juurisyy.
Rajatut regressiot kattavat [kyselyn luokat ja peruutuksen](../../apps/e2e/tests/system/httpHealthProbeEvidence.spec.ts),
[backend-kytkennän ja jäädytyksen](../../apps/e2e/tests/system/e2eBackendStartupLifecycle.spec.ts)
sekä [lopullisen lifecycle-liitteen](../../apps/e2e/tests/system/electronFixtureLifecycle.spec.ts).
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

Ennen siivousta kerättävä `nativeStartupFailure` säilyttää lisäksi nykyisen
sukupolven natiiviadapterin suljetut virhekoodit, vaikka main-yhteys olisi jo
katkennut. Testibackendin kuusi vaihevirhettä luetaan niiden omistajan
`electronE2eBackendStatus`-määrittelystä täsmällisellä jäsenyystarkistuksella.
Muut `DESKTOP_SMOKE_`-koodit, myös tunnettuun koodiin liitetty vapaa pääte,
pelkistetään edelleen `PACKAGED_SMOKE_FAILED`-koodiksi. Tuotannon oma
virhekoodisuodatin ei muutu. Lukija rajaa tiedoston 64 KiB:iin ja 128 riviin;
linkki-, sukupolvi- ja muuttuvan lähteen tarkistukset säilyvät. Raakatekstiä,
polkuja tai runtime-tunnisteita ei kopioida lifecycle-liitteeseen.
`SYS-ELECTRON-NATIVE-STARTUP-001` todistaa jokaisen vaihevirheen ketjun
natiiviwriteristä kaappauksen ja cleanupin yli liitteeseen. Havainto ei ole
uusi valmiusehto eikä yksin todista käynnistysvirheen juurisyytä.

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

Paikallista, yksityistä vianhakua varten epäonnistumisesta voidaan säilyttää:

- Playwright-trace ja kuvakaappaus
- rajattu prosessiloki
- synteettinen SQLite-kanta
- synteettiset JSONL-lokit ja tukipaketti
- validoitu fault plan
- scenario ID, sovellusversio ja build revision

Artefakti ei saa sisältää oikeaa salasanaa, runtime-sessionia, AppData-polkua,
asiakasdataa tai ulkoisesta järjestelmästä saatua sisältöä. Videoita ei
tallenneta R0:ssa.

Paikallisen artifactin syntyminen ei ole julkaisulupa. CI julkaisee vain
kyseisen työnkulun erikseen salliman turvallisen aineiston; esimerkiksi
Electronin lifecycle-artifact ei sisällä koko `test-results`-kansiota tai
tracea. Noudata aina [julkaisurajaa](security-principles.md#omistajan-tietojen-julkaisuraja)
ja [ensivirheen seurantaohjetta](../ai/workflow.md#ci-ajon-seuranta-ja-virhetodisteet).

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
