# Local Desktop Dependency Review

Tämä dokumentti kirjaa `apps/desktop`-paketointispiken ensimmäisen rajatun
riippuvuuspäätöksen. Arvio on tehty 14.7.2026. Versiot tarkistetaan uudelleen
ennen tuotantojulkaisua, allekirjoitusta tai automaattipäivityksen toteutusta.

## Rajaus

Ensimmäisessä spikessä tarvitaan vain:

- Electron-runtimen Windows x64 -binääri
- sovellushakemiston paketointi Electron-artifactiksi
- `better-sqlite3`-native addonin uudelleenrakennus Electronin ABI:lle
- production-fusejen lukitseminen

Installeria, makeria, julkaisua, automaattipäivitystä, code signingia tai
salaisuuksien käsittelyä ei lisätä tässä vaiheessa.

## Valitut Riippuvuudet

Spikessä käytetään tarkasti lukittuja development-riippuvuuksia vain
`apps/desktop`-paketissa:

| Paketti | Versio | Vastuu |
| --- | --- | --- |
| `electron` | `42.6.1` | desktop-runtime ja Windows-binääri |
| `@electron/packager` | `20.0.2` | rajattu paketoitu sovellushakemisto |
| `@electron/fuses` | `2.1.3` | production-fusejen lukitseminen |

Paketit eivät kuulu domainiin, application serviceihin, API-clientiin,
web-featureihin tai backendin liiketoimintamoduuleihin.

Electronin asennusskripti lataa version mukaisen binäärin. Siksi
`pnpm-workspace.yaml` sallii build/install-skriptin eksplisiittisesti vain
nimetylle `electron`-paketille nykyisen `better-sqlite3`-poikkeuksen rinnalla.

### Electron 42 Ja `better-sqlite3`

Dependency review aloitettiin `better-sqlite3 12.10.0` -versiolla, joka ei
tukenut Electron 42/43:n muuttunutta V8 External API:a. `better-sqlite3
12.11.1` korjaa Electron 42:n Windows-käännön ja on saatavilla virallisesta
npm-rekisteristä. GitHubissa 3.7.2026 julkaistu `better-sqlite3 12.11.2` lisää
Electron 43 -esikäännökset, mutta 14.7.2026 kyseistä versiota ei vielä löydy
npm-rekisteristä. Eky ei ota tuotantopohjaan julkaisemattomia GitHub-tarball-
tai binääriartefakteja.

Spike käyttää siksi Electron `42.6.1`- ja `better-sqlite3 12.11.1`
-versioita. Electron 42:n ilmoitettu EOL on 20.10.2026. Native-ajuri lukitaan
tarkkaan versioon ja rakennetaan vain paketointihakemiston staged-kopiossa
kohde-Electronin ABI:lle. Paketointiputki etsii paketin pnpm-virtuaalivarastosta
paketin nimen perusteella eikä kovakoodatusta versiollisesta hakemistopolusta.

Ennen isälle jaettavaa tuotantoversiota pitää edelleen:

1. tarkistaa, onko Electron 43:a tukeva `better-sqlite3 12.11.2` tai uudempi
   julkaistu npm-rekisteriin
2. nostaa Electron uusimpaan valitun SQLite-ajurin virallisesti tukemaan
   vakaaseen versioon
3. ajaa Windows package- ja smoke-testit uudelleen
4. tarkistaa Electronin ja transitiivisten riippuvuuksien turvallisuustila

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
- `better-sqlite3` Electronin ABI:lla
- PDFKit
- turvallinen Electron-konfiguraatio ja fuses

Suora Packager/Fuses-yhdistelmä pitää tämän todentamisen rajattuna.
`better-sqlite3`-paketin oma staged `prebuild-install`-työkalu asentaa vain
paketointihakemiston kopioon Electron-version kanssa yhteensopivan binäärin.
Paketointiputki tarkistaa SHA-256-tiivisteellä, ettei työtilan Node-binääri
muutu. Erillistä native-rebuild-riippuvuutta ei siksi tarvita.
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
- `better-sqlite3` rakennetaan vain staging-kopiossa Electronille; workspace-
  asennusta ei rikota Node-kehityksen ABI:n osalta.
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

## Liittyvät Dokumentit

- `AGENTS.md`
- `docs/architecture/dependency-policy.md`
- `docs/architecture/local-desktop-implementation-plan.md`
- `docs/architecture/security-principles.md`
- `docs/decisions/ADR-0007-local-desktop-shell-and-session-bootstrap.md`
