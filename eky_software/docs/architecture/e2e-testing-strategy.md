# E2E-testausstrategia

Tämä dokumentti määrittelee Eky R0:n tulevan E2E-työpaketin C. Tässä
observability-työpaketissa ei lisätä Playwrightia eikä uusia riippuvuuksia.

## Testitasot

- Playwright web: laajat selainpohjaiset käyttäjäpolut.
- Playwright Electron development: rajatut main/preload/renderer-
  integraatiopolut.
- Hardened packaged `Eky.exe`: packaged smoke-, recovery- ja capability-testit.

Packaged Electron fuseja tai window security -asetuksia ei heikennetä
Playwrightin vuoksi. Jos hardened-artifactia ei voida ohjata turvallisesti,
testi tehdään development-profiililla ja production-artifactille erillisellä
smoke/recovery-polulla.

## Eristys

Jokainen E2E-worker saa omat:

- SQLite-tietokannan
- PDF-varaston
- operational/security-lokihakemiston
- temp- ja support bundle -hakemiston
- synteettisen testidatan

E2E ei käytä oikeaa SMTP:tä, ulkoista verkkoa, oikeita salaisuuksia,
asiakastietoja tai laskuja.

## Matriisin sisältö

Jokaiselle moduulille dokumentoidaan:

- tavalliset käyttäjäpolut
- validointi- ja permission-estot
- väärä yrityskonteksti
- idempotenssi ja toistuvat komennot
- selainrefresh ja desktop restart
- tietokanta-, levy-, PDF-, SMTP- ja lokikirjoitusvirheet
- mahdottomat UI-tilat suoran API-kutsun kautta
- recovery keskeneräisen transaktion, katkenneen JSONL-rivin ja väliaikaisen
  tiedoston jälkeen
- varmistus, ettei virhevastauksessa, lokissa tai tukipaketissa ole salaisuutta
  tai tarpeetonta henkilötietoa

## Observabilityn E2E

Työpaketti C kattaa vähintään:

- business-muutoksen ja activity feed -eventin vastaavuuden
- lokien kuukausirajan ja retentionin hallitulla testikellolla
- permission-rajatun diagnostics-näkymän
- turvallisen lokikansion avauksen desktopissa
- tukipaketin luonnin, peruutuksen ja checksumit
- rikkinäisen lokirivin ohittamisen
- lokikirjoitusvirheen siten, ettei alkuperäinen business-tulos muutu
- packaged smoke -tarkistuksen logs-rootille ja salaisuuksien poissululle

## Riippuvuuspäätös

Playwright tai muu E2E-riippuvuus arvioidaan ja hyväksytään erikseen ennen
asennusta. Tämä dokumentti ei ole riippuvuuden hyväksyntä.
