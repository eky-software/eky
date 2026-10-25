# Tukipakettisuunnitelma

Eky-tukipaketti on käyttäjän vahvistuksella muodostettava, sanitoitu
diagnostiikka-artifacti. Se ei ole varmuuskopio eikä sisällä business dataa.

## Toteutettu R0-raja

R0-toteutus kulkee seuraavasti:

```text
Diagnostics UI
  -> rajattu preload createSupportBundle(), ei argumentteja
  -> Electron mainin vahvistus ja Save-dialogi
  -> mainin runtime-sessionilla tekemä sisäinen backend-haku
  -> tarkka response-validointi
  -> gzip JSON + SHA-256 section checksumit
  -> yksityinen väliaikaistiedosto ja lopullinen .json.gz-tiedosto
```

Backendin `GET /diagnostics/support-bundle-data` on
`createSupportBundle`-permissionilla suojattu tekninen read model. Reitti ei
ole API-clientin julkinen endpoint eikä Electron-rendererin yleisen
`eky://app`-transportin allowlistissa. Renderer ei voi antaa reitille polkua,
querya, `companyId`:tä tai runtime-sessionia.

## W7:n hyväksytty jatkosuunta

Omistaja hyväksyi 24.10.2026 yritysvalintaan rajatun desktop-tukipaketin
nykyisen keräyksen pohjalta myös ilman business-backendia.
[W7:n sopimus](local-company-workspace-plan.md#palaute-vastuut-ja-todennus)
omistaa tämän vielä toteuttamattoman suunnan ja kytkentäportin. Ennen
kytkentää tähän ohjeeseen täsmennetään sallittu sisältö, puuttuvien
backend-/DB-tietojen esitys, mainin capability- ja vahvistusraja sekä
formaatin luku ja testit. Puuttuvaa tietoa ei esitetä terveenä eikä yritystä
avata vain paketin muodostamiseksi. Nykyisen täyden tukipaketin
backend-permissionia, sisältöä tai formaattia ei tällä kirjauksella muuteta.

### W7.0:n rajattu tukisopimusehdotus

Tämä on toteutusta edeltävä ehdotus, ei käytössä oleva formaatti tai
valmis keräysketju. Nykyinen `supportBundleBackendData` vaatii backend-version
ja onnistuneen tietokantayhteenvedon. `supportBundleArchive` tuottaa formaatin
2, jonka virallinen tarkastin vaatii kaikki kuusi dataosiota. Näitä ei
korvata tyhjällä, nollalla tai `health: ok` -oletuksella yritysvalinnassa.
Update-recovery-ikkunan nykyinen pieni `formatVersion: 1` -tiedosto on eri
formaatti; se ei ole täyden tukipaketin formaattiversio 1 eikä nykyinen
`support:inspect` lue sitä. Sitä ei nimetä toimivaksi yhteiseksi lukuketjuksi.

Pienin W7-polku käyttää nykyisiä `supportBundleCapability`-,
`supportBundleArchive`- ja `supportBundleFileStore`-omistajia. Backendin
Diagnostics-readeria ei tuoda desktopiin moduulirajan yli, eikä rakenneta
rinnakkaista JSONL-lukijaa, tapahtumapuskuria tai lokituspalvelua.
Rajatun paketin sisältö on **nykyisen hallinta-/recovery-operaation havainto**,
ei koko käynnistyksen virhehistoria tai 30 päivän tapahtumakeräys.

| Osa | Ehdotettu täsmäsopimus |
| --- | --- |
| Formaattierottelu | Rajattu paketti käyttää `supportBundleFormatVersion: 3` ja `kind: desktopOnly`. Täysi paketti pysyy versiossa 2. Suljetut erilliset skeemat, ei v2:n valinnaistettuja pakollisia kenttiä. Sama gzip, `.json.gz` ja nykyinen tiedostokirjoittaja. |
| Manifest | Versio, kind, luontiaika, satunnainen creation correlation ID ja täsmällisten dataosioiden SHA-256-checksumit. Ei backendin 30 päivän periodia tai tyhjiä history-osioita, joita voisi tulkita onnistuneeksi luvuksi. |
| `system` | Käynnissä olevan runtimen validoitu appVersion, buildRevision, Electron-versio, platform ja architecture. Lähde on mainin nykyinen runtime-/build-identiteetti, ei accepted-build-metadatan mahdollinen vanhempi versio; hyväksyntätila ei vaihda suorittajan identiteettiä. Ei backendVersionia, tietokanta-/yritystunnisteita, koneinventaarioa tai polkuja. Arvot validoidaan nykyisten omistajien säännöillä. |
| `availability` | Backend `notRunning` vain todistetun poissaolon perusteella, muuten `exitUnconfirmed`; database `notInspected`; diagnostic history ja incident history `notCollected`. Paketin valmistuminen ei todista prosessin poistumista, tietokannan terveyttä tai lokituksen onnistumista. |
| `observation` | Scope `currentOperation`; saatavuus `available` tai `unavailable`. Nykyisen käyttötapausomistajan ensimmäinen turvallinen virhe ja erillinen siivoushavainto vain, jos ne todella on havaittu. Puuttuva ei ole onnistunut, eikä aiemman käynnistyksen syytä rekonstruoida journalista. Enintään nämä kaksi tapahtumaprojektiota, ei kasvavaa tapahtumajoukkoa. |
| Virheprojektio | Nykyinen katalogi ja tukipaketin tapahtumakohtaiset tarkistukset omistavat sallitut kentät, koodit ja vaiheet. W7-delete/resume laajentaa samaa katalogia ennen kytkentää. Raaka Error, viesti, stack, journal, company/workspace/lineage-ID, polku ja salaisuus ovat kiellettyjä. Vapaata merkkijonoa ei muuteta turvalliseksi vain katkaisemalla tai isolla kirjainkoolla. |
| Puuttuva syy | Sallittu `unavailable`-havainto voi tuottaa rajatun tukipaketin, mutta käyttöliittymä ja tarkastin ilmoittavat sen puuttuvaksi. Historiallinen vika ei muutu selitetyksi eikä paketin luonti ratkaise recovery-tilaa. |

Main valitsee polun luotetusta runtime-/selector-tilasta, ei rendererin
parametrista. Nykyinen argumentiton `createSupportBundle()` ja mainin
native-vahvistus/Save-dialogi säilyvät. Vain nykyinen sallittu ikkuna,
pääframe ja sen hallintasessio voivat käyttää rajattua kyvykkyyttä.
Session/generation tarkistetaan myös vahvistuksen ja tiedostovalinnan
jälkeen ennen lukua ja julkaisua. Lopetettu kyvykkyys tai muuttunut tila
estää vanhan pyynnön jatkon; epävarmaa business-exitiä ei tulkita uudeksi
business-sessioniksi. Vienti lukee vain mainin nykyisen turvallisen
hallintahavainnon ja kirjoittaa native-valittuun kohteeseen.

Jatkosidonta sisältää myös nykyisen hallintaoperaation sukupolven ja
backendin havaitun saatavuustilan. Paluu samannäköiseen valitsimeen ei
palauta vanhan pyynnön valtuutta: nykyinen omistaja vaihtaa sukupolvea
siirtymässä. Rinnakkainen vienti estetään nykyisen kyvykkyyden sisällä.
Peruutus ei lue havaintoa eikä kirjoita tiedostoa. Viimeinen tuoreustarkistus
tehdään ennen nykyistä synkronista tiedostokirjoittajaa; väliin ei lisätä
uutta odotusta tai yleistä elinkaaripalvelua.

Täyden paketin backend-permissionin hylkäys, yhteysvirhe tai virheellinen
vastaus **ei** käynnistä rajattua vientiä fallbackina. Rajattu vienti ei
anna `viewDiagnostics`-/`createSupportBundle`-backend-oikeutta eikä
käynnistä backendia tai lue SQLitea. Business-tilan nykyinen täysi polku
ja selainkehityksen vientikielto säilyvät. Vahvistusteksti kertoo kumpi
paketti on kyseessä ja ettei rajattu paketti sisällä lokihistoriaa.

Väliaineisto käyttää installation-scopeen johdettua nykyistä runtime-juurta,
ei poistettavaa workspacea. Pakatun/puretun tiedoston nykyiset 25 MiB:n
rajat, yksityiset väliaikaistiedostot, kohteen polku-/tyyppitarkistukset ja
30 päivän temp-retention säilyvät. Kahden tapahtuman projektio tarkistetaan
ennen pakkausta; paketille ei tehdä automaattista lähettämistä. Tämä on
edelleen **salaamaton sanitoitu tukipaketti**, ei CI:n salattu raakavirhepaketti.

Virallinen `scripts/inspect-support-bundle.mjs` tarvitsee erillisen tiukan
v3-haaran ja turvallisen yhteenvedon, joka ei tulosta puuttuvia DB-/historia-
tietoja nollina. Nykyinen v2 ja `.ekysupport`-lukuyhteensopivuus säilyvät.
Tarkistin, runtime-projektio ja packaged smoke saavat samat hylkäys- ja
checksum-vektorit; tuotanto ei importoi kehittäjän tarkastinskriptiä.
Update-recoveryn erillistä vanhaa formaattia ei muuteta W7:n sivutyönä.

Kytkentäportti vaatii ensin nykyisen formaattirajan tiedostokokeen, sitten
ehdotetun v3:n todellisen gzip -> tiedostokirjoittaja -> tarkastin -kokeen,
väärän sessionin/ylimääräisten kenttien ja full-permission-fallbackin eston,
puuttuvan/virheellisen havainnon sekä lokitusvirheen regressiot. Varsinainen
W7-hallinta -> observer -> paketti -ketju ja headless packaged smoke
todennetaan tuotantokytkennässä. Pelkkä ehdokas- tai serializer-testi ei
todista käyttöoikeutta, havaintoa tai Electron-mainin kytkentää.

**W7.0:n nykyrajat todennettu:** 12 synteettistä kohdekoetta läpäisivät
nykyisillä tuotantokomponenteilla. Täysi v2-paketti kulki oikean gzipin,
tiedostokirjoittajan ja virallisen tarkastimen läpi; legacy-pääte säilyi.
Puuttuvat backend-/DB-tiedot, v2:n puuttuva osio, pelkkä version muutos ja
update-recoveryn erillinen formaatti hylättiin. Backend-loaderin virhe ei
kirjoittanut varapakettia; naapuritiedostojen tavut säilyivät. Loader-kokeessa
ei ajettu oikeaa backend-permissionia tai Electronia. Tämä on nykyisen rajan
karakterisointi, ei yllä ehdotetun v3:n tai W7-kytkennän hyväksyntä.

**W7.0:n erillinen ehdokasnäyttö (25.10.2026):** v3-ehdokkaan 29 ja
jatkorajaehdokkaan 31 tapausta sekä yhteinen tiukka tyyppitarkistus
läpäisivät erillisinä kohdennettuina tarkistuksina. Yksityinen v3-ehdokas
kulkee todellisen gzipin ja nykyisen tiedostokirjoittajan kautta rajattuun
ehdokastarkastimeen. Suljetut kentät, checksumit, pakatut/puretut kokorajat,
ensivirheen ja siivoushavainnon erottelu sekä puuttuva havainto tarkistetaan.
Nykyinen virallinen tarkastin hylkää edelleen v3:n; sitä ei ole muutettu.
Koe käyttää nykyisiä import/replace-virhetapahtumia, ei vielä W7-delete-
tapahtumia. Lokikirjoittajan todellinen tiedostovirhe ei poista omistajalla
jo olevaa turvallista havaintoa paketista. Tämä ei todista, että tulevan
W7-omistajan havainto on kytketty kerääjään.
Rajatussa katselmuksessa havaittu parserin avainjärjestys-/checksum-
ristiriita toistettiin regressiolla ja korjattiin ehdokkaaseen. Palautettu
validoitu dokumentti säilyttää tarkistetun esityksen; uudelleenvalidointi
ei saa muuttaa kelvollista pakettia checksum-virheeksi.
Ehdokkaiden rajattu riippumaton katselmus ja korjauksen jälkitarkistus
eivät jättäneet tämän kokeen avoimia löydöksiä; ne eivät ole koko W7:n
toteutuksen tai tuotantokytkennän katselmuksia.

Erillinen jatkorajakoe kattaa peruutukset, päällekkäisen pyynnön, dialogien
virheet sekä sessionin, operaation, lähettäjän, framen, saatavuustilan ja
kyvykkyyden päättymisen kesken vahvistuksen tai kohdevalinnan. Se vertaa
myös syntymättä jäävää kohdetta ja naapuritiedoston säilyneitä tavuja.
Tilat ja dialogit ovat injektoituja: tämä ei ole oikean Electron-IPC:n,
backend-permissionin tai käyttöliittymän hyväksyntätodiste.

Tuotantokytkennässä pitää vielä todentaa todellinen tilanomistaja ja
sukupolvien vaihto, W7-observerin tapahtuma ja lukuketju, virallisen
tarkastimen v3-haara sekä molemmat packaged-vientipolut. Ehdokas käyttää
paketoitua build-identiteettiä ja rajattua platform/architecture-joukkoa;
tuotannon tarkat sallitut arvot sidotaan omistavan runtimen sopimukseen,
eikä kokeen arvojoukko muuta täyden v2-paketin hyväksyntää.

## Formaatti

- uusien pakettien tiedostopääte `.json.gz`
- vanha `.ekysupport`-pääte säilyy tarkastimen legacy-yhteensopivuutena
- gzip-pakattu UTF-8 JSON
- `supportBundleFormatVersion = 2`
- toteutus Node.js:n `zlib`- ja stream-API:lla ilman uutta riippuvuutta
- formaattia ei vaihdeta ZIPiksi eikä Windowsin ulkoista pakkausprosessia
  kutsuta
- enimmäiskoko ennen pakkausta 25 MiB
- vähintään 5 MiB varataan manifestille, runtime- ja database-yhteenvedoille
  sekä muille ydinosioille
- diagnostiikkatapahtumien osabudjetti on 16 MiB
- incident-yhteenvetojen osabudjetti on 4 MiB
- katkaistut osiot ilmoitetaan manifestin `truncatedSections`-kentässä

Version 2 erottaa sanitoidut diagnostiikkatapahtumat ja minimoidut
incident-index-yhteenvedot omiksi checksum-osioikseen. Osioiden SHA-256-
checksumit havaitsevat tahattoman sisältömuutoksen, mutta ne eivät ole
digitaalinen allekirjoitus eivätkä todista artifactin alkuperää.

Diagnosticsin HTTP-yhteenvedon `operationalLogReadState` ei kuulu formaattiin
2. Backend projisoi tukipaketin `runtimeSummary`-kentät eksplisiittisesti
nykyiseen kenttäjoukkoon ennen mainin strict-validointia. Mainin tarkistinta
ei löysennetä lisäkentille. Vanhat yhteenvedon ajat ja määrät kuvaavat
havaittua aineistoa, eivät todista täydellistä historiaa tai writerin terveyttä.
Events-/incident-katkaisuliput syntyvät edelleen omista 30 päivän lukijoista,
eivät eri haun runtime-yhteenvedon tilasta. JSONL-, HTTP-, gzip- ja
checksum-ketju sekä nykyinen tarkastin todennetaan samalla generoituun
pakettiin; `.ekysupport`-lukuyhteensopivuus säilyy ilman uudelleenkirjoitusta.

## Sallittu sisältö

- manifest ja creation correlation ID
- app- ja backend-versiot, build revision, build-aika ja dirty-tila
- platform ja architecture ilman käyttäjänimeä
- tietokannan health- ja migration-yhteenveto ilman polkua
- operational log -yhteenveto
- viimeisen 30 päivän sanitoidut warn/error-eventit
- saman aikavälin security-eventit
- incident indexistä luetut ryhmitellyt yhteenvedot ilman raw-rivejä
- SMTP:n warning/error-tason transport-virheistä vain SMTP-profiili,
  TLS-versio, allowlistattu cipher ja sertifikaatin SHA-256-sormenjälki,
  jos turvallinen transport-yhteenveto on saatavilla
- `invoicePdfArchive.queueFailed` vain tapahtuman allowlistatulla
  virhekoodilla, vaiheella, outcome-arvolla, retryable- ja
  side-effect-tilalla; ei lasku-, dokumentti-, toimitus-, yritys- tai
  polkutunnisteita
- SHA-256-checksum jokaiselle dataosiolle

Tukipakettia varten on oma reader, joka lukee vain warning/error- ja
security-virtoja. Info-lokit eivät kuluta sen tiedosto- tai tavubudjettia.
SMTP:n onnistuneet info-tason transport-eventit eivät kuulu tukipakettiin,
vaikka info-event olisi virheellisesti päätynyt warning/error-tiedostoon.
Reader rajaa lähteet täsmällisesti viimeiseen 30 päivään ja käsittelee
segmentit uusimmasta vanhimpaan.

Tapahtuma- tai ryhmäraja ei lopeta muiden valittujen lähteiden lukua.
Lähdetavu- ja tiedostobudjetti säilyy erillisenä: vain todella luetusta
aineistosta valitaan yhteisen aikajärjestyksen uusin prefiksi.
Tapahtuman tasatilanteen ratkaisee sen nykyinen projektiotunniste;
incident-ryhmän tasatilanteen tapahtumanimi ja koko nykyinen ryhmäavain.
Tapahtumat deduplikoidaan tunnisteella. Ristiriitaiset saman tunnisteen
projektiot ilmoitetaan osittaisuutena; niistä valitaan havaittu uusin,
ei väitetä rekonstruoiduksi muuttumattomaksi historiaksi.

Ehdokkaita karsitaan erissä: väliaikainen joukko on enintään kaksi kertaa
nykyinen tulosmääräraja ja yksi käsiteltävä alkio. Incidentien rajatut
lähderivit säilytetään vain nykyisen lähdetavubudjetin sisällä. Valittujen
ryhmien laskurit ja ensimmäinen/viimeinen aika lasketaan uudelleen juuri
näistä samoista riveistä, ei toisella muuttuvan tiedoston lukukerralla.
Lähdekatkaisussa luvut kattavat vain havaitut rivit, eivät varmasti koko
30 päivän historiaa. Lopullinen tavuraja tarkistetaan valmiista
projektiosta myös laskurin numeromäärän ja JSON-taulukon erotinmerkkien osalta.

`sourceTruncated` välittyy manifestin `truncatedSections`-tiedoksi. Katkaisu
ilmoitetaan, jos tapahtuma-, tavu-, tiedosto- tai pakettibudjetti täyttyy,
relevantti lähde on rikkoutunut tai osittain luettu tai reader ei muuten voi
todistaa koko 30 päivän aikavälin kattavuutta.

Osabudjeteissa ja lopullisessa kokonaisbudjetissa säilytetään aina
uusimmasta vanhimpaan järjestetty suurin mahtuva prefiksi. Jos lopullinen
25 MiB:n raja ylittyy ydinosioiden jälkeen, diagnostiikkatapahtumia
katkaistaan ensin. Incident-yhteenvetoja katkaistaan vasta, kun
diagnostiikkatapahtumat on tyhjennetty eikä paketti vieläkään mahdu.
Manifestin truncation-tiedot ja osioiden checksumit lasketaan aina
lopullisesta sisällöstä. Jos ydinosiot eivät yksin mahdu kokonaisbudjettiin,
paketin muodostus epäonnistuu turvallisesti.

Incident-index-reader lukee kiinteästä `incident-index`-hakemistosta vain
nykyisen ja tarvittaessa edellisen vuoden tunnetut tiedostot. Pakettiin
palautetaan vain ryhmitelty `eventName`, `errorCode`, `outcome`, versio-,
build-, fingerprint-, count- ja aikaväliyhteenveto.

## Kielletty sisältö

- SQLite-tietokanta, PDF:t tai laskurivit
- invoice/customer rows tai koko business activity feed
- nimi, osoite, puhelin, sähköposti, IBAN tai henkilötunnus
- SMTP-salaisuus, runtime-session, token, cookie tai authorization-header
- SMTP:n remote IP, target port, attempt/operation ID tai sertifikaatin
  raakadata
- sähköpostirunko, MIME tai provider response
- ympäristömuuttujat, Windows-käyttäjänimi ja userData-polku
- PDF-arkiston kohdepolku, laskunumero, invoice/document/delivery event id,
  PDF-tiiviste tai arkistointibrokerin raw error
- `.ekybackup`-payload tai sen salattu sisältö
- backupin salt, nonce, authentication tag, salasana tai johdettu avain
- konekohtainen palautuspiste tai sen suojattu avainmateriaali
- restore-staging-profiili, backup/restore-journal tai raaka polku
- päivityspaketti, rollback-pakettivälimuisti, installer manifest/checksum,
  installer command tai update-journal
- raw stack tai raw JSONL-rivi

Recovery point- ja restore-eventeistä tukipakettiin saa tulla vain
Diagnostics-readerin uudelleenvalidoima nykyinen sanitoitu projektio:
event-nimi, app/build/runtime-konteksti, satunnainen `correlationId`,
allowlistattu stage, kesto, turvallinen error code, retryable- ja
side-effect-tila. Recovery point -kind voidaan säilyttää vain, jos se on
katalogin allowlistalla. Incident-yhteenveto ei sisällä correlation-,
operation- tai entity-tunnisteita. Raakaa journalia, manifestia, polkua,
salaisuuksia tai business-tunnisteita ei sisällytetä.

`restore.acceptanceFailed` välittyy samalla error-tason lukuketjulla.
Sen kolme sallittua vaihetta, kuusi sallittua syykoodia ja pakolliset
failure-kentät tarkistetaan myös tukipaketin vastaanottorajalla
[tapahtumakatalogin mukaisesti](r0-observability-event-catalog.md#desktop-operational-ja-security).
Minimoitu incident-yhteenveto ei sisällä vaihetta, kestoa tai korrelaatiota.
Formaatti, säilytysajat ja kokorajat eivät muutu.

Workspace-tuonnin ja korvauksen `workspaceBackup.operationFailed` sekä
`workspaceBackup.cleanupFailed` käyttävät samaa rajattua teknistä
projektiota ilman recovery point -kindiä. Näille sallitaan vain suljettu
syykoodi, `import|replace`-vaihe, kesto, satunnainen korrelaatio,
`retryable: false` ja `sideEffectState: none|unknown` sekä yhteinen
app/build/runtime-konteksti. Backendin projektorin lisäksi Electron mainin
tukipakettilukija tarkistaa tapahtuman kentät ja arvot uudelleen.
Ensisyy ja lisävirhe ovat erillisiä samalla korrelaatiolla; raakaa sisäistä
virheketjua ei sisällytetä. Incident-projektio pysyy yllä kuvatusti
minimoituna. Sopimusta tarkentaa
[tapahtumakatalogi](r0-observability-event-catalog.md#desktop-operational-ja-security);
formaatti ja kokobudjetit eivät muutu.

Portable-backupin `backup.failed` ja `backup.inspectionFailed` välittävät
nykyisessä sanitoidussa eventissä K-P3:n suljetun teknisen ensisyyn tai
toiminnon nykyisen yleiskoodin, eivät raakaa sisäistä virheketjua.
Info-tapahtumat eivät kuulu tukipakettiin. Incident-yhteenveto sisältää
error-tason `backup.failed`-tapahtumat, ei warn-tason tarkistushylkäyksiä.
Nykyisen ensisyyn ja kuluttajien sallitut tapahtumat määrittää
[tapahtumakatalogi](r0-observability-event-catalog.md#tarkistuksen-ensisyy-ja-lukijaketju).
Ensivirhe ja rollbackin erillinen selvityskoodi säilyvät, mutta vain
turvallinen projektio viedään tukipakettiin. Pelkkä palvelu- tai
projektoritesti ei todista todellista Electron-mainia tai paketoitua
palautusta. Hyväksytyn K-ketjun tila ja päivätty näyttö ovat
[M1:n kautta](release-0.3.0-m1-preparation-plan.md#jatka-tästä).
Tukipakettilukija tarkistaa backup-/restore-projektion tapahtumakohtaisesti.
Sallitut vaiheet, pakolliset kentät ja payload ovat
saman desktop-katalogin mukaisia kuin kirjoittajalla. Valinnaisen vanhan
tiedon puuttuminen säilyy sallittuna; väärän perheen metadata torjutaan.
Turvallinen virhesormenjälki kuuluu vain sen sallivaan virhetapahtumaan.
Formaatti, osabudjetit ja salaisuuksien poissulku säilyvät.

## Desktop-flow

1. Käyttäjä valitsee `Luo tukipaketti`.
2. UI näyttää tietosuoja- ja sisältöyhteenvedon.
3. Käyttäjä vahvistaa.
4. Electron main näyttää Save-dialogin.
5. Renderer ei anna tallennuspolkua backendille.
6. Paketti kirjoitetaan ensin runtimen väliaikaiseen tiedostoon.
7. Osioiden checksumit lasketaan.
8. Valmis tiedosto nimetään atomisesti käyttäjän valitsemaan kohteeseen.
9. Temp poistetaan virheessä.
10. Tulos lokitetaan ilman kohdepolkua.

Browser developmentissa voidaan näyttää diagnostics summary, mutta
tukipakettivienti ei ole käytettävissä.

Runtimeen jäänyt väliaikainen paketti poistetaan 30 päivän jälkeen.
Käyttäjän ulkoiseen kohteeseen tallennettua pakettia sovellus ei poista.

## Turvallisuus

Tukipaketin muodostus vaatii backend-permissionin ja desktop-capabilityn.
Jokainen event validoidaan ja redaktoidaan uudelleen ennen sisällytystä.
Paketti ei saa kasvattaa logs-rootin tai käyttäjän valitseman kohteen
oikeuksia eikä seurata symlinkkejä.

`.json.gz` ei ole salattu säiliö. Sisältö on minimoitu ja sanitoitu, mutta
käyttäjä jakaa tiedoston vain harkitusti sovitulle tukitaholle ja poistaa
ulkoisen kopion, kun käyttötarkoitus päättyy. Eky poistaa vain oman runtimensa
yli 30 päivää vanhat väliaikaiset tukipakettitiedostot.

Tukipaketti ei ole Eky-varmuuskopio eikä sitä voi käyttää liiketoimintadatan,
SQLite-tietokannan, laskujen tai asetusten palauttamiseen. `.ekybackup`
kuuluu ADR-0009:n toteutettuun, aina salattuun backup/restore-polkuun; sitä ei
saa sekoittaa salaamattomaan `.json.gz`-diagnostiikka-artifactiin. Vanha
`.ekysupport` tarkoittaa samaa legacy-
tukipakettiformaattia, ei varmuuskopiota.

Backup/Restore-polun suunnitteluperusta on dokumentissa
`docs/architecture/local-backup-and-restore-plan.md`.

## Paketoitu smoke

Windowsin packaged smoke kutsuu rendererille julkaistua rajattua
`createSupportBundle()`-toimintoa, käyttää smoke-tilan kiinteää
väliaikaiskohdetta ja purkaa syntyneen paketin. Se validoi formaattiversion,
osiokohtaiset checksumit, runtime- ja build-identiteetin, tietokannan
yhteenvedon, diagnostiikkatapahtumat, todelliset incident-yhteenvedot sekä
katkaisutiedot. Smoke tarkistaa myös kiellettyjen salaisuuksien,
henkilötietojen, business-datan, polkujen ja PDF-datan poissulut ja poistaa
artifactin lopuksi.

## Paikallinen tarkastin

Kehittäjä tai tukihenkilö voi validoida käyttäjän toimittaman tukipaketin
ilman lisäriippuvuutta:

```text
pnpm support:inspect -- "C:\polku\eky-support-2026-07-28.json.gz"
```

`support:inspect` on tukipaketin virallinen tarkistusmenetelmä. Se hyväksyy
sekä uuden `.json.gz`-päätteen että legacy-`.ekysupport`-päätteen, mutta ei
päättele paketin luotettavuutta tiedostopäätteestä. Komento tarkistaa regular
file/no symlink -rajan, pakatun ja puretun
25 MiB:n kokorajan, gzipin, formaattiversion, tarkat osiot sekä osioiden
SHA-256-checksumit. Oletustuloste sisältää vain formaatin, luontiajan,
versio- ja build-tiedot, tietokantayhteenvedon, tapahtumamäärät,
katkaistut osiot ja checksum-tilan. Se ei tulosta yksittäisiä tapahtumia.

7-Zip voi purkaa `.json.gz`-tiedoston suoraan JSON-tiedostoksi manuaalista
tarkastelua varten. Purettu JSON ei ole salattu. Sisällön tekninen validointi
tehdään silti `support:inspect`-komennolla.

Valinnainen `--write-json "<kohde.json>"` kirjoittaa puretun, salaamattoman
JSONin ensin saman hakemiston väliaikaistiedostoon ja nimeää sen lopuksi.
Olemassa olevaa kohdetta ei korvata ilman `--force`-valintaa. Käyttäjä vastaa
puretun kopion hallitusta säilytyksestä ja poistamisesta.

Tarkastin on kehittäjätyökalu. Packaged smoke säilyttää oman tuotantoartifactin
luottamusrajaa testaavan validatorinsa eikä tuotantoruntime riipu
tarkastinskriptistä.
