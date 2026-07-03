# PDF ja sisäiset työkalut -suunnitelma

Tämä dokumentti pysäyttää laskutuksen PDF-vaiheen hetkeksi
arkkitehtuuritarkistukseen ennen uuden PDF-riippuvuuden tai tuotantokoodin
lisäämistä.

Tavoite on varmistaa, että PDF, tulostus ja myöhempi sähköpostilähetys
rakennetaan Eky-projektin moduulirajojen, snapshot-periaatteen ja
riippuvuuslinjan mukaisesti.

Tämä dokumentti ei vielä toteuta PDF:ää.

## Nykyinen Tilanne

Laskutuksen ketju on tällä hetkellä:

```text
InvoiceDraft
  -> hyväksyntä
    -> Approved Invoice snapshot
      -> ApprovedInvoiceView
        -> web preview
        -> approved invoice list
```

Hyväksynnässä Invoicing muodostaa virallisen laskunumeron, viitenumeron ja
hyväksytyn laskun snapshot-tiedot. Hyväksytty lasku luetaan ensimmäisessä
vaiheessa reitistä:

```text
GET /invoices/:id
```

Tämä palauttaa `ApprovedInvoiceView`-lukumallin.

`ApprovedInvoiceView` on tulevan PDF:n ensisijainen datalähde. Se käyttää
hyväksytyn laskun snapshot-dataa, ei muuttuvaa Customer- tai Company Settings
-master-dataa eikä alkuperäistä invoice draftia.

Nykyinen web-preview on tarkistusnäkymä. Se auttaa varmistamaan, että
snapshotissa on oikeat tiedot, mutta se ei ole vielä virallinen asiakkaalle
lähtevä lasku, A4-print-layout tai PDF.

Virallinen asiakkaalle lähtevä lasku muodostetaan myöhemmin PDF:nä hyväksytyn
laskun snapshot-datasta.

## PDF-Polun Suositeltu Vaiheistus

Etenemisjärjestys:

1. PDFKit-spike ja lisenssitarkistus
2. ensimmäinen `ApprovedInvoicePdfRenderer` Invoicing-moduuliin
3. PDF:n tekninen testaus `ApprovedInvoiceView`-testidatalla
4. `invoice_documents`-taulu ja paikallinen tiedostotallennus
5. `POST /invoices/:id/pdf`
6. `GET /invoices/:id/pdf`
7. webiin `Luo PDF`, `Avaa PDF` ja `Lataa PDF`
8. sähköpostisuunnitelma
9. sähköpostilähetys PDF-liitteellä
10. lähetys-, lataus- ja tulostushistoria myöhemmin

PDF:n luonti ei vielä merkitse laskua lähetetyksi.

Tulostus voidaan ensimmäisessä vaiheessa hoitaa avaamalla valmis PDF selaimeen
ja käyttämällä selaimen tai käyttöjärjestelmän tulostustoimintoa.

Sähköposti tehdään vasta, kun PDF:n muodostus ja tallennusmalli ovat olemassa.

## PDF-Rendererin Omistajuus

Invoicing-moduuli omistaa laskun PDF-sisällön.

Invoicing omistaa:

- `ApprovedInvoicePdfRenderer`-rajauksen
- laskulla näkyvien tietojen järjestyksen
- myyjän, asiakkaan ja laskun vastaanottajan esittämisen
- laskurivit
- ALV-erittelyn
- maksutiedot
- viivästyskoron
- viitenumeron
- laskun footerin
- laskuun liittyvän liiketoimintalogiikan
- hyväksytyn laskun snapshot-periaatteen

Ensimmäinen PDF-spike saa olla kokonaan Invoicing-moduulin sisällä esimerkiksi:

```text
apps/backend/src/modules/invoicing/infrastructure/pdf/
```

Jos PDF-tekninen koodi alkaa toistua myöhemmin muualla, voidaan harkita
rajattua backend shared -kerrosta:

```text
apps/backend/src/shared/pdf/
```

Mahdollinen `shared/pdf` saa omistaa vain teknisiä PDF-apuja:

- A4-mitat
- piste/mm-muunnokset
- tekstin rivittäminen
- laatikoiden ja viivojen piirtäminen
- taulukkopiirtämisen tekninen apu
- sivunvaihdon tekninen apu
- PDF-bufferin muodostamisen tekninen apu

`shared/pdf` ei saa tietää:

- laskunumeroa
- viitenumeroa
- ALV-sääntöjä
- asiakasta
- myyjää
- eräpäivää
- taloyhtiö/isännöitsijä-logiikkaa
- invoice snapshot -sääntöjä
- laskun elinkaaren tiloja

## Laskun Ulkoasun Tavoite

Ensimmäisen virallisen PDF-laskun pitää olla selkeä, rauhallinen ja
työohjelmamainen.

Ulkoasun inspiraationa voidaan käyttää nykyistä yrityksessä käytössä olevaa
laskumallia: käytännöllinen lasku, jossa laskun perustiedot, osapuolitiedot,
rivit, summat ja maksutiedot löytyvät nopeasti.

Vanhaa ohjelmaa, brändiä tai ulkoasua ei kopioida suoraan. Tavoitteena on sama
käyttölogiikan selkeys, ei pikselitarkka kopio.

PDF-layoutin pitää muodostua `ApprovedInvoiceView`-snapshotista. Layout ei saa
ohjata domain-mallia väärään suuntaan eikä hakea tietoja master-tauluista.

## Sisäisten Työkalujen Inventaario

Tämä inventaario kuvaa nykyisestä koodista näkyviä apuja ja toistuvia
rakenteita. Se ei vielä tarkoita, että ne pitää nostaa yhteisiin paketteihin.

### Backend

#### `apps/backend/src/http/requestBody.ts`

Tekee HTTP-request bodyn perustason lukua:

- `isRecord`
- `getOptionalStringField`
- `getStringField`

Käyttö nyt: backendin HTTP-kerros.

Suositus: pidä nykyinen pieni HTTP-apu backendin sisällä. Jos request-parserit
alkavat toistua laajasti, arvioi myöhemmin `apps/backend/src/shared/http/`.

#### `apps/backend/src/modules/invoicing/http/invoiceDraftRequest.ts`

Tekee laskuluonnoksen request-body-validointia:

- allowed fields -tarkistukset
- string length -rajat
- safe integer -tarkistukset
- enum-tyyppiset tarkistukset
- discount-rakenteen lukeminen

Käyttö nyt: Invoicing HTTP -kerros.

Suositus: pidä Invoicing-moduulissa. Tämä on laskuluonnoksen sopimus- ja
validointilogiikkaa. Jos sama allowed-field/safe-integer-malli toistuu 2-3
uudessa moduulissa, harkitse rajattua backend HTTP parsing -apua. Älä tee
yleistä `utils`-tiedostoa.

#### Repository row mapperit ja transaktiot

SQLite-adaptereissa on riveistä domain/application-tyyppeihin muuntavaa koodia
sekä transaktiomalleja.

Käyttö nyt: moduulien infrastructure-kerros.

Suositus: pidä adapterien sisällä. SQL, `snake_case` -> `camelCase` ja
transaktiot ovat adapterivastuuta. Jaettua apua voidaan harkita vain
teknisiin transaktioturvallisuus- tai storage-tarpeisiin, ei
liiketoimintasääntöihin.

#### PDF-tarpeet

PDF:ää varten ei vielä ole backendissä PDF-apuja, storage-kerrosta tai
PDF-riippuvuutta.

Suositus: ensimmäinen spike Invoicingin sisällä. `shared/pdf` vasta, jos
tekninen piirtoapu alkaa oikeasti toistua.

### API-client

#### `packages/api-client/src/http.ts`

Sisältää:

- `EkyApiError`
- `requestJson`
- `isRecord`
- base URL -normalisointi
- turvallisen HTTP-virhemuodon

Käyttö nyt: kaikki API-client feature-clientit.

Suositus: pidä api-clientin yhteisenä HTTP-ytimenä.

#### Response parserit feature-kansioissa

Esimerkkejä:

- `packages/api-client/src/approvedInvoices/approvedInvoicesResponse.ts`
- `packages/api-client/src/invoiceDrafts/invoiceDraftsResponse.ts`
- `packages/api-client/src/invoiceNumbering/invoiceNumberingResponse.ts`
- `packages/api-client/src/invoicePaymentSettings/invoicePaymentSettingsResponse.ts`

Näissä toistuu:

- `readString`
- `readNullableString`
- `readSafeInteger`
- enum-parserit
- response shape -validointi
- `EkyApiError` invalid response -virheisiin

Käyttö nyt: API-clientin sisäinen response parsing.

Suositus: tämä on ensimmäinen selvä ehdokas myöhempään api-clientin sisäiseen
parser-apuun. Ei vielä pakollinen, mutta jos seuraava API-client feature tuo
samaa toistoa lisää, voidaan luoda tarkasti rajattu:

```text
packages/api-client/src/responseParsing.ts
```

Sitä ei pidä nimetä `utils`, `helpers` tai `common`.

### Web

#### `apps/web/src/shared/money/hourlyRateInput.ts`

Muuntaa web-lomakkeiden tuntihintasyötteen eurojen ja senttien välillä.

Käyttö nyt: useampi web-featureen liittyvä lomakemalli.

Suositus: pidä `shared/money`-kansiossa. Vastuu on rajattu eikä se ole yleinen
utils-kaatopaikka.

#### Invoicing-featuren formatointi ja lomakemallit

Esimerkkejä:

- `approved/approvedInvoiceFormatting.ts`
- `drafts/invoiceDraftFormatting.ts`
- `preview/invoiceDraftPreviewTotals.ts`
- `form/invoiceDraftFormMapping.ts`
- `form/invoiceDraftFormHydration.ts`
- `form/invoiceDraftFormValidation.ts`
- `form/invoiceDummyForm.ts`

Käyttö nyt: vain Invoicing UI.

Suositus: pidä Invoicing-featuren sisällä. Näissä on laskutukseen liittyvää
esitystapaa, lomakemallia ja esikatselua. Niitä ei pidä nostaa yhteiseksi ennen
kuin sama tarve ilmenee toisessa web-featuressa.

#### List/table UI ja button/input/panel-toisto

UI:ssa alkaa näkyä toistuvia työohjelman rakenteita, kuten listat, panelit,
napit ja status-pill-tyylit.

Käyttö nyt: osa on globaaleissa perusluokissa, osa komponenttien CSS
Moduleissa.

Suositus: jatka nykyisellä linjalla. Jos sama komponenttirakenne toistuu 2-3
toisistaan riippumattomassa näkymässä, harkitse rajattua
`apps/web/src/shared/ui`-komponenttia. `packages/ui` vaatii erillisen päätöksen.

## Mitä Ei Pidä Yleistää

Näitä ei pidä nostaa yhteisiin työkaluihin:

- invoice approval logic
- invoice numbering
- invoice reference number generation, ellei myöhemmin ilmene muu todellinen
  moduulitarve
- approved invoice snapshot rules
- VAT business rules
- billing recipient / customer / housing company logic
- invoice PDF content order
- invoice lifecycle states
- audit trail business rules

Nämä kuuluvat Invoicing-moduuliin.

## Mahdolliset Tulevat Yhteiset Kerrokset

### `apps/backend/src/shared/pdf/`

Tarve: ennakoitu, ei vielä todellinen.

Suositus: älä tee ennen PDFKit-spikeä. Ensimmäinen PDF-toteutus saa olla
Invoicingin sisällä. Jos teknistä PDF-piirtokoodia alkaa olla paljon ja se on
selvästi riippumaton laskutuksesta, nosta vain tekniset piirtoavut
`shared/pdf`-kerrokseen.

### `apps/backend/src/shared/storage/`

Tarve: todennäköinen PDF:n tallennusvaiheessa.

Suositus: arvioi, kun `invoice_documents` ja local storage -polku
suunnitellaan. Storage-apu saa käsitellä tiedostopolkuja, bufferien
tallennusta ja mahdollisesti myöhempää pilvitallennusadapteria. Se ei saa
päättää laskun tiloja tai lähetyslogiikkaa.

### `apps/backend/src/shared/http/`

Tarve: osittain näkyvissä.

Suositus: myöhemmin, jos request parser -toisto kasvaa. Nykyinen
`apps/backend/src/http/requestBody.ts` riittää vielä.

### API-client parser helpers

Tarve: näkyy jo jonkin verran.

Suositus: harkitse seuraavan API-client-laajennuksen yhteydessä. Nimeä tarkasti
response parsing -vastuun mukaan, ei `utils`- tai `helpers`-nimellä.

### `packages/validation`

Tarve: ennakoitu, mutta ei vielä pakottava.

Suositus: käytetään vasta, kun sama validointimalli aidosti toistuu useassa
moduulissa ja tarvitsee monorepo-tason jaon.

### `packages/ui`

Tarve: ennakoitu.

Suositus: ei vielä. Webin feature- ja CSS Module -rakenne kantaa nykyisen
vaiheen. `packages/ui` vasta, kun samat UI-komponentit toistuvat useassa
isossa näkymässä.

### `packages/config`

Tarve: myöhemmin mahdollinen.

Suositus: ei liity suoraan PDF:n ensimmäiseen vaiheeseen.

## PDFKit-Riippuvuuden Päätöspiste

Ennen PDFKitin tai muun PDF-kirjaston lisäämistä tarkistetaan:

- lisenssi
- transitiiviset riippuvuudet
- ylläpidon aktiivisuus
- bundle/build-vaikutus
- toimiiko kirjasto Node-ympäristössä
- sopiiko kirjasto myöhemmin Cloud Run / Cloud Functions -suuntaan
- voidaanko riippuvuus eristää `ApprovedInvoicePdfRenderer`- tai
  backend `shared/pdf` -adapterin taakse

Alustavasti hyväksyttäviä lisenssejä:

- MIT
- ISC
- BSD-2-Clause
- BSD-3-Clause
- Apache-2.0

Jos kirjastossa tai sen olennaisessa transitiivisessa riippuvuudessa on:

- GPL
- AGPL
- LGPL
- epäselvä lisenssi

työ pysäytetään ja raportoidaan projektin omistajalle ennen toteutusta.

Riippuvuus lisätään vasta erillisessä toteutusvaiheessa. Tämä dokumentti ei
hyväksy riippuvuutta vielä automaattisesti.

## Suositus Ennen Seuraavaa Toteutusaskelta

Suositeltu seuraava askel on pieni PDFKit-spike.

Spiken rajaus:

- ei `invoice_documents`-taulua vielä
- ei HTTP-reittejä vielä
- ei web-UI:ta vielä
- ei sähköpostia
- ei laskun lähettämisen tilamuutosta
- ei uutta shared/pdf-kerrosta ennen kuin tarve näkyy

Spike voi:

- käyttää kovakoodattua `ApprovedInvoiceView`-testidataa
- luoda PDF-bufferin backend-testissä tai pienessä rajatussa renderer-testissä
- tarkistaa, että tekstit, rivit ja maksutiedot saadaan piirrettyä
- pitää rendererin Invoicing-moduulin infrastructure/pdf-kansiossa
- dokumentoida, mitä PDFKitistä opittiin

PDF-toteutus kannattaa aloittaa Invoicingin sisäisestä rendereristä.

Tällä hetkellä mikään moduuliraja ei näytä olevan vaarassa, kunhan PDF käyttää
vain `ApprovedInvoiceView`-snapshot-dataa eikä hae master-dataa muista
moduuleista.

## Riskit

PDF-vaiheen keskeiset riskit:

- liian aikainen abstrahointi
- business logic valuu `shared`-kerrokseen
- PDFKit-koodi leviää application serviceihin tai HTTP-routeihin
- `packages/utils`-tyyppinen kaatopaikka syntyy vahingossa
- PDF-layout alkaa ohjata domain-mallia väärin
- sähköpostia yritetään tehdä ennen PDF:n tallennusmallia
- vanhan web-previewn ja PDF:n välille syntyy kaksi eri totuutta
- PDF muodostetaan vahingossa muuttuvasta Customer- tai Company Settings
  -datasta snapshotin sijaan

Riskien hallinta:

- aloita pienellä Invoicing-moduulin sisäisellä spikellä
- eristä PDF-kirjasto adapteriin
- käytä vain `ApprovedInvoiceView`-dataa
- älä lisää shared-kerrosta ennen todellista toistoa
- älä merkitse laskua lähetetyksi PDF:n luonnissa
- pidä web-preview tarkistusnäkymänä ja PDF virallisena dokumenttina
