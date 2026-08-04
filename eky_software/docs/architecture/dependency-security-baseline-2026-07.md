# Riippuvuusturvan lähtötilanne 2026-07

Tämä dokumentti kirjaa Eky-repositorion riippuvuusturvan tarkastuksen ennen
heinäkuun 2026 rajattuja tietoturvapäivityksiä.

Tarkastettu lähtöcommit on
`9c47cdf32d60f3cf3d20d48c24ee7d43361c8fad`. Eky-tuoteversio on
`0.1.0-alpha.1`.

## Tarkastusympäristö

- Node.js `24.11.0`
- pnpm `11.1.3`
- asennus onnistui komennolla `pnpm install --frozen-lockfile`
- `pnpm audit signatures` varmisti kaikkien 203 asennetun paketin
  rekisteriallekirjoitukset
- `pnpm audit --json` löysi kolme advisorya
- `pnpm audit --prod --json` löysi kaksi tuotantoriippuvuuksiin vaikuttavaa
  advisorya
- auditissa ei käytetty `--fix`-komentoa eikä overridea

pnpm 11.1.0:sta alkaen virallinen `pnpm audit signatures` tarkistaa
asennettujen pakettien ECDSA-rekisteriallekirjoitukset rekisterien julkaisemilla
avaimilla. Tarkistus ei korvaa lockfilea, advisory-auditia, release notes
-katselmointia tai paketoidun artifactin testausta.

## Suorat tarkastetut versiot

| Käyttö | Paketti | Lähtöversio | Tyyppi | Lisenssi |
| --- | --- | ---: | --- | --- |
| Backend HTTP-adapteri | `@hono/node-server` | `2.0.3` | production, direct | MIT |
| Backend HTTP-framework | `hono` | `4.12.27` | production, direct | MIT |
| Windows-paketointi | `@electron/packager` | `20.0.2` | development, direct | BSD-2-Clause |
| Desktop-runtime | `electron` | `42.6.1` | development, direct | MIT |

Muut saatavilla olevat päivitykset ovat tämän turvallisuustehtävän ulkopuolella.
Erityisesti Electron 43, `better-sqlite3`, React, Vite, TypeScript,
Playwright ja PDFKit säilyvät tässä vaiheessa ennallaan.

## Löydökset

### GHSA-frvp-7c67-39w9

- vakavuus: moderate
- paketti: suora production-riippuvuus `@hono/node-server@2.0.3`
- affected range: `<2.0.5`
- patched range: `>=2.0.5`
- riippuvuusketju: `@eky/backend -> @hono/node-server`
- vaikutus: Windowsin `serve-static` voi käsitellä URL-koodatun kenoviivan
  polkuerottimena ja ohittaa prefix-middleware-rajan
- Eky-altistus: Eky ei importoi `@hono/node-server/serve-static`-middlewarea
  eikä backend tarjoa staattisia tiedostoja tämän adapterin kautta; backend
  kuuntelee lisäksi vain IPv4-loopbackissa
- korjaus: päivitä `@hono/node-server` uusimpaan vakaaseen korjattuun
  2.x-versioon

Virallinen advisory:
<https://github.com/advisories/GHSA-frvp-7c67-39w9>

### GHSA-9mqv-5hh9-4cgg

- vakavuus: moderate
- paketti: suora production-riippuvuus `@hono/node-server@2.0.3`
- affected range: `>=2.0.0 <=2.0.9`
- patched range: `>=2.0.10`
- riippuvuusketju: `@eky/backend -> @hono/node-server`
- vaikutus: keskeytetty virheellinen WebSocket-kättely voi jättää requestin
  pysyvästi muistiin ja johtaa saatavuushyökkäykseen
- Eky-altistus: Eky ei käytä `upgradeWebSocket`-reittejä eikä anna
  `serve`-kutsulle WebSocket-palvelinta; backend kuuntelee vain
  IPv4-loopbackissa
- korjaus: päivitä `@hono/node-server` uusimpaan vakaaseen korjattuun
  2.x-versioon

Virallinen advisory:
<https://github.com/advisories/GHSA-9mqv-5hh9-4cgg>

### GHSA-mh99-v99m-4gvg / CVE-2026-14257

- vakavuus: high
- paketti: transitiivinen development-riippuvuus `brace-expansion@5.0.7`
- affected range: `<=5.0.7`
- patched range: `>=5.0.8`
- riippuvuusketju:
  `@eky/desktop -> @electron/packager -> @electron/asar / @electron/universal
  -> glob / minimatch -> brace-expansion`
- vaikutus: hyökkääjän hallitsema poikkeuksellisen pitkä brace-pattern voi
  kasvattaa muistinkäytön rajatta ja kaataa Node.js-prosessin
- Eky-altistus: ketju kuuluu vain Windows-paketoinnin build-ympäristöön;
  paketoija käsittelee Eky-repositorion luotettuja polkuja eikä käyttäjän tai
  verkon syöttämiä glob-pattern-arvoja. Löydös ei sisälly backendin
  production-riippuvuuksien auditiin
- korjaus: päivitä ensin `@electron/packager` uusimpaan vakaaseen
  20.x-versioon ja varmista auditista sekä lockfile-diffistä, että
  transitiivinen ketju siirtyy korjattuun versioon
- pysäytysraja: jos high-löydös jää upstream-päivityksen jälkeen, Electronia ei
  päivitetä ennen projektin omistajan uutta päätöstä

Virallinen advisory:
<https://github.com/advisories/GHSA-mh99-v99m-4gvg>

## Nykyiset suojarajat

- backend pakottaa kuunteluosoitteeksi `127.0.0.1`
- Electron main käynnistää ja sulkee paketoidun backendin hallitusti
- runtime-session ja `ActorContext` suojaavat arkaluonteiset local-runtime
  -reitit
- HTTP-body-rajat, unknown-field-torjunta ja requestin kertalukeminen testataan
  backendissä ja system E2E -tasolla
- `@hono/node-server` käyttää oletusarvoista kesken jäävien incoming requestien
  cleanupia; Eky ei kytke sitä pois
- Windows-paketointi validoi tarkasti lukitun `better-sqlite3`-runtimen
  native-binäärin ja tarkistaa tuotantofuset

Nämä rajat pienentävät käytännön altistusta, mutta eivät ole peruste jättää
korjattavissa olevaa tunnettua haavoittuvuutta riippuvuuspuuhun.

## Heinäkuun Lähtötilanteen Päivityssuunnitelma

Heinäkuun Electron 42 -lähtötilanteen rajatut päivitykset toteutettiin:

1. `@hono/node-server` on vähintään `2.0.12` ja `hono` vähintään `4.12.32`.
2. `@electron/packager` on `20.0.4`.
3. Electron lukittiin lähtötilanteessa versioon `42.8.0`. Sen ainoa
   paketointiversion lähde oli ja on `apps/desktop/package.json`.
4. Dependabot version updates käyttää hallittua viikkorytmiä ilman
   automaattimergeä.
5. Vain lukeva `Dependency security` ajaa production- ja full auditin sekä
   rekisteriallekirjoitusten tarkistuksen päivittäin, dependency-muutoksissa ja
   käsin käynnistettynä.

Electron 43- ja `better-sqlite3` 13 -muutos toteutettiin myöhemmin erillisenä
päätöksenä. Tuotantojulkaisun release-portti on edelleen erillinen päätös.

## Electron 43 -yhteensopivuuspäivitys 3.8.2026

Heinäkuun lähtötilanteen jälkeen desktop-runtime päivitettiin tarkasti
lukittuihin versioihin:

- Electron `43.2.0`
- `better-sqlite3 13.0.2`
- `@electron/packager 20.0.4`
- `@electron/fuses 2.1.3`.

better-sqlite3 13 toimittaa Windows x64 N-API-binäärin osana pakettia.
Paketointiputkesta poistettiin pnpm-virtuaalivaraston skannaus,
`prebuild-install` ja staged ABI-uudelleenrakennus. Asennusskripti sallitaan
edelleen vain Electronille; better-sqlite3:n install-skriptiä ei ajeta.

Päivityksen jälkeen:

- `pnpm audit --prod` ja `pnpm audit` eivät raportoineet tunnettuja
  haavoittuvuuksia
- `pnpm audit signatures` varmisti 167 paketin rekisteriallekirjoitukset
- riippuvuuspuussa oli yksi Electron `43.2.0` ja yksi better-sqlite3 `13.0.2`
- synteettinen tietokanta, paikallisen tietokannan turvallinen kopio,
  migraatiot, foreign key- ja integrity-tarkistus sekä rollback varmennettiin
- Windows package, paketoitu smoke, Electron critical E2E, PDF-esikatselu,
  safeStorage, fake SMTP, tukipaketti sekä stressi- ja soak-ajot läpäistiin.

Päivitys ei muuta Eky-tuoteversiota `0.1.0-alpha.1` eikä poista installer-,
code signing-, automaattipäivitys- tai muun release security gate -työn
tarvetta.

## Hono-tietoturvapäivitys 4.8.2026

Päivittäinen `Dependency security` -workflow havaitsi
`GHSA-8j4g-w8fx-2239`-advisoryn, joka koski Hono-versioita `<4.12.34`.
Kyseessä oli CORS-middlewareen kohdistuva ReDoS-riski
`Access-Control-Request-Headers`-otsakkeen käsittelyssä.

Suora backend-riippuvuus päivitettiin versiosta `4.12.33` versioon
`4.12.34`. Sama korjattu versio lukittui myös
`@hono/node-server`-riippuvuuden peer-ketjuun. Päivityksen jälkeen:

- `pnpm audit --prod` ei raportoinut tunnettuja haavoittuvuuksia
- `pnpm audit` ei raportoinut tunnettuja haavoittuvuuksia
- `pnpm audit signatures` varmisti 165 paketin rekisteriallekirjoitukset.

Workflow toimi tässä tilanteessa tarkoitetulla tavalla: päivittäinen audit
havaitsi uuden advisoryn ennen Dependabotin seuraavaa hallittua
versionpäivityskierrosta. Dependabot-asetuksia tai automaattimergeä ei tämän
vuoksi muutettu.

## CI- ja repository-asetusten lähtötila

Nykyinen SHA-pinnattu CI sisältää tarkistukset:

- `Test, typecheck and build`
- `System security E2E`
- `Web critical E2E`

Repositoryn GitHub Advanced Security -asetusten admin-tasoinen read-only
varmistus ei ole käytettävissä nykyisellä GitHub-yhteydellä. Siksi Dependency
graph-, Dependabot alerts- ja Dependabot security updates -tilaa ei väitetä
varmistetuksi. Omistaja tarkistaa ne repositoryn `Settings` -> `Security` ->
`Advanced Security` -näkymästä. Asetuksia ei muuteta ilman omistajan erillistä
vahvistusta.

## Rajaukset

Tähän lähtötiladokumenttiin ei tallenneta auditin raakaa JSON-vastausta,
rekisteritokeneita, ympäristömuuttujia, paikallisia käyttäjäpolkuja tai muuta
salassa pidettävää tietoa.
