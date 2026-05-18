# ADR-0003: Tekninen perusta ensimmäiselle versiolle

## Tila

Hyväksytty alustavasti.

## Päätös

Eky-projektin ensimmäisen version tekninen perusta rakennetaan modulaarisen monoliitin pohjalle.

Tavoitteena on luoda turvallinen, ylläpidettävä ja laajennettava perusrakenne, jossa teknologiat pysyvät rajattuina omiin kerroksiinsa.

Tämä ADR ei lukitse kaikkia yksityiskohtaisia työkalupäätöksiä. Se lukitsee teknisen suunnan, jonka pohjalta ensimmäinen runko voidaan suunnitella.

## Päätetyt valinnat

### Package manager

Projektissa käytetään `pnpm`-paketinhallintaa.

Perustelut:

- sopii monorepo-rakenteeseen
- hallitsee riippuvuuksia tehokkaasti
- tukee workspaces-rakennetta
- vähentää turhaa riippuvuuksien monistumista

### Repo-malli

Projektissa käytetään monorepo-rakennetta.

Alustava rakenne:

```text
apps/
  web/
  backend/

packages/
  domain/
  validation/
  api-client/
  auth/
  permissions/
  ui/
  config/
```

`packages/utils` voidaan lisätä vain, jos sille määritellään tarkka vastuu. Yleistä kaatopaikkaa apufunktioille ei luoda.

### Web

Ensimmäinen web-käyttöliittymä rakennetaan seuraavilla teknologioilla:

- React
- Vite
- TypeScript

React pidetään vain web-käyttöliittymän kerroksessa. React ei saa vuotaa domain-logiikkaan, validointikerrokseen, backend-palveluihin tai moduulien liiketoimintasääntöihin.

### Backend

Backend toteutetaan TypeScriptillä.

Backend toimii luotettuna palvelukerroksena, joka tarkistaa:

- autentikoinnin
- käyttöoikeudet
- yritysrajauksen
- syötteen oikeellisuuden
- domain-säännöt

Backend framework päätetään erikseen ennen ensimmäisen backend-rungon toteutusta.

### Tietokantaprofiilit

Eky käyttää relaatiopohjaista tietomallia ydindatalle.

Paikallisesti asennettavassa offline-versiossa ensisijainen tietokanta on SQLite, koska se toimii ilman erillistä tietokantapalvelinta ja voidaan toimittaa ohjelman mukana.

Pilviversiossa ensisijainen tietokanta on PostgreSQL, koska se sopii moniyritys-, palvelin- ja raportointikäyttöön.

Mobiiliversion offline-first-tallennus suunnitellaan myöhemmin Androidin Room/SQLite-linjan pohjalta.

Relaatiomalli valitaan, koska järjestelmän data sisältää paljon yhteyksiä, kuten:

- yritykset
- käyttäjät
- asiakkaat
- kohteet
- laskut
- laskurivit
- työmääräykset
- kirjaukset

Domain- ja service-kerrokset eivät saa riippua suoraan SQLitestä, PostgreSQL:stä, Roomista tai tietystä tietokantakirjastosta.

Tietokantakohtaiset toteutukset eristetään repository-adaptereihin.

Tietokantakirjasto, ORM tai query builder päätetään erikseen ennen pysyvän tietomallin toteutusta.

### Auth

Autentikoinnin alustava ratkaisu on Firebase Auth.

Firebase Auth eristetään oman auth-kerroksen tai adapterin taakse.

Muu sovellus ei saa sisältää suoria Firebase-riippuvuuksia satunnaisissa komponenteissa, serviceissä tai domain-logiikassa.

### Validointi

Validoinnin alustava ratkaisu on Zod.

Zod kuuluu validation-kerrokseen.

Validointi ei korvaa domain-sääntöjä. Domain-säännöt ovat järjestelmän liiketoiminnallinen totuus.

### Testaus

Testauksen alustava ratkaisu on Vitest.

Testaamisen ensisijainen painopiste on:

- domain-logiikka
- laskenta
- rahasummat
- laskutuksen tilasiirtymät
- käyttöoikeudet
- validointi
- kriittiset työnkulut

### Local development

Ensimmäinen kehitysympäristö toimii paikallisesti.

Paikallisessa kehityksessä ajetaan alustavasti:

- web
- backend
- paikallinen tietokanta

Tarvittaessa voidaan käyttää Firebase-emulaattoreita tai kehityskäyttöön rajattua auth-ratkaisua.

Local development ja paikallisesti asennettava offline-tuotantokäyttö ovat eri asioita.

Tekninen runko suunnitellaan kuitenkin niin, että paikallisesti asennettava versio voidaan rakentaa myöhemmin ilman arkkitehtuurin uudelleenkirjoitusta.

### Paikallinen offline-versio

Eky suunnitellaan paikallisesti toimivaksi ja pilveen laajennettavaksi ERP-järjestelmäksi.

Paikallinen versio voi toimia ilman internetyhteyttä.

Alustava paikallinen malli:

- paikallinen käyttöliittymä
- paikallinen backend tai service layer
- paikallinen SQLite-tietokanta
- paikallinen audit log
- myöhemmin synkronointijono pilveä varten

Paikallinen versio ei saa tarkoittaa sitä, että React-käyttöliittymä kirjoittaa suoraan tietokantaan. Sama kerrosajattelu säilyy myös offline-versiossa.

### Pilvi myöhemmin

Pilviympäristön alustava suunta:

- Firebase Hosting webille
- Cloud Run tai Cloud Functions backendille
- Firebase Auth tunnistautumiseen
- Firebase SQL / SQL Connect tai Cloud SQL PostgreSQL tietokannalle

Tarkka pilviajotapa päätetään myöhemmin erillisellä päätöksellä.

### Käyttötilat

Ekyllä voi myöhemmin olla kolme käyttötilaa:

1. Offline local mode: ohjelma toimii omalla koneella ilman pilviyhteyttä.
2. Cloud connected mode: paikallinen ohjelma on yhdistetty pilveen ja synkronoi dataa hallitun rajapinnan kautta.
3. Multi-device mode: yritysdataa käytetään useasta käyttöliittymästä, kuten webistä, paikallisesta ohjelmasta ja mobiilisovelluksesta.

Synkronointi ei saa olla raakaa tietokantakopiointia. Pilveen vietävä data kulkee myöhemmin sync-kerroksen ja cloud backendin tarkistusten kautta.

### Arkkitehtuuri

Järjestelmän arkkitehtuuri on modulaarinen monoliitti.

Tavoitteena ei ole rakentaa mikropalveluita ensimmäisessä vaiheessa.

Moduulit pidetään kuitenkin niin selkeinä, että niitä voidaan myöhemmin irrottaa erillisiksi palveluiksi, jos siihen syntyy todellinen tarve.

### Turvallisuus

Backend tarkistaa aina:

- kuka käyttäjä on
- mihin yritykseen käyttäjä kuuluu
- mitä käyttäjä saa tehdä
- mihin yritykseen data kuuluu
- onko syöte sallittu ja validi

Frontend voi parantaa käyttökokemusta, mutta frontend ei ole turvallisuuden lähde.

Käyttöoikeuksien oletusmalli on deny by default. Tarkemmat säännöt määritellään dokumentissa `docs/architecture/security-principles.md`.

## Teknologioiden eristäminen

Teknologiavalinnat eivät saa vuotaa väärään kerrokseen.

Tärkeät säännöt:

- React ei saa vuotaa domainiin.
- Firebase ei saa vuotaa UI-komponentteihin tai domainiin.
- SQLite, PostgreSQL, Room tai tietokantakirjasto ei saa vuotaa domainiin.
- Zod ei saa korvata domain-sääntöjä.
- Backend framework ei saa määrittää liiketoimintalogiikan rakennetta.
- Tietokantakirjasto ei saa määrittää domain-mallia.

Ulkoiset palvelut ja kirjastot käytetään projektin omien rajapintojen, porttien tai adapterien kautta silloin, kun vaihtamisen hallinta on projektin kannalta olennaista.

Esimerkkejä rajattavista kohdista:

- auth
- token verification
- repositories
- database access
- file storage
- email sending
- PDF generation
- external integrations
- AI-agent entrypoints

## Avoimeksi jätetyt päätökset

Seuraavia asioita ei lukita tässä ADR:ssa:

- backend framework: Express, Fastify, Hono tai muu
- ORM/query builder: Prisma, Drizzle, Kysely, node-postgres tai muu
- Cloud Run vs Cloud Functions
- Firebase SQL Connect vs suora Cloud SQL PostgreSQL
- SQLite-kirjasto paikalliseen versioon
- paikallisen ohjelman paketointi: selainpohjainen local app, Tauri, Electron tai muu
- local-cloud-synkronoinnin tarkka malli
- konfliktien ratkaisu synkronoinnissa
- UI-komponenttikirjasto
- PDF-laskujen generointi
- sähköposti- tai verkkolaskuratkaisu
- lokitus- ja audit-ratkaisu

Nämä päätökset tehdään erikseen, kun niiden vaatimukset ovat riittävän selvät.

## Valintakriteerit avoimille päätöksille

### Backend framework

Backend frameworkin valinnan pitää tukea:

- paikallista ajamista
- pilveen vientiä
- TypeScriptiä
- selkeää middleware-rakennetta
- auth-tokenin tarkistusta
- käyttöoikeustarkistuksia
- virheenkäsittelyä
- testattavuutta
- modulaarista monoliittia

### ORM tai query builder

Tietokantakirjaston valinnan pitää tukea:

- valittua paikallista tietokantaa
- valittua pilvitietokantaa
- migraatioita
- testattavuutta
- selkeää repository-kerrosta
- transaktioita
- auditointia
- yritysrajausta
- hallittua vaihtamista myöhemmin

### UI-komponenttiratkaisu

UI-komponenttiratkaisun valinnan pitää tukea:

- saavutettavuutta
- ylläpidettävyyttä
- selkeää visuaalista yhtenäisyyttä
- lomakkeita
- taulukoita
- hallintapaneelityyppistä käyttöä
- rajattua riippuvuutta web-kerrokseen

## Seuraukset

Tämän päätöksen jälkeen ensimmäinen tekninen runko voidaan suunnitella seuraavien periaatteiden mukaan:

- monorepo luodaan `apps/`- ja `packages/`-jaolla
- web ja backend erotetaan toisistaan
- domain pidetään puhtaana ulkoisista teknologioista
- auth, tietokannat ja muut ulkoiset palvelut eristetään adapterien taakse
- ensimmäinen MVP rakennetaan pienenä pystysuorana palana
- paikallinen offline-käyttö ja pilvikäyttö huomioidaan arkkitehtuurissa alusta asti
- turvallisuus ja yritysrajaus huomioidaan alusta asti

Ensimmäinen toteutus ei saa muuttua koko ERP:n rakentamiseksi kerralla.

Tavoitteena on luoda pieni mutta oikeansuuntainen perusta, jonka päälle voidaan turvallisesti kasvattaa asiakashallinta, laskutus, mobiiliominaisuudet, integraatiot ja AI-agentit.

Ensimmäisessä toteutuksessa ei tarvitse rakentaa synkronointia valmiiksi, mutta tietomalli ja kerrosrakenne eivät saa estää sitä myöhemmin.

## Liittyvät dokumentit

- `AGENTS.md`
- `docs/architecture/base-architecture.md`
- `docs/architecture/dependency-policy.md`
- `docs/architecture/local-cloud-sync.md`
- `docs/architecture/security-principles.md`
- `docs/architecture/tech-decisions.md`
- `docs/decisions/ADR-0001-modular-monolith-first.md`
- `docs/decisions/ADR-0002-module-structure.md`
