# Customers-moduulin AI-ohjeet

Tämä tiedosto koskee customers-moduulin koodia.

Lue ensin projektin juuren `AGENTS.md`.

Lue lisäksi:

- `docs/modules/customers.md`
- `docs/architecture/module-boundaries.md`
- `docs/architecture/security-principles.md`
- `docs/product/glossary.md`

## Moduulin vastuu

Customers-moduuli vastaa asiakkaista.

Moduuli ei vastaa laskuista, työmääräyksistä, tuntikirjauksista, materiaalikirjauksista tai varastosaldoista.

## Koodin kieli

Koodi kirjoitetaan englanniksi.

Käytä termejä:

- `Customer`
- `ContactPerson`
- `Address`
- `BillingAddress`
- `CustomerStatus`

Älä käytä koodissa termejä kuten `Asiakas`, `laskutusAsiakas` tai `customerTiedot`.

## Turvallisuus

Kaikki asiakasdata kuuluu yritykselle.

Backend tarkistaa aina:

- käyttäjän tunnistamisen
- yritysrajauksen
- oikeuden lukea asiakas
- oikeuden luoda asiakas
- oikeuden muokata asiakasta
- oikeuden passivoida tai poistaa asiakas

Frontendin piilotettu painike ei riitä turvallisuudeksi.

## Moduulirajat

Customers-moduuli ei saa luoda laskuja.

Customers-moduuli ei saa muuttaa invoicing-moduulin dataa.

Customers-moduuli voi tarjota asiakastietoja muille moduuleille hallitun rajapinnan kautta.

## Tiedostojen vastuu

Pidä tiedostot pieninä.

Hyviä tiedostonimiä:

- `customerTypes.ts`
- `createCustomer.ts`
- `updateCustomer.ts`
- `customerSchema.ts`
- `customerRepository.ts`
- `customersApi.ts`

Vältä:

- `customerStuff.ts`
- `allCustomers.ts`
- `customerAndInvoice.ts`

## Testaus

Lisää testejä, jos muutat:

- asiakasvalidointia
- käyttöoikeussääntöjä
- asiakasstatuksen tilasiirtymiä
- asiakasdatan muunnoksia

## Avoimet kysymykset

Jos asiakastietojen pakollisuus, poistaminen, Y-tunnus tai henkilötiedot ovat epäselviä, älä arvaa. Kysy tai kirjaa avoimeksi kysymykseksi.