# ADR-0005: Backend-frameworkin valinta

## Tila

Hyväksytty alustavasti.

## Päätös

Eky valitsee Honon ensimmäiseksi backendin HTTP-adapteriksi.

Honoa ei pidetä järjestelmän arkkitehtuurin ytimenä. Hono on ohut HTTP-framework, jonka tehtävä on vastaanottaa pyynnöt, ajaa middlewaret, kutsua application service -kerrosta ja palauttaa vastaukset.

Hono saa elää vain backendin HTTP-adapterikerroksessa.

## Tausta

ADR-0004 määrittelee, että Eky käyttää framework-ohutta backend-runtime-mallia.

Backendin pitkäikäinen ydin on:

- application services
- domain
- repository ports
- security rules
- audit rules

Frameworkin pitää tukea tätä mallia eikä sitoa domainia, service-logiikkaa tai repository-rajapintoja itseensä.

## Valintakriteerit

Backend-frameworkilta vaaditaan:

- hyvä TypeScript-tuki
- pieni riippuvuuspinta
- paikallinen Node-ajettavuus
- sopivuus myöhempään Cloud Run -ajoon
- selkeä middleware-malli authille, käyttöoikeuksille ja virheenkäsittelylle
- testattavuus
- kyky toimia ohuena HTTP-adapterina
- mahdollisuus pitää domain ja application services frameworkista irti
- ei tarpeetonta arkkitehtonista painolastia ensimmäiseen versioon

## Vaihtoehdot

### Hono

Hono on ensisijainen valinta.

Perustelut:

- kevyt
- moderni TypeScript-kokemus
- pieni riippuvuuspinta
- Web Standards / Fetch -pohjainen malli
- toimii Node.js-ajossa adapterin kautta
- sopii paikalliseen backend-rakenteeseen
- sopii myöhempään pilveen vietävään HTTP API -rakenteeseen
- kannustaa pitämään HTTP-kerroksen ohuena

Riskit:

- ekosysteemi on Expressiä nuorempi
- kaikki Node-keskeiset middlewaret eivät ole suoraan yhteensopivia
- jos backend kasvaa hyvin plugin-vetoiseksi, Fastify voi myöhemmin olla vahvempi vaihtoehto

### Fastify

Fastify jää varavaihtoehdoksi.

Fastify voi olla parempi, jos tarvitsemme myöhemmin:

- raskaampaa Node-palvelinmallia
- vahvaa plugin-rakennetta
- laajempaa sisäänrakennettua schema-pohjaista reittivalidointia
- enemmän valmiita Node-palvelinominaisuuksia

Fastify ei ole tässä vaiheessa ensisijainen, koska ensimmäinen backend tarvitsee kevyen HTTP-adapterin, ei raskasta server-framework-rakennetta.

### Express

Express ei ole ensisijainen valinta.

Express on tuttu ja laajasti käytetty, mutta uuteen TypeScript-pohjaiseen Eky-backendiin valitaan mieluummin modernimpi ja kevyempi HTTP-adapteri.

Express voidaan arvioida uudelleen vain, jos myöhemmin ilmenee konkreettinen tarve, jota Hono tai Fastify eivät ratkaise järkevästi.

## Rajaukset

Hono ei saa vuotaa seuraaviin kerroksiin:

- `packages/domain`
- application service -logiikka
- repository ports
- validoinnin domain-riippumaton ydin
- käyttöoikeuksien liiketoiminnallinen totuus
- tietokanta-adapterien rajapintasopimukset

Sallittu riippuvuussuunta on:

```text
apps/backend HTTP adapter
  -> application services
    -> domain
      -> repository ports
```

Kielletty riippuvuussuunta on:

```text
domain
  -> Hono

application services
  -> Hono request/response objects

repository ports
  -> Hono context
```

Application service -kerros saa vastaanottaa omia Eky-tyyppejä, ei frameworkin request- tai context-olioita.

## Turvallisuus

Hono ei ole turvallisuusmallin lähde.

Backendin pitää edelleen tarkistaa:

- autentikointi
- käyttöoikeudet
- yritysrajaus
- syötteen oikeellisuus
- domain-säännöt

Paikallinen backend kuuntelee oletuksena vain `127.0.0.1`-osoitteessa.

Cloud backend tarkistaa tuotantokäytössä Firebase ID tokenin auth-adapterin kautta.

Käyttöoikeuksissa noudatetaan deny by default -periaatetta.

## Seuraukset

Seuraavassa backend-toteutusvaiheessa voidaan lisätä `hono` riippuvuudeksi vain `apps/backend`-pakettiin.

Mahdolliset Hono Node -adapterit lisätään vain, jos paikallinen ajomalli niitä tarvitsee.

Hono-riippuvuutta ei lisätä rootiin, domainiin, validation-pakettiin, api-clientiin, auth-pakettiin, permissions-pakettiin, ui-pakettiin tai config-pakettiin.

Ensimmäisen backend-toteutuksen pitää olla pieni. Hyvä ensimmäinen pala on esimerkiksi health endpoint, joka todistaa, että:

- backend käynnistyy paikallisesti
- HTTP-adapteri toimii
- TypeScript build/typecheck toimii
- framework ei vuoda domainiin

Ensimmäisessä Hono-toteutuksessa ei vielä tehdä asiakashallintaa, laskutusta, tietokantaa, Firebase Authia, synkronointia tai audit logia.

## Ei päätetä tässä ADR:ssä

Tässä ADR:ssä ei vielä päätetä:

- Honon tarkkaa versiota
- Node-adapterin tarkkaa pakettia
- backendin lopullista kansiorakennetta
- SQLite-kirjastoa
- ORM- tai query builder -ratkaisua
- Zod-validoinnin ensimmäistä toteutusta
- Firebase Admin SDK:n käyttöönottoa
- Cloud Run -deploy-rakennetta

## Liittyvät dokumentit

- `AGENTS.md`
- `docs/architecture/base-architecture.md`
- `docs/architecture/dependency-policy.md`
- `docs/architecture/security-principles.md`
- `docs/decisions/ADR-0003-technical-foundation.md`
- `docs/decisions/ADR-0004-local-backend-runtime.md`
