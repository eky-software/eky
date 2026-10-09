# Eky 0.3.0 -julkaisusuunnitelma ja tehtävälista

## Päätös ja nykyinen tila

**Ajantasainen jatko 9.10.2026:** T1/T2/T3, A1/A2/A3, Oma yritys -korjaukset
sekä koko B1-B5 hyväksyttyine integraatiojatkoineen ovat hyväksyttyjä.
Lähtö on [PR #298:n main ja loppuhyväksyntä](https://github.com/eky-software/eky/pull/298#issuecomment-6050339146).
[M1:n jatkamiskohta](release-0.3.0-m1-preparation-plan.md#jatka-tästä)
omistaa täsmärevision sekä sen PR- ja main-portit. Nykyinen työ on
[C-paketin valmistelu ja rajattu toteutus](release-0.3.0-m1-preparation-plan.md#c-paketin-valmistelu-ja-hyväksyntärajat):
desktopin graceful-only update, katkeamaton kirjoitussuoja, startup-exit,
create/import-recovery ja oletuspaketoinnin build-identiteetti.
Lähdevertailu on tehty. R18:n hyväksytty cold-terminal, vain lukeva journal-
admission polkukoosteineen, R17:n startup-omistajuus, R19:n oletus-buildin
täysi revisio ja R03:n strict-sammutuskytkentä on toteutettu rajatusti;
alemman tason testit läpäisevät. R03:n rajattu koodikatselmus ja sen
korjausten jatkokatselmus valmistuivat; julkinen lokisopimus säilyy.
R04:n backend/broker-osuus on tämän jälkeen kohdetodennettu: update-suojan
menetys ei vapauta business-kirjoituksia. Myös caller-owned palautuspisteen
palvelurajapinta ja operation-sidotun sulun backend-vastaanottaja ovat
kohdetodennettuja. Mainin operation-välitys ja prepare/handoffin yhteinen
omistus on kytketty ja rajatusti todennettu. Journalin epävarmuus ei vapauta
omistusta eikä ordinary-sulku valtuuta update-handoffia. Oikean prosessin ja
paketoidun päivitysketjun yhteinen todistus on vielä avoin.
R18:n hyväksytty prosessivaraus, työluvan siirto ja V2-journalin kylmäpalautus
on tämän jälkeen kytketty tuotantoon ja nykyisiin testikutsujiin. Viisi
todellista Electron-työtilapolkua sekä julkaistun luonti-/tuontikohteen
composition-todistus läpäisivät. Normaali testisarja ja tyypitys läpäisivät;
laajan kriittisen Electron-sarjan yksi prosessimäärähavainto on yhä avoin.
M1 omistaa seuraavaksi R19:n nykyrevision kuluttajat, paketoidun
luonti-/tuontipalautuksen, loppukatselmuksen ja erilliset update-/PR-/main-portit.
C:tä ei vielä ole hyväksytty kokonaisuutena. Aiemmat timeout- ja sulkuhavainnot
säilyvät avoimina omille revisioilleen, eivät uuden työn juurisyyväitteinä.
K, D:n muut ehdot, E/F/G/H/I, W7, sovittu käyttäjäkokemus ja M5 ovat
edelleen avoinna; koko 0.3.0 ei ole valmis.

### PR #298:n hyväksyntää edeltävä toteutushistoria

<details>
<summary>Aiemmat B-valmistelun ja A-integraatioiden checkpointit</summary>

**Checkpointin tilanne 6.10.2026:** A1/A2/A3, Oma yritys -korjaukset sekä
B1/B2 ja niiden sulku-/keräysjatkot on hyväksytty. Lähtö on PR #297:n main;
[M1:n jatkamiskohta](release-0.3.0-m1-preparation-plan.md#jatka-tästä)
omistaa täsmärevision ja sen hyväksyntänäytön. Nykyinen työ on
[B3-B5:n toteutusvalmistelu](release-0.3.0-m1-preparation-plan.md#b3-b5-toteutusvalmistelu):
ALV-lukupolun rajattu korjaus on kohdetodennettu työpuussa, ja revisioiden,
PDF:ien, toimitusten sekä palautuksen tekninen sopimus on katselmoitu.
Tietoja säilyttävä migraatio 039 ja tietokantatyypit ovat työpuussa.
Migraation ja käynnistystilan 117 kohdetestiä sekä runnerin/manifestin
17 testiä läpäisivät; rajattu SQL-katselmus ei löytänyt korjattavaa.
Tavallisen laskun hyväksynnän ja PDF:ttömän uudelleenhyväksynnän
revisiokirjoituksen 13 kohdetestiä läpäisivät. Hyvityksen lähderevisiosidonta
ja revisiokirjoitus läpäisivät 24 uutta sekä 23 aiempaa hyvitystestiä;
application-/HTTP-sopimusten 19 testiä läpäisivät erikseen. Täsmärevision
lukijan 97 kohdetestiä läpäisivät: vanha sisältö ja sen alkuperä säilyvät,
rikkinäistä sidosta ei korvata uusimmalla versiolla. Rajatut riippumattomat
tuotantokatselmukset eivät löytäneet korjattavaa. Hyväksynnän sisäinen
revisioavain ja HTTP-vastauksen kenttärajaus läpäisivät 132 kohdetestiä;
julkinen hyväksyntävastaus ei muutu. Revision PDF-sisältömuunnos ja nykyinen
renderer läpäisivät 39 kohdetestiä, yhdessä hyväksyntäavaimen kanssa
171/171. Ulkoasu ja laskentasäännöt säilyvät. Ehdollisen dokumenttimetadatan
julkaisun, dokumenttikohtaisen polkusäännön ja julkisen metadatavastauksen
84 kohdetestiä läpäisivät; rajatut katselmukset eivät löytäneet korjattavaa.
Omistetun tiedostokirjoituksen, rajatun PDF-tavujen tarkistuksen ja vain oman
julkaisemattoman ehdokkaan siivouksen 73 testiä läpäisivät; rajattu
tuotantokatselmus ei löytänyt korjattavaa. Generaattorin ja hyväksynnän
PDF-koukkujen täsmärevisiokytkentä sekä kirjoittamaton välimuistin
kelpoisuusluku on nyt kohdetodennettu: 206 yhdistettyä generointi-,
tietokanta-, tiedosto-, HTTP-, composition- ja diagnostiikkatestiä läpäisivät.
Rajattu riippumaton tuotantokatselmus ei löytänyt korjattavaa.
Nykyisen PDF:n GET-/metadataluku valitsee täsmädokumentin, varmentaa tavut
ja hylkää välissä vaihtuneen valinnan. Legacy-alkuperäinen säilyy luettavana
ilman revisioväitettä, mutta uuden revision puuttuva PDF ei käytä vanhaa
sisältöä varavaihtoehtona. Generoinnin ja lukemisen yhdistetty tarkistus
läpäisi 269 testiä; myös eheysvirheen todellinen diagnostiikan lukuketju
on kohdetodennettu. Myös tapahtumaan sidotun historian backend-luku on nyt
kytketty: tarkat PDF-tavut, `sendInvoices`-oikeus, yritysraja ja turvallinen
diagnostiikka säilyvät, eikä reopened-historia muuta lähetyskelpoisuutta.
Yhdistetty historian lukuketjun tarkistus läpäisi 359 testiä. B4:n atomisen
SMTP-varauksen ja täsmällisen loppukuittauksen SQLite-adapterit sekä
historian säilyttävä reopen/uudelleenhyväksynnän unresolved-esto ovat nyt
kohdetodennettuja. Laajennettu PDF-/revisio-/hyvitys-/varaus-/reopen-ajo
läpäisi 650 testiä. Sen jälkeen asiakas- ja itselle-SMTP:n prepare/send on
kytketty tarkistettuun täsmädokumenttiin, revision sisältävään valtuutukseen
ja pysyvään varaukseen ennen provideria. Onnistuneen lähetyksen jälkeinen
lukuhäiriö erotetaan lähetysvirheestä myös diagnostiikan lukuketjussa.
Myös manual-/dry-run-kirjoittajat ovat nyt revisiosidottuja. Kilpaileva
manual-pyyntö ei luo olematonta arkistotapahtumaa. Cancel-/SMTP-varausjärjestykset
ja päätöksen säilyminen tietokannan uudelleenavauksessa on kohdetodennettu.
Lopullinen laskutusmoduulin ja kolmen toimitus-/reopen-compositionin sarja
läpäisi 1 472 testiä 122 tiedostossa ja backendin tyypitys läpäisi.
Rajattu riippumaton katselmus ja sen testitäydennysten tarkistus valmistuivat
ilman korjattavia löydöksiä. Activity-lukuketjun rajattu todennus säilyttää
manuaalisen toimituksen turvallisen historian ja dry-runin poissulun.
Legacy-lähteen valinta ja tarkistettujen tavujen itsenäinen säilyttäminen on
lisätty työpuuhun. Julkaisu ja varaus tarkistavat saman historian kelpoisuuden;
epäselvä commit-tulos säilyttää tiedoston. Tämän jälkeinen laskutusmoduulin
ja viiden compositionin regressio läpäisi 1 525 testiä 126 tiedostossa ja
backendin tyypitys läpäisi. Rajattu riippumaton katselmus valmistui ilman
korjattavia löydöksiä.
Legacy-uudelleenlähetyksen vahvistus- ja lähetyskytkentä,
historian ja uuden virhepalautteen client/UI/native-ketju sekä
palautustodennus ovat kesken. [M1:n checkpoint](release-0.3.0-m1-preparation-plan.md#b3-b5-toteutusvalmistelu)
omistaa rajatun näytön ja puuttuvat portit.
Omistaja hyväksyi 6.10.2026 rajatun selvityseston vanhalle approved-laskulle,
jonka SMTP-historian tarkoitusta ei voida todentaa. Backendin esto ja
selkeä UI-virhepalaute on toteutettu; laskun ja historian luku säilyy.
Tunnetun R02-jälkitilan null-viitteiden säilyminen ja estot on todennettu
aidon 038 -> 039 -migraation läpi. Tämän jälkeinen backendin laskutus- ja
composition-sarja läpäisi 1 587 testiä 130 tiedostossa. Rajattu riippumaton
katselmus valmistui; siinä löytynyt kahden UI-toiminnon ennenaikainen
PDF-pyyntö korjattiin ja todennettiin. Laskutuksen web-sarja läpäisi
586 testiä 78 tiedostossa, ja backendin sekä webin tyypitys läpäisivät.
Legacy-lähetyksen, käyttöliittymän ja palautuksen
yhtenäinen sovitus on yhä kesken. Osittaista toteutusta ei julkaista käyttäjälle.
Säilytetyn legacy-PDF:n kirjoittamaton täsmäluku on tämän jälkeen lisätty:
valmistelun, esikatselun ja kertaluvan järjestys on täsmennetty
[omistavassa suunnitelmassa](release-0.3.0-m1-preparation-plan.md#säilytetyn-dokumentin-täsmäluku-ja-vahvistuksen-järjestys).
Sen jälkeen lomakkeen esivalmistelu sekä täsmäesikatselun HTTP-, client- ja
desktop-rajat on kohdetodennettu. Uusin laskutus-/composition-/HTTP-
lokitusregressio läpäisi 1 676 testiä 136 tiedostossa, API-client 191 testiä ja desktopin
kohdesarja 87 testiä. Lomakkeen täsmäesikatselu on nyt kytketty ja
vanhentuneen valmisteluvastauksen puute korjattu. Webin 885 testiä ja build
läpäisivät; rajattu selainnäyttö käyttää eksplisiittisiä preflight-/native-
testisovittimia. SMTP-prepare/sendin täsmäkohde ja pakollinen native-vahvistus
ovat tämän jälkeen työpuussa kohdetodennettuja: laskutus/composition
1 747, API-client 266, web-kohdesarja 50 ja desktop-kohdesarja 72 testiä
sekä koko työtilan tyypitys läpäisivät. Rajattu lähdekatselmus ei löytänyt
uusia korjattavia puutteita. Koko web-sarja läpäisi 900 testiä ja kaksi
normaalirevision Electron-vahvistuskoetta läpäisivät oikean main-/backend-
ketjun nykyisillä dialogi-/SMTP-testisovittimilla. Oikean legacy-/native-kokonaisketjun, historian
käyttöliittymän ja palautuksen hyväksyntä ovat edelleen avoinna.
Onnistuneen lähetyksen jälkilukuvirheen UI-palaute on tämän jälkeen
korjattu: kehotus uuteen valmisteluun korvautuu onnistumisen ja tarkistustarpeen
kertovalla viestillä ilman automaattista uudelleenlähetystä. Rajattu
selainkoe, backendin 17 composition-testiä, desktop-protokollan 21 testiä
ja koko webin 911 testiä läpäisivät; riippumaton kohdekatselmus valmistui.
Myös hyväksytyn laskun tapahtuma-PDF:n client/UI/native-polku on tämän jälkeen
[kohdetodennettu](release-0.3.0-m1-preparation-plan.md#b4-historian-käyttöpolun-checkpoint):
vanha toimitus säilyttää alkuperäiset tavut muokkauksen ja uudelleenhyväksynnän
jälkeen. Selain- ja development-Electron-kokeet sekä laskutuksen 1 795,
webin 939 ja desktopin 160 regressiota läpäisivät. Editorin jatkokytkentä
on tämän jälkeen todennettu backendin auktoritatiivisella lukusopimuksella,
39 rajatestillä sekä selain- ja development-Electron-polulla. Myös koko
webin 947 ja API-clientin 314 testiä läpäisivät. Myös
[legacy-native-uudelleenlähetys ja peruutus](release-0.3.0-m1-preparation-plan.md#b4-legacy-uudelleenlähetyksen-checkpoint)
on tämän jälkeen todennettu startup-migraation ja restartin yli.
[B5:n katalogi- ja palautuskytkentä](release-0.3.0-m1-preparation-plan.md#b5-katalogin-ja-palautuksen-checkpoint)
on toteutettu ja alemmilla testitasoilla todennettu. Hardened Windows
-kehityspaketin moniversioinen ja alkuperäisen 038-backupin palautus
läpäisivät. Legacy-testin CI-ajokytkentä ja salatun virheaineiston keräys
on kohdetodennettu. Katselmuksen current-PDF-esikatselun ja historian
turvallisen virhepalautteen puutteet on korjattu. Hyväksytyn legacy-laskun
ensimmäisen toimituksen revisiosiirtymä on kohdetodennettu, mukaan lukien
oikeusrajat ja suora itselle-testilähetys fake-providerilla. Loppukatselmuksen
legacy-arkistokopion täsmäsidonta on korjattu ja todennettu regressioilla
sekä viidellä development-Electron-kokeella. Riippumaton jatkokatselmus on
suljettu. Seuraavana ovat puhtaan revision paketointinäyttö ja PR/main. Koko testisarjan
erillinen workspace-adoption aikakatkaisu on edelleen avoin, ei korjatuksi
merkitty yhden kohdennetun uusinnan perusteella.
Nykyinen jatkamiskohta säilyy M1-suunnitelmassa.
Koko B:n hyväksyntä ja 0.3.0-julkaisu ovat edelleen avoinna.

Alla säilyy tähän johtanut integraatiohistoria; sen silloiset avoimet
main-portit eivät avaa hyväksyttyjä vaiheita uudelleen.

PR #283 on yhdistetty ja mainin omat
normaali CI sekä riippuvuustarkistus ovat hyväksyttyjä.
[M1:n jatkamiskohta](release-0.3.0-m1-preparation-plan.md#jatka-tästä)
sitoo hyväksynnän revisioon ja säilyttää vanhat timeout-/ETL-havainnot
avoimina. Ennen A1:tä hyväksytty rajattu
[pnpm-bootstrapin tietoturvahuolto](release-0.3.0-m1-preparation-plan.md#pnpm-bootstrapin-tietoturvahuolto):
pnpm `11.11.0`, bootstrapin oma haavoittuvuusportti ja Dependabot-seuranta
on todennettu. Samassa PR:ssä hyväksyttiin Windowsin ja Linuxin rajattu
salatun ensivirheaineiston toimitus. Keräys ei palauta vanhoista ajoista
puuttuvaa aineistoa eikä takaa kaikkien mahdollisten vikojen juurisyytä.
[Lopullinen checkpoint](https://github.com/eky-software/eky/pull/283#issuecomment-5959719891)
erottaa riippuvuusturvan, toimintatestien ja hälytysten readbackin näytön.
[A1/R01:n luonnoksen avaamisen kohdesuoja](invoicing-ui-roadmap.md#a1-avattavan-luonnoksen-kohde)
on hyväksytty PR #288:n mainissa. Sen jälkeinen
[MSI-virheaineiston toimituskorjaus](release-0.3.0-m1-preparation-plan.md#msi-politiikkakokeen-virheaineisto)
ja PR #290:n main-portit on hyväksytty. Alkuperäisen MSI-hylkäyksen
juurisyy sekä vanha rollback-testihavainto säilyvät avoimina omille
revisioilleen; niitä ei merkitä A1:n sovellusvioiksi tai myöhemmin korjatuiksi.
A2/R05 ja sen rajattu MSI-integraatiojatko ovat hyväksyttyjä jatkokehitykseen
PR #292:n mainissa tapauskohtaisella Electron-uusintapäätöksellä. Mainin
CI jäi punaiseksi flaky-tuloksen vuoksi; syytä ei ole todistettu korjatuksi.
[M1:n jatkamiskohta](release-0.3.0-m1-preparation-plan.md#jatka-tästä)
erottaa hyväksynnän ja avoimen havainnon. Omistajan hyväksymä
[Oma yritys -tallennuksen kahden vian korjaus](release-0.3.0-m1-preparation-plan.md#oma-yritys-rajattu-tallennuskorjaus)
vietiin tämän jälkeen omaan integraatioonsa.
Hyväksytty etenemisjärjestys on rajattu palautustestin siivouskorjaus,
Oma yritys -korjausten PR/main-hyväksyntä ja vasta sen jälkeen A3/R06.
Palautustestin siivous, erikseen hyväksytty rollback-testin jako ja
Oma yritys -korjaukset on katselmoitu ja hyväksytty PR #293:n mainissa
`b7194db56208c3526ed48b94083849a404f28ab8`. Sen omat 11 porttia ja
kaksi asennuskoetoistoa läpäisivät ilman uusintoja. Tämä ei sulje vanhojen
aikakatkaisujen juurisyitä. Myös
[A3/R06](invoicing-ui-roadmap.md#a3-hyväksyntävalmiuden-vastaussidonta) on
hyväksytty PR #294:n mainissa `082e187bb680b1c7a8dc5d0a5e967adf33403a7a`.
[Loppuhyväksyntä](https://github.com/eky-software/eky/pull/294#issuecomment-5980132408)
sulkee A-paketin kolme korjausta. Sitä seurasi
[B1/B2:n rajattu toteutus](release-0.3.0-m1-preparation-plan.md#b1b2-rajattu-toteutus)
B0:n hyväksyttyjen rajausten pohjalta.
B1/B2 on yhdistetty PR #295:ssä, mutta sen main-hyväksyntä jäi avoimeksi
Electronin loppusulun hylkäyksen vuoksi. Silloinen integraatiojatko oli
[hyväksytty rajattu sulkukorjaus](release-0.3.0-m1-preparation-plan.md#b1b2-mainin-electron-sulkuhavainto)
ja sen PR #296:n jälkeinen lifecycle-todisteen salatun keräyksen täydennys.
PR-portit läpäisivät, mutta uusi main-kierros hylättiin toisen testin
loppusulun aikakatkaisuun. Muuttumattomat PR/main-portit säilyvät;
keräysjatko ei avaa T3:a eikä nimeä CI-häiriötä korjatuksi.
B1/B2:n lopullinen hyväksyntä on PR #297:ssä. B3-B5:n toteutus,
D-paketin muut ehdot ja koko 0.3.0 ovat edelleen avoinna.

**M0, T1, T2, T3/R28 ja A1/A2/A3 on hyväksytty; M1:n muu työ on avoinna.**
Myös T-paketin jälkeinen integraatiojatko on hyväksytty PR #281:n mainissa.
[M1:n jatkamiskohta](release-0.3.0-m1-preparation-plan.md#jatka-tästä)
omistaa täsmällisen lähtörevision, sen omat portit ja avoimet
historialliset havainnot. Tämä sulkee T-paketin, ei M1:tä tai 0.3.0-julkaisua.

</details>

### PR #282:n valmisteluhistoria

Alla säilyvät vaiheittaiset päätökset ja silloiset avoimet portit.
PR #282:n lopullinen integraatiotila on yllä linkitetyssä M1-checkpointissa;
historia ei avaa vanhoja tutkimuksia tai hyväksyntäkierroksia uudelleen.

T3:n nykyohje, testinkirjoittajan pikaohje ja historian lukureitit on
selkeytetty rajattuna dokumentointityönä. Linkit, historian säilyminen ja
kolmen esimerkin tyypit on tarkistettu; sovellus- tai E2E-testejä ei ajettu
tämän työn perusteella. Testikoodia, aikarajoja, riippuvuuksia tai
CI-vaatimuksia ei muutettu dokumentointiosuudessa. Sen PR #282:n auditointi
löysi kuitenkin nykyisen `undici@7.29.0`-haavoittuvuuden: omistaja hyväksyi
rajatun `7.29.1`-korjauspäivityksen ennen mergeä. Erilliset upgrade/rollback-
tuloskirjoituksen ja workspace-asennusodotuksen CI-hylkäykset säilyvät
selvityskohteina. [M1:n jatkamiskohta](release-0.3.0-m1-preparation-plan.md#jatka-tästä)
erottaa nämä esteet A1:stä; riippuvuuden korjaus ei yksin hyväksy integraatiota.
Oma integraationäyttö kirjataan erikseen, eikä PR #281:n tulosta nimetä
tämän palan testitulokseksi.
Revision `9756e90e` erillinen CI-valmisteluhylkäys tapahtui Corepackin
pnpm-latauksessa ennen legacy/core-testejä. Omistaja hyväksyi saman pnpm:n
[varmennetun npm-valmistelun](dependency-policy.md#ci-paketinhallinnan-valmistelu)
ilman työkaluversioiden tai testiehtojen muutoksia. Valmistelukorjauksen ja
Undici-päivityksen revision `35ba04c0` PR-portit läpäisivät;
[M1:n jatkamiskohta](release-0.3.0-m1-preparation-plan.md#jatka-tästä)
sitoo näytön täsmälliseen revisioon. Ennen mergeä tehdään lisäksi omistajan
hyväksymä [Electron 43.7.6 -turvallisuuspäivitys](local-desktop-dependency-review.md#electron-4376--turvallisuuspäivitys)
nykyisine runtime-, tietokanta-, packaged- ja CI-portteineen. Sen todennus
on kesken, eikä aikaisempi vihreä ajo hyväksy uutta runtimea. Vanhojen
timeout-havaintojen syyepävarmuus säilyy.
Tavallinen workspace-sarja läpäisi rajattujen testiapurikorjausten jälkeen.
Puhtaalla revisiolla `1e91b328` täysi Electron-sarja 46/46, normaali
desktop-stress ja täysi 30 minuutin soak läpäisivät ilman vaatimusten
lievennystä. Aiemmat käynnistys-, luku- ja stress-hylkäykset säilyvät
erillisinä havaintoina; niiden kaikkia juurisyitä ei väitetä korjatuiksi.
Rajattu käynnistyskoodien diagnostiikkakorjaus on toteutettu ja katselmoitu:
89 sopimustestiä, tyypitys ja yksi normaalisti valmisteltu aktivointikoe
läpäisivät. Tämä ei osoita aiemman käynnistysvirheen syytä korjatuksi eikä
korvaa kokonaisen testisarjan hyväksyntää.
Omistajan hyväksymä rajattu jatko erottaa
[V1:n virhetietoketjun ja V2:n runtime-/integraatioportit](release-0.3.0-m1-preparation-plan.md#rajattu-ongelmalista).
V1:n oikeaprosessikoe säilytti tunnetun backend-syyn lopulliseen raporttiin
ja seuraavien ajojen yli; tavallinen käynnistyspolku läpäisi. V1:n
revisioon `8bcf1c74` suljettua ketjua täydensi revision `27a0b6c3`
katselmoitu loppuprojektion korjaus ja sen regressiot.
V2:n pakollisessa full auditissa löytyneen `brace-expansion`-riippuvuuden
rajattu `5.0.12`-päivitys hyväksyttiin erikseen. Puhtaan revision
`b5833b22` uusi tuotantopayload ja synteettinen hardened-palautus samalla
paketilla läpäisivät. Production/full audit, 160 rekisteriallekirjoitusta
ja 253 nykyistä paketointisopimusta läpäisivät. Lopullisen revision
omat PR/main-portit ovat seuraava työ, eivät vielä hyväksytty tulos.
Revision `416d06f3` ensimmäinen PR-ajo hylkäsi raportointiregression keräyksen
sekä legacy-päivityksen payload-tarkistuksen. Raportointitestin tarpeeton
build-riippuvuus on rajatusti korjattu ja alemmilla testeillä todennettu;
legacy-haaran samaversion tiedostojen korvauspuute on todennettu.
Omistaja hyväksyi rajatun `emus`-korjauksen ja sen Type 51 -toteutuksen;
regressiot sekä synteettisen MSI:n rakennus- ja metadatatodistus läpäisivät.
Revision `5a8dd5d6` oikean pakettiparin molemmat hiljaiset legacy-päivitykset
läpäisivät täydellisen sisältövertailun ja käynnistykset; rajattu CI oli
15/15 vihreä. Revision `0fa4c2f3` täydentävä synteettinen MSI-koe läpäisi
48/48 sopimustestiä ja todensi UI-oletuksen, eksplisiittisen ohituksen sekä
uudemman tiedostoversion suojan siivouksineen. Normaali PR/main-integraatio
ja riippuvuushälytysten oletushaaran tila ovat edelleen avoimia;
kohdennetut kokeet eivät korvaa näitä portteja.
Integraatiotarkistuksen pakettivälimuistin testiaikakatkaisu käsitellään
[rajatulla valmistelumuutoksella](release-0.3.0-m1-preparation-plan.md#pakettivälimuistin-testivalmistelun-rajaus)
säilyttäen molemmat keskeytyshaarat, täsmälliset sisältöehdot ja aikarajan.
[M1:n nykyinen checkpoint](release-0.3.0-m1-preparation-plan.md#v2n-nykyinen-hyväksyntächeckpoint)
omistaa tarkemman näytön ja V2:n sulkemisehdot.
Revision `fa343f19` normaali PR-kierros hylkäsi backup-fixturen
valmistelubackendin valmiusodotuksen ennen Electronin käynnistystä.
Ensivirheen ja siivouksen tiedot säilyivät; automaattisen toisen yrityksen
läpäisy ei hyväksy kierrosta. Hyväksytty [rajattu valmiuskyselyhavainto ja sen todennus](release-0.3.0-m1-preparation-plan.md#valmiuskyselyhavainnon-todennus)
on toteutettu. Revision `8913dc48` normaali PR-kierros läpäisi kaikki kolme
E2E-perhettä sekä installer-/legacy-ryhmät, mutta yksi packaged-workspace-
ajo saavutti jobin aikarajan ja koonti hylättiin. [M1:n riskiperusteinen jatko](release-0.3.0-m1-preparation-plan.md#riskiperusteinen-jatko-1102026)
omistaa nykyisen näytön ja seuraavan rajatun tutkimuksen. Hyväksytty
[ensivirheen, yhden uusinnan ja määräaikaisen kehityspoikkeuksen käytäntö](../ai/testing-rules.md#ensivirhe-uusinta-ja-rajattu-poikkeus)
ei muuta kriittisiä hyväksyntäportteja tai hyväksy tätä hylkäystä.
Nykyinen erikseen rajattu tehtävä kattaa vain tämän Windows-aikakatkaisun
näyttöön perustuvan korjauksen, kohdetestit, oikean paketin todennuksen ja
katselmuksen. [M1:n työn rajaus](release-0.3.0-m1-preparation-plan.md#nykyisen-työn-rajaus)
erottaa sen myöhemmästä PR/main-integraatiosta, mergestä ja A1:stä.
[Ainoa diagnostinen uusinta](release-0.3.0-m1-preparation-plan.md#rajatun-uusinnan-tulos)
läpäisi samalla lähteellä ja alkuperäisellä paketilla. Sen 21 komentovaihetta
ja pakollinen lopputulostarkistus valmistuivat, mutta alkuperäinen syy ja
korjaus eivät ole todennettuja. Uusintaraja on käytetty. [Hyväksytty rajattu katkaisukoe](release-0.3.0-m1-preparation-plan.md#katkaisukokeen-tulos)
säilytti komennon ja kesken jääneen vaiheen havainnot CI-komentoaskelen
katkaisun yli; koko analyysi jäi hylätyksi synteettisestä kokeesta puuttuvien
MSI-tapahtumien vuoksi. Omistaja hyväksyi tämän jälkeen yhden
[workspace-success-havaintokokeen](release-0.3.0-m1-preparation-plan.md#hyväksytty-workspace-success-havaintokoe)
alkuperäisellä paketilla ja nykyisen tallennuksen rajatulla kytkennällä.
[Kokeen tulos](release-0.3.0-m1-preparation-plan.md#workspace-success-havaintokokeen-tulos):
caller, pakollinen verifier ja kaikki 21 komentovaihetta läpäisivät, mutta
erillinen jäljen vientityökalu epäonnistui ennen lukijaa. Koko diagnoosi
on hylätty, alkuperäinen vika ei toistunut eikä syytä ole varmistettu.
Uutta ajoa ei käynnistetä automaattisesti. Tutkimustulos ei ole
PR/main-hyväksyntä eikä Goal ole tällä valmis.
[Tutkimuspaketin päätösraportti](release-0.3.0-m1-preparation-plan.md#tutkimuspaketin-päätösraportti)
vahvistaa, ettei saman ajon ETL:ää tai raakaa vientivirhettä ole saatavilla
tarkistetuista aineistolähteistä. Pienin jatkoehdotus on nykyinen no-MSI-
vientikoe vasta yksityisen luku- ja säilytysreitin ratkettua, ei uusi
asennuspäivitys tai automaattinen hyväksyntäkierros. Playwrightin
ensiyrityksen trace säilyy erillisenä rajattuna jatkoehdotuksena.
[Yksityisen vientiaineiston säilytysehdotus](release-0.3.0-m1-preparation-plan.md#yksityisen-vientiaineiston-säilytysehdotus)
rajaa työn yhteen no-MSI-kokeeseen, erilliseen yksityiseen säilytyspaikkaan
ja nimettyihin käyttöoikeus-/säilytysrajoihin. Omistaja hyväksyi repositoryn
perustamisen, rajatun raakasiirron ja kertakokeen. Yksi jäädytetyn lähteen
ajo [päättyi käynnistimen ennakkotarkistukseen](release-0.3.0-m1-preparation-plan.md#yksityisen-kertakokeen-valmisteluhylkäys)
ennen fixtureä ja tallennusta. Omistajan erikseen hyväksymä yksi korjattu
no-MSI-koe samalla lähteellä [läpäisi tallennuksen ja vientianalyysin](release-0.3.0-m1-preparation-plan.md#korjatun-yksityisen-kertakokeen-päätösraportti).
Käynnistimen tarkistukset läpäisivät 17/17; korjaus todennettiin myös
hosted-ajossa. Molemmat aineistoerät säilytettiin yksityisesti ja niiden
eheys varmennettiin. Kokonaissiivous säilyy varmentamattomana, eikä uusi
läpäisy ratkaise vanhaa vientivirhettä tai alkuperäistä timeoutia.
Käynnistin ja ajon salliva portti on suljettu. Vientitutkimus päättyy
päätösraporttiin ilman automaattista lisäajoa; normaalin hyväksynnän
avaamiseen tarvittava näyttö tai uusi valmistumisehdon päätös puuttui
tuolloin. Uudempi päätös on kirjattu alla.
Maksullista käyttöä ei sallita. Yksityisestä kokeesta ei tule tavallista
ajopaikkaa: EKY:n julkisuus ja normaalit CI-portit säilyvät.
Omistaja hyväksyi seuraavaksi [salatun tutkimusaineiston rajatun välitavoitteen](release-0.3.0-m1-preparation-plan.md#salatun-tutkimusaineiston-välitavoite):
nykyisen workspace-kuluttajan nimetty aineisto salataan GnuPG:llä ennen
julkista artifact-siirtoa. Purkuavain jää paikalliseksi, salattu liite
säilyy yhden vuorokauden ja käyttöönotto edellyttää avaimen purkutestiä.
Toteutus ei muuta normaaleja hyväksyntäehtoja tai sulje vanhoja havaintoja.
Paikallinen salausportti läpäisi, mutta ensimmäinen synteettinen hosted-
toimituskoe hylättiin ennen liitteen syntymistä. Toimituksen hyväksyntä
oli vielä avoin. Vaihe-erottelun ja turvallisen sisäisen virhekoodin välityksen
jälkeen kolmas koe hylättiin koodilla `EVIDENCE_GPG_UNAVAILABLE`.
Usean Git-osuman työkaluhakuvirhe toistettiin ja korjattiin; rajatut
regressiot läpäisivät 63/63. Omistajan hyväksymä korjatun revision
`f69f3d76` [kertakoe 36930438493](https://github.com/eky-software/eky/actions/runs/36930438493)
sekä yksityinen purku- ja sisältötarkistus läpäisivät. Rajattu salatun
toimituksen välitavoite on hyväksytty; keräyksen vahvistus on käytössä.
[M1:n hyväksyntä ja seuraava etenemispäätös](release-0.3.0-m1-preparation-plan.md#salatun-toimituksen-hyväksyntä)
erottavat toimituksen valmistumisen vanhasta timeoutista. Omistaja hyväksyi
2.10.2026 yhden jäädytetyn revision normaalin CI-kierroksen sekä rajatun
Goalin valmistumisehdon muutoksen: vanha timeout jää avoimeksi havainnoksi,
mutta sen jälkikäteinen juurisyy ei estä uuden revision hyväksyntää.
Kaikki nykyiset pakolliset tarkistukset säilyvät. Merge ja A1 eivät kuulu
tähän päätökseen; tulos hyväksytään vasta kierroksen todennuksen jälkeen.
Alkuperäisten timeoutien syitä ei väitetä ratkaistuiksi. Ei asennuskorjauksen
tai T3:n uutta toteutusta.
Seuraava tuotantopala on [A1/R01](invoicing-ui-roadmap.md#a1-avattavan-luonnoksen-kohde)
uuden preflightin ja omistavan aloitusportin kautta. Laaja ohjeverkon
tarkistus pysyy [M3:n I-paketissa](#m3-muut-invariantit-diagnostiikka-ja-ylläpidettävyys);
ei uutta rinnakkaista roadmapia tai arkkitehtuuriremonttia.

<details>
<summary>Aiemmat checkpointit ja M0:n tapahtumahistoria (ei nykyinen työjono)</summary>

### Integraatiota edeltävä checkpoint 2026-09-28

Seuraava tilannekuva ja aiemmat checkpointit säilyvät historiatietona.
Niiden nykytila-, seuraava työ- ja pending-ilmaukset koskevat omaa
checkpointiaan, eivät yllä hyväksyttyä integraatiota. Testimäärät ja
hylkäysten syyepävarmuudet pysyvät sidottuina alkuperäisiin näyttöihin.

**Nykytila 2026-09-28: M0, T1 ja T2 hyväksytty; T3/R28 kesken.**
**Viimeisin täysi normaali baseline on `5bbfd4834707b77e1211851a6fb21b09b8572a66`.**
Sen [normaali CI](https://github.com/eky-software/eky/actions/runs/36443256758)
ja [riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/36443266084)
läpäisivät ensimmäisellä yrityksellä. Normaali CI: 38 onnistunutta ryhmää ja
yksi tarkoituksellinen valinnainen ohitus, kaikki neljä kokeellista valitsinta
pois. System 689/690 ja yksi tunnettu alustasuoja, web 37/37 ja Electron 38/38;
ei retryä tai flakyä. Koko tapausjoukko, kaikki 38 checkoutia sekä neljän
tuottajan ja kymmenen kuluttajan artifact-sidonnat on takaisinluettu.
Tämä avaa seuraavan rajatun Linux-kuluttajatyön, ei sulje T3:a tai PR/main-portteja.
Uudemman revision `7f8df53a16770b5e3206c179ff8f497b76c6cf24`
[rajattu Linux-CI](https://github.com/eky-software/eky/actions/runs/36456205257)
läpäisi ensimmäisellä yrityksellä: system 698/699 ja yksi tunnettu
alustasuoja, web 37/37, kaikki seitsemän
[todellisen kuluttajan katkeamiskoetta](e2e-test-environment-history.md#linuxin-todellisten-kuluttajien-katkeamiskokeet)
sekä erillinen endurance 1/1. Lähde, tapausjoukot ja siivoustodisteet on
takaisinluettu; retryä tai flakyä ei ollut. Tämä ei ole uuden revision
täysi normaali CI. Vastaavan näytön kattamat vanhat aktiiviset Electron-
testien varapolut ja kaksi korvattua siivousapuria on nyt poistettu.
Poiston kohdesarja 151/151, puhtaat Electron-sopimukset 10/10, koko
workspacen tyypitys ja CI-sopimukset 318/318 läpäisivät; poistolla on
riippumaton hyväksyvä katselmus. Poiston jälkeinen tavallinen Windows-sarja
läpäisi 781/781 ensimmäisellä yrityksellä (system 693, web 43, Electron 45),
ilman ohituksia, retryä tai flakyä. Koko workspacen testit läpäisivät
peräkkäin; aiempi rinnakkaisajon timeout säilyy ratkaisemattomana havaintona.
Pysyvän matriisin kaksi täsmennystä on todennettu: juuren poistumisen jälkeen
haarautuva jälkeläinen sekä native-resumen virheestä saman omistajan
siivoukseen kulkeva ketju. Jälkimmäinen sisältyy nyt tavalliseen valmisteluun;
sen pipe-kytkentä ja suljettu raportti läpäisivät 31/31 sopimustestiä ja
riippumattoman katselmuksen. Tuotanto ja aikarajat säilyvät.
Seuraavana ovat täsmällisen PR/main-revision omat tarkistukset.
[Ajantasainen jatkamiskohta](release-0.3.0-m1-preparation-plan.md#jatka-tästä)
omistaa seuraavan työvaiheen; aiempi vihreä ajo ei hyväksy uutta lähdetilaa.

### Aiemmat checkpointit

Alla säilyvät aiempien korjausten ja hylkäysten omat checkpointit.
Windows-Electronin nykyisen kadenssin stress ja täysi 30 minuutin soak
sekä alkuperäisen virheen säilymisen kaksi rajattua todellisen fixturen
koetta on nyt paikallisesti todennettu. Omistaja hyväksyi 28.9. yhteisen
Chromium-selaimen testikohtaisella eristyksellä sekä paikalliset Windows-testit
ja Linux-CI:n. Näiden kuluttajasiirrot ovat käynnissä: worker-Chromiumin
tavallinen Windows-web-sarja läpäisi uusimmalla yhteisellä toteutuksella
43/43, system-sarja 689/689 ja kanoninen stress-portti. Yhteyden/siivouksen
kohdesarja 50/50, oikeat Windowsin owner-/caller-loss-kokeet sekä uusittu
artifact-/retry-koe on myös todennettu. Yhteinen Linux-kytkentä on toteutettu
ja työkalusarja 734/734 läpäisty. Revision `6e670190` ensimmäinen
[normaali CI](https://github.com/eky-software/eky/actions/runs/36419875442)
hylkäsi kuitenkin Linuxin oikeat system/web-kuluttajat sekä tukipaketin
kokorajatestin aikakatkaisun. Riippuvuustarkistus läpäisi; tämä ei hyväksy
muuta ajoa. Ensimmäiset virhetiedot säilyvät; baselinen korjaus oli ehto
seuraavalle toiminnalliselle vaiheelle. [Rajaus ja avoin näyttö](e2e-test-environment-history.md#chromiumin-ja-linuxin-ensimmäinen-yhteinen-ci)
erottavat nämä toisistaan. Tämä rajattu näyttö ei sulje T3:a.
Seuraavan diagnostiikkarevision `5c8bb24a`
[CI:ssä](https://github.com/eky-software/eky/actions/runs/36423687950)
workspace-portti läpäisi, mutta Linuxin samat system/web-hylkäykset säilyivät.
Palvelun käynnistysvaiheen virherivi ei syntynyt; tämä ei todista onnistunutta
backendin health-vaihetta. Tätä seurannut korjaus kohdistui Linux-testibackendin
puuttuvaan alkuperäisen OS-temp-juuren ankkuriin. Oikean config-readerin
regressio sekä suljettu backend-/Chromium-vaiheiden raportointiketju
todentavat rajauksen; korjatun revision tavallinen Linux-CI oli tuolloin avoin.
Korjauksen Windows-system 690/690, web 43/43, työkalusarja 740/740 ja
tyypitys läpäisivät. Kaikki pakettitestit läpäisivät paikallisesti peräkkäin;
[säilyvä rinnakkaisajon aikakatkaisuhavainto](e2e-test-environment-history.md#chromiumin-ja-linuxin-ensimmäinen-yhteinen-ci)
ei muuta CI:n ajotapaa tai aikarajoja eikä ole merkitty korjatuksi.
Revision `201600aa` [CI](https://github.com/eky-software/eky/actions/runs/36431463750)
todensi backendin health-vaiheen: Linux-systemissä läpäisi 688/690,
yksi Vite-composition-testi hylättiin ja yksi tunnettu alustasuoja ohitettiin.
Webin 36 hylkäystä ja yksi sarjan keskeytysohitus säilyivät. Koko ajo päättyi
hylättynä: 35 ryhmää läpäisi, kolme hylättiin ja yksi valinnainen koe ohitettiin;
[riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/36431475154)
läpäisi. Viten kiinteästä testiympäristöstä löytyi sama puuttuva temp-ankkuri.
Rajattu jatkokorjaus käyttää backendin ja Viten yhteistä validoitua asetusta:
RED/GREEN-sopimus, oikean Vite-readerin 13 turvarajatestiä, työkalusarja
740/740, tyypitys ja Windows-system 690/690 läpäisivät; katselmus hyväksytty.
Vite-korjauksen `c2bae3a2` [oma CI](https://github.com/eky-software/eky/actions/runs/36435533813)
läpäisi Linux-systemin 689/690 (yksi tunnettu alustasuoja) ja webin 37/37
ilman retryä tai flakyä. Koko tapausjoukko vastaa puhtaan revision katalogia;
Chromium-workerin siivous ja juuren poisto varmistuivat.
[Riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/36434517009)
läpäisi 160 varmennetulla allekirjoituksella. **Koko CI päättyi hylättynä:
36 ryhmää läpäisi, kaksi hylättiin ja yksi valinnainen koe ohitettiin.**
Workspace-faultin toinen ajo ylitti nykyisen aikarajansa `targetInstall`-
vaiheessa; palautumiskoe ei ehtinyt alkaa. Supervisor varmisti prosessipuun
siivouksen. Tämä ei osoita odotuksen juurisyytä. Rajatut
[asennusodotuksen alavaihehavainnot](windows-installer-acceptance-harness-v2.md#workspace-asennusodotuksen-havaintoraja)
ja niiden sopimustestit on toteutettu; niiden oma seurattu CI hyväksyttiin
yllä mainitulla `5bbfd483`-revisiolla. c2-timeoutin juurisyy jää avoimeksi.
[Tarkka tila](e2e-test-environment-history.md#chromiumin-ja-linuxin-ensimmäinen-yhteinen-ci)
erottaa hyväksytyn baselinen historiallisista hylkäyksistä; T3 pysyy avoinna.
Tuotanto, Chromiumin asetukset, sovelluksen E2E-tapausjoukot ja aikarajat säilyvät.
[Aiemmat hylkäykset ja korjauksen rajaus](e2e-test-environment-history.md#windows-electron--valmistelun-ci-hylkäys)
säilyvät historiatietona; läpäisy ei ratkaise aiemman satunnaisen
poistumisen syytä eikä hyväksy koko T3:a tai PR/main-integraatiota.
Stress-portin ensimmäinen yritys hylättiin testin vanhentuneen
työtilamittauksen vuoksi. [Rajattu korjaus ja loppunäyttö](e2e-test-environment-history.md#windows-electronin-endurance-ja-virheen-säilymisen-loppunäyttö)
erottavat säilyvän hylkäyksen korjatun polun läpäisseistä ajoista.
Mittauskorjauksen oma CI-portti on nyt hyväksytty: 38 onnistunutta ryhmää
ja yksi tarkoituksellinen valinnaisen kokeen ohitus. System 637 valittua
(636 läpäisyä ja yksi tunnettu alustakohtainen ohitus), web 35/35 ja
Electron 38/38 ilman retryä tai flaky-tulosta. **Electronin rajattu
kuluttajaosuus on valmis; koko T3 ja PR/main-integraatio eivät ole.**
Lähtörevision vihreä CI ei hyväksy myöhempää koodimuutosta.
Jatkamisen lähtörevisio, avoin puute, seuraava työ ja valmistumiskriteeri
ovat [M1:n ajantasaisessa aloituskohdassa](release-0.3.0-m1-preparation-plan.md#jatka-tästä).
Nykyinen eteneminen on **T3:n oikeat kuluttajat ja korvatun toteutuksen
poisto -> M1:n rajatut sovelluskorjaukset -> integraatio ja 0.3.0**.
Uutta testialustan tai sovellusarkkitehtuurin rinnakkaista uudistusta ei aloiteta.
T3 ei valmistu pelkillä kokeilla tai diagnostiikalla. Uusi moduulitesti käyttää
yhteistä fixtureä, ei rakenna omaa prosessienhallintaa.

**Uusin päätös 2026-09-28:** [Chromiumin worker-omistajuus ja testikohtainen
eristys sekä Windows-paikallinen/Linux-CI-rajaus](e2e-test-environment-history.md#chromiumin-kuluttajasiirron-avoin-omistajuusraja)
on hyväksytty. Toteutus käyttää nykyisiä omistajuusmekanismeja ja aikarajoja.
Paikallista Linux/WSL-E2E-tukea tai hostin oikeuksien muutoksia ei tarvita.
Koko T3:n valmistumiskriteerit ja täsmällisen revision portit säilyvät.

**Edeltävä valtuus 2026-09-27:** koko nykyisen T3/R28:n toteutus, testit ja
normaali PR/main-integraatio saavat jatkua hyväksytyssä rajauksessa ilman
toistuvia välilupia. Nimenomainen päätös kattaa myös `playwright-core@1.62.1`-
patchin lapsittoman Windows-bridgen rajatun lopetuslisäyksen ja testit;
lisäpatch ja E2E-only-ikkunapidätys on nyt toteutettu, katselmoitu ja
paikallisesti todennettu. Goal-työkalun aktiivinen tila on varmennettu
takaisinluvulla; aiempi `blocked`-kirjaus on historiallinen, ei nykyinen
etenemiseste. Aktiivinen Goal ei tarkoita valmista T3:a.

**Aiempi paikallinen fixture-hyväksyntä:** Windows-Electronin tavallinen
pääfixture on kytketty bridge-/native-omistajaan. Samaan lähdetilaan sidotut
E2E-tyyppitarkistus, kohdesopimukset 186/186 ja kanonisen valmistelun jälkeinen
tavallinen `electron-development` 45/45 läpäisivät ensimmäisellä yrityksellä.
Riippumaton takaisinluku vahvisti lähdesidonnan ja koko tavallisen tapausjoukon.
Myös erilliset restart/relaunch-, toinen instanssi-, owner-loss- ja caller-loss-
kokeet on hyväksytty; aiemmat hylätyt yritykset säilyvät hylättyinä.
Aiemmat patchin, neljän käynnistys-/ikkunakokeen, workspacen ja riippuvuus-
sekä pakettisisältöporttien tulokset pysyvät omina lähdesidottuina näyttöinään.
Tarkka rajaus ja säilyvät hylkäykset ovat
[omistavassa checkpointissa](e2e-test-environment-history.md#electron-bridgen-lopetuspolun-jatkoehdotus).
Tämä hyväksyy pääfixturen normaalin paikallisen kuluttajakytkennän, ei sen
koko virhematriisia, endurancea, koko T3:a tai uuden revision etä-CI-/PR/main-portteja.

Lisäksi todellisen fixturen julkisen sulkemisen ja portin vapautumisen
epävarmuuskokeet läpäisivät: molemmat restart-yritykset estyvät pysyvästi
ja testijuuri säilyy. Handoff-testin rajattu virhesiivous ja sen 24/24-
kohdesarja on katselmoitu ja todennettu. Tarkat hyväksyntärajat ja
koeapurin säilyvät hylkäykset ovat yllä linkitetyssä omistavassa checkpointissa.
Korvattu Windowsin taskkill-varapolku on poistettu. Poiston jälkeinen
tyyppitarkistus ja kanoninen järjestelmätestisarja 607/607 valmisteluineen
läpäisivät ensimmäisellä yrityksellä. Linuxin nykyistä haaraa ei muutettu.
Saman välipaketin koko workspace-testit ja tyyppitarkistus sekä CI-sopimukset
315/315 läpäisivät. Näiden jälkeinen normaali etä-CI hylkäsi yllä kuvatun
Electron-valmistelun; paikallinen näyttö ei korvannut sitä. Yllä mainittu
`5f61f186` on korjauspaketin myöhempi, erikseen varmennettu vihreä baseline.
Chromiumin ja Linuxin myöhemmät hyväksytyt kuluttajasiirrot eivät sisälly
tähän aiempaan näyttöön.

Tässä checkpointissa jäljellä oleva työ oli [M1:n lyhyessä sulkulistassa](release-0.3.0-m1-history.md#t3n-nykyinen-työjärjestys):
korvattujen aktiivisten polkujen poisto ja poiston regressiot, koko nykyisen
T3-matriisin näytön yhteenveto sekä täsmälliset PR/main-portit. Chromiumin
worker-/testikohtainen eristys ja Linuxin oikeat kuluttajat on nyt todennettu
yllä rajatuilla ajoilla. Paikallisen Linux-testauksen ympäristöpäätös on ratkaistu.
Hyväksyntä ei tarkoita uutta riippuvuutta, laajempia oikeuksia tai
heikennettyjä vaatimuksia. Seuraava vaihe on hyväksytty toteutus, ei uusi
rinnakkainen arkkitehtuurisuunnitelma.

### Aiemmat checkpointit ja päätösnäyttö

Alla on etenemishistoria; nykyinen seuraava työ luetaan yllä olevasta
M1-aloituskohdasta. Vanhat hyväksynnät eivät hyväksy myöhempää revisiota.

T3b-L:n probe on todennettu ja T3b-E:n Playwright-korjauksen paikalliset
regressiot sekä rajattu Windows-CI ovat läpäisseet. Aiempi kokonaisajo
hylättiin historiallisen 0.2.6-lähtöversion packaged smoke -vaiheessa;
seuraavassa normaalissa ajossa havaittiin erillinen
[rollback-prosessisopimuksen hylkäys](e2e-test-environment-history.md#t3b-en-normaalin-baselinen-rollback-sopimushylkäys).
Edellinen diagnostiikkarevision ajo todensi rollback-sopimukset, mutta
[kaksi Electronin firstWindow-ensiyritystä hylättiin](e2e-test-environment-history.md#t3b-en-toistunut-firstwindow-hylkäys-ja-backendstart-rajaus).
Niiden uusi näyttö rajaa odotuksen testibackendin `backendStart`-vaiheeseen;
juurisyy ei vielä ole todistettu.
Uusi [täsmällisen revision normaali baseline](e2e-test-environment-history.md#t3b-en-vihreä-normaali-baseline)
läpäisi kokonaisuudessaan. T3b-P:n hyväksytyn paketointikorjauksen rajattu
toteutus, regressiot ja katselmus sekä tuore eristetty build ja samoihin
tavuihin sidottu packaged smoke ovat valmistuneet. Uuden revision normaalissa
CI:ssä tuli erillinen [komentoharnessin sopimushylkäys](e2e-test-environment-history.md#t3b-pn-ci-sopimushylkäys-ja-havaintokytkentä);
havaintokytkentä on korjattu, katselmoitu ja paikallisesti todennettu.
Korjatun revision `a1df082c` normaali CI ja riippuvuustarkistus läpäisivät
ensimmäisellä yrityksellä; tarkat checkoutit ja artifact-sidonnat on
varmistettu. Keskeytymisen juurisyy säilyy avoimena. Omistaja hyväksyi
2026-09-26 T3c-W:n ja T3c-L:n rajatut kokeet. Windowsin
[neljä tapausta läpäisivät](e2e-test-environment-history.md#t3c-wn-rajatun-kokeen-checkpoint);
Linuxin ensimmäisen CI-ajon molemmat kokeet
[hylättiin ennen GO:ta](e2e-test-environment-history.md#t3c-ln-ensimmäisen-ci-kokeen-hylkäys).
Käynnistysvirheen tarkka syy ja uuden revision hyväksyntä ovat avoinna.
Omistajan hyväksymä [T3c-LD](e2e-test-environment-history.md#t3c-ldn-rajatun-ci-kokeen-havainto)
rajasi molemmat uudet hylkäykset ennen READYä tapahtuvaan wrapper exit 1:een;
init-merkki puuttui ja stderr jäi tuntemattomaan luokkaan. Koko ajo päättyi
hylätyksi, vaikka muut testiryhmät ja riippuvuustarkistus läpäisivät.
Juurisyy on avoin; [T3c-LS](e2e-test-environment-history.md#t3c-ls-suljetun-stderr-luokan-tarkennuksen-päätösehdotus)
on hyväksytty rajattu lisähavainto, jonka toteutus, testit ja riippumaton
katselmus läpäisivät. [Uuden CI-kierroksen molemmat Linux-tulokset](e2e-test-environment-history.md#t3c-lsn-rajatun-ci-kokeen-havainto)
paikantavat virheen `uid_map`-kirjoitusestoon ennen READYä/GO:ta. Estävä
taustapolitiikka on avoin. Kokonaisajo päättyi hylätyksi vain kahden
Linux-kokeen ja aggregaatin vuoksi; muut testiryhmät ja riippuvuustarkistus
läpäisivät. Omistaja hyväksyi seuraavaksi [rajatun CI-session hallinnan](e2e-test-environment-history.md#t3c-lm-rajattu-ci-testisession-hallinta)
suunnittelun ja toteutuksen Goalin sisällä. Puhtaat oikeus-/unit-sopimukset
ja injektoitu kontrolli-/init-kytkentä on katselmoitu ja testattu;
managerin suoritin, kokonaisajuri ja oikeaprosessinäyttö puuttuvat vielä;
ei vanhan kokeen automaattista uusintaa. Fixture-siirto odottaa mekanismin
ja koko vaaditun matriisin näyttöä; tämä ei ole koko T3:n tai
PR/main-integraation hyväksyntä. Ajurin root-first-odotusjärjestysvirhe on
korjattu ja todennettu, mutta perityn tulostekahvan kirjoittajaidentiteettiä
tai T3c-W:n ensimmäisen ennen launchia tapahtuneen hylkäyksen syytä ei
väitetä ratkaistuksi.
Vihreys ei todista aiempien satunnaisten virheiden juurisyitä.
[Ajantasainen työjärjestys](release-0.3.0-m1-history.md#t3n-nykyinen-työjärjestys)
erottaa virheen rajauksen, paketoinnin ja varsinaisen omistajuusratkaisun.
Omistaja hyväksyi T3b-L:n toteutuksen ja yhden seuratun CI-ajon; T3:n loppu
etenee Goalina [nimetyt päätösportit säilyttäen](e2e-test-environment-history.md#t3b-ln-toteutusvaltuus).
Viimeisin varmennettu paikallinen ja etäinen
`main` on T2:n normaali PR #277 -merge
`5cc58b7139a6616bc9403a5724f93d929e90cf25`. Tämän revision
[V2-ajo](https://github.com/eky-software/eky/actions/runs/36094675603) ja
[riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/36094675166)
läpäisivät. Tarkka näyttö on
[PR #277:n integraatiocheckpointissa](https://github.com/eky-software/eky/pull/277#issuecomment-5826768078).

M0:n aiempi hyväksytty lähtörevisio on
`38082dffe1772f099c4b9bb7495bed6c6b9b067b`. Tämän täsmällisen revision
[V2-ajo](https://github.com/eky-software/eky/actions/runs/36039663203) ja
[riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/36039734305)
ovat valmistuneet onnistuneesti. Integraation näyttö on
[PR #275:n integraatiocheckpointissa](https://github.com/eky-software/eky/pull/275#issuecomment-5819025563).
M0 ei sulje T-pakettia eikä todista historiallisen timeoutin tarkkaa syytä.

Omistajan hyväksymä valmistelu-Goal rajattiin **M1-suunnitteluun**, ei koko
0.3.0-toteutukseen. Sen työjärjestys, ensimmäisen toteutuspalan rajaus ja
avoimet päätökset ovat [M1-valmistelusuunnitelmassa](release-0.3.0-m1-preparation-plan.md).
Tuotantokoodia, riippuvuuksia, versiota tai CI-ehtoja ei muutettu.
Omistaja hyväksyi seuraavaksi T1a/T1b:n rajatun toteutus-Goalin: olemassa
olevat testit nykyisiin komentoihin ja ajokytkennän regressiosuoja.
T1 on toteutettu, katselmoitu ja hyväksytty myös PR/main-porttien jälkeen.
Testinäyttö ja integraation viite ovat
[T1-checkpointissa](release-0.3.0-m1-history.md#t1n-toteutus-ja-hyväksyntänäyttö).
Seuraavan suunnittelu-Goalin tarkka
[T2-rajaus](release-0.3.0-m1-history.md#t2n-toteutukseen-siirtymisen-portti)
on toteutettu ja paikallisesti todennettu
[T2-checkpointin](release-0.3.0-m1-history.md#t2n-toteutus-ja-paikallinen-näyttö)
mukaan. Myös [Linux-CI ja integraatio](release-0.3.0-m1-history.md#t2n-integraatiohyväksyntä)
on hyväksytty. Omistajan hyväksymä T3a-koe on suoritettu;
[tulos ja jatkopäätös](e2e-test-environment-history.md#t3an-tulos-ja-jatkopäätös)
erottavat osittaisen kokeen omistajuusmekanismin hyväksynnästä ja kuluttajien siirrosta.
[T3b-valmistelu](e2e-test-environment-history.md#t3b-virhehaaran-ja-alustarajan-valmistelu)
nimeää lukitun Playwrightin virheenkäsittelyaukon sekä erikseen hyväksyttävän
Linux-CI:n read-only-proben. Hyväksytty probe ja CI-kytkentä on nyt toteutettu,
ja [paikallinen sopimussarja läpäisi 95/95](e2e-test-environment-history.md#t3b-ln-toteutuscheckpoint).
Todellinen Linux-CI-havainto saatiin molemmista kuluttajista kielteisin
pääsyvihjein. [Ensimmäinen CI-checkpoint](e2e-test-environment-history.md#t3b-ln-ensimmäinen-ci-havainto-ja-sopimuskorjaus)
kirjaa T1-kytkentähylkäyksen sekä korjatun revision oman läpäisseen
CI-ajon. Playwright-korjauksen
[paikalliset regressiot ja nykyiset kaksi Electron-koetta läpäisivät](e2e-test-environment-history.md#t3b-en-paikallinen-korjausnäyttö);
sen normaali CI-baseline on sittemmin läpäissyt yllä linkitetyllä revisiolla,
mutta T3:n toimitus- ja PR/main-portit ovat vielä avoinna.
[Ensimmäinen CI-hylkäys](e2e-test-environment-history.md#t3b-en-ensimmäinen-ci-havainto)
rajautui Electron-fixturen käynnistykseen. Hyväksytty testidiagnostiikan
täydennys ja [yksi rajattu Windows-CI-ajo](e2e-test-environment-history.md#t3b-en-rajattu-windows-ci-todennus)
läpäisivät; alkuperäinen timeout ei toistunut eikä sen syytä merkitty
korjatuksi. Tämä ei korvaa koko V2-hyväksyntää.
[Seuraava kokonaisajo](e2e-test-environment-history.md#t3b-en-kokonaisajon-legacy-hylkäys)
valmistui hylättynä: ensimmäinen legacy-consumer epäonnistui, toinen läpäisi.
Tämä on eri havainto kuin aikaisempi development-fixturen firstWindow-timeout.
Payloadin [metatietorajauksen erillinen paketointipäätös](e2e-test-environment-history.md#t3b-p-hyväksytty-metatietorajaus)
on hyväksytty ja sen paikallinen toteutus-, katselmus- ja packaged-näyttö
on todennettu läpäisseen lähtötilan jälkeen. Korjattu T3b-P:n CI-lähtötila
läpäisi yllä kuvatusti; uuden T3c-revision CI on vielä avoinna.
Alustojen omistajuusmekanismi ja tavallisten fixturejen siirto ovat avoimia.
T2 ei sulje M1:n muita testikorjauksia.

### M0:n historiallinen tapahtumaketju

Seuraavat välitilat säilyvät historiatietona. Niiden merge-/M1-estot eivät
kumoa yllä varmennettua nykyistä hyväksyntää.

PR #274 yhdistettiin normaalisti mainiin revisiona
`4c18821e1d22e48608b082fc1fa6c54b8ac04a32`, kun täsmällisen PR-pään
`7d6d0f682c3ba374bd70eca387a9ad7f609a54ee` molemmat required checkit
läpäisivät. Mainin oma kokonaisajo hylättiin Electronin ensimmäisen
käynnistyksen testin flaken vuoksi. M0:aa ei merkitä valmiiksi eikä M1:n
tuotantototeutusta aloiteta. Tarkat hyväksyntäviitteet ja uusi päätösraja
ovat [harnessin jälkitodennuscheckpointissa](windows-installer-acceptance-harness-v2.md#m0-mainin-jälkitodennus).
Seuraava rajattu [M0.3-diagnostiikkaehdotus](windows-installer-acceptance-harness-v2.md#m03-ehdotus-electron-testin-vaihekohtainen-näyttö)
on omistajan hyväksymä, toteutettu ja kohdetodennettu. Myös revision
`a293a9b0411ce10e6b04b381a8aadb78ddc03d78` normaali PR #275 -todennus
läpäisi. Timeoutin juurisyytä ei ole vielä todistettu. Omistaja päätti
tämän jälkeen nimenomaisesti selvittää syyn ennen mergeä: PR #275 jätettiin
luonnokseksi eikä sen vihreä ajo hyväksynyt M0:aa. Tarkka näyttö ja rajatun
jatkotutkimuksen checkpoint ovat samassa harness-suunnitelmassa.
Tutkimus jatkui [M0.4:n rajatulla lataus-/virhedialogikokeella](windows-installer-acceptance-harness-v2.md#m04-ehdotus-lataus--ja-virhedialogiketjun-rajattu-koe).
Omistajan 2026-09-24 hyväksymä M0.4-harness on toteutettu ja katselmoitu.
Kohdesopimukset läpäisivät 33/33 ja yksi tavallinen Windows-koe läpäisi.
Yksi erillinen pakotettu koe hylättiin; sitä ei uusittu tai muutettu
jälkikäteen läpäistyksi. Sen havaintosopimuksessa tunnistettiin liian tiukka
Electron-tapahtuman vaatimus. Omistaja hyväksyi
[M0.5:n rajatun havaintosopimuksen korjauksen](windows-installer-acceptance-harness-v2.md#m05-pakotetun-kokeen-havaintosopimuksen-täsmennys),
sopimustestit, riippumattoman katselmuksen ja yhden uuden pakotetun
Windows-kokeen. M0.5 on toteutettu: sopimukset 35/35, käännös ja
tyypintarkistus sekä katselmuksen jälkeinen yksi pakotettu koe läpäisivät.
Tavallisen testin ehtoja ei muutettu eikä M0.4:n hylättyä tulosta korvattu.
Seuraava [M0.6-ehdotus](windows-installer-acceptance-harness-v2.md#m06-ehdotus-testin-latauksen-ja-purun-omistajuus)
rajaa testin oman lataus-/purkujärjestyksen korjauksen, ei tuotantokorjausta.
Omistajan uusi 2026-09-24 jatkovaltuus sallii toteutuksen, katselmukset ja
normaalin PR/main-integraation ilman välivaiheiden lupakysymyksiä, mutta ei
hyväksyntäporttien lieventämistä. M0.6:n katselmus, 48 kohdesopimusta,
koko työtilan testit ja typecheck, desktopin E2E-käännös, 55 CI-sopimusta
sekä yksi tavallinen Windows-first-start-koe läpäisivät. Jokaisen neljän
compositionin lataus valmistui ennen shutdownia ja protokollapurkua;
cleanup todennettiin. Historiallisen timeoutin syyepävarmuus säilyy.
Integraation lopputulos tarkistetaan yllä linkitetystä checkpointista.

Projektin omistaja päätti 2026-09-22, että aiemmin työnimellä `0.2.9`
koottu kokonaisuus valmistellaan seuraavaksi versioksi `0.3.0`.
Yrityksen poistaminen ja odotustilojen latausilmaisin kuuluvat julkaisuun.
Nykyinen käyttäjätestaus viimeistellään ennen tämän kokonaisuuden toteutusta.

Omistajan seuraava päätös täydentää etenemisjärjestystä: nykyinen
`codex/release-0.2.81-hotfix` yhdistetään ensin `main`-haaraan normaalien
hyväksyntäporttien kautta. Vasta puhtaalta, tarkistetulta integraatiopohjalta
aloitetaan tämän suunnitelman tuotantokorjaukset. Tämä dokumenttipäivitys
ei suorita mergeä eikä muuta sovelluksen versiota.

Tämä on yhteinen tehtävälista, ei toteutus- tai julkaisutodiste. Alla olevat
sovellusmuutokset ovat tekemättä. Version tavoite ei muuta vielä
`package.json`- tai installer-versiota, rakenna pakettia tai hyväksy uusia
riippuvuuksia, tietomalleja tai turvallisuussopimuksia. Tarkat toteutukset
rajataan ja hyväksytään omistavissa suunnitelmissa ennen koodausta.

Julkaisuun sovittua kohtaa ei siirretä pois hiljaisesti. Jos se ei valmistu
turvallisesti, omistaja päättää julkaisun lykkäämisestä tai rajauksen
muuttamisesta. Sitä ei merkitä valmiiksi pelkän suunnitelman perusteella.

</details>

## Julkaisuun sovitut tehtävät

| Tunnus | Tehtävä ja tavoite | Tila |
| --- | --- | --- |
| R030-01 | Yhtenäinen latausikoni tai odotusilmaisin näkyviin käyttäjälle havaittaviin odotustiloihin eri toiminnoissa. | Suunniteltu; käyttökohteiden kartoitus tekemättä. |
| R030-02 / W7 | Yritystyötilan turvallinen poistaminen käyttöliittymästä. | Mukaan sovittu; valmistelu ja päätösjono kirjattu. Sopimusten hyväksyntä ja toteutus avoinna. |
| R030-03 | Yrityksen nimi mukaan käyttäjän tallentaman varmuuskopion ehdotettuun tiedostonimeen päivämäärän lisäksi. | Suunniteltu; nimen lähde ja turvallinen nimeämissääntö päätettävä. |
| D029-01 | Työtilatoiminnon tarkka turvallinen virhesyy lokiin, esimerkiksi väärän yrityksen varmuuskopion hylkäys. | Puute todettu; korjaus tekemättä. |
| D029-02 | Päivitystapahtumat kulkemaan sovitusti diagnostiikan ja tukipaketin koko lukuketjussa. | Puute todettu; korjaus tekemättä. |
| D029-03 | Tukipaketin uusimpien tapahtumien valinta ajan mukaan eri lokilähteistä. | Puute todettu; korjaus tekemättä. |
| D029-04 | Tyhjä, osittainen ja epäonnistunut lokin luku eroteltaviksi. | Puute todettu; tila- ja kattavuussopimus päätettävä ennen korjausta. |
| D029-05 | Desktopin lokikirjoituksen häiriö näkyväksi turvallisesti. | Puute todettu; häiriöilmoituksen sopimus päätettävä ennen korjausta. |
| R030-04 | Käyttäjäilmoitusten tarkennus, erityisesti odotetut estot ja saman version päivitysyrityksen palaute. | Tarkistettava ja rajattava; saman version torjunta ei itsessään ole vika. |
| R030-05 | Muuttuvien toimintojen ohjeet ja lyhyt virhetilanteen tukiohje ajan tasalle. | Suunniteltu; tarkistetaan toteutusten yhteydessä. |
| R030-08 | Diagnostiikan vanhempien tapahtumien selaaminen nykyisen yhden otoksen ulkopuolelle sekä paluu uudempiin tapahtumiin. Näytettävä aikaväli, jatkon saatavuus ja mahdolliset lukurajat näkyviin. | Mukaan sovittu 2026-09-22; sivutuksen käyttöliittymä ja turvallinen lukusopimus suunniteltava ennen toteutusta. |

Diagnostiikan `D029-*`-tunnukset ja sen vanha tiedostonimi säilytetään
jäljitettävyyden vuoksi. Niiden tavoitejulkaisu on nyt `0.3.0`.
Tarkat havainnot ja hyväksyntäehdot ovat
[diagnostiikan täydennyssuunnitelmassa](diagnostics-0.2.9-completion-plan.md).

### R030-01: Odotustilojen latausilmaisin

Kartoita ensin nykyiset tilat ja puuttuva palaute: tietojen haku ja
tallennus, PDF:n valmistelu, varmuuskopiointi ja tarkistus, palautus,
yrityksen vaihto, päivityksen valmistelu sekä sähköpostin valmistelu ja
lähetys. Kartoitus ei tarkoita saman peittävän odotusikkunan lisäämistä
kaikkiin toimintoihin eikä liiketoimintalogiikan muuttamista.

- Ilmaisin sidotaan toiminnon todelliseen tilaan ja näytetään sopivassa
  kohdassa painikkeessa tai työalueella. Pelkkä harmaa painike ei kerro,
  että työ on käynnissä. Käytetään nykyisiä UI-käytäntöjä ilman uutta
  riippuvuutta tai koko käyttöliittymän refaktorointia.
- Aloituspalaute estää epävarmuuden ja tahattomat kaksoiskäynnistykset.
  Mahdollinen animaation näyttöviive sovitaan erikseen välkkymisen
  välttämiseksi; se ei viivytä toimintoa tai sen valmistumista.
- Tuntemattomalle kestolle ei näytetä keksittyä prosenttia. Ilmaisin ei
  väitä onnistumista eikä käynnistä automaattista uudelleenyritystä.
- Onnistuminen, virhe, peruutus ja aikakatkaisu lopettavat odotustilan
  asianmukaiseen palautteeseen. Epäselvä lopputulos kerrotaan epäselväksi;
  esimerkiksi lähetystä ei kehoteta toistamaan sokkona.
- Ikoni ja teksti eivät siirrä painikkeita tai muuta työalueen mittoja.
  Tarkistetaan näppäimistö, fokus, ruudunlukijan tilailmoitus ja vähennetty
  liike. Ilmaisin ei ole ainoa saavutettava tieto odottamisesta.
- Testaa nopea ja hidas onnistuminen, virhe, peruutus, kaksoispainallus ja
  näkymän vaihtuminen. Native-dialogeja tai uudelleenkäynnistystä vaativan
  toiminnon palaute suunnitellaan sen elinkaaren mukaan.

UI-vastuut säilyvät [UI-periaatteissa](../design/ui-principles.md) ja
[jaettujen komponenttien tiekartassa](ui-design-system-roadmap.md).

### R030-02 / W7: Yrityksen poisto

Poisto on tämän julkaisun vaadittu ominaisuus, ei valinnainen myöhempi lisä.
Toteutus noudattaa [ADR-0011:tä](../decisions/ADR-0011-local-multi-workspace-company-model.md)
ja [työtilasuunnitelman W7-vaihetta](local-company-workspace-plan.md#w7-workspace-deletion).
Ennen toteutusta ratkaistaan vähintään:

- aktiivisen, passiivisen ja viimeisen yrityksen poistaminen sekä
  virhe-/palautumistilassa olevan työtilan rajaus
- kirjoitusten esto, prosessien hallittu sulkeminen, nimen kirjoittamalla
  tehtävä vahvistus ja Electron mainin native-vahvistus
- tuore validoitu varmuuskopio tai ADR:n edellyttämä nimenomainen
  riskihyväksyntä; ei uutta piilotettua varmuuskopiointia
- quarantine-vaiheen tarkoitus, käyttäjälle näkyvä palautumismenettely,
  säilytys ja lopullinen poisto; väliaikaista turvavaihetta ei esitetä
  erillisen varmuuskopion korvaajana
- salaisuuksien, palautuspisteiden ja ulkoisten PDF-arkistojen käsittely
  niin, ettei muita työtiloja tai niiden tiedostoja poisteta
- keskeytyminen, levy-/kirjoitusvirhe, restart ja turvallinen recovery.

Julkaisu vaatii alemman tason testien lisäksi oikean paketoidun Windows-
polun synteettisellä aineistolla ja muiden yritysten säilymisen todistuksen.
Pelkkä poistopainike tai onnistuva normaalitapaus ei täytä tehtävää.

### R030-03: Varmuuskopion nimi

Yrityksen nimi helpottaa kopioiden erottamista. Ennen toteutusta sovitaan,
käytetäänkö työtilan näyttönimeä vai Oma yritys -tietojen nimeä ja mikä on
puuttuvan nimen varavaihtoehto. Nimi on ulkoista syötettä: pituus, Windowsin
kielletyt nimet/merkit ja polkuerottimet käsitellään omistavassa runtimessa.
Käyttäjä valitsee edelleen tallennuskohteen native-dialogissa.

Yrityksen nimi näkyy tiedostonimestä myös silloin, kun sisältö on salattu.
Tämä kerrotaan nimeämisen käyttöohjeessa. Nimeä tai kokonaista polkua ei
lisätä lokeihin tai tukipakettiin. Tiedostonimi ei osoita yritysten samaa
alkuperää: palautuksen lineage-tarkistus, salaus ja formaatti säilyvät.
Testaa myös pitkät ja samannimiset yritykset sekä olemassa olevan tiedoston
käsittely nykyisen turvallisen tallennussopimuksen mukaan.

### R030-08: Diagnostiikan historian selaus

Käyttäjä pääsee selaamaan säilyneitä vanhempia diagnostiikkatapahtumia
nykyisen ensimmäisen otoksen ulkopuolelle ja palaamaan uudempiin.
Pelkkä taulukon vierityspalkki tai nykyisen tapahtumarajan kasvattaminen
ei täytä tavoitetta. Tapahtumat haetaan rajattuina erinä, ei koko historiaa
kerralla. Tarkka sivutus ja käyttöliittymän ohjaimet sovitaan toteutussuunnittelussa.

Näytetään näkyvän erän aikaväli ja erotetaan saatavilla oleva jatko,
historian loppu sekä puuttuva tai osittain luettu aineisto. Säilytysajan
vuoksi poistuneita tapahtumia ei luvata palautettaviksi. Lataus-, virhe-
ja tyhjän tuloksen tilat sekä selauskohdan säilyminen huomioidaan.
Rajaus ei lisää lokien säilytysaikaa, raakalogien näyttöä tai uusia
hakusuodattimia. Tarkat turvallisuus- ja testiehdot ovat
[diagnostiikan suunnitelman R030-08-kohdassa](diagnostics-0.2.9-completion-plan.md#r030-08-diagnostiikan-historian-selaus).

## Mukana suunnittelussa, toteutusraja vielä päätettävä

| Tunnus | Aiemmin esiin noussut asia | Päätöstilanne |
| --- | --- | --- |
| R030-06 | Ensikäyttö ilman automaattista oletusyritystä: luo yritys tai tuo kopio. | Säilyy jatkotoiveena W7:n yhteydessä. Viimeisen yrityksen jälkeinen tyhjä tila on ratkaistava W7:ssä joka tapauksessa; ensiasennuksen laajempi muutos rajataan erikseen. Päivitys ei poista olemassa olevia yrityksiä. |
| D029-06 | Diagnostiikan Päivitä-toiminto, viimeisin onnistunut hakuaika ja osakohtainen virhetila. | Kirjattu suositus; mukaanotto päätetään ennen julkaisurajauksen lukitsemista. |
| R030-07 | Diagnostiikan virhe-/varoitussuodatus ja turvallisen virhekoodin kopiointi. | Valinnainen myöhempi lisä, ei muiden korjausten edellytys. |

## Muistissa mutta rajauksen ulkopuolella

- SMTP-salasanan suojaustavan parantaminen: erillinen arvio ja päätös;
  nykyistä salaisuusmallia ei muuteta tämän listauksen perusteella.
- Palautettavan varmuuskopion ja sitä uudempien merkintöjen yhdistäminen:
  jätetty ajatuksen tasolle. Nykyinen palautus ei yhdistä tietokantoja.
- Pilvipalvelut ensin ja työntekijän mobiilisovellus sen jälkeen ovat
  myöhempiä erikseen hyväksyttäviä kokonaisuuksia, eivät `0.3.0`:n sisältöä.
- Ohjeiston laajempi tiivistäminen ja tutkimushistorian uudelleenjärjestely
  voidaan tehdä `0.3.0`:n jälkeen. Julkaisun I/M5-vaiheiden ajantasaisuus-,
  lukureitti-, rakenne- ja tietoturvatarkistuksia ei siirretä tämän vuoksi.
  Muuttuvan alueen ohjeet pidetään kunnossa jo jokaisen toteutuspalan mukana;
  vaatimukset ja hyväksyntänäyttö säilyvät tiivistettäessä.
- Ei piilotettuja varmuuskopioita, yleistä tietokannan salausuudistusta,
  uusia sähköpostiprovidereita, laajaa refaktorointia tai uutta
  riippuvuutta tämän suunnitelman sivutyönä.

## Eteneminen ja seuranta

Tämä tiedosto omistaa kokonaisuuden työjärjestyksen ja työpakettien tilan.
Omistavat moduuli-, diagnostiikka-, backup- ja update-suunnitelmat omistavat
tarkat sopimukset. Yksityiset tutkimusraportit säilyvät muuttamattomina
todisteina: niiden historiallinen testitulos ei ole uuden version hyväksyntä.

### M0: Nykyinen työ mainiin ennen korjauksia

**Valmis.** Alla säilyy M0:n hyväksyntäsopimus; sitä ei käynnistetä uudelleen
uutena työvaiheena. Nykyinen lähtörevisio on [M1:n jatkamiskohdassa](release-0.3.0-m1-preparation-plan.md#jatka-tästä).

Testi-, PR- ja merge-ajot noudattavat pysyvää
[CI-seurantaohjetta](../ai/workflow.md#ci-ajon-seuranta-ja-virhetodisteet).
Ajonaikainen seuranta ei korvaa testin omaa vaihehavaintoa tai hyväksyntäporttia.

1. Varmista tuore paikallinen ja etärevision tilanne, PR ja sen kohdehaara.
   Tarkista nykyisen käyttäjätestauksen oikeasti kirjatut tulokset ja avoimet
   kohdat; testiohje ei yksin todista testien valmistumista.
2. Käy olemassa olevat dokumenttimuutokset läpi ja säilytä ne hallitusti.
   Älä tyhjennä työpuuta palauttamalla muiden muutoksia tai lisää yksityisiä
   raportteja Gitiin. Tarkista julkaistava sisältö ja staged diff.
3. Yhdistä hotfix-haara normaalia PR-menettelyä käyttäen. Täsmällisen
   PR-revision vaadittujen tarkistusten on valmistuttava hyväksytysti.
   Aiemman pilottitoimituksen poikkeus ei ole lupa ohittaa tarkistuksia,
   branch protectionia tai merge-ehtoja.
4. Odota myös täsmällisen merge-commitin vaaditut `main`-ajot. Kirjaa
   hyväksytty lähtörevisio ja aloita korjaukset siitä puhtaissa, rajatuissa
   `codex/`-haaroissa. Dokumenttimuutokset eivät saa kadota tässä siirtymässä.

Jos tarkistus epäonnistuu, on kesken tai peruutettu, portti ei ole läpäisty.
Jos portin läpäisy vaatii korjauksen jo ennen mergeä, pysähdy ja pyydä
omistajalta päätös rajattuun valmistelukorjaukseen: merge-first-järjestystä
ei vaihdeta hiljaisesti eikä tarkistusta poisteta esteen kiertämiseksi.

Puhdas työpuu tarkoittaa jäljitettävää integraatiopohjaa, ei tunnettujen
virheiden poistumista eikä uuden tuotantojulkaisun hyväksyntää. Alla olevat
korjaustehtävät säilyvät avoimina myös vihreän lähtötilan jälkeen.

<details>
<summary>M0:n integraatiota edeltävät valmistelu- ja testitulokset</summary>

#### M0-seuranta 2026-09-24: integraatiota edeltävä historia

Tämä alaluku säilyttää valmistelun päätökset ja testitulokset. Nykyinen
PR/main-tila on [integraatiocheckpointissa](https://github.com/eky-software/eky/pull/275#issuecomment-5819025563).
PR #274:n aiemman main-hylkäyksen näyttö säilyy
[jälkitodennuscheckpointissa](windows-installer-acceptance-harness-v2.md#m0-mainin-jälkitodennus).

Tila: **aloitettu / integraation hyväksyntä avoin**. Paikallinen ja PR:n
head on `9699f4e0efd0a82984d155b4d46b0b401ebb17e3`;
[PR #274](https://github.com/eky-software/eky/pull/274) on luonnos ja sen
kohde on `main`. Dokumenttimuutokset ovat vielä työpuussa. Niiden rajattu
katselmus ei löytänyt julkaisuestettä, mutta staged diff tarkistetaan
erikseen ennen commitia.

Required checkit ovat edelleen `V2 acceptance` ja `Audit dependencies`.
[PR-ajon](https://github.com/eky-software/eky/actions/runs/35474235856)
auditointi hyväksyttiin, mutta V2-ajo peruutettiin ja koonti hylättiin.
Samalle head-revisiolle tehdyssä
[erillisessä kokonaisajossa](https://github.com/eky-software/eky/actions/runs/35474264108)
myös supervisorin lapsiprosessin valmiusmerkintää odottava sopimustesti
epäonnistui ennen kokonaisajon peruutusta. Peruutus ja testivirhe ovat eri
havaintoja; uutta hyväksyttyä baselinea ei ole todennettu.

Omistaja hyväksyi rajatun **M0-valmisteluselvityksen** ennen mergeä:
selvitetään valmiusmerkinnän aikakatkaisun juurisyy ja suunnitellaan
tarvittava korjaus. Lupa ei muuta sovelluksen ominaisuuksia, aikarajoja tai
CI-vaatimuksia eikä vielä hyväksy toteutusta. Historiallinen yksittäinen
läpäisy ei kumoa epäonnistumista. Toteutusraja ja sen hyväksyntänäyttö
päätetään selvityksen jälkeen ennen koodimuutoksia.

Rajattu lähde- ja lokikatselmus on nyt tehty; historiallinen juurisyy ei
vielä ole varmistunut. Suositeltu seuraava pala ja sen hyväksyntä ovat
[harnessin M0-suunnitelmassa](windows-installer-acceptance-harness-v2.md#m0-valmiusmerkinnän-selvitys).
Omistaja hyväksyi tämän jälkeen M0.1:n testiharnessin diagnostiikkakorjauksen.
Tila: **M0.1 toteutettu / rajatut kohdetestit läpäisty**. Windowsin
diagnostiikka- ja cleanup-kohdetestit läpäisivät 25/25, terminal-validator
5/5 ja alkuperäinen deadline-sopimus 1/1 yhdellä yrityksellä. Testivirheen
näyttö säilyy nyt siivouksesta erillään, eikä puuttuvaa valmiusmerkintää
hyväksytä onnistumiseksi. Tämä ei vielä ratkaise tai hyväksy M0.2:n
ajoitusratkaisua eikä muuta aikarajoja, tuotantokoodia tai CI-portteja.
Kokonaisperheiden ja uuden revision required checkien todennus on avoin.

**M0.2-suunnittelun checkpoint:** tarkka toteutusehdotus on kirjattu
[harnessin päätösrajaan](windows-installer-acceptance-harness-v2.md#varsinaisen-korjauksen-päätösraja-m02).
Se erottaa oikean ajan käynnistysrajan hallitusta, todellisia Windows-
prosesseja käyttävästä deadline-testistä. Ehdotus sisältää ytimen sisäisen
kello-/odotusrajapinnan, cleanup-ajan etenemisen myös setup-virheessä,
täsmälliset prosessikahva- ja Job-todisteet sekä muuttumattomat PR/main-portit.
Tila on **toteutettu / katselmoitu / kokonaisportit kesken**. Omistajan
nimenomainen M0.2-hyväksyntä saatiin ennen koodimuutoksia. Kohdeajo 65/65,
kaksi ennalta sovittua toistosarjaa 10/10 ja 10/10 sekä koko supervisor-
perhe 97/97 läpäisivät. Riippumaton katselmus jätti neljä testitodisteen ja
turvallisen virheraportoinnin korjausta; ne on kirjattu
[taukocheckpointtiin](windows-installer-acceptance-harness-v2.md#taukocheckpoint).
Työ pysäytettiin omistajan pyynnöstä päättyneen testiperheen jälkeen.
Omistaja antoi tämän jälkeen jatkoluvan. Neljän havainnon rajatut korjaukset
ovat työpuussa. Uusintakatselmuksessa löytynyt vastaava proof-kirjoituksen
virhetestin puute korjattiin myös; avoimia katselmushavaintoja ei jäänyt.
Lopullisen toteutuksen kohdeajo läpäisi 103/103, prosessitoistot 10/10
kummassakin skenaariossa ja koko supervisor-perhe 135/135. Legacy-core
läpäisi 444/446; kaksi native product inspector -testiä epäonnistui, joten
perheen hyväksyntä on avoin. Omistaja hyväksyi 2026-09-24 koko muuttumattoman
legacy-core-perheen todentamisen puhtaassa normaalissa Windows-CI:ssä ennen
mergeä. Paikallinen epäonnistuminen säilyy kirjattuna; testejä tai CI:tä
ei kevennetä. Muut paikalliset portit pysyvät ennallaan.
Työtilan testit, typecheck, web/backend/desktop-buildit ja CI-sopimukset
55/55 läpäisivät. Kahdeksan olemassa olevaa alustarajattua ohitusta ei lasketa
läpäisyiksi. Kriittinen system/web-E2E läpäisi 106/106, koko system-perhe
131/131 ja Electron developmentin kriittiset polut 38/38, ilman uusinta-ajoa.
Kaikki tässä checkpointissa kuvatut paikalliset ajot ovat päättyneet.
Hyväksytty seuraava vaihe on julkaisurajan tarkistus, commit/push ja uuden
PR-revision normaali kokonaisajo. Legacy-core-perheen ja muiden vaadittujen
tarkistusten on läpäistävä ennen mergeä; mainin oma hyväksyntä tulee tämän
jälkeen. PR/main-integraatio on vielä avoin.
Viereisissä testeissä tunnistetut readiness-riskit on nimetty, ei piilotettu
uuden testin läpäisyyn. Goal pitää M0-kokonaisuuden aktiivisena mutta ei
ohita tätä toteutuslupaa tai muiden korjausten erillisiä päätöksiä.

Tämä on integraatiota edeltävä checkpoint, ei PR/main-hyväksyntä.
T/A/B/C/K/D/E/F/G/H/I-pakettien järjestys säilyy; rajattu
M0-selvitys ei avaa muuta 0.3.0-toteutusta ennen integraatioporttia.

</details>

### M1: Todistuksen ja päätösten valmistelu

**Tila:** suunnitteluvalmistelu sekä T1a/T1b, T2 ja T3/R28 on hyväksytty,
myös niiden omat PR/main-portit. [T3:n integraatiohyväksyntä](e2e-test-environment-history.md#t3n-integraatiohyväksyntä)
sulkee prosessiomistajuuden, oikeiden kuluttajien siirron ja korvatun
aktiivisen toteutuksen poiston hyväksytyssä rajauksessa. Aiemmat kokeet,
määrät ja hylkäysten syyepävarmuudet säilyvät omina checkpointteinaan.
Myös integraation jatkokorjaus on hyväksytty PR #281:n omissa main-porteissa.
M1:n sovelluskorjaukset ovat osittain valmiit: A1/R01 ja A2/R05 ovat
hyväksyttyjä yllä kuvatulla integraationäytöllä ja A2:n rajatulla
etenemispäätöksellä. Oma yritys -tallennuskorjauksen ja rajattujen
testikorjausten integraatio on hyväksytty PR #293:n mainissa.
Myös A3/R06 on hyväksytty PR #294:n mainissa; sen
[loppuhyväksyntä](https://github.com/eky-software/eky/pull/294#issuecomment-5980132408)
sulkee A-paketin kolme rajattua korjausta. Myös
[B1/B2](release-0.3.0-m1-preparation-plan.md#b1b2-rajattu-toteutus),
niiden rajattu sulkukorjaus ja salatun keräyksen jatko ovat hyväksyttyjä
[PR #297:n mainissa](https://github.com/eky-software/eky/pull/297#issuecomment-5992208049).
Myös B3-B5 on hyväksytty [PR #298:n mainissa](https://github.com/eky-software/eky/pull/298#issuecomment-6050339146).
Nykyinen työ on [C-paketin valmistelu ja rajattu toteutus](release-0.3.0-m1-preparation-plan.md#c-paketin-valmistelu-ja-hyväksyntärajat),
ei B:n tai testiperustan uusiminen. Vanhat sulkuaikakatkaisut eivät
muutu korjatuiksi tämän integraation perusteella. B0:ssa tarkistettiin alkuperäiset
turvallisuushavainnot, B1-B5-toteutusjärjestys ja
revision, toimitussuojan sekä vanhan datan päätösportit. Omistaja hyväksyi
B-P1:n revisiosidonnan ja rajatut migraatiot. B-P2:ssa valittiin onnistuneen
testilähetyksen jälkeisen muokkaamisen säilyttävä toimitushistoria
suunnitteluun. B-P3:n säilyneen, tarkistetun legacy-PDF:n erikseen vahvistettu
uusi lähetys on hyväksytty ilman regenerointia tai takautuvaa varmuusväitettä.
Yleistä vanhan SMTP-historian estoa ei hyväksytty. B3/B4:n revisio-/PDF-/
toimitushistoria, legacy-uudelleenlähetyksen client/UI/native-ketju ja
B5-palautus on hyväksytty PR #298:n rajauksessa. Osahyvityksen
ALV-erittelyn lukupolun rajattu korjaus on todennettu
nykyisen kumulatiivisen laskentasäännön mukaan, vanhoja summia tai PDF:iä
muuttamatta. Tarkka nykytila ja hyväksyntänäyttö luetaan M1:n jatkamiskohdasta.
Kohdetestit eivät yksin sulje uuden revision integraatiota tai muita paketteja.
Tarkka jako on [M1-suunnitelmassa](release-0.3.0-m1-preparation-plan.md):
T1a/T1b testien ajokytkentä, T2 projektivalinta ja build-edellytykset,
T3 testiprosessien omistajuus sekä A1:n rajattu kohdekorjaus.
W7:n päätöslista on [työtilasuunnitelmassa](local-company-workspace-plan.md#w7-valmistelu-ja-paatosportti).
Suunnitelma itsessään ei korvaa kunkin palan toteutus- ja hyväksyntänäyttöä.

T-paketin testikytkennät ja testiruntimen edellytykset on hyväksytty
myöhempien pakettien perustaksi. Kaikkia I-paketin ohjetarkistuksia ei
tehdä ennen ensimmäistä sovelluskorjausta.
Testin olemassaolo, sen ajokytkentä ja sen todellinen läpäisy todennetaan
erikseen. Tutkimusprobe, jonka PASS tarkoittaa virheen toistumista, ei
ole korjatun toiminnon hyväksyntätesti.

Lukitse rajatun ensimmäisen korjauspalan sopimus ja tarvittavat alla
luetellut omistajapäätökset. W7:n suunnittelu aloitetaan tässä, jotta poiston
päätökset eivät jää julkaisun loppuun; sen toteutus odottaa tarvittavaa
lifecycle-, backup- ja diagnostiikkapohjaa. Kaikkia päätöksiä ei tarvitse
ratkaista samassa keskustelussa.

### M2: Datan eheys ja turvallinen elinkaari

Ensimmäinen korjausaalto on A:n kohde-identiteetti, B:n lasku-/PDF-/
toimitusrevision sopimus, C:n update-/shutdown-/kirjoitussuojan rajat sekä
K:n varmuuskopion luottamus- ja resurssiraja. Nämä valmistellaan pieninä,
erikseen todennettavina muutoksina, ei yhtenä suurena refaktorointina.
Työpakettien kirjaimet eivät ole koodimoduuleja tai uusia palveluita.

| Paketti | Katselmuksen tunnukset | Omistaja ja suunniteltu hyväksyntä |
| --- | --- | --- |
| T: Testitodisteen luotettavuus | R27, R28, R29 | Desktop/E2E-harness ja CI-kytkentä: kaikki tarkoitetut testit ajettaviin komentoihin; testiprojektin prerequisite-buildit puhtaasta checkoutista; koko omistetun prosessipuun poistuminen, myös juuren ensin poistuessa. |
| A: Luonnoksen kohde ja asynkroninen UI | R01, R05, R06 | Invoicingin web-feature: tallennus pysyy oikeassa kohteessa, ensimmäinen create säilyttää luonnoksen ID:n, vanha readiness ei hyväksy muuttunutta lomaketta. Viivästetyt/väärässä järjestyksessä valmistuvat vastaukset ja backendin pysyvä jälkiluku. |
| B: Laskun sisältö ja toimitus | R02, R08, R12, R13; S030-03, S030-04, S030-05 | Invoicing omistaa snapshotin, PDF:n ja toimituksen revision; SMTP-adapteri protokollan. Vain oikea revisio voidaan julkaista/toimittaa/kuitata; epävarma toimitus säilyttää todisteensa. Hyvitykset käyttävät auktoritatiivista ALV-pyöristystä, lopullinen SMTP-kuittaus säilyy lopputuloksena ja parseri on chunk-jaosta riippumaton. |
| C: Desktopin elinkaari ja päivitys | R03, R04, R17, R18, R19 | Electron mainin olemassa olevat koordinaattorit: graceful-only update, katkeamaton kirjoitussuoja palautuspisteestä handoffiin, todettu prosessin exit ennen seuraavaa omistajaa, tuotantoon kytketty create/import-recovery ja yhdenmukainen build-/manifest-revisio. Todellinen composition ja oletuspaketointi testiin. |
| K: Varmuuskopion turvallinen tarkistus | S030-01, S030-02 | Backup-infrastruktuuri, backendin migration/schema- ja moduulien validointiportit: tuodun kannan schema todennetaan hyväksyttyyn versioon; epäluotetun tarkistuksen työ ja tulokset rajataan erilleen business-runtimesta. Tuonti, korvaus, inspection ja recovery testataan erikseen. |

### M3: Muut invariantit, diagnostiikka ja ylläpidettävyys

| Paketti | Katselmuksen tunnukset | Omistaja ja suunniteltu hyväksyntä |
| --- | --- | --- |
| D: Yritysasetukset ja salaisuusoperaatiot | R07, R14, R16 | Company Settings, oma web-feature ja yksityinen secret-broker: epäonnistunut luku ei oikeuta tyhjien oletusten tallennusta; timeout ja myöhempi sivuvaikutus sovitetaan; vastaus ja audit vastaavat todellista commitia. Tämä ei ole salasanan säilytysmallin uudistus. |
| E: Asiakasinvariantit | R09, R10, R11 | Customers: viitatun asiakastyypin muutos sovitulla säännöllä, numeroinnin tarkkuus ja loppuraja, turvallinen suomenkielinen tuntemattoman virheen fallback. Yrityseristys ja normaalit käyttötapaukset säilyvät. |
| F: Frameworkin virheketju | R15 | Backendin HTTP/observability-koostaminen: oikean framework-ketjun vastaus, rakenteinen loki ja konsoli käsitellään turvallisesti. Paketoidun stdion hiljaisuus ei yksin todista sanitointia. |
| G: Diagnostiikan tapahtumaketju | R20, R23; D029-01, D029-02 | Desktopin observerit ja Diagnosticsin projektiot: syy/vaihe säilyvät turvallisesti; tarkoitetut update- ja PDF-arkistotapahtumat kulkevat writer -> reader -> HTTP -> strict client -> UI/tukipaketti -ketjun. Tarkoitukselliset poissulut dokumentoidaan. |
| H: Diagnostiikan saatavuus ja oikeellisuus | R21, R22, R24, R25, R26; D029-03, D029-04, D029-05 | Lokihuolto, lukijat ja diagnostiikan tilasopimus: lukuvirhe ei estä tervettä startupia, tuleva päivä ei syrjäytä kelvollista historiaa, eri lähteistä valitaan aidosti uusimmat tapahtumat, osittaisuus erotetaan tyhjästä ja writer-häiriöllä on turvallinen ei-rekursiivinen fallback. |
| I: CI-politiikka ja ajantasaiset sopimukset | R30, R31 | CI:n riskiluokitus ja omistavat dokumentit: mahdollinen raskaan matriisin rajaus hyväksytään erikseen, tuntematon vaikutus fail-closed. Integration-matriisi, E2E-strategia ja lifecycle/recovery-ohjeet erottavat nykyisen tuotantokytkennän historiallisesta foundation-vaiheesta. |

R01-R31 esiintyvät yllä kukin yhdessä omistavassa paketissa. D029-kohdat
ovat samoja töitä G/H-paketeissa, eivät toinen korjausjono. PDF-arkiston
katalogisopimus ja retentionin reunaehdot täydentävät D029-listaa; niitä ei
kuitata valmiiksi pelkän vanhan diagnostiikkalistan läpäisyllä.

T-paketin T1a/T1b, T2 ja T3/R28 on hyväksytty niiden omien
integraatioiden näytöllä; [T3:n integraatiohyväksyntä](e2e-test-environment-history.md#t3n-integraatiohyväksyntä) ei perustu
pelkkään historialliseen T3c-W:n 4/4-koetulokseen. A-paketin A1/R01, A2/R05
ja A3/R06 ovat hyväksyttyjä; viimeisin hyväksyntä on PR #294:n mainissa.
C/K/D/E/F/G/H/I:n kokonaishyväksyntä on edelleen avoin.
D-paketin Oma yritys -tallennuksen rajatut korjaukset on hyväksytty
PR #293:n mainissa, mutta D:n muut ehdot ovat avoinna.
B1/B2, niiden sulku-/keräysjatkot ja B3-B5 integraatiojatkoineen ovat
hyväksyttyjä. Nykyisen C-valmistelun tilan ja näytön omistaa
[M1:n jatkamiskohta](release-0.3.0-m1-preparation-plan.md#jatka-tästä).
Muiden pakettien avoimet päätökset ratkaistaan ennen niiden vaikutusalueen
toteutusta. B:n hyväksyntä ei sulje muita paketteja tai koko M1:tä.

I-paketin dokumentaatiokatselmukseen kuuluu myös ohjelmanosittainen
ohjeiden löydettävyys: juuri- ja paikalliset `AGENTS.md`-tiedostot,
moduulivastuut, ADR:t sekä testaus-/diagnostiikka-/turvallisuusohjeet
muodostavat ehjän lukureitin. Aliagentit voivat tarkistaa eri alueet;
pääagentti kokoaa havaitut linkki-, ankkuri-, päällekkäisyys- ja
ajantasaisuuspuutteet sekä varmentaa korjaukset. Koko ohjeverkon katselmus
on vielä tekemättä. Se täydentää jokaisen tehtävän pysyvää
[ohjeiden tarkistusvelvoitetta](../ai/workflow.md#työn-aloitusjärjestys),
ei siirrä sitä myöhemmäksi tai rajoita sitä 0.3.0-julkaisuun.

Rajattu lukureittikatselmus 2026-09-24: pysyvä aloitus- ja CI-seurantaohje
on linkitetty juuri-ohjeeseen, testaukseen ja tarkistuslistaan. Kahden
aliagentin katselmuksessa täydennettiin desktop-/E2E-, moduulihakemisto-,
PDF- ja workspace-lukureittejä sekä oikaistiin UI-paketin vanha ohjaus
olemassa olevaan tiekarttaan. Muutettujen ohjeiden paikalliset linkit ja
otsikkoankkurit tarkistettiin rajatusti. Tämä ei hyväksy koko I-pakettia,
M0:aa tai kaikkien ohjeiden sisällön ajantasaisuutta.
Yksittäiset R- ja S030-tunnukset säilytetään paketin toteutusseurannassa;
osittainen paketti ei sulje koko ryhmää. Jos jokin havainto kumoutuu tai
rajataan myöhemmäksi, kirjaa vastanäyttö tai omistajan päätös ja jäännösriski.

### Skannauksen tuoma täydennys

Osittaisen, keskeytetyn Deep Scanin tallennetut tulokset täydentävät katselmusta;
ne eivät ole valmis koko repositorion turvatarkastus tai korjaustodiste. Sen
päällekkäiset havaintoinstanssit on ryhmitelty alla vain työn suunnitteluun.
Alkuperäisiä löytötunnuksia, vakavuusluokkia, näyttöä ja kattavuusaukkoja
ei kirjoiteta uudelleen. Tarkka vastaavuus säilyy yksityisessä liitteessä.
Raportin korjausehdotus ei tarkoita toteutettua tai testattua patchia.

M1-valmistelussa tallennetut 13 havaintoinstanssia ja korjausehdotukset
luettiin uudelleen lisäosasta. Ajon tila on yhä `canceled`, eikä suljettua
loppuraporttia ole saatavilla. Alla oleva viiden ryhmän työjako säilyy;
alkuperäisiä vakavuusluokkia tai validointirajoituksia ei yhdistetä uudeksi
skannerin tulokseksi. B0:ssa 4.10.2026 vertailtiin lisäksi B:n Invoicing-/SMTP-
tuotantopolut hyväksyttyyn PR #294:n mainiin: niiden toteutukset eivät olleet
muuttuneet skannauksen lähtörevisiosta. Tämä rajattu vertailu ei ole uusi
runtime-testi eikä muiden pakettien ajantasainen tarkastus.

| Tunnus | Suunniteltu turvasopimus | Suhde muuhun työhön |
| --- | --- | --- |
| S030-01 | Salattu ja checksum-tarkistettu tuonti ei yksin todista SQLite-scheman luotettavuutta. Todennetaan todelliset sallitut objektit ja määrittelyt version mukaan ennen epäluotettuja relaatiokyselyitä, kirjoitettavaa avausta tai migraatiota. | K:n uusi velvoite; sekä import-as-new että same-lineage-korvaus. Säilytetään hyväksytyt historialliset prefixit ja oikeat guard-triggerit. |
| S030-02 | Epäluotetun kannan tarkistus ei saa jumittaa aktiivista business-runtimea. Aika-, resurssi- ja tulosrajat sekä todettu tarkistusprosessin päättyminen ennen cleanupia/uudelleenkäyttöä. | K:n erillinen saatavuusraja, hyödyntää C:n prosessiomistajuutta ja T:n todistusta. Promise-timeout ei ole työn keskeytyksen todiste. |
| S030-03 | Toimitus varaa ja kuittaa täsmällisen muuttumattoman revision/document-identiteetin; attempted/outcomeUnknown ei oikeuta todisteen tuhoamiseen. | Laajentaa R02:ta B-paketissa; epävarma lopputulos ja restart mukana. |
| S030-04 | Asynkroninen PDF julkaistaan ja käytetään uudelleen vain sitä vastaavalle snapshotille; vanha kirjoittaja ei korvaa tai siivoa uutta artifactia. | B:n oma PDF-raja, ei pelkkä SMTP-korjauksen sivuvaikutus. |
| S030-05 | Peruuttaminen ja lähetyksen varaus ratkaistaan atomisesti. Jos peruutus voittaa, provideria ei kutsuta; varauksen jälkeen sovittu esto säilyy. | B:n toimitusta edeltävä raja; asiakaslähetys ja testilähetys testataan erikseen. |

Säilytetään nykyinen local-owner-, yritys-, permission- ja native-
vahvistusraja. Näistä havainnoista ei päätellä internetistä saavutettavaa
palvelua, käyttöjärjestelmän koodinsuoritusta tai yritysrajan ohitusta.
Katselmuksen correctness-havainto voi silti vaatia korjauksen, vaikka
skanneri ei vahvista sille erillistä hyökkääjän käyttämää turvavaikutusta.

Skannauksen keskeneräiset hypoteesit erotetaan korjausjonosta. A/B:n
regressioihin lisätään vanhentuneen sähköpostiesikatselun kohdevaihto, C:n
fault-testeihin saman scheman rollback ja keskeytyneet hyväksyntävaiheet.
Mainin pyyntörungon muistiraja, lokimäärän resurssiraja ja testipolkujen
containment jäävät rajatuiksi tarkistustehtäviksi, eivät vahvistetuiksi
uusiksi haavoittuvuuksiksi. Niille kirjataan näyttö tai rajauspäätös.
Lukematta jääneet lähteet, Windowsin native-käyttäytyminen ja ajantasaiset
riippuvuustiedot kuuluvat loppukatselmuksen kattavuuslistaan.

### Päätökset ennen niiden vaikutusalueen toteutusta

- K: versionmukaisen schema-attestoinnin omistaja ja kanonisointi,
  historiallinen yhteensopivuus sekä kertakäyttöisen backend-utilityn
  aikaraja, resurssirajat, exit-todiste ja virhesopimus. Ensisijainen
  suunnittelusuunta on nykyiseen omistajuuteen rajattu attestointi ja
  eristetty tarkistus, ei koko tietokannan uudelleenrakennus tai mainin
  SQLite-ajuri. Pelkät PRAGMA-asetukset eivät korvaa näitä sopimuksia.
- B: revision/document-hashin atominen varaus, PDF:n ehdollinen julkaisu,
  toimituksen epävarmuuden sovitus ja tarvittava metadata/migraatio.
  Suositus on Invoicingin oma pieni elinkaarisopimus, ei yleinen
  manager-kerros tai globaali lukko. SMTP-verkkokutsua ei pidetä avoimen
  SQLite-transaktion sisällä. Hyvityksen laskenta seuraa hyväksyttyä
  laskentasopimusta; epäselvä pyöristysratkaisu hyväksytään ensin.
  [B0:n päätöstaulukko](release-0.3.0-m1-preparation-plan.md#päätökset-ennen-bn-toteutusta)
  erottaa hyväksytyn B-P1:n revisiosidonnan/migraatiot, B-P2:n valitun
  historiasuunnan ja B-P3:n hyväksytyn rajatun legacy-uudelleenlähetyksen.
  Onnistunut itselle tehty testilähetys ei saa aiheuttaa pysyvää
  muokkausestoa. Historiatietomalli ja backup/restore täsmennetään ennen
  vaikutusalueensa toteutusta; legacy-resendin sisältövarmuuden raja säilyy.
  Nykyistä `sent`-sääntöä tai unresolved-toimituksen suojaa ei lievennetä.
- D/E: secret-operaation todennettu peruutus tai epävarman tilan sovitus,
  asetusten osittaisen saatavuuden palaute, viitatun asiakastyypin muutoksen
  esto tai hallittu siirto sekä numeroinnin loppurajan käyttäytyminen.
- G/H: turvalliset tapahtumaprojektiot, kattavuus-/häiriötila, fallback ja
  sivutuksen vakaa järjestys. I:n CI-riskiluokituksen keventäminen on
  erillinen päätös, ei korjausten edellyttämä automaattinen poikkeus.
- R030-02/W7 ja R030-03: yllä luetellut poisto-/recovery-päätökset ja
  backup-nimen lähde. R030-06, D029-06 ja R030-07 säilyvät omissa
  päätösluokissaan, eivät muutu pakollisiksi tämän roadmapin perusteella.

Turvallisuus voi edellyttää sopimuksen täsmennystä tai ADR-muutosta.
Kirjaa silloin nykyinen sääntö, ristiriita, ehdotettu muutos, vaikutus ja
testi-/palautumissuunnitelma; pyydä omistajan päätös ennen toteutusta.
Raportti tai agentin ehdotus ei kumoa ohjeita. Uusi riippuvuus vaatii aina
oman hyväksyntänsä. Yhteinen apu lisätään vain todelliseen toistuvaan
sopimukseen, ei tyhjien shared-pakettien täyttämiseksi tai tarkoituksellisen
luottamusrajavalidoinnin poistamiseksi.

### M4: Sovittu 0.3.0-käyttäjäkokemus

Toteuta korjatun pohjan päälle R030-01, R030-02/W7, R030-03 ja R030-08
rajattuina muutoksina. Diagnostiikan selaus tarvitsee G/H:n oikean lukuketjun
ja kattavuustiedon; W7 tarvitsee C/K:n turvallisen lifecycle/recovery-pohjan.
Ilmoitukset ja ohjeet R030-04/R030-05 valmistuvat jokaisen muutoksen mukana,
eivät vasta lopun kosmeettisena vaiheena. Latausikoni tai UI-esto ei korvaa
backendin invarianttia, atomista varausta tai prosessin exit-todistetta.

### M5: Uusi katselmus, Deep Scan ja julkaisuportti

Jokaisessa paketissa käytetään
[toiminnon valmistumisporttia](../ai/workflow.md#toiminnon-valmistumisportti):
oikeaa käyttäytymistä odottava regressio, todellinen runtime-kytkentä,
onnistuminen/esto/virhe/peruutus, turvallinen jäljitettävyys, sovitut
diagnostiikka- ja tukiprojektiot, ilmoitukset, ohje ja palautettavuus.
Uusi toiminto tuo nämä mukanaan eikä vain onnellisen polun testiä.

Koko korjaus- ja ominaisuuskokonaisuuden valmistuttua tehdään ensin koko
sovelluksen syvä koodi-, arkkitehtuuri- ja ylläpidettävyyskatselmus, vasta
sen jälkeen uusi Codex Security Deep Scan `Ultra`-päättelyllä. Omistajan
4.10.2026 täsmennys määrää tämän järjestyksen, ei uutta rinnakkaista roadmapia
tai kaikkien suurten tiedostojen automaattista uudelleenkirjoitusta.

Koodikatselmus kattaa backendin, webin, desktopin, jaetut paketit, jokaisen
toteutetun moduulin ja yhteisen testiperustan:

- vastaako todellinen riippuvuussuunta hyväksyttyä modulaarista monoliittia,
  Clean Architecture -kerrosrajoja sekä domain/application/port/adapter-jakoa
- säilyvätkö datan omistajuus, composition rootin vastuu ja moduulien julkiset
  luku-/kirjoitusportit ilman oikopolkuja tai kiertäviä riippuvuuksia
- löytyykö vaikeasti seurattavaa ohjausta, päällekkäistä logiikkaa tai usean
  vastuun koodikeskittymiä, joiden jakaminen oikeasti parantaa ylläpidettävyyttä;
  rivimäärä yksin ei ole refaktorointiperuste
- tarvitseeko todellinen toisto yhteisen työkalun vai kuuluuko se edelleen
  moduuliin; ei yleistä utils-kerrosta tai uutta riippuvuutta ennakolta
- ovatko uudet moduulit ja testit lisättävissä nykyisten pienten rajapintojen
  kautta, ja vastaavatko ohjeet, lukureitit, testit ja diagnostiikka toteutusta.

Tuloksena kirjataan lähdeviitteellinen, priorisoitu havaintolista, omistajat,
korjausten rajaus ja hyväksyntäehdot nykyiseen suunnitelmaan. Vertailuperustana
ovat hyväksytyt ADR:t, [moduulirajat](module-boundaries.md),
[integraatiomatriisi](module-integration-matrix.md) ja
[siivousroadmapin vastuusäännöt](codebase-cleanup-roadmap.md).
Korjaukset tehdään erillisinä katselmoituina paloina; laaja arkkitehtuurimuutos
vaatii edelleen päätöksen. Sovitut ennen julkaisua tarvittavat korjaukset ja
niiden regressiot valmistuvat ennen Deep Scanin ehdokasrevision jäädytystä.

Ajankohta on 0.3.0-toteutuskokonaisuuden jälkeen mutta ennen lopullista
toimitushyväksyntää. Deep Scan on uusi erikseen
käynnistettävä tarkistus täsmälliseen ehdokasrevisioon, ei keskeytetyn ajon
automaattinen jatko tai tämän suunnitelmatyön sivutoimi. Varmista silloin
työkalun saatavuus ja asetukset; päättelytaso ei itsessään todista kattavuutta.

Loppuportti vaatii lisäksi:

- R01-R31- ja S030-01-S030-05-kohtaisen ratkaisun ja todisteen tai
  nimenomaisen omistajan rajauspäätöksen; ei pelkkää ryhmän sulkemista
- uusintaskannauksen havaintojen ja kattavuusaukkojen käsittelyn;
  peruutettua/osittaista tulosta ei kutsuta läpäistyksi täydeksi skannaukseksi
- tuoreet soveltuvat unit-, integration-, API-/sopimus-, system-, web- ja
  Electron-testit sekä ajantasainen riippuvuus- ja toimitusketjutarkistus
- backup/restore-/SQLite-/artifact-/profiili-/process lifecycle -muutoksille
  hardened Windows packaged backup -> inspect -> restore -> restart ->
  compare synteettisellä profiililla; vanha session torjutaan, salaisuudet
  eivät siirry ja muiden yritysten tiedot säilyvät
- erilliset installer/update/rollback-portit sekä tarvittavat keskeytys-,
  fault-, endurance- ja vähintään 30 minuutin soak-ajot nykyisten
  [testausohjeiden](../ai/testing-rules.md) ja omistavien harness-sopimusten mukaan
- käyttäjätestauksen päivitetyt, oikeasti raportoidut tulokset ja muuttuneiden
  polkujen uusinnat; vanhan version hyväksyntä ei siirry automaattisesti
- puhtaan commitin versionoston `0.3.0`:aan
  [versiointiohjeen](release-versioning-policy.md) mukaan, täsmällisen
  release-revision PR/main-portit sekä build-once-artifactin hyväksynnän:
  samoja testattuja tavuja käytetään hyväksyntäkuluttajissa ja toimituksessa.

Jos loppukatselmus muuttaa koodia, regressiot, vaikutusalueen turvatarkistus
ja tarvittavat packaged-portit uusitaan muuttuneelle revisiolle. Vanhan
ehdokkaan raportti ei hyväksy uutta buildia. Versioita ei nosteta jokaisen
työpaketin kohdalla; välijulkaisu vaatii oman päätöksensä.

Pidä tunnukset vakaina. Päivitä tehtävän tila työn edetessä:
`suunniteltu`, `päätös tarvitaan`, `toteutuksessa`, `toteutettu / testaus kesken`
tai `hyväksytty`. Hyväksyntään liitetään turvallinen testiviite ja tieto
siitä, onko muutos mukana toimitetussa julkaisussa. Ei todisteettomia
valmismerkintöjä eikä koko listan kuittaamista yhden testin perusteella.

Uusi toive lisätään joko sovittuun sisältöön, päätettäviin tai myöhempiin
asioihin. Julkaisurajaus muuttuu vain omistajan päätöksellä, ei listan
hiljaisella kasvattamisella tai sovitun yrityspoiston poistamisella.
