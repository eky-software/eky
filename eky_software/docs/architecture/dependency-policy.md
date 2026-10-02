# Riippuvuuksien hallinta

Tämä dokumentti määrittelee Eky-projektin riippuvuussäännöt.

Tavoitteena on pitää järjestelmä turvallisena, ylläpidettävänä ja vaihdettavana.

## Periaate

Uutta kolmannen osapuolen kirjastoa ei lisätä ilman perustelua.

Perustelu ei yksin riitä hyväksynnäksi. Jokainen uusi runtime- ja
development-riippuvuus vaatii projektin omistajan erillisen, nimenomaisen
hyväksynnän ennen asennusta, importointia tai package-/lockfile-muutosta.
Laajemman ominaisuuden tai toteutusvaiheen hyväksyntä ei hyväksy siinä
nimeämätöntä riippuvuutta.

Eky-projektissa riippuvuuksia minimoidaan tietoisesti.

Uusi kirjasto lisätään vain, jos se ratkaisee todellisen ongelman, jota ei ole järkevää ratkaista projektin omalla selkeällä koodilla.

Jos ulkoinen kirjasto ei ole välttämätön, suositaan omaa pientä toteutusta.

Jokainen uusi riippuvuus lisää ylläpito-, tietoturva-, yhteensopivuus- ja pitkäikäisyysriskiä.

Riippuvuudet pyritään eristämään omien Eky-kerrosten taakse.

Jos kirjasto joudutaan myöhemmin vaihtamaan, muutoksen pitää osua rajattuun osaan järjestelmää.

## Sallitut alkuvaiheen riippuvuudet

Alustavasti hyväksyttyjä riippuvuuksia voivat olla:

- React
- Vite
- React Router
- TanStack Query
- React Hook Form
- Zod
- Firebase
- Vitest
- TypeScript
- Hono
- better-sqlite3
- ESLint
- Prettier

Tarkat versiot päätetään projektin teknisessä aloituksessa.

Hono on hyväksytty alustavasti vain backendin HTTP-adapteriksi dokumentin `docs/decisions/ADR-0005-backend-framework-selection.md` mukaisesti.

better-sqlite3 on hyväksytty vain `apps/backend`-sovelluksen database/infrastructure-adapterikerrokseen dokumenttien `docs/decisions/ADR-0006-local-database-and-query-layer.md` ja `docs/architecture/local-database-implementation-plan.md` mukaisesti.

Query builder tai ORM voidaan lisätä myöhemmin vain erillisellä päätöksellä, jos suora parametrisoitu SQL alkaa kasvattaa ylläpitoriskiä.

## Riippuvuuden lisäämisen tarkistus

Ennen uuden riippuvuuden lisäämistä vastaa:

1. Mitä ongelmaa kirjasto ratkaisee?
2. Onko ongelma infrastruktuuria vai Eky-projektin omaa liiketoimintalogiikkaa?
3. Voidaanko riippuvuus eristää oman Eky-kerroksen taakse?
4. Onko kirjasto aktiivisesti ylläpidetty?
5. Mikä lisenssi kirjastolla on?
6. Kuinka paljon transitiivisia riippuvuuksia se tuo?
7. Mitä tapahtuu, jos kirjasto pitää myöhemmin vaihtaa?
8. Onko olemassa turvallisempi tai yksinkertaisempi vaihtoehto?

Jos vastausta ei ole, riippuvuutta ei lisätä.

Jos riippuvuuden tarve selviää vasta ensimmäistä toteutusta kirjoitettaessa,
koodaus pysäytetään ennen riippuvuuden lisäämistä ja vertailu tuodaan
projektin omistajan hyväksyttäväksi. Kokeiluasennusta ei tehdä ennakkoon. Jos
riippuvuus on lisätty vahingossa ilman hyväksyntää, muutosta ei commitoida tai
pushata ennen kuin se on peruttu tai projektin omistaja on hyväksynyt sen
nimenomaisesti.

## Kerroskohtaiset säännöt

### Rajattu CI-salaustyökalu

Omistaja on hyväksynyt Windowsin Git-työkaluketjun GnuPG:n sekä Linuxin
hosted-runnerin valmiin GnuPG:n ja PowerShellin vain
[CI-tutkimusaineiston OpenPGP-salaukseen](ci-encrypted-evidence.md).
Työkalu pysyy testiapurin takana; se ei ole sovellus- tai npm-riippuvuus
eikä kuulu EKY-asentimeen. Hyväksyntä ei salli uusia salauskirjastoja,
automaattisia asennuksia tai työkalun käyttöä business-datan suojaukseen.

### Sovelluskerrokset

React kuuluu vain web-käyttöliittymään.

React Router tai muu reitityskirjasto voidaan lisätä vain erillisellä
päätöksellä, kun pysyvät URL-näkymät, selainhistoria tai suorat resurssilinkit
tekevät sen tarpeelliseksi. Nykyistä kevyttä päämoduulien view state -mallia ei
korvata kirjastolla varmuuden vuoksi.

Jos router hyväksytään, se kuuluu webin `app/` / navigation -kerrokseen. Se ei
saa levitä domainiin, api-clientiin, backendiin tai featureiden
liiketoimintalogiikkaan. Tarkempi päätöspiste on dokumentissa
`docs/architecture/web-frontend-structure.md`.

TanStack Query kuuluu vain frontendin datahakuihin ja hookeihin.

React Hook Form kuuluu lomakelogiikkaan.

Firebase kuuluu auth- tai infrastructure-kerroksen taakse.

Zod kuuluu validointikerrokseen.

SQLite-ajuri ja SQL-kyselyt kuuluvat vain backendin database/infrastructure-adapterikerrokseen.

Domain-kerros ei saa riippua Reactista, Firebasesta, TanStack Querystä, React Hook Formista, tietokannasta tai selain-API:sta.

## SQL-adapterisäännöt

Koska ensimmäinen paikallinen tietokantatoteutus käyttää suoraa parametrisoitua SQL:ää ilman query builderiä, SQL-kurin pitää olla eksplisiittinen.

SQL on adapterin sisäinen toteutusyksityiskohta.

SQL saa näkyä vain backendin infrastructure/database/repository-adapterikerroksessa.

SQL-adapterin raja määräytyy käyttötapauksen tai koherentin read modelin
mukaan, ei pelkästään yhteisen tietokantayhteyden mukaan. Yhteinen
`DatabaseConnection` ei ole peruste yhdistää toisistaan riippumattomia
repository- tai reader-portteja samaan adapteriin.

Yhteiset row-to-domain- ja row-to-read-model-muunnokset voidaan jakaa tarkasti
nimettyyn moduulikohtaiseen mapping-tiedostoon. Tätä varten ei luoda geneeristä
base readeria, query manageria tai mapper-frameworkia.

SQL ei saa näkyä:

- domainissa
- application serviceissä
- HTTP-routeissa
- repository port -rajapinnoissa
- `packages/*`-paketeissa
- `apps/web`-sovelluksessa

Kaikki muuttuvat arvot annetaan parametrisoituina arvoina.

Hyvä:

```ts
database.prepare('SELECT * FROM customers WHERE company_id = ?').all(companyId);
```

Huono:

```ts
database.prepare(`SELECT * FROM customers WHERE company_id = '${companyId}'`);
```

Käyttäjän syötettä ei saa koskaan yhdistää SQL-merkkijonoon.

Repository port ei saa palauttaa tai vastaanottaa:

- better-sqlite3-tyyppejä
- SQL statementteja
- tietokantarivejä sellaisenaan
- database connection -olioita

Repository port saa käyttää vain domain- ja application-tason tyyppejä.

Tietokanta-adapteri vastaa `snake_case` <-> `camelCase` -muunnoksesta.

Pitkät tai monimutkaiset SQL-kyselyt kapseloidaan selkeästi nimettyihin repository-metodeihin.

Hyvä:

```text
customerRepository.listCustomersWithOpenInvoiceSummary(companyId)
```

Huono:

```text
application service kokoaa itse JOIN-kyselyn useasta taulusta
```

Laajemmat cross-module JOIN-kyselyt kuuluvat myöhemmin reporting/read-model-kerrokseen, eivät satunnaisesti customers-, invoicing- tai work-orders-moduulin sisään.

## API-client

Frontend ei kutsu backend API:a suoraan komponenteista, jos api-client-kerros on olemassa.

API-client piilottaa backend-reitit ja yhteiset virheenkäsittelyt.

## Observability-adapterit

Operational- ja security-lokitus toteutetaan kapeiden porttien ja tyypitettyjen
tapahtumasopimusten kautta.

- Älä luo `LoggerManager`-, `LoggingService`-, `commonLogger`- tai
  `logger.info(string, object)` -rajapintaa.
- Älä hyväksy arbitrary metadataa tai raw `Error` -objektia.
- Yksi adapteri omistaa yhden koherentin tiedostovirran.
- Backend- ja desktop-adapterit pidetään erillisinä.
- Renderer ei kirjoita lokitiedostoja eikä saa yleistä log-IPC:tä.
- Node.js:n vakiokirjastoa käytetään JSONL-, rotaatio-, gzip- ja checksum-
  vastuisiin; uutta loki- tai pakkausriippuvuutta ei lisätä ilman erillistä
  hyväksyntää.
- Business audit pysyy moduulin omassa persistence-adapterissa eikä kulje
  operational loggerin kautta.

## Auth-wrapper

Firebase Auth eristetään oman auth-kerroksen taakse.

Muu sovellus ei saa olla täynnä suoria Firebase-kutsuja.

## Lockfile

Lockfile commitoidaan versionhallintaan.

Esimerkiksi:

- `pnpm-lock.yaml`
- `package-lock.json`
- `yarn.lock`

Tuotantoon ei asenneta riippuvuuksia ilman lukittua versiota.

## Päivitykset

Patch- ja minor-päivitykset tehdään hallitusti.

Major-päivitykset vaativat erillisen tarkistuksen.

Tietoturvapäivitykset käsitellään nopeasti, mutta testaten.

## Automaattinen päivitysvalvonta

Dependabot version updates tarkistaa npm-workspacen, erillisen pnpm-bootstrapin ja GitHub Actions
-viittaukset viikoittain `.github/dependabot.yml`-tiedoston mukaisesti.
Dependabotin avaama pull request on katselmointiehdotus, ei hyväksyntä:

- automaattista mergeä ei käytetä
- uusi suora tai transitiivisesti merkittävä riippuvuus käy edelleen läpi
  tämän dokumentin hyväksyntäportin
- tavallisten versionpäivitysten cooldown on patchille 3, minorille 7 ja
  majorille 30 päivää
- cooldown ei viivästytä Dependabotin security-päivityksiä
- major-päivitykset pysyvät yksittäisinä pull requesteina
- Electron, `better-sqlite3`, `@electron/*`, Hono, PDFKit, Playwright,
  TypeScript, Vite ja Reactin Vite-plugin käsitellään yksittäisinä
  päivityksinä myös patch- ja minor-tasolla
- muut yhteensopivat patch- ja minor-päivitykset voidaan ryhmitellä

Bootstrapin `/.github/bootstrap/pnpm`-ehdotus käsitellään erikseen, enintään
yksi versionpäivitys-PR kerrallaan. Sen täsmäversio sovitetaan myös
`eky_software/package.json`-tiedoston `packageManager`-arvoon. Eriävät pinnit
hylätään valmistelussa; Dependabot-ehdotus ei ohita tätä yhteensopivuusporttia.

GitHub Actions -viittaukset säilytetään commit-SHA:lla lukittuina. Dependabot
saa ehdottaa SHA:n päivittämistä, mutta muutos katselmoidaan eikä sitä
mergeytetä automaattisesti.

Erillinen vain lukeva `Dependency security` -workflow:

- käyttää lukittua lockfilea
- ajetaan päivittäin klo 02.30 UTC; GitHubin cron ei seuraa
  Europe/Helsinki-kesäaikaa
- ajetaan käsin `workflow_dispatch`-toiminnolla
- ajetaan jokaisessa `main`-haaraan kohdistuvassa pull requestissa
- ajetaan `main`-pushissa vain, kun package manifest, lockfile,
  paketinhallinnan valmistelu, Dependabot-konfiguraatio tai dependency-/CI-workflow muuttuu
- tarkistaa ensin pnpm-bootstrapin haavoittuvuudet valitun Noden npm:llä
  alla kuvatun valmistelusopimuksen mukaan, ennen pnpm:n asentamista tai ajamista
- ajaa `pnpm audit --prod`-, `pnpm audit`- ja
  `pnpm audit signatures` -tarkistukset
- ei käytä `audit --fix` -komentoa
- ei muuta tiedostoja, tee committeja tai avaa päivityksiä
- käyttää vain `contents: read` -oikeutta
- ei mergeä Dependabot- tai muita päivitys-PR:iä automaattisesti

`dependabot.yml` ottaa käyttöön version updates -PR:t, mutta se ei todista
repositoryn Dependabot-turva-asetusten tilaa. Repositorion omistaja varmistaa
GitHubissa erikseen:

- Dependency graph
- Dependabot alerts
- Dependabot security updates

Tarkistuspolku on repositoryn `Settings` -> `Security` ->
`Advanced Security`. Jos käytettävissä on autentikoitu read-only GitHub API-
tarkistus, tilat voidaan varmistaa sillä. Asetuksia ei muuteta automaattisesti
eikä ilman omistajan erillistä vahvistusta. Ilman tällaista yhteyttä tila
raportoidaan varmistamattomaksi.

Merge-portteina pidetään vähintään nykyiset `Test, typecheck and build`,
`System security E2E` ja `Web critical E2E` -tarkistukset.

### CI-paketinhallinnan valmistelu

CI:n yhteinen omistaja on repositoryn
`.github/scripts/prepareLockedPnpm.mjs`. Se ei päivitä Nodea, pnpm:ää tai
sovellusriippuvuuksia. `eky_software/package.json` määrää tarkan pnpm-version;
`.github/bootstrap/pnpm/package.json` ja sen npm-lockfile lukitsevat saman
työkalun tarballin ja SHA-512-eheyden erillään sovelluksen pnpm-lockfilesta.
Näiden ristiriita hylätään ennen asennusta. Muutos tähän sopimukseen tai
työkaluversioon arvioidaan normaalin riippuvuusportin kautta.

Valmistelu tapahtuu jokaisessa pnpm:ää käyttävässä jobissa ennen ensimmäistä
pnpm-kutsua, checkoutin ulkopuolisessa uudessa `RUNNER_TEMP`-alikansiossa:

1. Valitun Node-jakelun mukana tuleva npm tarkistaa kopioidun bootstrap-lockfilen
   komennolla `npm audit --package-lock-only --json --audit-level=low`.
   Vain onnistunut komento ja ehjä versio 2 -raportti hyväksytään: ei
   virhekenttää, ei haavoittuvuuksia millään vakavuustasolla, ja auditoidun
   riippuvuusjoukon pitää vastata erillistä yhden pnpm-paketin lukitusta.
   Tyhjä tai suodatettu joukko ei ole puhdas tulos. Haku käyttää asennuksen
   välimuistia ja `--prefer-online`-valintaa; allekirjoitusvälimuistiin ei
   kirjoiteta tässä vaiheessa. `audit fix` ei kuulu valmisteluun.
2. npm asentaa vain lukitun pnpm:n
   `npm ci` -komennolla, lifecycle-skriptit ja automaattinen audit pois päältä.
3. `npm audit signatures` tarkistaa rekisteriallekirjoitukset sekä tarjolla
   olevat alkuperätodistukset normaalilla npm:n varmennusketjulla. Sen uusi
   varmennusvälimuisti on erillään asennuksen välimuistista: myöhempi
   offline-luku ei voi osua asentimen aiemmin hakemaan metadataan.
4. `npm view ... --offline` lukee tämän allekirjoitustarkistuksen käyttämän täydellisen
   pakettimetadatan samasta yksityisestä välimuistista. Nimi, versio,
   tarball-osoite ja allekirjoitettu eheystiiviste sidotaan omaan lockfileen.
   Uutta verkkohakua ei tehdä tämän sidonnan kohdalla.
5. Asennetun paketin ja npm:n asennuslockfilen identiteetit sekä oman
   lockfilen muuttumattomuus tarkistetaan. Vasta sen jälkeen pnpm suoritetaan
   version varmistamiseksi ja sen paikallinen bin-kansio lisätään
   seuraavien vaiheiden `GITHUB_PATH`-polkuun.

Asennus ei ole globaali, eikä se käytä Corepackin lataajaa. Käyttäjän npm-
konfiguraatio, ympäristön paketinhallinnan valinnat ja Node-käynnistysoptiot
eivät siirry valmistelun lapsiprosesseille. Rekisteri ja TLS-tarkistus ovat
kiinteät; välimuisti ja konfiguraatiot ovat ajokohtaisia. Workspace-/omit-
suodatusta ei käytetä: erillinen manifesti sisältää vain pnpm:n. Verkkohaut
eivät tee automaattisia uusintoja (`fetch-retries=0`). Virhe pysäyttää jobin;
ei varalataajaa, allekirjoituksen ohitusta tai vanhan välimuistin hyväksyntää.

Tämä olettaa luotetun CI-runnerin. Se ei suojaa rinnakkaiselta haitalliselta
prosessilta, joka muuttaa ajokansiota tai välimuistia. Väliaikainen asennus
säilyy jobin käytössä ja poistuu runnerin siivouksessa. Raakaa npm-virhettä,
konepolkuja tai ympäristöä ei julkaista apurin tulosteessa: suljettu vaihe
ja `CI_PNPM_*`-virhekoodi paikantavat hylkäyksen. Rajattu paikallinen
tutkinta käyttää yksityisen välimuistin npm-lokia julkaisusäännön mukaisesti.

Haavoittuvuustarkistus, tavujen/allekirjoituksen varmennus, toimintatestit ja
oletushaaran Dependabot-hälytysten sulkeutuminen ovat erillisiä todisteita.
Rekisteriallekirjoitus ei todista pakettia haavoittuvuudettomaksi.

`prepareLockedPnpm.test.mjs` testaa epäonnistumiset, auditoinnin kattavuuden,
varmennusjärjestyksen ja
sen, ettei työkalua käynnistetä tai polkua julkaista ennen hyväksyntää.
`lockedPnpmWiring.test.mjs` suojaa kaikki workflow-kuluttajat ja molemmat
testisisääntulot (`pnpm test:ci` ja kahden alustan CI-sopimukset).
Stubatut sopimustestit eivät korvaa oikeaa tyhjän välimuistin latauskoetta
eivätkä uuden revision Windows-/Linux-CI:tä.

## Supply chain -riskit

NPM-ekosysteemissä riippuvuudet voivat tuoda supply chain -riskejä.

Vältä pieniä turhia kirjastoja yksinkertaisiin tehtäviin.

Älä lisää kirjastoa vain yhden pienen apufunktion takia.

Tarkista audit-raportit säännöllisesti.

Kun `package.json`- tai `pnpm-lock.yaml`-tiedosto muuttuu:

- aja tuotantoriippuvuuksien tietoturva-audit
- tarkista suorat ja transitiiviset haavoittuvuudet
- päivitä korjattuun patch- tai minor-versioon, jos muutos on yhteensopiva ja rajattu
- dokumentoi perustelu, jos tunnettua haavoittuvuutta ei voida korjata heti

Tunnettua korjattavissa olevaa haavoittuvuutta ei jätetä projektiin vain siksi, ettei nykyinen koodi tiettävästi käytä haavoittuvaa ominaisuutta.

## Sisäiset paketit

Ekyssä voidaan luoda sisäisiä paketteja, kuten:

- `packages/domain`
- `packages/validation`
- `packages/api-client`
- `packages/auth`
- `packages/permissions`
- `packages/ui`

Sisäinen paketti ei tarkoita automaattisesti julkista npm-pakettia.

Aluksi paketit pidetään monorepon sisäisinä.

## Sisäiset Eky-apukerrokset

Ennen uuden ulkoisen npm-kirjaston lisäämistä arvioidaan, voidaanko tarve ratkaista omalla pienellä paikallisella funktiolla tai selkeästi nimetyllä sisäisellä Eky-paketilla.

Lähtökohtainen etenemisjärjestys:

1. Tee ensin pieni paikallinen ratkaisu moduulin sisällä.
2. Jos sama tarve toistuu vähintään 2-3 paikassa, harkitse sisäistä Eky-pakettia.
3. Ota ulkoinen kirjasto käyttöön vasta, jos oma ratkaisu muuttuu riskiksi, liian työlääksi tai huonommin ylläpidettäväksi kuin rajattu ulkoinen kirjasto.

Sisäistä pakettia ei luoda varmuuden vuoksi.

Sisäinen paketti voidaan luoda, kun:

- sama tarve toistuu useassa paikassa
- vastuu on selkeä
- paketin nimi kertoo tarkasti, mitä se tekee
- paketti ei riko arkkitehtuurirajoja

Hyviä sisäisen paketin esimerkkejä:

- `packages/validation`
- `packages/config`
- `packages/permissions`
- `packages/api-client`

Sisäinen Eky-paketti ei saa ohittaa:

- domain-sääntöjä
- application service -kerrosta
- permission-tarkistuksia
- repository portteja
- adapterirajoja
- moduulien datan omistajuutta

Sisäisen apukerroksen pitää vähentää toistoa, ei piilottaa järjestelmän toimintaa.

Jos oma sisäinen ratkaisu alkaa kasvaa liian suureksi tai monimutkaiseksi, arvioidaan uudelleen, pidetäänkö oma toteutus vai otetaanko rajattu ulkoinen kirjasto käyttöön.

### Validointilinja

Aluksi yksinkertainen validointi voidaan tehdä moduulin omassa HTTP/input-kerroksessa.

Jos sama validointikaava toistuu useassa moduulissa, voidaan ottaa käyttöön tai laajentaa `packages/validation`-pakettia.

Zod tai muu ulkoinen validointikirjasto otetaan käyttöön vain erillisellä päätöksellä, jos oma validointikerros alkaa muodostua riskiksi.

### SQL-apulinja

SQL pidetään adapterikerroksessa.

Jos sama `prepare` / `run` / `all` / `map` -rakenne toistuu paljon, voidaan luoda pieni backendin sisäinen database-apukerros.

Tämä apukerros ei saa muuttua omaksi ORM:ksi.

SQL-apu ei saa levitä domainiin, application serviceihin, HTTP-routeihin tai `packages/*`-paketteihin.

## Kielletyt yleispaketit

Älä luo:

- `packages/utils`
- `packages/helpers`
- `common.ts`
- `everything.ts`

Yleiset apupaketit muuttuvat helposti kaatopaikaksi ja rikkovat moduulirajoja.

## Kiellettyä

Älä tee:

- domain-kerroksesta riippuvaista UI-kirjastosta
- Firebase-kutsuja satunnaisiin komponentteihin
- Axios-tyyppistä riippuvuutta ilman perustelua, jos fetch riittää
- yleistä riippuvuuksien lisäämistä varmuuden vuoksi
- uutta isoa UI-frameworkia ilman päätöstä

## Dokumentointi

Jos uusi riippuvuus lisätään, kirjaa perustelu `docs/architecture/tech-decisions.md`-tiedostoon tai erilliseen ADR:ään, jos päätös on merkittävä.

Uuden moduulin riippuvuudet, adapterirajat ja jaettujen työkalujen kynnys
tarkistetaan lisäksi dokumentin
`docs/architecture/new-module-implementation-checklist.md` avulla.
