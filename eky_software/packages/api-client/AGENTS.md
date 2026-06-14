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

Jokainen API-kokonaisuus sijoitetaan omaan toiminnalliseen kansioonsa:

- `customers/`
- `companySettings/`
- `invoiceDrafts/`

Feature-kansiossa erotetaan tarpeen mukaan:

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
