# E2E-testausstrategia

Tämä dokumentti määrittelee Eky R0:n system-, selain-, Electron development-
ja packaged-smoke-testitasot. Pysyvä skenaarioluettelo on
`r0-e2e-test-matrix.md`-tiedostossa ja turvallinen runtime
`e2e-test-environment.md`-tiedostossa.

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

Projektin omistaja on hyväksynyt `@playwright/test`-paketin täsmälleen
versiona `1.61.1` vain `apps/e2e`-testipakettiin sekä sen Chromium-
testibinäärin. Selainbinääri ei kuulu Eky.exe-artifactiin.

Hyväksyntä ei kata erillistä `playwright`- tai `playwright-core`-lisäystä eikä
mitään muuta testikirjastoa. Jos Electron-rajapinta ei ole käytettävissä
hyväksytyn paketin kautta, työ pysäytetään ennen uuden riippuvuuden lisäämistä.

## Definition of Done

Uusi moduuli tai merkittävä ominaisuus lisää matriisiin vähintään onnistuvan
polun, permission-/tenant-eston ja failure-/recovery-polun. Cross-module-polku
ja packaged-turvaraja lisätään silloin, kun muutos niitä koskee.

Invariantit, laskenta, validointi, atomisuus ja laajat rajataulukot testataan
edelleen alimmalla sopivalla tasolla. E2E-tapaukset valitaan
luottamusrajoista, tilakoneista, sivuvaikutuksista ja todellisista
rikkoutumistavoista; niitä ei kasvateta satunnaisilla variaatioilla.
