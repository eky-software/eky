# Reporting-moduuli

Tämä dokumentti kuvaa raportointimoduulin alustavan suunnan.

Reporting ei omista lähdedataa, vaan koostaa tietoja muista moduuleista.

## Tarkoitus

Reporting-moduuli tarjoaa näkymiä ja raportteja yrityksen toiminnasta.

## Mahdollisia vastuita

- laskutusraportit
- asiakasraportit
- työmaakohtaiset raportit
- työntekijäkohtaiset tuntiraportit
- materiaaliraportit
- dashboardit
- vienti Exceliin tai PDF:ään

## Moduuli ei omista

- asiakkaita
- laskuja
- tuntikirjauksia
- materiaalikirjauksia
- varastosaldoja

Reporting lukee muiden moduulien tarjoamaa dataa.

## Tärkeitä käsitteitä

- Report
- Dashboard
- Metric
- Export
- ReportFilter

## Turvallisuus

Raportit voivat paljastaa paljon liiketoimintakriittistä dataa.

Backend tarkistaa, mitä raportteja käyttäjä saa nähdä.

Käyttäjän rooli ja yritysrajaus huomioidaan aina.

## Avoimet kysymykset

- mitä raportteja tarvitaan ensimmäisenä?
- tarvitaanko Excel-vienti?
- tarvitaanko PDF-vienti?
- kuka saa nähdä talousraportteja?
- kuka saa nähdä työntekijäkohtaisia raportteja?
- tarvitaanko dashboard pääkäyttäjälle?