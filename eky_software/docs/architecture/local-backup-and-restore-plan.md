# Eky Local Backup/Restore -suunnitelma

## Tila

Arkkitehtuuripäätös on hyväksytty ADR-0009:ssä.

Toteutettu 4.8.2026 mennessä:

- backendin yksityinen maintenance- ja snapshot-broker
- `better-sqlite3` backup API:lla tehtävä SQLite-snapshot
- Invoicingin auktoritatiivisten current PDF -artifactien staging ja katalogi
- versionoitu portable `.ekybackup` v1 -container, AES-256-GCM ja lukittu
  scrypt-profiili
- desktop mainin inspector, joka autentikoi containerin ennen JSON-parsintaa
  ja purkaa sisällön vain yksityiseen karanteeniin
- main-owned kertakäyttöinen backup-salasanaikkuna sekä portable writerin
  Save-dialog-, salaus- ja self-inspection-polku
- siirrettävän backupin no-overwrite-finalisointi täysin kirjoitetystä
  sibling-`.partial`-tiedostosta: NTFS:llä ensisijaisesti hard linkillä ja
  exFAT-/FAT32-yhteensopivana fallbackina tavallisella
  `COPYFILE_EXCL`-tiedostokopiolla
- viimeisimmän validoidun siirrettävän backupin turvallinen konekohtainen
  tilatieto ilman polkua, tiedostonimeä, profiili- tai yritystunnistetta
- konekohtaisen palautuspisteen erillinen `EKYRCV01`-container, satunnainen
  data-avain ja Electron `safeStorage` -suojattu avainenvelope
- palautuspisteiden strict index, health-tarkistus, automaattinen 24 tunnin
  ajastus, nimetty manual/pre-restore/pre-update/pre-migration-rajapinta,
  crash-safe rotaatiojournal ja puhtaan sammutuksen merkki
- backendin staged snapshot -validointi: integrity, foreign keys,
  migraatioketju, profiili-identiteetti, artifact-katalogi, PDF-signatuurit,
  koot, checksumit ja suljettu tiedostojoukko
- tietokantaan tallennettu migration source checksum- ja chain metadata;
  snapshot ja restore hyväksyvät ketjun vain, kun tietokannan metadata,
  packaged SQL-manifesti ja backupin chain identity vastaavat toisiaan
- kaksivaiheinen restore-staging: kertakäyttöinen tarkastusvaltuutus,
  tarkastetun containerin SHA-256-sidonta, uusi salasanakysely, pakollinen
  pre-restore-palautuspiste ja aktiivisesta profiilista erillinen yksityinen
  staging-juuri
- aktiivisen palautuskohteen backend-tarkistus: saman profiilin backup
  sallitaan, mutta vieras profiili vain asennukseen, jossa ei ole lainkaan
  business-, audit- tai muuta käyttäjädataa
- crash-safe aktivointijournal, rajattu Windows rename -retry ja rollback
  jokaisen aktivointivaiheen virheessä
- Oma yritys -näkymän desktop-only backup-, inspect- ja restore-capabilityt
- kaksiprosessinen hardened Windows packaged smoke, joka tekee salatun
  backupin, palauttaa sen, käynnistää uuden runtime-sessionin ja vertaa
  tietokannan sekä kaikkien auktoritatiivisten lasku-PDF:ien identiteetit
- paketoitu todistus siitä, että backupin jälkeen lisätty business-muutos
  poistuu palautuksessa mutta konekohtainen `safeStorage`-SMTP-salaisuus
  säilyy eikä sitä tuoda backupista

Dokumentoitu ja automaattisesti testattu palautuspolku muodostaa yhden
hallitun oikeaa dataa käyttävän R0-asennuksen release gaten. Toteutus ei yksin
avaa oikean datan käyttöönottoa, vaan lopullisen testimatriisin pitää olla
vihreä samalla release-kandidaatilla. Portti pidetään jatkossa suljettuna
ajamalla riskiperusteiset testit aina backup-, restore-, runtime- tai
business-artifact-rajojen muuttuessa.

## Checkpoint J: toteutus dokumentoitu

R0:n salatun paikallisen backup/restore-ketjun toteutus on dokumentoitu
4.8.2026. Portable container on versio `v1`, se käyttää AES-256-GCM:ää,
16 tavun autentikointitagia ja canonical headeria AAD:na. Lukittu
`scrypt`-profiili on `N = 2^17`, `r = 8`, `p = 1`; Windows x64 -benchmarkin
mediaani oli noin 246,4 ms.

Snapshot muodostetaan yhden maintenance-operaation sisällä
`better-sqlite3` backup API:lla. Invoicing luetteloi erillisellä
backup-catalog-portilla kaikki tietokannan auktoritatiiviset
`invoice_documents`-artifactit. Puuttuva viitattu tiedosto estää backupin,
eikä tuntematonta storage-tiedostoa lisätä hiljaisesti.

Restore etenee authenticated inspect -> private staging -> pre-restore
recovery point -> activation journal -> backend restart ->
integrity/health-tarkistus. Aktivointivirhe palauttaa vanhan profiilin
idempotentin journalin avulla. Windowsin väliaikaiset tiedostolukot saavat
vain rajatun, nimetyille virhekoodeille sallitun retry-polun; levytila-,
validointi- tai muu virhe ei muutu retryksi tai osittaiseksi palautukseksi.

Portable restoren ainoa palautusauktoriteetti aktivoinnin ja sitä seuraavan
ensikäynnistyksen aikana on `ProfileRestoreActivationJournal`-tietueeseen
sidottu aktivointitransaktion rollback-root. Restore-polku ei muodosta
päällekkäistä update- tai direct Setup -palautuspistettä. Ratkaisematon
update journal tai `DirectSetupMigrationRecovery` estää restore-first-startin
etenemisen fail-closed-periaatteella.

`RESTORE-MIGRATION-ROLLBACK-001` todistaa cross-layer-integraatiotestissä,
että validin N-version backupin ensimmäinen pending-migraatio voi valmistua ja
seuraava epäonnistua ilman palautusrajan rikkoutumista. Backend ei tällöin
valmistu käyttöön, activation transaction palauttaa ennen restorea olleen
N+1-tietokannan ja PDF:t täsmälleen samoina tavuina, ja vasta onnistunut
seuraavan käynnistyksen validointi poistaa `rolledBack`-journalin. Tämä ei
korvaa edelleen avointa packaged Windows -hyväksyntäporttia.

Machine-local recovery pointit ovat `safeStorage`-suojattuja, konekohtaisia ja
eri artifacteja kuin siirrettävä `.ekybackup`. Niiden daily/weekly/monthly-
rotaatio, levybudjetti sekä aktiivisten pre-restore/pre-update-pisteiden suoja
on testattu.

Kaksiprosessinen packaged smoke käyttää vain synteettistä profiilia. Prosessi
1 tallentaa ennen palautusta vain hashit ja tekniset testitunnisteet,
aktivoi palautuksen ja päättyy. Prosessi 2 käynnistyy samasta palautetusta
profiilista, todistaa uuden runtime-sessionin, tietokannan ja PDF-artifactien
tarkan vastaavuuden, backupin jälkeisen mutaation poistumisen sekä
backupista poissuljetun SMTP-salaisuuden jatkuvuuden. Smoke-tilatiedosto ei
sisällä salasanaa, sessionia, raakaa polkua eikä business dataa.

Tämä checkpoint ei toteuta Windows-installeria, code signingia,
automaattipäivitystä, pilvivarmuuskopiota, osapalautusta tai usean profiilin
yhdistämistä. Ne säilyvät erillisten hyväksyntä- ja release-porttien takana.

## Checkpoint K: backup/recovery-releasekandidaatti todennettu paikallisesti

Backup/restore-release gate -korjauskierros valmistui paikallisesti 9.8.2026
baseline-commitista `166177e2228731f3a9b3287668bb5cc9f5045495` alkaneella
`fix/backup-release-gate`-haaralla.

Windows packaged smoke -virheen juurisyy oli profile snapshot -brokerin
protokollaraja: desktop saattoi lähettää ensimmäisen pyynnön ennen kuin
backend-pää oli asentanut MessagePort-listenerinsä. Protokollaversio 5 lisää
eksplisiittisen `profileSnapshotBrokerReady`-handshaken. Client ei lähetä
pyyntöjä ennen validoitua ready-viestiä, ja transportin sulkeutuminen hylkää
sekä readiness-odottajan että kaikki pending-pyynnöt rajatulla turvallisella
virhekoodilla. Korjaus ei käytä satunnaista sleepiä, yleistä retryä tai
pidennettyä timeoutia.

Korjauskierroksen rajatut commitit ovat:

- `dc34969`: broker readiness ja protocol-regressiot
- `70984bb`: packaged profile broker lifecycle -todiste
- `d9823d0`: vain transitiivinen development-riippuvuus `nanoid`
  `3.3.16 -> 3.3.17`
- `cf36816`: recovery point- ja restore-operational-eventit
- `aac8ee3`: Dependency security jokaiselle `main`-pull requestille
- `d37b2f2` ja `8a67543`: Electron-E2E:n todellinen kolmen brokerin composition
- `7de4e29`: hyväksytyn laskun PDF-metadatan E2E-synkronointi ilman sleepejä

Samalla koodikandidaatilla paikallisesti vihreiksi todettiin:

- `pnpm audit --prod`, `pnpm audit` ja `pnpm audit signatures`; tunnettuja
  haavoittuvuuksia ei löytynyt ja 165 rekisteriallekirjoitusta varmistui
- workspace-testit, typecheck sekä backend-, web- ja desktop-buildit
- system E2E 44/44, web E2E 41/41, security E2E 25/25 ja fault E2E 16/16
- system/web critical E2E 51/51 kahdesti
- Electron development E2E 27/27 ja Electron critical E2E 21/21 kahdesti
- Windows package Electron 43.2.0:lla, `better-sqlite3 13.0.2`:lla ja
  SQLite 3.53.4:llä
- packaged smoke toistettuna kymmenen kertaa eri testirooteilla: 9406, 9088,
  9345, 9095, 9275, 9053, 9242, 9078, 9249 ja 9184 ms
- desktop stress: 200 moduulisiirtymää, 50 laskun avausta, 100 PDF-avausta,
  20 tukipakettia, 30 secret set/remove -sykliä ja 20 backend-restartia
- 30 minuutin desktop-soak: 3010 sykliä, 301 restartia, 602 tukipakettia,
  sama prosessi- ja ikkunamäärä lopussa sekä noin 1,6 MiB working set -kasvu

Backup-polun regressiot kattavat salatun containerin ja kiinteän Node 24
`scrypt`-vektorin, väärän salasanan, header/ciphertext/tag-mutaatiot,
manifesti-, schema- ja profiilirajat, plaintext-jäämien puuttumisen,
inspectionin, stagingin, recovery point -failuret, same/foreign/empty target
-rajat, activation journalin keskeytykset, rollbackin, restart-validoinnin sekä
packaged backup -> inspect -> restore -> restart -> compare -ketjun.

Recovery- ja restore-eventit näkyvät vain Diagnosticsissa ja tukipaketin
sanitoidussa projektiossa. Testit torjuvat polut, manifestit, salaisuudet,
business-datan ja tunnisteet operational-lokeista ja incident-indeksistä.
Lokitusvirhe ei muuta backupin tai restoren lopputulosta.

Paikallinen release-todiste ei yksin avaa oikean datan käyttöönottoa.
Pull requestin kaikkien GitHub-checkien pitää vielä olla vihreitä ja projektin
omistajan pitää hyväksyä merge. Windows installer, code signing ja
automaattipäivitys säilyvät ADR-0010:n erillisen distribution-portin takana.

## Tavoite ja rajaus

Ensimmäinen backup/restore koskee yhtä ADR-0008:n mukaista suljettua
yritysprofiilia:

- yksi profiili
- yksi SQLite-tietokanta
- yksi yritys
- yksi business-artifact-juuri

Käyttäjälle näkyvä siirrettävä artifacti on aina salattu `.ekybackup`.
Automaattinen palautuspiste on koneeseen ja Windows-käyttäjään sidottu
runtimen artifacti. Ne eivät ole sama asia.

Backup ei ole:

- tukipaketti
- toimitettujen laskujen valinnainen PDF-arkistokansio
- pilvisynkronointi
- asennuspaketti
- yleinen tiedostojen pakkaustoiminto

## Vastuut

Toteutus jaetaan kuuteen rajattuun vastuuseen:

### A. Portable encrypted backup

Muodostaa yhden profiilin versionoidun, aina salatun `.ekybackup`-artifactin.
Se ei omista native-dialogia, profiilin aktivointia tai update-lifecyclea.

### B. Machine-local recovery point

Muodostaa ja kierrättää saman asennuksen palautumiseen tarkoitetut
`safeStorage`-suojatut pisteet. Se ei tarjoa siirrettävää vientiformaattia.

### C. Backup inspector

Tunnistaa formaatin sisällöstä, tarkistaa rajat, purkaa otsakkeen,
autentikoi salauksen ja validoi manifestin sekä checksumit. Se ei aktivoi
profiilia eikä päättele luotettavuutta tiedostopäätteestä.

### D. Restore staging

Purkaa validoidun sisällön uuteen yksityiseen staging-profiiliin ja tarkistaa
SQLite- sekä business-artifact-eheyden. Se ei kirjoita aktiivisen profiilin
päälle.

### E. Profile activation

Sulkee aktiivisen runtimen ja vaihtaa täysin validoidun staging-profiilin
käyttöön atomisesti. Renderer ei anna profiili- tai tietokantapolkua.

### F. Rollback

Palauttaa pre-restore- tai pre-update-pisteen, jos aktivointi, migraatio,
backendin käynnistys tai health-check epäonnistuu. Se ei aja reverse-SQL-
migraatioita.

Näiden vastuiden yhteinen composition kuuluu Electron mainin
infrastructure-kerrokseen. Backend- ja moduuliportit tarjoavat vain oman
auktoritatiivisen datansa snapshot- tai validointikyvykkyyden.
Desktopin backup-, inspect-, restore- ja recovery point -koostaminen on
erotettu omaan `profileBackupComposition`-vastuuseensa; composition ei muuta
palvelujen eikä IPC-capabilityjen omistajuutta.

## Siirrettävän backupin sisältö

`.ekybackup`-container sisältää salattuna vähintään:

- versionoidun manifestin
- SQLite-tietokannan transaktionaalisesti eheän snapshotin
- tietokannan schema- ja migration-identiteetin
- hyväksyttyjen laskujen current PDF:t
- muut module ownerin nimeämät auktoritatiiviset business-artifactit, joita
  ei voida luotettavasti muodostaa uudelleen
- jokaisen osion koon ja SHA-256-checksumin
- sovellusversion
- backup-formaattiversion
- migration chain -identiteetin
- profiili-identiteetin ja varmuuskopion luontiajan

Profiili-identiteetti ja luontiaika ovat salatun manifestin sisällä, eivät
salaamattomassa otsakkeessa.

Uusi moduuli ei kuulu backupiin vain siksi, että sen tiedosto sijaitsee
Electronin `userData`-hakemistossa. Moduulin pitää dokumentoida:

- mikä sen datasta on auktoritatiivista
- sijaitseeko data SQLitessä vai moduulin omassa storagessa
- miten snapshot otetaan
- miten restore validoidaan
- miten vanhempi formaatti migroidaan tai torjutaan

## Backupista pois jätettävä sisältö

Backupiin ei sisällytetä:

- runtime-sessionia, autentikointiotsakkeita tai muistissa olevia tokeneita
- SMTP-salasanaa, Electron `safeStorage` -blobia tai muuta kone- ja
  Windows-käyttäjäkohtaista salaisuutta
- operational- tai security-lokeja
- incident-indeksiä
- tukipaketteja
- käyttäjän valitseman ulkoisen lasku-PDF-arkistokansion kopioita
- PDF-arkistoinnin konekohtaista asetusta tai retry-journalia
- konekohtaisia absoluuttisia polkuja tai natiivien dialogien historiaa
- palautuspisteitä
- backup-, restore-, archive- tai update-journaleita
- välimuisteja, temp-tiedostoja tai E2E/smoke-dataa
- Electron-binaareja, sovelluspakettia, asenninta tai riippuvuuksia
- päivityspakettia tai installer-komentoa
- Update Coordinatorin `current`-, `candidate`- tai `previous`-
  pakettivälimuistia, installer-sidecaria tai checksum-tiedostoa
- pilvisalaisuuksia tai tulevan cloud identityn tokeneita

Salaisuudet otetaan palautuksen jälkeen käyttöön erillisellä turvallisella
secret lifecycle -polulla. Backup ei saa siirtää SMTP-salasanaa toiselle
koneelle tai Windows-käyttäjälle.

## Container ja salaus

Siirrettävän backupin salaamaton otsake saa sisältää vain formaatin
turvalliseen tunnistamiseen ja purkuun tarvittavat kentät:

- magic bytes
- container format version
- otsakkeen pituus
- encryption algorithm identifier
- KDF identifier ja parametriversio
- salt
- nonce
- salatun payloadin rajattu pituus unsigned 64-bit -arvona
- mahdolliset pakolliset nollaksi vaaditut reserved-kentät

Otsake ei sisällä henkilötietoa, yritystunnistetta, polkua, backupin
kuvausta, luontiaikaa, tiedostonimiä, manifestia tai vapaamuotoista metadataa.
Koko versionoitu kanoninen otsake sidotaan AES-256-GCM-salaukseen
byte-for-byte AAD-tietona.

Containerin järjestys on täsmälleen:

1. kanoninen authenticated header
2. ciphertext
3. 16 tavun authentication tag

Authentication tag ei kuulu otsakkeeseen eikä AAD-tietoon. Parser vaatii
täsmällisen tagipituuden ja torjuu kaiken tagin jälkeisen ylimääräisen datan.
Kaikki pituudet tarkistetaan ennen muistivarausta, eikä containerin otsakkeesta
lueta vapaasti luotettavia kryptografiaparametreja.

Salaus käyttää:

- AES-256-GCM:ää
- käyttäjän salasanasta `scrypt`-funktiolla johdettua 256-bittistä avainta
- kryptografisesti satunnaista salt-arvoa
- jokaiselle salaukselle uniikkia nonce-arvoa
- täyttä authentication tag -arvoa

Portable container v1 käyttää KDF-profiilia 1:

- `scrypt`
- `N = 2^17`
- `r = 8`
- `p = 1`
- 32 tavun avain
- eksplisiittinen `maxmem = 256 MiB`

Windows x64 / Node 24 -kehitysympäristössä 4.8.2026 tehty viiden ajon
benchmark antoi mediaaneiksi `2^15`:lle 55,1 ms, `2^16`:lle 111,3 ms ja
`2^17`:lle 246,4 ms. Arvioidut scrypt-muistikustannukset olivat vastaavasti
32, 64 ja 128 MiB. Profiili 1 valittiin vahvimmaksi nykyisellä koneella
käytännölliseksi osoittautuneeksi vaihtoehdoksi. Valinta on vielä varmennettava
paketoidussa Electron-main/utility-ajossa pilottilaitetta vastaavalla Windows
x64 -ympäristöllä ennen R0-release gaten sulkemista.

Reader hyväksyy vain tunnetun parametriversion ja koodiin lukitut
resurssiarvot. Container ei sisällä vapaasti luotettavaa `N/r/p`-
yhdistelmää. Tällä estetään sekä liian heikko avaimenjohto että haitallisesti
ylimitoitettu KDF ennen raskaan työn aloittamista.

Käyttäjälle ei tarjota salaamatonta fallbackia. Salaus- tai
satunnaislukugeneraattorin virhe keskeyttää backupin.

## Salasanan lifecycle

- tavallinen application renderer ei saa salasanaa
- Electron main avaa erillisen kertakäyttöisen password BrowserWindowin
- password window käyttää sandboxia ja context isolationia, poistaa
  Node-integraation eikä saa backend-pääsyä
- ikkunassa ei sallita navigointia, popup-ikkunoita tai production-devtoolsia
- minimaalinen preload sallii vain submit- ja cancel-toiminnot
- salasana välitetään mainille kerran ja ikkuna tuhotaan heti
- renderer ei tallenna salasanaa sovellusstateen, local storageen tai lokiin
- salasanaa ei välitetä URL:ssa, komentorivillä tai ympäristömuuttujassa
- salasanaa, johdettua avainta ja selväkielistä payloadia pidetään muistissa
  vain operaation ajan
- tukipaketti ja diagnostiikka eivät saa salasanan arvoa, pituutta, hashia tai
  muuta johdettua tunnistetta
- Eky ei tarjoa unohtuneen salasanan palautusta

Käyttöliittymä varmistaa salasanan kahdella syötöllä ja kertoo ennen vientiä,
että unohtunutta salasanaa ei voi palauttaa. Lopullinen salasanapolitiikka
päätetään toteutusvaiheen turvallisuus- ja käytettävyystestissä.

## Private plaintext staging

Private plaintext staging sallitaan vain snapshot-, inspect- tai restore-
operaation ajaksi Electron mainin omistamassa `userData`-alueen yksityisessä
runtime-juuressa. Se ei ole käyttäjän varmuuskopiotiedosto, eikä levylle jätetä
monoliittista selväkielistä backup-payloadia.

Restore-staging sisältää business-profiilidataa, joten siihen sovelletaan samoja
polku-, käyttöoikeus-, symlink-, reparse point- ja lokitussääntöjä kuin
aktiiviseen profiiliin. Operaation onnistuminen ja epäonnistuminen siivoavat
stagingin best effort -mallilla. Desktopin käynnistys tunnistaa ja siivoaa
keskeytyksestä jääneet tunnetut temp- ja staging-slotit ennen normaalin
business-runtimen avaamista.

## Null-sääntö

Uudet backup-, manifest-, journal- ja IPC-sopimukset torjuvat `null`-arvon,
ellei kenttä ole eksplisiittisesti nullable. Väärää JSON-tyyppiä ei muunnetta
hiljaisesti tyhjäksi, puuttuvaksi tai oletusarvoksi.

## SQLite-snapshot

Elävää SQLite-päätiedostoa, WAL-tiedostoa ja SHM-tiedostoa ei kopioida ad hoc
tiedostokopiointina.

Ensisijainen tutkittava malli on:

1. runtime siirtyy maintenance-tilaan
2. uudet business-kirjoitukset estetään
3. keskeneräiset transaktiot valmistuvat tai keskeytyvät
4. snapshot tehdään `better-sqlite3 13.0.2`:n dokumentoidun SQLite backup
   -API:n avulla
5. snapshotin integrity ja foreign keys tarkistetaan erillisestä tiedostosta
6. runtime palaa käyttöön vasta kun snapshot-vaihe on valmis

`better-sqlite3 13.0.2` backup API:n WAL-käyttäytyminen, progress/cancellation,
snapshotin erillinen integrity- ja foreign-key-tarkistus sekä Windows-
yhteensopivuus on varmennettu automaattisilla testeillä. Tämä on valittu R0:n
SQLite-snapshot-malliksi. Jos myöhempi ajuri- tai Electron-päivitys rikkoo
todennetun yhteensopivuuden, release estetään ja fallbackina arvioidaan
backendin ja SQLite-yhteyden hallittua sulkemista snapshotin ajaksi.

Snapshotin migraatiopolitiikka valitaan tarkoituksen perusteella yksityisessä
backend-/desktop-sopimuksessa. Tavallinen `createProfileSnapshot` vaatii
`exactCurrentManifest`-politiikan. Sitä käyttävät portable backupin luonti,
portable backupin self-inspectionin luontivaihe, manual-, daily-, weekly-,
monthly-, `preUpdate`- ja `preRestore`-palautuspisteet sekä packaged backup
capture. Nämä polut eivät hyväksy nykyistä manifestia lyhyempää tietokantaa.

Vain suoran Setup-päivityksen nimetty `createPreMigrationProfileSnapshot`
käyttää `compatibleHistoricalPrefix`-politiikkaa. Se hyväksyy tietokannan
ainoastaan, kun applied-migraatiot muodostavat packaged manifestin alusta
alkavan täsmällisen prefiksin ja nimet, järjestys, source SHA-256:t sekä chain
SHA-256:t täsmäävät. Muuttunut historia, puuttuva keskimmäinen migraatio,
uudelleen järjestetty historia ja tulevan version tietokanta torjutaan.
Profile snapshot -brokerin protokollaversio 7 sisältää tämän erillisen
operaation exact key set -pyyntönä. Politiikkaa ei välitetä pyynnön kenttänä,
eikä operaatiota avata rendererille tai julkiselle HTTP-rajalle.

Update journalin tai Direct Setup -recovery-tietueen suojaama
palautuspiste todistetaan uudelleen välittömästi ennen ensimmäistä pending
SQL-migraatiota. Tarkistus hyväksyy vain täsmälleen yhden indeksoidun,
`validatedGood`-tilaisen `preUpdate`-pisteen, todentaa containerin tavalliseksi
ja muuttumattoman kokoiseksi tiedostoksi, avaa key envelopen, autentikoi
salatun sisällön ja varmistaa aktiivisen profiilin sekä recovery-tietueeseen
sidotun migraatioketjun. Se ei aktivoi snapshotia, muuta business-dataa tai
luo uutta palautuspistettä. Tarkistuksen yksityinen staging poistetaan myös
epäonnistumisessa, ja mikä tahansa epäselvyys pysäyttää migraation suljetusti.

## Maintenance-tila

Backup, restore, migration ja update käyttävät yhtä nimettyä maintenance-
lukkoa:

- vain yksi operaatio voi olla aktiivinen kerrallaan
- uutta backupia ei aloiteta restoren tai päivityksen aikana
- restorea ei aloiteta arkistointi- tai business-kirjoituksen ollessa kesken
- käyttöliittymä näkee vain turvallisen tilan, ei sisäistä polkua tai
  lukkotunnistetta
- timeout tai kaatuminen jättää tunnistettavan journalitilan
- käynnistys ratkaisee keskeneräisen tilan ennen business-runtimen avaamista

Maintenance-lukko ei ole käyttäjäpermissionin korvike. Backendin permission-,
session- ja `ActorContext`-rajat säilyvät.

## Backupin muodostaminen

1. käyttäjä käynnistää varmuuskopioinnin Oma yritys -näkymän
   `Varmuuskopiointi ja palautus` -osiosta
2. Electron main pyytää kohteen native Save-dialogilla
3. renderer ei anna tiedostopolkua, formaattia tai salausparametreja
4. main tarkistaa kohteen regular file/no symlink/no reparse point -rajat ja
   estää tunnetun runtime- tai asennusjuuren käytön
5. maintenance-lukko hankitaan
6. SQLite-snapshot ja auktoritatiiviset artifactit kerätään tunnetuista
   profiilijuurista
7. manifesti, koot ja checksumit muodostetaan
8. sisältö salataan kohdekansion uniikkiin sibling-`.partial`-tiedostoon;
   myös kesken jäänyt artifacti on salattu eikä näytä valmiilta
   `.ekybackup`-tiedostolta
9. täysin kirjoitettu ja synkronoitu artifacti julkaistaan lopulliseen nimeen
   `no-overwrite`-ehdolla: NTFS:llä ensisijaisesti hard linkillä ja
   exFAT-/FAT32-yhteensopivana fallbackina tavallisella
   `COPYFILE_EXCL`-kopiolla; olemassa olevaa lopullista tiedostoa ei poisteta,
   korvata tai nimetä automaattisesti sivuun
10. valmis artifacti avataan inspectorilla ja todennetaan ennen onnistumista
11. temp ja avainmateriaali poistetaan best effort -mallilla
12. maintenance-lukko vapautetaan

Backup ei muuta business dataa, laskun statusta tai toimitustapahtumia.

## Machine-local recovery point

Palautuspiste käyttää samaa profiilisisällön inclusion/exclusion-sopimusta,
mutta eri containeria ja avainmallia:

- satunnainen data-avain
- avain suojataan Electron mainin `safeStorage`-rajapinnalla
- salattu piste ja suojattu avainviite sijaitsevat private runtime -juuressa
- renderer ja backendin julkinen HTTP-pinta näkevät vain turvallisen tilan
- `safeStorage`-virhe estää pisteen luonnin
- palautuspistettä ei voi viedä siirrettävänä backupina

Palautuspisteet sijaitsevat
`userData/runtime/recovery-points/<profile-id>/`-juuressa. Ne eivät sijaitse
aktiivisen datan, dokumenttien, lokien tai sovelluspaketin juuressa, eikä
palautuspiste saa koskaan sisältää muita palautuspisteitä.

Automaattinen tarkistus tehdään terveessä käynnistyksessä ja sen jälkeen
rajatulla tunnin välein ajettavalla schedulerilla. Uusi automaattinen piste
luodaan aikaisintaan 24 tuntia viimeisimmästä validoidusta hyvästä pisteestä.
Jokainen tarkistus hankkii backendin maintenance-lukon ja validoi uuden
SQLite- ja business-artifact-snapshotin ennen kuin sitä voidaan pitää uutena
hyvänä pisteenä. Unclean startup ei siten snapshottaa epäiltyä profiilia
hyväksi ilman integrity-, foreign key-, migration-, profiili- ja
artifact-tarkistuksia.

R0-retention on:

- 7 uusinta päivittäistä
- 4 uusinta viikoittaista
- 6 uusinta kuukausittaista
- 3 uusinta pre-update/pre-migration-pistettä
- 2 uusinta pre-restore-pistettä
- 3 uusinta manuaalista pistettä
- uusin validoitu hyvä piste on aina suojattu
- uusin pre-update- ja pre-restore-piste sekä aktiiviseksi ilmoitettu
  pre-operation-piste ovat aina suojattuja
- profiilikohtainen absoluuttinen levybudjetti on 2 GiB

Budjetti poistaa vanhimmat suojaamattomat pisteet. Suojattua pistettä ei
poisteta budjetin ylityksessä, vaan tila muuttuu turvalliseksi
`protectedPointsExceedBudget`-varoitukseksi. Poistot kirjataan ennen
ensimmäistä poistamista versionoituun rotaatiojournaliin ja keskeytynyt
rotaatio jatkuu idempotentisti seuraavassa tarkistuksessa.

Puhtaan sammutuksen merkki kirjoitetaan vasta backendin onnistuneen hallitun
sammutuksen jälkeen. Markerissa on vain formaattiversio ja ISO-aikaleima.
Väärä rakenne, puuttuva merkki tai kesken jäänyt marker-korvaus tulkitaan
unclean shutdowniksi.

## Inspector

Inspector ei luota tiedostopäätteeseen. Se:

- vaatii regular file -syötteen
- estää symlinkit ja Windows reparse pointit
- asettaa rajat tiedoston, otsakkeen, manifestin, osioiden ja tiedostomäärän
  koolle
- tunnistaa magic bytes- ja format version -arvot
- hyväksyy vain tunnetun algoritmin ja KDF-parametriversion
- autentikoi otsakkeen ja salatun payloadin ennen sisällön käyttöä
- validoi JSON/manifest-rakenteen suljetulla skeemalla
- torjuu duplicate-, unknown-, absolute- ja traversal-polut
- tarkistaa jokaisen koon ja SHA-256-checksumin
- vertaa backup-, app- ja migration-yhteensopivuudet erillisinä päätöksinä
- vaatii SQLiteen tallennetun migration metadatan vastaamaan packaged
  SQL-manifestia; pelkkä backup-manifestin chain-arvo ei riitä
- ei pura business-sisältöä aktiiviseen profiiliin
- palauttaa käyttäjälle turvallisen yhteenvetotilan ilman yritysdataa

Väärä salasana ja muutettu artifacti palauttavat saman turvallisen
autentikointivirheen. Virhe ei kerro, mikä salauksen osa epäonnistui.

## Restore staging

Restore tehdään vain täysin suljettuun uuteen staging-profiiliin:

1. käyttäjä valitsee `.ekybackup`-artifactin native Open-dialogilla
2. Electron main validoi lähdetiedoston ja koon
3. käyttäjä antaa salasanan hallitussa polussa
4. inspector validoi containerin ennen staging-kirjoituksia
5. uusi yksityinen staging-juuri luodaan exclusive-mallilla
6. jokainen polku ratkaistaan staging-juuren sisällä
7. symlink-, hard link- ja reparse point -poikkeamat torjutaan
8. tiedostot kirjoitetaan temp -> fsync -> final -mallilla
9. SQLite integrity, foreign keys ja migration chain tarkistetaan
10. document storage -checksumit ja tietokantaviittaukset tarkistetaan
11. business-invariantit tarkistetaan moduulien nimetyillä validointirajoilla

Tarkastus ja staging ovat eri vahvistusvaiheita. Tarkastus säilyttää vain
kertakäyttöisen tunnisteen, lähdepolun, containerin SHA-256-tiivisteen,
turvallisen yhteenvedon ja lyhyen vanhenemisajan. Salasanaa tai johdettua
avainta ei säilytetä. Staging pyytää salasanan uudelleen, kuluttaa
tarkastustunnisteen, muodostaa ennen purkua onnistuneen pre-restore-pisteen ja
hylkää lähteen, jos container on vaihtunut tarkastuksen jälkeen.

Stagingiin kirjoitetään vain uusiin final-polkujen `next`-tiedostoihin.
Tiedostot synkronoidaan ennen final-nimeä, olemassa olevaa final-polkuja ei
korvata ja valmistuneelta tiedostolta vaaditaan tavallinen tiedostotyyppi sekä
yksi linkki. Epäonnistunut staging poistetaan kokonaan best effort -siivouksen
sijaan hallitun operaation omasta yksityisestä juuresta.

Restore ei:

- kirjoita aktiiviseen profiiliin
- seuraa archive-entryn polkua ulos staging-juuresta
- hyväksy rendererin antamaa `companyId`:tä tai profiilipolkua
- käynnistä backupista sessionia tai salaisuutta
- yhdistä kahta profiilia
- tee best effort -osapalautusta

## Aktivointi ja rollback

Kun staging-profiili on täysin validoitu:

1. activation transaction sitoo nykyisen aktiivisen profiilin journalissa
   operaatiokohtaiseen rollback-rootiin
2. business-komennot estetään
3. backend, SQLite, brokerit ja runtime-session suljetaan ADR-0008:n mukaan
4. staging-profiili vaihdetaan atomisesti aktiiviseksi
5. uusi runtime-session luodaan
6. tarvittavat forward-migraatiot tehdään maintenance-tilassa
7. SQLite ja business-artifactit validoidaan uudelleen
8. backend readiness ja health tarkistetaan
9. käyttöliittymä avataan vasta onnistumisen jälkeen

Vanhan N-backupin forward-migraatiot sallitaan N+1-runtimessa vain aktiivisen
`ProfileRestoreActivationJournal`-transaktion aikana ja vain, kun migraatiohistoria
on nykyisen manifestin täsmällinen historiallinen prefiksi. Update- tai direct
Setup -journalin ratkaisematon tila estää tämän polun. Restore ei muodosta
toista recovery pointia eikä muuta jo hyväksytyn N+1-buildin metadataa.

Epäonnistumisessa uusi runtime suljetaan ja activation transaction palauttaa
rollback-rootista ennen restorea olleen profiilin. Rollback hyväksytään vasta,
kun vanha profiili käynnistyy terveenä. Hyväksytyksi kirjattua restorea ei saa
myöhemmän cleanup-virheen vuoksi avata uudelleen rollback-tilaan.

Aktivointijournalissa ei ole yritysdataa, salaisuutta tai rendererille
palautettavaa polkua. Vaiheen pitää olla idempotentti restartin jälkeen.

## Cross-company-raja

R0:ssa:

- samaan asennukseen palautetaan vain sen nykyisen profiilin backup
- toisesta asennuksesta tuotu backup voidaan palauttaa vain tyhjään
  asennukseen
- eri yrityksen profiilin päälle ei palauteta eikä tietoja yhdistetä

Tyhjä asennus tarkoittaa backendin tarkistamaa profiilia, jossa tunnetut
runtime-infrastruktuuritaulut voivat olla olemassa, mutta yhdessäkään muussa
taulussa ei ole rivejä. Renderer ei päätä tyhjyyttä eikä saa taulu- tai
yritystietoja tämän tarkistuksen tuloksena.

Myöhempi multi-profile-malli voi tukea palautusta uutena yritysprofiilina.
Se ei kuulu tähän toteutusvaiheeseen.

## Käyttöliittymä

Oma yritys -näkymässä voi olla erillinen
`Varmuuskopiointi ja palautus` -kortti, mutta toiminto ei ole Company Settings
-master dataa.

Kortti näyttää vain:

- viimeisimmän onnistuneen siirrettävän backupin ajan, jos sovellus tuntee sen
- viimeisimmän hyvän paikallisen palautuspisteen ajan
- turvallisen `Luo varmuuskopio` -komennon
- turvallisen `Tarkista varmuuskopio` -komennon
- kaksivaiheisesti vahvistettavan `Palauta varmuuskopiosta` -komennon
- tiiviin huomautuksen salasanan palauttamattomuudesta ja paikallisen
  palautuspisteen konekohtaisuudesta

Viimeisimmän onnistuneen siirrettävän backupin aika tallennetaan
konekohtaisena, tiukasti validoituna tilatietona. Se kertoo, että Eky on
luonut ja tarkistanut backupin kyseisenä ajankohtana. Se ei sisällä eikä
paljasta kohdepolkua, tiedostonimeä, yritystä, profiilia tai salasanaa, eikä
se todista, että käyttäjä ei olisi myöhemmin poistanut ulkoista tiedostoa.
Tilatiedon kirjoitusvirhe ei saa muuttaa jo onnistuneen ja self-inspectoidun
backupin tulosta.

Renderer ei saa:

- tiedostopolkua
- backupin selväkielistä manifestia
- salasanaa tai avainta
- palautuspisteen tiedostonimeä
- raw inspector-, SQLite- tai filesystem-virhettä

## Observability ja audit

Tekniset tapahtumaperheet ovat:

- `backup.*`
- `restore.*`
- `recoveryPoint.*`

Portable backupin sekä recovery point- ja restore-lifecyclejen tarkat nimet,
vaiheet ja kentät on lukittu
`docs/architecture/r0-observability-event-catalog.md`-dokumentissa.
Aktivointijournalin satunnaista teknistä operation UUID:ta käytetään
prosessien yli vain eventin `correlationId`-kenttänä. Journalin formaatti ei
muutu eikä journalia projisoida sellaisenaan. Tapahtumissa ei ole:

- backupin payloadia tai salattua sisältöä
- salasanaa, salt-arvoa, nonce-arvoa, tagia tai johdettua avainta
- yrityksen nimeä tai asiakasdataa
- raakaa polkua
- manifestia
- SQLite- tai filesystem-virhettä

Backupin, restoren ja recovery pointin tekniset vaihe- ja failure-tiedot
kuuluvat Diagnosticsiin. Niistä ei kirjoiteta Activity-tapahtumaa tai
business auditia palautettavaan SQLite-kantaan. Operational-lokituksen virhe
ei saa muuttaa varsinaisen operaation tulosta.

## Testausportti

### Kryptografia ja container

- oikea salasana ja edustava backup
- väärä salasana
- tyhjä, lyhyt, pitkä ja Unicode-salasana
- salt-, nonce-, tag-, header- ja ciphertext-tamper
- tunnettu ja tuntematon format-, algorithm- ja KDF-versio
- liian heikko ja liian raskas KDF-parametri
- truncation jokaisessa containerin kohdassa
- ylimääräinen data containerin lopussa
- deterministic test vector vain testiavainmateriaalilla
- varmistus, ettei sama nonce toistu

### Snapshot ja sisältö

- tyhjä sekä edustava vanha tietokanta
- WAL-tila ja rinnakkaisen kirjoituksen esto
- backup-API:n keskeytys jokaisessa vaiheessa
- hallitun close-fallbackin restart
- SQLite integrity ja foreign keys
- migration chainin upgrade ja downgrade-esto
- puuttuva, ylimääräinen tai muutettu migration metadata sekä historiallinen
  SQL-mismatch
- puuttuva, ylimääräinen ja väärän checksum-arvon artifacti
- PDF-viittauksen ja artifactin ristiriita
- salaisuuksien, lokien, support bundlen, archive configin ja journalien
  poissulku

### Tiedostoturvallisuus

- relative path, absolute path, `..` ja encoded traversal
- slash/backslash-variantit
- duplicate entry ja case collision
- symlink, hard link, junction ja reparse point
- täysi levy, read-only-kohde ja oikeuksien muuttuminen kesken operaation
- no-overwrite ja olemassa olevan eri backupin säilyminen
- temp-finalisoinnin keskeytys jokaisessa vaiheessa
- NTFS:n hard link -julkaisu sekä exFAT-/FAT32-yhteensopiva tavallinen
  tiedostokopio ja kilpailevan kohdetiedoston no-overwrite-suoja
- vähintään yksi manuaalinen Windows-hyväksyntä oikealle FAT32- tai
  exFAT-USB-medialle ennen R0-oikean datan käyttöönottoa

Hard link -julkaisu tekee NTFS:n hakemistomerkinnän vasta valmiista,
synkronoidusta containerista. Tavallisen kopioinnin fallbackista ei tehdä
yleistä virtakatkosatomisuusväitettä exFAT- tai FAT32-taltiolle. Fyysisen
median release-portti pysyy avoimena, kunnes samalla release-artifactilla on
ajettu `create -> inspect -> safe eject -> reconnect -> inspect -> restore ->
restart -> compare` erikseen NTFS:llä, exFATilla ja FAT32:lla silloin, kun
artifacti mahtuu FAT32:n tiedostokokorajaan. Inspector torjuu katkenneen tai
muuttuneen containerin; Eky ei poista, korvaa tai nimeä sivuun olemassa olevaa
lopullista `.ekybackup`-tiedostoa automaattisesti.

### Restore ja rollback

- inspector-only ilman restorea
- staging ei muuta aktiivista profiilia
- pre-restore-pisteen failure estää aktivoinnin
- kaatuminen jokaisen activation-journal-vaiheen jälkeen
- backend readiness- ja health-failure
- migration-failure ja business-validation-failure
- onnistunut rollback ja rollbackin epäonnistumisen turvallinen stop
- uusi runtime-session ja vanhan session torjunta
- sama backup tyhjään asennukseen
- eri profiilin backup olemassa olevan profiilin päälle
- restoresta syntyneen profiilin uusi backup ja toinen restore

### Palautuspisteet ja rotaatio

- healthy startup ja 24 tunnin raja
- pitkä runtime ja päivittäinen tarkistus
- unclean shutdown ei tee vioittuneesta tilasta hyvää pistettä
- pre-migration-, pre-update- ja pre-restore-piste
- `safeStorage` ei käytettävissä
- päivittäinen, viikoittainen ja kuukausittainen rotaatio
- levybudjetti
- newest-good- ja active-protection
- keskeytys rotaation jokaisessa poistovaiheessa

### Koko järjestelmä

- unit-testit formaatti-, validointi-, rotaatio- ja tilakonesäännöille
- integraatiotestit SQLite-, filesystem-, main/broker- ja profiilirajoille
- Playwright Electron development -testit native capabilityille
- hardened Windows package -restore eristettyyn synteettiseen profiiliin
- packaged smoke: backup -> inspect -> restore -> restart -> business-
  ja document-datan vertailu
- fault injection levy-, SQLite-, crypto-, main-, backend- ja
  käynnistysvirheille
- varmistus, ettei renderer, HTTP, loki tai tukipaketti saa kiellettyä dataa

Varmuuskopiota ei pidetä toimivana ennen kuin palautus ja rollback on
automaattisesti todennettu. Testit käyttävät vain synteettistä dataa.
Jos käynnistys pysähtyy recovery-required-tilaan, jatkotoimet tehdään
`docs/architecture/local-restore-recovery-runbook.md`-ohjeen mukaan.

## Toteutusjärjestys

1. määritä module ownerien auktoritatiivinen inclusion-lista
2. tee versionoitu container- ja manifestityyppi ilman I/O:ta
3. benchmarkkaa ja hyväksy `scrypt`-parametrit
4. toteuta inspector ennen writeria
5. todenna SQLite snapshot -vaihtoehto `better-sqlite3 13.0.2`:lla
6. toteuta portable encrypted backup
7. toteuta machine-local recovery points ja rotaatio
8. toteuta restore staging
9. toteuta activation journal ja rollback
10. lisää Electron main -capabilityt ja UI
11. sulje release gate packaged Windows -testeillä

Jokainen vaihe tarvitsee erillisen rajauksen. Mahdollinen uusi kryptografia-,
container-, pakkaus- tai installeririippuvuus pysäyttää työn juuri-AGENTS.md:n
riippuvuusporttiin.

## Ei toteuteta ensimmäisessä versiossa

- salaamatonta backupia
- osittaista taulu-, asiakas-, lasku- tai tiedostopalautusta
- pilvivarmuuskopiota
- automaattista varmuuskopion lähettämistä verkkoon
- backup-salasanan palautusavainta
- usean profiilin yhdistämistä
- backupin palauttamista aktiivisen profiilin päälle ilman stagingia
- reverse-SQL-migraatiota
- backupin käyttämistä synkronointiformaattina

## Post-pilot-roadmap

Backup/Restore-polun jälkeen voidaan erikseen arvioida:

1. useat paikalliset yritysprofiilit ja palautus uutena profiilina
2. käyttäjän ajastettu siirrettävä backup erilliselle levylle
3. hallittu pilvivarmuuskopio erillisen provider-adapterin kautta
4. varmuuskopion formaattimigraatiot pitkän elinkaaren tueksi

Virtuaaliviivakoodi ja muut laskun PDF-ominaisuudet kuuluvat Invoicingiin,
eivät Backup/Restore-polkuun.

## Liittyvät dokumentit

- `AGENTS.md`
- `apps/desktop/AGENTS.md`
- `docs/ai/review-checklist.md`
- `docs/ai/testing-rules.md`
- `docs/architecture/e2e-test-environment.md`
- `docs/architecture/e2e-testing-strategy.md`
- `docs/architecture/local-backup-artifact-inventory.md`
- `docs/architecture/local-desktop-implementation-plan.md`
- `docs/architecture/local-invoice-pdf-archive-plan.md`
- `docs/architecture/local-restore-recovery-runbook.md`
- `docs/architecture/r0-e2e-test-matrix.md`
- `docs/architecture/security-principles.md`
- `docs/architecture/support-bundle-plan.md`
- `docs/decisions/ADR-0006-local-database-and-query-layer.md`
- `docs/decisions/ADR-0007-local-desktop-shell-and-session-bootstrap.md`
- `docs/decisions/ADR-0008-local-desktop-company-workspaces.md`
- `docs/decisions/ADR-0009-local-backup-encryption-and-recovery-points.md`
- `docs/decisions/ADR-0010-windows-installer-and-update-orchestration.md`
