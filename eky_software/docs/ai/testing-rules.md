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

Jokaisen tehtävään kuuluvan ajon seuranta ja virhetodisteiden säilyttäminen
noudattavat [työnkulun CI-seurantaohjetta](workflow.md#ci-ajon-seuranta-ja-virhetodisteet).
Tämä koskee myös paikallista testiajoa ja mergeä seuraavaa `main`-ajoa.

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

Raskaan acceptance-matriisin CI-kadenssi erotetaan tavallisesta moduuli-PR:n
palautesyklistä. Nopeiden porttien pitää antaa palaute jokaisesta muutoksesta,
mutta installer-, packaged-, legacy- ja fault-matriisit ajetaan vain niiden
suojaaman riskipinnan muutoksista sekä kokonaisina `main`-, yö-, manuaali- ja
release-portteina. Required checkin nimi ja aggregaattorin terminal-tulos
pidetään vakaana myös silloin, kun raskas alijoukko on riskiluokituksen vuoksi
ohitettu.

Seuraavan checkpointin lähtökohta on tunnettu vihreä baseline. Punainen,
peruttu, flaky tai keskeneräinen tarkistus ei ole läpäisy. Rajatun,
ei-kriittisen puutteen aikana riippumaton kehitystyö voi jatkua vain alla
kuvatulla määräaikaisella poikkeuksella. Uusinta, testin ohitus, pidempi
timeout tai uusi rebuild eivät itsessään todista vikaa korjatuksi.

Asynkronisen testin valmistuminen sidotaan aina havaittavaan tapahtumaan tai
tilaehtoon, kuten prosessin `exit`- ja `close`-tapahtumiin, health-vastaukseen,
validoituun result-artifactiin, MSI:n product stateen tai täsmällisen
prosessipuun poistumiseen. Kiinteää odotusta ei käytetä onnistumisen
edellytyksenä eikä ajoitusongelmaa korjata vaihtamalla yksi sekuntiluku
toiseen. Jos alustalta ei ole saatavissa tapahtumaa, rajattu polling saa vain
tarkistaa samaa nimettyä ehtoa ja sen pitää palautua heti ehdon toteutuessa.
Erillinen enimmäisaika säilytetään fail-closed-turvarajana; sen täyttyminen on
virhe eikä valmis-signaali.

Windows-prosessipuun omistajuus ei saa perustua pelkkään parent PID -ketjuun,
koska poistuneen prosessin PID voidaan käyttää uudelleen. Omistetun lapsen
pitää kuulua samaan täsmälliseen creation identity -ketjuun ja sen syntymäajan
pitää olla sama tai myöhempi kuin todistetun vanhemman. Ennen omistettua juurta
syntynyt prosessi ja sen jälkeläiset torjutaan siivouksesta fail closed.

## Web-CI:n kokonaisbudjetti

Omistajan 23.10.2026 hyväksymä `Web critical E2E` -työn kokonaisaikaraja
on 20 minuuttia. Sama raja kattaa selainympäristön valmistelun, nykyisen
kriittisen testijoukon ja työn loppuvaiheet. Muutos koskee vain
repositoryjuuren `.github/workflows/ci.yml`:n `e2e-web-critical`-työtä.

Testien, Playwrightin, käynnistyksen, prosessisiivouksen ja salatun
virhekeräyksen omat aikarajat, uusintaehdot ja pakolliset tulokset säilyvät.
`failOnFlakyTests` säilyy: yhteysvirheen jälkeinen läpäisy ei muutu
hyväksynnäksi pidemmän kokonaisbudjetin vuoksi. Aiemmat katkaisut,
ensivirheet ja puuttuvat siivoustodisteet jäävät erillisiksi havainnoiksi.
Kokonaisrajan ja muuttumattoman testikomennon tarkistaa nykyinen
`ciRunAcceptance.test.mjs`; Linuxin valmistelukytkentä vaatii saman rajan.

## Desktopin Vitest-rinnakkaisuus

Desktopin tavallisen `vitest run` -ajon enimmäistyöntekijämäärä on neljä.
Pienempi nykyinen run-tilan oletus säilyy: raja on
`min(4, max(availableParallelism() - 1, 1))`. Asetus sijaitsee
[`apps/desktop/vitest.config.mjs`](../../apps/desktop/vitest.config.mjs):ssä,
joten normaali työtilan `pnpm test` sekä core-CI käyttävät sitä.
Tämä pakettikohtainen raja ei muuta muiden pakettien sisäistä rinnakkaisuutta,
testivalintaa, eristystä, testiaikarajoja, uusintoja tai CI:n kokonaisaikarajaa.

[Ajokytkennän regressiot](../../apps/desktop/scripts/test-command-wiring.test.mjs)
tarkistavat vähäydinrajat ja Vitestin todellisen asetuksen lataamisen.
Rinnakkaisuusraja hallitsee samanaikaista testityötä; sen kanssa onnistunut
ajo ei yksin todista aiemman aikakatkaisun juurisyytä tai sovellusvirheen
korjautumista. Aikaisemmat hylkäykset säilytetään erillisinä havaintoina.

## Core-CI:n pakettisarjojen ajo

Core-jobin testivaihe ajaa pakettien nykyiset testiskriptit yksi paketti
kerrallaan. Pakettien sisäiset työntekijämäärät, testikohtaiset aikarajat,
pretest-vaiheet, eristys, reporterit ja testivalikoima säilyvät. Juuren
orkestroiva `eky-software`-skripti suljetaan nimenomaisesti pois, joten
samoja sarjoja ei käynnistetä sen kautta uudelleen. Riippuvuusjärjestys ja
ensimmäiseen epäonnistuneeseen pakettiin pysähtyminen säilyvät.

Core-jobin kokonaisaikaraja ja myöhemmät typecheck-, build- ja Linux-
tarkistukset säilyvät. Ajotavan läpäisy ei yksin todista vanhan timeoutin
juurisyytä tai muuta ensimmäistä hylkäystä onnistumiseksi.

## Palautustestin erillinen valmistelu

Omistajan hyväksymä pysyvä aikabudjetti koskee vain
[`desktopRestoreStartup.test.ts`](../../apps/desktop/src/main/desktopRestoreStartup.test.ts)-tiedoston
kolmea nimettyä yhdistelmätestiä:

- `does not replace a C selection changed during completion validation`
  saa kummallekin variantille (`revision` ja `package`) enintään kymmenen
  sekuntia. Näissä valmistelu sisältyy samaan testirungon aikarajaan.
- `uses fresh original authority after C pre-migration validation fails`
  säilyttää erillisen enintään viiden sekunnin valmistelun. Palautus
  tarkistuksineen saa enintään kymmenen sekuntia; vaiheiden yhteisbudjetti
  on siten enintään viisitoista sekuntia.

Testirunkojen yhteinen nimetty raja on `restoreStartupCompositionTimeoutMs`.
Muiden testien, sovelluksen operaatioiden tai CI:n kokonaisaikarajat eivät
muutu. Tämä ei ole yleinen lupa siirtää valmistelua testin aikarajan
ulkopuolelle tai kasvattaa aikarajoja.

Omistajan 26.10.2026 hyväksymä sama kymmenen sekunnin testiraja koskee
lisäksi vain kolmea W7.2:n yhdistelmätestiä samassa tiedostossa:

- `accepts deferred business through real main and FirstStart` vain
  varianteilla `passive: true, source-null: true` ja
  `passive: true, source-null: false`
- `settles the selected source-null replacement through real rollback
  before selector return` vain variantilla `completed`.

Näissä valmistelu, toiminta ja tarkistukset sisältyvät samaan testirungon
rajaan. Muiden saman testiryhmän varianttien oletusraja säilyy.
Tarkistuksia, elinkaaritukea, sovelluksen aikarajoja tai CI:n kokonaisrajoja
ei muuteta. Hyväksytyt mittaukset läpäisivät nämä tapaukset, mutta eivät yksin
selitä aiempia aikakatkaisuja eivätkä ole koko W7.2:n hyväksyntä.

Omistajan 26.10.2026 erikseen hyväksymä kymmenen sekunnin raja koskee
lisäksi vain seuraavia kahta W7.2:n yhdistelmätestiä:

- `selector candidate rollback main handoff` -ryhmän `validates ... with the
  existing cold owner before returning from the main callback` vain
  variantilla `rolledBack`, samassa main-testitiedostossa.
- `carries real switch recovery and acceptance receipts into main and W6
  without recapturing identity` tiedostossa
  [`workspaceFirstStartSelectedPersistence.test.ts`](../../apps/desktop/src/workspaces/update/workspaceFirstStartSelectedPersistence.test.ts).

Valmistelu, toiminta ja tarkistukset sisältyvät samaan rajaan. Muiden
varianttien, sovelluksen ja CI:n aikarajat sekä kaikki tarkistukset säilyvät.
Mittauskoe ei yksin selitä aiempia aikakatkaisuja tai sulje W7.2:ta.

Omistajan 28.10.2026 hyväksymä sama kymmenen sekunnin raja koskee lisäksi
`settles the selected source-null replacement through real rollback before
selector return` -yhdistelmätestin `releaseFailure`-varianttia.
Valmistelu, palautus ja lopputarkistukset sisältyvät samaan rajaan;
`contentFailure`-variantin oletusraja säilyy. Sovelluksen ja CI:n aikarajat
sekä kaikki tarkistukset säilyvät. Rajattu mittaus läpäisi, mutta aiemman
aikakatkaisun syy jää avoimeksi eikä mittaus yksin hyväksy laajaa sarjaa.

Molempia vaiheita seuraa sama nykyinen testikohtainen elinkaarituki. Pelkkä
valmistelun onnistuminen ei oikeuta aineiston poistamista. Valmistelun tai
testirungon aikakatkaisun jälkeen yhteiset resurssit vapautetaan vasta työn
todella päätyttyä, ja epäonnistumisen sekä myöhäisen työn tiedostot säilytetään.
Oikeat journal-luennat, sisältö- ja omistajuustarkistukset säilyvät.
Testi valmistuu niiden toteutuessa, ei odotusajan täyttyessä. Jaon tai
uuden aikabudjetin läpäisy ei yksin osoita aiemman aikakatkaisun juurisyytä
korjatuksi. Hyväksyntänäyttöä ylläpidetään
[M1-suunnitelman jatkamiskohdassa](../architecture/release-0.3.0-m1-preparation-plan.md#jatka-tästä).

## Ensivirhe, uusinta ja rajattu poikkeus

Testirunneria edeltävä native-käännös ei tuota Playwright-testin virhettä.
Windows-Electronin nimetyn valmistelujobin erikseen hyväksytty käännösote
käyttää [nykyistä salattua toimitusta](../architecture/ci-encrypted-evidence.md#testiperheiden-virheaineisto).
Sen puuttuminen erotetaan testin tuloksesta; yleinen valmistelukoodi ei
todista kääntäjän alkuperäistä syytä. Muiden työkalujen raakakeräystä ei
avata tällä rajauksella eikä onnistuneesta valmistelusta kerätä otetta.

Tämä on yhteinen käytäntö paikallisille testeille ja CI:lle. Se ei korvaa
testiperheen omia hyväksyntäehtoja tai muuta required check -asetuksia.
Tavoite on rajata tutkimus ja mahdollistaa turvallinen eteneminen, ei
selittää jokaista historiallista hylkäystä ennen muuta kehitystä.

### Ensivirheen aineisto

Säilytä ensimmäisen epäonnistumisen nykyiset todisteet ennen uusintaa:
lähderevisio, todellinen checkout, testitapaus, suoritusyritys (`attempt`),
käynnistyssukupolvi ja paketin identiteetti siltä osin kuin ne koskevat ajoa.
Erota alkuperäinen virhe, viimeinen havaittu vaihe, siivoustulos sekä
aineiston puuttuminen toisistaan. Uusi yritys ei saa korvata ensivirheen
hakemistoa, eikä aineisto kuulu buildin tyhjentämään hakemistoon.

### Alkuperäinen testivirhe oletuksena

Synteettisen testin odottamaton epäonnistuminen kuuluu oletuksena nykyiseen
yksityiseen virhetiedon keräykseen. Käytä testirunnerin raportointikytkentää
sekä nykyistä salattua toimitusta, älä rakenna testikohtaista loggeria.
Säilytä rajattu alkuperäinen viesti, kutsupino ja syyketju sekä testin ja
suoritusyrityksen sidonta. Tunnetut salaisuudet peitetään. Onnistuneen testin
odotettu poikkeus ei ole uusi raportoitu testivirhe.

Jos omistava sovellus- tai harness-raja muuttaa poikkeuksen turvalliseksi
koodiksi, testirunner ei enää pysty palauttamaan alkuperäistä poikkeusta.
Tällainen raja tarjoaa sen nykyiselle yksityiselle havaitsijalle **ennen**
muunnosta. Yhteinen raportointi hoitaa testiperheen muut testit; jokaiseen
testitapaukseen ei lisätä omaa keräyskutsua. Uuden muunnosrajan mukana
todennetaan myös havaitsijan kytkentä, ei vain virhekoodi.

D2:n salaisuusbrokerin nykyinen synteettinen fixture kytkee alkuperäisen
poikkeuksen havaitsijan ennen turvallista koodimuunnosta. Ote toimitetaan
vain odottamattomasta testihylkäyksestä nykyisellä runner-liitännällä;
odotettu virhetesti ei tuota uutta virheraporttia. Sama virheketju todistetaan
`test:ci`-regressiolla ja `installer:test:encrypted-evidence`-komennon
OpenPGP-purkukokeella. Tavalliseen käyttäjäprofiiliin ei kytketä raakakeräystä.
Tämä ei todista alempien adapterien jo hävittämän syyn tai pakkokatkaisun
talteenottoa: keräyksen kattavuus ilmoitetaan todennetun rajan mukaan.

HTTP:n F/R15-raja käyttää `createHttpRequestFailureCapture`-testifixtureä
ennen Honon turvallista muunnosta. Anna fixture nykyisen testin kontekstista
`createApp`-option `httpRequestFailureObserver`-kenttään tai saman HTTP-rajan
kohdetestiin. Se toimittaa ensimmäisen syyn vain testin epäonnistuessa.
`fHttpFailureEvidence`-regressiot vertaavat kytkemätöntä kontrollia, odotettua
virhettä, havaitsijan häiriötä ja puuttuvaa tallennusta; OpenPGP-koe tarkistaa
puretut alkuperäiset tavut sekä testin ja suoritusyrityksen sidonnan.
Heitetyn merkkijonon sisältö kulkee nykyisessä rajatussa viestikentässä;
puuttuvaa pinoa tai syyketjua ei keksitä. Tuotanto ei kytke tätä fixtureä.

Diagnosticsin `diagnostic-read`-variantti käyttää oikeaa tiedostolukijaa ja
sen nykyistä lukuvirheen havaitsijaa ennen turvallista vastausmuunnosta.
OpenPGP-koe varmentaa alkuperäisen viestin, pinon ja syyketjun puretusta
paketista; pelkkä `unavailable`-vastaus ei ole keräyksen todiste. Sivutuksen
jatkotila ei laajenna kerättävän aineiston tai julkaisun rajoja.

Julkisen testiraportoinnin hyväksyttyä sisältöä ei laajenneta.
Käyttöliittymä ja tuotannon diagnostiikka käyttävät edelleen turvallisia
koodeja. Tämä oletus ei hyväksy kokonaisten
ympäristömuuttujien, profiilien, tietokantojen, pyyntösisältöjen tai
muistivedosten keräystä. Keräyksen rajat ja toimitusketju määritellään
[salatun aineiston sopimuksessa](../architecture/ci-encrypted-evidence.md).
Sopimuksen mukainen uuden testin kytkentä ei vaadi erillistä lupaa;
sisällön, säilytyksen tai julkaisurajan laajentaminen vaatii päätöksen.

Todista ketju pakotetulla virheellä: alkuperäinen poikkeus löytyy oikeasti
puretusta salatusta paketista, julkinen tuloste pysyy turvallisena ja testi
pysyy epäonnistuneena. Varmenna myös virhe raportoinnissa, puuttuva aineisto
ja onnistuneen polun säilyminen. Prosessin pakkokatkaisu, levyn virhe tai
runnerin katoaminen voi estää tallennuksen tai toimituksen; puuttuvaa
alkuperäistä syytä ei päätellä yleisestä koodista eikä väitetä tallennetuksi.

Electron development -muunnosrajan nimetty Windows-koe on
`pnpm --filter @eky/e2e e2e:electron:evidence`. Se käyttää nykyistä fixtureä,
oikean entrypointin hallittua exit 1:tä ja nykyistä OpenPGP-testitoimitusta.
Sisäinen testihylkäys on kokeen odotettu syöte, ei tavallisen CI:n ohitus.
Kokeen onnistuminen vaatii alkuperäisen viestin, pinon ja syyketjun puretuista
tavuista sekä erillisen puun/portin siivoustodisteen. Tavallisen onnistuvan
startupin ja restartin regressiot säilyvät; tämä ei korjaa vanhaa timeoutia.

Hiljainen odotus ei välttämättä tuota poikkeusta. Käytä ensin omistavan
testiruntimen olemassa olevia vaihe-, prosessi- ja toimitushavaintoja;
pelkkä timeout ei nimeä syytä. Workspace-asentimen hyväksytty
[ikkunahavainto](../architecture/ci-encrypted-evidence.md#asentimen-rajattu-ikkunahavainto)
täydentää tätä aukkoa nykyisessä MSI-seurannassa, ilman testikohtaisia
lokittajia. Myös tällainen havainto todennetaan omistajuuden, keskeytyksen
ja oikean salaus/purku-ketjun kautta ennen varsinaista Windows-koetta.

### Keräyksen ja toimituksen rajat

Kerää ongelman vaiheeseen sopiva rajattu aineisto nykyisillä välineillä:
testiraportti, prosessin tulosteet, trace tai erikseen perusteltu vedos.
Kaikkea raakadataa ei kerätä oletuksena. [Testinkirjoittajan vianetsintäreitti](e2e-test-authoring-guide.md#kun-testi-epäonnistuu)
erottaa selaimen, Electronin ja packaged-ajon. Pelkkä trace-asetus ei takaa
valmista jälkeä prosessin tai runnerin pakkokatkaisussa.
Nykyiset [julkaisurajat](../architecture/security-principles.md#omistajan-tietojen-julkaisuraja)
säilyvät: synteettinen business-data ei tee istuntotunnisteista, raakavirheistä
tai konekohtaisista tiedoista julkisia. Uusi keräys ei saa lisätä estävää
kirjoitusta tai rajaamatonta kuittausodotusta kriittiselle polulle.

Rajattu [salattu CI-tutkimuspaketti](../architecture/ci-encrypted-evidence.md)
on erikseen hyväksytty toimitusreitti Windowsin workspace-testin nimetyille
tiedostoille sekä Windowsin ja Linuxin testiperheiden rajatulle ensivirheen
aineistolle. Se ei avaa yleistä raakajulkaisua eikä korvaa testin tulosta.
Purkuavaimen käyttöönotto ja yhden vuorokauden sisällä tapahtuva yksityinen
talteenotto on varmistettava ennen reitin käyttöä.

### Rajattu vianrajaus ennen uusintaa

Punainen tai jumittuneelta näyttävä CI-ajo tutkitaan ensin rajatusti:

1. Varmenna palvelusta ajon, suoritusyrityksen, jobin ja askeleen todellinen
   tila. Pelkkä hiljainen loki ei todista jumiutumista. Käynnissä olevan tai
   tilaltaan epävarman ajon rinnalle ei käynnistetä uusintaa; noudata nykyistä
   aikaraja-, katkaisu- ja siivousmenettelyä.
2. Säilytä ensivirhe ja vertaa lokia juuri suoritetun revision job-määrittelyyn
   sekä kutsuttuun koodiin. Erota sovellusvirhe, testiharnessin virhe,
   valmisteluhäiriö ja puuttuva havainto; älä oleta vikaa vain testiin.
3. Hyödynnä saatavilla olevaa GitHubin tekoälyn virheselitystä, kuten
   `Explain problem`, yhtenä hypoteesina. Tarkista sen nimeämä job, vaihe,
   tiedosto ja aikaraja alkuperäisistä lähteistä ennen korjausta. Selitys ei
   yksin todista juurisyytä tai oikeuta aikarajan nostoa. Toiminnon puuttuminen
   ei estä vianrajausta tai alla sallittua uusintaa. Yksityisiä lokeja,
   purettua tutkimusaineistoa tai salaisuuksia ei lähetetä sille tämän ohjeen
   nojalla; nykyiset julkaisu- ja käyttöoikeusrajat säilyvät.
4. Jos selvä syy löytyy, tee hyväksyttyyn rajaukseen kuuluva korjaus ja sen
   regressiotesti. Uusintaa ei käytetä tunnetun vian korjaamisen korvikkeena.
   Jos syy jää tämän tarkistuksen jälkeen avoimeksi, käytä tarvittaessa alla
   sallittua yhtä uusintaa. Sitä varten ei edellytetä loputonta tutkimusta,
   uutta diagnostiikkakerrosta tai ennalta todistettua infrastruktuurivikaa.

### Enintään yksi uusinta

Ensimmäisen hylkäyksen jälkeen pääagentti voi tehdä yhden rajatun
diagnostisen uusinnan ilman erillistä lupaa, kun ajaminen kuuluu hyväksyttyyn
tehtävään. Lupa koskee myös rajatun vianrajaamisen jälkeen avoimeksi jäänyttä
syytä; kysymys voi olla, toistuuko sama hylkäys samassa vaiheessa puhtaassa
ympäristössä. Valitse kyseinen testi tai pienin nykyisen työnkulun tukema
job sen pakollisine riippuvuus- ja koontivaiheineen, ei koko matriisia
varmuuden vuoksi. Ennen ajoa nimetään kysymys, sama lähde ja sama valmis paketti,
aineiston säilytyspaikka sekä seurannan omistaja. Pakettia ei rakenneta
uudelleen uusintaa varten. Uusinta tehdään tuoreessa eristetyssä ympäristössä
tai vasta varmennetun siivouksen jälkeen. Epävarman vanhan ympäristön
aineistoa tai omistajuustodistetta ei poisteta.

Nykyinen automaattinen Playwright-retry sekä ihmisen tai agentin käsin
käynnistämä uusinta lasketaan samaan yhden uusinnan rajaan;
sen jälkeen ei tehdä lisäksi job-, workflow- tai paikallista uusintaa
saman hylkäyksen vuoksi. Ennalta sovitut vakaustoistot ovat eri asia, mutta
niilläkään ei korvata hylättyä yritystä. Uusinnan epäonnistuessa tai syyn
jäädessä avoimeksi pysähdytään luokittelemaan tulos, ei ajeta vihreään asti.
Näyttöön perustuva korjaus ja sen nimetty todennus eivät ole saman lähteen
uusinta; pelkkä dokumentti- tai muu asiaan liittymätön commit ei nollaa rajaa.

Uusinta ei ole hyväksyntä: toisella yrityksellä läpäisevä testi on edelleen
epävakaa, ellei alkuperäistä estettä osoiteta testin ulkopuoliseksi
infrastruktuurihäiriöksi. Pelkkä timeout, paikallinen läpäisy tai runnerin
kuormitusepäily ei todista tätä. Todennettu infrastruktuurihäiriö kirjataan
erikseen, mutta korvaavan ajon on silti täytettävä nykyiset hyväksyntäehdot
samalle lähteelle ja paketille. `failOnFlakyTests` säilyy CI:ssä; sitä ei
poisteta yleisesti eikä hylättyä ajoa nimetä jälkikäteen onnistuneeksi.
Kirjaa ensimmäisen yrityksen hylkäys, uusinnan tulos ja avoin syy erikseen.
GitHubin vihreä uusintatulos ei yksin muuta tätä hyväksyntäpäätöstä. Uusinnan
salliminen ei muuta merge-, julkaisu- tai kriittisten testien vaatimuksia.

### Määräaikainen kehityspoikkeus

Omistaja voi hyväksyä nimetylle ei-kriittiselle testipuutteelle rajatun
poikkeuksen, jotta siitä riippumaton ominaisuustyö voi jatkua. Päätökseen
kirjataan testitapaus, näyttö ja avoin syy, riskin perustelu, sallittu
kehitystyö, vastuuhenkilö, korjaustehtävä, täsmällinen päättymispäivä sekä
uudelleenarvioinnin ehto. Tiedot kuuluvat työn omistavaan suunnitelmaan,
eivät uuteen rinnakkaiseen poikkeusjärjestelmään. Yleinen lupa käyttää tätä
menettelyä ei hyväksy yksittäistä poikkeusta.

Tietoturvaa, yrityseristystä, tietokannan tai palautuksen eheyttä, tarkkaa
asennettua sisältöä tai epävarmaa prosessisiivousta ei ohiteta tällä
menettelyllä. Luokittelematon kriittisen polun aikakatkaisu ei ole
ei-kriittinen poikkeus. Poikkeus ei tarkoita testin läpäisyä, required checkin
ohitusta, merge-lupaa tai julkaisuvalmiutta. Se raukeaa määräpäivänä tai
vaikutusalueen laajentuessa. Julkaisu- ja main-portit todennetaan erikseen;
niiden muuttaminen vaatii oman nimenomaisen päätöksen.

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

Desktopin workspace-lähdekoodirajojen testit käyttävät
[`inspectBoundarySourcesForTest`-lukijaa](../../apps/desktop/src/workspaces/boundarySourceTestSupport.ts).
Se lukee enintään kahdeksan tiedostoa kerrallaan ja odottaa aloitetun erän
loppuun ennen lähdejärjestyksessä tehtävää synkronista tarkistusta tai
alkuperäisen virheen välitystä. Kukin rajatesti omistaa edelleen
tiedostojoukon, poissulut, import-tulkinnan ja kielletyt riippuvuudet.
Lukijan [regressiot](../../apps/desktop/src/workspaces/boundarySourceTestSupport.test.ts)
todentavat rinnakkaisuusrajan, virheen säilymisen ja tyhjän/vajaan erän.
Apuri noudattaa nykyistä `*TestSupport.ts`-poissulkua tuotantobuildista;
se ei ole sovelluksen tiedosto-API tai uusi testiruntime.

Usean kerroksen system-, selain- ja Electron development -E2E-testit kuuluvat
`apps/e2e`-workspaceen. Hardened packaged-artifactin smoke-testit säilyvät
desktop-paketin omistuksessa.

Uuden tai muuttuvan E2E-testin käytännön lukureitti on
[testinkirjoittajan pikaohje](e2e-test-authoring-guide.md): oikea fixture,
synteettinen eristys, kanoninen ajokomento ja ensivirheen näyttö.
[Tekninen runtime-sopimus](../architecture/e2e-test-environment.md) ja
[kattavuusmatriisi](../architecture/r0-e2e-test-matrix.md) pysyvät omistavina
ohjeina; pikaohje ei luo uutta testitasoa tai hyväksyntäpoikkeusta.

Yleistä `test-utils`-kaatopaikkaa ei luoda. Toistuva testi-infrastruktuuri
irrotetaan vasta todelliseen tarpeeseen ja nimetään vastuun mukaan.

Testi-infrastruktuurissa noudatetaan lisäksi seuraavia vastuurajoja:

- yksi prosessipuu saa yhden timeout- ja emergency cleanup -omistajan
- scenario worker ei saa rakentaa fixtureä tai omistaa supervisorin cleanupia
- build, prosessiajo, postcondition-verifiointi ja fixture-cleanup ovat eri
  vastuita
- sama immutable fixture rakennetaan kerran yhtä hyväksyntämatriisia varten
- stdout ja stderr ovat diagnostiikkaa, eivät readiness- tai terminal-
  kontrolliprotokolla
- pitkä testi pilkotaan vain tunnistettujen vastuiden perusteella, ei rivimäärän
  vuoksi
- testiä ei poisteta ennen kuin sen suojaama invariantti on nimetty ja
  korvaava testi on vihreä samalla commitilla

Windows installer -harnessin tavoiterakenne ja migraatio määritellään
`docs/architecture/windows-installer-acceptance-harness-v2.md`-dokumentissa.

V2.8:n riskiluokituksen ja tulosten yhdistämisen kohdesopimukset ajetaan
kanonisesta lähdejuuresta komennolla `pnpm test:ci`. Repositoryjuuren
`.github/scripts/` omistaa vain CI-politiikan, ei skenaarioita, niiden
prosesseja tai artifactien rakentamista. `ci-cadence-contracts.yml` todistaa
sopimukset Linuxissa ja Windowsissa sekä kutsuu nykyiset V2-workflowit saman
validoidun riskisuunnitelman mukaan. Vakaa `V2 acceptance` vaatii saman ajon
ja yrityksen kaikki valitut jobit, toistot ja pakolliset testivaiheet; pelkkä
matriisin osittainen onnistuminen ei riitä. Main-, ajastettu ja manuaalinen
release-valmistelun ajo säilyvät täysinä. Feature-push ei toista PR:n V2-matriisia.
Hyväksytty cutover poisti korvatut W6-komennot ja niiden suorat CI-jobit.
`ci.yml` toimii saman riskisuunnitelman reusable corena; suora feature-push tai
PR ei käynnistä sen rinnalle toista raskasta matriisia. Säilyvät rakentajat,
fixturet ja turvallisuustarkistukset on nimetty V2-suunnitelman siirtokartassa.
Katselmoitu V2-integraatio on yhdistetty normaalilla PR-menettelyllä mainiin,
ja required checkit ovat `V2 acceptance` sekä `Audit dependencies`.
Strict-ajantasaisuus, PR-vaatimus ja muut suojaukset säilyvät. Merge-commitin
oma täysi ajo on erillinen julkaisuehto: sen hylkäystä ei korvaa aiempi
PR-vihreys. Ajantasainen hyväksyntätila on kanonisessa V2-suunnitelmassa.

Dokumentaatiomuutoskaan ei ohita riskiluokitusta. Nykyisen
[riskiluokittimen](../../../.github/scripts/ciRiskPolicy.mjs) ja
[controllerin](../../../.github/workflows/ci-cadence-contracts.yml) mukaan:

| Muutos tai tapahtuma | Vaadittu valinta |
| --- | --- |
| Tavallinen `eky_software/docs/**/*.md`, pois lukien alla olevat politiikkaohjeet | `verify`, `systemSecurity`, `webCritical`, yksi toisto |
| Vain riskiluokittimen `FAST_BROWSER_SCENARIO_PATHS`-listan nimetyt asiakasselaintestit | `verify`, `systemSecurity`, `webCritical`, yksi toisto |
| Muut `apps/e2e/`-polut, myös uudet skenaariot, fixturet, raportointi ja konfiguraatio | Nykyinen compatibility-valinta: kaikki 11 perhettä, yksi toisto; alla nimetyt yhteiset politiikka-/pakettitiedostot vaativat täyden valinnan |
| Mikä tahansa `AGENTS.md`, `.github/**`, tämä testauskäytäntö tai Windows-harnessin ohje | Kaikki 11 perhettä, kaksi toistoa |
| `apps/e2e/experiments/processOwnership/README.md` | Compatibility-riski: kaikki 11 perhettä, yksi toisto |
| Tuntematon polku, puuttuva/epätäydellinen vertailu tai tyhjä muutoslista | Täysi portti, kaksi toistoa |
| Main-push, ajastettu tai manuaalinen controller-ajo | Täysi portti, kaksi toistoa |

Sekamuutoksessa tiukin luokitus määrää. Nopea portti ajaa oikeat sopimus-,
build- ja system/web-testit; se ei tarkoita pelkkää dokumenttilinkkien linttiä.
Täysi portti säilyttää paketti-, palautus-, prosessi- ja fault-vaatimukset.
I/R30:n hyväksytty rajaus koskee vain riskiluokittimen täsmällistä
`FAST_BROWSER_SCENARIO_PATHS`-listaa, ei koko selaintestihakemistoa.
Lista on luokittimen omistama; nimeäminen ei tee uudesta testistä kevyttä.
Listatun testin vastuun muutos vaatii riskikartan tarkistuksen samassa työssä.
Yhteisen tukikoodin muutos tai siirron toinen polku säilyttää korkeamman
riskin. Mainin, ajastuksen ja manuaaliajon täydet portit eivät kevene.
[Audit-workflow](../../../.github/workflows/dependency-security.yml) käynnistyy
jokaisesta mainiin kohdistuvasta PR:stä. Sen main-push on erikseen
polkusuodatettu: pelkkä dokumenttimuutos ei automaattisesti käynnistä
Auditia mainissa. Ajastettu tai manuaalinen Audit on oma ajonsa. Puuttuvaa
ajoa ei merkitä läpäistyksi eikä toisen revision tulosta käytetä uuden
revision todisteena. Vaaditut PR-tarkistukset ja mainin omat soveltuvat
portit varmennetaan nykyiselle revisiolle; tämä taulukko ei muuta politiikkaa
tai GitHubin asetuksia.

V2.5:n omistajan hyväksymä vaihekohtainen ympäristöraja käyttää kahta
eristettyä Windows CI -consumeria samalle build-once-artifactille kahden
paikallisen packaged-ajon sijaan. Paikalliset sopimustestit ja muut vaiheelle
sovitut portit säilyvät pakollisina. Rajaus ei muuta testien turvallisuusehtoja,
epäonnistuneiden ajojen tuloksia, muiden vaiheiden hyväksyntää tai release-
portteja. Täsmällinen sopimus ja revision näyttö ovat samassa V2-suunnitelmassa.

Omistaja on hyväksynyt vastaavan rajauksen erikseen myös V2.6:n ja V2.7:n
vaihehyväksyntään. Kumpikin vaihe tarvitsee omat kaksi eristettyä GitHub
Windows -consumeriaan, jotka käyttävät saman producerin samoja varmennettuja
artifact-tavuja ensimmäisellä yrityksellä. Paikalliset sopimustestit,
fail-closed-tulokset, single-link-tarkistus, profiilin muuttumattomuus ja
tarkka cleanup säilyvät. Tämä ei hyväksy vaiheita etukäteen eikä muuta koko
V2:n käyttöönotto- tai julkaisuportteja.

Koko V2:n käyttöönotolle on tämän jälkeen hyväksytty erillinen ympäristöpäätös:
kaksi täydellistä normaalia GitHub-kierrosta samasta lopullisesta
integraatiorevisiosta korvaa aiemmat kaksi paikallista täyttä MSI/release-
kierrosta. GitHub-kierroksia vaaditaan yhteensä kaksi, ei neljää. Paikalliset
soveltuvat testit, sopimustestit, typecheck ja build säilyvät. Testiperheitä,
skenaarioita, toistoja, turvallisuus- tai siivousvaatimuksia ei poisteta.
Tarkka sopimus, required-check-vaihdon ehdot ja merge-commitin oma portti
ovat kanonisessa V2-suunnitelmassa; vanhojen ajokierrosten osia ei yhdistetä
uuden revision hyväksynnäksi.

Edellä kuvattu kahden kokonaiskierroksen ehto koski V2:n alkuperäistä
käyttöönottoa. Se ei lisää jokaiseen myöhempään dokumentointi-PR:ään kahta
uutta PR/main-kierrosta. Nykyisen riskisuunnitelman toistot ja saman
revision PR/main-hyväksyntä säilyvät sellaisinaan.

Testiraportin julkaisuraja määräytyy
`docs/architecture/security-principles.md`-dokumentista. Omistajan koneen
ohjelma-, ajuri- ja ympäristöhavainnot sekä yksityiskohtaiset paikalliset
mittaukset pidetään Gitistä ohitettuina; niitä ei kopioida yhteiseen
suunnitelmaan, PR:ään tai CI-artifactiin edes ilman nimiä tai polkuja.
Julkinen hyväksyntätila ja avoimet testisopimukset raportoidaan silti
rehellisesti. Yksityisyys ei muuta epäonnistunutta tai varmentamatonta ajoa
onnistumiseksi. Diagnostiikan lupa ei anna lupaa tulosten julkaisemiseen.

## Tiedostoidentiteetti Testeissä

Kun testin sopimus on binääristen `Buffer`-tavujen täsmällinen yhtäsuuruus,
käytä koko puskurin `equals`-vertailua ja tarkista sen totuusarvo. Yleistä
olioiden syvävertailua ei tarvita jokaiselle tavulle erikseen. Eri pituuden
ja muuttuneen loppupään pitää edelleen hylätä vertailu; kyse ei ole
näytteestä, toleranssista tai sisältötarkistuksen vähentämisestä.

Packaged-, installer-, rollback- ja release-fixturet muodostavat itsenäiset
tiedostotavut. Lähdepuun `out`-hakemistoa, hyväksyttyä MSI:tä tai muuta
release-artifactia ei hardlinkata fixtureen, koska linkitys muuttaa myös
lähdetiedoston filesystem-identiteettiä ja voi rikkoa strict runtime-
validoinnin. Artifactin byte-identtisyys todistetaan hashilla ja inventaariolla,
ei yhteisellä inode-/file-id-identiteetillä.

Hardlink on sallittu vain rajatussa tiedostojärjestelmätestissä tai
tuotantosopimuksessa, jossa atominen no-overwrite-linkitys on nimenomaan
toiminnon semantiikka. Tällöin lähde, kohde, containment, linkkimäärä,
same-volume-ehto, rollback ja virhetilat validoidaan erikseen. Turvallisuustesti
saa luoda haitallisen hardlinkin todistaakseen torjunnan, mutta se ei saa käyttää
sitä release-payloadin monistamiseen.

V2.5:n `WindowContract.exe`-GUI-fixturen omistajan hyväksymässä sopimuksessa
ulkopuolinen ajonaikainen linkkimäärän muutos on erillinen havainto, ei yksin
ikkunan sulkemistestin hylkäys. Alkuperä, kanoninen polku ja testijuurisidos,
regular-file-tyyppi, symlink-raja, root/file-id, koko, SHA-256 sekä toiminta- ja
cleanup-tulokset tarkistetaan edelleen. Tämä ei salli harnessin tekemää
executable-hardlink-kloonausta eikä muuta tuotannon tai release-artifactin
linkkipolitiikkaa. Rajaus ja näyttö ovat samassa V2-harness-suunnitelmassa;
vendor-allowlistiä ei lisätä normaaleihin testeihin.

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
- release- ja update-manifestin kanava-, identity-, koko-, hash- ja
  allekirjoitustilan rajoja sekä muuttuneita tavuja

Paikallisen allekirjoittamattoman pilotin testeissä todistetaan lisäksi, että
`unsigned-prototype` hyväksytään vain `pilot`-kanavalla, `stable` torjutaan,
symlinkit ja tuntemattomat kentät torjutaan eikä samaa versiota hyväksytä eri
tavuille. Testit eivät saa nimetä hash-todistetta publisher-luottamukseksi.

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
- varattu-tila, kaksoispainallus, peruutus, aikakatkaisu ja turvallinen
  uudelleenyritys muuttuvan toiminnon sivuvaikutusten mukaan
- ilmoitusten fokus, näppäimistökäyttö ja status/alert-esitys sekä ero tyhjän,
  vanhentuneen, osittaisen ja epäonnistuneen tuloksen välillä

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

V2:n GitHub Actions -kytkentä ajaa testit ja staattiset tarkistukset pull
requesteissa riskisuunnitelman mukaan sekä täysinä `main`-pusheissa,
ajastetusti ja käsin käynnistetyissä kokonaisajoissa. Feature-push ei aja
PR:n rinnalle toista raskasta matriisia. `ci.yml` on kutsuttu core-työnkulku,
ei erillinen `antsa`- tai PR-triggeri. Sen erillinen käsikäynnistys
`electron_diagnostic=true` ajaa vain nykyisen Electron-jobin paketoinnin,
packaged smoken, critical-polut ja käynnistyshavainnon kytkentätestin.
Tämä rajattu diagnoosi ei tuota `V2 acceptance` -tulosta eikä korvaa normaalia
kokonaiskierrosta. Reusable-kutsun pakollinen riskisuunnitelma säilyy;
myös manuaalinen V2-kokonaisajo käyttää sitä muuttumattomana.

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
web-käyttäjäpolut. Electron- ja Windows-perheet valitaan samasta suljetusta
riskisuunnitelmasta; täydet main-, ajastetut ja manuaaliset ajot säilyvät.

CI täydentää paikallista testausta, mutta ei korvaa sitä. Muutos testataan
paikallisesti ennen commitia silloin, kun paikallinen ympäristö sen sallii.

AI ei raportoi PR:ää, mergeä tai julkaisuehdokasta valmiiksi pelkän
käynnistyneen workflow-ajon perusteella. Jos AI on pushannut tai mergeyttänyt
muutoksen, sen pitää tarkistaa juuri pushatun PR-commitin vaaditut ajot ja
mergeämisen jälkeen juuri syntyneen `main`-commitin vaaditut push-ajot loppuun
asti. Punainen, peruttu, flaky tai kesken oleva ajo pitää raportoida
avoimeksi. Siihen nojaavaa seuraavaa vaihetta ei aloiteta; riippumaton
kehitystyö voi jatkua vain [hyväksytyllä määräaikaisella poikkeuksella](#määräaikainen-kehityspoikkeus).

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
CI-testauksen kuin käsin tehty päivitys. Core säilyttää
`Test, typecheck and build`, `System security E2E`- ja `Web critical E2E`
-vastuut myös reusable-workflowin prefiksoiduissa jobeissa.
Electron-, native addon- ja Windows-paketointimuutoksissa ajetaan lisäksi
`Windows Electron critical E2E`, Windows package sekä packaged smoke sovitun
testimatriisin mukaan. Hyväksytyn käyttöönoton pakolliset tarkistukset ovat
`V2 acceptance` + `Audit dependencies`; koonti todentaa kaikki riskin
valitsemat jobit, vaiheet ja toistot. Dokumentoitu päätös ei korvaa nykyisten
GitHub-asetusten read-only-varmennusta ennen mergeä.

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
- testaa tuotannon compositionin observer/logger/failure sink -kytkentä;
  testiin erikseen injektoitu spy ei todista tuotantokytkentää
- käytä writerin hyväksymää tapahtumaa readerin ja strict clientin
  sopimustestissä; katalogierolle pitää olla nimetty poissulku tai testi
- todista edustava oikean käyttötapauksen virheketju: turvallinen syy ja
  vaihe -> kirjattu tapahtuma -> sallittu projektio -> UI/tukipaketti;
  yleinen käyttäjäviesti ei saa poistaa sisäistä turvallista syyluokitusta
- testaa eri lokivirtoihin lomittuneet aikaleimat sekä tapahtuma-, tavu- ja
  lähdebudjetit yhdessä: tiedostojärjestys ei todista tapahtumajärjestystä
- testaa puuttuva, viallinen, osittainen ja lukukelvoton lähde erikseen;
  lokituksen virheilmoitus ei saa vaatia epäonnistuvan writerin toimimista
- lisää riskin mukaan yksikkö-, integraatio- ja E2E-testi sekä onnistuvaan että
  rikkoutuvaan polkuun; yhden kerroksen testi ei yksin todista koko
  observability-ketjun failure behavioria

Lähdekoodin puutteen toistava tutkimustesti erotetaan korjauksen
regressiotestistä. Vihreä testi, joka odottaa nykyistä virhekäyttäytymistä,
todistaa puutteen, ei korjausta. Korjauksen hyväksyntätesti odottaa sovittua
oikeaa käyttäytymistä. Nykyiset vihreät testit eivät yksin todista uuden
tapahtumaperheen tai composition-kytkennän kattavuutta.

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
Fixture ei saa muodostaa kovia linkkejä unpacked- tai installer-artifactin
tiedostoihin. Fixture käyttää itsenäisiä tiedostokopioita, jotta testin
rakentaminen ei muuta alkuperäisen artifactin linkkimäärää tai tee sen tiukasta
runtime-polkuvalidoinnista virheellistä.

Jaeltavan unpacked desktopin tai installer-payloadin paikallinen
release-candidate-portti käyttää samaa build-once-periaatetta. Puhtaasta
commitista rakennettu täsmällinen output:

- validoidaan manifestia, build-identiteettiä ja inventaariota vasten
- käynnistetään, suljetaan hallitusti ja käynnistetään uudelleen samalla
  synteettisellä profiililla
- tarkistetaan prosessi- ja loopback-orpojen varalta
- todistetaan update- tai first-start-rajaa muuttavassa työssä myös edellisen
  hyväksytyn pienemmän version identiteetin päälle
- säilytetään samoina tavuina manuaalista kokeilua ja seuraavaa artifact-
  porttia varten; portin jälkeen tehty rebuild on uusi todistamaton ehdokas.

Tavallinen puhtaan profiilin smoke ei yksin todista päivityskelpoisuutta. Sen
rinnalla tarvitaan edellisen hyväksytyn version tilasta käynnistyvä
release-candidate-smoke, jotta sama versio eri tavuilla, downgrade ja
first-start-identiteetin ristiriidat havaitaan ennen käyttäjän profiilia.

Backup-, restore-, installer- tai update-polun onnistumista ei todisteta vain
mockilla tai selain-E2E:llä. Windowsin tiedosto-, prosessi-, `safeStorage`- ja
paketointirajat vaativat packaged-testin.

Packaged-testin supervisor käyttää yhtä koko omistetun prosessipuun siivouksen
kattavaa deadlinea. Saman puun ympärille ei lisätä sisäkkäistä command-,
acceptance- tai scenario-watchdogia. Jos täsmällinen prosessipuun siivous
epäonnistuu, tulos pysyy virheenä. CI ei saa jäädä ulkoiseen aikakatkaisuun
ilman turvallista terminal-tulosta eikä child-kahvan vapautusta saa tulkita
onnistuneeksi siivoukseksi. Business-postconditionit tarkistetaan erillisessä
read-only-verifierissä vasta todistetun `processTreeAbsent`-tilan jälkeen.

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
