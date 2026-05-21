# Teknologiapäätökset

Tämä dokumentti kokoaa Eky-projektin teknologiapäätökset ja niiden perustelut.

Merkittävät päätökset voidaan myöhemmin siirtää tai täydentää ADR-dokumenteiksi.

## Päätös: VS Code + Codex

Päätös:

Projektissa käytetään ensisijaisesti VS Codea ja Codex-lisäosaa.

Perustelu:

- työkalu on jo käytössä
- projektin pitää olla editoririippumaton
- ohjeistus tehdään `AGENTS.md`- ja `docs/`-rakenteella
- Cursor voidaan arvioida myöhemmin, mutta ei ole lähtöriippuvuus

## Päätös: TypeScript webissä ja backendissä

Päätös:

Web ja backend toteutetaan alustavasti TypeScriptillä.

Perustelu:

- sama kieli web- ja backend-puolella
- hyvä tuki AI-koodaukselle
- vahva ekosysteemi
- tyyppiturva auttaa ylläpidossa

## Päätös: React + Vite webiin

Päätös:

Ensimmäinen web-käyttöliittymä toteutetaan Reactilla ja Vite-pohjalla.

Perustelu:

- kypsä ekosysteemi
- hyvä työkalutuki
- nopea kehitys
- sopii hallintapaneeliin ja laskutusnäkymiin

## Päätös: relaatiotietokanta ydindatalle

Päätös:

ERP-liiketoimintadata mallinnetaan relaatiopohjaisesti.

Paikallisesti asennettavassa offline-versiossa ensisijainen tietokanta on SQLite.

Pilviversiossa ensisijainen tietokanta on PostgreSQL.

Perustelu:

- asiakas, kohde, työ, kirjaus ja lasku muodostavat relaatioita
- laskutus vaatii eheyttä ja raportoitavuutta
- SQLite sopii paikalliseen asennettavaan offline-versioon ilman erillistä tietokantapalvelinta
- PostgreSQL sopii pilvi-, moniyritys- ja raportointikäyttöön
- domain- ja service-kerrokset voidaan pitää tietokannoista riippumattomina repository-adapterien avulla

## Päätös: Kysely + better-sqlite3 paikalliseen backend-tietokanta-adapteriin

Päätös:

Ensimmäisessä paikallisessa backend-tietokantatoteutuksessa käytetään Kyselyä query builderina ja better-sqlite3-kirjastoa Node-yhteensopivana SQLite-ajurina.

Nämä riippuvuudet lisätään vain `apps/backend`-pakettiin.

Perustelu:

- Kysely tukee TypeScript-tyyppiturvallista SQL query builder -mallia
- Kysely ei ole raskas ORM
- SQL-ajattelu säilyy näkyvissä
- better-sqlite3 sopii paikalliseen Node + SQLite -käyttöön
- riippuvuudet voidaan eristää backendin database/infrastructure-adapterikerrokseen
- domain, application services ja repository portit voidaan pitää irti tietokantakirjastojen tyypeistä

## Päätös: Firebase tukipalveluihin

Päätös:

Firebaseä käytetään alustavasti autentikointiin, hostingiin ja mahdollisiin pilvitoimintoihin.

Perustelu:

- aiempi osaaminen Firebase-ekosysteemistä
- Firebase Auth helpottaa kirjautumista
- Firebase Hosting sopii web-julkaisuihin
- Firebase SQL / SQL Connect tai Cloud SQL voi toimia PostgreSQL-pilvikantana

## Päätös: modulaarinen monoliitti

Päätös:

Ensimmäinen backend rakennetaan modulaarisena monoliittina.

Perustelu:

- helpompi hallita kuin mikropalvelut
- sopii 4 kuukauden harjoittelujaksoon
- moduulirajat voidaan silti suunnitella selkeästi
- osia voidaan irrottaa myöhemmin palveluiksi, jos tarve syntyy

## Päätös: mobiili myöhemmin Kotlinilla

Päätös:

Mobiilisovellus suunnitellaan myöhemmäksi vaiheeksi Kotlin + Jetpack Compose + Room -linjalla.

Perustelu:

- aiempi osaaminen Satumaa-projektista
- Room sopii offline-first-käyttöön
- natiivimobiili on vahva kenttätyön kirjauksiin

## Päätös: dokumentaatio suomeksi, koodi englanniksi

Päätös:

Dokumentaatio ja suunnittelu kirjoitetaan suomeksi. Koodi kirjoitetaan englanniksi.

Perustelu:

- dokumentaatio on helpompi lukea projektin omistajalle
- englanninkielinen koodi on ammattimaisempi ja yhteensopivampi työkalujen kanssa
- sanasto ylläpitää yhtenäisiä termejä

## Avoimet teknologiapäätökset

- Cloud Run vai Cloud Functions backendille
- pilven PostgreSQL-profiilin tarkka query layer / adapteritoteutus
- käytetäänkö Firebase SQL Connectia vai suoraa PostgreSQL-yhteyttä
- local-cloud-synkronoinnin malli
- lopullinen UI-komponenttiratkaisu
- PDF-laskujen generointitapa
- sähköposti- tai verkkolaskuratkaisu
- lokitus- ja audit-ratkaisu
