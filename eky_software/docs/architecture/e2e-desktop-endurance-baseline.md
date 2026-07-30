# Desktop endurance -vertailutaso

Tämä dokumentti määrittää Eky Localin käsin ajettavat Electron stress- ja
soak-testit. Testit käyttävät vain synteettistä dataa, eristettyä
loopback-backendia ja ajokohtaista temp-juurta.

Testit eivät kuulu tavalliseen pull request -CI:hin. Niitä ei saa ajaa oikeaa
AppData-hakemistoa, oikeaa SQLite-kantaa, oikeita SMTP-tunnuksia tai ulkoista
verkkoa vasten.

## Komennot

Rajattu työkuormavertailu:

```text
pnpm test:e2e:desktop-stress
```

Manuaalinen 30 minuutin soak:

```text
pnpm test:e2e:desktop-soak
```

`EKY_E2E_SOAK_DURATION_MINUTES` voi olla paikallisessa validoinnissa
kokonaisluku väliltä 1-240. Oletus on 30 minuuttia. Tavallinen CI ei aseta
arvoa eikä aja soak-testiä.

## Stress-työkuorma

`DESK-ENDURANCE-001` tekee yhdessä eristetyssä desktop-ajossa:

- 200 päämoduulin näkymäsiirtymää
- 50 hyväksytyn laskun detail-avausta
- 100 PDF-esikatselun avaus- ja sulkemissykliä
- 20 tukipaketin luontia
- 30 synteettisen SMTP-salaisuuden asetus- ja poistosykliä
- 20 hallittua Electron- ja backend-runtime-uudelleenkäynnistystä.

Testi varmistaa lopussa vähintään:

- backend vastaa terveenä
- avoinna on vain pääikkuna eikä PDF-esikatseluja
- Electronin prosessimäärä on hallittu
- salaisuustiedostoa ei jää poistamisen jälkeen
- synteettinen salaisuus ei näy operational-lokeissa
- SQLite-, dokumentti- ja lokimittaukset eivät ole tyhjiä
- tukipaketti syntyy vain testin omistamaan polkuun.

## Mitattava raportti

Molemmat testit kirjoittavat synteettisen JSON-raportin
`apps/e2e/test-results/`-hakemistoon ja Playwright-liitteeksi. Raportissa on:

- kokonaiskesto ja toteutuneet kierrosmäärät
- Electron-prosessien määrä
- ikkunoiden määrä
- Electron-prosessien yhteenlaskettu working set
- backendin tila
- SQLite-, dokumentti- ja lokihakemistojen koot.

Raportti ei sisällä runtime-sessionia, salaisuutta, prosessin muistisisältöä,
komentoriviä, ympäristömuuttujia tai asiakastietoa. `test-results` ei ole
versionhallinta- tai tuotantodatakansio.

## Ensimmäinen Windows-vertailu

Ensimmäinen täysi stress-ajo tehtiin Electron 42.8.0:lla Windowsissa
30.7.2026:

| Mittari | Tulos |
| --- | ---: |
| Kesto | 62 615 ms |
| Prosesseja alussa / lopussa | 5 / 5 |
| Ikkunoita lopussa | 1 |
| Working set alussa | 467 348 KiB |
| Working set lopussa | 456 200 KiB |
| SQLite | 352 256 B |
| PDF-dokumentit | 3 290 B |
| Lokit | 143 956 B |

Yhden minuutin soak-polun validointi teki 133 työkiertoa, 13 restartia ja 26
tukipakettia. Se todensi keston ohjauksen ja raportoinnin, mutta ei korvaa
varsinaista 30 minuutin vertailuajoa.

## Tulkinta

Ensimmäisestä ajosta ei aseteta tiukkaa RSS-rajaa. Electronin working set
riippuu käyttöjärjestelmästä, Chromiumista ja ajoituksen vaiheesta. Hälyttäviä
merkkejä ovat sen sijaan:

- prosessi- tai ikkunamäärä ei palaudu
- backend-portti tai vanha runtime-session jää käyttöön
- muistinkäyttö kasvaa toistuvissa vertailuajoissa ilman tasaantumista
- SQLite-, dokumentti- tai lokikoko kasvaa ilman työkuorman selitystä
- salaisuus tai henkilötieto päätyy raporttiin tai lokiin
- testi jättää prosesseja tai testihakemistoja käyttöön.

Varsinainen 30 minuutin ajo tehdään ennen ensimmäistä oikean datan
käyttöönottoa ja merkittävän Electron-, SQLite-, PDF-, safeStorage- tai
runtime-elinkaarimuutoksen jälkeen.
