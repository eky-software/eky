# Initial skeleton plan

Tämä dokumentti kuvaa Eky-projektin ensimmäisen teknisen rungon.

Tavoitteena on luoda pieni, turvallinen ja laajennettava pohja, jonka päälle voidaan myöhemmin rakentaa asiakashallinta, laskutus, paikallinen offline-käyttö, pilviyhteys, mobiilisovellus ja AI-agentit.

Tämä dokumentti ei kuvaa koko ERP-järjestelmää. Se kuvaa ensimmäisen teknisen rungon, jonka Codex saa myöhemmin luoda.

## Arkkitehtuuriajatus

Eky rakennetaan sipuli- ja puumallin yhdistelmänä.

Sipuli tarkoittaa kerroksia:

```text
external world
  -> UI / API / infrastructure adapters
  -> application services
    -> ports / interfaces
      -> domain
```

Puu tarkoittaa moduuleja eli liiketoiminnan oksia:

```text
customers
invoicing
work-orders
inventory
reporting
accounting later
ai-agents later
```

Kerrosten tehtävä on pitää tekninen rakenne turvallisena.

Moduulien tehtävä on pitää liiketoiminta-alueet erillään.

Moduuli saa seistä pääosin omilla jaloillaan, mutta se voi käyttää muiden moduulien tietoja hallittujen rajapintojen kautta.

Moduuli ei saa muuttaa toisen moduulin sisäistä dataa suoraan.

## Tavoite

Ensimmäisen rungon tavoite on todistaa, että Eky-projekti voidaan jakaa selkeisiin sovelluksiin ja sisäisiin paketteihin.

Rungon pitää tukea seuraavia periaatteita:

- local-first-ajattelu
- cloud-ready-ajattelu
- modulaarinen monoliitti
- turvallinen kerrosrakenne
- selkeä domain-eristys
- Reactin pitäminen vain web-kerroksessa
- ulkoisten palveluiden eristäminen adapterien taakse
- myöhempi SQLite-paikalliskäyttö
- myöhempi PostgreSQL-pilvikäyttö
- myöhempi Firebase Auth
- myöhempi mobiilisovellus
- myöhemmät AI-agentit

Ensimmäinen skeleton ei rakenna ominaisuuksia.

Ensimmäinen skeleton rakentaa rajat, joihin ominaisuudet myöhemmin laitetaan.

## Mitä tässä vaiheessa tehdään

Ensimmäisessä rungossa luodaan projektin tekninen pohja.

Tässä vaiheessa voidaan luoda:

- monorepo-rakenne
- `pnpm` workspace
- sovelluskansiot
- sisäiset package-kansiot
- alustavat `README.md`-tiedostot
- alustavat `package.json`-tiedostot
- alustava TypeScript-konfiguraatio
- alustava dokumentoitu kansiorakenne

## Mitä tässä vaiheessa ei tehdä

Tässä vaiheessa ei vielä tehdä:

- asiakashallinnan varsinaista toteutusta
- laskutuslogiikkaa
- tietokantatauluja
- migraatioita
- SQLite-toteutusta
- PostgreSQL-toteutusta
- Firebase-integraatiota
- kirjautumista
- pilvijulkaisua
- mobiilisovellusta
- synkronointia
- PDF-laskuja
- sähköpostilähetystä
- verkkolaskutusta
- AI-agentteja

Tavoitteena ei ole rakentaa ominaisuutta, vaan luoda turvallinen tekninen runko ominaisuuksien rakentamista varten.

## Alustava monorepo-rakenne

Ensimmäinen kansiorakenne:

```text
eky_software/
  AGENTS.md
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json

  apps/
    web/
      README.md
      package.json
      tsconfig.json
      src/

    backend/
      README.md
      package.json
      tsconfig.json
      src/

  packages/
    domain/
      README.md
      package.json
      tsconfig.json
      src/

    validation/
      README.md
      package.json
      tsconfig.json
      src/

    api-client/
      README.md
      package.json
      tsconfig.json
      src/

    auth/
      README.md
      package.json
      tsconfig.json
      src/

    permissions/
      README.md
      package.json
      tsconfig.json
      src/

    ui/
      README.md
      package.json
      tsconfig.json
      src/

    config/
      README.md
      package.json
      tsconfig.json
      src/
```

`packages/utils` ei luoda ensimmäisessä rungossa.

Jos myöhemmin tarvitaan yleisiä apufunktioita, `packages/utils` voidaan lisätä erillisellä päätöksellä ja sille määritellään tarkka vastuu.

## Package manager

Projektissa käytetään `pnpm`-paketinhallintaa.

Juureen luodaan `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Juuren `package.json` toimii workspace-tason ohjauksessa.

Ensimmäisessä vaiheessa package scriptit voivat olla alustavia.

Mahdollisia myöhempiä komentoja:

```json
{
  "scripts": {
    "dev": "pnpm --parallel dev",
    "build": "pnpm --recursive build",
    "test": "pnpm --recursive test",
    "typecheck": "pnpm --recursive typecheck"
  }
}
```

Tarkat komennot päätetään, kun web- ja backend-sovellukset luodaan.

## Sovellukset

### `apps/web`

`apps/web` sisältää ensimmäisen web-käyttöliittymän.

Alustava teknologia:

- React
- Vite
- TypeScript

Web-sovelluksen vastuu:

- näyttää käyttöliittymä
- käsitellä käyttäjän vuorovaikutus
- käyttää api-client-kerrosta
- käyttää ui-pakettia
- käyttää validation-pakettia lomakkeiden tukena
- käyttää permissions-pakettia käyttökokemuksen parantamiseen

Web-sovellus ei saa:

- kirjoittaa suoraan tietokantaan
- kutsua Firebasea suoraan komponenteista
- sisältää varsinaista liiketoimintalogiikkaa
- päättää lopullisia käyttöoikeuksia
- ohittaa backend- tai service-kerrosta

### `apps/backend`

`apps/backend` sisältää backendin.

Backendin vastuu:

- vastaanottaa API-kutsut
- tarkistaa autentikointi myöhemmin
- tarkistaa käyttöoikeudet
- tarkistaa yritysrajaus
- validoida syöte
- kutsua service-kerrosta
- käyttää domain-logiikkaa
- käyttää repository-adaptereita
- kirjata audit log myöhemmin

Backendin pitää olla suunniteltu niin, että samaa liiketoimintalogiikkaa voidaan käyttää sekä paikallisessa että pilviympäristössä.

Ensimmäisessä rungossa backend framework voidaan jättää vielä avoimeksi, jos sitä ei tarvita välittömästi.

## Sisäiset paketit

### `packages/domain`

`packages/domain` sisältää puhtaan liiketoimintalogiikan.

Sallittua:

- domain-tyypit
- arvotyypit
- tilat
- tilasiirtymät
- laskentafunktiot
- liiketoimintasäännöt

Kiellettyä:

- React
- Firebase
- tietokantakirjastot
- HTTP-kutsut
- selain-API:t
- backend framework
- Zod skeleton-vaiheessa

Domain on järjestelmän sisin kerros.

Jos Zodia tai muuta validointikirjastoa halutaan myöhemmin käyttää domainin lähellä, siitä tehdään erillinen päätös.

### `packages/validation`

`packages/validation` sisältää syötteiden validointiskeemat.

Alustava teknologia:

- Zod

Validation-paketin vastuu:

- tarkistaa käyttäjän tai API:n syötteen muoto
- tarjota jaettavia validointiskeemoja
- tukea frontend- ja backend-validointia

Validation ei korvaa domain-sääntöjä.

### `packages/api-client`

`packages/api-client` sisältää frontendin hallitun yhteyden backend API:in.

Vastuu:

- piilottaa backend-reitit web-sovellukselta
- tarjota tyyppiturvallisia API-funktioita
- keskittää virheenkäsittelyn perusmalli
- lisätä myöhemmin auth-token kutsuihin

React-komponentit eivät saa tehdä raakaa `fetch`-kutsua suoraan, jos api-client-funktio on olemassa.

### `packages/auth`

`packages/auth` sisältää autentikointiin liittyvät rajapinnat ja adapterit.

Ensimmäisessä rungossa paketti voi sisältää vain rajapintojen suunnan.

Myöhemmin se voi sisältää:

- Firebase Auth wrapperin frontendille
- tokenin käsittelyn
- käyttäjäsession mallin
- auth-tilan muutosten seurannan

Firebase ei saa vuotaa satunnaisiin komponentteihin tai domainiin.

### `packages/permissions`

`packages/permissions` sisältää käyttöoikeuksiin liittyvät tyypit ja tarkistukset.

Vastuu:

- roolien ja permissionien tyypit
- käyttöoikeuksien apufunktiot
- frontendin käyttökokemusta tukevat tarkistukset
- backendin käyttöoikeustarkistusten yhteinen logiikka, jos soveltuu

Backend tekee lopulliset käyttöoikeuspäätökset.

### `packages/ui`

`packages/ui` sisältää uudelleenkäytettävät UI-komponentit.

Sallittua:

- `Button`
- `Input`
- `Select`
- `Textarea`
- `Card`
- `Modal`
- `Table`
- `FormField`
- `PageHeader`
- `EmptyState`

Kiellettyä:

- liiketoimintalogiikka
- API-kutsut
- Firebase-kutsut
- tietokantakutsut
- laskutuslogiikka
- asiakasmoduulin sisäiset säännöt

UI-paketti on esityskerros, ei domain-kerros.

### `packages/config`

`packages/config` sisältää yhteisiä konfiguraatiotyyppejä ja ympäristöasetusten lukemisen periaatteita.

Vastuu:

- ympäristöjen nimet
- konfiguraatiotyyppien määrittely
- turvallinen asetusten lukemisen malli

Salaisuuksia ei koskaan sijoiteta frontendin julkiseen konfiguraatioon.

## Moduuli ja kerros yhdessä

Liiketoimintakoodi järjestetään sekä kerroksen että moduulin mukaan.

Tämä estää sen, että `domain`, `validation` tai backendin moduulikansiot muuttuvat yhdeksi isoksi sekamassaksi.

Mahdollinen myöhempi rakenne:

```text
packages/domain/src/customers/
packages/domain/src/invoicing/

packages/validation/src/customers/
packages/validation/src/invoicing/

apps/backend/src/modules/customers/
apps/backend/src/modules/invoicing/

apps/web/src/features/customers/
apps/web/src/features/invoicing/
```

Ensimmäisessä skeleton-vaiheessa näitä moduulien sisäisiä toteutuksia ei tarvitse vielä luoda, ellei se ole välttämätöntä rungon ymmärtämisen kannalta.

## Repository-rajapinnat

Repository-rajapinnat määritellään lähellä käyttötapausta tai moduulia.

SQLite- ja PostgreSQL-toteutukset ovat adaptereita.

Domain ei tunne kumpaakaan tietokantaa.

Periaate:

```text
service
  -> repository interface
    -> SQLite adapter later
    -> PostgreSQL adapter later
```

Ensimmäisessä skeleton-vaiheessa repository-toteutuksia ei vielä rakenneta.

## Ensimmäinen local-first-linja

Ensimmäinen tekninen runko suunnitellaan local-first-periaatteella.

Tämä tarkoittaa:

- ohjelma voidaan kehittää paikallisesti
- myöhempi paikallisesti asennettava versio huomioidaan
- SQLite on paikallisen offline-version ensisijainen tietokantaprofiili
- PostgreSQL on pilviversion ensisijainen tietokantaprofiili
- domain ja service eivät riipu suoraan kummastakaan tietokannasta

Ensimmäisessä skeleton-vaiheessa SQLitea ei ole pakko vielä asentaa, jos sitä ei tarvita runkorakenteen luomiseen.

SQLite-kirjasto päätetään myöhemmin erikseen.

## Cloud-ready-linja

Vaikka ensimmäinen runko on local-first, sen pitää olla cloud-ready.

Tämä tarkoittaa:

- Firebase Auth voidaan liittää myöhemmin adapterin taakse
- backend voidaan viedä myöhemmin Cloud Runiin tai Cloud Functionsiin
- PostgreSQL voidaan ottaa käyttöön pilvessä
- local-cloud-sync voidaan suunnitella myöhemmin
- mikään domain-logiikka ei saa riippua paikallisesta tai pilvitietokannasta suoraan

## Ensimmäinen pystysuora pala myöhemmin

Ensimmäinen toiminnallinen pystysuora pala tehdään vasta skeleton-vaiheen jälkeen.

Alustava ensimmäinen pala:

```text
Customer create/list locally

web
  -> api-client
    -> backend
      -> service
        -> domain
          -> repository interface
            -> SQLite repository
```

Tämän tarkoitus on testata arkkitehtuuria, ei rakentaa koko asiakashallintaa.

## Turvallisuus skeleton-vaiheessa

Vaikka ensimmäisessä rungossa ei vielä ole oikeaa autentikointia, turvallisuus huomioidaan rakenteessa.

Säännöt:

- frontend ei kirjoita tietokantaan
- backend on luotettu kerros
- authille on oma rajattu paikka
- permissionsille on oma rajattu paikka
- config ei vuoda salaisuuksia frontendiin
- domain ei sisällä teknologia- tai palveluriippuvuuksia
- tuleva audit log huomioidaan moduulisuunnittelussa

## Mitä Codex saa tehdä skeleton-vaiheessa

Codex saa:

- luoda kansiorakenteen
- luoda `README.md`-tiedostot
- luoda `package.json`-tiedostot
- luoda `pnpm-workspace.yaml`-tiedoston
- luoda alustavat `tsconfig`-tiedostot
- lisätä tyhjät `src/index.ts`-tiedostot paketteihin tarvittaessa
- lisätä lyhyet kuvaukset pakettien vastuista

Codex ei saa:

- lisätä suuria ominaisuuksia
- lisätä tietokantatoteutusta
- lisätä Firebase-integraatiota
- lisätä laskutuslogiikkaa
- lisätä asiakashallinnan business-logiikkaa
- lisätä uusia kirjastoja ilman hyväksyntää
- tehdä arkkitehtuurimuutoksia ilman hyväksyntää

## Ensimmäisen skeleton-vaiheen hyväksymiskriteerit

Skeleton-vaihe on valmis, kun:

- monorepo-rakenne on luotu
- `pnpm` workspace on määritelty
- `apps/`- ja `packages/`-kansiot ovat olemassa
- jokaisella paketilla on selkeä vastuu
- `README.md`-tiedostot kuvaavat vastuut lyhyesti
- domain-paketti ei riipu ulkoisista teknologioista
- React on rajattu web-sovellukseen
- Firebasea ei ole levitetty sovellukseen
- tietokantakirjastoa ei ole sidottu domainiin
- koodi ja kansiot on nimetty englanniksi
- dokumentaatio pysyy suomeksi

## Avoimet päätökset ennen seuraavaa vaihetta

Ennen ensimmäistä toiminnallista customer-polkua pitää päättää:

- backend framework
- SQLite-kirjasto paikalliseen versioon
- DB-kirjasto, ORM tai query builder
- ensimmäinen repository-rajapintamalli
- ensimmäinen customer-domainin tietomalli
- ensimmäinen validointimalli
- local backendin ajotapa
- testien ensimmäinen minimimalli

## Liittyvät dokumentit

- `AGENTS.md`
- `docs/ai/workflow.md`
- `docs/architecture/base-architecture.md`
- `docs/architecture/dependency-policy.md`
- `docs/architecture/local-cloud-sync.md`
- `docs/architecture/module-boundaries.md`
- `docs/architecture/security-principles.md`
- `docs/decisions/ADR-0003-technical-foundation.md`
