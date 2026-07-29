# E2E endurance -vertailutaso

Tämä dokumentti tallentaa Eky Localin ensimmäisen rajatun
endurance-vertailutason. Testi on regressioiden vertailupiste, ei
tuotantokapasiteetin tai suurimman sallitun muistinkäytön lupaus.

## Komento

```text
pnpm test:e2e:stress
```

Komento ajetaan käsin. Sitä ei ajeta jokaisessa pull requestissa tai tavallisessa
CI-verify-jobissa.

Testi käyttää vain synteettistä dataa, loopback-verkkoa, fake-provideria ja
eristettyä käyttöjärjestelmän temp-hakemistoa. Testi ei käytä oikeaa SMTP:tä tai
ulkoista verkkoliikennettä.

## Työkuorma

- 20 hallittua backend start/stop -kierrosta
- 100 asiakkaan create/update/list -kierrosta
- 100 laskuluonnoksen create/update/read -kierrosta
- 50 web-moduulisiirtymää Chromiumissa
- 25 hyväksyntää ja PDF-generation-kierrosta paikallisella storage-polulla
- Diagnostics- ja support bundle data -yhteenvedon tarkistus
- tunnettujen asiakasarvojen poissulku operational-lokeista
- kaikkien testin käynnistämien backend- ja web-prosessien päättymisen tarkistus

Playwright tallentaa jokaisen ajon mittaukset tiedostoon
`apps/e2e/test-results/endurance-baseline.json` ja HTML-raportin
`endurance-baseline`-liitteeseen.

## Ensimmäinen mitattu ajo

Ensimmäinen vertailuajo tehtiin 29.7.2026 Windows-kehitysympäristössä Node
24 -runtimea käyttäen.

| Mittaus | Tulos |
|---|---:|
| Kokonaiskesto | 29 425 ms |
| Backend RSS alussa | 93 884 416 tavua |
| Backend RSS työkuorman jälkeen | 126 046 208 tavua |
| SQLite-kannan koko | 696 320 tavua |
| PDF-dokumenttien koko yhteensä | 81 155 tavua |
| Operational-lokien koko | 2 884 tavua |
| Avoimia testin hallitsemia prosesseja lopussa | 0 |

Yksittäisen ajon muistilukemasta ei johdeta vielä absoluuttista hyväksymisrajaa.
Mahdollinen raja päätetään vasta useamman toistettavan ajon ja todellisen
käyttöprofiilin perusteella. Testi epäonnistuu kuitenkin heti, jos työkuorma,
prosessi-cleanup, loopback-raja, PDF-polku, Diagnostics tai tukidata rikkoutuu.

## Tulkinta

Vertailuarvoja verrataan saman käyttöjärjestelmän ja vastaavan runtime-version
ajoihin. Poikkeama tutkitaan, mutta pelkkä ympäristöstä johtuva lukeman muutos ei
ole automaattisesti tuotantovirhe.

Desktopin pitkä soak, oikea SMTP, backup/restore ja suuri oikeaa käyttöä
muistuttava datamäärä eivät kuulu tähän baselineen. Ne pysyvät erillisinä
suunniteltuina release-tarkistuksina.
