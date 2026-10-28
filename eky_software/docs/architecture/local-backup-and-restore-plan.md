# Eky Local Backup/Restore -suunnitelma

## Tila

Arkkitehtuuripäätös on hyväksytty ADR-0009:ssä.

Nykyinen hyväksyntä- ja jatkotila on
[M1:n Jatka tästä -kohdassa](release-0.3.0-m1-preparation-plan.md#jatka-tästä).
Päivätyt toteutuslistat ja checkpoint-tulokset ovat historiallista näyttöä.
Nykyiset omistajuus-, salaus-, tarkistus- ja palautusrajat ovat tämän
dokumentin varsinaisissa sopimusluvuissa; myöhempi C/K-raja tarkentaa vanhan
checkpointin kuvausta eikä sen historiallista testitulosta.

### Alkuperäinen toteutusnäyttö

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
`scrypt`-profiili on `N = 2^17`, `r = 8`, `p = 1`.

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

B5:n työpuussa nykyinen PDF-smoke-valmistelu tuottaa samalle laskulle kaksi
revisiota. Ensimmäisen PDF:n jälkeen kirjataan verkoton dry-run-tapahtuma,
lasku avataan muokkaukseen ja hyväksytään uudelleen muuttuneella sisällöllä.
Laskuidentiteetin ja numeron pitää säilyä, uuden dokumentin ja PDF-tavujen
erota vanhasta sekä tapahtuman PDF:n vastata alkuperäisiä tavuja. Nykyinen
backup/restore-smoke vertailee katalogin kaikkia artifacteja, ei vain
uusinta PDF:ää. Tämä ei ole SMTP-testilähetyksen todiste eikä vielä vanhan
038-profiilin paketoitu migraatio-/palautustodistus. Erillisen legacy-kokeen
ja puhtaan revision hyväksynnän viimeisin tila on
[B5-checkpointissa](release-0.3.0-m1-preparation-plan.md#b5-katalogin-ja-palautuksen-checkpoint).

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
- packaged smoke toistettuna kymmenen kertaa eri testirooteilla
- desktop stress ja 30 minuutin desktop-soak

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

## Manuaalinen pilot evidence 18.8.2026

Pilotin rajattu manuaalinen asennus- ja palautustarkistus kirjattiin
hyväksytyksi. Tämä ei ole automatisoitu testi, tuotantosertifiointi tai
yleinen yhteensopivuusväite.

Tähän evidenssiin ei kirjata yritys-, henkilö-, lasku-, salasana-, polku- tai
muuta tunnistavaa tietoa. Se ei korvaa W0:n jälkeen suunniteltua
multi-workspace-, migration-, backup/restore- tai packaged release -matriisia.

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
- Invoicingin katalogin kaikki säilytettävät lasku-PDF:t, myös hyväksytyn
  B3-B5-sopimuksen aikaisemmat revisiot ja legacy-kopiot
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

Profiili 1 on hyväksytty kiinteä KDF-valinta. Valinta on vielä varmennettava
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

Selväkielinen työaineisto rajataan ADR-0009:n hyväksyttyyn uuteen
staging-profiiliin, ADR-0011:n W3-karanteeniin ja K:n omistettuihin
snapshot-, tarkistus- ja materialisointikopioihin. Kunkin polun oma
omistajuus-, tavusidonta- ja siivousportti on pakollinen. Tämä ei salli
selväkielistä siirrettävää backupia, yleistä temp-containeria tai salaamatonta
palautuspistettä. Salasanaa tai johdettua avainta ei tallenneta levylle.

W3-importin decrypt-vaihe käyttää kapeaa installation-scoped juurta
`<userData>/workspace-operations/workspace-import-plaintext-quarantine/`.
Sinne saa syntyä vain yksi tai useampi W3:n canonical UUID v4 -niminen,
kokorajattu plaintext-payload. Juuri ei kuulu registryyn, portable backupiin,
candidateen tai workspace-rootiin. Polkua ei johdeta workspace-labelista,
company/profile/lineage-identiteetistä tai backupin nimestä eikä palauteta
rendererille.

Restore-staging sisältää business-profiilidataa, joten siihen sovelletaan samoja
polku-, käyttöoikeus-, symlink-, reparse point- ja lokitussääntöjä kuin
aktiiviseen profiiliin. Siivous vaatii todistetun omistajuuden ja päättyneet
lukijat; epäonnistunut kutsu ei yksin anna poistolupaa. W3:n tavallinen
`finally` poistaa vain oman payloadin. Cold-recovery vaatii C/R18:n
readonly-admissionin, build-tarkistuksen, installation-leasen, todistetun
runtime-poissaolon ja palautuneen main-varauksen ennen korjaavaa lukua tai
oman v2-operaation karanteenin siivousta. V1, journaliton plaintext tai
todistamaton vanha omistaja säilyttää aineiston ja estää avauksen.
Tuntematon entry tai epäselvä filesystem-raja pysäyttää recoveryn.
Caller-owned pre-update-snapshotin epävarma backend-omistajuus estää sen
stagingin välittömän poiston; tarkka raja on
[päivityksen kirjoitussuojan sopimuksessa](#päivityksen-kirjoitussuojan-erillinen-vapautussääntö).

Production-käynnistys ratkaisee keskeytyneet operaatiot ennen normaalia
business-runtimea vain niiden omilla recovery-porteilla. W3:n nykyisen
järjestyksen omistaa [workspace-suunnitelma](local-company-workspace-plan.md#workspacecreationjournalv1);
slotin nimi, ikä tai vapaa varaus ei todista vanhaa kirjoittajaa poistuneeksi.

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
5. mainin omistama eristetty utility tarkistaa snapshotin schema/history-,
   integrity-, foreign-key- ja katalogitiedot sidotusta kertakopiosta
   ennen varmuuskopion hyväksyntää ja julkaisua
6. tavallinen backup vapauttaa suojan snapshot-vaiheen valmistuttua;
   pre-update-snapshot kuuluu päivityksen pidempään kirjoitussuojaan

`better-sqlite3 13.0.2` backup API:n WAL-käyttäytyminen, progress/cancellation,
snapshotin erillinen integrity- ja foreign-key-tarkistus sekä Windows-
yhteensopivuus on varmennettu automaattisilla testeillä. Tämä on valittu R0:n
SQLite-snapshot-malliksi. Jos myöhempi ajuri- tai Electron-päivitys rikkoo
todennetun yhteensopivuuden, release estetään ja fallbackina arvioidaan
backendin ja SQLite-yhteyden hallittua sulkemista snapshotin ajaksi.

Muodostaja sulkee snapshot-tavut ja sitoo tiedostojen koon sekä hashin,
mutta ei avaa kopiota uudelleen SQLite-tarkistukseen business-backendissä.
Muodostuksen tulos ei itsessään hyväksy varmuuskopiota: portable- ja
palautuspistekuluttajat vaativat eristetyn tarkistimen samoihin tavuihin
sidotun kuittauksen ennen salausta. Tuntemattomia sivutiedostoja ei poisteta
hyväksynnän saavuttamiseksi. [V2ag:n kohdenäyttö](release-0.3.0-m1-preparation-plan.md#v2ag-snapshot-muodostajan-eristetty-tarkistusketju)
kattaa oikean muodostajan WAL-tavut ja hylkäykset; koko paketoidun palautuksen
portti sekä durable-aktivoinnin vaihto säilyvät avoimina.

Snapshotin kopiointi- ja readonly-validointirajalla ajurille välitetään
Windowsissa pitkä polkumuoto Noden `toNamespacedPath`-funktiolla. Muunnos
ei muuta jo validoitua staging-kohdetta, manifestin loogisia polkuja,
varmuuskopioformaattia tai käyttöoikeuksia. Tiedosto-, realpath-, linkki-,
eheys- ja migraatiotarkistukset säilyvät alkuperäisillä runtime-poluilla.
Muilla alustoilla tämä muunnos ei muuta polkua. Composition-regressio
kattaa pitkän staging-polun sekä ennen historiallista forward-migraatiota
että sen jälkeen, mukaan lukien säilyneen PDF:n katalogi ja validointi.

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

### Päivityksen kirjoitussuojan erillinen vapautussääntö

C/R04:n hyväksytty sopimus erottaa tavallisen backupin ja päivityksen
suojan. Tavallinen backup säilyttää nykyisen vapautuksen timeoutissa tai
brokerin sulussa. Update-operaation drain-virhe, kymmenen minuutin
voimassaolon päättyminen tai yksityisen broker-yhteyden katkeaminen sen
sijaan mitätöi päivitysvaltuuden ja pitää business-kirjoitukset estettyinä
hallittuun uudelleenkäynnistykseen asti. Tavallinen end/force-end ei saa
muuttaa tätä tilaa normaaliksi. Epäselvä suoja ei käynnistä automaattista
palautusta.

Ennen runtime-stopin aloittamista turvallinen valmistelun keskeyttäminen
voi vapauttaa edelleen voimassa olevan update-suojan vasta varmennetun
terminal-journalin jälkeen. Saman operaation suoja jatkuu pre-update-
snapshotista päivityksen hallittuun sulkuun; palautuspisteen sisäinen
finally ei vapauta caller-owned suojaa. Backend tarkistaa voimassaolon
myös odotusten jälkeen, ei vain ajastimen callbackissa.

Drainin nykyinen raja on 30 sekuntia ja sen jälkeen alkava voimassaolo
10 minuuttia. Synkroninen assert vaatii päättyneen drainin ja tarkistaa
monotonisen takarajan. Snapshotin ja validoinnin myöhäinen vastaus tarkistaa
ennen odotusta kaapatun omistajan; brokerin siivouksessa kadonnut paikallinen
tunniste ei ohita tätä. Begin, snapshot ja end pysyvät samassa sarjajonossa,
eikä end ohita keskeneräistä snapshotia. Update-suoja ei salli restore-
aktivointia. Epävarman snapshotin tai validoinnin siivous vaatii nykyisen
broker-jonon kuittauksen; ilman sitä staging ja ensivirhe säilyvät.

Palautuspistepalvelun `createPreUpdateWithMaintenance(operationId)` käyttää
jo drainin läpäissyttä update-suojaa ja samaa tunnistetta snapshotissa sekä
validoinnissa. Se ei hanki tai vapauta maintenancea. Palvelu tarkistaa suojan
ennen snapshotia, ennen tallennusta ja tallennuksen sekä staging-siivouksen
jälkeen ennen onnistumistapahtumaa. Myöhäinen mitätöityminen säilyttää jo
tallennetun palautuspisteen, mutta ei anna päivitykselle onnistumiskuittausta.

Salatun palautuspisteen itsevalidointi purkaa juuri tallennetun containerin
itsenäiseen stagingiin. Sen `operationId` ei ole update-suojan omistaja:
vain tämän validointipyynnön erillinen `updateMaintenanceOperationId`
sitoo tarkistuksen voimassa olevaan suojaan. Tiukka yksityinen broker
tarkistaa omistajan ennen validointia ja sen odotuksen jälkeen. Puuttuva tai
väärä omistaja ei salli vieraan stagingin validointia update-suojan aikana;
eksplisiittinen update-omistaja hylätään myös tavallisen maintenance-tilan
tai suojan päättymisen jälkeen. Alkuperäisen snapshotin muodostaminen
vaatii edelleen update-operaation oman tunnisteen. Tarkistusstaging ei saa
olla sama kuin alkuperäinen snapshot-staging. Containerin, profiilin,
migraatioketjun ja tiedostotavujen nykyiset tarkistukset säilyvät. Tämä ei
muuta durable-backup-formaattia eikä anna restore- tai lähetysvaltuutta.

Broker-pyynnön aikakatkaisu ei todista taustatyön päättymistä.
[K:n lähdekuluttaja](release-0.3.0-m1-preparation-plan.md#v2aa-palautuspisteen-lähdevaraus)
käyttää inspection-portin nykyistä natiiviomistajaa: lähdekansio pysyy varattuna
tarkistuksen, receipt-sidonnan, tallennuksen ja rotationin yli. Poisto vaatii
omistajan tuoreen todistuksen sekä päättyneen käytön; assertion-kuittaus ei
ole poistovaltuus. Epävarma kirjoittaja tai siivous säilyttää aineiston ja
ensisyyksi jää alkuperäinen virhe. Myöhäinen vastaus ei käynnistä uutta
poistoa tai muuta epäonnistumista onnistumiseksi. Tavallisen maintenance-
suojan vapautussääntö säilyy, caller-owned update-suojaa ei vapauteta.

**Nykyinen K-kytkentä:** [Store-containerin itsevalidointi ja materialisointi](release-0.3.0-m1-preparation-plan.md#v2ad-palautuspisteen-tallennuksen-native-kytkentä)
sekä [odottavan palautusstagingin valmistelu](release-0.3.0-m1-preparation-plan.md#v2ae-odottavan-palautusstagingin-native-omistajuus)
käyttävät pakollista native-omistajuutta.
[V2ak:n durable-handoff](release-0.3.0-m1-preparation-plan.md#v2ak-native-stagingin-durable-handoff)
todentaa live-aktivoinnin säilytysesteen, journal-readbackin ja varauksen
luovutuksen ennen globaalia sulkua kummassakin kuluttajassa. Tavallisen
backupin vapautussääntö säilyy. [V2ag](release-0.3.0-m1-preparation-plan.md#v2ag-snapshot-muodostajan-eristetty-tarkistusketju)
poisti muodostajan eristämättömän kopiotarkistuksen. Broker-v12:n poistettujen
komentojen nykyinen raja on kohdassa
[Eristetyn tarkistuksen rajat ja valtuus](#eristetyn-tarkistuksen-rajat-ja-valtuus).
[V2al:n vaihekohtainen tiedostotarkistus](release-0.3.0-m1-preparation-plan.md#v2al-kylmäpalautuksen-vaihekohtainen-tiedostotarkistus)
sitoo forward-jatkon samaan journaliin ja strict-slottiläsnäoloon.
[V2am:n muuttamaton journal-valinta](release-0.3.0-m1-preparation-plan.md#v2am-kylmäpalautuksen-muuttamaton-journal-valinta)
säilyttää alkuvalinnassa journalin sivutiedostot kummallakin restore-polulla.
[V2an:n tuore forward-omistajuus](release-0.3.0-m1-preparation-plan.md#v2an-kylmäpalautuksen-tuore-forward-omistajuus)
varaa täsmällisen olemassa olevan operaatiokansion ennen korjaavaa lukua ja
tarkistaa saman journalin sekä valtuuden journal-korjausten ja forward-
mutaation yli. Forward-valtuus ei anna rollback- tai terminal-valtuutta;
epävarma jatko säilyttää aineiston selvitykseen. Valinta, tiedostocensus ja
varaus eivät korvaa sisältö- tai lineage-todistetta eivätkä osoita kaikkien
vieraiden prosessien poissaoloa.
[V2ao:n vaihekohtainen sisältöydin](release-0.3.0-m1-preparation-plan.md#v2ao-kylmäpalautuksen-vaihekohtainen-sisältöydin)
lukee tietokannan ja PDF:t itsenäisesti valituista lähdesloteista ja antaa
erillisen cold-receiptin ilman kuviteltua portable-katalogitiedostoa.
[V2ap:n nimetty prosessiraja](release-0.3.0-m1-preparation-plan.md#v2ap-kylmäsisällön-nimetty-prosessiraja)
erottaa cold- ja portable-tulokset, sitoo valitun lähdeparin ja vaatii saman
nykyisen exit-/reclaim-todisteen ennen hyväksyntää. Receipt ei yksin anna
siirtovaltuutta; startup-kuluttajan nykytila luetaan M1:n Jatka tästä -kohdasta.
[V2aq:n omistettu tarkistuskopio](release-0.3.0-m1-preparation-plan.md#v2aq-kylmäsisältöportin-omistettu-tarkistuskopio)
käyttää samaa portable/cold-kopio- ja exit-ketjua sekä tuoretta lähdepari- ja
lineage-tarkistusta. Tämä on sisältöportti, ei journalin tai tavujen tuore
siirtovaltuus. [V2ar:n hyväksytty PDF-tiedostosidonta](release-0.3.0-m1-preparation-plan.md#v2ar-valittujen-pdf-tiedostojen-sidonta)
välittää omistetun kopion kiinteän, kokoon ja hashiin sidotun luettelon
mainille vasta exit/reclaim-todistuksen jälkeen, ennen kopiosiivoamista.
Main ei lue SQLitea eikä päättele viitteitä koko hakemistosta. Epävarmasti
päättynyt mainin luku säilyttää kopion; myöhäinen vastaus ei vapauta sitä
poistettavaksi. Nimetty lähdetavujen tarkistin ei itsessään anna siirtovaltuutta.
Tavujen
todellinen kytkentä ennen jokaista siirtoa sekä
offline-/terminal-valtuus ja koko palautusketju todennetaan ennen K:n
hyväksyntää; välitilaa ei julkaista.

Toteutuksen nykytila ja jatkotyö löytyvät
[M1:n Jatka tästä -kohdasta](release-0.3.0-m1-preparation-plan.md#jatka-tästä).
Tämä sopimus ei yksin tarkoita koko R04:n tai packaged-porttien hyväksyntää.

Maintenance-lukko ei ole käyttäjäpermissionin korvike. Backendin permission-,
session- ja `ActorContext`-rajat säilyvät.

### Palautuksen kirjoitussuojan erillinen vapautussääntö

K:n [V2ai-päätös](release-0.3.0-m1-preparation-plan.md#v2ai-palautuksen-suljettu-kirjoitussuoja)
erottaa palautuksen suojan tavallisesta backupista. Palautuksen sama
kymmenen minuutin voimassaoloraja, drain-virhe tai yksityisen brokerin
katkeaminen mitätöi palautusvaltuuden mutta ei vapauta business-kirjoituksia.
Mainin toteama journaliepävarmuus mitätöi vain täsmälleen saman palautuksen
omistajuuden. Tiukasti validoitu mitätöinti käsitellään odottavasta työjonosta
riippumatta; myöhäinen onnistumiskuittaus ei saa ohittaa jo vastaanotettua
mitätöintiä. Muut operaatiot säilyvät nykyisessä sarjajonossa.
Tavallinen end, force-end tai vieraan operaation vapautus
ei ohita estoa. Kulunut monotonic-aika tarkistetaan myös ennen myöhäisen
vastauksen kuittaamista; viivästynyt ajastin ei pidennä valtuutta.

Vain onnistunut palautus tai ennen pysyviä muutoksia todennettu turvallinen
peruutus saa vapauttaa edelleen voimassa olevan suojan sen nimetyn portin
kautta. Epävarmat tiedostot ja journal säilytetään. Uusi hallittu runtime
ei avaa business-käyttöä ennen nykyisen startup/recoveryn journal-,
omistajuus- ja terveystarkistuksia; restart ei itsessään ole korjaustodiste.
Poikkeama ei käynnistä automaattista palautusta, poista aineistoa tai nosta
aikarajaa. Tavallisen backupin ja päivityksen sopimukset säilyvät.

Tilakoneen ja yksityisen brokerin kohdetodennus on kirjattu V2ai:hin ja
live-aktivoinnin journal-/sulkukytkentä V2ak:hin. Offline/cold-palautuksen
sekä paketoidun ketjun lopullinen hyväksyntä kuuluu K:n nykyisiin portteihin;
pelkkä uuden viestioperaation olemassaolo ei todista niiden kytkentää.

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

### W7.3:n poiston valmistelun vientisopimus

**Lähdetoteutus, koko poistoketjun kytkentä kesken:** poiston backup-haara käyttää samaa
portable-vientialgoritmia, containeria ja nykyisiä siivousomistajia. Tavallinen
`create()` hankkii ja vapauttaa edelleen oman maintenance-suojansa. Poiston
kutsuja omistaa erikseen nimetyn suojan snapshotista todelliseen sulkuun;
vientipalvelu ei saa vapauttaa sitä onnistumisessa tai virheessä eikä lainata
update-/restore-valtuutta. Vain mainin nykyinen omistaja antaa tämän portin.

Lähteen `exactCurrentManifest`-kuitti ja viennin `restoreCompatible`-kuitti
säilytetään ennen turvalliseksi yhteenvedoksi projisointia ja stagingin
siivousta. Niiden varsinaiset sisältökentät vertaillaan
[W7.0:n vastaavuussäännön](local-company-workspace-plan.md#poiston-backup-todisteen-vastaavuus)
mukaan. Alkuperäisen autentikoidun container-kahvan identiteetti säilyy
tiivisteen rinnalla: myöhempi polun `stat` ei korvaa sitä. Tiedostoihin sidotun
kuittitiedon palautus odottaa lukukahvojen sulut ja tarkistuksen oman siivouksen.
Nykyinen tarkistusomistaja säilyttää itse luomansa muuttumattoman
operation/generation/session-sidonnan hyväksytyn kuitin rinnalla. Nimetty
mainin sisäinen evidence-luku käyttää samaa varattua kuluttajaelinkaarta;
uudelleentarkistus tyhjentää aiemman sidonnan ja päättynyt kuluttaja menettää
valtuutensa. Lähteen ja viennin tarkistukset ovat erilliset. Tunnisteita ei
lisätä turvalliseen yhteenvetoon tai rendererille.
Todettu vientisisältö ei itsessään ole poisto-, journal- tai paluuvaltuus.
Kutsujan valtuus tarkistetaan myös viimeisen tiedostosiivouksen ja koko
tarkistusoperaation omistajan paluun jälkeen, ennen sisältötodisteen palautusta.

Jo varmennettu käyttäjän vientikopio säilyy, vaikka poiston valtuus katoaa
myöhemmin tai lähdestagingin siivous jää epävarmaksi. Tällöin poiston
valmistelu ei onnistu eikä epävarmaa siivousta uusita automaattisesti.
Ennen varmennusta hylätty vienti ei kelpaa backup-todisteeksi. Salaisuus- ja
paikallisten asetusten nykyiset poissulut sekä tavallisen backupin käyttäytyminen
säilyvät.

Lähdekoodista johdettu yksityinen koe käyttää oikeaa salattua containeria,
tiedostoja ja synteettisiä PDF-tavuja. Yhdistetty koe käyttää nykyisen mainin
tarkistusomistajan luomia tunnisteita sekä nykyistä kertakopion ja kuluttajan
siivousta. Myöhempi liitoskoe yhdistää tähän nimetyn delete-maintenance-tilan,
client/brokerin ja installation-leasen nykyisen muistissa olevan omistajan.
Nimetty `validateDeletionProfileSnapshot` välittää poistosuojan omistajan
sekä lähteen että eri tunnisteella tarkistettavan viennin alku- ja loppulukuun.
Vientikutsun paikallinen sovitus käyttää samaa staging- ja tarkistusalgoritmia;
yleistä muuttuvaa tarkistuskontekstia tai update-valtuutta ei käytetä.
Väärä omistaja, kesken luvun peruttu suoja ja vaihtunut lease eivät anna kuittia.
SQLite, snapshotin lähde, prosessiraja, kuljetus ja fyysinen varaus ovat
vielä injektoituja. Yrityskohde, suojan luovutus todelliseen sulkuun sekä
kuitin lopullinen kulutus vaativat oman kytkentänäyttönsä.
Koetuloksen ja koko W7.3:n hyväksyntärajat ovat
[työtilasuunnitelmassa](local-company-workspace-plan.md#w73n-toteutussopimus).

Nimetty `createForDeletion` käyttää nyt tätä yhteistä vientipolkua. Se vaatii
mainin kutsujan elävän omistajuuden sekä tarkistuksen erilliset
`validateDeletionProfileSnapshot`- ja `withProfileSnapshotEvidence`-portit.
Tavallisen `create()`-kutsun sopimus ei vaadi näitä portteja eikä julkaise
sisäistä kuittia. Vientitodistus ei ole lopullisen poiston valtuus.
Tarkistuksen v13-broker nimeää poistosuojan erikseen molempiin
kontekstilukuihin. Suojalle ei ole saman runtimen vapautuskutsua;
peruutus estää myös vielä jonossa olevan täsmällisen begin-pyynnön.
Katkos, umpeutuminen tai epävarma drain säilyttää kirjoituseston.
Vientikopion säilytys lukitaan vasta alkuperäisen autentikoidun tiedoston,
lähde-/vientisisällön ja eri tarkistussidontojen onnistuneen vertailun
jälkeen, ennen tarkistusstagingin loppusiivousta. Säilytyskuittaus ei anna
poistovaltuutta: loppusiivouksen hylkäys estää sisällön palauttamisen
valmistelutuloksena, vaikka varmennettu käyttäjän kopio säilyy.
Kertakäyttöinen `deletionBackupReceipt` käyttää samaa sisältövastaavuuden
omistajaa ja torjuu myöntämisen tai kuluttamisen uudelleentulon ennen
ensimmäistä odotusta. Kulutus välittää vartijansa varsinaiselle
julkaisukuluttajalle ja mitätöi talteen jääneet callbackit myös virheessä.
Julkaisukuluttajan asynkroninen `assertPublicationCurrent` tarkistaa myös
vientitiedoston nykyisen identiteetin, koon ja tiivisteen. Kuluttaja kutsuu
sitä omien valmisteluodotustensa jälkeen ennen suojattua julkaisua;
pelkkä synkroninen valtuusvartija ei todista muuttuvia tiedostotavuja.
Sama täysi tarkistus tehdään ennen kuluttajaan pääsyä ja ennen kulutuksen
onnistunutta päättämistä. Sisäkkäiset valmisteluomistajan kohde- ja
valtuustarkistukset eivät käynnistä ylimääräisiä sisältölukuja.
Tarkistustulosta ei välimuistiteta odotusten yli. Hylkäys mitätöi kuitin
myös silloin, kun julkaisukuluttaja ottaa poikkeuksen itse kiinni.
Ensimmäinen tarkistusvirhe syyketjuineen säilyy kulutuksen tuloksessa;
myöhempi vartija- tai julkaisupoikkeus ei korvaa sitä yleisellä virheellä.
Päättämistarkistuksen hylkäys ei peru jo mahdollisesti tehtyä julkaisua
eikä anna oikeutta sen uusimiseen; W7.4:n journal omistaa epävarman tuloksen.
Tämä ei ole käyttöjärjestelmätason lukko ulkopuolisen kirjoittajan estämiseksi
tarkistuksen jälkeen. W7.4 todentaa oman todellisen julkaisukohtansa erikseen.
Lopullinen `readDeletionBackupExportIdentity` tarkistaa todelliset tavut
nykyisillä container-/stream-rajoilla sekä saman kahvan ja polun identiteetin
ennen lukua, sen jälkeen ja sulun valmistuttua. Se ei pura sisältöä uudelleen,
säilytä salasanaa tai korvaa alkuperäistä autentikoitua todistetta:
uudelleenluvun tuloksen on vastattava juuri tuota todistetta.
Lukuvirhe ja epävarma kahvasulku säilyvät erillisinä syinä eikä keskeneräinen
lukija palauta kuittia. Management-compositionin ehdollinen main-kytkentä
käyttää nyt saman portable-palvelun omaa vientisovitusta. Aktiivinen kohde
ja mainin validoima näyttönimi tarkistetaan ennen native-tallennusvalintaa;
valtuus tarkistetaan myös tiedosto- ja salasanaikkunan paluun jälkeen.
Vienti ja myöhempi uudelleenluku käyttävät samaa nykyisen portable-palvelun
tiedostopäätteen normalisointia. Päätteetön native-valinta ei saa johtaa
eri tiedoston lukemiseen; olemassa oleva pääte säilyy kirjainkoosta
riippumatta. Absoluuttisen kohteen ja sen omistajuuden tarkistuksia ei ohiteta.
Peruutus ei vaihda backup-valintaa menetyssuostumukseksi. Kukin vienti on
kertakäyttöinen, ja myöhempi uudelleenluku käyttää vain valittua tiedostoa
ja elävää vartijaa, ei salasanaa. Nykyinen tuotannon entrypoint ei vielä
anna W7.4:n julkaisukuluttajaa. Oikean native-/prosessi-/pakettiketjun
yhteistodennus säilyy W7.3:n avoimena porttina.

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
`<userData>/workspaces/<workspaceId>/runtime/recovery-points/<profile-id>/`-
juuressa registryn validoimalle työtilalle. Legacy-profiilin vastaava
`<userData>/runtime`-juuri kuuluu vain hyväksyttyyn adoption-polkuun. Ne eivät sijaitse
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

Suojattujen pisteiden rajattu poikkeus on erikseen vahvistettu yrityksen
lopullinen poisto: vain sen yrityksen omat pisteet poistetaan
[ADR-0009:n W7-päätöksen](../decisions/ADR-0009-local-backup-encryption-and-recovery-points.md#rotaatio)
mukaan. Normaali rotaatio ei saa käyttää tätä poikkeusta. W7:n tarkka
tuotantokytkentä ja keskeytyksestä palautuminen ovat vielä suunniteltavia.

Budjetti poistaa vanhimmat suojaamattomat pisteet. Suojattua pistettä ei
poisteta budjetin ylityksessä, vaan tila muuttuu turvalliseksi
`protectedPointsExceedBudget`-varoitukseksi. Poistot kirjataan ennen
ensimmäistä poistamista versionoituun rotaatiojournaliin ja keskeytynyt
rotaatio jatkuu idempotentisti seuraavassa tarkistuksessa.

Puhtaan sammutuksen merkki kirjoitetaan vasta backendin onnistuneen hallitun
sammutuksen jälkeen. Markerissa on vain formaattiversio ja ISO-aikaleima.
Väärä rakenne, puuttuva merkki tai kesken jäänyt marker-korvaus tulkitaan
unclean shutdowniksi.

Backendin sulkukahva säilyttää eron hallitun poistumisen (`exited`) ja
pakkopysäytyksen (`forced`) välillä. Tavallisen sulun pakkopysäytys voi
todistaa prosessin poistumisen, mutta se ei oikeuta puhtaan sammutuksen
merkkiin. Aikakatkaisu, muu sulkuvirhe tai hallitun sulun virhekoodillinen
poistuminen ei myöskään kirjoita merkkiä; `exited` edellyttää poistumiskoodia 0.
Samanaikaiset desktopin `shutdown()`-kutsut odottavat samaa lopputulosta;
keskeneräistä sulkua ei käsitellä jo valmistuneena. Sopimus todennetaan
backend-kahvan regressioilla sekä todellisen desktop-compositionin ja
marker-tiedoston yhteisellä testillä, ei pelkällä markerin yksikkötestillä.

## Päivitysten yhteensopivuus

Normaali versiopäivitys säilyttää aiemmin tallennetun business-datan ja
profiili-identiteetin. Uudet taulut, sarakkeet ja tietomallin muutokset
toteutetaan hallituilla forward-migraatioilla; profiilin tyhjentäminen tai
uuden yrityksen luomisen vaatiminen ei ole migraation korvaava ratkaisu.
Tuettujen aiempien versioiden varmuuskopiot validoidaan ja päivitetään
nykyiseen rakenteeseen restore-stagingissa ennen aktivointia.
Tämä säilyttämisvaatimus koskee myös tulevia tietomallimuutoksia:
tuetun vanhan varmuuskopion palautus ja business-sisällön säilyminen
kuuluvat kyseisen muutoksen hyväksyntänäyttöön. Pieni nykyinen testiaineisto
ei anna lupaa ohittaa yhteensopivuusporttia. Tuntematonta tai virheellistä
rakennetta ei hyväksytä yhteensopivuuden nimissä.

B5:n työpuutoteutuksessa katalogin skeema valitaan tarkistetusta
migraatiohistoriasta. Lähteen katalogi ja PDF-tavut validoidaan ennen
forward-migraatiota, ja nykytilan validointi vaatii sen jälkeen saman
alkuperäisen katalogin ennen tiedostojen materiaalistamista. Sisäinen
historiatieto ei laajenna startup-viestiä tai backup-manifestia; container ja
catalog-v1 säilyvät ennallaan. Alempien testitasojen sekä kehityspaketin
moniversioisen/legacy-palautuksen näyttö ja puhtaan revision avoin hyväksyntä kuvataan
[B5-checkpointissa](release-0.3.0-m1-preparation-plan.md#b5-katalogin-ja-palautuksen-checkpoint).

Yhteensopivuus ei tarkoita tuntemattoman, tulevan tai ristiriitaisen
migraatiohistorian tai profiili-identiteetin hyväksymistä. Näissä tilanteissa
toiminto keskeytyy tietoja muuttamatta. Tietomallimuutoksen testeissä
todennetaan aiemman tuetun rakenteen migraatio ja sisällön säilyminen nykyisen
backup/restore-testisopimuksen mukaan. Omistajan erikseen hyväksymä
kertaluonteinen testiprofiilin nollaus ei todista päivityksen tai palautuksen
yhteensopivuutta eikä muuta normaalin päivityksen säilyttämisvaatimusta.

## Inspector

Nykyinen eristetty tarkistus omistaa myös paketoitujen palautustestien
vertailusnapshotit. Mainin `ProfileSnapshotInspectionPort` palauttaa
sisältöön sidotun tuloksen; `withProfileSnapshot` pitää varauksen käytön yli
ja `removeProfileSnapshot` todistaa siivouksen. Testikuluttaja vertaa luetut
tavut receiptiin eikä poista stagingia suoraan. Siivousvirhe hylkää myös
muuten onnistuneen havainnon ja säilyttää ensisyyn erillään siivoustilasta.
Private broker v13 sallii vain snapshotin muodostamisen, maintenance-
toiminnot ja rajatun aktiivikontekstin luvun. Korvatut raskaat tarkistus- ja
aktivointivalmistelukomennot sekä niiden vastaukset hylätään; fallbackia ei
ole. Tämä ei muuta backup-formaatteja tai historiallisten kopioiden tukea.

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
- varmentaa SQLite-historiataulujen todelliset määrittelyt ennen niiden
  rajattua lukua ja koko valitun migration-prefixin objektijoukon ennen
  eheys-, FK- ja profiili-identiteetin tarkistamista; yhteisen tarkistimen
  omistaa [database/migration](local-database-implementation-plan.md#varmuuskopion-schema-tarkistin)
- vaatii SQLiteen tallennetun migration metadatan vastaamaan packaged
  SQL-manifestia; pelkkä backup-manifestin chain-arvo ei riitä
- hyväksyy restore-stagingissa yhden erikseen nimetyn, ennen migration-
  metadataa julkaistun legacy-ankkurin vain, kun `schema_migrations` on
  packaged SQL-manifestin täsmällinen 38 migraation prefix, viimeinen nimi ja
  laskettu chain identity vastaavat hyväksyttyä ankkuria,
  `schema_migration_metadata` puuttuu kokonaan ja autentikoidun backup-
  manifestin chain identity vastaa tietokannasta laskettua arvoa
- ei pura business-sisältöä aktiiviseen profiiliin
- palauttaa käyttäjälle turvallisen yhteenvetotilan ilman yritysdataa

K-paketin ensimmäinen schema-kytkentä ei vielä todista kaikkien kirjoittavien
käyttöpolkujen suojausta tai raskaan tarkistuksen eristämistä aktiivisesta
backendistä. Näiden keskeneräisen integraation ja hyväksynnän omistaa
[M1:n K-osio](release-0.3.0-m1-preparation-plan.md#k-paketin-valmistelu-ja-hyväksyntärajat).

Portable-luonti ja Inspect käyttävät nyt mainin pakollista omistajuusporttia,
nykyistä installation-leasen busy-rajaa ja receiptin yksityistä runtime-generationia.
Tarkistusreceipt ei yksin anna käyttö- tai poisto-oikeutta: omistettu varaus
säilyy lähdetavujen käytön ja riippumattoman itsevalidoinnin yli.
Kirjoitettavat tavut sidotaan saman tarkistuksen validoimaan artifact-joukkoon:
receiptin yksityinen sisältöidentiteetti muodostetaan täsmällisistä loogisista
poluista, koista ja todellisista SHA-256:ista. Main vertaa sitä kirjoitettaviin
lähdetavuihin. PDF:n nykyinen dokumentti-identiteetistä johdettu tallennusnimi
ei ole PDF-sisällön tiiviste; nimiä tai backup-formaatteja ei muuteta.
Tämä receipt ei kuulu rendererille, julkiseen HTTP:hen tai diagnostiikkaan.
Uusi työ
estetään synkronisesti sulkemisen alkaessa; koko kuluttajan rajattu tyhjennys
ja omistettu siivous vaaditaan ennen puhtaan sammutuksen merkintää. Ensivirhe
ja varmentamaton siivous säilyvät erillisinä, eikä epävarma poisto toistu.
[V2z:n kohdetodennus](release-0.3.0-m1-preparation-plan.md#v2z-portablen-main-kuluttajaportti)
ei vielä hyväksy recovery-/restore-kuluttajien pitkäikäistä staging-varausaikaa,
durable-handoffia, cold-recoveryä tai paketoitua palautusketjua. Vanha raskas
tarkistus ei ole portablen fallback. Kuluttajien siirron nykytila ja
paketoidun näytön hyväksyntä ovat [M1:n jatkamiskohdassa](release-0.3.0-m1-preparation-plan.md#jatka-tästä);
alla päivätyt vaiheet kuvaavat toteutushistoriaa.

[V2ab:n valmistellun slotin omistajuus](release-0.3.0-m1-preparation-plan.md#v2ab-valmistellun-palautuksen-omistajuuden-siirto)
estää kilpailevan stagingin, aktivoinnin ja discardin saman valmistellun
palautuksen aikana. Pysyvä tai epävarma journal-valmistelu kuluttaa slotin
ennen runtimen sulkua; se ei palaudu discardattavaksi kutsun hylkäyksessä.
Puhdas ennen journalia epäonnistunut yritys voidaan vapauttaa vasta journalin
sekä kyseisen operaation rollback- ja failed-kansioiden puuttumisen jälkeen.
Palvelu ei itse vapauta maintenancea epävarmassa handoffissa. Vanhan brokerin
ajastetun vapautuksen ja katkeamisen sovittaminen tähän pysyvään
omistajuuteen sekä tarkistusutilityn pitkäikäinen varaus ovat vielä avoimia
kuluttajakytkennän ehtoja, eivät tällä slot-korjauksella todistettuja.

Yhteinen käynnistystarkistus ja migration runner käyttävät samaa schema-porttia.
Runnerin sisäinen legacy-baseline ei laajenna backupin tai restore-startupin
038-poikkeusta. Backendin `openAttestedMigrationDatabase`
tarkistaa olemassa olevan kannan readonly-yhteydellä ennen kirjoittavaa
avausta ja uudelleen palautettavalla kirjoittavalla yhteydellä. Tämä ei
korvaa candidate-kopioinnin omaa esitarkistusta tai lähteen ja kopion
sisältösidontaa. Kolmen candidate-tarkistuksen
[avausportti](release-0.3.0-m1-preparation-plan.md#candidate-tarkistuksen-avausportti)
käyttää nyt samaa apua ilman luonti- tai tyhjän kannan valtuutta; alkuperäisen
snapshotin kopiosopimus säilyy erillisenä. Normaali käynnistys ei tee uutta
kaikkien PDF-tavujen tarkistusta tämän avausportin perusteella. Aiemman
hot-journal-regression ratkaisee [V2u:n rajattu omistetun työtilan palautus](release-0.3.0-m1-preparation-plan.md#v2u-omistetun-paikallisen-työtilan-kaatumispalautus).
Sen kohdenäyttö ei yksin hyväksy kaikkia candidate-kutsujia tai koko K:ta;
[nykyinen kutsujatarkistus](release-0.3.0-m1-preparation-plan.md#kn-kokonaiskytkennän-tarkistus)
omistaa korjausten näytön ja jäljellä olevat loppuportit. Tuotu backup ei saa omistetun paikallisen
työtilan kaatumispalautuspoikkeusta.

Nykyisen ja historiallisen julkaistun candidate-työtilan aktiiviprofiilin
viiteavaintarkistus lukee vain ensimmäisen `foreign_key_check`-virherivin.
Tarkistus ei kerää vioittuneen kannan kaikkia virheitä muistiin: jo yksi
riittää nykyiseen hylkäykseen, eikä ehjälle kannalle aseteta uutta kokorajaa.
Schema-avausportti, tuettujen historiallisten kopioiden ehdot ja sulkemisen
velvoitteet säilyvät. [K:n loppukatselmus](release-0.3.0-m1-preparation-plan.md#kn-kokonaiskytkennän-tarkistus)
erottaa kohdetodennuksen paketoidusta palautushyväksynnästä.

Candidate-kopioinnin esitarkistusehdokkaassa toistui ehjän WAL-snapshotin
hylkäys: myös readonly-avaus voi luoda sivutiedostoja. Korjaus rajattiin
alkuperäisen sijasta operaation oman kertakopion tarkistukseen.
[Omistetun kertakäyttöisen tarkistuskopion koe](release-0.3.0-m1-preparation-plan.md#v2e-erillisen-tarkistuskopion-koe)
läpäisi ennen tuotantokytkentälupaa. Alkuperäiseen
snapshotiin tai tuntemattomiin sivutiedostoihin ei kohdisteta poistoja.
Kytkentä edellyttää koko omistus-, sulkemis- ja siivousketjun todennusta,
mukaan lukien ylemmän kutsujan lähdeaineiston säilytys virheessä.
[Caller-säilytyksen V2f](release-0.3.0-m1-preparation-plan.md#v2f-kutsujien-aineiston-säilytys)
todentaa import-, replacement- ja activation-migration-kutsujien
säilytysrajat. Korvauksen lähdestaging ja ehdokaspuu tarkistetaan molemmat
ennen ensimmäistä poistoa; epäselvä koekansio ei kuulu rekursiiviseen
poistolupaan. Tämä ei vielä todista tarkistusutilityn poistumista eikä
tee erillisiä tiedostopoistoja atomiseksi transaktioksi.

[V2g:n synteettinen utility-koe](release-0.3.0-m1-preparation-plan.md#v2g-tarkistuskopio-todellisessa-utility-prosessissa)
todensi nykyisellä C-omistajalla erillisen koekopion natiivin sulkemisen,
lapsen todellisen poistumisen ja varauksen palautuksen sekä säilytyksen
puuttuvassa kuittauksessa, pakkopysäytyksessä ja vieraassa sisällössä.
[V2h:n varsinaiset WAL-kuluttajaregressiot](release-0.3.0-m1-preparation-plan.md#v2h-wal-kuluttajaregressio-ja-kytkentäpäätös)
vahvistivat ehjän backupin hylkäyksen ja lähdekansion sivutiedostot.
Omistaja hyväksyi rajatun kytkennän tämän jälkeen.
[V2i:n tuotantokuluttaja](release-0.3.0-m1-preparation-plan.md#v2i-tarkistuskopion-tuotantokuluttaja)
tarkistaa schema/historyn, identiteetin, eheyden ja katalogin samalla
omistetulla readonly-kopiolla. Migraatiokohteen kopiointi vaatii tämän
kopion tarkistetut tavut, koon ja SHA-256:n; lähteen readonly-avaus ei
kuulu enää tähän polkuun. Main luo ja sitoo tarkistuskansion identiteetin
ennen nykyisen C-varauksen luovutusta. Poisto vaatii native-sulkemisen,
lapsen poistumisen, callbackien valmistumisen ja main-varauksen palautuksen;
onnistunut siivous ei muuta epäonnistunutta operaatiota onnistuneeksi.
Kytkennän lopullinen katselmus ja packaged-palautustodennus ovat avoinna.
Tämä ei anna alkuperäisille tai tuntemattomille
sivutiedostoille poistolupaa eikä korvaa muistibudjetin tai paketoidun
palautuksen hyväksyntää.

`StagedProfileSnapshotInspector` omistaa staging-kannan ja artifactien
tarkistuksen ilman aktiivista tietokantaa. Schema ja sisältö luetaan samalla
readonly-yhteydellä; yhteys suljetaan myös hylkäyksessä. Korvattua
`StagedProfileSnapshotValidationService`-palvelua ei rekisteröidä aktiiviseen
backendiin. Yhteyskohtaiset query-only-,
trusted-schema-, mmap-, cache- ja temp-asetukset eivät ole prosessin
muistikatto; K:n eristys ja toimiva muistibudjetti todennetaan erikseen.

[V2ac:n eristetty kuluttaja](release-0.3.0-m1-preparation-plan.md#v2ac-snapshotin-hyväksyntäkäytännön-sidonta)
käyttää pakollista, kuittaukseen sidottua hyväksyntäkäytäntöä ja avaa vain
mainin prosessisukupolveen sitoman kertakopion. Alkuperäisen kannan ja katalogin
sekä tarkistuskopion tavut sidotaan ennen lukua ja tarkistetaan sulkemisen
jälkeen. Main siivoaa vain oman kansion todellisen native-exitin ja varauksen
palautuksen jälkeen; epävarmuus säilyttää aineiston. Tiukka snapshot-sisältöjoukko
ei muutu. V2ac:n kohdenäyttö ei hyväksynyt vanhan muodostajan eristämätöntä
kopiotarkistusta; myöhempi V2ag poistaa sen ja todentaa oikeat muodostajatavut.
Kumpikaan ei korvaa kaikkien durable-/restore-kutsujien ja paketoidun
palautuksen todennusta. Vanha broker ei ole uuden portin fallback.

[V2ad:n palautuspiste-Store](release-0.3.0-m1-preparation-plan.md#v2ad-palautuspisteen-tallennuksen-native-kytkentä)
käyttää eristettyä porttia myös salatun containerin riippumattomaan
itsevalidointiin ja materialisointiin. Omistettu staging-poisto vaatii native-
omistajan kuittauksen; valinnaisen settlement-metodin puuttuminen ei anna
poistolupaa. Epävarma siivous säilyttää containerin, avainkuoren ja stagingin
eikä julkaise hyvää indeksimerkintää. Onnistunut palautusmaterialisointi
jättää stagingin varauksen jatkavalle omistajalle. Sen durable-/offline-
handoff on K:n erillinen avoin portti, ei tämän kohdenäytön hyväksymä polku.

[V2ae:n valmistelukuluttajat](release-0.3.0-m1-preparation-plan.md#v2ae-odottavan-palautusstagingin-native-omistajuus)
säilyttävät tämän varauksen käyttäjän odottaessa. Prepared-metadata julkaistaan
vasta tuoreen omistajuuskuittauksen jälkeen. Portable-peruutus poistaa vain
omistajan portin kautta; epävarma siivous säilyttää aineiston, estää uuden
valmistelun sekä aktivointiclaimin ja tuottaa nykyisen turvallisen
`restore.stagingFailed`-tapahtuman. Tämä ei vielä valtuuta journal-handoffia
tai offline/cold-palautusta eikä muuta backup-formaatteja.

Legacy-poikkeus ei koske normaalia snapshotia, recovery pointia tai tavallista
startup-tarkistusta. Restore-aktivointijournalin `validateRestoredProfile`-tila
valtuuttaa täsmälleen kyseisen käynnistyksen käyttämään restore-yhteensopivaa
migration-tarkistusta ja profile restore -migraatiovaltuutta. Valtuus ei tule
rendereriltä eikä tätä restore-migraatiovaltuutta käytetä rollback-profiilin,
normaalin käynnistyksen tai update-polun yhteydessä. Siitä erillinen
[C:n alkuperäisketjun terminal-tarkistus](release-0.3.0-m1-preparation-plan.md#v2bc-cn-alkuperäisketjun-terminal)
ja [journaliton palautuskäynnistys](release-0.3.0-m1-preparation-plan.md#v2bh-journalittoman-cn-historiallinen-käynnistysadmissio)
käyttävät hyväksyttyä restoreCompatible-tarkistusta vain täsmällisesti
sidotulle alkuperäisketjulle ennen binaaripalautusta, ilman forward-migraatiota
tai UI:n avaamista. Se ei ole yleinen legacy-startup-poikkeus eikä koko K:n
valmistumisen todiste. Muu metadataa vailla oleva, lyhyempi, future-, missing-
middle- tai muuttuneeseen historialliseen SQL:ään perustuva kanta torjutaan.
Hyväksytyn legacy-backupin aktivoinnin jälkeen migration runner luo metadata-
taulun ja ankkuroi kaikki 38 riviä `legacy_baseline`-alkuperällä ennen
business-runtimen avaamista. Käynnistyksen jälkeinen profiilivalidointi vaatii
jälleen täsmällisen nykyisen migration-metadatan. Jo olemassa oleva mutta
puutteellinen tai virheellinen metadata ei koskaan muutu legacy-poikkeukseksi.

Väärä salasana ja muutettu artifacti palauttavat saman turvallisen
autentikointivirheen. Virhe ei kerro, mikä salauksen osa epäonnistui.

### Eristetyn tarkistuksen rajat ja valtuus

Tämä on hyväksytyn K-P2:n nykyinen runtime-sopimus. Vaihekohtaiset kokeet
ja niiden hylkäykset jäävät M1:n historiaan; kokonaisuuden nykytila on
[M1:n jatkamiskohdassa](release-0.3.0-m1-preparation-plan.md#jatka-tästä).
Schema-politiikan ja kutsujakohtaisten pending-ehtojen omistaa
[database/migration](local-database-implementation-plan.md#varmuuskopion-schema-tarkistin);
katalogin koko historian luennan omistaa
[artifact-inventaario](local-backup-artifact-inventory.md#rajattu-koko-revisiohistorian-tarkistus).

Main käynnistää kiinteästä paketoidusta entrypointista lyhytikäisen utilityn.
Se ei käynnistä HTTP-palvelua, avaa aktiivista profiilia, peri session- tai
SMTP-salaisuuksia, luo lapsiprosesseja tai aja tuotuja komentoja. Eristys
suojaa aktiivisen backendin työkuormaa, ei lupaa käyttöjärjestelmäsandboxia.

| Raja | Voimassa oleva sopimus |
| --- | --- |
| Rinnakkaisuus | Enintään yksi tarkistusutility installation-omistajaa kohti. Rinnakkainen pyyntö saa busy/unavailable-palautteen; ei rajatonta jonoa. |
| Työaika | Yksi monotoninen 35 000 ms määräaika pyynnön alusta terminaliin. Luotetun kontekstin haku, spawn ja valmistelu sisältyvät samaan aikaan. Vaihe tai viesti ei nollaa aikaa; decryptin ja candidate-migraation omat rajat säilyvät. |
| Pysäytys | 3 000 ms hallittu sulku ja 3 000 ms killin jälkeinen exit-odotus ovat siivousta, eivät validointityön jatkoa. Killin paluu tai terminal-viesti ei todista exitiä. |
| SQLite-muisti | 256 MiB `hard_heap_limit` asetetaan luotetulla muistiyhteydellä ennen tuodun kannan avausta. Readback ja todellinen valvonta vaaditaan erikseen; `MEMSTATUS=0` ei kelpaa readbackin perusteella. `mmap_size=0`, rajattu cache, temp muistissa. Aktiiviseen backendiin ei aseteta prosessiglobaalia heap-rajaa. |
| JavaScript-muisti | 512 MiB V8 old-space kiinteässä utility-käynnistyksessä. Tämä ja SQLite-raja eivät todista koko prosessin RSS-kattoa; IPC-, Buffer-, katalogi- ja rivirajat vaaditaan lisäksi. |
| Syöte/tulos | Suljettu versioitu private-protokolla, enintään 4 KiB/viesti. Main omistaa polut ja operation/generation/policy-sidonnan. Vain yhteenveto/kuitti tai turvallinen syy, ei SQL:ää, katalogia, rivejä tai raw-poikkeusta. Yksi terminal; väärä tai ylimääräinen hylätään. |
| Sisältö | Container 32 GiB, entry 24 GiB, katalogi 64 MiB / 100 000 kohdetta, PDF 10 MiB ja artifactit yhteensä 20 GiB. Hashaus virtana. Formaattirajaan mahtuminen ei lupaa valmistumista resurssibudjetissa. |

Budjettia ei kasvateta läpäisyn saavuttamiseksi. Ajurin toiminta ja
historiallisten fixturejen hyväksyntä vaativat
[inspection-only-toimituksen](local-desktop-dependency-review.md#rajattu-varmuuskopion-tarkistusajuri)
omat Windows-/Linux-, runtime- ja paketoidut todisteet.

Main omistaa kevyen aktiivikontekstin ja tarkistaa sen ennen työtä sekä
todellisen exitin ja reclaimin jälkeen. Vaihtunut profiili, kanava,
runtime-generation tai policy hylkää tuloksen, myös samalla profiili-ID:llä.
Puuttuvaa policya ei korvata oletuksella. Muodostetun snapshotin
`exactCurrentManifest` tai `compatibleHistoricalPrefix` säilyy mainin
private-tietueessa; tuotu aineisto käyttää erikseen `restoreCompatible`-
käytäntöä. Prepare, terminal-parseri ja main vaativat saman valitun policyn.
C:n muodostajan policy ja tarkistimen policy ovat erilliset alla kuvatun
alkuperäisketjun sopimuksen mukaan.

Utility saa vain operaation oman yksityisen juuren identiteettiin sidotun
`acquireWorkspaceProcessReservation`-varauksen, ei aktiivisen asennuksen
writer-varausta. Prepare/reservationReady/grant sitoo operationin,
generationin, sessionin ja elävän kanavan; luovutuksen aukko ei valtuuta
mainin siivousta tai lapsen myöhäistä avausta. Onnistuminen vaatii oikean
terminalin, onnistuneen todellisen exitin ja mainin takaisin saaman
varauksen. Pelkkä exit-koodi ei korvaa terminalia tai sulkemiskuittausta.
Timeout/cancel säilyttää ensisyyn ja käyttää vain yllä olevaa sulkubudjettia.

Kertakopion valmistelu tapahtuu mainin varaaman juuren alla ennen luovutusta.
Mainin oma receipt sitoo kansion ja vanhemman identiteetit; lapsen polku ei
anna poistolupaa. Valmistelun callbackien ja prepare/grant-kutsujen on
päätyttävä ennen siivousta. Epävarma sulkemiskuittaus, journal, vieras
sisältö, hardlink, korvattu juuri tai ei-tyhjä WAL säilyttää kopion.
Tyhjän käyttämättömän kansion poisto vaatii erillisen oman tyhjyyden
todisteen. Keskeytys viimeisen hakemistoluvun aikana estää uuden
poistokutsun; jo aloitettu tiedosto-operaatio voi silti valmistua.

Hallittu sovellussulku sulkee uuden työn pääsyn synkronisesti ja odottaa
koko omistettua kuluttajaa, ei vain utilitya. Epävarma exit, takaisinotto
tai kesken oleva mainin tiedostoluku estää poiston, aktivoinnin ja
uudelleenkäytön. Parentin kuolema ei todista lapsen poistumista. Startup
varaa tunnetun staging-juuren ennen sen oman sopimuksen mukaista siivousta;
busy tai epäselvä juuri säilyy. Vanha staging tarkistetaan uudelleen:
journal, ikä tai muistista puuttuva receipt ei hyväksy sitä. Tämä ei
anna W3:n journalittomalle plaintextille tai v1:lle cold-recovery-lupaa.

Private snapshot-brokerin nykyinen versio on 13. Komennot
`validateProfileSnapshot`, `validateActiveProfile` ja
`prepareProfileRestoreActivation` sekä niiden vastaukset on poistettu
tästä brokerista. V9/V10/V11/V12 eivät ole fallbackeja; samanniminen sisäinen
tarkistusportti ei palauta poistettua broker-komentoa. Julkinen HTTP,
renderer-capabilityt ja durable-formaatit eivät laajene.

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
yksi linkki. Epäonnistuneen stagingin poistaminen vaatii hallitun operaation
oman siivousvaltuuden, päättyneet lukijat ja tuoreen juuri-identiteetin.
Epävarma omistajuus, exit tai siivous säilyttää aineiston ja estää jatkon;
pelkkä hylätty Promise ei oikeuta poistoon.

Restore ei:

- kirjoita aktiiviseen profiiliin
- seuraa archive-entryn polkua ulos staging-juuresta
- hyväksy rendererin antamaa `companyId`:tä tai profiilipolkua
- käynnistä backupista sessionia tai salaisuutta
- yhdistä kahta profiilia
- tee best effort -osapalautusta

### Valmistellun palautuksen ja cold-valtuuden tarkennukset

Prepared-slotin yksinomainen claim otetaan synkronisesti ennen ensimmäistä
odotusta. Valmistelu jäädyttää oman täydellisen `prepared@0`-kuittinsa
ennen julkaisua ja asettaa tarkistusaineiston retention-esteen ennen
mahdollista journal-kirjoitusta. Sekä onnistunut että hylätty kirjoitus
vaatii muuttamattoman `prepared`/`notPrepared`-readbackin kaikkine kenttineen.
Sama operation-ID ei riitä. Initial-julkaisu vaatii current/next/backup-
slottien poissaolon myös ilman kutsujan lisäguardia.

Vain hylätyn kirjoituksen todistettu `notPrepared`, recovery-juurten
poissaolo ja tuore restore-, main- ja native-valtuus sallivat retention-
esteen perumisen. Fencen vapautuskuittaus ja sen jälkeinen omistajuustarkistus
kuuluvat samaan seurattuun peruutukseen; este poistuu vasta niiden jälkeen.
Shutdown ei saa väliin poistaa aineistoa. Ristiriitainen readback,
onnistumiskuittaus ilman prepared-todistetta tai epävarma varaus säilyttää
claimin ja aineiston sekä mitätöi jatkovaltuuden. Ensisyy edeltää
readback-/peruutusvirhettä.

Durable-handoff vapauttaa native-varauksen tiedostoja poistamatta ennen
inspectorin globaalia sulkua. Säilytetyn journalin jo todistetusti päättyneen
tarkistuksen varaus voidaan sulkea poistamatta tiedostoja; epävarma prosessi
tai siivous säilyttää molemmat. Säilytetty operaatio ei kelpaa uudeksi
tarkistuspyynnöksi, backup-lähteeksi tai tavalliseksi poistokohteeksi.
Aktivointi ei odota itseään inspectorin drainissa. Ready-backend käyttää
`stopForRestore(operationId)`-porttia; pending-migraatiokutsuja käyttää
oman startupinsa `stopStartupRuntime()`-valtuutta, ei ready-only-porttia.
Tiedostosiirto odottaa todellista backend-exitiä ja mainin reclaimia.

Cold-valinta käyttää laiskaa current -> backup -> next -etusijaa.
Valitun slotin hylkäys ei avaa alempaa fallbackia. `peek` on muuttamaton;
korjaava `read` tarvitsee tuoreen erillisen mutaatiovaltuuden. Puuttuvaa
operaatiojuurta ei luoda vain varauksen hankkimiseksi. DB- ja PDF-slotit
valitaan erikseen: intent hyväksyy täsmälleen yhden lähteen tai kohteen,
myös renamen jälkeisessä keskeytyksessä. Puuttuvan slotin ensimmäinen
olemassa oleva vanhempi tarkistetaan ennen mkdir/chmodia. Failed-juuren
epävarma aineisto estää forwardin.

Cold- ja original-receipt eivät ole portable-receiptejä. Cold käyttää
`restoreCompatible`-policya ja kiinteitä työtila-/operaatiolayoutteja,
ei yleisiä polkuja. Utility sulkee SQLiten ja kirjoittaa omaan
sukupolvisidonnaiseen kopioon `cold-document-bindings-v1.json`-luettelon
vain valituista PDF:istä: formatVersion, loogiset ja suhteelliset polut,
koot ja todelliset SHA-256:t. Luettelo ei ole uusi backup, journal tai
business-rivien kopio. Receipt sitoo sen koon ja hashin; main johtaa polun
omasta kopiostaan, lukee vasta exit/reclaimin jälkeen ja tarkistaa tarkat
kentät, yksiselitteiset suhteelliset viitteet, identiteetit sekä receiptin
lukumäärän, tavumäärän ja aggregaten. Myös sarjoituksen ennakkoraja on
64 MiB; muut yllä olevan budjettitaulukon rajat säilyvät.

Ensimmäinen hyväksytty sisältö ja jäädytetyt PDF-sidonnat pysyvät
vertailuperustana. Slot-vaihto vaatii uuden nimetyn tarkistuksen samaan
sisältöön; receiptin slotteja ei kirjoiteta uudelleen. Alkuperäinen
35 000 ms työdeadline ei uusiudu siirrossa. Main tarkistaa vain nimetyt
tiedostot, ei SQLitea tai arvattua koko hakemistoa. Lähdetavut sidotaan
uudelleen viimeisten awaited journal/census/owner-tarkistusten jälkeen;
myöhemmän DB-luvun aikana muuttunut aiempi PDF hylätään.

Original-tarkistus erottaa active/rollback/absent-slotit tuotavasta
sisällöstä. Dokumentti-absent ei kelpaa katalogin vaatiessa PDF:iä;
ilman alkuperäiskantaa dokumenttikansio ei todista business-katalogia.
Ensimmäinen alkuperäiskuitti ei takautuvasti todista journalin syntyhetken
tavuja. Paikallaan pysyvä ankkuri on valitun operaation
`failedOperationRoot`: vain sen viimeinen oma tyhjä kansio voidaan
luoda eksklusiivisesti tuoreen journalin, censuksen, leasen ja lähdejuurten
native-poissaolon jälkeen. Vierasta kansiota ei omaksuta. Siirtyvän tai
poistettavan juuren varaus suljetaan vasta päättyneiden lukujen ja
exit/reclaimin jälkeen juuri ennen nimettyä operaatiota; vanhan polun
descriptoria ei kirjoiteta uudeksi. Cold-hylkäys ei anna valtuudettoman
`failedSafe`-kirjoituksen lupaa.

Live-virhehaaran `validationStarting@r` voi edetä vain saman operaation
`rollbackStarting@r+1` ja `rolledBack@r+2` -tiloihin. Ennen intentiä
alkuperäiset ovat rollback-slotissa tai todistetusti absent, eivät jo
siirrettyjä. Lykätty päätös omistetaan heti validoinnin jälkeen ennen
myöhempiä health/session-tarkistuksia samalla recovery-instanssilla.
Aloitettu tai epävarma hyväksyntä estää rollbackin; hylätty rollback-valtuus
estää myös yleisen workspace-recoveryn kautta toisen runtimen avaamisen.

Terminal-census sisältää myös tyhjät kansiot ja sallitut lapsilistat.
Kompakti vanhempi/nimi-kirjanpito säilyttää 64 MiB / 100 000 PDF:n rajat;
toistuvia absoluuttisia polkuja ei lasketa uudeksi sisältörajaksi.
`commitAcceptance` julkaisee ja lukee takaisin jäädytetyn accepted-tilan
poistamatta juuria; `clearAccepted` siivoaa erikseen saman valinnan.
Puuttuva accepted-juuri jää puuttuvaksi eikä sitä luoda tai varata.
Poistettu juuri ei todista journalin poistovaltuutta.

**Hylätty oikopolku pysyy hylättynä:** hyväksyntäjournalin inventaariolukujen
siirtämistä ei hyväksytty. Myöhäinen muutos saattoi julkaista `accepted`-
tilan tai poistaa journalin `.backup`-edeltäjän ennen hylkäystä;
lisä-`peek` ei todistanut kaikkia sivuslotteja. Hyväksytty cold-journalin
rajattu valmistelu ja enintään neljän PDF-/census-merkinnän eräluku eivät
poista hyväksyntäjournalin yhdistettyjä tarkistuksia tai poistovartijoita.
Ensimmäinen census-järjestyksen virhe säilyy, kaikki aloitettu työ päättyy,
eikä Promise-hylkäys todista käyttöjärjestelmälukupyynnön peruuttamista.
Saman tilin valtuussopimuksen ulkopuoliseen kirjoittajaan ei luvata
käyttöjärjestelmätason atomisuutta.

## Aktivointi ja rollback

Kun staging-profiili on täysin validoitu:

1. aktiivisesta profiilista tehdään validoitu pre-restore-palautuspiste
2. business-komennot estetään
3. backend, SQLite, brokerit ja runtime-session suljetaan ADR-0008:n mukaan
4. staging-profiili vaihdetaan atomisesti aktiiviseksi
5. uusi runtime-session luodaan
6. tarvittavat forward-migraatiot tehdään maintenance-tilassa
7. SQLite ja business-artifactit validoidaan uudelleen
8. backend readiness ja health tarkistetaan
9. käyttöliittymä avataan vasta onnistumisen jälkeen

Ennen pysyvää hyväksyntää tapahtuva virhe sulkee uuden runtimen ja käyttää
alla rajattua rollback-valtuutta. Pelkkä virhe ei oikeuta tiedostomuutoksiin;
hyväksytyn operaation siivousvirhe ei ole rollback-peruste. Rollback
hyväksytään vasta, kun vanha profiili käynnistyy terveenä.

Startupin loppuvaihe käyttää [valitun journalin tuoretta sidontaa](release-0.3.0-m1-preparation-plan.md#v2at-loppuvaiheen-journal-sidonta).
Hyväksyntä, rollback ja siivous eivät vaihda operaatiota uudella korjaavalla
luvulla. Oman tavallisen forward-keskeytyksen etenemä varmennetaan ilman
journal-mutaatiota ennen rollbackia; cold-forward ei saa tätä valtuutta.
Pääjournal poistetaan vasta sen sivuslottien jälkeen. Journal-guard ei
korvaa sisältö-, lineage- tai nykyistä prosessipoissaolon todistetta.
Sisältöä tarkistava cold-forward ja cold-rollback käyttävät journalin
edeltäjäkirjoituksessa [erillistä sisältövaltuutta](release-0.3.0-m1-preparation-plan.md#journalin-valinta--ja-sisältötarkistuksen-rajattu-koe).
Kevyt omistajuus-/valintatarkistus ei lue koko sisältöä uudelleen, mutta
tuore sisältötarkistus säilyy ennen nextin julkaisua sekä edeltäjän poistoa.
[Hyväksytty tarkistuskohtien rajaus](release-0.3.0-m1-preparation-plan.md#pdf-luvun-ja-cold-journalin-tuotantokytkentä)
sallii nextin luonnin/kirjoituksen ja edeltäjän siirron backupiksi tuoreella
omistajuus-, valinta- ja slottitarkistuksella. Valtuus ja valitut slotit
varmennetaan sisältötyön jälkeen uudelleen. Muut kutsujat säilyttävät
yhdistetyn tarkistuksen. Avatun nextin muuttuneet tavut tai polku sekä
ennen backupin poistoa ilmestynyt next estävät jatkon ja säilyttävät
aineiston. `read` voi korjata slotteja: läsnä olevan sivuslotin poisto vaatii
nykyisen valtuuden. Todetusti puuttuvalle sivuslotille ei tehdä poistokutsua;
myöhemmin ilmestyneen tiedoston poistamiseen ei synny lupaa. `clear`-metodin,
alkujulkaisun ja business-tiedostosiirtojen suojat säilyvät.
Cold-forwardin kohdekansion valmistelu tarkistaa omistajuuden, täsmällisen
journalin sekä tuoreen slot- ja polkurakenteen. Varsinaiset sisältösiirrot ja
aktivoidun sisällön oikeusmuutokset vaativat edelleen tuoreen sisältötarkistuksen.
Hylkäys saa jättää keskeneräisen nextin, edeltäjän backup-slotin tai tyhjän
kohdekansion, mutta ei tarkistamattoman sisällön julkaisua. Uusi käynnistys
hankkii sisältövaltuuden uudelleen; journalin valinta ei korvaa sitä.
Live-activationin [täsmällinen valmistelukuitti ja julkaisun valtuus](release-0.3.0-m1-preparation-plan.md#v2bg-aktivoinnin-täsmällinen-journal-ja-valtuus)
sitovat saman operaation `prepared@0`-journalin readbackiin, forward-siirtoihin
ja oman forward-virheen jälkeiseen rollbackiin. Pelkkä operation-ID tai
kirjoituksen kuittaus ei anna tätä lupaa. Valtuuden menetys säilyttää
aineiston; tavallisen runtimen valtuus säilyy startupin päätyttyä mutta
lakkaa runtime-shutdownin alkaessa.
Transaktion luonti- ja forward-julkaisut tarkistavat journalisidonnan myös
alkuperäisillä kutsumuodoilla ilman erillistä valtuusfunktiota. Kutsujan
lisävaltuus ei korvaa eikä aktivoi tätä yhteistä julkaisusuojaa.
Journalittoman C-palautuksen [historiallinen käynnistysadmissio](release-0.3.0-m1-preparation-plan.md#v2bh-journalittoman-cn-historiallinen-käynnistysadmissio)
sitoo ennen backendin avausta valitun update-operaation nykyiseen
schema-yhteensopivuuspoikkeukseen. Prepare ja grant varmentavat saman
valinnan uudelleen. Tämä ei hyväksy palautuksen sisältöä, ohita
alkuperäisketjun porttia tai anna tiedostomutaatio- tai siivousvaltuutta.
Ennen forward-vaiheen hyväksyntää tai rollback-intentiä nykyinen strict-census
varmentaa alkuperäisten, tuotavien ja aktiivisten slottien vaihekohtaisen
tilan. Puuttuva alkuperäinen tai ylimääräinen slot säilytetään selvitykseen;
paikallaan olevaa uutta tiedostoa ei arvata jo palautetuksi alkuperäiseksi.
Jo keskeytyneen rollbackin oma sisältövaltuus pysyy erillisenä vaatimuksena.

[Keskeytyneen rollbackin slot-valinta](release-0.3.0-m1-preparation-plan.md#v2au-keskeytyneen-rollbackin-slot-valinta)
varmentaa lisäksi alkuperäisen aktiivisen/rollback-sijainnin tai journalin
todistaman alkuperäisen poissaolon sekä säilyneen tuotavan sisällön.
Keskeytyneen rollbackin siirrot jatkuvat dokumentit-ennen-tietokantaa-
järjestyksessä. Slot-valinta ja census tarkistetaan ennen mutaatiota,
rename-retryä ja terminal-journalin siivousta; valittu journal ja omistajuus
pysyvät tuoreina. Stagingin
koko juuren viimeinen siirto failed-aineistoksi saa tapahtua vasta molempien
alkuperäisten slottien palautumisen jälkeen. Puuttuva, päällekkäinen tai
linkitetty slot estää siirrot ja terminal-journalin siivouksen. Tämä
tiedostotilan tarkistus ei korvaa sisältö-, lineage- tai native-valtuutta.

Palautuneen `rolledBack`-operaation tyhjien rakennekansioiden siivous ei ole
rekursiivinen. Vain nimetty tyhjä `data`, tyhjä `storage` ja niiden tyhjä
operation-juuri poistetaan. Tuntematon tai myöhäinen sisältö, epäkanoninen
hakemisto tai poiston jälkeen palannut juuri säilyttää aineiston ja
journalin. Osittain valmistunut tyhjien kansioiden poisto saa jatkua
tarkistettuna; sivuslottien ja pääjournalin poisto vaatii lopuksi juuren
puuttumisen. [Rajattu siivousnäyttö](release-0.3.0-m1-preparation-plan.md#v2aw-rollbackin-loppusiivouksen-säilytys)
ei korvaa backendin jälkeisen terminalin sisältö- ja omistajuusvaltuutta.

W7.2:n [valitsimeen paluun sopimus](local-company-workspace-plan.md#rajatun-kokeen-mukainen-toteutussopimus)
nimeää erillisen cold-loppusiivouksen nykyiselle startup-omistajalle.
Tuore alkuperäissisällön ja päättyneiden töiden valtuus säilyy journalin
poistoon asti. Palautusjuuren oma varaus suljetaan juuri ennen sen tyhjää
poistoa; palautettu juuri-identiteetti tarkistetaan uudelleen, ja elävä
synkroninen omistajuustarkistus seuraa viimeistä asynkronista lukua.
Vanhentunut valtuus tai korvattu juuri säilyttää aineiston. Lopuksi odotetaan
myös ankkurin, muiden varausten ja restore-leasen sulut. Tämä ei ole
business-terveystodiste, eikä accepted- tai epävarmaa hyväksyntää voi
muuttaa tällä rollbackiksi. Tavallisen live-palautuksen polku säilyy.

[Alkuperäissisällön erillinen tarkistussopimus](release-0.3.0-m1-preparation-plan.md#v2av-alkuperäissisällön-tarkistussopimus)
pitää alkuperäisen kannan ja dokumenttien sijainnit erillään tuotavasta
sisällöstä. Journalin valitsema alkuperäiskannan poissaolo ei tuota
terveys-, schema- tai identity-kuittia, vaikka aktiivisessa paikassa on
uusi kohdekanta. Utility-tulos palautuu vasta lapsen exitin ja varauksen
palautumisen jälkeen. Nimetty main-kuluttaja lukee sidonnat tämän jälkeen
ja tarkistaa lähdevalinnan uudelleen. Poissaolotulos vaatii tyhjän
tarkistuskopion; ristiriita säilyttää kopion selvitykseen.
Nimetty tarkistus sekä paikallaan pysyvän ankkurin ja molempien startup-
kuluttajien rollback-kytkentä on kohdetodennettu. Valittu journal, tuore
census, sisältö ja identiteettisidotut native-varaukset portittavat siirrot.
Luovutuksen aikana tarkistetaan installation- ja lähdevaltuus; ankkurin
main-omistajuus tarkistetaan ennen luovutusta ja exit/reclaimin jälkeen.
Staging-varauksen vapautus ei kadota juuren identiteettisidontaa: sama juuri
tarkistetaan rename-uusinnassa ja siirron kohteessa. Vanhentunut tai
ristiriitainen havainto säilyttää aineiston ja estää jatkon.
Kuitti ei yksin anna siirto- tai siivouslupaa. Business-backendin jälkeinen
loppusiivous ja C offline vaativat edelleen omat tuoreet valtuutensa;
startupin kohdenäyttö ei sulje koko K:n palautus- ja integraatioportteja.

Valitun kohde- ja alkuperäissisällön yhteinen tavutarkistin lukee PDF:t
enintään neljän tiedoston erissä. Kaikki aloitetut luvut ja sulut päättyvät
ennen seuraavaa erää, erillistä sarjallista DB-lukua tai jatkopäätöstä.
Ensimmäinen havaittu virhe lukitaan ennen odotettavaa sulkua; myöhempi
sulkuvirhe ei korvaa sitä. Jokaisen tiedoston todelliset tavut, koko,
tiiviste, PDF-alkutunniste ja kahva-/polkuidentiteetti tarkistetaan edelleen.
Viimeinen tiedostosidonta tehdään vasta kutsujan odotetun loppuvaltuuden
jälkeen. Aiemman onnistumisen tiivistettä ei käytetä uusien tavujen lukemisen
korvikkeena, eikä eräluku muuta aika- tai muistirajoja.

[Hyväksynnän ja siivouksen tilasopimus](release-0.3.0-m1-preparation-plan.md#v2az-hyväksynnän-pysyvyys-ja-alkuperäiskannan-poissaolo)
erottaa pysyvän `accepted`-julkaisun sen jälkeisestä siivouksesta.
Keskeytynyt accepted-siivous odottaa tuoreen backendin sisältövalidointia;
siivousvirhe tai puuttuva commit-kuittaus ei anna vanhaa rollback-valtuutta.
Journalin osoittama alkuperäiskannan poissaolo pysäyttää rollbackin
business-käynnistyksen selvitykseen ennen tyhjän kannan luontia.
Normaali forward-palautus alun perin puuttuvaan kantaan pysyy erillisenä.
Tuore live-snapshot- ja terminal/native-poistovaltuus vaaditaan koko
palautusketjun todentamiseen ennen K:n hyväksyntää.

[Terminal-inventaarion rajattu toteutus](release-0.3.0-m1-preparation-plan.md#v2ba-terminal-inventaario-ja-nimetty-siivous)
siivoaa hyväksytyn operaation vain jäädytetyn tiedostolistan nimetyillä
poistoilla. Sallitun rakenteen ulkopuolinen tai myöhäinen sisältö säilytetään;
keskeytynyt siivous säilyttää hyväksytyn journalin eikä aloita rollbackia.
Identiteetti-/lapsilistainventaario ei ole sisältökuitti tai native-poistolupa.
Kaapatun tiedostoluettelon [merkintöjen uudelleentarkistus](release-0.3.0-m1-preparation-plan.md#tiedostoluettelon-rajatun-lukuerän-ehdotus)
käyttää enintään neljän tiedosto- tai kansiomerkinnän erää. Jokainen
aloitettu tarkistus päättyy ennen jatkoa; hylätystä erästä säilytetään
luettelon järjestyksen ensimmäinen alkuperäinen virhe. Puuttuvan tai jo
poistetun merkinnän tarkistus sekä juurten vaihto odottavat edeltävän erän.
Alkuperäinen luettelon keräys, merkinnän sisäiset tarkistukset, journalin
tarkistuskohdat ja nimettyjen poistojen sarjallinen suoja eivät muutu.
[Live-terminalin rajattu kytkentä](release-0.3.0-m1-preparation-plan.md#v2bb-live-terminalin-tuore-valtuus)
sitoo nämä nykyiseen snapshot-/tarkistusketjuun restore-kirjoitussuojan ja
installation-leasen alla. Snapshotin paikallaan pysyvä native-varaus ja
operation-juurten täsmälliset varaukset säilyvät journalin julkaisuun ja
jokaiseen mutaatioon asti. Async-journal-luku vaatii tämän jälkeen uuden
valtuustarkistuksen. Accepted-cold-valinta ei siivoa sivuslotteja ennen
tuoretta validointia. Epävarmuus säilyttää hyväksytyn journalin ja
kirjoitussuojan; siivousvirhe ei ole rollback-lupa. K:n integraation
hyväksyntänäyttö on [nykytilan omistajalla](release-0.3.0-m1-preparation-plan.md#jatka-tästä).
Uusi muutos tarvitsee edelleen oman vaikutusalueensa palautus- ja integraatioportit.

Tavallisen ja palautuksen jälkeisen käynnistyksen aktiivivalidointi lainaa
mainin omistamaa täsmällistä restore-varausta. Main säilyttää varauksen
hylkäyksestä tarkistajien ja backendin varmennettuun pysähtymiseen sekä
alkuperäisaineiston rollbackiin asti; rollback ei hanki toista varausta.
Tarkistin tarkistaa sekä lainatun identiteetin että nykyisen restore-omistajan
ja palauttaa vain metadataa, ei myöhempää mutaatiovaltuutta. Epävarma sulku
tai kadonnut omistaja säilyttää aineiston ja estää jatkon. Onnistuminen
vapauttaa varauksen vasta tarkistus-/siivousketjun jälkeen; terminal-vaihe
hankkii oman tuoreen sisältötodisteensa. Päivityksen erillinen update-varaus
ja C-konteksti noudattavat
[asennin- ja update-omistajan kutsujasopimusta](windows-installer-and-update-plan.md#cn-tarkistuskutsujien-valtuus).

[C:n ennen migraatioita toimiva terminal](release-0.3.0-m1-preparation-plan.md#v2bc-cn-alkuperäisketjun-terminal)
vaatii journalin täsmällisen alkuperäisketjun ja update/restore-operaatioparin
ennen siivousta. Sen eristetty tarkistin käyttää vain nimenomaisen restore-
kirjoitussuojan kautta valittua olemassa olevaa `restoreCompatible`-policya;
tavallisen live-terminalin current-manifest-sääntö ei muutu. Backendin
schema-readerin restore-poikkeus päättyy käynnistysgaten mukana. Rajattu
onnistumis- ja accepted-jatkonäyttö ei hyväksy koko mainia tai binaarihandoffia.

Aktivointijournalissa ei ole yritysdataa, salaisuutta tai rendererille
palautettavaa polkua. Vaiheen pitää olla idempotentti restartin jälkeen.

## Cross-company-raja

Nykyinen ADR-0011:n multi-workspace-malli erottaa kaksi käyttäjälle näkyvää
toimintoa:

- rekisteröimättömän lineagen backup voidaan tuoda uutena työtilana
- olemassa oleva exact-lineage-työtila voidaan korvata vain, kun se on ensin
  vaihdettu aktiiviseksi.

Passiivista työtilaa ei korvata toisen työtilan runtimen ollessa aktiivinen.
Molemmat operaatiot vaativat installation-scoped maintenance-leasen,
candidate-stagingin ja nykyiset formaatti-, migraatio-, identity-, SQLite- ja
artifact-validoinnit. Vanhaa yleistä active-profile restore -capabilityä ei
altisteta rendererille eikä käyttöliittymälle; import ja korvaus käyttävät vain
workspace management -palvelun nimettyjä reittejä.

Ennen multi-workspace-kytkentää syntynyt profile restore -activation journal
voi vielä löytyä käynnistyksessä. Rekisteröidyn aktiivisen workspacen
tapauksessa transactionin hyväksyntä lykätään backend-, migration- ja
artifact-validoinnin sekä registryltä johdetun exact-lineage-tarkistuksen
jälkeen. Lineage-ristiriita palauttaa edellisen profiilin journalin omasta
rollback-slotista ennen journalin siivousta ja käynnistää sovelluksen uudelleen.
Tuntematonta tai journalitonta ristiriitaa ei korjata arvaamalla.

Lykätyn hyväksynnän palautumisvastuu alkaa heti, kun restored-profile-
validointi palauttaa päätöstä odottavan tuloksen. Myöhempi health- tai
session-tarkistus ei saa jäädä tämän vastuun ulkopuolelle. Jos tarkistus
epäonnistuu, backend suljetaan ennen tietokannan ja asiakirjajuuren
rollbackia. Epäonnistunut sulkeminen ei ole sulkeutumistodiste: journal,
rollback-tavut ja tutkittava profiili säilytetään, eikä business-ikkunaa
avata, aktiivista yritysosoitinta palauteta tai uutta runtimea käynnistetä.
Sama sulkemisvaatimus koskee jo ensimmäisessä profiilivalidoinnissa
tapahtuvaa virhettä, myös yrityksen vaihtoon liittyvässä palautuksessa.

[Tarkistusvirheen jälkeinen rollback-valtuus](release-0.3.0-m1-preparation-plan.md#v2bd-tarkistusvirheen-jälkeinen-rollback-valtuus)
ei synny pelkästä backendin pysäytyksestä: main varmentaa myös inspectorien
sulkemisen ja native-omistajuuden sekä tarkistaa alkuperäisen sisällön
tuoreesti ennen korjaavaa journal-lukua ja rollback-intentiä. Sama valtuus
säilyy tiedostosiirtoihin asti ja sallii vain valitun journalin täsmälliset
revisiovaiheet. Lykätty päätös ei nollaa recovery-instanssia. Epävarmaa
hyväksyntää ei palauteta, eikä hylätty rollback-valtuus anna lupaa
valita uutta runtimea yleisen työtilapalautuksen kautta.
Puuttuva valtuuskytkentä hylätään myös suorassa startup-kuluttajassa.
Voimassaolo tarkistetaan uudelleen viimeisen journal-odotuksen jälkeen.
Alkuperäiskannan poissaolon palauttava onnistunut tiedostorollback säilyttää
journalin eikä anna lupaa vaihtaa yritysosoitinta tai käynnistää toista runtimea.

Vaatimus koskee myös epäonnistunutta käynnistystä ennen backend-kahvan
palauttamista. Puuttuva kahva ei osoita, ettei prosessia syntynyt.
Recovery edellyttää [startup-omistajan todistusta](local-desktop-implementation-plan.md#käynnistyksen-omistajuus-ennen-backend-kahvaa)
sekä prosessin poissaolosta että migraatiovalmistelun päättymisestä;
tuntematon tai keskeneräinen tila ei valtuuta tiedostomuutoksia.

`desktopRestoreStartup.test.ts` todentaa tämän oikean compositionin,
rekisterin, journalin ja tiedostotransaktion kautta synteettisillä tavuilla.
Se korvaa aiemman pelkän lähdetekstin järjestystarkistuksen: mukana ovat
vieraan lineagen rollback ja seuraava validointikäynnistys, saman lineagen
hyväksyntä, myöhäinen health-virhe sekä sulkemisen ja rollbackin virheet.
Backendin validointivastaus ja Electronin rajat ovat tässä kontrolloituja;
testi ei yksin todista SQLite-migraatiota tai paketoidun sovelluksen
käynnistymistä. Muutoksen hyväksyntä vaatii edelleen hardened Windows
backup -> inspect -> restore -> restart -> compare -näytön ja normaalit
muuttuneen revision CI-portit. Aiemman julkaisun hyväksyntä ei siirry
uuteen ajokoodiin.

### W3:n backup-import uutena työtilana

**Vaihehistoria:** W3:n foundation todennettiin ensin synteettisellä
nykyversion backupilla, PDF-artifactilla ja historiallisella prefixillä.
Nykyisen tuotantokytkennän omistaa workspace-suunnitelma ja hyväksyntätilan
[M1:n jatkamiskohta](release-0.3.0-m1-preparation-plan.md#jatka-tästä).

W3 ei käytä aktiivisen profiilin restore-controlleria, preRestore-pistettä,
activation journalia tai korvaavaa aktivointia. Backup inspector säilyttää
`.ekybackup`-formaatin omistajuuden, mutta workspace import coordinator käyttää
sitä kahdessa rajatussa vaiheessa:

1. import-lease hankitaan; ratkaisematon journal tai todistamaton
   plaintext estää uuden työn. Ennen shutdownia container autentikoidaan ja
   suljettu manifesti tarkastetaan avaamatta SQLitea
2. shutdownin ja runtime-absence-todisteen jälkeen container autentikoidaan
   uudelleen, puretaan private candidateen ja sen SHA-256, `profileId` sekä
   migration chain -identiteetti verrataan ensimmäiseen tarkastukseen.

Täysi SQLite-, migration-, identity- ja artifact-validointi tapahtuu vain
backendin yksityisen import-portin kautta. Main ei saa SQLite-kahvaa.
Historiallinen ehjä prefix hyväksytään, mutta vain puuttuvat nykyisen
packaged manifestin forward-migraatiot ajetaan. Future-, changed-, reordered-
ja missing-middle-historia torjutaan.

Backupista ei tuoda SMTP-salaisuutta, safeStorage-blobia, PDF-arkiston
asetusta tai retry-journalia, accepted-build/update-statea, installer-statea,
lokeja, diagnostiikkaa, tukipakettia tai ulkoisia PDF-kopioita. Candidateen
saavat päätyä vain autentikoitu SQLite, snapshot-katalogi ja katalogin
todistamat auktoritatiiviset business-artifactit.

Ennen lopullista julkaisua registry tarkastetaan toisen kerran duplicate-
lineagen varalta. Onnistunut W3-import julkaisee uuden `ready`-työtilan,
mutta ei käynnistä sitä eikä korvaa aktiivista työtilaa.

Abrupt termination voi jättää plaintext-payloadin ilman import-journalia.
Tällöin W3-recovery säilyttää aineiston ja estää avauksen: journalin puute
ei todista vanhaa omistajaa poistuneeksi. Vain hyväksytyn v2-operaation oma
siivous noudattaa yllä olevaa C/R18-porttia. Tuntematon nimi tai tyyppi, symlink/reparse
point, hardlink, ylikokoinen payload tai containment-ristiriita johtaa
`recoveryRequired`-tilaan ja säilyttää epäselvän sisällön tutkimista varten.

### W3b:n same-lineage-korvaus

**Tila:** toteutettu ja testattu workspace management -foundationina sekä
kytketty W5A:ssa Electron mainin sisäiseen production-compositioniin. Renderer-
capability, käyttäjäpolku ja exact-lineage Electron-E2E on hyväksytty W5B.2-
checkpointissa. W6:n packaged backup -> inspect -> restore -> restart ->
compare -portti ja release-hyväksyntä ovat edelleen avoimia.

W3b ei rakenna toista restore-moottoria. Se muodostaa nykyisen
`ProfileRestoreActivationTransaction`-transactionin aktiivisen workspacen
johdetuilla tietokanta- ja artifact-poluilla sekä yksityisillä operation-
scoped staging-, rollback- ja failed-rooteilla. Nykyinen activation journal
on aktivoinnin ja rollbackin ainoa durable auktoriteetti, ja
`ProfileRestoreStartupRecovery` ratkaisee keskeytyneet journal-vaiheet saman
workspace-kohtaisen transactionin kautta.

Legacy-restore-palvelun active-profile- ja empty-profile-päätöksiä ei käytetä
korvauksen oikeutuksena. W3b todistaa registryltä, että kohde on aktiivinen
`ready`-workspace, backupin autentikoitu `profileId` täsmää täsmälleen sen
lineageen ja sama lineage esiintyy registryssä vain kerran. Yrityksen nimi,
Y-tunnus, label tai muu business-arvo eivät oikeuta korvausta. Ehto
tarkistetaan ennen kirjoituksia ja uudelleen `replace`-leasen sisällä.

PreRestore-piste on workspace-scoped. Staging ja forward-migraatiot käyttävät
W3:n nykyistä backup-container- ja private candidate -rajaa. Aktivointi
korvaa tietokannan ja auktoritatiivisen invoice-artifact-juuren kokonaan; se
ei yhdistä tauluja, rivejä tai tiedostoja. Registry ja muiden workspacejen
rootit eivät kuulu activation transactioniin.

Device-local SMTP-secret, safeStorage-envelope, ulkoinen PDF-arkisto ja sen
retry-journal, installation update/cache -tila, operational-lokit,
diagnostiikka sekä muiden workspacejen recovery pointit säilyvät eikä niitä
lueta backupista. Korvauksen hyväksyntä vaatii saman workspacen uuden
runtime-sessionin health-, identity-, migration- ja artifact-todisteen.
Validation failure palauttaa vanhan tietokannan ja PDF-rootin byte-
identtisesti nykyisen activation transactionin kautta ennen runtimen
uudelleenkäynnistystä.

Unit-, fault- ja recovery-testit katkaisevat aktivoinnin jokaisen durable-
vaiheen. System-E2E autentikoi todellisen salatun backupin, korvaa saman
lineagen aktiivisen synteettisen workspacen, todistaa ettei uudempaa dataa
mergetä, tarkistaa PDF-hashin ja device-local-rajojen muuttumattomuuden sekä
ajaa yhteensopivan historiallisen migraatioprefixin eteenpäin. Väärä salasana
ja muutettu container torjutaan ennen quiescea ja kirjoituksia. Production-
runtimea, oikeaa AppData-profiilia tai käyttäjän business-dataa ei käytetä.

W5B.2 ei muuta W3b:n restore-moottoria tai identiteettisääntöä. Renderer
käynnistää vain nimetyn nolla-argumenttisen toiminnon. Electron main johtaa
kohteen omasta aktiivisesta `ready`-workspacestaan, omistaa backupin native-
tiedostovalinnan ja salasanan sekä näyttää viimeisen native-vahvistuksen.
Kohteen label, yrityksen nimi ja Y-tunnus ovat vain käyttäjälle näkyvää
kontekstia; exact lineage todistetaan nykyisessä yksityisessä backend-/backup-
rajassa ennen kirjoituksia.

PreRestore-palautuspiste luodaan ennen aktiivisen snapshot-brokerin ja runtimen
sulkemista. Tiedoston valinnan, salasanan tai vahvistuksen peruminen ei saa
varata korvausoperaatiota tai muuttaa registryä, journalia, aktiivista
osoitinta tai runtimea. Onnistunut korvaus ja onnistunut rollback johtavat
main-owned hallittuun uudelleenkäynnistykseen.

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

### Siirrettävän varmuuskopion tiedostonimi

Luo varmuuskopio ehdottaa mainin tallennusikkunassa nimeä
`Eky-varmuuskopio-<yritysvalitsimen nimi>-YYYY-MM-DD.ekybackup`.
Päivämäärä käyttää nykyiseen tapaan paikallista kalenteripäivää.
Yritysvalitsimen nimi näkyy tiedostonimestä, vaikka sisältö on salattu.
Käyttäjä saa vaihtaa tiedostonimen ja tallennuskohteen native-ikkunassa.
Puuttuva tai muunnoksessa tyhjäksi jäävä nimi käyttää vanhaa päivämääränimeä.
Nimi ei ole yritysidentiteetti tai palautuksen alkuperäketjun todiste.

Main lukee tuoreen validoidun `workspaceLabel`-arvon saman aktiivisen
runtimen rekisteristä omistajan sivuvaikutuksettomalla `inspect`-luvulla
backup-maintenance-leasen sisällä ennen dialogia. Haku ei korjaa rekisterislotteja.
Vaihtunut aktiivinen tunniste tai epäonnistunut luku keskeyttää valinnan
turvallisesti. Nimenmuutos ja vaihto eivät pääse rinnalle samalla leasella.
Rendereriltä ei hyväksytä nimeä tai polkua; virheeseen ei liitetä yritystietoa.

Tiedostonimen ehdotus normalisoidaan NFC:ksi, Windowsin kielletyt
tiedostonimimerkit, polkuerottimet sekä control-/bidi-ohjaimet korvataan
viivalla ja ylimääräinen tyhjätila yhdistetään. Nimen osa katkaistaan
enintään 120 UTF-8-tavuun katkaisematta koodipistettä; loppupisteet ja
-välilyönnit poistetaan. Kiinteä `Eky-varmuuskopio-`-alku estää Windowsin
varatut laitenimet koko basenimessä. Koko ehdotus on enintään 158 tavua.
Tämä on käyttöliittymäehdotuksen raja, ei backupin sisältö-/kokoraja tai
käyttäjän itse valitseman polun uusi hyväksymisraja.

Samana päivänä samalla nimellä tehty kopio voi ehdottaa samaa tiedostonimeä.
Nykyinen no-overwrite-tarkistus estää aiemman kopion korvaamisen; valitse
toinen tiedostonimi. Muunnos ei tee nimistä yksilöllisiä eikä luo automaattista
kopio- tai uudelleennimeämisketjua. Kontti, self-inspection, lineage-tarkistus
ja vanhojen kopioiden yhteensopivuus eivät riipu tiedostonimestä.
Nimeä tai kokonaista polkua ei lisätä statusstoreen, lokeihin tai tukipakettiin.

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

Sisäinen virhemuunnos säilyttää alkuperäisen poikkeuksen `Error.cause`-
sidonnassa. Aktivoinnin ja rollbackin yhteisvirheessä ensisyy ja lisävirhe
ovat erillisiä, järjestettyjä haaroja. Sidonta ei muuta ulompaa virhekoodia
eikä anna lupaa serialisoida raakaa poikkeusta. Julkiseen projektioon
välitetään vain omistavan tapahtumasopimuksen sallima tieto. Nykyisen
[rajatun syyketjun näyttö](release-0.3.0-m1-preparation-plan.md#v2l-backup--ja-palautuskuluttajien-sisäinen-ensisyy)
ei korvaa tarkistusprosessin poistumisen todistusta tai paketoitua palautusta.

Tarkistusruntime luokittelee myös laskuhistorian katalogissa syntyvän
täsmällisen natiivin muistivirheen ennen sulkuvirheiden yhdistämistä.
Se käyttää nykyistä turvallista resurssisyytä eikä julkaise natiivipoikkeusta.
[Katalogin syyketjun kohdenäyttö](release-0.3.0-m1-preparation-plan.md#katalogin-muistivirheen-syyketju)
ei muuta backup-formaatteja, sisältörajoja tai muun brokerin virheprojektiota.

[C:n business rollback -kutsujan sisäinen syysidonta](release-0.3.0-m1-preparation-plan.md#v2ay-cn-palautuskutsujan-sisäinen-ensisyy)
noudattaa samaa järjestystä: aktivoinnin tai tarkistuksen ensivirhe ennen
recovery-journalin lisävirhettä. Journalin kirjoitusvirhe ei saa peittää
ensisyyttä tai todistaa kirjoitusta onnistuneeksi. Update-tapahtuman
nykyinen turvallinen yleiskoodi säilyy; sisäinen syyketju ei laajenna julkisen
diagnostiikan tietosisältöä eikä anna offline-palautusvaltuutta.

[Portable-backupin rajattu tapahtumaketju](release-0.3.0-m1-preparation-plan.md#v2m-portable-backupin-turvallinen-lukuketju)
välittää luonnin ja tarkistuksen hyväksytyn teknisen ensisyyn nykyiseen
operational-tapahtumaan ennen yleistä IPC-muunnosta. Tuntematon ketju
säilyttää yleiskoodin eikä siivousvirhe peitä ensivirhettä. Raakaa `cause`-
oliota ei kirjoiteta lokiin tai tukipakettiin.
[Palautuskuluttajien erillinen kohdenäyttö](release-0.3.0-m1-preparation-plan.md#v2n-palautuskuluttajien-turvallinen-ensisyy)
kattaa tarkistuksen, stagingin, aktivoinnin, käynnistysvalidoinnin sekä
palautuspisteiden luonnin ja automaattisen tarkistuksen samalla
ensisyyhaulla. Rollbackin lisävirhe ja selvitystila pysyvät erillisinä.
[Lukijoiden erillinen tapahtumapariteetti](release-0.3.0-m1-preparation-plan.md#v2o-palautustapahtumien-lukijoiden-sopimustarkistus)
on V2o-vaiheen historiallista kohdenäyttöä API-clientin ja tukipaketin
rajoilta tapahtumakatalogin mukaan. Tuossa vaiheessa avoinna olleet
Electron-main, tarkistusprosessin omistajuus ja paketoitu palautus sisältyvät
myöhempään [K:n hyväksyntään](release-0.3.0-m1-preparation-plan.md#jatka-tästä).
Uusi muutos tarvitsee edelleen oman vaikutusalueensa palautusnäytön.

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
- hyväksytyn 38 migraation metadataa vailla olevan legacy-backupin staging,
  aktivointi ja metadata-ankkurointi sekä muiden metadataa vailla olevien
  historioiden fail-closed-torjunta
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
- W3 plaintext-karanteenin partial/complete crash-jäämä ilman journalia,
  v1-journal tai todistamaton vanha kirjoittaja: automaattinen recovery
  estyy ja aineisto säilyy; puuttuvaa omistajuutta ei arvata
- todistetusti oman v2-import-operaation useat sallitut jäämät:
  admission/build-, lease-, runtime-poissaolo- ja varauksen palautumisporttien
  jälkeen idempotentti cleanup ja tyhjyys ennen recovery-tulosta
- W3-karanteenin unknown entry, directory masquerade, symlink/reparse point,
  hardlink, ylikokoinen payload ja root-containment-ristiriita fail closed
  ilman ulkopuolisen tiedoston tai lähdebackupin muuttamista
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
- `docs/architecture/local-company-workspace-plan.md`
- `docs/architecture/local-restore-recovery-runbook.md`
- `docs/architecture/r0-e2e-test-matrix.md`
- `docs/architecture/security-principles.md`
- `docs/architecture/support-bundle-plan.md`
- `docs/decisions/ADR-0006-local-database-and-query-layer.md`
- `docs/decisions/ADR-0007-local-desktop-shell-and-session-bootstrap.md`
- `docs/decisions/ADR-0008-local-desktop-company-workspaces.md`
- `docs/decisions/ADR-0009-local-backup-encryption-and-recovery-points.md`
- `docs/decisions/ADR-0010-windows-installer-and-update-orchestration.md`
- `docs/decisions/ADR-0011-local-multi-workspace-company-model.md`
