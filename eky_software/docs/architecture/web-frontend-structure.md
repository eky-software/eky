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

Feature omistaa oman näkymänsä, paikalliset komponenttinsa, lomakemallinsa ja feature-kohtaiset puhtaat apufunktionsa.

Feature ei saa importata backendin sisäisiä moduuleja tai kirjoittaa suoraan tietokantaan. Backend-yhteys kulkee `packages/api-client`-paketin kautta.

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
