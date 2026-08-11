# Testausohjeet

Tämä dokumentti määrittelee Eky-projektin testauksen periaatteet.

Testauksen tavoite on varmistaa, että liiketoimintasäännöt, turvallisuuskriittiset polut ja moduulirajat toimivat oikein.

## Testauksen pääperiaatteet

Testaa ensisijaisesti sääntöjä, laskentaa, tilasiirtymiä ja kriittisiä työnkulkuja.

Älä testaa vain sitä, että komponentti renderöityy, jos testillä ei ole todellista arvoa.

Pidä testit luettavina ja kohdistettuina.

Onnistuva normaalipolku ei yksin riitä kriittiselle toiminnolle. Testeissä
huomioidaan riskin mukaan myös virheelliset syötteet, raja-arvot, odottamattomat
toimintajärjestykset, toistuvat pyynnöt, käyttöoikeuksien puuttuminen,
yritysrajan ylitysyritykset ja turvalliset virhevastaukset.

Poikkeavia tapauksia ei testata satunnaisesti vain testimäärän kasvattamiseksi.
Testit johdetaan toiminnon luottamusrajoista, liiketoimintasäännöistä ja
todellisista väärinkäyttö- tai rikkoutumistavoista.

## Checkpoint-Pohjainen Testikadenssi

Laaja ominaisuus jaetaan toiminnallisiin checkpointteihin. Jokaisen checkpointin
jälkeen ajetaan muuttuneeseen vastuuseen suoraan kohdistuvat testit. Näin
virhe paikantuu pieneen muutokseen eikä työn loppuun kerätä tietoisesti
rikkinäistä välitilaa.

Testikadenssi suhteutetaan riskiin:

- jokaisen toiminnallisen checkpointin jälkeen ajetaan muuttuneiden tiedostojen,
  käyttötapausten, reittien, adapterien ja komponenttien kohdetestit
- koko workspacen testit, typecheck ja tarvittavat buildit ajetaan, kun
  checkpointit muodostavat yhden eheän toiminnallisen kokonaisuuden
- riskiin perustuvat system-, web-, security-, fault- ja critical-E2E-testit
  ajetaan ennen pull requestin valmistumista
- Electron-E2E, Windows-paketointi ja packaged smoke ajetaan vain, kun muutos
  koskee Electronia, desktop-capabilityä, paketointia tai näiden luottamusrajaa
- stress- ja soak-testit ovat erillisiä manuaalisia release-portteja eikä niitä
  ajeta tavallisena checkpoint- tai pull request -testinä
- dokumentaatio-, kommentti- ja selvästi ei-toiminnallinen tyylimuutos voi
  jättää testit ajamatta, kun syy raportoidaan

Jokaisen commitin ei tarvitse ajaa koko E2E-matriisia. Commit ei kuitenkaan saa
olla tietoisesti rikkinäinen: sen oman vastuualueen kohdetestien pitää olla
vihreitä ja julkaistujen sopimusten säilyä käyttökelpoisina.

Checkpoint-kadenssi ei vähennä GitHubin required check -portteja. CI ajaa
edelleen sille dokumentoidut merge-portit riippumatta paikallisen työn
checkpoint-jaosta.

## Testien Sijainti

Yksikkö- ja komponenttitestit pidetään lähtökohtaisesti testattavan tiedoston
vieressä.

Esimerkiksi:

```text
invoiceRowFormState.ts
invoiceRowFormState.test.ts
```

Kun toteutus siirtyy moduulin sisällä, sen testi siirtyy mukana. Yksikkötesteille
ei luoda juureen toteutusrakennetta peilaavaa yleistä `tests/`-kansiota.

Laajemmat integraatio- ja sopimustestit sijoitetaan selkeästi nimettyihin
vastuualueisiin, jos kokonaisuus ei kuulu yhdelle tiedostolle tai moduulille.
Usean kerroksen system-, selain- ja Electron development -E2E-testit kuuluvat
`apps/e2e`-workspaceen. Hardened packaged-artifactin smoke-testit säilyvät
desktop-paketin omistuksessa.

Yleistä `test-utils`-kaatopaikkaa ei luoda. Toistuva testi-infrastruktuuri
irrotetaan vasta todelliseen tarpeeseen ja nimetään vastuun mukaan.

## Mitä testataan aina

Lisää testit aina, kun muutos koskee:

- laskutusta
- rahasummia
- ALV-laskentaa
- laskun tiloja
- käyttöoikeuksia
- domain-logiikkaa
- validointia
- audit trailia
- tietomallin muunnoksia
- kriittisiä työnkulkuja

## Yksikkötestit

Yksikkötestit sopivat erityisesti:

- domain-funktioille
- laskentafunktioille
- validointisäännöille
- permission-säännöille
- mapper-funktioille
- puhtaille apufunktioille

Domain-kerroksen pitää olla helposti yksikkötestattava.

## Integraatiotestit

Integraatiotestejä tarvitaan, kun useampi kerros toimii yhdessä.

Esimerkkejä:

- backend handler -> service -> repository
- API-kutsu ja tietokantakirjoitus
- käyttäjän oikeuksien tarkistus backendissä
- laskuluonnoksen luonti hyväksytyistä riveistä

Integraatiotestit eivät saa käyttää tuotantodataa.

## Frontend-testit

Frontendissä testataan erityisesti:

- käyttäjän kriittinen työnkulku
- lomakkeen validointi
- virhetilojen näyttö
- käyttöoikeuksien vaikutus näkymään
- tärkeät painikkeet ja toimintopolut

Frontendin käyttöoikeustesti ei korvaa backendin käyttöoikeustestiä.

## Turvallisuustestit

Testaa turvallisuuskriittiset tilanteet:

- käyttäjä ei saa nähdä toisen yrityksen dataa
- käyttäjä ei saa tehdä toimintoa ilman oikeutta
- frontendistä lähetetty väärä data hylätään backendissä
- token puuttuu tai on virheellinen
- yritysrajaus `companyId` toimii oikein
- käyttäjän lähettämää `companyId`-arvoa ei luoteta backendin yrityskontekstina
- liian pitkät arvot, väärät tyypit ja sallitut rajat ylittävät numerot hylätään
- SQL-, otsake-, polku- ja lokiinjektion kannalta relevantit syötteet käsitellään turvallisesti
- API ei palauta toisen yrityksen tietoja tai käyttötapaukselle tarpeettomia arkaluonteisia kenttiä
- turvallinen virhevastaus ei paljasta stack tracea, SQL:ää, tiedostopolkuja tai salaisuuksia

Jos autentikointi, permission-malli tai audit trail ei ole vielä toteutettu, testi ei saa teeskennellä niiden olevan kunnossa. Rajaus dokumentoidaan ja toteutusta käytetään vain hyväksytyssä local development -tilassa synteettisellä datalla.

## Automaattinen CI-Tarkistus

GitHub Actions ajaa testit ja staattiset tarkistukset automaattisesti `antsa`-
ja `main`-haarojen push-tapahtumissa sekä `main`-haaraan kohdistuvissa pull
requesteissa.

CI:n vähimmäisportti on:

```text
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm --filter @eky/backend build
pnpm --filter @eky/web build
pnpm --filter @eky/desktop build
```

Pull requesteissa, `main`-pusheissa ja käsin käynnistetyissä workflow-ajoissa
CI ajaa lisäksi eristetyn system security E2E -joukon ja Chromiumin kriittiset
web-käyttäjäpolut. Näitä raskaita E2E-jobeja ei ajeta erikseen jokaisessa
`antsa`-pushissa.

CI täydentää paikallista testausta, mutta ei korvaa sitä. Muutos testataan
paikallisesti ennen commitia silloin, kun paikallinen ympäristö sen sallii.

CI:

- käyttää lukittua lockfilea
- ei käytä tuotanto- tai henkilötietoja
- ei tarvitse sovelluksen salaisuuksia nykyisessä testiputkessa
- saa vain työn tarvitsemat GitHub-oikeudet
- käyttää GitHub Action -toiminnoille lukittuja commit-SHA-versioita
- ei tee deployta eikä kirjoita liiketoimintadataa

Päivittäinen ja käsin käynnistettävä `Dependency security` -workflow ajetaan
jokaisessa `main`-pull requestissa. `main`-pushissa se käynnistyy vain
dependency-polun package manifest-, lockfile-, Dependabot- tai dependency-/CI-
workflow-muutoksista. Workflow täydentää merge-CI:tä ajamalla production- ja
koko riippuvuuspuun auditin sekä rekisteriallekirjoitusten tarkistuksen. Se ei
päivitä riippuvuuksia automaattisesti, käytä `audit --fix` -komentoa tai
kirjoita repositoryyn. Päivittäinen cron on UTC-ajassa eikä seuraa
automaattisesti Europe/Helsinki-kesäaikaa.

Dependabotin avaama päivitys-PR käy läpi saman riskiperusteisen paikallisen ja
CI-testauksen kuin käsin tehty päivitys. Vähimmäisportteina ovat
`Test, typecheck and build`, `System security E2E` ja `Web critical E2E`.
Electron-, native addon- ja Windows-paketointimuutoksissa ajetaan lisäksi
`Windows Electron critical E2E`, Windows package sekä packaged smoke sovitun
testimatriisin mukaan. Samat neljä nimettyä required check -porttia ovat
käytössä, kun muutoksen riskit koskevat kaikkia niiden suojaamia rajoja.

Dependabot version updates syntyy `.github/dependabot.yml`-tiedoston
viikkorytmistä eikä niitä mergeytetä automaattisesti. Security updates ei
käytä tavallisten versionpäivitysten cooldownia. Repositorion omistaja
varmistaa GitHubin `Settings` -> `Security` -> `Advanced Security` -näkymästä
Dependency graph-, Dependabot alerts- ja Dependabot security updates -tilat.
Ilman autentikoitua read-only-varmistusta niiden ei väitetä olevan käytössä.

Vihreä CI ei yksin todista liiketoimintasäännön tai turvallisuusmallin olevan
oikea. Katselmoinnissa tarkistetaan edelleen testien laatu, puuttuvat negatiiviset
tapaukset ja nykyisen local-MVP:n dokumentoidut turvallisuusrajat.

## Testidatan periaatteet

Testidata ei saa sisältää oikeita henkilötietoja, asiakastietoja, laskuja tai salaisuuksia.

Käytä selkeitä testinimiä.

Esimerkkejä:

- `Example Customer Oy`
- `Test Site 1`
- `Invoice Draft A`

## Milloin testi voidaan jättää tekemättä

Testi voidaan jättää tekemättä vain, jos muutos on dokumentaatiota, kommentti, pieni tyylimuutos tai muu selvästi ei-toiminnallinen muutos.

Jos testi jätetään pois toiminnallisesta muutoksesta, syy pitää kertoa.

## AI:n testausvastuu

Kun AI tekee muutoksen, sen pitää arvioida tarvitaanko testi.

Jos muutos koskee kriittistä logiikkaa, AI:n pitää ehdottaa testiä.

Jos testiä ei tehdä, AI:n pitää perustella miksi.

## Valmiin testauksen tarkistus

Ennen kuin muutos katsotaan valmiiksi, tarkista:

- testit kohdistuvat oikeaan asiaan
- testit ovat luettavia
- testit eivät nojaa tuotantodataan
- kriittinen virhepolku on huomioitu
- käyttöoikeudet on testattu backendissä
- domain-logiikka on testattu puhtaasti

## Observability- ja audit-testit

Kun muutos lisää eventin, lokin, auditin, retentionin tai tukipaketin:

- testaa vakaa eventName ja tuntemattomien kenttien torjunta
- testaa salaisuuksien, henkilötietojen, raw errorin ja kontrollimerkkien
  redaction tai torjunta
- testaa business auditin atominen rollback
- testaa, ettei operational writer -virhe muuta business-operaation tulosta
- testaa company- ja permission-raja sekä turvallinen read projection
- testaa rotaation, retentionin ja levybudejetin raja-arvot
- testaa, ettei lokinlukija seuraa symlinkkiä tai hyväksy ulkoista polkua
- testaa tukipaketin kielletty sisältö myös epäonnistuvissa poluissa
- testaa tapahtuman omistajuus ja business auditin transaction ownership
- testaa Activity-, Diagnostics-, tukipaketti- ja incident-index-projektion
  sisällytys tai poissulku
- lisää riskin mukaan yksikkö-, integraatio- ja E2E-testi sekä onnistuvaan että
  rikkoutuvaan polkuun; yhden kerroksen testi ei yksin todista koko
  observability-ketjun failure behavioria

E2E:n pysyvä strategia on dokumentissa
`docs/architecture/e2e-testing-strategy.md`, skenaariot
`docs/architecture/r0-e2e-test-matrix.md`-tiedostossa ja runtime-rajat
`docs/architecture/e2e-test-environment.md`-tiedostossa.

`@playwright/test` on hyväksytty vain `apps/e2e`-pakettiin, täsmälleen sen
`package.json`-tiedostoon lukitulla versiolla. Tämä ei hyväksy muita
E2E-riippuvuuksia.

E2E ei korvaa yksikkö- tai integraatiotestiä. Invariantti testataan kattavasti
alimmalla sopivalla tasolla ja E2E todistaa edustavan koko järjestelmän polun.
Uusi moduuli tai merkittävä ominaisuus päivittää E2E-matriisiin onnistuvan,
permission-/tenant-eston ja failure-/recovery-polun sekä tarvittaessa
cross-module- ja packaged-turvarajan.

Uuden moduulin, platform-kyvykkyyden tai cross-module-sopimuksen testit
johdetaan myös `docs/architecture/module-integration-matrix.md`-dokumentista.
Testit varmistavat matriisiin kirjatut omistajuus-, permission-, audit-,
Diagnostics-, support bundle-, incident index-, backup- ja restore-rajat.
Matriisi ei korvaa moduulin omia invariansseja tai alempien tasojen testejä.

Kun olennainen työnkulku koostuu useasta peräkkäisestä tilasiirtymästä,
lisää sille nimetty ketjutesti korkeimmalla käytännöllisellä testitasolla.
Ketjutesti todistaa, että vierekkäiset siirtymät, niiden pysyvä tila ja
sivuvaikutukset toimivat yhdessä. Se ei korvaa yksittäisten siirtymien
domain-, application-, repository-, HTTP- tai turvallisuustestejä.

Manuaalinen `pnpm test:e2e:stress` antaa rajatun endurance-vertailutason. Sitä
ei ajeta joka pull requestissa eikä sen yksittäisestä muistilukemasta tehdä
suoraan absoluuttista tuotantorajaa. Skenaarion pitää silti epäonnistua
rikki menneestä työkuormasta, ulkoisesta verkkoyrityksestä, prosessiorvosta tai
puuttuvasta cleanupista. Vertailutason työkuorma ja tulkinta dokumentoidaan
`docs/architecture/e2e-endurance-baseline.md`-tiedostossa.

## Backup-, restore- ja päivitystestit

Backup/Restore testataan usealla tasolla:

- unit: container, manifesti, KDF-parametrirajat, polut, rotaatio ja tilakone
- integration: SQLite-snapshot, filesystem, `safeStorage`, staging ja rollback
- Electron E2E: native-dialogin capabilityt ja rendererin rajat
- hardened packaged Windows: oikea backup -> inspect -> restore -> restart
  synteettisellä profiililla

Installer/Update testataan:

- unit: manifesti, version/kanavan vertailu ja journalisiirtymät
- migration: source checksum, ketjun jatkuvuus, legacy-baseline, duplicate
  ordinal, release/build identity sekä SQL/history/metadata-mismatch ennen
  ensimmäistä pending schema -kirjoitusta
- integration: maintenance-lukko, shutdown, handoff ja first-start
- Windows package: clean install, upgrade, migration failure sekä business-
  ja binary-rollback

Windows MSI -release gate rakentaa jaeltavan prototyyppi-MSI:n vain kerran,
tarkastaa sen ja sitoo täsmälleen samat tavut Git-revisioon, release-
identiteettiin, tiedostonimeen, kokoon ja SHA-256-tiivisteeseen suljetulla
sidecar-manifestilla. Lifecycle-testit käyttävät tätä varmennettua MSI:tä.
Synteettiset upgrade- ja rollback-fixturet rakennetaan erikseen, minkä jälkeen
alkuperäisen release-MSI:n tavut varmennetaan uudelleen ilman rebuildiä.

Backup-, restore-, installer- tai update-polun onnistumista ei todisteta vain
mockilla tai selain-E2E:llä. Windowsin tiedosto-, prosessi-, `safeStorage`- ja
paketointirajat vaativat packaged-testin.

Restorea muuttava packaged-testi käynnistää vähintään kaksi eri
Electron-prosessia samaa synteettistä palautettua profiilia vasten. Sen pitää
todistaa palautetun tietokannan identiteetti ennen backendin avausta,
auktoritatiiviset business-artifactit restartin jälkeen, uuden
runtime-sessionin kelvollisuus, vanhan session vaihtuminen, backupin jälkeisen
mutaation poistuminen ja konekohtaisen salaisuuden poissulku portable
backupista. Prosessien välinen testitila saa sisältää vain synteettisiä hasheja
ja tunnisteita.

Backup- ja restore-observability testataan lisäksi tapahtumasopimuksen,
projektion ja operaation eristämisen tasoilla:

- jokaisella epäonnistuvalla lifecycle-polulla on täsmälleen yksi nimetty
  päätetapahtuma
- loggerin tai observerin virhe ei muuta backupin, restoren tai rollbackin
  lopputulosta
- manuaalista palautusta vaativa tila tuottaa erillisen
  `restore.recoveryRequired`-tapahtuman
- Diagnostics, support bundle ja incident index noudattavat omia
  allowlist- ja minimointisääntöjään myös restartin yli
- profile protection -tapahtumia ei kirjoiteta business auditiin eikä näytetä
  Activityssa
- polut, profiili-, yritys- ja artifact-tunnisteet, journalit, manifestit,
  checksumit, salaisuudet ja raw errorit torjutaan tai minimoidaan lähteen
  vaatimusten mukaan

30 minuutin soak on pakollinen vain, kun muutos koskee runtimea, native
addonia, prosessien elinkaarta, pitkäkestoista tiedosto-operaatiota tai
release gatea. Tavallinen domain-, UI- tai docs-muutos ei vaadi soakia.
