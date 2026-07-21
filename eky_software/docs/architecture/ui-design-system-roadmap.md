# UI Design System Roadmap

Tämä dokumentti kirjaa Eky-webin jaettujen UI-primitiivien hallitun
kasvupolun.

Tämä dokumentti on auktoritatiivinen lähde jaettujen UI-primitiivien
abstraktiokynnykselle sekä `apps/web/src/shared/ui`- ja `packages/ui`-
päätöksille. Käyttäjäkokemuksen ja visuaalisen peruslinjan omistaa
`docs/design/ui-principles.md`. Webin kansiot, importit ja CSS-omistajuuden
omistaa `docs/architecture/web-frontend-structure.md`.

Nykyinen UI toimii, mutta lomakkeissa, napeissa, vahvistuksissa,
tilailmoituksissa ja kenttärakenteissa on alkanut näkyä toistoa. Tavoite ei ole
rakentaa suurta design systemiä, vaan yhtenäistää aidosti yhteinen
käyttäytyminen ja saavutettavuus ilman featurelogiikan siirtämistä väärään
kerrokseen.

Koodipohjan yleinen refaktorointijärjestys on kuvattu dokumentissa
`docs/architecture/codebase-cleanup-roadmap.md`.

## UI-Omistajuuden Kasvupolku

```text
apps/web/src/styles.css
  -> design tokenit ja aidosti yhteinen elementtien perustyyli

apps/web/src/features/<feature>/components
  -> featurekohtaiset komponentit ja liiketoimintakonteksti

apps/web/src/shared/ui
  -> vähintään 2-3 riippumattoman web-featuren aidosti yhteiset React-
     primitiivit

packages/ui
  -> vasta, jos sama vakaa UI tarvitaan useassa itsenäisessä sovelluksessa
```

Electron desktop käyttää samaa React/Vite-web-sovellusta rendererinä. Se ei
yksin muodosta toista UI-sovellusta eikä perustele `packages/ui`-pakettia.

## Nykyinen Tila

`packages/ui` on skeleton-paketti ilman React-riippuvuutta tai komponentteja.
Sitä ei aktivoida ensimmäisessä UI-siivoussprintissä.

Featuret omistavat omat komponenttinsa:

- Customers
- Company Settings
- Invoicing

Globaalit design tokenit ja aidosti yhteiset perustyylit ovat
`apps/web/src/styles.css`-tiedostossa. Komponenttikohtaiset tyylit ovat
komponenttien vieressä CSS Moduleissa.

Tämä on edelleen oikea perusrakenne.

## Havaittu Toisto

Toistoa näkyy erityisesti:

- button-varianteissa, loading-teksteissä ja disabled-tiloissa
- label-, help- ja error-rakenteissa
- virhe-, onnistumis- ja infoviesteissä
- sivunsisäisissä vahvistuspaneeleissa
- status badge -ulkoasussa
- saavutettavuuden ja fokuksen käsittelyssä

Pelkkä sama CSS-luokka tai saman näköinen JSX ei riitä komponentin
irrottamiseen. Yhteisellä komponentilla pitää olla sama käyttäytyminen,
saavutettavuussopimus ja muutosperuste useassa riippumattomassa featuressa.

## Ajoitus

1. Ensin pilkotaan Invoicing-webin suuret workspace- ja preview-vastuut
   käyttäytymistä muuttamatta.
2. Sen jälkeen inventoidaan todelliset yhteiset käyttökohteet Customers-,
   Company Settings- ja Invoicing-featureistä.
3. Hyväksytään ensimmäiset 1-4 webin sisäistä primitiiviä.
4. Yksi primitiivi siirretään kerrallaan 2-3 edustavaan käyttökohteeseen.
5. Ulkoasu, tekstit, domain-päätökset ja käyttäjäpolut säilytetään.
6. Vasta käytännön kokemuksen jälkeen arvioidaan, onko `packages/ui` koskaan
   tarpeellinen.

UI-siivousta ei yhdistetä samaan committiin laskutus-, API-, tietokanta- tai
domain-muutoksen kanssa.

## Ensimmäiset Arvioitavat Primitiivit

### Button

Rajatut variantit voivat olla:

```ts
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
```

Button tukee natiivin button-elementin ominaisuudet, oikean `type`-arvon,
disabled-tilan ja tarvittaessa loading-tilan. Se ei omista featurekohtaista
tekstiä, permission-päätöstä tai toimintoa.

### FormField

FormField voi koota:

- labelin
- required-merkinnän
- help-tekstin
- kentän
- field error -tekstin

Kenttä annetaan aluksi natiivina lapsena. Yleistä lomakeframeworkia ei tehdä.

### MessageBanner

Rajatut variantit voivat olla `info`, `success`, `warning` ja `error`.
Komponentti omistaa esityksen ja saavutettavan ilmoitustavan, ei virheen
liiketoimintaluokitusta.

### ConfirmationPanel

ConfirmationPanel voi omistaa sivunsisäisen vahvistuksen yhtenäisen
rakenteen, fokuksen ja toimintojen asettelun. Se ei omista sitä, milloin lasku,
asiakas tai muu resurssi saa muuttua.

### StatusBadge

StatusBadge voi omistaa teknisen badge-esityksen. Feature muuntaa domain-tilan
käyttäjälle näkyväksi tekstiksi ja valitsee sallitun variantin.

`Panel` tehdään React-komponentiksi vain, jos yhteinen rakenne tai käyttäytyminen
toistuu. Pelkkä yhteinen CSS-luokka ei vaadi komponenttia.

## Saavutettavuusportti

Jaetun UI-primitiivin pitää testata ja dokumentoida vähintään sitä koskevat
seuraavat asiat:

- oikea HTML-elementti ja buttonin `type`
- labelin ja kentän ohjelmallinen yhteys
- help- ja error-tekstien `aria-describedby`
- virheen tarkoituksenmukainen `role="alert"` tai live region
- näkyvä näppäimistöfokus
- fokuksen palautuminen vahvistuksen tai näkymäsiirtymän jälkeen
- disabled- ja loading-tilojen ero
- riittävä kontrasti
- kosketuskohteiden koko
- tekstin mahtuminen ja käyttö 125-150 prosentin näyttöskaalauksella
- responsiivinen käyttö tuetuissa näkymissä

UI-siivous ei ole vain ulkoasun yhtenäistämistä.

## Mitä Jaettu UI Saa Sisältää

`apps/web/src/shared/ui` saa sisältää vain yleisiä teknisiä
React-komponentteja, joilla on useita todellisia web-featurekäyttäjiä.

Se saa omistaa esimerkiksi:

- perusnapin esityksen ja tekniset tilat
- kentän label/help/error-rakenteen
- yleisen viesti- ja vahvistusrakenteen
- yleisen status badge -esityksen
- saavutettavuuden teknisen sopimuksen

## Mitä Jaettu UI Ei Saa Sisältää

Jaettu UI ei saa sisältää:

- laskutuslogiikkaa tai ALV-laskentaa
- asiakkaan valintasääntöjä
- taloyhtiö- tai isännöitsijälogiikkaa
- domain-tilasiirtymiä
- API-, Firebase-, backend- tai tietokantakutsuja
- feature-hookeja
- permission-päätöksiä
- domain-validointia
- käyttäjälle näkyviä featurekohtaisia tekstejä

Esimerkiksi `CustomerPicker`, `InvoiceRowsEditor` ja
`ApprovedInvoiceEmailPreview` pysyvät featureissä. Niiden sisällä käytetty
tekninen Button tai FormField voi myöhemmin tulla `shared/ui`-kerroksesta.

## `packages/ui`-Päätöspiste

`packages/ui` voidaan arvioida erillisellä päätöksellä vasta, kun:

- Ekyllä on vähintään kaksi itsenäistä UI-sovellusta
- sama vakaa primitiivi tarvitaan niissä molemmissa
- paketin React-, build-, CSS- ja testiriippuvuudet on hyväksytty
- siirto ei pakota featurelogiikkaa pakettiin
- paketille on selkeä julkinen API ja omistajuus

Siirtoa ei tehdä varmuuden vuoksi eikä siksi, että skeleton-paketti on jo
olemassa.

## Vaikutus Tuleviin Moduuleihin

Rajattu webin sisäinen UI-perusta auttaa tulevia Sites-, Work Orders-, Work
Entries-, Materials- ja Settings-näkymiä säilyttämään saman työohjelmamaisen
käyttökokemuksen.

Featureiden liiketoimintakomponentit pysyvät silti omissa moduuleissaan. Näin
jaettu UI vähentää teknistä toistoa ilman, että moduulien omistajuus hämärtyy.
