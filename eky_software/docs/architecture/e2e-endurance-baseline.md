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
`apps/e2e/test-results/run-<uuid>/endurance-baseline.json` ja HTML-raportin
`endurance-baseline`-liitteeseen.

## Ensimmäinen mitattu ajo

Ensimmäinen rajattu vertailuajo läpäisi 29.7.2026 yllä kuvatun synteettisen
työkuorman ja prosessien siivouksen. Tämä on historiallinen hyväksyntätila,
ei nykyisen revision testitulos tai väite CI-suoritusympäristöstä.

Yksittäisen ajon muistilukemasta ei johdeta absoluuttista hyväksymisrajaa.
Mahdollinen raja päätetään vasta useamman toistettavan ajon ja todellisen
käyttöprofiilin perusteella. Testi epäonnistuu heti, jos työkuorma,
prosessi-cleanup, loopback-raja, PDF-polku, Diagnostics tai tukidata rikkoutuu.

## Tulkinta

Vertailuarvoja verrataan saman käyttöjärjestelmän ja vastaavan runtime-version
ajoihin. Poikkeama tutkitaan, mutta pelkkä ympäristöstä johtuva lukeman muutos ei
ole automaattisesti tuotantovirhe.

Desktopin [toteutettu stress ja pitkä soak](e2e-desktop-endurance-baseline.md)
ovat tästä erillisiä tarkistuksia. Oikea SMTP, backup/restore ja suuri
oikeaa käyttöä muistuttava datamäärä eivät kuulu tähän baselineen;
niiden omat päätös- ja release-portit säilyvät.
