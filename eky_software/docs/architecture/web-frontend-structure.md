# Web frontend structure

Tämä dokumentti määrittelee `apps/web/src`-kansion perusrakenteen.

Tavoitteena on erottaa käyttöliittymän toiminnalliset moduulit, sovelluksen kokoaminen ja pienet jaetut apukokonaisuudet toisistaan.

## Rakenne

```text
apps/web/src/
  app/
    App.tsx

  features/
    customers/
    companySettings/
    invoicing/
      components/
      hooks/
      form/
      drafts/
      preview/
      state/

  shared/
    money/

  layout/
  i18n/
  styles.css
  main.tsx
```

## App

`app/` kokoaa web-sovelluksen.

Se valitsee aktiivisen näkymän ja yhdistää feature-moduulit yleiseen layoutiin.

Varsinaista feature-kohtaista logiikkaa ei siirretä `app/`-kansioon.

## Features

`features/` sisältää käyttöliittymän suuret toiminnalliset moduulit.

Nykyiset feature-moduulit:

- `features/customers`
- `features/companySettings`
- `features/invoicing`

Feature omistaa oman näkymänsä, paikalliset komponenttinsa, hookinsa, lomakemallinsa ja feature-kohtaiset puhtaat apufunktionsa.

Feature ei saa importata backendin sisäisiä moduuleja tai kirjoittaa suoraan tietokantaan. Backend-yhteys kulkee `packages/api-client`-paketin kautta.

## Feature-kansion Sisäinen Rakenne

Kun feature kasvaa useampaan tiedostoon, se jaetaan vastuiden mukaan
alikansioihin.

Suositeltu malli:

```text
apps/web/src/features/<feature>/
  components/
  hooks/
  form/
  drafts/ tai list/
  preview/
  state/
```

Kansioiden tarkoitus:

- `components/` sisältää React-komponentit ja niiden vieressä olevat komponenttitestit
- `hooks/` sisältää feature-kohtaiset React-hookit, kuten datan latauksen tai tallennuksen ohjauksen
- `form/` sisältää lomakkeen tilamallit, validoinnin, mappingin ja hydration-muunnokset
- `drafts/` tai `list/` sisältää feature-kohtaisen lista- ja näyttölogiikan, kuten formatoinnin
- `preview/` sisältää paikalliset esikatselut, jotka eivät ole backendin auktoritatiivista liiketoimintalogiikkaa
- `state/` sisältää näkymän reducerit ja paikalliset tilakoneet

Kaikkia alikansioita ei luoda ennakkoon. Ne luodaan vasta, kun featurellä on
oikea tarve kyseiselle vastuulle.

Yksittäisen feature-tiedoston ei pidä kasvaa monen vastuun kokoelmaksi. Kun
tiedostossa alkaa olla esimerkiksi komponenttirakenne, lomakemapping,
validointi ja datalataus samassa paikassa, vastuut erotetaan ennen seuraavaa
ominaisuustyötä.

## Feature-testit

Yksikkö- ja komponenttitestit pidetään testattavan tiedoston vieressä.

Esimerkiksi:

```text
form/invoiceDraftFormMapping.ts
form/invoiceDraftFormMapping.test.ts

components/InvoiceDraftList.tsx
components/InvoiceDraftList.test.tsx
```

Kun tiedosto siirretään alikansioon, sitä vastaava testi siirretään mukana.

Älä luo web-featureille juureen peilattua `tests/`-kansiota yksikkötestejä
varten.

E2E- ja laajemmat integraatiotestit voidaan myöhemmin pitää erillisissä
kansioissa, jos niille syntyy todellinen tarve.

## CSS

`apps/web/src/styles.css` sisältää vain globaalit perusasiat:

- reset- ja body-tyylit
- CSS-muuttujat
- sovelluksen yleisen layoutin
- yleiset painike-, panel-, message- ja status-pill-tyylit

Komponenttien omat tyylit sijoitetaan komponentin viereen
`ComponentName.module.css`-tiedostoon.

Esimerkki:

```text
components/InvoiceDraftList.tsx
components/InvoiceDraftList.module.css
```

CSS Module on feature- tai komponenttikohtainen. Sitä ei käytetä uutena
yleisenä design systeminä eikä sen vuoksi lisätä UI- tai CSS-kirjastoja.

Komponenttikohtaista tyyliä ei jätetä pysyvästi globaaliin `styles.css`-tiedostoon, jos tyyli kuuluu selvästi vain yhteen featureen tai komponenttiin.

## Shared

`shared/` sisältää vain pieniä, tarkasti rajattuja ja useamman web-featuren käyttämiä apukokonaisuuksia.

Esimerkiksi `shared/money/hourlyRateInput.ts` muuntaa web-lomakkeiden tuntihintasyötteen eurojen ja senttien välillä.

`shared/` ei ole uusi yleinen utils-kansio.

Älä luo:

- `shared/utils.ts`
- `shared/helpers.ts`
- `shared/common.ts`
- epämääräisiä kaikkea palvelevia apukansioita

Jos apu kuuluu vain yhteen featureen, se pidetään kyseisen featuren sisällä.

## Layout ja i18n

`layout/` sisältää sovelluksen yleisen kehyksen, kuten sivupalkin ja yläpalkin.

`i18n/` sisältää käyttäjälle näkyvien käyttöliittymätekstien nykyisen kevyen kielirakenteen.

Layout tai i18n ei omista feature-kohtaista liiketoimintalogiikkaa.

## Kasvupolku

Uusi suuri web-toiminnallisuus lisätään ensisijaisesti omaksi `features/<featureName>`-kokonaisuudekseen.

Apua ei nosteta `shared/`-kansioon ennakolta. Siirto tehdään vasta, kun vastuu on tarkka ja sama pieni tarve on aidosti yhteinen usealle featurelle.

Ulkoisia riippuvuuksia tai `packages/*`-paketteja ei lisätä tämän rakenteen vuoksi.
