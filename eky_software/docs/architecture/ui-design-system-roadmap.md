# UI Design System Roadmap

Tämä dokumentti kirjaa Eky-webin jaettujen UI-komponenttien kasvupolun.

Nykyinen UI-koodi toimii MVP-vaiheessa, mutta lomakkeissa, napeissa,
paneeleissa, kentissä, virheviesteissä ja CSS Module -rakenteissa on alkanut
näkyä toistoa. Tämä ei riko ohjelmaa nyt, mutta se kasvattaa ylläpitokustannusta
seuraavien isojen UI-moduulien kohdalla.

## Nykyinen Tila

`packages/ui` on vielä skeleton-paketti. Siihen ei ole lisätty React-riippuvuutta
eikä varsinaisia komponentteja.

Web-sovelluksen featuret omistavat edelleen omat komponenttinsa:

- `Customers`
- `Company Settings`
- `Invoicing`

Tämä on ollut oikea ratkaisu MVP-vaiheessa, koska featureiden vastuut ja
käyttölogiikka ovat vielä tarkentuneet nopeasti.

## Havaittu Toisto

Samankaltaisia UI-rakenteita näkyy jo useissa tiedostoissa, esimerkiksi:

- `CustomerForm`
- `CompanySettingsForm`
- `NewInvoiceForm`
- `InvoiceBasicInfoSection`
- `InvoicePaymentSettingsForm`
- muut laskutuksen lomakeosat

Toistuvia rakenteita ovat muun muassa:

- button
- input
- select
- textarea
- label
- fieldset
- legend
- help text
- error text
- panel
- panel header
- actions/footer
- message/error/success-rakenteet
- CSS Module -luokat kuten field, grid, actions, help ja error

## Riski Jos Tätä Ei Korjata

Jos myöhemmin halutaan muuttaa kaikkien nappien ulkoasua, kenttien
virheviestien tyyliä, lomakkeiden välejä tai paneelien rakennetta, muutos
joudutaan tekemään monesta feature-tiedostosta.

Toisto myös vaikeuttaa uusien moduulien rakentamista, koska jokainen uusi
moduuli voi alkaa kopioida omaa hieman erilaista lomake- ja panelirakennetta.

## Miksi Refaktorointia Ei Tehdä Heti Kesken Feature-työn

Jaettua UI-pakettia ei rakenneta kesken laskutuksen PDF- tai print-polun, koska
se voisi sotkea feature-työn fokuksen ja tuoda uuden riippuvuuspäätöksen liian
aikaisin.

Ensin viimeistellään laskutuksen PDF-polku vakaaksi. Sen jälkeen voidaan tehdä
lyhyt, rajattu UI-refaktorointisprintti ennen seuraavaa isoa UI-moduulia, kuten
työmääräyksiä.

## Suositeltu Ajoitus

1. Viimeistellään laskutuksen PDF-polku vakaaksi.
2. Tehdään tarvittavat pienet dokumentaatio- ja rakennecleanupit.
3. Ennen työmääräysmoduulia tai muuta isoa uutta UI-kokonaisuutta tehdään
   `packages/ui`-paketin ensimmäinen vaihe.
4. Uudet moduulit käyttävät sen jälkeen yhteisiä UI-komponentteja heti alusta.

## Ensimmäisen Vaiheen Komponentit

Ensimmäinen `packages/ui`-vaihe pidetään pienenä.

Mahdollisia ensimmäisiä komponentteja:

- `Button`
- `TextField`
- `SelectField`
- `TextareaField`
- `FormField`
- `Panel`
- `PageHeader`
- `Message`
- `EmptyState`

Tarkoitus ei ole rakentaa isoa design systemiä kerralla. Komponentti lisätään
vasta, kun sillä poistetaan todellista toistoa useasta näkymästä.

## Mitä `packages/ui` Saa Sisältää

`packages/ui` saa sisältää vain yleisiä teknisiä UI-komponentteja.

Sallittuja vastuita:

- perusnappi
- tekstikenttä
- valintakenttä
- tekstialue
- kentän label/help/error-rakenne
- panelirakenne
- sivuotsikon tekninen rakenne
- yleinen viesti- tai tyhjä tila

## Mitä `packages/ui` Ei Saa Sisältää

`packages/ui` ei saa sisältää:

- laskutuslogiikkaa
- ALV-laskentaa
- asiakkaan valintasääntöjä
- taloyhtiö/isännöitsijälogiikkaa
- API-kutsuja
- Firebase-kutsuja
- backend- tai tietokantalogiikkaa
- feature-hookeja
- domain-validointia
- moduulien sisäisiä sääntöjä

Feature-kohtaiset komponentit pysyvät featureissä.

Esimerkkejä:

- `CustomerPicker` ei lähtökohtaisesti kuulu `packages/ui`-pakettiin, koska siinä
  on asiakas- ja laskutuskontekstia.
- `InvoiceRowsEditor` ei kuulu `packages/ui`-pakettiin, koska se on laskutuksen
  oma toiminnallinen komponentti.
- `TextField`, `Button` ja `FormField` voivat kuulua `packages/ui`-pakettiin,
  koska ne eivät tunne liiketoimintaa.

## Vaikutus Tuleviin Moduuleihin

Kun ensimmäinen `packages/ui`-vaihe on tehty, uudet isot UI-moduulit voivat
käyttää samoja perustyökaluja heti alusta.

Tämä tukee erityisesti tulevia moduuleita:

- Sites / Kohteet
- Work Orders / Työmääräykset
- Work Entries
- Materials
- laajemmat Settings-näkymät

Näin Eky säilyttää yhtenäisen työohjelmamaisen käyttöliittymän ilman, että
liiketoimintalogiikkaa nostetaan väärään jaettuun pakettiin.
