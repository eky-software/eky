# Diagnostiikan täydennyssuunnitelma: 0.3.0

## Tila ja rajaus

Lähtöhavainnot ovat 2026-09-22 tehdystä lähdekoodikatselmoinnista ja
synteettisestä tarkistuksesta. K:n hyväksytty toteutus on sen jälkeen
kytkenyt workspace-observerin ja turvalliset tarkistussyiden lukuketjut;
kaikkia alla olevia korjauksia ei siksi kuvata toteuttamattomiksi.
Diagnostiikan jäljellä oleva työ jakautuu julkaisusuunnitelman mukaan:
`D029-01` ja `D029-02` kuuluvat G:n tapahtumaketjuun, `D029-03`, `D029-04`
ja `D029-05` H:n saatavuuteen ja oikeellisuuteen. `D029-*` on historiallinen
tunniste, ei Company Settingsin D-paketin rajaus eikä toinen työjono.
Tavoitejulkaisu on `0.3.0`. Aiempi työnimi `0.2.9`, tämän
tiedoston nimi ja `D029-*`-tunnukset säilyvät historiallisina viitteinä.
Yhteinen rajaus ja tehtävälista ovat
[0.3.0-julkaisusuunnitelmassa](release-0.3.0-plan.md).
G:n toteutus ja erilliset PR/main-portit on hyväksytty 23.10.2026
[PR #314:n loppuhyväksynnällä](https://github.com/eky-software/eky/pull/314#issuecomment-6356610094).
Tapahtumakohtainen sisällytys/poissulku säilyy [M1:n G-sopimuksessa](release-0.3.0-m1-preparation-plan.md#g--diagnostiikan-tapahtumaketjun-suunnitelma).
Myös H1-H5 ja D029-03/04/05 on hyväksytty erillisillä PR/main-porteilla
[PR #315:n loppuhyväksynnässä](https://github.com/eky-software/eky/pull/315#issuecomment-6364180918).
Seuraava julkaisuun kuuluva diagnostiikkatyö on M4:n R030-08-historiaselaus,
ei G/H:n uudelleentoteutus. Alla olevat D029-03/04/05-havainnot kuvaavat
korjauksia edeltänyttä tilaa; niiden hyväksyntäehdot ja nykyiset turvarajat säilyvät.
Tämän dokumentin vanha tarkistustulos ei itsessään ole toteutushyväksyntä.
Manifestien versionosto tehdään erikseen `release-versioning-policy.md`:n
mukaan; tämä suunnitelma ei muuta ajettavaa versiota.

Tarkistus kattoi diagnostiikan lukijat, projektiot, API-clientin, UI:n,
tukipaketin, lokikirjoittimet ja valitut production composition -kytkennät.
Se ei ole koko sovelluksen auditointi eikä kaikkien tapahtumapolkujen
paketoitu hyväksyntätesti. Tämä dokumentti sisältää vain projektin
lähdekoodista ja synteettisistä testitapauksista johdetut havainnot.

Säilyvät sopimukset: Diagnostics on read-only, business audit on erillinen,
technical logging on best-effort eikä lokitusvirhe muuta business-tulosta.
Tuntemattomia kenttiä ei hyväksytä läpipääsyn helpottamiseksi. Ei uusia
riippuvuuksia, telemetriaa, etälähetystä tai piilotettuja varmuuskopioita.
Mahdollinen uusi tila-/DTO-sopimus rajataan ja hyväksytään ennen toteutusta.

## Korjauskohteet

### D029-01: Työtilatoiminnon turvallinen virhesyy talteen

**Alkuperäinen havainto:** syyskuun tarkistuksessa workspace-compositionin
observer puuttui ja replacement-virhe yleistyi ennen havainnointia.
Nykyinen composition välittää loggerin ja runtime-identiteetin observerille;
tuonnin ja korvauksen turvallinen ensisyy sekä erillinen cleanup-tapahtuma
on määritelty [katalogissa](r0-observability-event-catalog.md#tarkistuksen-ensisyy-ja-lukijaketju).
G on hyväksynyt tästä jäljelle jääneen väärän lineagen palautteen sekä
create/import/replace/switch/rename-kattavuuden nimetyssä rajauksessaan.
D029-01 on suljettu yllä linkitetyllä G:n ketju- ja integraationäytöllä,
ei pelkän observer-kytkennän olemassaolon perusteella.

**Tavoite:** nykyisen observerin rajattu syy-/vaiheluokitus. Käyttäjäviesti
voi pysyä yleisenä, mutta tekninen tapahtuma erottaa väärän yrityksen
varmuuskopion muista hylkäyksistä ilman yrityksen nimeä, tunnistetta,
tiedostopolkua, salasanaa tai raakaa poikkeusta. Samalla tarkistetaan
create/import/replace/switch/rename-polkujen tarkoitettu kattavuus.

**Hyväksyntä:** production composition -testi ja synteettinen väärän
lineagen hylkäys tuottavat yhden sovitun päätetapahtuman turvallisine
syineen. Hylkäys ei aloita palautusta tai muuta kummankaan työtilan dataa.
Tapahtuma kulkee sovitun Diagnostics-/tukipakettiprojektion läpi. Mahdollinen
restore/lifecycle-muutos tarvitsee nykyisen hardened Windows -portin.

### D029-02: Päivitystapahtumien katalogikatkos

**Alkuperäinen havainto:** desktopin writer hyväksyy `update.*`-tapahtumia, mutta
`diagnosticOperationalEventProjector.ts`:n desktop-katalogi ja
API-clientin `diagnosticsTypes.ts` eivät sisällä niitä.
`update.packageInspectionFailed` hylätään sekä projektiossa että
strict clientissä. Tukipaketin tapahtumalukija käyttää samaa projektoria.
G:n korjaus on hyväksytty sovituilla C2/C3C-projektioilla ja poissuluilla;
D029-02 on suljettu yllä linkitetyllä ketju- ja integraationäytöllä.
Alla säilyy korjauksen alkuperäinen havainto ja hyväksyntäsopimus.

**Tavoite:** sovittu turvallinen päivitysprojektio koko lukuketjuun.
Kaikkia writerin kenttiä ei siirretä automaattisesti eteenpäin.

**G:n säilyvät projektiorajaukset:** C2:n jo määritellyt
`update.operationStarted|operationCompleted|operationFailed` käyttävät
`preUpdateRecovery|runtimeShutdown|installerHandoff|firstStartValidation`-
vaiheita. Niiden julkinen sisällytys tai nimetty poissulku kirjataan
erikseen C3C-perheiden rinnalle; vaiheita tai Completed/Succeeded-tuloksia
ei muuteta toisikseen päättelemällä. Version näkyvyydessä erotetaan nykyinen
eventin `appVersion` mahdollisesta uudesta currentVersion/targetVersion/
releaseChannel-projektiosta. Jälkimmäistä ei hyväksytä yksityisen journalin
tai writerin kenttien perusteella. Nykyiset suppeat allowlistat säilyvät,
kunnes G:n omistava toteutus rajaa mahdollisen laajennuksen. Tämä kirjaus
ei avaa uutta päätöskysymystä dokumentaation siivouksessa.

**Hyväksyntä:** katalogivertailu, jossa jokaiselle tapahtumaperheelle on
sisällytys tai nimetty poissulku; onnistuvan ja epäonnistuvan päivityksen
writer -> reader -> HTTP -> strict client -> UI -sopimustesti sekä
virhetapahtuman tukipakettitesti. Version, syyn ja vaiheen näkyvyys ei
paljasta polkuja, journalin raakadataa tai asennusargumentteja.

### D029-03: Tukipaketin uusimmat tapahtumat yli lokivirtojen

**Havainto:** `FileSystemSupportBundleDiagnosticEventReader` täyttää
tapahtuma-/tavubudjetin tiedostojärjestyksessä ja lajittelee vasta valitut
tapahtumat. `FileSystemSupportBundleIncidentSummaryReader` toimii samoin
ryhmämäärän suhteen. Vanhempi desktop-tapahtuma voi täyttää budjetin ennen
uudempaa backend-tapahtumaa. Katkaisulippu kyllä asetetaan, mutta valinta
ei vastaa uusimman prefiksin tarkoitusta.

**Todennus:** kahden eri lokivirran synteettinen fixture. Ilman rajaa uudempi
tapahtuma on ensimmäinen; yhden tapahtuman/ryhmän rajalla jäljelle jää
vanhempi. Sama puute toistuu tapahtumissa ja incident-yhteenvedoissa.

**Hyväksyntä:** valinta perustuu tapahtuma-aikaan eri virtojen yli, ei
tiedostonimen järjestykseen. Testaa lomittuneet ajat, samat aikaleimat,
deduplikointi, incident-ryhmien laskurit sekä määrä-, tavu- ja lähderajat.
Luku säilyy rajattuna. Lähdebudjetin estäessä täyden kattavuuden tämä
ilmoitetaan, eikä osittaista lähdettä väitetä koko historian uusimmaksi.

### D029-04: Tyhjä tulos ei todista ehjää lokia

**Havainto:** `FileSystemDiagnosticEventReader` palauttaa saman tyhjän
listan tapahtumattomasta ja pelkkiä viallisia rivejä sisältävästä lähteestä.
`FileSystemOperationalLogDiagnosticSummaryReader` ilmoittaa lokit
saatavilla oleviksi tiedostojen olemassaolon perusteella. UI:n nykyinen
tyhjä viesti on "Diagnostiikkatapahtumia ei ole vielä." Lukemisen määrää
rajataan, mutta listan vastauksessa ei ole kattavuustietoa.

**Tavoite:** erottaa tyhjä tulos, osittainen aineisto ja epäonnistunut luku
turvallisella, rajatulla tilasopimuksella. Tiedostojen olemassaolo ei ole
todiste aktiivisesti toimivasta lokikirjoituksesta tai virheettömästä
sovelluksesta. Tilan uusi API/UI-muoto päätetään ennen koodausta.

**Hyväksyntä:** erilliset testit tyhjälle, vialliselle, lukukelvottomalle ja
rajojen katkaisemalle aineistolle. UI ei esitä puuttuvaa tietoa
"kaikki kunnossa" -tuloksena. Tukipaketin olemassa oleva
`sourceTruncated`-käyttäytyminen säilyy tai tarkentuu yhteensopivasti.

### D029-05: Desktopin lokikirjoituksen häiriö näkyväksi

**Lähtöhavainto:** `JsonLineDesktopOperationalLogger` tukee failure sinkiä,
mutta `desktopComposition.ts` ei anna sitä. Oletus on no-op. Ulompi
`DesktopIncidentIndexingOperationalLogger` kirjaa alkuperäisiä error- ja
security-tapahtumia, ei sisemmän writerin virhettä. Synteettinen
info-eventin kirjoituseste jää tällä kytkennällä ilman virhejälkeä.
Backendillä on erillinen `IncidentIndexOperationalLogFailureSink`.

**Tavoite:** rajattu ja turvallinen ilmoitus lokikirjoituksen tai
kapasiteetin häiriöstä olemassa oleviin vastuihin sopien. Tämä ei tarkoita
uutta yleistä logger-manageria tai rekursiivista kirjoittamista samaan
rikkinäiseen lokiin.

**Hyväksyntä:** production composition -testi; kirjoitusesto ja täysi
budjetti eivät muuta varsinaisen toiminnon tulosta. Myös varailmoituksen
epäonnistuminen käsitellään rajatusti. Saman levyn incident-tiedostoa ei
väitetä varmaksi fallbackiksi levyvirheessä. Omistaja hyväksyi H-P2:ssa
saman käynnistyksen ei-estävän sovellusilmoituksen. Tarkka
[toimitussopimus](observability-and-audit-plan.md#desktopin-lokikirjoituksen-häiriöpalaute)
ja [M1:n hyväksyntätila](release-0.3.0-m1-preparation-plan.md#h-p2-hyväksytty-writer-häiriön-palaute)
erottavat paikallisen toteutuksen integraatiohyväksynnästä.
Ei ilmoitustulvaa tai salaisia tiedostopolkuja.

## Käytettävyysparannukset

### R030-08: Diagnostiikan historian selaus

**Päätös 2026-09-22:** vanhempien tapahtumien selaus kuuluu `0.3.0`:aan.
Tehtävä on yhteisessä julkaisulistassa tunnuksella `R030-08`; hyväksytyn
jatkohaku-/API-sopimuksen toteutus ja todennus ovat M4.3:ssa kesken.

**Omistajan täsmennys 23.10.2026:** lajittelu ja rajattu sivutus tehdään
backendissä, ja käyttöliittymä pyytää vain kulloisenkin erän. Koko historiaa
ei lähetetä selaimelle siellä pilkottavaksi. Tarkka jatkohaku ja sen
työbudjetti määritellään lokilähteelle; nykyisten SQL-listojen offset-mallia
ei kopioida sellaisenaan muuttuvien lokitiedostojen päälle.

**Hyväksytyn lähtöversion raja:** `listDiagnosticEvents` palauttaa oletuksena 100
tapahtumaa, hyväksyy enintään 200 eikä tarjoa jatkohakua. Tiedostolukijalla
on lisäksi lähdetiedosto- ja tavurajat. Nykyisen otoksen vierittäminen tai
pelkkä suurempi `limit` ei anna pääsyä koko säilyneeseen historiaan.

**Tavoite ja hyväksyntäehdot:**

- Vanhempia tapahtumia haetaan erissä, ja käyttäjä voi palata uudempiin.
  Tarkka sivutus-/jatkohakusopimus ja ohjaimet hyväksytään ennen koodausta.
  Yksittäisen haun työ-, muisti- ja vastausmäärät pysyvät rajattuina.
- Näytetään erän aikaväli. Historian loppu erotetaan lukurajasta,
  epäonnistuneesta hausta ja osittaisesta aineistosta D029-04:n mukaisesti.
  Tuntematonta kokonaismäärää tai jatkon saatavuutta ei esitetä varmana.
- Selauskohta säilyy latauksen ja virheen aikana. Uusien tapahtumien
  saapuminen ei vaihda sitä huomaamatta. Latausilmaisin, hallittu
  uudelleenyritys ja saavutettavat ohjaimet testataan yhdessä R030-01:n kanssa.
- Järjestys on vakaa eri lokivirtojen yli myös samoilla aikaleimoilla.
  Muuttumattoman aineiston sivurajoilla tapahtumia ei katoa tai monistu.
  Lokin kierron, säilytysajan päättymisen ja muuttuneen aineiston vaikutus
  jatkohakuun määritellään; katkennut selaus ilmoitetaan turvallisesti.
- Backend säilyttää `viewDiagnostics`-tarkistuksen, kiinteän lokijuuren ja
  sanitoidun projektion. Kaikki uudet hakusyötteet validoidaan; käyttäjä
  ei voi antaa tiedostopolkua eikä jatkohaku avaa raakaa lokisisältöä.
- Testaa yli ensimmäisen erän ulottuva synteettinen historia useasta
  lokivirrasta, samat aikaleimat, uusi tapahtuma kesken selauksen,
  lokin kierto/poistuminen, virheelliset hakusyötteet, puuttuva oikeus,
  tyhjä historia, osittainen luku ja hidas/epäonnistuva haku. Varmenna
  reader -> HTTP -> API-client -> UI -ketju ja paketoidun sovelluksen selaus.

Ei muutosta retention-aikoihin, tukipaketin aikarajaan, salaisuuksien
poissulkuun tai business-auditiin. Aika-/virhesuodattimia tai automaattista
päivitystä ei hyväksytä tämän selaustoiveen sivutyönä.

#### M4.3: Suunnittelu ja toteutusjärjestys

**Valmistelu 24.10.2026:** lähdekartoitus tehty hyväksytystä mainista
`7d47bc9e1cf3482ae165c07f77a4919e4a5a29d1`. Omistaja hyväksyi jatkon
Goalina ja hyväksyi myöhemmin jatkohakusopimuksen toteutuksen ja testit.
Alla oleva sopimus ohjaa nyt tuotantototeutusta. Rajattu esikoe ei yksin
ole toteutuksen, maksimikuorman tai integraation hyväksyntä.
Nykytila ja edeltävän M4.2:n hyväksyntä ovat
[M1:n alussa](release-0.3.0-m1-preparation-plan.md#jatka-tästä).

**Esikokeen tila:** nykyisen lukijan vanhaa aineistoa ohittava lukuikkuna
toistettiin. Nykyistä projektoria käyttävät lukumalli ja jatkotilakoe
läpäisivät 33 synteettistä tapausta sekä tiukan tyyppitarkistuksen. Näyttö
kattaa myös erä-/kokonaistyön rajat, idempotentin jatkon, samanaikaisuuden,
vanhenemisen, molemmat selaussuunnat ja viivästetyn todellisen tiedostoluvun
sulun. Mukana on tutkimustesti, joka osoittaa, ettei luettelon tallennus
kiinnitä sen hetkisiä sisältötavuja. Rajattu riippumaton sopimuskatselmus
tarkensi navigointitokenien säilymisen ja HTTP:stä erillisen I/O-sulkuvastuun;
niihin ei jäänyt sopimustason estettä. Alla oleva konkreettinen sopimus
on hyväksytty toteutettavaksi. Koe ei todista suurimman
aineiston suorituskykyä, koko HTTP-/UI-ketjua tai tuotantosulun kytkentää.
Reader/application/HTTP, nimetty sulkukytkentä, strict-client ja web ovat
työpuussa pysyvine regressioineen. Oikea HTTP-/selainketju ja katkenneen
pyynnön tiedostoluvun sulku on todennettu. Alkuperäinen lukuvirhe löytyy
purettavasta salatusta testipaketista nykyisellä keräysketjulla.
Puhtaan Windows-paketin todellinen selaus-/tukipaketti-/palautusketju ja
rajattu loppukatselmus ovat läpäisseet. Normaalit täsmärevision PR/main-portit
ovat vielä kesken. Tarkka lähde ja näytön rajat ovat M1:n jatkamiskohdassa.
M4.3 ei ole vielä hyväksytty.

**Hyväksytty käyttötapa:** näkymä avautuu uusimpiin tapahtumiin, 100 tapahtumaa
kerrallaan. API:n nykyinen enimmäistulos 200 säilyy. Käyttäjä siirtyy
Vanhemmat-/Uudemmat-ohjaimilla ja aloittaa uuden selauksen Uusimmat-toiminnolla.
Ohjaimet noudattavat nykyisten listojen saavutettavaa esitystapaa.
Näkyvissä ovat erän aikaväli ja tapahtumamäärä; kokonaismäärää tai
viimeistä sivunumeroa ei arvata. Uusi tapahtuma ei siirrä näkyvää erää.
Haun aikana viimeinen onnistunut erä säilyy näkyvissä latauspalautteen kanssa.
Epäonnistunut haku säilyttää selauskohdan ja tarjoaa saman haun hallitun
uudelleenyrityksen. Vanhentunut selaus ilmoitetaan ja uusi aloitetaan
käyttäjän valinnalla. Yhteenvedon nykyinen erillinen lataus ja virhetila säilyvät.

| Vastuu | Hyväksytystä lähtökoodista varmennettu muutoskohta |
| --- | --- |
| Reader ja lähdeluku | `fileSystemDiagnosticEventReader.ts` valitsee uusimmat projektioista. `diagnosticLogSources.ts` rajaa listan 32 lähteeseen, ja `boundedJsonlSourceReader.ts` lukee kustakin enintään 256 KiB:n tailin. Vanhemmat tiedostot ja saman tiedoston vanhemmat tavut tarvitsevat jatkettavan lukutavan. Nykyinen lähdeluku on synkroninen; uuden työn rajaus ja backendin reagointi todennetaan. |
| Application/HTTP | `diagnosticEventReader.ts`, `listDiagnosticEvents.ts` ja `diagnosticRoutes.ts` tuntevat vain `limit`-syötteen. Palvelu tarkistaa `viewDiagnostics`-oikeuden. Jatkohaku ja sen virhemuodot lisätään näihin nykyisiin vastuisiin. |
| API-client | `diagnosticsTypes.ts`, `diagnosticsClient.ts` ja `diagnosticsResponse.ts` omistavat tyypit, queryn ja strict-validoinnin. Nykyinen DTO sallii vain `diagnosticEvents`- ja `readState`-avaimet. Kutsujat ja parseri päivitetään yhdessä. |
| Web | `useDiagnostics.ts` tekee yhden listahaun; `DiagnosticsPageView.tsx` ei tarjoa selausta. Hookin nykyinen vanhojen sessionvastausten torjunta säilyy, ja saman session päällekkäiset sivuhaut sidotaan omiin latausyrityksiinsä. Näkymä ja suomenkieliset tekstit käyttävät uutta sivutilaa. |
| Todellinen kytkentä | `diagnosticsComposition.ts` antaa lokijuuren ja yksityisen testihavaitsijan. Nykyinen `GET /diagnostics/events` on desktopin sallittu luku; privileged-IPC:tä ei tarvita selaamiseen. Paketoidun `packagedSmoke.ts`:n tapahtumavastausvalidaattori ja UI-polku päivitetään samaan sopimukseen. |

Lähdehaku ja globaali aikajärjestys ratkaistaan ennen pelkän cursor-kentän
lisäämistä. Nykyinen vertailu on `occurredAt` ja sitten projektion `id`,
uusimmasta vanhimpaan. Tunnisteen tasajärjestys määritellään eksplisiittisesti
niin, että se on sama kaikissa lukupaloissa. Tiedoston nimi, segmentti tai
rivin sijainti eivät todista tapahtumien aikajärjestystä. Pelkkä
aikaleimarajaus nykyisen tailin päällä ei kata säilynyttä historiaa.

**Ensimmäisen lukumallikokeen valmistumisehdot:**

- Usean tiedoston ja kaikkien kolmen lokihakemiston historia tavoitetaan
  myös yli nykyisten 32 tiedoston ja 256 KiB:n tail-rajojen. Jokainen pyyntö
  tekee rajatun työn; koko historiaa ei kerätä kasvavaksi muistitaulukoksi.
- Kokeen tulos määrittää luetut tavut, tiedosto-/hakemistotyön, rivin
  käsittelyn, muistissa säilyvät ehdokkaat ja keskeneräisen työn rajat.
  Myös hakemiston läpikäynti ja kaikki välitilat kuuluvat arvioon.
  Esikoe ei itsessään muuta nykyisiä turvallisuus- tai aikarajoja.
- Tapahtumat voivat olla fyysisesti eri aikajärjestyksessä. Sivurajan samat
  aikaleimat, UTF-8- ja rivirajat, deduplikointi sekä ristiriitainen sama
  tunniste testataan. Väärää tai liian pitkää riviä ei tarvita raakaprojektioon.
- Uusi append, rotaatio, tiedoston korvaus, lyheneminen ja retention-poisto
  erotetaan. Näkyvä erä ei vaihdu huomaamatta. Jos luotettavaa jatkoa ei
  voi todeta, tulos on vanhentunut tai osittainen, ei varma historian loppu.
- Valitaan pienin nykyiseen readeriin sopiva jatkotila. Mahdollinen
  backendissä säilyvä tila rajataan määrältään ja elinajaltaan; restart,
  peruutus ja sulku käsitellään. Jatkohaku ei jätä avoimia tiedostokahvoja
  tai rajaamattomia hakuja. Persistoitua loki-indeksiä tai uutta yleistä
  manageria ei hyväksytä tämän suunnitelman perusteella.

##### M4.3: Jatkohakusopimuksen ehdotus

**Tila:** omistajan hyväksymä jatkohakusopimus; toteutus ja testit käynnissä.
Writerit, retention, summary ja tukipaketti eivät muutu. Reader omistaa
alla olevan määräaikaisen tilan; pysyvää indeksiä ei rakenneta.

**Algoritmi ja lähteen muuttuminen:**

1. Luetteloi nykyiset kolme sallittua hakemistoa rajatusti. Kiinnitä rootin,
   hakemistojen ja sallittujen lähteiden identiteetit sekä lähteiden pituudet.
   Symlinkkejä ei seurata. Puuttuva valinnainen hakemisto ei yksin ole virhe.
   Epäonnistunut tai rajaan päättynyt luettelointi ei anna täydellistä listaa.
2. Lue valitut prefiksit kahdesti. Ensimmäinen kierros säilyttää vain
   `limit + 1` parasta erillisen tunnisteen ehdokasta. Toinen tarkistaa sivun
   tunnisteiden konfliktit koko aineistosta. Järjestys on numeerinen aikaleima
   ja sitten tunnisteen UTF-16-koodiyksikköjärjestys, laskevasti. Uudemmat-haku
   valitsee rajaa lähimmät uudemmat ehdokkaat; lopputulos esitetään samassa
   laskevassa järjestyksessä. Koko historian taulukkoa/joukkoa ei muodosteta.
3. Ensimmäinen kierros muodostaa prefiksikohtaisen SHA-256:n; toinen ja
   myöhemmät kierrokset vertaavat siihen. Sivu julkaistaan vasta molempien
   kierrosten jälkeen. Tämä on lukemalla varmennettu prefiksivalinta,
   **ei atominen hakemistotilannekuva**. Ennen ensimmäistä luentaa samalla
   identiteetillä muuttunut sisältö voi muodostaa alkuperäisen valinnan.
4. Append valitun pituuden jälkeen ja uusi rotaatiotiedosto näkyvät vasta
   Uusimmat-haussa. Valitun lähteen katoaminen, lyheneminen, korvaus tai
   poikkeava prefiksitiiviste vanhentaa selauksen. Vanhaa lähdettä ei korvata
   uudella eikä alkuperäistä osittaista loppuriviä täydennetä appendista.
5. Avaa tiedosto vain yhden lukupalan ajaksi, tarkista tyyppi/identiteetti
   myös avatusta kahvasta ja sulje ennen jatkotulosta. Lyhyt luku on virhe,
   ei loppumerkki. Tarkista lähteiden metadata myös kierrosten lopussa ennen
   julkaisua. Tämä ei lupaa käyttöjärjestelmätason suojaa saman käyttäjän
   vihamieliseltä kilpailulta tai havaita luennan jälkeistä muutosta takautuvasti.

**Ehdotetut resurssirajat** keskitetään Diagnosticsin omistamaan sopimukseen.
Ne eivät muuta nykyisiä sovellus-, testi- tai CI-aikarajoja.

| Raja | Ehdotus ja peruste |
| --- | --- |
| Tulos | Oletus 100, enintään 200; nykyinen julkinen tulosraja säilyy. |
| Luettelointi | Enintään 4 096 merkintää, myös ohitetut nimet, ja 1 024 lähdettä. Ylitys ei anna hiljaista otosta. Normaalin retentionin lähdemäärälle jää tilaa. |
| Valittu sisältö | Enintään 500 MiB yhteensä, nykyisen detailed-log-retentionin kokonaisbudjetti. Reader ei poista tai lyhennä aineistoa. |
| Koko sivuhaku | Kaksi kierrosta, enintään 1 000 MiB tavuluentaa. Tyhjä/konfliktinen sivu ei aloita kolmatta kierrosta. |
| HTTP-askel | Enintään 8 MiB, 128 enintään 64 KiB:n lukupalaa ja 64 lähteen metatietovaihetta. Ensimmäisen pyynnön luettelointi rajataan erikseen yllä. Rivipuskuri enintään 16 KiB; ylipitkä rivi ohitetaan rajatusti. |
| Ajoitus | Asynkroninen luku luovuttaa event loopille joka palan jälkeen. 50 ms:n yhteistyöbudjetti palauttaa jatkotilan turvallisessa rajassa, ei lupaa käyttöjärjestelmä-I/O:n pakkokeskeytystä. Sivun aktiivisen työn yhteisbudjetti 30 sekuntia ja enintään 4 096 askelta; ylitys päättää haun rajattuna. |
| Jatkotila | Enintään neljä selausta/reader, yksi aktiivinen lukuaskel ilman pyyntöjonoa. Enintään kahdeksan token-/vastausviitettä/selaus, nykyinen ja yksi edellinen valmis sivu sekä keskeneräisen sivun rajatut ehdokkaat. |
| Muisti | Enintään 16 MiB sarjoitettavaa tilaa/selaus: metadata, puskurit, ehdokkaat, vertailuesitykset ja säilyvät vastaukset mukana. Myös olio-/merkkijonomäärät rajataan. Tämä ei ole väite V8-keon tarkasta tavumäärästä. |
| Elinaika | Viisi minuuttia käyttämättömänä, enintään 30 minuuttia alusta. Ajastin vapauttaa tilan eikä pidä prosessia käynnissä. Kapasiteetissa vanhin ei-parhaillaan-luettava selaus saa vanhentua; aktiivista I/O:ta ei irroteta omistajastaan. |

Suurimman aineiston sivu voi yhä vaatia paljon I/O:ta. Rajattu jatkotila
ei muuta lajittelemattoman historian lajittelua indeksihaun hintaiseksi.
Maksimikuorman suorituskykyä ei päätellä pienestä kokeesta. Budjettiin
päättynyttä hakua ei julkaista varmana uusimpana eränä.
Hakemiston nimiluettelointi sulkee kahvansa samalla pyynnöllä: sen oma
4 096 merkinnän raja ja sivuhaun 30 sekunnin yhteistyöbudjetti koskevat myös
ensimmäistä pyyntöä. Se ei lupaa 50 ms:n HTTP-vastausta. Luetteloinnin
jälkeinen lähteiden metatietojen kiinnitys ja sisältöluenta jatkuvat pieninä
askelina. Kaikki aika mitataan monotonisella kellolla; HTTP-jatkojen välisiä
käyttäjän/verkon odotuksia ei lasketa aktiiviseksi työksi, mutta ne kuluttavat
tilan elinaikaa. I/O:n aloituksen jälkeen pelkkä kelloraja ei vapauta kahvaa.

**HTTP ja jatkotilan elinkaari:**

- Nykyinen `GET /diagnostics/events?limit=N` aloittaa selauksen.
  `GET /diagnostics/events?cursor=T` jatkaa tokenin nimeämää askelta/suuntaa.
  Yhdistelmä, tuntematon/toistuva avain, tyhjä arvo ja virheellinen raja
  hylätään. Token on 24 satunnaisen tavun base64url (32 merkkiä), ei polku,
  rajain tai käyttöoikeus. Vastaukset ovat `Cache-Control: no-store`.
- `viewDiagnostics` tarkistetaan ennen tilan käsittelyä jokaisella pyynnöllä.
  Sisäinen tila sidotaan backendin vahvistaman actor-kontekstin identiteettiin
  ja reader-instanssiin. Identiteetti ei kuulu projektion tai tokenin sisältöön;
  toisen kontekstin token ei toimi.
- Yksi askel muuttaa tilaa kerrallaan. Samanaikainen pyyntö saa `busy`-vastauksen
  ilman jonotusta. Viimeisen suoritetun askeleen token palauttaa saman
  säilytetyn vastauksen ilman uutta luentaa; vanhemmat kulutetut tokenit
  vanhenevat. Tämä koskee **askeltokeneita**, ei sivun navigointitokeneita.
  Replay on aiemman tuloksen toisto, ei lähteiden uusi tuoreustarkistus.
  Kadonnut vastaus ei ohita lukupalaa. Aloitusvastauksen katoaminen
  voi jättää yhden määräaikaisen tilan, ei jatkuvaa taustatyötä.
- Valmiin sivun vanhempi/uudempi-tokenit nimeävät readerin omistamat rajaimet.
  Rajaimet ovat ennen konfliktien poistoa valitun erän ensimmäinen ja
  viimeinen avain, myös tyhjällä sivulla. Näkyvän sivun navigointi säilyy
  keskeneräisen haun yli. Sen saman navigointitokenin käyttö palauttaa
  keskeneräisen työn nykyisen jatkon, ei aloita toista hakua. Onnistumisessa
  säilytetään lisäksi yksi edellinen sivu ja sen onnistuneen suunnan
  vastaus kadonneen vastauksen toistoon. Viitteitä on enintään kahdeksan:
  neljä sivusuuntaa, nykyinen ja viimeinen askeltoken sekä enintään kaksi
  suunnan tulosviitettä; samoja sivutavuja ei kopioida viitteisiin.
  `busy` ei muuta tilaa. `limited`/tilapäinen lukuvirhe päättää keskeneräisen
  työn ja sallii käyttäjän uuden yrityksen näkyvän sivun navigoinnista.
  `stale`, expiry ja kapasiteettihäätö sen sijaan mitätöivät koko selauksen:
  vanhat rivit säilyvät UI:ssa, mutta uusi haku alkaa Uusimmat-valinnasta.
  Selain ei rakenna kasvavaa sivuhistoriaa eikä lähetä lähdepolkuja.

| Vastaus | Täsmällinen merkitys |
| --- | --- |
| `scanning` | Vain jatkotoken; ei valmista tapahtumaerää tai `complete`-väitettä. |
| `ready` | `diagnosticEvents`, H:n `readState` ja molempien suuntien tila: `available` + token, `end` tai `unknown`. `end` vaatii täydellisen luennan valitun aineiston kyseiseen rajaan; osittaisuuden vuoksi todistamaton raja on `unknown`. |
| `limited` | Ei valmista sivua; `partial/limitReached`. Nykyinen näkyvä erä säilyy. |
| `unavailable` | Ei valmista sivua; H:n nykyinen lukukelvottoman lähteen tila. |
| `stale`, HTTP 409 | Tuntematon/vanhentunut token, väärä konteksti tai muuttunut lähde. Sama turvallinen palaute, ei lähteen yksityiskohtia. |
| `busy`, HTTP 429 | Aktiivisen lukuaskeleen tai kapasiteetin esto, ei automaattinen uusintakehotus. |

Syötevirhe on 400 ja oikeuden puute 403. Strict-client ja paketoidun testin
oma parseri käyttävät samoja tarkkoja vaihtoehtoja; summary/support eivät
peri uusia kenttiä. H:n lukukattavuus ei ole writerin terveystila.
Wire-muoto on suljettu unioni (ylimääräiset kentät hylätään):

```ts
type Direction = { state: 'available'; cursor: string }
  | { state: 'end' | 'unknown' };
type EventPageResponse =
  | { state: 'scanning'; cursor: string }
  | { state: 'ready'; diagnosticEvents: DiagnosticEventItem[];
      readState: DiagnosticReadState; older: Direction; newer: Direction }
  | { state: 'limited'; diagnosticEvents: [];
      readState: { status: 'partial'; reasons: ['limitReached'] } }
  | { state: 'unavailable'; diagnosticEvents: [];
      readState: { status: 'unavailable'; reasons: ['notConfigured'] | ['sourceUnavailable'] } };
// 409/429: { error: 'Diagnostic browsing is unavailable.', code: 'diagnostic_browse_stale' | 'diagnostic_browse_busy' }
```

`ready` ei hyväksy `unavailable`-lukutilaa. `available` ei lupaa epätyhjää
seuraavaa erää; `unknown` ei sisällä tokenia. Alkuhaussa käytettävissä olevat
kelvolliset lähteet säilyvät, vaikka toinen lähde olisi lukukelvoton:
H:n `partial/sourceUnavailable` estää silloin täydellisen kattavuusväitteen.
Jo valitun lähteen katoamista jatkohaun aikana ei ohiteta uutena lähdevalintana.
Konfliktiset tunnisteet jätetään pois ja merkitään `invalidEntries`.
Rajain etenee viimeiseen tarkistettuun ehdokkaaseen, ei julkaistuun riviin:
myös tyhjä `ready` + `available` on mahdollinen, eikä se tarkoita tyhjää
historiaa tai lupaa seuraavan sivun olevan epätyhjä.

**UI ja sulku:** yksi käyttäjän aloittama haku jatkaa `scanning`-vastauksia
sarjassa saman lataussukupolven sisällä. Se ei ole ajastettu taustapäivitys
tai virheen uusinta. Vanhat rivit säilyvät; muu lopputila pysäyttää ketjun
ja antaa palautteen. Näkymästä poistuminen/clientin vaihto peruu HTTP:n ja
estää vanhan vastauksen julkaisun. Reader ei lue ilman pyyntöä. Jo alkanut
I/O suljetaan todellisen valmistumisensa jälkeen; käyttämätön tila vanhenee.
HTTP:n katkeaminen ei todista kahvan sulkeutumista. Nykyinen HTTP-sulku
ei yksin todista katkenneen yhteyden reader-työn loppua. Reader omistaa
yhden aktiivisen lukuaskeleen valmistumisen ja idempotentin `close()`-lupauksen:
uudet työt estetään heti, vanha työ lopetetaan seuraavassa turvallisessa
rajassa, ja alkanut I/O sekä kahvan sulku odotetaan oikeasti loppuun ennen
tilan/ajastimien vapauttamista. Timeout tai abort ei korvaa tätä todistetta.
`diagnosticsComposition.ts` välittää tämän nykyisen `createApp`/`server.close`
-omistajan rajatuksi sulkukutsuksi. HTTP:n ja readerin sulku käynnistetään
molemmat ja kummankin lopputulos käsitellään, vaikka toinen epäonnistuisi;
salaisuusoperaatioiden nykyinen sulkutarkistus säilyy. Uusi runtime ei peri
tokeneita tai tilaa. Ei yleistä sulkurekisteriä, manageria tai sulkuohitusta.
Muutos vaatii myös nykyisen backup -> inspect -> restore -> restart ->
compare -portin, koska backendin sulkukytkentä kuuluu vaikutusalueeseen.

**Rajattu sopimuskoe ennen kytkentää:** budjetit molemmilla kierroksilla,
tyhjät tiedostot/luettelointirajat, kadonneen vastauksen idempotenssi,
samanaikainen jatko, vanheneminen/kapasiteetti, väärä actor, muuttuminen
kesken lukukierroksen ja sen jälkeen, append/rotaatio, konfliktin tyhjä sivu
sekä molemmat suunnat. Pienet injektoidut rajat, oikeat tiedostotavut ja
nykyinen projektori. Koe ei korvaa HTTP-/UI-/sulku- tai maksimikuorman
todennusta; pysyvät regressiot ja oikeat kutsujat kuuluvat M4.3.1-3:een.

| Toteutuspala | Valmistumisen näyttö |
| --- | --- |
| M4.3.0: lukumalli ja sopimus | Yllä oleva pieni synteettinen koe, mitatut resurssit, konkreettinen API-/UI-sopimus ja rajattu riippumaton katselmus. Avoimet turvallisuus- ja käyttäytymisvalinnat ratkaistaan ennen kytkentää. |
| M4.3.1: reader -> application -> HTTP | Pysyvät resurssi-, järjestys-, cursor-, syöte- ja permission-regressiot. Olemassa oleva projektori ja virheen testihavaitsija käytössä. Todellinen luku etenee ensimmäisen erän ulkopuolelle. |
| M4.3.2: strict-client -> web | Response-/query-testit sekä lataus-, virhe-, kaksoiskäynnistys-, vanha vastaus-, clientin vaihto- ja näkymästä poistumisen testit. Oikea selainpolku selaa vanhempiin ja takaisin, ja osittaisuus/vanhentuminen näkyvät oikein. |
| M4.3.3: paketoitu ketju ja integraatio | Saman puhtaan paketin todellinen diagnostiikkaselauksen polku, nykyisen tukipaketin regressiot, muuttuneiden vastuiden testit ja ohjeet sekä täsmällisen PR-headin ja uuden mainin omat nykyiset portit. Korvattu listapolku poistetaan kattavuuden todennuksen jälkeen. |

**Nykyisten kutsujien siirto:** uusi tapahtumavastaus ei koske vain
Diagnostiikka-sivua. Samassa muutoksessa päivitetään alla olevat suorat
lukijat. Valmis tapahtumaerä vaaditaan ennen sisältö- ja
yksityisyysväitteitä: pelkkä `scanning` ei saa läpäistä testiä siksi, ettei
vastauksessa vielä ole kiellettyä arvoa.

| Kutsujaryhmä | Säilytettävä todiste |
| --- | --- |
| Backendin HTTP-/composition-testit | `appHttpErrorHandling`, `appOperationalLogMaintenance` ja `invoicingArchiveDiagnosticsComposition` todentavat valmiista tapahtumaerästä alkuperäiset tapahtuma- ja kenttäehdot. Samassa testissä luettu tukipaketti käyttää edelleen omaa vastaussopimustaan. |
| API-client ja hallitut UI-kokeet | Lukutila-/projektiotestit päivittävät vain tapahtumavastauksen kehyksen; nykyiset kiellettyjen kenttien hylkäykset säilyvät. `diagnosticsReadMount.ts` valmistelee valmiin erän ennen hallittuja vastausviiveitä, jotta vanhan session torjuntaa ei sekoiteta jatkohaun askeliin. Reittimokit kattavat myös queryn sisältävän jatkon. |
| Todelliset web-/system-/Electron-polut | `diagnosticReadJourneys`, `invoiceFailureJourneys`, `customerAndCompanyJourneys`, `secretDrainDiagnostics`, `diagnosticEventChain`, `restartAndRecovery` ja `assertWorkspaceBackupSchemaRejection` kuluttavat rajatun jatkoketjun ennen nykyisiä väitteitä. Tiedosto-, tukipaketti-, palautus- ja native-todisteita ei korvata API-vastauksella. |
| Paketoidun sovelluksen lukija | `packagedSmoke.ts` odottaa ja validoi saman valmiin tapahtumavastauksen. Nykyinen luotettu sessionvälitys ja `GET`-reittirajaus säilyvät; uutta IPC-oikeutta ei lisätä. |

Testien yhteinen tapahtumahaun apuri kuuluu nykyisiin API-/fixture-vastuisiin:
vain validoitu `scanning` jatkaa samaa hakua, muu lopputila pysäyttää sen.
Askelmäärä ja nykyinen testiaika rajaavat ketjun. Odotettua tapahtumaa ei
etsitä uusilla aloitushauilla tai virheiden uusintasilmukalla. Tällä ei
rakenneta yleistä odotuskehystä eikä kirjoiteta muita testiperheitä uudelleen.

Nykyinen moduuli omistaa turvallisen teknisen lukuprojektion; business-audit,
writerit, lokiretention ja tukipaketin 30 päivän lähdevalinta säilyvät omissa
vastuissaan. Lokit ovat nykyisinkin asennuskohtaisia, eivät aktiivisen
yrityksen business-historiaa. Yritys- tai henkilötunnisteita ei lisätä.
Selaus ei tarvitse audit-eventtiä tai rekursiivista virhelokitusta.
Testin alkuperäinen I/O-virhe toimitetaan nykyiselle yksityiselle havaitsijalle
ennen turvallista muunnosta, ja nykyinen salattu toimitus todennetaan
vaikutusalueen testissä. Raakoja lokitiedostoja ei lisätä keräykseen.

Tuotantototeutuksen lukureitti kattaa Diagnosticsin moduuli-/turvallisuus-/
observability-/retention-/tukipakettiohjeet, API-clientin ja webin vastuut sekä
E2E-/desktop-ohjeet paketoidun todennuksen rajalla. Muuttuvat vastuut päivittävät
niiden nykyiset sopimukset, R0-testimatriisin ja käyttäjäohjeen samassa työssä.
Uutta riippuvuutta, tietokantamigraatiota, backup-artifactia tai yleistä
testijärjestelmää ei tarvita tähän rajaukseen. Pysyvä selausindeksi,
aika-/virhesuodatin ja automaattinen päivitys vaativat oman päätöksensä.

### Muut käytettävyystoiveet

**D029-06, edelleen erikseen rajattava suositus:** diagnostiikan Päivitä-toiminto
ja viimeisimmän onnistuneen haun aika. H korjasi alkuperäisen yhteisen
`Promise.all`-virhetilan: nykyinen `useDiagnostics` lataa listan ja yhteenvedon
erikseen ja säilyttää toisen onnistumisen. Tätä ei toteuteta uudelleen.
Erillinen päivityspainike, onnistumisaika ja hallittu uudelleenyritys eivät
seuraa automaattisesti H:n hyväksynnästä tai R030-08:sta. Vanha tieto
merkitään vanhaksi, ei nykyiseksi. Automaattista pollingia ei tarvita tämän
vuoksi. UI-muutos testataan myös hitaalla haulla ja näkymästä poistuttaessa.

**Valinnainen myöhempi työ:** virhe-/varoitussuodatus, turvallisen
virhekoodin/korrelaation kopiointi ja lyhyt tukiohje. Suodatin ei saa antaa
ymmärtää tutkivansa koko historiaa, jos se käsittelee vain viimeisten
tapahtumien otosta. Nämä eivät ole edellä olevien korjausten edellytyksiä.

Käyttäjän ohjeen tulee erottaa ilmoitus, tekninen loki, sanitoitu tukipaketti
ja varmuuskopio. Tukipaketti ei ole varmuuskopio eikä salattu; sen jakaminen
on aina käyttäjän päätös. Tuntemattoman lopputuloksen kohdalla ohje ei saa
kehottaa toistamaan esimerkiksi lähetystä tai palautusta sokkona.

## Tarkistustila ja toteutusjärjestys

Alkuperäisen 22.9.2026 katselmuksen kohdetestit: 161 testiä / 25 tiedostoa läpäisi.
Erilliset seitsemän synteettistä tutkimustestiä toistivat silloiset puutteet;
niiden läpäisy ei ole korjausten hyväksyntä. Paketoitua UI-/restore-/update-
hyväksyntää tai uutta julkaisua ei tehty tässä dokumentointivaiheessa.

1. D029-01/02:n tapahtumasopimukset ja ketjut on hyväksytty G:ssä.
   Niitä ei toteuteta uudelleen; nykyinen jatkamiskohta on M1:n M4-valmistelu.
2. D029-03:n aikajärjestys, rajatut lukijat ja pysyvät regressiot on
   hyväksytty H:ssa; myöhemmän muutoksen omat portit säilyvät.
3. D029-04/05:n lukutilat, häiriöpalaute ja todelliset tuotantokytkennät
   on hyväksytty H:ssa. Nykyistä turvallisuusrajaa ei väljennetä.
4. Suunnittele ja toteuta julkaisuun sovittu R030-08:n historian selaus
   yhdessä D029-04:n kattavuustiedon ja R030-01:n latauspalautteen kanssa.
5. Toteuta D029-06 erillisenä UI-täydennyksenä, jos se mahtuu julkaisuun.
6. Aja muuttuneiden vastuiden integraatiot ja riskin edellyttämät packaged-
   portit. Varmista lopullisen tukipaketin sisältö ja tieto katkaisusta.

Tämä suunnitelma ei korvaa yhteisen 0.3.0-tehtävälistan priorisointia. Hyväksytty
palautuksen yritysrajaus, datamalli ja käyttöoikeusmalli eivät muutu.
