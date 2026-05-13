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
- sama backend-logiikka toimii lokaalisti ja pilvessä mahdollisuuksien mukaan
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
- `packages/utils`

Tarkka rakenne voi muuttua projektin edetessä, mutta kerrosajattelu säilyy.

## Modulaarinen monoliitti

Ensimmäisessä vaiheessa järjestelmä rakennetaan modulaarisena monoliittina.

Tämä tarkoittaa:

- yksi hallittava backend-kokonaisuus
- selkeät sisäiset moduulit
- yksi pääasiallinen tietokanta
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

PostgreSQL on suunniteltu ERP-liiketoimintadatan ensisijaiseksi tietokannaksi.

Kehityksessä voidaan käyttää paikallista PostgreSQL-kantaa.

Pilvessä käytetään myöhemmin hallittua PostgreSQL-ratkaisua, esimerkiksi Firebase SQL / Cloud SQL -tyyppistä ratkaisua.

## Firebase

Firebaseä voidaan käyttää:

- autentikointiin
- hostingiin
- mahdollisiin Cloud Function / Cloud Run -reitityksiin
- tiedostojen tallennukseen
- mahdolliseen SQL-pohjaiseen pilvitietokantaan

Firebase ei saa vuotaa kaikkialle koodiin, vaan se eristetään omien adapterien ja wrapperien taakse.

## Local ja cloud

Sama backend-logiikka pyritään pitämään käytettävissä lokaalisti ja pilvessä.

Local development:

- web local
- backend local
- PostgreSQL local
- tarvittaessa Firebase emulator tai dev-auth

Cloud:

- Firebase Hosting
- Cloud Run / Cloud Functions
- Firebase Auth
- hallittu PostgreSQL

Frontend puhuu aina backendille, ei suoraan tietokannalle.

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
- Miten laaja local production -käyttö halutaan myöhemmin?
- Miten mobiilin synkronointimalli toteutetaan?