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
