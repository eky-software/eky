# Diagnostiikan täydennyssuunnitelma: 0.3.0

## Tila ja rajaus

Tila: lähdekoodikatselmointi ja synteettinen tarkistus tehty 2026-09-22;
alla olevia tuotantokorjauksia ei ole vielä toteutettu. Omistajan saman päivän
päätöksellä tavoitejulkaisu on `0.3.0`. Aiempi työnimi `0.2.9`, tämän
tiedoston nimi ja `D029-*`-tunnukset säilyvät historiallisina viitteinä.
Yhteinen rajaus ja tehtävälista ovat
[0.3.0-julkaisusuunnitelmassa](release-0.3.0-plan.md).
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

**Havainto:** `workspaceManagementComposition.ts` ei anna
`WorkspaceManagementService`-palvelulle observeria. Palvelun virhepolku
lisäksi yleistää replacement-virheen ennen havainnointia.
`WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH` ja `lineageCheck` eivät säily
yleisessä `WORKSPACE_MANAGEMENT_INVALID`-virheessä.

**Tavoite:** kytketty observer ja rajattu syy-/vaiheluokitus. Käyttäjäviesti
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

**Havainto:** desktopin writer hyväksyy `update.*`-tapahtumia, mutta
`diagnosticOperationalEventProjector.ts`:n desktop-katalogi ja
API-clientin `diagnosticsTypes.ts` eivät sisällä niitä.
`update.packageInspectionFailed` hylätään sekä projektiossa että
strict clientissä. Tukipaketin tapahtumalukija käyttää samaa projektoria.

**Tavoite:** sovittu turvallinen päivitysprojektio koko lukuketjuun.
Kaikkia writerin kenttiä ei siirretä automaattisesti eteenpäin.

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

**Havainto:** `JsonLineDesktopOperationalLogger` tukee failure sinkiä,
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
väitetä varmaksi fallbackiksi levyvirheessä; näkyvän häiriötilan sopimus
päätetään erikseen. Ei ilmoitustulvaa tai salaisia tiedostopolkuja.

## Käytettävyysparannukset

### R030-08: Diagnostiikan historian selaus

**Päätös 2026-09-22:** vanhempien tapahtumien selaus kuuluu `0.3.0`:aan.
Tehtävä on yhteisessä julkaisulistassa tunnuksella `R030-08`; toteutus
ja muuttuva API-sopimus ovat vielä suunnittelematta.

**Nykyinen raja:** `listDiagnosticEvents` palauttaa oletuksena 100
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

### Muut käytettävyystoiveet

**D029-06, suositus:** lisää diagnostiikan päivitystoiminto ja viimeisimmän
onnistuneen haun aika. `useDiagnostics` hakee tiedot vain efektin ajossa ja
`Promise.all` poistaa myös onnistuneen osan, jos toinen haku epäonnistuu.
Arvioi osakohtainen virhetila ja hallittu uudelleenyritys. Vanha tieto
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

Nykyisen lähteen kohdetestit: 161 testiä / 25 tiedostoa läpäisi.
Erilliset seitsemän synteettistä tutkimustestiä toistivat nykyiset puutteet;
niiden läpäisy ei ole korjausten hyväksyntä. Paketoitua UI-/restore-/update-
hyväksyntää tai uutta julkaisua ei tehty tässä dokumentointivaiheessa.

1. Rajaa D029-01 ja D029-02 tapahtumasopimuksineen ja kytkentätesteineen.
2. Korjaa D029-03 rajatut lukijat ja lisää oikeaa aikajärjestystä vaativat
   pysyvät regressiotestit molempiin read modeleihin.
3. Päätä D029-04 ja D029-05 häiriö-/kattavuussopimukset, toteuta ja testaa
   tuotantokytkennät. Nykyistä turvallisuusrajaa ei väljennetä.
4. Suunnittele ja toteuta julkaisuun sovittu R030-08:n historian selaus
   yhdessä D029-04:n kattavuustiedon ja R030-01:n latauspalautteen kanssa.
5. Toteuta D029-06 erillisenä UI-täydennyksenä, jos se mahtuu julkaisuun.
6. Aja muuttuneiden vastuiden integraatiot ja riskin edellyttämät packaged-
   portit. Varmista lopullisen tukipaketin sisältö ja tieto katkaisusta.

Tämä suunnitelma ei korvaa yhteisen 0.3.0-tehtävälistan priorisointia. Hyväksytty
palautuksen yritysrajaus, datamalli ja käyttöoikeusmalli eivät muutu.
