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
  -> yksityinen väliaikaistiedosto ja lopullinen .ekysupport-tiedosto
```

Backendin `GET /diagnostics/support-bundle-data` on
`createSupportBundle`-permissionilla suojattu tekninen read model. Reitti ei
ole API-clientin julkinen endpoint eikä Electron-rendererin yleisen
`eky://app`-transportin allowlistissa. Renderer ei voi antaa reitille polkua,
querya, `companyId`:tä tai runtime-sessionia.

## Formaatti

- tiedostopääte `.ekysupport`
- gzip-pakattu UTF-8 JSON
- `supportBundleFormatVersion = 2`
- toteutus Node.js:n `zlib`- ja stream-API:lla ilman uutta riippuvuutta
- enimmäiskoko ennen pakkausta 25 MiB
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
- SMTP:n onnistuneista transport-eventeistä vain SMTP-profiili, TLS-versio,
  allowlistattu cipher ja sertifikaatin SHA-256-sormenjälki, jos tapahtuma
  kuuluu mukaan rajattuun tapahtuma-aineistoon
- SHA-256-checksum jokaiselle dataosiolle

Tukipakettia varten on oma reader, joka lukee vain warning/error- ja
security-virtoja. Info-lokit eivät kuluta sen tiedosto- tai tavubudjettia.
Reader rajaa lähteet täsmällisesti viimeiseen 30 päivään ja käsittelee
segmentit uusimmasta vanhimpaan.

`sourceTruncated` välittyy manifestin `truncatedSections`-tiedoksi. Katkaisu
ilmoitetaan, jos tapahtuma-, tavu-, tiedosto- tai pakettibudjetti täyttyy,
relevantti lähde on rikkoutunut tai osittain luettu tai reader ei muuten voi
todistaa koko 30 päivän aikavälin kattavuutta.

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
- raw stack tai raw JSONL-rivi

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

`.ekysupport` ei ole salattu säiliö. Sisältö on minimoitu ja sanitoitu, mutta
käyttäjä jakaa tiedoston vain harkitusti sovitulle tukitaholle ja poistaa
ulkoisen kopion, kun käyttötarkoitus päättyy. Eky poistaa vain oman runtimensa
yli 30 päivää vanhat väliaikaiset tukipakettitiedostot.

Tukipaketti ei ole Eky-varmuuskopio eikä sitä voi käyttää liiketoimintadatan,
SQLite-tietokannan, laskujen tai asetusten palauttamiseen. `.ekybackup` kuuluu
myöhemmin erikseen toteutettavaan backup/restore-polkuun; sitä ei saa sekoittaa
`.ekysupport`-diagnostiikka-artifactiin.

## Paketoitu smoke

Windowsin packaged smoke kutsuu rendererille julkaistua rajattua
`createSupportBundle()`-toimintoa, käyttää smoke-tilan kiinteää
väliaikaiskohdetta ja purkaa syntyneen paketin. Se validoi formaattiversion,
osiokohtaiset checksumit, runtime- ja build-identiteetin, tietokannan
yhteenvedon, diagnostiikkatapahtumat, todelliset incident-yhteenvedot sekä
katkaisutiedot. Smoke tarkistaa myös kiellettyjen salaisuuksien,
henkilötietojen, business-datan, polkujen ja PDF-datan poissulut ja poistaa
artifactin lopuksi.
