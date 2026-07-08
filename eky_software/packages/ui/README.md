# UI package

Tämä paketti sisältää myöhemmin uudelleenkäytettäviä käyttöliittymäkomponentteja.

Paketti on vielä skeleton-vaiheessa. Tähän pakettiin ei lisätä React-riippuvuutta
tai varsinaisia komponentteja ennen erillistä rajattua UI-refaktorointisprinttiä.

Tuleva kasvupolku on kuvattu dokumentissa:

```text
docs/architecture/ui-design-system-roadmap.md
```

## Nykyinen Tila

Nykyiset web-featuret omistavat omat komponenttinsa. Tämä on hyväksyttävää
MVP-vaiheessa, mutta lomakkeissa, napeissa, paneeleissa, kentissä,
virheviesteissä ja CSS Module -rakenteissa on alkanut näkyä toistoa.

Tämä ei riko ohjelmaa nyt. Ennen seuraavaa isoa UI-moduulia, kuten
työmääräyksiä, kannattaa tehdä lyhyt `packages/ui`-refaktorointisprintti.

Ensimmäinen tavoite ei ole iso design system, vaan pieni joukko teknisiä
peruskomponentteja, jotka poistavat todellista toistoa.

## Mahdollinen Ensimmäinen Vaihe

Sallittuja komponenttityyppejä myöhemmin:

- `Button`
- `TextField`
- `SelectField`
- `TextareaField`
- `FormField`
- `Panel`
- `PageHeader`
- `Message`
- `EmptyState`

Komponentti lisätään vasta, kun sama tekninen UI-rakenne toistuu useassa
näkymässä.

## Rajat

`packages/ui` saa sisältää vain yleisiä teknisiä UI-komponentteja.

Kiellettyä:

- laskutuslogiikka
- ALV-laskenta
- asiakkaan valintasäännöt
- taloyhtiö/isännöitsijälogiikka
- API-kutsut
- Firebase-kutsut
- backend- tai tietokantalogiikka
- feature-hookit
- domain-validointi
- moduulien sisäiset säännöt

Feature-kohtaiset komponentit pysyvät featureissä. Esimerkiksi
`CustomerPicker` ja `InvoiceRowsEditor` eivät lähtökohtaisesti kuulu
`packages/ui`-pakettiin, koska niissä on moduulikohtaista käyttölogiikkaa.
