# Invoicing-moduulin AI-ohjeet

Tämä tiedosto koskee invoicing-moduulin koodia.

Lue ensin projektin juuren `AGENTS.md`.

Lue lisäksi:

- `docs/modules/invoicing.md`
- `docs/architecture/module-boundaries.md`
- `docs/architecture/security-principles.md`
- `docs/architecture/data-model-principles.md`
- `docs/product/glossary.md`
- `docs/product/workflows.md`

## Moduulin vastuu

Invoicing-moduuli vastaa laskutuksesta.

Laskutus on kriittinen moduuli. Muutokset laskutukseen vaativat erityistä huolellisuutta.

## Koodin kieli

Koodi kirjoitetaan englanniksi.

Käytä termejä:

- `InvoiceDraft`
- `Invoice`
- `InvoiceLine`
- `InvoiceStatus`
- `Vat`
- `PaymentTerm`
- `CreditInvoice`

Älä käytä koodissa termejä kuten `Lasku`, `LaskuDraft` tai `invoiceRivi`.

## Turvallisuus

Backend tarkistaa aina:

- saako käyttäjä nähdä laskun
- saako käyttäjä luoda laskuluonnoksen
- saako käyttäjä muokata laskuluonnosta
- saako käyttäjä hyväksyä laskun
- saako käyttäjä lähettää laskun
- saako käyttäjä perua laskun

Frontend ei ole turvallisuuden lähde.

## Laskun tilat

Alustavat tilat:

- `draft`
- `approved`
- `sent`
- `paid`
- `cancelled`

Tilasiirtymät toteutetaan domain-sääntöinä.

Älä muuta laskun tiloja ilman dokumentoitua päätöstä.

## Rahasummat

Rahasummien käsittelyssä pitää välttää floating point -epätarkkuuksia.

Rahasummien tallennus- ja laskentatapa päätetään ennen varsinaista laskutuslogiikkaa.

## Moduulirajat

Invoicing voi viitata asiakkaaseen ja kohteeseen, mutta ei omista niiden perustietoja.

Invoicing ei saa muuttaa customers- tai sites-moduulin dataa suoraan.

Tunti- ja materiaalikirjaukset eivät siirry lopulliseen laskuun ilman hallittua hyväksyntä- tai laskuluonnosvaihetta.

## Testaus

Lisää testejä aina, jos muutos koskee:

- laskun summalaskentaa
- ALV-laskentaa
- laskun tilasiirtymiä
- laskun hyväksyntää
- laskun perumista
- käyttöoikeuksia
- laskurivejä
- laskunumerointia

## Audit log

Tärkeistä laskutustoiminnoista pitää jäädä audit log.

Esimerkkejä:

- laskuluonnos luotu
- laskua muokattu
- lasku hyväksytty
- lasku lähetetty
- lasku merkitty maksetuksi
- lasku peruttu

## Avoimet kysymykset

Jos laskunumerointi, hyvityslasku, ALV-käsittely, maksuehto tai laskun muuttaminen on epäselvää, älä arvaa. Kysy tai kirjaa avoimeksi kysymykseksi.