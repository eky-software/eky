# API-client-paketin AI-ohjeet

Tämä tiedosto tarkentaa repositorion juuri-`AGENTS.md`-ohjeita
`packages/api-client`-paketin sisällä.

Lue ennen API-client-muutoksia:

- repositorion juuri-`AGENTS.md`
- `docs/architecture/dependency-policy.md`
- `docs/architecture/security-principles.md`
- `docs/architecture/error-handling-principles.md`
- `packages/api-client/README.md`

## Rakenne

API-clientin rakenne seuraa projektin moduuliajattelua.

Yksittäinen pieni moduuli voi olla suoraan `src/`-kansion alla omana
toiminnallisena kansionaan:

- `customers/`
- `companySettings/`

Jos moduulilla on useita API-alikokonaisuuksia, ne ryhmitellään moduulin oman
kansion alle heti alusta asti:

```text
invoicing/
  invoiceDrafts/
  invoiceNumbering/
  invoicePaymentSettings/
  approvedInvoices/
```

Uusia moduuleita lisättäessä sama sääntö pätee: moduulin API-kokonaisuudet
pidetään moduulin omassa kansiossa, jos niitä on enemmän kuin yksi tai jos
moduulin odotetaan kasvavan useaan endpoint-kokonaisuuteen.

Moduuli- tai feature-kansiossa erotetaan tarpeen mukaan:

- HTTP-kutsut
- rajapinnan tyypit
- request-serialisointi
- response-validointi
- testit

`src/client.ts` kokoaa feature-clientit yhdeksi `EkyApiClient`-rajapinnaksi.

`src/index.ts` on paketin julkinen pääexportti.

## Rajat

API-client:

- kuvaa HTTP-sopimusta, ei backendin sisäisiä domain- tai tietokantatyyppejä
- ei sisällä liiketoiminta- tai laskentalogiikkaa
- ei tunne Reactia, Honoa, SQLitea, repositoryjä tai backendin sisäisiä moduuleja
- ei luota frontendin tietoihin turvallisuuden lähteenä
- ei lähetä palvelimen omistamia kenttiä create/update-pyynnöissä
- validoi backendin vastausrakenteen ennen sen palauttamista kutsujalle

Älä luo pakettiin yleisiä `utils`, `helpers`, `common` tai `everything`
-tiedostoja tai -kansioita.

Jos feature-tiedosto alkaa sisältää useita vastuita tai kasvaa vaikeasti
luettavaksi, jaa se vastuun mukaan ennen uuden toiminnallisuuden lisäämistä.

## Virheenkäsittelyn yhtenäistäminen

`customers`- ja `companySettings`-polut kuuluvat samaan
`docs/architecture/error-handling-principles.md`-malliin kuin `invoiceDrafts`.
Kun niiden tuotantokoodia seuraavan kerran muutetaan, tarkista samalla niiden
virheenkäsittely tämän mallin mukaiseksi ennen vastaavan UI-työn laajentamista.
