# Electron 43 ja better-sqlite3 13 -yhteensopivuussuunnitelma

Tämä dokumentti rajaa Eky Localin hallitun yhteensopivuuspäivityksen:

- `electron` `42.8.0` -> `43.2.0`
- `better-sqlite3` `12.11.1` -> `13.0.2`

Päivitys tehdään erillisellä
`electron-43-sqlite13-compatibility`-haaralla lähtöcommitista
`205df297d7c1fbc6ad5d30525c472f943ddfed65`.

Työ ei muuta Eky-tuoteversiota `0.1.0-alpha.1`. Dependabotin Electron 43
-pull requestia ei käytetä toteutuksen pohjana eikä yhdistetä. Hallittu
päivitys toteutetaan tässä haarassa checkpoint kerrallaan.

## Miksi versiot päivitetään yhdessä

Electron 43 muuttaa Electron-runtimen Node- ja V8-yhdistelmää. Nykyinen
`better-sqlite3 12.11.1` ei sisällä Electron 43:lle sopivaa esikäännettyä
binääriä, joten yksittäinen Electron-päivitys rikkoo Windows-paketoinnin.

`better-sqlite3 13` käyttää N-API:a ja toimittaa tuetut native-binäärit
paketin mukana. Siksi päivityksessä poistetaan Eky-paketoinnin nykyinen
`prebuild-install`-pohjainen staged-uudelleenrakennus. Paketoitavan binäärin
alkuperä, versio, alusta, arkkitehtuuri ja tiedostorajat varmennetaan silti
ennen artefaktin hyväksymistä.

Viralliset tarkistuslähteet:

- Electron 43.2.0:
  <https://releases.electronjs.org/release/v43.2.0>
- Electronin tukiaikataulu:
  <https://releases.electronjs.org/schedule>
- better-sqlite3 13.0.0 N-API -muutos:
  <https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0>
- better-sqlite3 13.0.1:
  <https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.1>
- better-sqlite3 13.0.2:
  <https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.2>

## Hyväksytty rajaus

Tässä työssä saa muuttaa vain:

- `apps/desktop`-paketin Electron-version tarkasti versioon `43.2.0`
- `apps/backend`-paketin better-sqlite3-version tarkasti versioon `13.0.2`
- näistä syntyvän pnpm-lockfile-diffin
- Windows-paketointia ja Electron-E2E-valmistelua, jotta ne käyttävät
  better-sqlite3 13:n paketoitua N-API-runtimea
- muutoksen todentamiseen tarvittavia kohdennettuja testejä ja dokumentaatiota.

Tässä työssä ei:

- päivitetä Electron 44:ään
- päivitetä Node 25/26:een tai `@types/node`-pääversiota
- päivitetä Playwrightia tai muita riippuvuuksia
- lisätä pnpm overridea
- lisätä uutta npm-riippuvuutta
- käännetä native-moduulia loppukäyttäjän koneella
- muuteta domain-, API-, tietokanta- tai käyttöliittymäsopimuksia
- muuteta Eky-tuoteversiota.

## Lähtötaso

Lähtötaso tarkistettiin Windowsissa 3.8.2026 ennen riippuvuusmuutoksia.

### Runtime

| Komponentti | Lähtötaso |
| --- | --- |
| Eky | `0.1.0-alpha.1` |
| Electron | `42.8.0` |
| Electron Node | `24.18.0` |
| Chromium | `148.0.7778.280` |
| V8 | `14.8.178.38-electron.0` |
| Electron N-API | `10` |
| better-sqlite3 | `12.11.1` |
| better-sqlite3:n SQLite | `3.53.2` |
| Workspace-binding | `better-sqlite3/build/Release/better_sqlite3.node` |
| Paikallinen Node | `24.11.0` |
| pnpm | `11.1.3` |

Paketoidun backend-prosessin valmis-tilaan kului eristetyssä packaged-smokessa
851 ms. Koko packaged-smoke valmistui 965 ms:ssa. Mittaus käytti synteettistä
dataa ja testin omistamaa Windowsin temp-profiilia, joka poistettiin ajon
jälkeen.

### Tarkistukset

- `pnpm install --frozen-lockfile`: onnistui
- `pnpm audit --prod`: ei tunnettuja haavoittuvuuksia
- `pnpm audit`: ei tunnettuja haavoittuvuuksia
- `pnpm audit signatures`: 201 paketin rekisteriallekirjoitus varmennettu
- workspace-testit: onnistui
- typecheck: onnistui
- backend-, web- ja desktop-buildit: onnistuivat
- system E2E: 42/42
- web E2E: 41/41
- security E2E: 24/24
- fault E2E: 15/15
- critical E2E: 50/50
- Electron critical E2E: 17/17 kahdesti
- Windows-paketointi: onnistui
- packaged-smoke: onnistui kahdesti samalla artefaktilla.

Desktop-stress- ja 30 minuutin soak-lähtöarvot ovat dokumentissa
`docs/architecture/e2e-desktop-endurance-baseline.md`. Päivityksen jälkeisiä
mittauksia verrataan Electron 42.8.0 -lähtötasoon, ei aseteta yhden ajon
perusteella uutta yleistä muistirajaa.

## Checkpointit

### A. Lähtötaso ja suunnitelma

- lukitse nykyiset versiot, testit, auditit, runtime-arvot ja Windows-smoke
- kirjaa rajaus ja pysäytysehdot tähän dokumenttiin
- älä muuta vielä riippuvuuksia.

### B. Tarkat riippuvuuspäivitykset

- päivitä vain Electron `43.2.0` ja better-sqlite3 `13.0.2`
- aja tavallinen `pnpm install`
- tarkista manifesti- ja lockfile-diffi
- varmista, että `prebuild-install` poistuu tästä riippuvuusketjusta
- varmista, ettei mukaan tule node-gyp-käännöstä, telemetryä, overridea tai
  muuta hyväksymätöntä pakettia
- aja auditit, allekirjoitustarkistus ja `pnpm why`.

### C. Paketoitu SQLite N-API -runtime

- poista pnpm-virtuaalivaraston skannaus ja `prebuild-install`-ajo
- ratkaise staged better-sqlite3 paketinhallinnan normaalilla
  moduuliresoluutiolla
- varmista realpath, pakettiversio, Windows x64 -loader ja native-tiedosto
- torju puuttuva binääri, väärä versio, väärä arkkitehtuuri, symlinkki ja
  rajaton tai epätavallinen native-tiedosto
- älä karsi muiden alustojen paketoituja prebuild-tiedostoja
- todista paketoidussa backendissä oikea `require`, luku, kirjoitus ja
  transaktio ilman kääntäjää tai verkkoa.

### D. Tietokantayhteensopivuus

- luo synteettinen tyhjä tietokanta ja aja kaikki migraatiot
- tarkista `integrity_check`, `foreign_key_check`, liiketoimintapolut ja
  uudelleenkäynnistys
- tee nykyisestä paikallisesta tietokannasta tavutasoinen temp-kopio
- laske alkuperäisen SHA-256 ennen ja jälkeen
- avaa ja migroi vain kopiota
- tarkista eheys, viiteavaimet, taulukoiden lukumäärät ja rollback
- älä tulosta tietueiden sisältöä, henkilötietoja tai alkuperäistä polkua.

Jos paikallisen tietokannan polkua ei voida ratkaista luotettavasti backendin
nykyisestä konfiguraatiosta, työ pysäytetään ja omistajalta pyydetään polku.
Käyttäjäprofiilia ei etsitä rekursiivisesti.

Checkpoint D valmistui 3.8.2026:

- kaikki 38 migraatiota ajettiin synteettiselle tyhjälle tietokannalle
- synteettinen E2E-elinkaari kattoi yritysasetukset, asiakkaan,
  laskuluonnoksen, hyväksynnän, PDF-metadatan, manuaalisen toimituksen,
  maksumerkinnän, täyden hyvityksen, numerointisarjan vaihdon ja backendin
  uudelleenkäynnistyksen
- `integrity_check`, `foreign_key_check`, transaktion rollback sekä
  sulkemisen jälkeinen uudelleenavaus onnistuivat
- suljetusta paikallisesta tietokannasta tehtiin tavutasoinen väliaikainen
  kopio; vain kopiolle ajettiin migraatiot ja kirjoittavat tarkistukset
- alkuperäisen tiedoston SHA-256 säilyi muuttumattomana ennen ja jälkeen
  kopiotarkistuksen
- nykyisten liiketoimintataulujen rivimäärät säilyivät migraatiossa
  muuttumattomina; paikallisen kannan sisältöä, polkua tai hashia ei
  tulostettu eikä kirjattu dokumentaatioon
- käytetty SQLite-runtime oli `3.53.4`; päivityksessä ei havaittu Ekyyn
  vaikuttavaa SQL-, migraatio-, transaktio- tai close/reopen-regressiota.

### E. Electron 43 -ominaisuudet ja Windows-artefakti

- varmista runtime-session, ActorContext, preload/IPC, navigointirajat ja fuses
- varmista safeStorage, salaisuusbrokeri, fake SMTP ja PDF-esikatselu
- avaa ja sulje PDF-esikatselu 100 kertaa
- varmista tukipaketti, operational-lokit, restartit, prosessien sulkeutuminen
  ja porttien vapautuminen
- paketoi Windows x64
- aja packaged-smoke vähintään kolmesti: ensin puhtaalla profiililla ja kaksi
  kertaa samalla paketilla
- älä hyväksy tulosta, joka onnistuu vain retryllä
- älä tee oikeaa DNA SMTP -verkkotestiä tässä työssä.

Checkpoint E valmistui 3.8.2026:

- Electron main process varmisti runtimeversiot Electron `43.2.0`, Node
  `24.18.0`, Chromium `150.0.7871.129`, V8
  `15.0.1240245-electron.0` ja N-API `10`
- desktopin 165 testiä sekä desktop- ja E2E-typecheck onnistuivat
- Electron critical E2E oli 18/18 vihreä kahdella peräkkäisellä ajolla ilman
  retryä
- critical-polku varmisti runtime-sessionin, ActorContextin, rajatun
  preload-rajapinnan, profiili- ja navigointirajat, safeStoragen,
  salaisuusbrokerin, PDF-esikatselun, tukipaketin, operational-lokit,
  restartin ja laskunumerosarjan natiivin vahvistuksen
- desktop-stress avasi ja sulki PDF-esikatselun 100 kertaa sekä palautui
  lopussa viiteen Electron-prosessiin ja yhteen pääikkunaan ilman avoimia
  PDF-ikkunoita
- Windows x64 -paketti rakennettiin Electron `43.2.0`:lla ja
  better-sqlite3 `13.0.2` / SQLite `3.53.4` -runtimella
- sama paketti läpäisi packaged-smoken kolmesti peräkkäin erillisillä
  puhtailla testiprofiileilla ilman retryä
- oikeaa SMTP-yhteyttä, oikeita salaisuuksia tai oikeaa asiakasdataa ei
  käytetty.

### F. Stress ja soak

- aja desktop-stress
- aja 30 minuutin desktop-soak
- vertaa prosessi-, ikkuna-, working set-, startup-, SQLite-, dokumentti- ja
  lokimittareita Electron 42.8.0 -lähtötasoon
- varmista, ettei prosesseja, portteja tai testiprofiileja jää käyttöön.

Checkpoint F valmistui 3.8.2026:

- desktop-stress valmistui 61 379 millisekunnissa samalla kuormalla kuin
  Electron 42.8.0 -lähtötaso
- stressin prosessimäärä palautui `5 -> 5`, ikkunamäärä yhteen ja working set
  laski `450 072 -> 442 884 KiB`
- täysi 30 minuutin soak teki 3 250 työkiertoa, 325 runtime-restarttia ja 650
  tukipakettia
- soakin prosessimäärä palautui `5 -> 5`, ikkunamäärä yhteen ja working set
  laski `454 164 -> 452 992 KiB`
- backend oli lopussa terve eikä avoimia PDF-ikkunoita tai
  salaisuustiedostoa jäänyt
- tulokset eivät osoittaneet Electron 43 -päivityksen aiheuttamaa
  prosessi-, ikkuna- tai working set -vuotoa
- vertailusta ei asetettu yhden ajon perusteella uutta yleistä muistirajaa
- tarkat tulokset kirjattiin dokumenttiin
  `docs/architecture/e2e-desktop-endurance-baseline.md`.

### G. Dokumentointi ja release-portti

- päivitä desktopin dependency review, toteutussuunnitelma, README,
  endurance-tulokset, lisenssit ja E2E-matriisi
- pidä CI ja kaikki vaaditut tarkistukset vihreinä
- Dependabot-PR #180 suljetaan vasta hallitun korvaavan PR:n avaamisen jälkeen
- muutosta ei merkitä tuotantovalmiiksi ennen dokumentoitua release-porttia.

Paikallinen checkpoint valmistui 3.8.2026:

- dependency review, toteutussuunnitelma, desktop README,
  riippuvuusturvallisuuden historiallinen baseline, lisenssit,
  endurance-baseline ja E2E-matriisi kuvaavat toteutunutta Electron 43 /
  better-sqlite3 13 N-API -mallia
- `pnpm install --frozen-lockfile` onnistui ilman muutoksia
- production- ja full-audit eivät raportoineet tunnettuja haavoittuvuuksia,
  ja 167 asennetun paketin rekisteriallekirjoitukset varmennettiin
- riippuvuuspuussa oli yksi Electron `43.2.0` ja yksi better-sqlite3 `13.0.2`
- workspace-testit olivat vihreät: backend 1132, web 569, API-client 140,
  desktop 165 sekä auth- ja permission-testit
- workspace-typecheck sekä backend-, web- ja desktop-buildit onnistuivat;
  API-clientillä ei ole erillistä build-skriptiä, joten sen sopimus
  varmennettiin testeillä ja typecheckillä
- system E2E oli 43/43, web E2E 41/41, security E2E 24/24, fault E2E 15/15,
  system/web critical 51/51 ja Electron critical 18/18
- Windows x64 -paketointi validoi better-sqlite3 `13.0.2` / SQLite `3.53.4`
  -runtimen ja paketoitu smoke läpäisi ajon ensimmäisellä yrityksellä
- checkpoint E:n sama Windows-artifact läpäisi lisäksi kolme peräkkäistä
  packaged-smoke-ajoa
- paikallisen tietokannan turvallinen kopiotarkistus säilytti alkuperäisen
  tiedoston hashin ja läpäisi migraatio-, foreign key-, integrity- ja
  rollback-tarkistukset
- stressi- ja 30 minuutin soak-ajot eivät osoittaneet prosessi-, ikkuna- tai
  working set -vuotoa.

GitHub CI ja Dependabot-PR:n sulkeminen tehdään vasta, kun hallittu haara
pushataan ja korvaava PR avataan. Tämä paikallinen checkpoint ei poista
installer-, code signing-, automaattipäivitys- tai muuta release security gate
-vaatimusta eikä merkitse artifactia tuotantovalmiiksi.

## Pakolliset pysäytysehdot

Työ pysäytetään välittömästi ennen seuraavaa checkpointia, jos:

- auditissa tai allekirjoitustarkistuksessa syntyy ratkaisematon löydös
- lockfileen tulee hyväksymätön riippuvuus, override tai asennusskripti
- Windows x64 -native-binääri puuttuu tai sen alkuperää ei voida todentaa
- paketointi tarvitsee verkkoa, Pythonia, Visual Studio Build Toolsia tai
  node-gyp-käännöstä ajon aikana
- tietokannan alkuperäisen tiedoston hash muuttuu
- migraatio, `integrity_check` tai `foreign_key_check` epäonnistuu
- testit käyttävät oikeaa asiakasdataa, SMTP-salaisuutta tai ulkoista SMTP:tä
- sandbox-, preload-, IPC-, navigointi-, session-, tenant- tai fuse-raja
  heikkenee
- packaged-smoke toimii vain uusinta-ajolla
- stress/soak jättää prosessin, portin tai testihakemiston käyttöön
- päivitys vaatii uuden riippuvuuden tai arkkitehtuuripäätöksen.

Pysäytyksen jälkeen löydös raportoidaan projektin omistajalle. Rajaa ei
kierretä omalla native-forkilla, salaamattomalla fallbackilla tai
turvallisuustarkistuksen poistamisella.
