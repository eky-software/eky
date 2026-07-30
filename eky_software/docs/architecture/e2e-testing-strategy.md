# E2E-testausstrategia

Tämä dokumentti määrittelee Eky R0:n system-, selain-, Electron development-
ja packaged-smoke-testitasot. Pysyvä skenaarioluettelo on
`r0-e2e-test-matrix.md`-tiedostossa ja turvallinen runtime
`e2e-test-environment.md`-tiedostossa.

## Testitasot

- Playwright system API: HTTP-, session-, persistence-, fault- ja
  recovery-rajat ilman selain-UI:ta.
- Playwright web: laajat selainpohjaiset käyttäjäpolut.
- Playwright Electron development: rajatut main/preload/renderer-
  integraatiopolut.
- Hardened packaged `Eky.exe`: packaged smoke-, recovery- ja capability-testit.
- Manuaalinen endurance-baseline: rajattu pitkäkestoisempi system- ja
  web-työkuorma sekä erillinen Electron stress- ja soak-työkuorma ilman
  tuotantodataa tai ulkoista verkkoa.

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

## Nykyinen selain- ja recovery-kattavuus

Nykyinen Playwright-kokonaisuus todistaa eristetyssä runtimessa:

- Customers- ja Company Settings -käyttäjäpolut, refreshin sekä turvallisen
  Activity- ja Diagnostics-projektion
- laskuluonnoksen elinkaaren, snapshotin, käännetyn ALV:n, peruutuksen,
  osahyvityksen, refreshin ja kaksoiskomentojen sivuvaikutusrajat
- fake SMTP-, PDF-storage-, tietokantatransaktio- ja operational writer
  -virheet
- backend-restartin, runtime-sessionin kierron, SQLite-lockista toipumisen,
  katkenneen JSONL-rivin sekä prosessin ja loopback-portin vapautumisen
- hostile markup -tekstin turvallisen DOM- ja PDF-käsittelyn ilman ulkoista
  verkkoliikennettä.

Electron development -E2E kattaa nyt preload-rajan, navigoinnin,
permission-pyynnöt, yhden instanssin, PDF-esikatselun, safeStorage-salaisuuden,
tukipaketin, lokikansion, restartin sekä backendin odottamattoman ja
käynnistysvaiheen virheen. Packaged smoke säilyy erillisenä hardened-
artifactin porttina. Täydellinen backup/restore- ja tenant-matriisi sekä
30 minuutin Electron-soakin ensimmäinen vertailuajo ovat vielä erillisiä
release-checkpointeja.

## Observabilityn E2E

Nykyinen system- ja web-E2E kattaa:

- business-muutoksen ja activity feed -eventin vastaavuuden
- permission-rajatun diagnostics-näkymän
- rikkinäisen lokirivin ohittamisen ja tukidatan rehellisen truncation-tilan
- lokikirjoitusvirheen siten, ettei alkuperäinen business-tulos tai pakollinen
  audit muutu
- fake provider -virheiden turvalliset Diagnostics- ja support-projektiot.

Lokien kuukausiraja ja retention testataan alemmilla tasoilla.
Lokikansion avaaminen ja varsinaisen `.json.gz`-tukipaketin luonti sekä
checksumit säilyvät desktopin integraatio- ja packaged-smoke-vastuina.

## CI ja endurance

GitHub CI ajaa pull requesteissa, `main`-pusheissa ja käsin käynnistettynä:

- eristetyn system security E2E -joukon
- Chromiumin kriittiset web-käyttäjäpolut yhdellä workerilla
- Windows-paketoinnin, packaged smoken ja kriittiset Electron development
  -käyttäjäpolut yhdellä workerilla.

Playwright-jobit käyttävät yhtä CI-retryä vain trace-todisteen keräämiseen ja
`failOnFlakyTests`-asetusta, joten retryllä vasta läpäisevä testi epäonnistaa
jobin. Raskaita E2E-jobeja ei ajeta erikseen jokaisessa `antsa`-pushissa.

`pnpm test:e2e:stress` on manuaalinen, eikä kuulu jokaiseen pull requestiin.
System/web-työkuorma ja ensimmäiset vertailuarvot on dokumentoitu tiedostossa
`e2e-endurance-baseline.md`. Electronin rajattu stress-baseline ajetaan
komennolla `pnpm test:e2e:desktop-stress` ja 30 minuutin manuaalinen soak
komennolla `pnpm test:e2e:desktop-soak`. Desktop-mittarit ja tulkintasäännöt
ovat tiedostossa `e2e-desktop-endurance-baseline.md`.

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
