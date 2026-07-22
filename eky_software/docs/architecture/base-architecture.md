# Eky Base -perusarkkitehtuuri

Tämä dokumentti kuvaa Eky-järjestelmän perusarkkitehtuurin.

Tavoitteena on rakentaa turvallinen, modulaarinen ja laajennettava ERP-pohja, jonka ensimmäinen käyttötapaus on asiakaskortisto ja laskutus.

## Arkkitehtuurin päätavoite

Eky Base ei ole yksittäinen laskutusohjelma.

Eky Base on järjestelmän perusta, jonka päälle voidaan rakentaa:

- web-käyttöliittymä
- backend-palvelut
- tietokanta
- mobiilisovellus
- raportointi
- integraatiot
- AI-agentit

## Pääperiaatteet

- turvallisuus ensin
- modulaarinen monoliitti
- selkeät moduulirajat
- backend tarkistaa käyttöoikeudet
- frontend ei puhu suoraan tietokannalle
- domain-logiikka pidetään puhtaana
- ulkoiset riippuvuudet eristetään
- Eky toimii paikallisesti ja on laajennettavissa pilveen
- sama domain- ja service-logiikka pyritään pitämään käytettävissä paikallisessa ja pilviversiossa
- järjestelmä suunnitellaan tenant-valmiiksi useampaa yritystä varten

## Korkean tason rakenne

Alustava rakenne:

- `apps/web`
- `apps/backend`
- `packages/domain`
- `packages/validation`
- `packages/api-client`
- `packages/auth`
- `packages/permissions`
- `packages/ui`
- `packages/config`

Tarkka rakenne voi muuttua projektin edetessä, mutta kerrosajattelu säilyy.

`packages/utils` ei kuulu ensimmäiseen skeleton-rakenteeseen. Se voidaan lisätä myöhemmin vain erillisellä päätöksellä ja tarkasti rajatulla vastuulla.

## Modulaarinen monoliitti

Ensimmäisessä vaiheessa järjestelmä rakennetaan modulaarisena monoliittina.

Tämä tarkoittaa:

- yksi hallittava backend-kokonaisuus
- selkeät sisäiset moduulit
- selkeät tietokantaprofiilit paikalliseen ja pilvikäyttöön
- moduulien väliset rajat dokumentoidaan
- moduuleja voidaan myöhemmin irrottaa erillisiksi palveluiksi, jos siihen tulee todellinen tarve

Mikropalveluita ei rakenneta ensimmäisessä vaiheessa.

## Frontend

Ensimmäinen web-käyttöliittymä rakennetaan Reactilla ja TypeScriptillä.

Frontendin tehtävä:

- näyttää dataa
- kerätä käyttäjän syötteet
- näyttää validointivirheitä
- kutsua api-client-kerrosta
- parantaa käyttökokemusta

Frontend ei omista liiketoimintasääntöjä eikä turvallisuutta.

Ensimmäinen rajattu web customer UI -pala on kuvattu dokumentissa `docs/architecture/web-customer-ui-plan.md`.

Sen tarkoitus on todistaa ketju `React UI -> packages/api-client -> backend HTTP API -> customer application/domain -> SQLite`, ei rakentaa koko frontend-sovellusta valmiiksi.

## Backend

Backend toimii järjestelmän luotettuna palvelukerroksena.

Backendin tehtävä:

- tarkistaa autentikointi
- tarkistaa käyttöoikeudet
- validoida syöte
- suorittaa domain-säännöt
- hallita tietokantayhteydet
- luoda audit log -merkinnät
- tarjota rajapinta webille, mobiilille ja tuleville AI-agenteille

## Tietokanta

Eky käyttää relaatiopohjaista tietomallia ydindatalle.

Paikallisesti asennettavassa offline-versiossa ensisijainen tietokanta on SQLite.

Pilviversiossa ensisijainen tietokanta on PostgreSQL, esimerkiksi Firebase SQL / SQL Connect tai Cloud SQL PostgreSQL.

Mobiiliversiossa offline-first-tallennus suunnitellaan myöhemmin Room/SQLite-linjan pohjalta.

Domain- ja service-kerrokset eivät saa riippua suoraan SQLitestä, PostgreSQL:stä tai Roomista. Tietokantakohtaiset toteutukset eristetään repository-adaptereihin.

## Firebase

Firebaseä voidaan käyttää:

- autentikointiin
- hostingiin
- mahdollisiin Cloud Function / Cloud Run -reitityksiin
- tiedostojen tallennukseen
- mahdolliseen SQL-pohjaiseen pilvitietokantaan

Firebase ei saa vuotaa kaikkialle koodiin, vaan se eristetään omien adapterien ja wrapperien taakse.

## Local ja cloud

Eky ei ole vain pilviohjelma, jolla on paikallinen kehitysympäristö.

Eky on paikallisesti toimiva ja pilveen laajennettava ERP-järjestelmä.

Local development:

- web local
- backend local
- paikallinen tietokanta
- tarvittaessa Firebase emulator tai dev-auth

Local installed edition:

- paikallinen käyttöliittymä
- paikallinen backend tai service layer
- SQLite-tietokanta
- paikallinen audit log
- myöhemmin synkronointijono pilveen

Cloud:

- Firebase Hosting
- Cloud Run / Cloud Functions
- Firebase Auth
- hallittu PostgreSQL

Frontend puhuu aina backendille, ei suoraan tietokannalle.

Synkronointi ei saa perustua raakakopioon paikallisesta tietokannasta pilveen. Pilveen vietävät muutokset kulkevat myöhemmin sync-kerroksen ja cloud backendin validointi-, käyttöoikeus- ja auditointisääntöjen läpi.

## Ensimmäinen pystysuora pala

Ensimmäinen suunniteltu toiminnallinen pystysuora pala on Customer create/list local.

Sen rajaus on kuvattu dokumentissa `docs/architecture/customer-vertical-slice-plan.md`.

Tämän palan tarkoitus on todistaa arkkitehtuurin ensimmäinen oikea local-first dataflow, ei rakentaa koko asiakashallintamoduulia valmiiksi.

## Mobiili myöhemmin

Mobiilisovellus rakennetaan myöhemmässä vaiheessa.

Todennäköinen linja:

- Kotlin
- Jetpack Compose
- Room
- offline-first
- synkronointi backendin kanssa

Mobiili voi tallentaa paikallisia pending-kirjauksia, mutta backend tekee lopulliset käyttöoikeus- ja liiketoimintasääntöpäätökset.

## AI-agentit myöhemmin

Tulevat AI-agentit käyttävät samoja backend-palveluita kuin käyttöliittymät.

AI-agentit eivät saa:

- kirjoittaa suoraan tietokantaan
- ohittaa käyttöoikeuksia
- ohittaa domain-sääntöjä
- ohittaa audit logia

## Request flow

Perusvirta:

1. käyttäjä toimii frontendissä
2. frontend kutsuu api-clientiä
3. api-client kutsuu backend API:a
4. backend tarkistaa autentikoinnin
5. backend tarkistaa oikeudet
6. backend validoi syötteen
7. backend service suorittaa käyttötapauksen
8. domain-säännöt tarkistetaan
9. repository lukee tai kirjoittaa tietokantaan
10. audit log kirjataan tarvittaessa
11. vastaus palautetaan frontendille

## Avoimet kysymykset

- Lopullinen backend-ajotapa pilvessä: Cloud Run vai Cloud Functions?
- Käytetäänkö Firebase SQL Connectia vai suoraa Cloud SQL -yhteyttä?
- Electron on valittu local-MVP:n paketointisuunnaksi ADR-0007:ssä; tarkka
  versio, paketointityökalu ja Windows-jakelupolku päätetään toteutusvaiheessa.
- Miten mobiilin synkronointimalli toteutetaan?
- Miten local-cloud-synkronoinnin konfliktit ratkaistaan?

Uuden liiketoimintamoduulin toteutus aloitetaan dokumentin
`docs/architecture/new-module-implementation-checklist.md` avulla. Checklist
ei muuta tämän dokumentin riippuvuussuuntaa tai moduulien omistajuutta.
