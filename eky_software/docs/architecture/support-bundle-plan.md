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

W7.5:n kytkentäjärjestyksen ja avoimet elinkaariliitokset omistaa
[nykyinen toteutussuunnitelma](local-company-workspace-plan.md#w75-toteutussuunnitelma).
Alla oleva v3-sopimus on edelleen ehdotus/kokeella todennettu osa, ei
toimitettu backenditön vienti. W7.5 suunnittelee myös ennen yritysvalitsimen
valmistumista tapahtuvan virheen tukireitin ohittamatta startup-portteja.
Omistaja hyväksyi 6.11.2026 myös W7.5-suunnitelman rajatun native-viennin
ennen yritysvalinnan/pääikkunan valmistumista, vasta kokeiden ja katselmuksen
jälkeen. Sen kertakäyttöinen valtuus kuuluu virhettä käsittelevälle mainille;
alla oleva IPC-entryn ikkuna-/frame-/hallintasessiosuoja säilyy ennallaan.
Runtime-/build-identiteetti on ensin validoitava. Ilman sitä nykyinen
virheilmoitus ja poistuminen säilyvät, eikä yleistä startup-fallbackia avata.
Havainto otetaan ennen turvallista koodimuunnosta; puuttuva jää puuttuvaksi.

**W7.5:n nykyisen v2-entryn elinikäkorjaus:** sama capability tarkistaa
ikkunan, pääframen, dokumenttisukupolven ja dispose-tilan myös vahvistuksen,
tallennusvalinnan ja backend-haun jälkeen sekä juuri ennen synkronista
tiedostokirjoittajaa. Mainin erillisen tilavartijan on valmistuttava
synkronisesti; Promise ei ole valtuustodiste. Vanhentunut pyyntö ei kirjoita
eikä avaa vanhaa virhedialogia. Dispose poistaa omat kuuntelijat ja estää
myös jo odottavan pyynnön jatkon, ei vain uutta IPC-kutsua.

Alkuperäinen poikkeus tarjotaan synteettisen testin nimenomaisesti kytkemälle
yksityiselle havaitsijalle ennen turvallista virhemuunnosta. IPC:stä
heitetty virhe ei sisällä `cause`-ketjua tai raakaa metadataa: myös
Electronin konsoliraja on julkaisuraja. Havaitsijan, lokituksen tai
virheilmoituksen häiriö ei korvaa ensisyytä eikä muuta onnistunutta vientiä
epäonnistumiseksi. Tuotannon main ei kytke raakakeräystä tällä muutoksella.
Tämä korjaus ei vielä toteuta v3:a, hallintaoperaation varsinaista
sukupolvikytkentää tai ennen ensimmäistä ikkunaa käytettävää native-entryä.

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

**W7.5:n toteutettu tiedostoraja (6.11.2026):**
`supportBundleDesktopData.ts` omistaa kolmen osion suljetun projektion;
nykyinen arkisto-omistaja tuottaa v3:n ja virallisessa tarkastimessa on
sen erillinen Node-only-lukija. System-version on oltava nykyisen omistajan
mukainen SemVer, enintään 100 merkkiä; buildRevision on 7-40 pientä
heksamerkkiä tai kehitysruntimen eksplisiittinen `development`, ei puuttuvan
packaged-identiteetin oletus. Platformin metadata-arvot ovat `win32`,
`linux`, `darwin` ja arkkitehtuurin `x64`, `arm64`; tämä ei laajenna
tuettuja toimituksia tai anna runtimen avaamislupaa.

Saatavilla oleva havainto sisältää täsmälleen `firstError`- ja
`cleanupError`-kentät, joista vähintään yksi on nykyinen turvallinen
tapahtuma. Sallitut perheet ovat nykyiset `workspaceManagement.operationFailed`,
`workspaceBackup.operationFailed` ja `workspaceBackup.cleanupFailed`.
Poiston `deleteCleanup` kuuluu erilliseen siivouskenttään vain koodilla
`WORKSPACE_DELETE_CLEANUP_FAILED`. Tapahtumapari sidotaan samaan operaatioon,
korrelaatioon ja runtimeen eri tapahtumatunnisteilla. Nykyinen tapahtuma-
katalogi omistaa koodi-/vaiheyhdistelmät; tunnisteet ovat teknisiä UUID-arvoja,
aika kanoninen UTC ja app/build täsmälleen paketin suorittajan identiteetti.
Projektio ei siivoa vapaata tekstiä turvalliseksi tapahtumaksi.

Viiden kokonaisen tukipakettilähitiedoston 179 testiä, virallisen tarkastimen
21 testiä ja desktopin tyypitys läpäisivät. Oikea gzip -> nykyinen
tiedostokirjoittaja -> virallinen tarkastin sekä JSONin uusintaluku säilyttivät
checksumit ja avainjärjestyksen. V2/legacy-regressiot ja puuttuvan historian
rehellinen esitys säilyivät. Tarkastimen ei-merkkijonoisen virhekoodin
hyväksyntäaukko toistettiin ja korjattiin kielteisine regressioineen.
Tämä on sisältö-/tiedostorajan näyttö, ei mainin, IPC:n, native-viennin,
observer-kytkennän tai paketoidun sovelluksen hyväksyntä.

**W7.5:n yhteinen vientiomistaja:** `supportBundleCapability.ts` käyttää
samaa vahvistus-, kohdevalinta-, arkistointi-, kirjoitus- ja virhepolkua
täydelle v2:lle ja rajatulle v3:lle. Muoto valitaan eri main-factoreissa,
ei rendererin parametrilla tai täyden viennin virheen perusteella.
Ikkuna-entry säilyttää omat sender-/frame-/dokumenttivartijansa.
Mainin erillinen native-export kuluttaa kertakäyttöisen lupansa jo
ensimmäisellä kutsulla, myös peruutuksessa; sillä ei ole IPC-lähettäjää tai
keinotekoista ikkunaa. Molemmat tarkistavat omistajan synkronisen valtuuden
odotusten jälkeen ja ennen kirjoitusta. Suljettu tai vanhentunut lupa ei
kirjoita eikä avaa vanhan tilan virheilmoitusta.

V3:n tietolähde on synkroninen nykyisen mainin projektio. Väärä
asynkroninen palautus hylätään heti: sen dataa ei odoteta tai hyväksytä ja
mahdollinen Promise-hylkäys käsitellään ilman julkista raakavirhettä.
App/build tarkistetaan myös viejän suorittajan identiteettiin. Nämä pienet
entry-kokeet eivät vielä todista todellisen mainin hallintasukupolvea,
build-luottamuksen myöntämiskohtaa tai käyttöliittymää edeltävää vientiä.
Kytkentä näihin omistajiin odottaa omaa näyttöporttia.

### W7.5:n nykyisen operaation ja varhaisen viennin omistajuus

**6.11.2026: toteutussopimus ennen B3/B4-kokeita, ei ajonaikainen näyttö.**
Tämä täsmentää hyväksyttyä native-entryä, ei avaa yleistä startup-fallbackia.
Toteutuspalat ja portit ovat [W7.5-suunnitelmassa](local-company-workspace-plan.md#w75-b3b4n-omistajuussopimus).
V2:n sisältö, permission ja kutsusopimus sekä B1:n v3-formaatti säilyvät.

**B3a:n haaratoteutus:** palvelun `captureOperationContext` ja compositionin
`captureOperationObservation` ovat sisäisiä vain luku -portteja. Jälkimmäinen
palauttaa tuoreusvartijan ja erillisen synkronisen `readObservation`-luvun.
Palvelun `operationStarted`/`operationSettled`-ilmoitukset rajaavat enintään
kaksi turvallista projektiota; ne eivät ole uusia lokitapahtumia tai
valtuuksia. `observeProjectedEvent` toimittaa saman validoidun muuttumattoman
tapahtuman vastaanottajalle ennen loggeria. Näyttö ja seuraava portti ovat
[M1:n nykytilassa](release-0.3.0-m1-preparation-plan.md#jatka-tästä).
Valitsimen vientipyyntö käyttää haarassa alla kuvattua B3b-kaappausta;
startupin erillistä raportointilupaa ei vielä ole kytketty.
Tavallisen delete-komennon todettu loppukäsittely-/vapautusvirhe tuottaa
nykyisen ensitapahtuman lisäksi saman katalogin `deleteCleanup`-tapahtuman
samalla korrelaatiolla, enintään kerran. Se ei muuta heitettyä ensivirhettä,
varauksen vapautusta tai sulun epävarmuutta. Cold-jatkon nykyinen erillinen
siivoustapahtuma säilyy eikä sitä kahdenneta tässä liitoksessa.

**Valitsimen sukupolvi.** Nykyinen `WorkspaceManagementService` omistaa
sisäisen, vain lukuun tarkoitetun operaatiokontekstin: sukupolven,
korrelaation ja operaatiolajin. Sukupolvi vaihtuu ennen hyväksytyn
muuttavan komennon ensimmäistä odotusta; myös pääsyn sulkeminen ja shutdown
mitätöivät aiemman vientipyynnön. `status` tai rinnakkaisena hylätty
`BUSY`-pyyntö ei korvaa käynnissä olevan komennon havaintoa. Uusi komento,
myös onnistuva tai peruttu, syrjäyttää aiemman komennon virhetiedon.
Samaa sukupolvea ei palauteta tilan palatessa `idle`-tilaan.

Palvelun lukuportti palauttaa muuttumattoman kontekstin ja synkronisen
tuoreusvartijan vasta komennon, loppukäsittelyn ja varauksen vapautusyrityksen
päätyttyä. Se ei myönnä muutos-, sulku- tai uudelleenkäynnistysvaltuutta.
`closeAdmission` ei yksin tarkoita shutdownia: pääsyn sulkemisen jälkeen
asettunut virhe voidaan lukea **uudella** vientipyynnöllä, jos mainin
nykyiset omistajuusvartijat sallivat sen. Vanha pyyntö ei elvy.
Pääsyn sulku vaihtaa viennin sukupolven, ei keskeneräisen komennon
korrelaatiota; sen myöhempi ensivirhe-/siivoushavainto säilytetään saman
komennon loppuun asti.
Epävarma vapautus ei ole onnistunut vapautus tai backendin poistumistodiste.
Palvelun shutdown, compositionin vaihto tai mainin sulku estää uudenkin
viennin. Vain statusluvun onnistuminen ei muodosta raportointivaltuutta.

**Kaksi turvallista havaintoa.** `workspaceManagementComposition` sitoo
nykyisen `workspaceBackupOperationalObserver`-projektion yllä olevaan
kontekstiin. Observer muodostaa nykyisen katalogin tapahtuman kerran ja
tarjoaa sen erilliselle synkroniselle vastaanottajalle ennen lokikirjoitusta.
Vastaanottajan ja loggerin virheet eristetään toisistaan ja ensisyystä.
Composition säilyttää enintään nykyisen operaation ensimmäisen turvallisen
virheen ja erillisen siivousvirheen; ei raakaa poikkeusta tai historiapuskuria.
Runtime, korrelaatio, operaatiolaji ja tapahtumarooli tarkistetaan.
Myöhäinen, vieras tai toistettu havainto ei korvaa ensimmäistä. Havaintojen
vastaanotto päättyy komennon lopussa ennen uuden raportointikontekstin
luovutusta. Puuttuva tai virheellinen projektio on `unavailable`, ei arvaus.
Observer ei omista sukupolvea, vientilupaa tai palvelun tilasiirtymää.

`supportBundleCapability` ottaa uuden v3-pyynnön kontekstin talteen
**ennen ensimmäistä native-vahvistuksen odotusta**, ei factoryn luonnissa
eikä vasta tallennusvalinnan jälkeen. B2:n injektoitu yleinen tilavartija
ei yksin todista tätä. Kontekstin talteenotto ei lue havaintosisältöä;
peruutus ei lataa sitä. Havainto ladataan synkronisesti vain saman talteen
otetun kontekstin kautta vahvistuksen ja kohdevalinnan jälkeen. Nykyiset
sender-, frame-, dokumentti- ja dispose-vartijat sekä mainin tuoreusvartija
tarkistetaan edelleen kaikkien odotusten jälkeen ja ennen kirjoitusta.
Vanha `idle -> busy -> idle` -pyyntö hylätään, vaikka ikkuna olisi sama.

**B3b:n haaratoteutus:** v3-ikkuna-entryn `captureRequest` palauttaa
pyyntökohtaisen synkronisen vartijan ja vasta myöhemmin käytettävän datalukijan.
Kaappausvirhe jää nykyiselle yksityiselle havaitsijalle ennen turvallista
vastausta; vahvistusta tai sisältölukua ei silloin aloiteta. Async-kaappausta
ei odoteta tai hyväksytä, ja sen hylkäys käsitellään. Valitsimen composition
sitoo kaappauksen todelliseen `captureOperationObservation`-kontekstiin ja
main-varaukseen. Sulku disposeaa vienti-entryn synkronisesti; se ei odota
omaa native-dialogiaan tai päättele sen peruuntuneen. Prosessin saatavuus
on varovaisesti `exitUnconfirmed`, ei lifecycle-tilasta päätelty `notRunning`.
V2:n option-, backend-permission- ja datamuoto sekä native-entryn nykyinen
kertakäyttöinen sopimus säilyvät. Julkinen poistotoiminto ja B4 eivät kuulu
tämän pyyntöliitoksen näyttöön; ajantasaiset testit ovat M1:ssä.

**Ennen ensimmäistä ikkunaa.** `main/index.ts` omistaa yhden
käynnistysyrityksen raportointieliniän. `desktopComposition` ei luovuta
sen päättynyttä `assertStartupAuthority`-vartijaa myöhemmälle virhedialogille:
nykyinen startup päättyy ja sulkee/mitätöi varauksen ennen
`earlyStartup.onFailure(errorCode)`-kutsua. Virhekoodi ei ole vientilupa.

Composition saa toimittaa indexille muuttumattoman, turvallisen
virhekuittauksen vain nimetyn pre-business workspace-vaiheen hylkäyksestä:
poiston cold-jatko, create/import-kylmäpalautus, nykyinen ensimmäisen avauksen
palautus, työtilan ratkaisu/adoption tai yritysvalitsimen koostaminen.
Kuittaus sidotaan samaan käynnistysyritykseen ja nykyiseen buildiin; sen
vaihekohtainen keräys suljetaan onnistumisessa, eikä sitä lainata seuraavan
tai yleisen startup-vaiheen virheelle. Business-runtimen, proof-/smoke-ajon,
update-recovery-dialogin ja tavallisen v2-viennin nykyiset polut säilyvät.

Kuittaus edellyttää jo olemassa olevan build-portin onnistumista:
poiston cold-polussa `captureColdWorkspaceDeletionAdmissionFromRoot`-tuloksen
`buildAdmission`, muissa nimetyissä poluissa mainin nykyinen
`readBuildAdmission`. Pelkkä `readDesktopBuildInfo`/release-metadatan
muotovalidointi ei riitä. Ennen tätä porttia sattuva virhe, uusi
build-hylkäys tai epäselvä kuittauksen sidonta säilyttää nykyisen turvallisen
ilmoituksen ja poistumisen ilman vientiä. Vienti ei tee uutta build-/journal-
lukua tai siirrä cold-palautuksen järjestystä. Kehitystila on nykyisen
runtime-portin eksplisiittinen tulos, ei puuttuvan pilot-metadatan oletus.
Paketin identiteetti on suorittava build, ei hyväksyntämetadatan vanhempi build.

Nykyinen cold-omistaja rajaa oman observerinsa vain tähän kutsuun ja sitoo
sen korrelaation palvelun operaation alussa; myöhäiset tapahtumat hylätään
kutsun loppukäsittelyn jälkeen. Index vastaanottaa vain B1:n turvallisen
projektion, ei Erroria, journalia, polkuja tai workspace-tunnisteita.
Puuttuva havainto voidaan ilmoittaa puuttuvaksi, jos itse build- ja
käynnistysyrityssidonta on todistettu. `notRunning` vaatii nykyiseltä
omistajalta erillisen todetun poissaolon; muuten `exitUnconfirmed`.
Puuttuva lifecycle-kahva tai valmistunut Promise ei ole poistumistodiste.

Varhainen vientityö lainaa saman compositionin nykyistä operationalLoggeria
main-only-porttina; loggerin viite ei kuulu paketin dataan tai IPC:hen.
Uutta loggeria tai historiahakua ei tehdä. Kuittauksen toimituksen tai
vientilokin virhe ei korvaa alkuperäistä startup-virhettä. Jos kuittausta
ei voida sitoa luotettavasti, nykyinen virheilmoitus ja poistuminen säilyvät.

Index luovuttaa B2:n kerran käytettävälle native-exportille vain raportoinnin
luvan: sama käynnistysyritys/build, single-instance-omistajuus ja ei sulkua
tai relaunchia. Lupa ei palauta fyysistä workspace-varausta eikä salli
yrityksen avaamista, siivoamista tai muuta tiedostomuutosta kuin nykyisen
tukipakettikirjoittajan omat väliaikais-/kohdetiedostot. Sekä peruuttaminen,
onnistuminen että virhe kuluttavat sen. Uutta yritystä ei tehdä automaattisesti.

`desktopBeforeQuit` mitätöi tämän raportointiluvan synkronisesti myös silloin,
kun `desktopLifecycle` puuttuu. Relaunch ja single-instance-omistajuuden
menetys mitätöivät sen samoin. Vienti ei odota omaa before-quit-ketjua;
before-quit ei odota omaan startupin virhekäsittelyyn sisältyvää dialogia.
Native-dialogin peruuntumista ei oleteta: sen myöhäinen tulos käsitellään,
mutta mitätöity lupa estää havainnon latauksen, tiedostokirjoituksen ja
vanhan virhedialogin. Nykyinen kirjoittaja on synkroninen; sen eteen ei
lisätä odotusta eikä sen valmistumista päätellä disposesta. Normaalisti
`earlyStartup` odottaa virhekäsittelyn päättymisen ja poistuu edelleen
virhekoodilla. Epäonnistunut käynnistys ei muutu onnistumiseksi tukiviennillä.

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
Tuon kokeen aikainen virallinen tarkastin hylkäsi v3:n; kokeessa sitä ei muutettu.
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
sukupolvien vaihto, W7-observerin tapahtuma ja lukuketju sekä molemmat
packaged-vientipolut. Yllä oleva W7.5:n tiedostoraja kattaa virallisen
tarkastimen erillisen v3-haaran, ei näitä ajonaikaisia liitoksia. Ehdokas käyttää
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

Työtilan poiston ja journalista jatkamisen
`workspaceManagement.operationFailed` säilyttää katalogin suljetut
loogiset toiminnot, vaiheet ja syykoodit sekä erillisen cleanup-tapahtuman
samalla korrelaatiolla. Mainin nykyinen vastaanottaja validoi ne uudelleen;
incident-projektio on edelleen minimoitu. Tämä täyden tukipaketin
lukijasopimus ei toteuta yllä ehdotettua backenditonta v3-vientiä eikä
yksin todista cold-kuluttajan kytkentää.

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
