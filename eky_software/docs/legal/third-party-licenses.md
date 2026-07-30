# Kolmannen Osapuolen Lisenssit

Tämä dokumentti kirjaa Eky-projektiin lisättyjä kolmannen osapuolen
riippuvuuksia silloin, kun dependency-päätös tai uusi käyttötarkoitus vaatii
erillisen lisenssihuomion.

Tämä ei korvaa lockfilea tai myöhempää automaattista lisenssiraportointia.

## PDFKit

Ensimmäinen hyväksytyn laskun PDF-teknologiakokeilu käyttää backendissä
`pdfkit`-kirjastoa.

Lisätyt suorat paketit:

- `pdfkit` 0.19.1, MIT
- `@types/pdfkit` 0.17.6, MIT

PDFKit lisättiin vain `@eky/backend`-pakettiin ja sitä käytetään
Invoicing-moduulin infrastructure-kerroksessa. PDFKit ei kuulu domainiin,
application serviceihin, HTTP-routeihin, API-clientiin tai webiin.

Asennuksen jälkeen tarkistettu `pnpm licenses list --filter @eky/backend --json`
näytti PDFKit-polun ja backendin riippuvuuksille permissiivisiä lisenssejä,
kuten MIT, ISC, BSD-3-Clause, Apache-2.0, 0BSD ja `(MIT AND Zlib)`.

`png-js`-paketin npm-metadatassa ei ollut lisenssikenttää, mutta asennetun
version tarballissa oli MIT-lisenssitiedosto.

PDFKit-polun nykytila:

- PDF-metadata tallennetaan `invoice_documents`-tauluun
- PDF-binääri tallennetaan paikallisen storage-adapterin kautta
- backendissä on rajatut PDF:n luonti-, metadata- ja latausreitit
- web ja Electron käyttävät hallittuja PDF:n luonti- ja esikatselutoimintoja
- hyväksytyn laskun current PDF voidaan liittää hallittuun SMTP-toimitukseen

## Electron Desktop -Paketointi

Nykyisen Windows-paketointipolun suorat desktop-riippuvuudet:

- `electron` 42.8.0, MIT
- `@electron/packager` 20.0.4, BSD-2-Clause
- `@electron/fuses` 2.1.3, MIT

Electron ja paketointityökalut kuuluvat vain `apps/desktop`-runtimeen. Ne eivät
vuoda domainiin, application serviceihin, API-clientiin tai web-featureihin.

## Playwright E2E -Testaus

R0:n järjestelmä-, selain- ja Electron development -testauksen suora
testiriippuvuus on:

- `@playwright/test` 1.61.1, Apache-2.0

Riippuvuus kuuluu vain `apps/e2e`-testipakettiin. R0 asentaa Playwrightin
Chromium-testibinäärin paikallista ja CI-testausta varten. Playwright,
testibinääri, E2E-testit ja niiden artefaktit eivät kuulu Eky.exe-pakettiin
eivätkä production-runtimeen.

Tämä dokumentti ei ole vielä täydellinen automaattisesti muodostettu
kolmannen osapuolen lisenssi-inventaario. Ennen loppukäyttäjälle jaettavaa
tuotantojulkaisua suorat ja transitiiviset runtime- sekä paketointiriippuvuudet
tarkistetaan, tarvittavat notices-tiedostot kootaan artifactiin ja dokumentti
päivitetään release security gate -tarkistuksessa.
