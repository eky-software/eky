# Eky Local Backup/Restore -suunnitelma

## Tila

Arkkitehtuuripäätös on hyväksytty ADR-0009:ssä. Backup-, restore- ja
palautuspistetuotantokoodia ei ole vielä toteutettu.

Dokumentoitu ja automaattisesti testattu palautuspolku on yhden hallitun
oikeaa dataa käyttävän R0-asennuksen release gate. Toteutus tehdään
rajattuina vaiheina ennen oikean asiakas- tai laskutusdatan käyttöönottoa.

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
- pilvisalaisuuksia tai tulevan cloud identityn tokeneita

Salaisuudet otetaan palautuksen jälkeen käyttöön erillisellä turvallisella
secret lifecycle -polulla. Backup ei saa siirtää SMTP-salasanaa toiselle
koneelle tai Windows-käyttäjälle.

## Container ja salaus

Siirrettävän backupin salaamaton otsake saa sisältää vain formaatin
turvalliseen tunnistamiseen ja purkuun tarvittavat kentät:

- magic bytes
- container format version
- encryption algorithm identifier
- KDF identifier ja parametriversio
- rajatut KDF-parametrit
- salt
- nonce
- authentication tag
- salatun payloadin rajattu pituus

Otsake ei sisällä henkilötietoa, yritystunnistetta, polkua, backupin
kuvausta tai vapaamuotoista metadataa. Koko versionoitu otsake sidotaan
AES-256-GCM-salaukseen AAD-tietona.

Salaus käyttää:

- AES-256-GCM:ää
- käyttäjän salasanasta `scrypt`-funktiolla johdettua 256-bittistä avainta
- kryptografisesti satunnaista salt-arvoa
- jokaiselle salaukselle uniikkia nonce-arvoa
- täyttä authentication tag -arvoa

Tarkat `scrypt`-parametrit valitaan ja versionoidaan vasta benchmarkin jälkeen.
Reader hyväksyy vain tunnetun parametriversion ja ennalta rajatut
resurssiarvot. Tällä estetään sekä liian heikko avaimenjohto että
haitallisesti ylimitoitettu KDF.

Käyttäjälle ei tarjota salaamatonta fallbackia. Salaus- tai
satunnaislukugeneraattorin virhe keskeyttää backupin.

## Salasanan lifecycle

- salasana kysytään native/main-prosessin hallitsemassa vahvistetussa
  toimintopolussa
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

Ennen valintaa pitää varmistaa käytetyn `better-sqlite3`-version API,
keskeytyssemantiikka, WAL-käyttäytyminen, progress/cancellation ja Windows-
paketointi testeillä. Jos tätä ei voida todistaa, fallback on backendin ja
SQLite-yhteyden hallittu sulkeminen snapshotin ajaksi.

Dokumentti ei väitä kumpaakaan mallia toteutetuksi tai lopullisesti valituksi
ennen kokeellista varmennusta.

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
8. sisältö salataan yksityiseen väliaikaistiedostoon
9. tiedosto synkronoidaan ja finalisoidaan ilman hiljaista ylikirjoitusta
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

Ajastus ja rotaatio noudattavat ADR-0009:ää. Tarkat päivittäisten,
viikoittaisten ja kuukausittaisten pisteiden määrät sekä levybudjetti
määritetään toteutusvaiheessa.

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

Restore ei:

- kirjoita aktiiviseen profiiliin
- seuraa archive-entryn polkua ulos staging-juuresta
- hyväksy rendererin antamaa `companyId`:tä tai profiilipolkua
- käynnistä backupista sessionia tai salaisuutta
- yhdistä kahta profiilia
- tee best effort -osapalautusta

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

Epäonnistumisessa uusi runtime suljetaan ja pre-restore-piste palautetaan.
Rollback hyväksytään vasta, kun vanha profiili käynnistyy terveenä.

Aktivointijournalissa ei ole yritysdataa, salaisuutta tai rendererille
palautettavaa polkua. Vaiheen pitää olla idempotentti restartin jälkeen.

## Cross-company-raja

R0:ssa:

- samaan asennukseen palautetaan vain sen nykyisen profiilin backup
- toisesta asennuksesta tuotu backup voidaan palauttaa vain tyhjään
  asennukseen
- eri yrityksen profiilin päälle ei palauteta eikä tietoja yhdistetä

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

Renderer ei saa:

- tiedostopolkua
- backupin selväkielistä manifestia
- salasanaa tai avainta
- palautuspisteen tiedostonimeä
- raw inspector-, SQLite- tai filesystem-virhettä

## Observability ja audit

Tulevat tekniset tapahtumaperheet ovat:

- `backup.*`
- `restore.*`
- `recoveryPoint.*`

Tarkkoja event-nimiä ei lukita ennen use case- ja transaction ownership
-toteutusta. Tapahtumissa ei ole:

- backupin payloadia tai salattua sisältöä
- salasanaa, salt-arvoa, nonce-arvoa, tagia tai johdettua avainta
- yrityksen nimeä tai asiakasdataa
- raakaa polkua
- manifestia
- SQLite- tai filesystem-virhettä

Backupin ja restoren käyttäjän aloittama, business-datan saatavuuteen
vaikuttava operaatio tarvitsee turvallisen audit- tai activity-päätöksen.
Tekniset vaihe- ja failure-tiedot kuuluvat Diagnosticsiin.

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
- `docs/architecture/local-desktop-implementation-plan.md`
- `docs/architecture/local-invoice-pdf-archive-plan.md`
- `docs/architecture/r0-e2e-test-matrix.md`
- `docs/architecture/security-principles.md`
- `docs/architecture/support-bundle-plan.md`
- `docs/decisions/ADR-0006-local-database-and-query-layer.md`
- `docs/decisions/ADR-0007-local-desktop-shell-and-session-bootstrap.md`
- `docs/decisions/ADR-0008-local-desktop-company-workspaces.md`
- `docs/decisions/ADR-0009-local-backup-encryption-and-recovery-points.md`
- `docs/decisions/ADR-0010-windows-installer-and-update-orchestration.md`
