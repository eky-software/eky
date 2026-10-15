# Desktop endurance -vertailutaso

Tämä dokumentti määrittää Eky Localin käsin ajettavat Electron stress- ja
soak-testit. Testit käyttävät vain synteettistä dataa, eristettyä
loopback-backendia ja ajokohtaista temp-juurta.

Testit eivät kuulu tavalliseen pull request -CI:hin. Niitä ei saa ajaa oikeaa
AppData-hakemistoa, oikeaa SQLite-kantaa, oikeita SMTP-tunnuksia tai ulkoista
verkkoa vasten.

## Nykyinen työtilamittaus

Moniyritysmallissa tietokanta, laskudokumentit ja SMTP-salaisuustiedosto
luetaan testin aktiivisesta workspacesta yhteisen
`readElectronE2eActiveWorkspace`-apurin avulla. Operational-lokit pysyvät
asennuskohtaisina. Stress ja soak käyttävät samaa mittauspolkujen ratkaisua;
puuttuvaa tai virheellistä workspace-rekisteriä ei korvata vanhalla
yhden yrityksen polulla. `SYS-DESKTOP-ENDURANCE-PATHS-001` suojaa polkujen
valinnan, mutta ei korvaa oikeaa kuormitusajoa. T3-kierroksen
[revisiokohtainen näyttö](e2e-test-environment-history.md#windows-electronin-endurance-ja-virheen-säilymisen-loppunäyttö)
pidetään erillään alla olevista historiallisista vertailuista.
Nykyinen hyväksytty lähtörevisio ja seuraava työ ovat
[M1:n jatkamiskohdassa](release-0.3.0-m1-preparation-plan.md#jatka-tästä).

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

Ensimmäinen täysi stress-ajo läpäisi 30.7.2026 projektin Electron 42.8.0
-runtimella yllä kuvatun työkuorman ja lopputilan ehdot. Yhden minuutin
soak-polun validointi todensi keston ohjauksen ja raportoinnin, mutta ei
korvannut varsinaista 30 minuutin vertailuajoa.

## Ensimmäinen 30 minuutin Windows-soak

Ensimmäinen täysi 30 minuutin soak läpäisi 31.7.2026 commitilla
`a58718aea394f6007adbe697928523a793bb343f` ja projektin Electron 42.8.0
-runtimella. Edeltävät kaksi puhdasta GitHub Windows Electron critical
-ajoa olivat erillisiä todisteita; niitä ei pidä sekoittaa soak-ajon
suoritusympäristöön tai myöhemmän revision hyväksyntään.

Yksi vertailuajo ei osoita muistivuotoa tai määritä yleistä muistirajaa.
Seuraavissa ajoissa arvioidaan erityisesti, palautuvatko prosessi- ja
ikkunamäärät sekä tasaantuuko working set samanlaisella työkuormalla.

## Electron 43 -yhteensopivuusvertailu

Projektin Electron `43.2.0`- ja better-sqlite3 `13.0.2`
-yhteensopivuuspäivityksen stress- ja täysi 30 minuutin soak-vertailu
läpäisivät 3.8.2026. Stress-työkuorma säilyi samana kuin yllä:
näkymäsiirtymät, laskun avaukset, PDF-esikatselut, tukipaketit,
salaisuuskierrot ja runtime-restartit. Lopputilan prosessi-, ikkuna-,
backend- ja salaisuusehdot täyttyivät.

Nämä ovat rajattuja historiallisia hyväksyntöjä, eivät nykyisen revision
tuloksia tai yleisiä suorituskyky- ja muistirajoja. Aikarajatussa testissä
toteutunut kierrosmäärä voi vaihdella; vertailumenetelmä ja työkuorman
sisältö on säilytettävä samoina.

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

30 minuutin ajo toistetaan ennen ensimmäistä oikean datan käyttöönottoa ja
merkittävän Electron-, SQLite-, PDF-, safeStorage- tai
runtime-elinkaarimuutoksen jälkeen.
