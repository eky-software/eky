# Kolmannen Osapuolen Lisenssit

Tämä dokumentti kirjaa Eky-projektiin lisättyjä kolmannen osapuolen
riippuvuuksia silloin, kun dependency-päätös tai uusi käyttötarkoitus vaatii
erillisen lisenssihuomion.

Tämä ei korvaa lockfilea tai myöhempää automaattista lisenssiraportointia.

## PDFKit-Spike

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

Tämä vaihe on vasta PDF-spike:

- PDF ei vielä tallennu laskulle
- ei ole `invoice_documents`-taulua
- ei ole PDF:n luonti- tai latausreittejä
- webissä ei vielä ole PDF-painikkeita
- sähköpostilähetystä ei vielä toteuteta
