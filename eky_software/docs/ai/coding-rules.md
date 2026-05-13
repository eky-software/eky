# Koodauskäytännöt

Tämä dokumentti määrittelee Eky-projektin yleiset koodauskäytännöt.

Yksityiskohtaiset arkkitehtuurirajat määritellään tiedostossa `docs/architecture/module-boundaries.md`.

## Koodin kieli

Kaikki koodi kirjoitetaan englanniksi.

Tämä koskee:

- muuttujia
- funktioita
- luokkia
- tyyppejä
- rajapintoja
- tiedostonimiä
- kansioita
- tietokantatauluja
- tietokantakenttiä
- API-reittejä

Dokumentaatio ja liiketoiminnan kuvaukset voidaan kirjoittaa suomeksi.

Käytä sanastoa `docs/product/glossary.md`.

## TypeScript-tyyli

Käytä seuraavia periaatteita:

- 2 välilyönnin sisennys
- puolipisteet
- camelCase muuttujille ja funktioille
- PascalCase tyypeille, luokille ja React-komponenteille
- selkeät tyypitykset
- ei käyttämättömiä muuttujia
- ei turhaa `any`-tyyppiä
- pienet tiedostot
- yksi selkeä vastuu per tiedosto
- luettava koodi ennen liian nokkelaa koodia

Koodin tulee noudattaa ESLintin `eslint:recommended`-henkistä tyyliä, vaikka tarkka konfiguraatio päätetään myöhemmin.

## Tiedostojen vastuu

Jokaisella tiedostolla pitää olla yksi selkeä vastuu.

Hyviä tiedostonimiä:

- `calculateInvoiceTotal.ts`
- `createCustomer.ts`
- `customerSchema.ts`
- `customersApi.ts`
- `useCustomers.ts`
- `CustomerForm.tsx`
- `canEditInvoice.ts`

Vältettäviä tiedostonimiä:

- `helpers.ts`
- `utils.ts`
- `everything.ts`
- `customerAndInvoiceStuff.ts`
- `firebaseEverything.ts`

Yleisiä `utils.ts`- tai `helpers.ts`-tiedostoja ei saa luoda ilman erityistä syytä.

## Kommentointi

Kommentteja käytetään selventämään miksi jokin ratkaisu on tehty.

Kommentteja ei käytetä selittämään itsestään selvää koodia.

Hyvä kommentti kertoo päätöksen taustan, poikkeuksen tai riskin.

Huono kommentti toistaa koodin sisällön.

## Virheenkäsittely

Virheitä ei saa piilottaa.

Backendissä virheet käsitellään hallitusti ja palautetaan käyttäjälle turvallinen virheilmoitus.

Sisäisiä teknisiä virheitä ei näytetä suoraan loppukäyttäjälle.

Logeihin ei saa kirjoittaa salasanoja, tokeneita, API-avaimia tai muita salaisuuksia.

## Validointi

Kaikki käyttäjältä, API:sta tai ulkoisesta järjestelmästä tuleva syöte validoidaan.

Frontend-validointi parantaa käyttökokemusta.

Backend-validointi on pakollinen turvallisuuden ja datan eheyden kannalta.

Validointi ei korvaa domain-logiikkaa.

## API-tyyli

Frontend ei kutsu raakaa `fetch`-kutsua suoraan komponenteista, jos api-client-kerros on olemassa.

API-kutsut keskitetään api-client-kerrokseen.

Backend handler ei sisällä raskasta liiketoimintalogiikkaa.

Backend service ohjaa käyttötapauksen.

Repository hoitaa tietokantayhteyden.

## Kiellettyjä tapoja

Älä tee:

- business-logiikkaa React-komponenttiin
- suoria tietokantakutsuja frontendistä
- Firebase-kutsuja satunnaisiin komponentteihin
- isoja monen vastuun tiedostoja
- yleistä `everything.ts`-tiedostoa
- uutta riippuvuutta ilman perustelua
- koodia, joka toimii vain yhdessä yrityksessä kovakoodatuilla arvoilla

## Refaktorointi

Refaktorointi tehdään pienissä paloissa.

Refaktoroinnin pitää säilyttää toiminnallisuus.

Jos refaktorointi muuttaa arkkitehtuuria, se vaatii erillisen hyväksynnän.

Ennen laajaa refaktorointia tehdään Git-commit.