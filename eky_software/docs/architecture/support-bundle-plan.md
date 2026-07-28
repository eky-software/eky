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
- `supportBundleFormatVersion = 1`
- toteutus Node.js:n `zlib`- ja stream-API:lla ilman uutta riippuvuutta
- enimmäiskoko ennen pakkausta 25 MiB
- katkaistut osiot ilmoitetaan manifestin `truncatedSections`-kentässä

## Sallittu sisältö

- manifest ja creation correlation ID
- app- ja backend-versiot, build revision, build-aika ja dirty-tila
- platform ja architecture ilman käyttäjänimeä
- tietokannan health- ja migration-yhteenveto ilman polkua
- operational log -yhteenveto
- viimeisen 30 päivän sanitoidut warn/error-eventit
- saman aikavälin security-eventit
- incident index -yhteenvedot
- SHA-256-checksum jokaiselle dataosiolle

## Kielletty sisältö

- SQLite-tietokanta, PDF:t tai laskurivit
- invoice/customer rows tai koko business activity feed
- nimi, osoite, puhelin, sähköposti, IBAN tai henkilötunnus
- SMTP-salaisuus, runtime-session, token, cookie tai authorization-header
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
