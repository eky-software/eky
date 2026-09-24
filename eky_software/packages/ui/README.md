# UI package

Tämä paketti sisältää myöhemmin uudelleenkäytettäviä käyttöliittymäkomponentteja.

Paketti on vielä skeleton-vaiheessa. Tähän pakettiin ei lisätä React-riippuvuutta
tai varsinaisia komponentteja ilman erillistä päätöstä. Ensimmäinen webin
UI-siivoussprintti ei aktivoi tätä pakettia.

Kasvupolun ja paketin käyttöönoton ehdot omistaa
[UI Design System Roadmap](../../docs/architecture/ui-design-system-roadmap.md).

## Nykyinen Tila

Nykyiset web-featuret omistavat omat komponenttinsa. Tämä on hyväksyttävää
MVP-vaiheessa, mutta lomakkeissa, napeissa, paneeleissa, kentissä,
virheviesteissä ja CSS Module -rakenteissa on alkanut näkyä toistoa.

Aidosti yhteisiä web-primitiivejä arvioidaan ensin
`apps/web/src/shared/ui`-alueelle. `packages/ui` arvioidaan vasta, kun sama
vakaa UI tarvitaan useassa itsenäisessä sovelluksessa. Electron desktop
käyttää samaa web-rendereriä eikä yksin muodosta toista UI-sovellusta.

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

Pelkkä toisto useassa web-näkymässä ei riitä tämän paketin käyttöönottoon.
Sovella tiekartan erillistä `packages/ui`-päätöspistettä ja riippuvuuksien
hyväksyntäporttia.

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
