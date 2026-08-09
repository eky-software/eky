# Tukipakettisuunnitelma

Eky-tukipaketti on käyttäjän vahvistuksella muodostettava, sanitoitu
diagnostiikka-artifacti. Se ei ole varmuuskopio eikä sisällä business dataa.

## Toteutettu R0-raja

R0-toteutus kulkee seuraavasti:

```text
Diagnostics UI
  -> rajattu preload createSupportBundle(), ei argumentteja
  -> Electron mainin vahvistus ja Save-dialogi
  -> mainin runtime-sessionilla tekemä sisäinen backend-haku
  -> tarkka response-validointi
  -> gzip JSON + SHA-256 section checksumit
  -> yksityinen väliaikaistiedosto ja lopullinen .json.gz-tiedosto
```

Backendin `GET /diagnostics/support-bundle-data` on
`createSupportBundle`-permissionilla suojattu tekninen read model. Reitti ei
ole API-clientin julkinen endpoint eikä Electron-rendererin yleisen
`eky://app`-transportin allowlistissa. Renderer ei voi antaa reitille polkua,
querya, `companyId`:tä tai runtime-sessionia.

## Formaatti

- uusien pakettien tiedostopääte `.json.gz`
- vanha `.ekysupport`-pääte säilyy tarkastimen legacy-yhteensopivuutena
- gzip-pakattu UTF-8 JSON
- `supportBundleFormatVersion = 2`
- toteutus Node.js:n `zlib`- ja stream-API:lla ilman uutta riippuvuutta
- formaattia ei vaihdeta ZIPiksi eikä Windowsin ulkoista pakkausprosessia
  kutsuta
- enimmäiskoko ennen pakkausta 25 MiB
- vähintään 5 MiB varataan manifestille, runtime- ja database-yhteenvedoille
  sekä muille ydinosioille
- diagnostiikkatapahtumien osabudjetti on 16 MiB
- incident-yhteenvetojen osabudjetti on 4 MiB
- katkaistut osiot ilmoitetaan manifestin `truncatedSections`-kentässä

Version 2 erottaa sanitoidut diagnostiikkatapahtumat ja minimoidut
incident-index-yhteenvedot omiksi checksum-osioikseen. Osioiden SHA-256-
checksumit havaitsevat tahattoman sisältömuutoksen, mutta ne eivät ole
digitaalinen allekirjoitus eivätkä todista artifactin alkuperää.

## Sallittu sisältö

- manifest ja creation correlation ID
- app- ja backend-versiot, build revision, build-aika ja dirty-tila
- platform ja architecture ilman käyttäjänimeä
- tietokannan health- ja migration-yhteenveto ilman polkua
- operational log -yhteenveto
- viimeisen 30 päivän sanitoidut warn/error-eventit
- saman aikavälin security-eventit
- incident indexistä luetut ryhmitellyt yhteenvedot ilman raw-rivejä
- SMTP:n warning/error-tason transport-virheistä vain SMTP-profiili,
  TLS-versio, allowlistattu cipher ja sertifikaatin SHA-256-sormenjälki,
  jos turvallinen transport-yhteenveto on saatavilla
- `invoicePdfArchive.queueFailed` vain tapahtuman allowlistatulla
  virhekoodilla, vaiheella, outcome-arvolla, retryable- ja
  side-effect-tilalla; ei lasku-, dokumentti-, toimitus-, yritys- tai
  polkutunnisteita
- SHA-256-checksum jokaiselle dataosiolle

Tukipakettia varten on oma reader, joka lukee vain warning/error- ja
security-virtoja. Info-lokit eivät kuluta sen tiedosto- tai tavubudjettia.
SMTP:n onnistuneet info-tason transport-eventit eivät kuulu tukipakettiin,
vaikka info-event olisi virheellisesti päätynyt warning/error-tiedostoon.
Reader rajaa lähteet täsmällisesti viimeiseen 30 päivään ja käsittelee
segmentit uusimmasta vanhimpaan.

`sourceTruncated` välittyy manifestin `truncatedSections`-tiedoksi. Katkaisu
ilmoitetaan, jos tapahtuma-, tavu-, tiedosto- tai pakettibudjetti täyttyy,
relevantti lähde on rikkoutunut tai osittain luettu tai reader ei muuten voi
todistaa koko 30 päivän aikavälin kattavuutta.

Osabudjeteissa ja lopullisessa kokonaisbudjetissa säilytetään aina
uusimmasta vanhimpaan järjestetty suurin mahtuva prefiksi. Jos lopullinen
25 MiB:n raja ylittyy ydinosioiden jälkeen, diagnostiikkatapahtumia
katkaistaan ensin. Incident-yhteenvetoja katkaistaan vasta, kun
diagnostiikkatapahtumat on tyhjennetty eikä paketti vieläkään mahdu.
Manifestin truncation-tiedot ja osioiden checksumit lasketaan aina
lopullisesta sisällöstä. Jos ydinosiot eivät yksin mahdu kokonaisbudjettiin,
paketin muodostus epäonnistuu turvallisesti.

Incident-index-reader lukee kiinteästä `incident-index`-hakemistosta vain
nykyisen ja tarvittaessa edellisen vuoden tunnetut tiedostot. Pakettiin
palautetaan vain ryhmitelty `eventName`, `errorCode`, `outcome`, versio-,
build-, fingerprint-, count- ja aikaväliyhteenveto.

## Kielletty sisältö

- SQLite-tietokanta, PDF:t tai laskurivit
- invoice/customer rows tai koko business activity feed
- nimi, osoite, puhelin, sähköposti, IBAN tai henkilötunnus
- SMTP-salaisuus, runtime-session, token, cookie tai authorization-header
- SMTP:n remote IP, target port, attempt/operation ID tai sertifikaatin
  raakadata
- sähköpostirunko, MIME tai provider response
- ympäristömuuttujat, Windows-käyttäjänimi ja userData-polku
- PDF-arkiston kohdepolku, laskunumero, invoice/document/delivery event id,
  PDF-tiiviste tai arkistointibrokerin raw error
- `.ekybackup`-payload tai sen salattu sisältö
- backupin salt, nonce, authentication tag, salasana tai johdettu avain
- konekohtainen palautuspiste tai sen suojattu avainmateriaali
- restore-staging-profiili, backup/restore-journal tai raaka polku
- päivityspaketti, installer command tai update-journal
- raw stack tai raw JSONL-rivi

Recovery point- ja restore-eventeistä tukipakettiin saa tulla vain
Diagnostics-readerin uudelleenvalidoima nykyinen sanitoitu projektio:
event-nimi, app/build/runtime-konteksti, satunnainen `correlationId`,
allowlistattu stage, kesto, turvallinen error code, retryable- ja
side-effect-tila. Recovery point -kind voidaan säilyttää vain, jos se on
katalogin allowlistalla. Incident-yhteenveto ei sisällä correlation-,
operation- tai entity-tunnisteita. Raakaa journalia, manifestia, polkua,
salaisuuksia tai business-tunnisteita ei sisällytetä.

## Desktop-flow

1. Käyttäjä valitsee `Luo tukipaketti`.
2. UI näyttää tietosuoja- ja sisältöyhteenvedon.
3. Käyttäjä vahvistaa.
4. Electron main näyttää Save-dialogin.
5. Renderer ei anna tallennuspolkua backendille.
6. Paketti kirjoitetaan ensin runtimen väliaikaiseen tiedostoon.
7. Osioiden checksumit lasketaan.
8. Valmis tiedosto nimetään atomisesti käyttäjän valitsemaan kohteeseen.
9. Temp poistetaan virheessä.
10. Tulos lokitetaan ilman kohdepolkua.

Browser developmentissa voidaan näyttää diagnostics summary, mutta
tukipakettivienti ei ole käytettävissä.

Runtimeen jäänyt väliaikainen paketti poistetaan 30 päivän jälkeen.
Käyttäjän ulkoiseen kohteeseen tallennettua pakettia sovellus ei poista.

## Turvallisuus

Tukipaketin muodostus vaatii backend-permissionin ja desktop-capabilityn.
Jokainen event validoidaan ja redaktoidaan uudelleen ennen sisällytystä.
Paketti ei saa kasvattaa logs-rootin tai käyttäjän valitseman kohteen
oikeuksia eikä seurata symlinkkejä.

`.json.gz` ei ole salattu säiliö. Sisältö on minimoitu ja sanitoitu, mutta
käyttäjä jakaa tiedoston vain harkitusti sovitulle tukitaholle ja poistaa
ulkoisen kopion, kun käyttötarkoitus päättyy. Eky poistaa vain oman runtimensa
yli 30 päivää vanhat väliaikaiset tukipakettitiedostot.

Tukipaketti ei ole Eky-varmuuskopio eikä sitä voi käyttää liiketoimintadatan,
SQLite-tietokannan, laskujen tai asetusten palauttamiseen. `.ekybackup`
kuuluu ADR-0009:n toteutettuun, aina salattuun backup/restore-polkuun; sitä ei
saa sekoittaa salaamattomaan `.json.gz`-diagnostiikka-artifactiin. Vanha
`.ekysupport` tarkoittaa samaa legacy-
tukipakettiformaattia, ei varmuuskopiota.

Backup/Restore-polun suunnitteluperusta on dokumentissa
`docs/architecture/local-backup-and-restore-plan.md`.

## Paketoitu smoke

Windowsin packaged smoke kutsuu rendererille julkaistua rajattua
`createSupportBundle()`-toimintoa, käyttää smoke-tilan kiinteää
väliaikaiskohdetta ja purkaa syntyneen paketin. Se validoi formaattiversion,
osiokohtaiset checksumit, runtime- ja build-identiteetin, tietokannan
yhteenvedon, diagnostiikkatapahtumat, todelliset incident-yhteenvedot sekä
katkaisutiedot. Smoke tarkistaa myös kiellettyjen salaisuuksien,
henkilötietojen, business-datan, polkujen ja PDF-datan poissulut ja poistaa
artifactin lopuksi.

## Paikallinen tarkastin

Kehittäjä tai tukihenkilö voi validoida käyttäjän toimittaman tukipaketin
ilman lisäriippuvuutta:

```text
pnpm support:inspect -- "C:\polku\eky-support-2026-07-28.json.gz"
```

`support:inspect` on tukipaketin virallinen tarkistusmenetelmä. Se hyväksyy
sekä uuden `.json.gz`-päätteen että legacy-`.ekysupport`-päätteen, mutta ei
päättele paketin luotettavuutta tiedostopäätteestä. Komento tarkistaa regular
file/no symlink -rajan, pakatun ja puretun
25 MiB:n kokorajan, gzipin, formaattiversion, tarkat osiot sekä osioiden
SHA-256-checksumit. Oletustuloste sisältää vain formaatin, luontiajan,
versio- ja build-tiedot, tietokantayhteenvedon, tapahtumamäärät,
katkaistut osiot ja checksum-tilan. Se ei tulosta yksittäisiä tapahtumia.

7-Zip voi purkaa `.json.gz`-tiedoston suoraan JSON-tiedostoksi manuaalista
tarkastelua varten. Purettu JSON ei ole salattu. Sisällön tekninen validointi
tehdään silti `support:inspect`-komennolla.

Valinnainen `--write-json "<kohde.json>"` kirjoittaa puretun, salaamattoman
JSONin ensin saman hakemiston väliaikaistiedostoon ja nimeää sen lopuksi.
Olemassa olevaa kohdetta ei korvata ilman `--force`-valintaa. Käyttäjä vastaa
puretun kopion hallitusta säilytyksestä ja poistamisesta.

Tarkastin on kehittäjätyökalu. Packaged smoke säilyttää oman tuotantoartifactin
luottamusrajaa testaavan validatorinsa eikä tuotantoruntime riipu
tarkastinskriptistä.
