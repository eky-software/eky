# Local Desktop Dependency Review

Tämä dokumentti kirjaa `apps/desktop`-paketointispiken ensimmäisen rajatun
riippuvuuspäätöksen 14.7.2026 sekä Electron 43 / better-sqlite3 13
-yhteensopivuuden varmennuksen 3.8.2026. Versiot tarkistetaan uudelleen ennen
tuotantojulkaisua, allekirjoitusta tai automaattipäivityksen toteutusta.

## Rajaus

Ensimmäisessä spikessä tarvitaan vain:

- Electron-runtimen Windows x64 -binääri
- sovellushakemiston paketointi Electron-artifactiksi
- `better-sqlite3`-native addonin paketoidun Windows x64 N-API-runtimen
  varmennus
- production-fusejen lukitseminen

Installeria, makeria, julkaisua, automaattipäivitystä, code signingia tai
salaisuuksien käsittelyä ei lisätä tässä vaiheessa.

## Valitut Riippuvuudet

Spikessä käytetään tarkasti lukittuja development-riippuvuuksia vain
`apps/desktop`-paketissa:

| Paketti | Versio | Vastuu |
| --- | --- | --- |
| `electron` | `43.2.0` | desktop-runtime ja Windows-binääri |
| `@electron/packager` | `20.0.4` | rajattu paketoitu sovellushakemisto |
| `@electron/fuses` | `2.1.3` | production-fusejen lukitseminen |

Paketit eivät kuulu domainiin, application serviceihin, API-clientiin,
web-featureihin tai backendin liiketoimintamoduuleihin.

Electronin asennusskripti lataa version mukaisen binäärin. Siksi
`pnpm-workspace.yaml` sallii build/install-skriptin eksplisiittisesti vain
nimetylle `electron`-paketille. `better-sqlite3`-asennusskriptiä ei ajeta:
paketointi käyttää ja validoi version `13.0.2` mukana toimitetun Windows x64
N-API-binäärin.

### Electron 43 Ja `better-sqlite3`

Ensimmäinen spike käytti Electron `42.6.1`- ja `better-sqlite3 12.11.1`
-versioita. Tämä historiallinen yhdistelmä tarvitsi Electronin ABI:lle
rakennetun staged-binäärin.

Nykyinen varmennettu yhdistelmä on Electron `43.2.0` ja `better-sqlite3
13.0.2`. better-sqlite3 13 käyttää paketin mukana toimitettua N-API-binääriä,
joten paketointi ei enää:

- skannaa pnpm-virtuaalivarastoa native-paketin löytämiseksi
- aja `prebuild-install`-työkalua
- rakenna staged-kopiota Electronin ABI:lle.

Paketointiputki ratkaisee moduulin paketinhallinnan normaalilla
resoluutiolla, kopioi tuotantoriippuvuudet hallitusti ja validoi paketoidun
Windows x64 N-API-binäärin ennen artifactin hyväksymistä. Yhdistelmä on
varmennettu Electron-runtimessa, oikean paikallisen SQLite-tietokannan
turvallisella kopiolla, Windows-paketoinnilla, smoke- ja Electron-E2E-testeillä
sekä stressi- ja soak-ajoilla.

Ennen isälle jaettavaa tuotantoversiota pitää edelleen ajaa Windows package-
ja smoke-testit sekä riippuvuus- ja turvallisuusaudit aina valituille tarkasti
lukituille runtimeversioille.

Eky ei ylläpidä omaa `better-sqlite3`-C++-forkkia yhteensopivuusrajojen
kiertämiseksi.

## Miksi Ei Electron Forgea Tässä Spikessä

Electronin dokumentaatio suosittelee Forgea yleiseksi paketointi- ja
jakelutyökaluksi. Forge kokoaa paketoinnin lisäksi maker-, installer-, julkaisu-
ja muita jakeluvastuita. Tässä spikessä tarkoitus on ensin todentaa mahdollisimman
pienellä riippuvuuspinnalla:

- paketoitu React/Vite-renderer
- hallittu backend-prosessi
- SQLite ja migraatiot
- `better-sqlite3` Electronin N-API-runtimessa
- PDFKit
- turvallinen Electron-konfiguraatio ja fuses

Suora Packager/Fuses-yhdistelmä pitää tämän todentamisen rajattuna.
`better-sqlite3 13.0.2`:n mukana toimitettava Windows x64 N-API-binääri
kopioidaan production-riippuvuuksien mukana ja validoidaan ennen paketointia.
Erillistä native-rebuild- tai prebuild-install-riippuvuutta ei tarvita.
Forge tai muu installer-/update-työkalu arvioidaan uudelleen vasta, kun
paketoitu runtime on toimiva ja julkaisutapa, code signing sekä päivityskanava
on päätetty.

## Turvallisuus- Ja Toimitusketjurajat

- Versioissa ei käytetä `latest`- tai caret-alueita.
- Lockfile commitoidaan muutoksen mukana.
- Electron pidetään ajan tasalla ennen jokaista tuotantojulkaisua.
- Paketoitava backend rajataan `files`-allowlistalla build-tuotokseen.
- Kehityksen SQLite-tiedostot, `.env`-tiedostot, sample-PDF:t, testit ja
  storage-hakemistot eivät saa päätyä artifactiin.
- `better-sqlite3`-paketin mukana toimitettu N-API-binääri validoidaan sekä
  tavallisessa Node-kehitysajossa että paketoidussa Electron-runtimessa.
- Paketoidun artifactin sisältö tarkastetaan smoke-testissä ennen hyväksyntää.
- Production-fuset lukitaan vasta paketoituun binääriin.
- Artifact ei ole loppukäyttäjälle jaettava tuotantoversio ennen code signingia,
  installer-päätöstä ja release-putken tarkistuksia.

## Lisenssit Ja Ylläpito

- `electron`: MIT
- `@electron/fuses`: MIT
- `@electron/packager`: BSD-2-Clause

Electron sisältää Chromiumin ja Node.js:n turvallisuuspäivitysvastuun. Ekyllä
pitää myöhemmin olla dokumentoitu päivitysrytmi, tuettu versiopolitiikka ja
allekirjoitettu päivityskanava. Tätä velkaa ei ratkaista ensimmäisessä
paketointispikessä.

## Hyväksytty Päätös

Valitut kolme riippuvuutta hyväksytään vain local desktop -paketointispikeen.
Uusi desktop-riippuvuus, installer, maker, updater tai salaisuuksiin liittyvä
kirjasto vaatii uuden rajatun dependency- ja security-arvion.

SMTP-salaisuuden local-MVP-tallennukseen ei lisätä uutta keyring- tai native-
riippuvuutta. Toteutus käyttää jo hyväksytyn Electron-runtimen sisäänrakennettua
`safeStorage`-rajapintaa vain main processissa, yksityistä `MessagePort`-brokeria
ja versionoitua salattua `userData`-blobia. Oma Win32-native-adapteri ja
kolmannen osapuolen keyring-kirjasto jätettiin pois, koska ne kasvattaisivat
native-binäärien, Electron ABI:n ja toimitusketjun ylläpitopintaa ilman
local-MVP:ssä tarvittavaa lisähyötyä.

## Liittyvät Dokumentit

- `AGENTS.md`
- `docs/architecture/dependency-policy.md`
- `docs/architecture/local-desktop-implementation-plan.md`
- `docs/architecture/security-principles.md`
- `docs/decisions/ADR-0007-local-desktop-shell-and-session-bootstrap.md`
