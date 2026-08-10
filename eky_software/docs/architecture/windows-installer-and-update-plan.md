# Windows-asennin ja paikallinen päivitys

## 1. Tila

Arkkitehtuuripäätös on hyväksytty ADR-0010:ssä. ADR-0009:n salattu
backup/restore, recovery pointit, aktivointijournal ja Windows packaged
restore -todistus ovat toteutettu 4.8.2026. Installeria,
päivitysorkestrointia, code signingia tai update-UI:ta ei ole vielä toteutettu.
Installeriteknologiaa tai uutta riippuvuutta ei ole valittu.

10.8.2026 valmistunut teknologiakatselmus suosittelee R0-prototyypin
ensisijaiseksi ehdokkaaksi per-user Windows Installer -MSI:tä nykyisen
kovennetun Packager-outputin ympärillä. Tarkka WiX-versio, lisenssi ja uusi
build tool vaativat vielä projektin omistajan erillisen riippuvuuspäätöksen.
Suositus ei muuta ADR-0010:n hyväksyttyä rajaa eikä aloita toteutusta.

## 2. Tavoite

Eky Localille tehdään hallittu Windows-asennus- ja päivityspolku, joka:

- käyttää samaa release-artifactia puhtaaseen asennukseen ja päivitykseen
- pitää ohjelmabinaarit erillään yritysprofiilista
- ei käynnistä schemaa muuttavaa versiota ilman palautumispistettä
- tukee ensin paikallista tiedostoa tai USB-mediaa
- voidaan myöhemmin laajentaa allekirjoitettuun etäpäivitykseen

## 3. Omistajuus

Vastuut ovat:

- **release pipeline:** muodostaa versionoidun Windows-artifactin ja
  manifestin
- **external installer/updater:** asentaa ja tarvittaessa palauttaa binaarit
- **Eky Update Coordinator:** valmistelee sovelluksen sisäisen päivityksen
- **Backup/Restore:** muodostaa ja palauttaa pre-update-palautuspisteen
- **first-start maintenance:** validoi uuden buildin, migraatiot ja healthin
- **renderer:** näyttää tilan ja pyytää nimettyjä toimintoja

Update ei ole Company Settings -master dataa. Update Coordinator kuuluu
Electron mainin infrastructure-kerrokseen.

## 4. Luottamusrajat

Luottamusrajan ulkopuolelta tulevat:

- käyttäjän valitsema päivityspaketti
- paketin manifesti ja allekirjoitus
- tiedostojärjestelmän tila
- asentajan exit code ja sivuvaikutukset
- tulevaisuudessa verkosta ladattu metadata ja artifacti

Renderer ei saa välittää:

- tiedostopolkua
- URL:ia
- komentoriviä tai yksittäisiä prosessiargumentteja
- suoritettavan tiedoston nimeä
- release-manifestia luotettuna tietona
- runtime-sessionia

Electron main valitsee tiedoston native-dialogilla ja muodostaa ulkoisen
prosessin argumenttilistan ilman shell-merkkijonoa.

## 5. Puhdas asennus

Puhdas asennus:

1. validoi Windows-version ja arkkitehtuurin
2. asentaa vain release-binaarit ja staattiset resurssit
3. ei luo synteettistä yritysdataa production-profiiliin
4. jättää `userData`-juuren asennushakemiston ulkopuolelle
5. käynnistää Eky first-start-polun
6. muodostaa uuden tyhjän profiilin vain applicationin hallitulla
   bootstrapilla

Installer ei kirjoita suoraan SQLite-tauluihin.

### Production profile and packaging cleanliness -checkpoint

Ennen ensimmäistä installer-pilottia erotetaan ja todennetaan neljä runtimea:

- backend/browser-kehityksen `eky-dev.sqlite` tai development `.env` -polku
- testikohtainen private E2E `eky-e2e.sqlite`
- vain validoidulla switch+token-parilla aktivoituva packaged smoke tempissä
- normaali desktop `userData/runtime/data/eky.sqlite` ilman env-fallbackia

Nykyinen Windows-paketointi inventoi `applicationStage`-, `backendStage`-,
`desktopRuntimeStage`- ja lopullisen unpacked package -hakemiston. Pakettiin ei
saa päästä tietokantaa, lasku-PDF:ää, backupia, tukipakettia, lokia,
ympäristötiedostoa, salaisuutta, E2E-runtimea, fixtureä, testiä, lähdehakemistoa
eikä oikeaa käyttäjäprofiilia. Backend deployataan linkittömänä hoisted-
rakenteena, ja symboliset linkit torjutaan jokaisessa inventoidussa vaiheessa.
Packaged-smoke-helperit sallitaan vain täsmällisestä nimilistasta.

Normaali `package:windows` jää kehityskäyttöön. Erillinen
`package:windows:pilot` vaatii puhtaan ja HEADiin sidotun buildin, `pilot`-
kanavan, suljetun inventaarion ja validoidun pilot-sidecar-manifestin.
Kyse ei vielä ole installerista.

Paikallinen pilot-profiili auditoidaan Eky suljettuna copy-only-työkalulla.
Audit ei korjaa, nollaa tai tulosta business-dataa. Profiilin käsittelystä
päätetään vasta turvallisen luokituksen jälkeen.

## 6. Olemassa olevan asennuksen päivitys

Päivitys säilyttää saman sovellusidentiteetin ja `userData`-juuren. Asennin
korvaa vain binaarit, kun Eky-prosessit ja backend ovat suljettuina.

Asennin ei:

- siirrä business dataa asennushakemistoon
- poista profiilia tai palautuspisteitä
- aja SQL-migraatioita
- tulkitse lasku- tai asiakasdataa
- merkitse päivitystä hyväksytyksi

## 7. Sovelluksesta käynnistetty paikallinen päivitys

Käyttäjäpolku:

1. käyttäjä avaa `Tuki ja historia` -> `Sovellus ja päivitykset`
2. valitsee paikallisen Eky-sidecar-manifestin native-dialogilla
3. Update Coordinator tarkistaa paketin ja näyttää turvallisen yhteenvedon
4. käyttäjä vahvistaa päivityksen
5. Eky muodostaa pre-update-palautuspisteen
6. runtime suljetaan hallitusti
7. ulkoinen asentaja käynnistetään
8. Eky poistuu
9. asennin käynnistää uuden version tai pyytää käyttäjää käynnistämään sen
10. first-start maintenance hyväksyy tai hylkää päivityksen

R0:ssa päivitystä ei käynnistetä automaattisesti ilman käyttäjän vahvistusta.

Renderer pyytää vain nimettyä `selectLocalUpdatePackage`-tyyppistä
capabilityä. Electron main avaa native-dialogin manifestille, lukee suljetun
manifestin ja johtaa sen samassa hakemistossa olevan paketin nimen vain
validoidusta `packageFilename`-kentästä. Renderer ei saa manifestin tai
paketin raakaa polkua, executablea, URL:ia, komentoriviä tai
prosessioikeutta. R0:ssa ei valita executablea suoraan eikä käytetä yleistä
`openFile`-capabilityä.

## 8. Suora Setup-päivitys

Käyttäjä voi käynnistää uuden Setup-ohjelman myös Eky-sovelluksen
ulkopuolelta. Tällöin Update Coordinator ei ole ehtinyt tehdä journalia tai
pre-update-pistettä.

Ensimmäinen uuden version käynnistys:

- tunnistaa build- ja schema-version muutoksen
- siirtyy maintenance-tilaan ennen business-runtimen avaamista
- muodostaa pre-migration-palautuspisteen
- keskeyttää, jos palautuspistettä ei voida tehdä
- ajaa vasta sen jälkeen forward-migraatiot

Tämä fallback ei korvaa suositeltua sovelluksesta käynnistettyä päivitystä.

## 9. Päivitysmanifesti

Versionoitu manifesti sisältää vähintään:

- manifest format version
- app identity
- app version
- build revision ja build identity
- platform
- architecture
- release channel
- package filename tai sisäinen package identifier
- package byte size
- SHA-256
- mahdollinen minimi lähtöversio
- mahdollinen sallittu downgrade-tieto
- signing metadata myöhemmässä vaiheessa

Manifesti käyttää suljettua skeemaa, kokorajoja ja tarkkaa version
parsimista. Unknown fields, duplicate keys, poikkeavat app identity -arvot,
väärä platform/architecture ja liian suuri artifacti torjutaan.

Package SHA-256 ei ole itseään sisältävä tiiviste. R0:n myöhempi installer
käyttää package-artifactista erillistä sidecar-manifestia tai muuta
ei-itseviittaavaa signed envelope -mallia. Manifesti tai envelope voi olla
allekirjoitettu ja viitata paketin nimeen, kokoon ja SHA-256-arvoon, mutta sitä
ei sisällytetä samaan tavujonoon, jonka tiiviste tarkistetaan. Installeria,
allekirjoitusta tai update-koodia ei toteuteta backup/restore-vaiheessa.

Build identity ei ole digitaalinen allekirjoitus.

Teknologiakatselmuksen ehdottama R0-artifact-layout on:

```text
release/
  Eky-Setup-<version>-pilot-x64.msi
  Eky-Setup-<version>-pilot-x64.manifest.json
```

Sama täysi MSI palvelee clean installia, repairia ja major upgradea. R0 ei
käytä deltaa tai patch-pakettia. Sidecar-manifestin ja MSI:n basename,
app identity, versio, kanava, arkkitehtuuri, koko ja SHA-256 sidotaan
toisiinsa ennen käyttäjän vahvistusta ja tarkistetaan uudelleen välittömästi
ennen installer handoffia.

## 10. Pre-update-palautuspiste

Pre-update-piste:

- on pakollinen ennen Update Coordinatorin käynnistämää asennusta
- käyttää ADR-0009:n machine-local recovery point -mallia
- tehdään vain terveestä profiilista
- validoidaan ennen runtime-sulkua
- suojataan rotaatiolta, kunnes päivitys on hyväksytty tai rollback valmis

Jos palautuspistettä ei voida muodostaa, päivitystä ei aloiteta.

## 11. Päivitysjournal

Yksityinen journal on versionoitu tilakone, esimerkiksi:

- `prepared`
- `recoveryPointValidated`
- `runtimeStopping`
- `installerLaunched`
- `awaitingFirstStart`
- `firstStartValidating`
- `accepted`
- `rollbackRequired`
- `rolledBack`
- `failed`

Tarkat nimet lukitaan toteutuksessa. Siirtymät ovat monotonic ja idempotentteja.
Journal ei sisällä yritysdataa, raakaa polkua, salaisuutta tai vapaamuotoista
asentajan outputia.

## 12. Hallittu shutdown

Ennen asentajan käynnistystä:

1. uudet business-komennot estetään maintenance-lukolla
2. taustatehtävät viimeistellään tai jäädytetään dokumentoidusti
3. backend suljetaan timeoutin sisällä
4. SQLite-yhteys suljetaan
5. utility processit ja brokerit suljetaan
6. runtime-session mitätöidään
7. pääikkuna suljetaan

Pakotettu kill on viimeinen fallback ja jättää journalin
`rollbackRequired`- tai `failed`-tilaan.

## 13. Handoff ulkoiselle asentajalle

Main käynnistää vain ennalta validoidun artifactin:

- `shell: false`
- executable ja argumentit erillisinä arvoina
- ei rendererin antamaa argumenttia
- ei URL-protokollan kautta tulevaa komentoa
- ei ympäristömuuttujaan sijoitettua salaisuutta tai sessionia
- child process -kahva ja virheet käsitellään turvallisesti

Asentajalle välitetään vain sen tarvitsema minimoitu, dokumentoitu tieto.
Business-datan polkua ei välitetä.

## 14. First-start maintenance

Uusi versio avaa ennen normaalia UI:ta maintenance-polun:

1. validoi packaged build-infon
2. vertaa app versionia ja journalin kohdeversiota
3. tarkistaa aktiivisen profiilin ja palautuspisteen
4. tarkistaa migration chainin jatkuvuuden
5. ajaa sallitut forward-migraatiot
6. tarkistaa SQLite integrityn ja foreign keys -tilan
7. tarkistaa auktoritatiivisten business-artifactien viittaukset
8. käynnistää backendin uudella runtime-sessionilla
9. odottaa readiness- ja health-tuloksen
10. merkitsee päivityksen hyväksytyksi

Renderer ei avaudu normaaliin business-tilaan ennen hyväksyntää.

## 15. Migraatiot

Migraatiot ovat immutable ja vain eteenpäin ajettavia:

- jo jaettua migraatiota ei muokata
- uutta versiota ei hyväksytä katkenneella migration chainilla
- migration alkaa vasta validoidun palautuspisteen jälkeen
- ensimmäinen oikea N -> N+1 pysyy estettynä, kunnes `schema_migrations`-
  malliin on päätetty historiallinen SQL-checksum, chain identity ja
  release/build identity; mismatch torjutaan ennen schema-kirjoitusta
- virhe jättää uuden profiloitilan hyväksymättä
- rollback palauttaa profiilin pre-update-pisteestä
- reverse SQL -migraatiota ei ajeta

## 16. Health ja hyväksyntä

Päivitys on hyväksytty vasta, kun:

- build identity vastaa odotettua artifactia
- migraatiot ovat valmiit
- SQLite integrity ja foreign keys ovat kunnossa
- backend on valmis
- `/health` palauttaa odotetun turvallisen vastauksen
- runtime-session toimii
- vähintään rajattu packaged startup smoke onnistuu

Asentajan exit code yksin ei riitä.

## 17. Business-datan rollback

Jos first-start epäonnistuu schema- tai datavaiheessa:

- uusi backend ja SQLite suljetaan
- aktiivinen epäonnistunut profiili eristetään tutkimista varten rajatusti
- pre-update-piste palautetaan ADR-0009:n activation/rollback-mallilla
- palautettu profiili validoidaan ja käynnistetään
- journal päivitetään ilman raw erroria tai polkua

Epäonnistuneen profiilin säilytys, koko ja retention päätetään
toteutusvaiheessa. Se ei kuulu tukipakettiin kokonaisena.

## 18. Binary rollback

Binary rollback on asenninmoottorin vastuu. Teknologiavalinnassa pitää
todistaa:

- pystyykö moottori säilyttämään tai palauttamaan edellisen version
- miten rollback käynnistyy, jos uusi Eky ei avaudu
- säilyykö code signature ja publisher-validointi
- voiko rollback tapahtua ilman admin-oikeutta
- miten osittainen asennus siivotaan

Binary rollback ei avaa vanhaa ohjelmaversiota uudemmalla, migroidulla
profiililla. Business-datan palautus ja binaaripalautus koordinoidaan
journalin avulla.

## 19. Code signing

Isän yhdellä hallitulla pilottilaitteella allekirjoittamaton paikallinen
artifacti voidaan hyväksyä vain projektin omistajan erillisellä päätöksellä.
Laajempi jakelu vaatii:

- Windows code signing -sertifikaatin
- suojatun avaimen lifecycle- ja käyttöoikeusmallin
- allekirjoituksen timestampin
- binäärien ja asentajan allekirjoituksen tarkistuksen
- tunnetun publisherin
- release-prosessin, joka ei allekirjoita dirty-buildia

Code signing -salaisuus ei kuulu repoon, sovellukseen tai backupiin.

## 20. Tuleva etäpäivitys

Etäpäivitys käyttää samaa update source -porttia kuin paikallinen tiedosto,
mutta vaatii lisäksi:

- HTTPS-only origin allowlistin
- allekirjoitetun update-manifestin
- download size- ja timeout-rajat
- redirect-politiikan
- download temp/finalize -mallin
- package signature -tarkistuksen
- kanava- ja rollout-politiikan
- rollback- ja incident-harjoituksen

Pelkkä HTTPS tai SHA-256 ei yksin todista julkaisijan identiteettiä.

## 21. Käyttöliittymä

Päivitykset sijoitetaan:

`Tuki ja historia` -> `Sovellus ja päivitykset`

Näkymä näyttää:

- nykyisen sovellusversion
- build revisionin ja dirty-tilan
- release-kanavan
- paikallisen päivityspaketin valinnan
- tarkistuksen tuloksen
- palautuspisteen valmistelutilan
- vahvistetun päivityskomennon
- turvallisen onnistumis-, keskeytys- tai rollback-tilan

Backup/Restore sijoitetaan erillään:

`Oma yritys` -> `Varmuuskopiointi ja palautus`

UI ei näytä raakaa polkua, asentajan komentoa, journalia, sessionia tai
teknistä virhettä. Päivityksen vahvistus kertoo, että sovellus sulkeutuu.

## 22. Tuleva update-composition

Toteutus jaetaan ilman business-moduulien riippuvuuksia:

```text
apps/desktop/src/update/
  updatePackageManifest.ts
  updatePackageInspector.ts
  localUpdateSource.ts
  updateJournalStore.ts
  updateCoordinator.ts
  installerLauncher.ts
  firstStartUpdateRecovery.ts
  updateOperationalObserver.ts
```

Update Coordinator saa compositionista vain seuraavat kapeat portit:

- `PreUpdateRecoveryPort`
- `RuntimeMaintenancePort`
- `RuntimeShutdownPort`
- `InstallerLauncher`
- `UpdateJournalStore`
- `BuildIdentityReader`
- `ActiveProfileProtectionPort`.

Se ei saa backupin crypto storea, recovery pointin sisäistä polkua,
tietokantakahvaa, rendererin polkua, installer command stringiä eikä
business-moduulin repositorya. `LocalUpdateSource` palauttaa main-prosessin
sisäisen, validoidun package-handlen eikä raakapolkua rendererille.

Nykyinen `desktopComposition.ts` kokoaa myös Profile Protectionin ja on jo
selvästi suuri composition root. Ennen update-tuotantokoodia arvioidaan
käyttäytymistä muuttamaton `profileProtectionComposition.ts`-erotus. Sen
tarkoitus on antaa edellä mainitut kapeat portit eikä avata recovery-servicen
sisäisiä riippuvuuksia Update Coordinatorille. Refaktorointi tehdään omassa
commitissa nykyisten packaged backup/restore-testien suojassa.

## 23. Observability ja audit

Tuleva tekninen tapahtumaperhe on `update.*`. Tarkat event-nimet lukitaan
vasta transaction ownership- ja failure behavior -päätöksessä.

Sallitut tiedot ovat vain:

- korrelaatiotunniste
- nykyinen ja kohdeversio
- release-kanava
- allowlistattu vaihe
- kesto millisekunteina
- rajattu tekninen virhekoodi ja retryable-luokitus
- `sideEffectState`
- nykyisen politiikan sallima build revision/runtime identity

Kiellettyjä ovat:

- paikallinen polku
- installer command
- update URL queryineen
- yritys- tai asiakasdata
- backup- tai palautuspistepayload
- salaisuus tai session
- raw process output, stack tai filesystem error
- vapaa metadata

Päivitysjournalia tai pakettia ei lisätä tukipakettiin. Tukipaketti voi
sisältää vain sanitoidun tilayhteenvedon ja turvalliset tapahtumat.

Virhekoodien käyttäjä- ja tukitoimet omistaa
`windows-update-operational-runbook.md`. Tuotantokoodiin ei lisätä
`update.*`-eventName-arvoja ennen transaction ownership-, stage allowlist-
ja failure behavior -päätöstä.

## 24. Testaus

### Manifesti ja paketti

- validi ja väärä app identity
- platform/architecture mismatch
- version upgrade, sama versio ja downgrade
- kanavaristiriita
- size/hash mismatch
- unknown/duplicate/malformed manifest fields
- truncation ja paketin vaihtaminen tarkistuksen jälkeen
- allekirjoitus puuttuu, väärä tai vanhentunut laajemman jakelun portissa

### Runtime ja process

- renderer ei voi antaa polkua, URL:ia, executablea tai argumenttia
- väärä IPC-sender ja tuntematon capability
- maintenance-lock conflict backupin ja restoren kanssa
- backend graceful shutdown ja timeout
- SQLite-handle sulkeutuu ennen handoffia
- installer spawn failure
- app exit ennen ja jälkeen spawnin eri keskeytyspisteissä
- restart jokaisen journalisiirtymän jälkeen

### First start ja rollback

- validi päivitys ilman migraatiota
- validi päivitys yhdellä ja usealla migraatiolla
- migration failure
- integrity-, foreign key-, readiness- ja health-failure
- puuttuva tai vioittunut pre-update-piste
- business rollback onnistuu ja epäonnistuu
- binary rollback onnistuu ja epäonnistuu
- suora Setup ilman journalia tekee pre-migration-pisteen
- vanha session ei toimi päivityksen jälkeen
- idempotentti uusi käynnistys accepted/failed-tilassa

### Windows release gate

- puhdas asennus tavallisella Windows-käyttäjällä
- toinen saman version asennus ja repair
- päivitys edellisestä tuetusta versiosta
- sama versio ja eksplisiittisesti torjuttu downgrade
- väärä app identity ja väärä arkkitehtuuri
- hash mismatch ja paketin vaihto tarkistuksen jälkeen
- pre-update recovery point -virhe ennen runtime-sulkua
- runtime shutdown timeout
- installer spawn failure ja non-zero exit
- keskeytys jokaisen journalivaiheen jälkeen
- first-start migration-, integrity-, foreign key- ja health-failure
- business rollback ja binary rollback erikseen sekä yhdessä
- vanhan runtime-sessionin torjunta
- polut, joissa on välilyöntejä ja Unicodea
- asennus hakemistoon ilman kirjoitusoikeutta
- levy täynnä ja virustorjunnan aiheuttama tiedostolukko
- uninstall säilyttää business datan
- reinstall löytää saman profiilin ilman installerin dataetsintää
- asennuksesta ei jää orphan-prosesseja
- dirty-buildia ei jaeta
- hardened fuses, ASAR integrity, native addon ja PDF toimivat
- packaged smoke ja kriittinen Electron-E2E päivityksen jälkeen
- palautuspiste -> päivitys -> migraatio -> restart -> business-datan vertailu
- synteettisen SQLite-kannan ja kaikkien auktoritatiivisten PDF:ien hashit
  täsmäävät ennen ja jälkeen onnistuneen päivityksen

Testit käyttävät vain synteettistä dataa eivätkä ulkoista verkkoa ennen
etäpäivitysvaiheen erillistä hyväksyntää.

Ensimmäinen installer-toteutus käyttää yhtä aktiivista profiilia. Portit ja
testifixturet eivät silti saa kovakoodata yhtä ikuista `userData`- tai
runtime-polkua: tuleva profile registry antaa aktiivisen profiilin suojatun
handlen compositionille.

## 25. Riippuvuus- ja turvallisuusportti

Ennen installeriteknologian valintaa vertaillaan vähintään:

- Windowsin natiivi installerimalli
- Electron-ekosysteemin installer/maker-vaihtoehdot
- nykyisen oman package-scriptin laajentaminen

Arvioidaan:

- suorat ja transitiiviset riippuvuudet
- ylläpito ja julkaisutahdin turvallisuus
- code signing
- delta/full update
- binary rollback
- admin-oikeuksien tarve
- silent install -ominaisuudet ja niiden riskit
- native addon- ja ASAR-yhteensopivuus
- GitHub Actions / Windows build -tuki
- lisenssi
- toimitusketju ja artifactien alkuperä

Mitään riippuvuutta ei asenneta tai lockfilea muuteta ilman projektin
omistajan erillistä hyväksyntää.

## 26. Ei ensimmäisessä toteutuksessa

- etäpäivitystä
- automaattista hiljaista päivitystä
- stable-kanavaa
- staged rolloutia
- delta-päivitystä
- background downloadia
- admin-hallintajärjestelmää
- business-datan poistoa uninstallissa
- reverse SQL -migraatiota
- usean profiilin samanaikaista päivitystä
- uutta installeririippuvuutta ennen hyväksyntäporttia

## Release gate -luokitus

### R0-pilottilaitteen suojaus

Oikeaa asiakas- tai laskutusdataa käyttävä paikallinen pilottilaite vaatii
ennen käyttöönottoa vähintään:

- tuetun ja tietoturvapäivityksillä ajan tasalla olevan Windows-version
- nimetyn, salasanalla suojatun Windows-käyttäjätilin ja automaattisen
  näytönlukituksen
- BitLockerin tai Windows Device Encryptionin aktiiviselle järjestelmälevylle
  ja muulle levylle, jolla Eky-profiili tai paikalliset lasku-PDF:t sijaitsevat
- rajatut Windows-tiedosto-oikeudet Eky `userData`- ja profiilijuurille
- ajantasaisen haittaohjelmasuojauksen ja palomuurin
- vahvistuksen, ettei local backend ole saavutettavissa loopbackin ulkopuolelta
- onnistuneen salatun siirrettävän backupin ja palautusharjoituksen erillisellä
  medialla

Aktiivinen SQLite-tietokanta ja current PDF:t ovat käytön aikana paikallista
business-dataa, eivät `.ekybackup`-containerin sisällä. Niiden at-rest-suoja
perustuu Windows-käyttäjärajaan, tiedosto-oikeuksiin ja koko levyn salaukseen.
Samaan Windows-käyttäjäkontekstiin päässyt haittaohjelma on jäännösriski, jota
backup-salaus tai Electron `safeStorage` ei poista.

Jos laite ei teknisesti tue levyjen salausta, oikean datan käyttöönotto
pysäytetään erilliseen omistajan dokumentoituun riski- ja laitepäätökseen.
Poikkeusta ei tulkita automaattiseksi hyväksynnäksi.

Yhden hallitun oikeaa dataa käyttävän koneen R0-portteja ovat:

- toimiva backup/restore ja palautuksen automaattinen todentaminen
- migraatioiden muuttumattomuus ja jatkuva migration chain
- pre-migration/pre-update-palautuspiste
- staging, health-check ja business-datan rollback
- paikallisen profiilin, salaisuuksien ja tiedostojen suojaus

Peruste on ensisijaisesti datan eheys ja turvallinen palautuminen.

Laajemman jakelun R1-portteja ovat viimeistään:

- varsinainen Windows-installer
- code signing ja publisher-identiteetti
- hallittu päivityskanava
- automaattinen päivityspolku
- binary rollback
- release- ja incident-prosessi

Peruste on ensisijaisesti distribution- ja supply chain -turvallisuus.
Code signing voidaan nostaa R0-portiksi, jos projektin omistaja päättää, ettei
allekirjoittamatonta artifactia käytetä edes yhdellä hallitulla
pilottilaitteella.

Tietosuoja-, kirjanpito- ja muu legal-vaatimus arvioidaan erikseen ennen
oikean datan käyttöönottoa. Tekninen backup tai allekirjoitus ei yksin todista
legal-vaatimusten täyttymistä.

## Toteutusjärjestys

1. hyväksy installeriteknologian dependency/security review
2. määritä versionoitu package manifest
3. toteuta read-only package inspector
4. todenna clean install ja upgrade synteettisellä profiililla
5. toteuta maintenance-lock ja pre-update recovery point
6. toteuta update journal ja first-start maintenance
7. toteuta Eky Update Coordinator paikalliselle tiedostolle
8. toteuta business- ja binary-rollback-yhteistyö
9. lisää rajattu UI
10. sulje Windows release gate packaged testeillä
11. arvioi code signing ja vasta myöhemmin etäpäivitys

## Liittyvät dokumentit

- `AGENTS.md`
- `apps/desktop/AGENTS.md`
- `apps/desktop/README.md`
- `docs/ai/review-checklist.md`
- `docs/ai/testing-rules.md`
- `docs/architecture/e2e-testing-strategy.md`
- `docs/architecture/local-backup-and-restore-plan.md`
- `docs/architecture/local-desktop-dependency-review.md`
- `docs/architecture/local-desktop-implementation-plan.md`
- `docs/architecture/release-versioning-policy.md`
- `docs/architecture/r0-e2e-test-matrix.md`
- `docs/architecture/security-principles.md`
- `docs/architecture/windows-installer-technology-review.md`
- `docs/architecture/windows-update-operational-runbook.md`
- `docs/decisions/ADR-0007-local-desktop-shell-and-session-bootstrap.md`
- `docs/decisions/ADR-0009-local-backup-encryption-and-recovery-points.md`
- `docs/decisions/ADR-0010-windows-installer-and-update-orchestration.md`
