# ADR-0004: Paikallinen backend-runtime ja pilvivalmis backend-ydin

## Tila

Hyväksytty alustavasti.

## Päätös

Eky käyttää framework-ohutta backend-runtime-mallia.

Backend-framework ei ole järjestelmän liiketoiminnallinen ydin. Frameworkin tehtävä on vastaanottaa pyyntö, ajaa tarvittavat middlewaret, muuntaa pyyntö application service -kutsuksi ja palauttaa vastaus.

Järjestelmän pitkäikäinen ydin on:

- application services
- domain
- repository ports
- security rules
- audit rules

Paikallinen ja pilvessä ajettava backend käyttävät samaa backend-ydintä aina kun se on käytännöllistä.

## Tavoiteltu rakenne

Backend suunnitellaan näin:

```text
UI
  -> api-client
    -> HTTP backend adapter
      -> application services
        -> domain
          -> repository ports
            -> database adapters
```

Paikallisessa offline-versiossa alustava malli on:

```text
local UI
  -> local Node backend
    -> application services
      -> domain
        -> repository ports
          -> SQLite adapter
```

Pilviversiossa alustava malli on:

```text
Firebase Hosting
  -> Cloud Run backend
    -> application services
      -> domain
        -> repository ports
          -> PostgreSQL adapter
```

Tämä tarkoittaa, että Ekyllä ei ole kahta erillistä liiketoimintabackendiä. Ekyllä on jaettava backend-ydin, jonka ympärille voidaan rakentaa paikallinen runtime-adapteri ja pilviruntime-adapteri.

## Paikallinen backend

Paikallisessa versiossa `apps/backend` toimii alustavasti paikallisena Node/TypeScript-backendinä.

Paikallinen backend voi myöhemmin olla:

- käyttäjän käynnistämä local backend -prosessi
- paikallisen desktop shellin käynnistämä backend-prosessi
- osa paikallista paketoitua sovellusta

Tätä paketointimallia ei päätetä tässä ADR:ssä.

Paikallinen backend ei saa tarkoittaa sitä, että käyttöliittymä kirjoittaa suoraan SQLite-tietokantaan.

## Pilvibackend

Pilvessä pitkäikäisen HTTP API:n ensisijainen alustava suunta on Cloud Run.

Firebase toimii alustavasti seuraavissa rooleissa:

- Firebase Auth käyttäjän tunnistamiseen
- Firebase Hosting web-käyttöliittymän julkaisuun
- mahdollinen reititys Cloud Run -backendiin
- mahdolliset Cloud Functions -taustatyöt myöhemmässä vaiheessa

Cloud Functions voi myöhemmin sopia taustatehtäviin, kuten:

- ajastetut työt
- tiedostojen käsittely
- ilmoitukset
- integraatiot
- AI-taustatehtävät
- synkronoinnin apuprosessit

Cloud Functions ei ole tässä vaiheessa ensisijainen paikka koko liiketoiminnalliselle backend API:lle.

## Backend-frameworkin rooli

Backend-framework on HTTP-adapteri, ei arkkitehtuurin omistaja.

Framework saa sisältää:

- reitit
- middlewaret
- request/response-muunnokset
- virhevasteiden perusmuodon
- paikallisen HTTP-palvelimen käynnistyksen

Framework ei saa sisältää tai omistaa:

- domain-sääntöjä
- laskutuslogiikkaa
- asiakasmoduulin liiketoimintasääntöjä
- käyttöoikeuksien lopullista totuutta
- tietokantamallia
- repository-rajapintojen sopimuksia
- synkronoinnin liiketoimintasääntöjä

## Alustava framework-suunta

Backend-frameworkia ei vielä asenneta tässä ADR:ssä.

Alustava suositus ensimmäiseksi HTTP-adapteriehdokkaaksi on Hono.

Perustelut:

- kevyt riippuvuuspinta
- moderni TypeScript-kokemus
- sopii ohueksi HTTP-adapteriksi
- Web Standards / Fetch -pohjainen ajattelu
- toimii Node.js-ajossa adapterin kautta
- sopii paikalliseen ja pilveen vietävään HTTP API -malliin

Fastify on varavaihtoehto, jos tarvitsemme myöhemmin raskaampaa Node-palvelinmallia, vahvaa plugin-rakennetta tai laajempaa sisäänrakennettua schema-pohjaista reittivalidointia.

Express ei ole ensisijainen valinta uuteen TypeScript-pohjaiseen Eky-backendiin. Express voidaan arvioida uudelleen vain, jos jokin konkreettinen tarve tekee siitä perustellun.

Lopullinen framework-valinta tehdään ennen ensimmäistä HTTP-backend-toteutusta.

## Turvallisuussäännöt

Paikallinen backend kuuntelee oletuksena vain `127.0.0.1`-osoitteessa.

Käyttöliittymä ei koskaan kirjoita suoraan SQLite-tietokantaan.

Pilvibackend tarkistaa aina Firebase ID tokenin, kun tuotantokäytössä oleva pilviauth on käytössä.

Backend tarkistaa aina:

- autentikoinnin
- käyttöoikeudet
- yritysrajauksen
- syötteen oikeellisuuden
- domain-säännöt

Backendin käyttöoikeuksissa noudatetaan deny by default -periaatetta.

Firebase ei saa vuotaa domainiin tai application service -logiikkaan.

Domain ei saa riippua:

- HTTP:stä
- Hono/Fastify/Express-frameworkista
- Firebasesta
- SQLitestä
- PostgreSQL:stä
- Cloud Runista
- Cloud Functionsista

Synkronointi ei saa kopioida raakaa SQLite-tiedostoa pilveen. Pilveen menevä data kulkee myöhemmin sync-kerroksen, cloud backendin validoinnin, käyttöoikeustarkistusten ja auditoinnin kautta.

## Seuraukset

Tämä päätös pitää paikallisen ja pilvessä ajettavan backendin samassa arkkitehtuurimallissa.

Tämä tukee:

- local-first-käyttöä
- cloud-ready-laajennusta
- modulaarista monoliittia
- backendin turvallisuusvastuuta
- frameworkin myöhempää vaihtamista
- SQLite- ja PostgreSQL-adapterien eristämistä
- mobiilisovelluksen myöhempää liittämistä
- AI-agenttien hallittuja entrypointteja

Ensimmäisen toiminnallisen backend-palan pitää käyttää samaa mallia. Reitti saa olla pieni, mutta sen pitää kulkea framework-adapterin kautta application serviceen eikä ohittaa kerroksia.

## Ei päätetä tässä ADR:ssä

Tässä ADR:ssä ei vielä päätetä:

- lopullista backend-frameworkia
- backend-frameworkin versiota
- SQLite-kirjastoa
- ORM- tai query builder -ratkaisua
- Cloud Runin ja Cloud Functionsien lopullista työnjakoa
- paikallisen ohjelman paketointia
- auth-tokenin teknistä tarkistustoteutusta
- audit login tarkkaa rakennetta
- local-cloud-synkronoinnin tarkkaa toteutusta

## Liittyvät dokumentit

- `AGENTS.md`
- `docs/architecture/base-architecture.md`
- `docs/architecture/dependency-policy.md`
- `docs/architecture/local-cloud-sync.md`
- `docs/architecture/security-principles.md`
- `docs/architecture/tech-decisions.md`
- `docs/decisions/ADR-0003-technical-foundation.md`
- `docs/decisions/ADR-0005-backend-framework-selection.md`
- `docs/decisions/ADR-0006-local-database-and-query-layer.md`
