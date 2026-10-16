# Local-cloud-synkronointi

Tämä dokumentti kuvaa Eky-järjestelmän paikallisen offline-käytön, pilvikäytön ja myöhemmän synkronoinnin arkkitehtuuriperiaatteet.

Tarkkaa synkronointitoteutusta ei päätetä vielä tässä vaiheessa.

## Perusajatus

Eky on paikallisesti toimiva ja pilveen laajennettava ERP-järjestelmä.

Järjestelmän pitää voida toimia ensin omalla koneella ilman jatkuvaa internetyhteyttä.

Myöhemmin käyttäjä voi ottaa käyttöön pilvipalvelut, mobiilisovelluksen ja usean laitteen käytön.

## Käyttötilat

### Offline local mode

Ohjelma toimii paikallisesti ilman pilviyhteyttä.

Alustava malli:

- paikallinen käyttöliittymä
- paikallinen backend tai service layer
- paikallinen SQLite-tietokanta
- paikallinen audit log

### Cloud connected mode

Paikallinen ohjelma on yhdistetty pilveen.

Muutokset synkronoidaan myöhemmin pilveen hallitun rajapinnan kautta.

Cloud backend tarkistaa:

- autentikoinnin
- käyttöoikeudet
- yritysrajauksen
- validoinnin
- domain-säännöt
- auditoinnin

### Multi-device mode

Samaa yritysdataa voidaan myöhemmin käyttää useasta käyttöliittymästä:

- paikallinen ohjelma
- web-käyttöliittymä
- mobiilisovellus
- mahdolliset AI-agentit

## Tietokantaprofiilit

Paikallinen asennettava versio:

- SQLite

Pilviversio:

- PostgreSQL

Mobiili myöhemmin:

- Room / SQLite

Domain- ja service-kerrokset eivät saa riippua suoraan näistä tietokannoista.

Tietokantakohtaiset yksityiskohdat eristetään repository-adaptereihin.

## Synkronoinnin periaate

Synkronointi ei saa olla raakaa tietokantatiedoston kopiointia pilveen.

Parempi periaate:

```text
local change log
  -> sync engine
    -> cloud API
      -> backend validation
        -> cloud database
```

Pilveen päätyvä data kulkee aina backendin sääntöjen läpi.

## Suunnittelussa huomioitavia asioita

Synkronointia varten voidaan myöhemmin tarvita esimerkiksi:

- pysyvät tekniset ID:t
- `companyId`
- `createdAt`
- `updatedAt`
- `deletedAt`
- `version`
- `sourceDeviceId`
- `syncStatus`
- `lastSyncedAt`
- paikallinen change log
- konfliktien käsittely

Kaikkia näitä ei lisätä kaikkiin tietomalleihin automaattisesti. Tarve päätetään moduulikohtaisesti.

## Turvallisuus

Offline-versio voi käyttää paikallista dataa ilman pilveä.

Kun data synkronoidaan pilveen, cloud backend tarkistaa oikeudet ja liiketoimintasäännöt uudelleen.

AI-agentit, mobiilisovellukset ja paikallinen ohjelma eivät saa ohittaa samoja sääntöjä, joita web-käyttöliittymä noudattaa.

## Paikallisen toteutuksen omistajat

Paikallisen paketoinnin omistavat
[ADR-0007](../decisions/ADR-0007-local-desktop-shell-and-session-bootstrap.md)
ja [ADR-0010](../decisions/ADR-0010-windows-installer-and-update-orchestration.md).
SQLite-tiedoston sijainnin ja avauspolitiikan omistavat
[tietokantasopimus](local-database-implementation-plan.md) ja
[workspace-suunnitelma](local-company-workspace-plan.md). Paikallisen
varmuuskopioinnin omistaa
[backup/restore-sopimus](local-backup-and-restore-plan.md).
Nämä eivät enää ole synkronointisuunnitelman avoimia teknologiavalintoja.

## Avoimet kysymykset

- Miten local-cloud-synkronoinnin change log toteutetaan?
- Miten konfliktit ratkaistaan?
- Miten laskunumerointi toimii offline- ja cloud-tilassa?
- Mitkä moduulit synkronoidaan ensimmäisenä?

