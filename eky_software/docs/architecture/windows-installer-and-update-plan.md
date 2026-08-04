# Windows-asennin ja paikallinen päivitys

## 1. Tila

Arkkitehtuuripäätös on hyväksytty ADR-0010:ssä. Installeria,
päivitysorkestrointia, code signingia tai update-UI:ta ei ole vielä toteutettu.
Installeriteknologiaa tai uutta riippuvuutta ei ole valittu.

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
2. valitsee paikallisen Eky-päivityspaketin native-dialogilla
3. Update Coordinator tarkistaa paketin ja näyttää turvallisen yhteenvedon
4. käyttäjä vahvistaa päivityksen
5. Eky muodostaa pre-update-palautuspisteen
6. runtime suljetaan hallitusti
7. ulkoinen asentaja käynnistetään
8. Eky poistuu
9. asennin käynnistää uuden version tai pyytää käyttäjää käynnistämään sen
10. first-start maintenance hyväksyy tai hylkää päivityksen

R0:ssa päivitystä ei käynnistetä automaattisesti ilman käyttäjän vahvistusta.

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

Build identity ei ole digitaalinen allekirjoitus.

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

## 22. Observability ja audit

Tuleva tekninen tapahtumaperhe on `update.*`. Tarkat event-nimet lukitaan
vasta transaction ownership- ja failure behavior -päätöksessä.

Sallitut tiedot voivat olla:

- nykyinen ja kohdeversio
- release-kanava
- turvallinen vaihe
- outcome
- rajattu tekninen virhekoodi
- build revision

Kiellettyjä ovat:

- paikallinen polku
- installer command
- update URL queryineen
- yritys- tai asiakasdata
- backup- tai palautuspistepayload
- salaisuus tai session
- raw process output, stack tai filesystem error

Päivitysjournalia tai pakettia ei lisätä tukipakettiin. Tukipaketti voi
sisältää vain sanitoidun tilayhteenvedon ja turvalliset tapahtumat.

## 23. Testaus

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
- päivitys edellisestä tuetusta versiosta
- polut, joissa on välilyöntejä ja Unicodea
- asennus hakemistoon ilman kirjoitusoikeutta
- levy täynnä ja virustorjunnan aiheuttama tiedostolukko
- uninstall säilyttää business datan
- dirty-buildia ei jaeta
- hardened fuses, ASAR integrity, native addon ja PDF toimivat
- packaged smoke ja kriittinen Electron-E2E päivityksen jälkeen
- palautuspiste -> päivitys -> migraatio -> restart -> business-datan vertailu

Testit käyttävät vain synteettistä dataa eivätkä ulkoista verkkoa ennen
etäpäivitysvaiheen erillistä hyväksyntää.

## 24. Riippuvuus- ja turvallisuusportti

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

## 25. Ei ensimmäisessä toteutuksessa

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
- `docs/decisions/ADR-0007-local-desktop-shell-and-session-bootstrap.md`
- `docs/decisions/ADR-0009-local-backup-encryption-and-recovery-points.md`
- `docs/decisions/ADR-0010-windows-installer-and-update-orchestration.md`
