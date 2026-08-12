# Windows-päivityksen diagnostiikkakäsikirja

## Tila

Tämä on C3:ssa toteutetun Update Coordinatorin runbook. R0:n ensimmäinen
luottamusmalli on ADR-0010:n yhden hallitun laitteen `localUnsignedPilot`.
C3C:n `update.*`-eventit kattavat valmistelu-, shutdown-, handoff-, first-start-
ja rollback-vaiheet suljetulla eventtikatalogilla. Tapahtumat eivät sisällä
polkuja, paketin tiivisteitä, profiilitunnisteita, sessionia tai installer-
outputia.

Pilotissa paketti tulee vain paikallisesta release-arkistosta tai erikseen
hash-tarkistetulta USB-medialta. Käyttäjä vahvistaa päivityksen. Verkko-,
tausta- ja hiljainen päivitys ovat kiellettyjä. `unsigned-prototype` ei ole
publisher trust, joten `stable`-kanavaa tai laajempaa jakelua ei avata tällä
runbookilla.

Electron main säilyttää C1:stä alkaen rajatun `current/candidate/previous`-
pakettivälimuistin. Sitä ei lueta Windows Installerin cachesta, backupista tai
käyttäjän USB-polusta rollbackin hetkellä, vaan jokaisen slotin manifesti ja
MSI-tavut varmennetaan uudelleen ennen käyttöä. Välimuisti ei kuulu
Diagnosticsin tukipakettiin tai Activityyn.

## C0 baseline 11.8.2026

Ennen Local Update Foundation -tuotantokoodia `DESK-PDF-001` ajettiin
kymmenen kertaa peräkkäin tuoreella eristetyllä profiililla, Playwright
`retries=0`-asetuksella. Lisäksi koko Electron critical -joukko ajettiin
kahdesti puhtaasti. Kaikki ajot läpäisivät. Havainto on baseline, ei väite
aiemmin GitHub CI:ssä nähdyn ikkunanluontiflaken juurisyykorjauksesta.

C1:n operational-raja päättyy paketin tarkastukseen, private stagingiin ja
`current`-paketin rekisteröintiin. C1 ei käynnistä Windows Installeria,
muodosta pre-update-palautuspistettä, sulje runtimea, kirjoita varsinaista
update-journalia tai muuta business-dataa.

## C1 Local Update Foundation 11.8.2026

C1 validoi strict runtime-codecilla paikallisen sidecar-manifestin, tarkistaa
MSI:n sisäisen Windows Installer -identiteetin staattisella read-only-
komennolla, sitoo paketin nykyiseen release identityyn ja soveltaa
`localUnsignedPilot`-trust-policya. Hyväksytty paketti kopioidaan suoratoistona
Electron `userData` -juuren yksityiseen update-cacheen, jossa current- ja
candidate-slotit päivitetään crash-safe metadatalla. Renderer pyytää vain
nollaparametrisen `selectLocalUpdate()`-toiminnon eikä saa tiedostopolkua,
manifestia, hashia, MSI:tä tai suorituskomentoa.

C1 ei vielä kirjoita operational-eventtejä. Eventtikatalogi, päivitysyrityksen
korrelaatio ja update-journal kuuluvat C2/C3:n erilliseen transaction ownership
-päätökseen. C1:n epäonnistuminen ei käynnistä asentajaa, sulje runtimea,
muodosta palautuspistettä tai koske business-dataan.

## C2 journal- ja first-start-raja

C2 kirjoittaa `awaitingFirstStart`-tilan ja fsyncaa journalin ennen
`msiexec`-prosessin käynnistämistä. Erillistä `installerLaunched`-tilaa ei
käytetä. Yksi operaatio saa tehdä enintään yhden handoff-yrityksen, eikä
runtime käynnistä asentajaa automaattisesti uudelleen epäselvän tuloksen
jälkeen.

Journalin `rollbackRequired`-tila pysäyttää C2:ssa business-UI:n ja ohjaa
turvalliseen yleisvirheeseen. Varsinainen business- ja binary-rollback kuuluu
C3:een. C2 ei yritä palautusta hiljaisesti eikä jatka migraatioita
ratkaisemattomasta tilasta.

First-start tarkistaa in-app-päivityksen journalin ja package-slotit ennen
normaalia backendia. Suora Setup käyttää erillistä yksityistä read-only-
preflightia; sitä ei toteuteta julkisena endpointina, renderer-toimintona tai
yleisenä migrations-ohituksena.

C2 on toteutettu yksityisenä runtime-ketjuna. Backend pysähtyy ennen
migraatioita `migrationGateReady`-tilaan ja jatkaa vain Electron mainin
validoidulla `continueStartup`-päätöksellä. Päätös ei sisällä polkua,
sessionia, SQL:aa tai business-dataa. Virhe, timeout tai `abortStartup`
estää migraatiot ja business-UI:n.

Suora Setup luokitellaan read-onlyna tyhjäksi tai olemassa olevaksi
profiiliksi. Olemassa oleva profiili saa ajaa pending-migraatiot vasta
validoidun pre-migration-pisteen jälkeen. Koordinoitu päivitys vaatii
journalissa sidotun pre-update-pisteen sekä uudelleen validoidut current- ja
candidate-slotit. First-start hyväksyy buildin vasta migration-, integrity-,
foreign-key-, artifact-closure-, backend readiness-, health-, uuden sessionin,
vanhan sessionin torjunnan, SMTP-salaisuuden identiteetin ja cache-rotaation
tarkistusten jälkeen.

Hyväksynnän jälkeinen recovery-protection-siivous on best effort. Sen virhe
jättää turvallisen ylimääräisen suojauksen, ei peruuta jo committoitua
hyväksyntää. Varsinainen rollback ja käyttäjälle avattava update-toiminto
kuuluvat C3:een.

## C3A recovery state -raja

Update state on asennuskohtainen ja sijaitsee Electronin `userData/update-state`
-hakemistossa. Profiilikohtainen vanha sijainti on vain kerran luettava,
tiukasti validoitava legacy-lähde. Vioittunutta tai keskenään ristiriitaista
tilaa ei yhdistetä eikä korjata arvaamalla.

Suoran Setupin pending-migraatioilla on oma pysyvä recovery-record ennen
ensimmäistä SQL-kirjoitusta. Keskeytyksen jälkeinen käynnistys käyttää vain
recordissa sidottua alkuperäistä pre-migration-pistettä. Recordia, polkua,
profiilitunnistetta, SQL:aa tai package identityä ei kirjoiteta operatiiviseen
lokiin.

Jos MSI peruttiin tai sitä ei sovellettu ja vanha hyväksytty build sekä
migraatioprefix ovat todistettavasti ennallaan, journal voidaan sulkea
`installerNotApplied`-tilaan. Candidate säilyy. Epäselvä tai mixed-versiotila
on `failedSafe`, eikä siitä avata business-UI:ta.

SystemRoot hyväksytään installer-inspectioniin vain kanonisena absoluuttisena
Windows-juurena: `win32.resolve(systemRoot) === systemRoot`. ProductCode
johdetaan buildissä deterministisesti nimialueesta `product/<msiProductVersion>`.
Runtime tarkistaa saman identiteetin omalla pienellä helperillä; build-scriptiä
ei importata runtimeen.

## C3B rollback-tilakone

First-start-virheen jälkeinen palautus etenee aina kahdessa järjestetyssä
osassa. `businessRollbackStarting` ja `businessRollbackCompleted` palauttavat
ensin journalissa sidotun pre-update-yritysprofiilin nykyisellä ADR-0009:n
restore activation -moottorilla. Vasta tämän jälkeen
`binaryRollbackPrepared` saa kuluttaa päivitysyrityksen ainoan binary rollback
-yrityksen ja `awaitingRollbackFirstStart` odottaa vanhan buildin omaa
first-start-validointia. Terve vanha build päättää ketjun `rolledBack`-tilaan.

Tilat ovat yksisuuntaisia ja saman tilan uudelleenkirjoitus on idempotentti.
`binaryRollbackAttemptCount` voi muuttua nollasta yhteen vain business
rollbackin valmistuttua. Arvo yksi ei saa palata nollaksi eikä sama operaatio
saa käynnistää toista MSI-palautusta. Business- tai binary-palautuksen
epäselvä lopputulos päättyy terminaaliseen `failedSafe`- tai
`recoveryRequired`-tilaan, jossa business-käyttöliittymää ei avata.

Jos journalin täsmälleen sitomaa vanhaa pakettia ei löydy yksityisen cachen
`current`- tai `previous`-slotista, tila on `rollbackPackageRequired`.
Binaaripalautuksen yrityslaskuri pysyy tällöin nollassa. Käyttäjä valitsee
vanhan manifestin vain recovery-ikkunan main-prosessin native-dialogilla.
Paketin version, buildin, MSI-identiteetin, SHA-256-tiivisteen ja koon pitää
vastata journalia ennen kuin normaali yhden yrityksen rollback-polku jatkuu.
Väärä tai muuttunut paketti ei muuta journalin liiketoimintatilaa eikä käynnistä
MSI:tä.

Vanha C2:n `rollbackRequired` on vain turvallinen siirtymätila. Se voi jatkua
ainoastaan `businessRollbackStarting`-tilaan tai pysähtyä recovery-tilaan;
se ei saa ohittaa business-profiilin palautusta tai merkitä operaatiota suoraan
palautetuksi. `installerNotApplied` säilyy erillisenä turvallisena päätöstilana
tapaukselle, jossa uusi MSI ei koskaan vaihtanut hyväksyttyä buildia eikä
business-profiili muuttunut.

## C3B recovery-only-käyttö

`failedSafe`-, `recoveryRequired`- ja `rollbackPackageRequired`-tilassa tai
ristiriitaisen restore/update recovery authorityn tapauksessa Eky ei käynnistä
backendia eikä avaa yritystyötilaa. Näkyviin tulee vain Electron mainin
omistama sandboxattu palautusikkuna. Se näyttää turvallisen virhekoodin,
sovellusversion ja build revisionin sekä sallii lokikansion avaamisen ja
minimoidun teknisen recovery-tukipaketin luonnin. Tukipaketti ei sisällä
yritysdataa, profiilia, journalia, manifestia tai tiedostopolkuja.

Täsmällisen rollback-paketin valinta näkyy vain
`rollbackPackageRequired`-tilassa. Renderer ei anna main-prosessille URL:ia,
polkua tai manifestia, vaan pyytää nollan argumentin nimettyä toimintoa.
Electron main omistaa valintaikkunan, tarkistuksen, cachen ja MSI-handoffin.
Palautusikkunassa ei ole yleistä tiedosto-, URL-, shell- tai raw IPC -rajapintaa.

## Omistajuus

Update Coordinator omistaa yhden päivitysyrityksen teknisen lifecycle-
korrelaation. Se ei kirjoita business auditia eikä Activity-tapahtumia.
Turvallinen tekninen projektio kuuluu Diagnosticsiin. Failure/security-
tason minimoitu havainto voi kuulua incident indexiin nykyisen retention-
politiikan mukaan.

Sallitut kentät ovat vain:

- `correlationId`
- `currentVersion`
- `targetVersion`
- `releaseChannel`
- allowlistattu `stage`
- `durationMs`
- turvallinen `errorCode`
- `retryable`
- `sideEffectState`
- nykyisen build identity -politiikan sallima revision/runtime identity.

Kiellettyjä ovat raaka polku, komentorivi, executable, URL queryineen,
installer stdout/stderr, business data, `companyId`, backup- tai recovery-
payload, salaisuus, runtime-session, stack ja vapaa metadata.

## C3C operational-eventit

Päivityksen tekninen elinkaari käyttää nimettyjä tapahtumaperheitä:

- `update.packageInspection*`
- `update.packageStaging*`
- `update.currentPackageRegistration*`
- `update.candidateDiscard*`
- `update.confirmation*`
- `update.recoveryPoint*`
- `update.runtimeShutdown*`
- `update.installerHandoff*`
- `update.firstStartValidation*`
- `update.businessRollback*`
- `update.binaryRollback*`
- `update.restoreCompatibility*`
- terminaalit `update.installerNotApplied`, `update.accepted` ja
  `update.recoveryRequired`.

Tähtiperhe sisältää vain katalogoidut `Started`, `Succeeded` ja `Failed`-
tapahtumat. Suljettu stage-allowlist on `packageInspection`, `packageStaging`,
`currentPackageRegistration`, `candidateDiscard`, `confirmation`,
`recoveryPoint`, `runtimeShutdown`, `installerHandoff`,
`firstStartValidation`, `businessRollback`, `binaryRollback` ja
`restoreCompatibility`.

Eventissä sallitaan vain korrelaatiotunniste, allowlistattu vaihe, kesto,
turvallinen virhekoodi, retryable- ja side-effect-tila sekä yhteinen
validoitu app/build/runtime-identiteetti. Raaka polku, komentorivi, installer
stdout/stderr, manifesti, täysi pakettitiiviste, yritys- tai profiilitunniste,
asiakas- tai laskudata, salaisuus, runtime-session, recovery-payload, raw
Error ja stack ovat kiellettyjä. Päivityseventit kuuluvat Diagnosticsiin,
eivät Activityyn tai business-auditiin. Loggerin virhe ei muuta päivityksen,
hyväksynnän tai rollbackin lopputulosta.

## Error code -runbook

| errorCode | Merkitys | Data-impact | Turvallinen retry | Käyttäjän toiminta | Tukitoiminta | Liittyvä vaihe | Käyttö pysäytetään |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `UPDATE_PACKAGE_INVALID` | Manifesti, identity, versio, arkkitehtuuri, koko, hash tai allekirjoitus ei kelpaa | Ei muutosta | Ei samalla paketilla | Valitse virallinen paketti uudelleen | Tarkista julkaisu ja manifesti ilman käyttäjän polkua | package inspection | Ei, nykyistä versiota voi käyttää |
| `UPDATE_PACKAGE_CHANGED` | Paketti muuttui tarkistuksen jälkeen | Ei muutosta | Vasta uudella inspectillä | Peruuta ja valitse paketti uudelleen | Tutki release-lähde; älä pyydä raakaa tiedostopolkua lokiin | package inspection | Ei |
| `UPDATE_RECOVERY_POINT_FAILED` | Pakollista pre-update-pistettä ei saatu valmiiksi | Ei installeria eikä skeemamuutosta | Kyllä syyn korjauksen jälkeen | Vapauta levytilaa tai ota yhteys tukeen | Tarkista Profile Protectionin turvallinen tila | pre-update recovery | Ei, nykyistä versiota voi käyttää |
| `UPDATE_MAINTENANCE_CONFLICT` | Backup, restore tai muu suojattu operaatio on kesken | Ei muutosta | Kyllä myöhemmin | Odota toiminnon valmistumista | Tarkista vain allowlistattu operation state | runtime maintenance | Ei |
| `UPDATE_SHUTDOWN_TIMEOUT` | Runtime ei sulkeutunut määräajassa | Installeria ei käynnistetä; journal voi vaatia tarkistuksen | Vain hallitun restartin jälkeen | Sulje Eky ja käynnistä uudelleen | Varmista orphan-prosessit turvallisesti | runtime shutdown | Kyllä päivitykseltä, ei välttämättä nykykäytöltä |
| `UPDATE_INSTALLER_START_FAILED` | Validoitua installeria ei voitu käynnistää | Business data ennallaan | Kyllä syyn korjauksen jälkeen | Käynnistä Eky uudelleen ja yritä virallisella paketilla | Tarkista signing, AV ja exit/spawn-luokka ilman komentoriviä | installer handoff | Ei |
| `UPDATE_INSTALLER_FAILED` | Installer palautti virheen | Binaarit voivat olla rollbackattu tai tila epäselvä | Ei ennen journalin tarkistusta | Älä käynnistä asennusta uudelleen sokkona | Tarkista installerin tila paikallisesti; stdout/stderr ei tukipakettiin | installer handoff | Kyllä |
| `UPDATE_FIRST_START_FAILED` | Uusi build ei läpäissyt migration-, integrity-, FK-, readiness- tai health-porttia | Uutta profiilia ei hyväksytä | Ei ennen rollbackia | Älä jatka business-käyttöä | Käynnistä business rollback ja arvioi binary rollback | first-start validation | Kyllä |
| `UPDATE_BUSINESS_ROLLBACK_FAILED` | Pre-update-profiilia ei saatu palautettua terveeksi | Business-datan käytettävyys epävarma | Ei | Lopeta ohjelman käyttö ja ota yhteys tukeen | Käytä ADR-0009:n recovery-required-menettelyä | business rollback | Kyllä |
| `UPDATE_BINARY_ROLLBACK_FAILED` | Edellistä binaariversiota ei saatu palautettua | Palautettu business data voi olla kunnossa, mutta sovellus ei ole käyttövalmis | Ei | Lopeta ohjelman käyttö ja ota yhteys tukeen | Asenna journalissa sidottu allekirjoitettu edellinen versio hallitusti | binary rollback | Kyllä |
| `UPDATE_STATE_INCONSISTENT` | Journalin ja runtime/build identityn tila ei täsmää | Vaikutus epäselvä | Ei | Älä jatka käyttöä | Tarkista journalin turvallinen yhteenveto ja recovery pointin tila | mikä tahansa | Kyllä |
| `UPDATE_DIRECT_SETUP_RECOVERY_REQUIRED` | Suora Setup keskeytyi pending-migraation aikana | Alkuperäinen pre-migration-piste on suojattu | Ei ennen palautusta | Sulje Eky ja käynnistä palautuspolku | Palauta recordissa sidottu piste; älä jatka migraatioita | direct Setup first-start | Kyllä |
| `UPDATE_INSTALLER_NOT_APPLIED` | MSI peruttiin tai ei vaihtanut hyväksyttyä buildia | Business-data ja vanha build todistettavasti ennallaan | Kyllä uutena käyttäjän vahvistamana yrityksenä | Voit jatkaa vanhan version käyttöä | Säilytä candidate, sulje journal turvallisesti | installer handoff | Ei |

## Tukipaketin raja

Tukipakettiin voidaan ottaa vain turvallinen nykytilan yhteenveto ja yllä
määritellyt sanitoidut tapahtumat. Päivityspakettia, manifestia,
päivitysjournalia, installer-logia, yritysprofiilia tai palautuspistettä ei
sisällytetä sellaisenaan.

## C3C:n automatisoitu packaged-todiste

Tämän harnessin toteutus on valmis, mutta hyväksyntä odottaa
(`Implementation complete, acceptance pending`). Packaged Windows update
matrix remains a closed release gate. Alla kuvattu todistus on hyväksytty
vasta, kun koko matriisi läpäisee Windows-portin samoilla kerran rakennetuilla
ja SHA-256-sidecarilla sidotuilla MSI-tavuilla; pelkkä harnessin olemassaolo tai
yksittäinen vihreä skenaario ei sulje porttia.

Windows MSI release gate rakentaa release-MSI:n kerran ja käyttää samoja
SHA-256-sidecarilla sidottuja tavuja inspect-, install-, repair-, uninstall-,
upgrade-, downgrade-esto- ja rollback-tarkistuksissa. Samassa puhtaassa
Windows-ajossa erilliset synteettiset versiofixturet todistavat:

- koordinoidun N -> N+1 -päivityksen ja first-start-hyväksynnän
- perutun tai soveltamatta jääneen MSI:n turvallisen paluun N-versioon
- business-profiilin ja binaarien palautuksen first-start-virheen jälkeen
- suoran Setupin onnistumisen ja keskeytyneen migraation palautumisen
- N-version backupin palautuksen ja forward-migraation N+1-versiossa
- SQLite-, PDF-, runtime-session- ja konekohtaisen SMTP-salaisuuden rajat.

Testit käyttävät vain synteettistä dataa, eivät ulkoista verkkoa, oikeaa
salaisuutta tai käyttäjän normaalia Eky-asennusta. Release gate muodostaa
lopuksi paikallisen pilot-bundlen samoista varmennetuista release-tavuista.
Paikallisesti myöhemmin uudelleen rakennettua MSI:tä ei saa kutsua CI:n
testaamaksi tavujonoksi.

Cross-layer-skenaario `RESTORE-MIGRATION-ROLLBACK-001` todistaa lisäksi, että
N-version backupin forward-migraatiossa yksi migraatio voi valmistua ja
seuraava epäonnistua, minkä jälkeen restore activation palauttaa aiemman
N+1-profiilin ja relaunch validoi sen. Tämä integraatiotodiste ei yksin sulje
packaged Windows -porttia eikä korvaa yllä lueteltuja kerran rakennetuilla
MSI-tavuilla ajettavia skenaarioita.

## Fyysisen median pilot-portti (tekemättä)

Tätä porttia ei suoriteta automaattisesti eikä sen valmistumista saa päätellä
CI:n vihreästä tuloksesta. Käytä vain synteettistä profiilia ja erillistä
Windows-testikäyttäjää. Tee jokaiselle käytettävälle NTFS- ja exFAT-medialle
sekä FAT32-medialle, jos MSI:n koko sen sallii, seuraava tarkistus:

1. Varmista lähdearkistossa MSI, sidecar-manifesti ja SHA-256-tiedosto.
2. Laske MSI:n SHA-256 esimerkiksi PowerShellin
   `Get-FileHash -Algorithm SHA256` -komennolla ja vertaa sidecariin.
3. Kopioi koko bundle medialle. Älä käynnistä MSI:tä suoraan medialta.
4. Laske medialla olevan MSI:n SHA-256 ja varmista sama tavujono.
5. Poista media Windowsin turvallisella poistolla, irrota ja kytke uudelleen.
6. Laske SHA-256 uudelleen ja varmista MSI sekä sidecar-tiedostot.
7. Kopioi bundle testikoneen paikalliseen hallittuun kansioon ja varmista
   SHA-256 vielä kerran.
8. Asenna N-versio synteettiselle Windows-testikäyttäjälle ja varmista
   käynnistys, backend health, SQLite, PDF ja runtime-session.
9. Luo salattu `.ekybackup`, tarkasta se virallisella inspect-polulla ja
   tallenna synteettisen tietokannan sekä PDF:ien vertailutiivisteet.
10. Päivitä N+1-versioon sovelluksen paikallisella päivityspolulla, käynnistä
    uudelleen ja varmista accepted-tila, tietokanta, PDF:t ja tiivisteet.
11. Palauta backup N+1-versiossa, käynnistä uudelleen ja varmista forward-
    migraatio sekä tietokannan ja PDF:ien odotettu sisältö.
12. Säilytä current- ja previous-bundlet erillään, hash-varmennettuina,
    dokumentoitua rollbackia varten.

Jos edellistä täsmällistä N-bundlea, hashia tai vertailutietoa ei ole, portti
on kesken. Virhettä ei ohiteta uudelleen kopioimalla tai poistamalla Windowsin
suojausta. Ekyä ei oteta oikealla datalla pilot-käyttöön ennen tämän
manuaaliportin omistajan vahvistusta.

## Edelleen avoimet julkaisuportit

- fyysisen median yllä kuvattu manuaalinen tarkistus
- code signing, publisher-identiteetti ja allekirjoitetun artifactin gate
- Eky-ohjelmiston omistajuus- ja lisenssipäätökset.

Nykyinen `0.1.0-alpha.2` / MSI `0.1.2` on vain yhden hallitun laitteen
`localUnsignedPilot`. Se ei ole `stable`-julkaisu.
