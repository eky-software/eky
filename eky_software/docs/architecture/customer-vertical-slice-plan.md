# Customer vertical slice plan

Tämä dokumentti kuvaa ensimmäisen pienen Customer create/list local -pystysuoran palan.

Tämä ei ole koko asiakashallintamoduulin lopullinen suunnitelma. Tämän dokumentin tarkoitus on rajata ensimmäinen toteutusaskel, jolla todistetaan Eky-arkkitehtuurin ensimmäinen oikea local-first dataflow.

## Tavoite

Ensimmäisen customer-slicen tavoite on todistaa seuraava virta:

```text
HTTP
  -> application service
    -> domain
      -> repository port
        -> SQLite adapter
```

Tavoitteena ei ole rakentaa koko asiakashallintaa, vaan todistaa että:

- backend-reitti voi kutsua application serviceä
- application service voi käyttää repository porttia
- SQLite-adapteri voi toteuttaa repository portin
- domain pysyy riippumattomana HTTP:stä ja tietokannasta
- local-first-tietokantapolku voidaan toteuttaa hallitusti

## Rajaus

Ensimmäinen slice sisältää vain:

- `POST /customers`
- `GET /customers`
- paikallisen backendin kautta tehtävät kutsut
- alustavan SQLite-suunnan myöhempää toteutusta varten
- repository port -mallin
- SQLite adapter -mallin

Ensimmäinen slice ei sisällä:

- React UI:ta
- Firebase Authia
- käyttäjä- tai roolijärjestelmää
- laskutusta
- synkronointia
- raportointia
- audit logia
- koko customer CRUDia
- asiakkaan muokkausta
- asiakkaan poistamista
- monimutkaista hakua
- paginointia
- yhteyshenkilöitä
- asiakashistoriaa

## Ensimmäinen slice ei ole lopullinen customer domain

Ensimmäisen palan kentät ja rakenne pidetään tarkoituksella pieninä.

Niitä ei pidä tulkita koko customer-moduulin lopulliseksi tietomalliksi.

Ensimmäinen minimimalli voi olla:

- `id`
- `companyId`
- `name`
- `createdAt`
- `updatedAt`

Myöhemmin voidaan lisätä esimerkiksi:

- `businessId`
- `email`
- `phone`
- `billingAddress`
- `status`
- yhteyshenkilöt
- useammat osoitteet
- asiakashistoria
- laskutuksen tarvitsemat lisätiedot

Kenttiä lisätään vasta, kun niille on konkreettinen käyttötarve.

## companyId ja dev-companyId

`companyId` otetaan mukaan heti, vaikka varsinaista auth- tai tenant-mallia ei vielä ole.

Tämä estää sen, että tietomalli syntyy vahingossa yhden yrityksen kovakoodatuksi malliksi.

Ensimmäisessä paikallisessa kehitysvaiheessa voidaan käyttää väliaikaista kehitysarvoa:

```text
dev-company
```

`dev-company` on vain paikallinen kehitysarvo.

Se ei ole lopullinen auth-, tenant- tai permission-malli.

Kun auth ja company membership -malli myöhemmin toteutetaan, `companyId` määräytyy backendin tarkistaman käyttäjän ja yrityskontekstin perusteella.

## Alustava backend-kansiorakenne

Ensimmäinen customer-slice voidaan toteuttaa backendin sisällä:

```text
apps/backend/src/modules/customers/
  application/
    createCustomer.ts
    listCustomers.ts

  domain/
    customer.ts
    customerRules.ts

  ports/
    customerRepository.ts

  infrastructure/
    sqliteCustomerRepository.ts

  http/
    customersRoutes.ts
```

Tämä rakenne on ensimmäistä slicea varten.

Puhdas ja myöhemmin jaettava customer-domain voidaan siirtää `packages/domain`-pakettiin vasta, kun malli on riittävän kypsä.

Ensimmäisessä vaiheessa vältetään liian aikaista jaettua abstraktiota.

## HTTP-reitit

Ensimmäiset reitit:

```text
POST /customers
GET /customers
```

`POST /customers` luo uuden asiakkaan paikalliseen tietokantaan.

`GET /customers` listaa paikallisen yrityskontekstin asiakkaat.

Ei vielä toteuteta:

- `GET /customers/:id`
- `PUT /customers/:id`
- `DELETE /customers/:id`
- haku
- suodatus
- paginointi
- arkistointi
- passivointi

## Riippuvuuksien rajaus

SQLite-ajuri ja suora parametrisoitu SQL ovat ensimmäisen toteutusvaiheen linja.

Query builderia ei oteta käyttöön ensimmäisessä customer-slicessa.

Kun tietokantariippuvuudet myöhemmin lisätään, niiden pitää pysyä backendin database adapter -kerroksessa.

Tietokantariippuvuudet eivät saa vuotaa:

- `packages/domain`
- application service -rajapintoihin
- repository portteihin
- `packages/*`-paketteihin
- React/UI-kerrokseen

SQLite-ajuria, Drizzleä, ORM:ää tai muuta query builderia ei lisätä ilman erillistä hyväksyttyä toteutusaskelta.

## Arkkitehtuurisäännöt

Hono pysyy HTTP-kerroksessa.

Domain ei tunne:

- Honoa
- SQLitea
- SQL-kyselyitä
- tietokantakirjastoa
- HTTP request/response -olioita

Application service käyttää repository porttia.

SQLite adapter toteuttaa repository portin.

UI ei koskaan kirjoita suoraan tietokantaan.

Toinen moduuli ei saa kirjoittaa customers-moduulin dataan suoraan.

Customers-moduuli omistaa asiakasdatan.

Invoicing, work-orders, inventory, reporting tai AI-agentit eivät saa ohittaa customers-moduulin rajaa.

## Turvallisuus

SQLite-tiedosto ei saa mennä Gitiin.

SQLite-tiedostoa ei saa tarjoilla webistä.

SQL-kyselyt tehdään parametrisoidusti.

Käyttäjän syöte ei saa päätyä SQL-lauseisiin merkkijonojen yhdistelyllä.

Local backend kuuntelee edelleen oletuksena `127.0.0.1`-osoitteessa.

`companyId` pidetään mukana alusta asti.

Local/offline-käyttö ei oikeuta ohittamaan domain-sääntöjä.

Väliaikainen `dev-company` ei ole turvallisuusmalli.

Kun auth myöhemmin toteutetaan, backend määrittää yrityskontekstin luotettavasta käyttäjä- ja permission-mallista.

## Hyväksymiskriteerit tulevalle toteutukselle

Ensimmäinen customer-slice on valmis vasta, kun:

- `POST /customers` luo asiakkaan paikalliseen SQLite-kantaan
- `GET /customers` listaa asiakkaat
- `pnpm typecheck` menee läpi
- backend build menee läpi
- Hono-importit pysyvät HTTP-kerroksessa
- domain ei importtaa Honoa, SQLitea, SQL-adaptereita tai tietokantakirjastoa
- repository port on erillään SQLite-adapterista
- SQLite-tiedosto ei päädy Gitiin
- `packages/utils`-kansiota ei synny
- `packages/domain` muuttuu vain, jos siihen on erillinen hyväksytty syy

## Mitä ei tehdä ensimmäisessä toteutuksessa

Ensimmäisessä customer-slicessa ei tehdä:

- koko asiakashallintaa
- koko tietokantaskeemaa
- laskutusta
- PDF-laskuja
- Firebase Authia
- tuotannon permission-mallia
- tenant membership -mallia
- local-cloud-synkronointia
- audit logia
- raportointia
- React UI:ta
- api-client-kerroksen lopullista mallia
- mobiilitukea
- AI-agenttien entrypointteja

## Liittyvät dokumentit

- `AGENTS.md`
- `docs/architecture/base-architecture.md`
- `docs/architecture/module-boundaries.md`
- `docs/architecture/dependency-policy.md`
- `docs/architecture/data-model-principles.md`
- `docs/architecture/security-principles.md`
- `docs/architecture/local-cloud-sync.md`
- `docs/modules/customers.md`
- `docs/decisions/ADR-0003-technical-foundation.md`
- `docs/decisions/ADR-0004-local-backend-runtime.md`
- `docs/decisions/ADR-0005-backend-framework-selection.md`
- `docs/decisions/ADR-0006-local-database-and-query-layer.md`
