# CI:n salattu tutkimusaineisto

## Rajaus

Omistaja hyväksyi rajatun GnuPG/OpenPGP-salauksen testityökaluksi.
Ensimmäinen kuluttaja oli normaali Windowsin `workspace_consumer`.
Omistajan hyväksymä [testiperheiden virheaineisto](#testiperheiden-virheaineisto)
laajentaa samaa salattua toimitusta, ei testialustaa tai pysyvää yksityistä CI:tä.
Tämä sopimus ei koske käyttäjän koneen
mittauksia, sovelluksen tukipakettia, tuotantodataa tai varmuuskopioita.
Työn nykytilan omistaa [M1-suunnitelma](release-0.3.0-m1-preparation-plan.md#salatun-tutkimusaineiston-välitavoite).

Turvallinen julkinen testiraportti säilyy. Raaka-aineisto saa poistua
synteettiseltä CI-runnerilta vain erikseen hyväksytylle julkiselle avaimelle
salattuna. Lyhyt säilytysaika ei itsessään ole tietosuoja. Salausvirheessä
ei lähetetä salaamatonta tiedostoa, kansiota tai lokia varavaihtoehtona.

## Työkalu ja avain

Windowsissa käytetään Git-työkaluketjun GnuPG:tä ja Linuxissa hosted-runnerin
valmiiksi tarjoamaa GnuPG:tä saman eristetyn PowerShell 7 -apurin kautta. Se ei ole uusi
npm-riippuvuus eikä kuulu toimitettavaan EKY-sovellukseen. Käytössä ovat
OpenPGP:n julkisen avaimen salaus ja AES-256; omaa salausformaattia ei
toteuteta. GnuPG on ylläpidetty GPL-3.0-or-later-työkalu. Sen ja Gitin
päivitykset sekä ilmoitetut haavoittuvuudet kuuluvat CI-työkaluketjun
ylläpitoon, vaikka npm-audit ei niitä kata. Runnerilta puuttuva tai
yhteensopimaton työkalu estää salatun aineiston toimituksen, ei salli
automaattista latausta tai salaamattomaan tapaan palaamista.

Windows-apuri valitsee `Get-Command git.exe` -tuloksen ensimmäisen sovelluksen,
samoin kuin workflow'n ennakkotarkistus. Useita PATH-osumia ei käsitellä
yhtenä tiedostopolkuna. Valitun Gitin yhteydestä puuttuva GnuPG hylkää
toimituksen; valintaa ei vaihdeta automaattisesti toiseen Git-asennukseen.
Linuxissa valitaan ensimmäinen `Get-Command gpg` -sovellus; puuttuvaa
työkalua ei asenneta eikä Windowsin MSYS-polkuja käytetä. Linuxin erillinen
avainkoti saa oikeudet `0700`. Molemmat alustat käyttävät samaa avainprofiilia,
salauksen tilavarmennusta, rajattuja putkia ja kokonaismääräaikaa. Apuri ei
käynnistä agenttia tai dirmngriä eikä nouda avaimia verkosta.

Noden omat kryptografiaprimitiivit edellyttäisivät tässä oman siirto- ja
avainformaatin ylläpitoa. Uutta JavaScript-salauskirjastoa ei tarvita, kun
jo Gitin mukana oleva OpenPGP-työkalu rajataan erilliseen testiapuriin.
GnuPG:tä tai sen mukana tulevia kirjastoja ei paketoida EKY-asentimeen.

CI:n avainrengas on uusi ajokohtainen hakemisto. Käyttäjän tavallista
avainrengasta, oletusvastaanottajia tai verkosta haettuja avaimia ei käytetä.
Vastaanottajan koko sormenjälki tarkistetaan; lyhyt key ID ei riitä.
Avain ei ole luottamuksen lähde vain siksi, että se löytyi tiedostosta.
Nykyinen avainprofiili on Ed25519-pääavain ja cv25519-salausaliavain
tai vähintään 3072-bittinen RSA. Myös vanhojen salausaliavainten pitää
täyttää profiili; heikkoon algoritmiin ei siirrytä automaattisesti.
CI-portti käyttää nykyisen profiilin 40-merkkistä isokirjaimista sormenjälkeä.

### Käyttöönotto

1. Luo tätä tehtävää varten erillinen salaukselle sopiva OpenPGP-avain
   paikallisesti. Valitse salasanalla suojattu yksityinen avain. Salasanaa
   ei anneta chattiin, komentoriville, ympäristömuuttujaan tai lokiin.
2. Varmuuskopioi purkuavain turvalliseen yksityiseen säilytykseen. Avain ei
   kuulu repositoryyn, CI-secretiin tai salattavan paketin sisään.
3. Tarkista täysi sormenjälki paikallisesti. Vie vain julkinen avain.
4. Salaa synteettinen näyte samalla apurilla, pura paikallisesti oikealla
   avaimella ja vertaa alkuperäiset tavut. Varmista myös väärän avaimen ja
   muutetun salatekstin hylkäys. Älä avaa tuotantoaineistoa testiksi.
5. Aseta repositorymuuttujat `EKY_DIAGNOSTIC_PUBLIC_KEY` (ASCII-armored
   julkinen avain) ja `EKY_DIAGNOSTIC_KEY_FINGERPRINT` (täysi sormenjälki).
   Aseta vasta onnistuneen purkutestin jälkeen
   `EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT` samaksi sormenjäljeksi.

Käyttöönotossa käytetään erillistä avainkotia repositoryn ja buildin
ulkopuolella, ei ylläpitäjän oletusavainrengasta. Manuaalisessa vaihtoehdossa
GnuPG:n Pinentry vastaanottaa salasanan suoraan. Omistajan erikseen
hyväksymässä paikallisessa automaatiovaihtoehdossa kryptografisesti satunnainen
salasana säilytetään Windowsin käyttäjäkohtaisella DPAPI-salauksella,
rajatuilla tiedosto-oikeuksilla. Luotettu paikallinen apuri purkaa sen vain
muistiin ja syöttää GnuPG:lle prosessin yksityisen stdin-putken kautta,
ei komentorivin, ympäristömuuttujan tai salaamattoman välitiedoston kautta.
Tämä poikkeus ei anna CI:lle purkuavainta tai salasanaa eikä muuta
sovelluksen salaisuuksien hallintaa. Samalla Windows-tilillä toimiva ohjelma
voi käyttää DPAPI-suojattua arvoa; se ei suojaa kaapatulta käyttäjäistunnolta.
Palautussalasana näytetään vain paikallisesti ja säilytetään erillään
suojatusta avainvarmuuskopiosta. DPAPI-tiedosto ei korvaa siirrettävää
avaimen varmuuskopiota ja palautussalasanaa.

Tarkista sekä pääavaimen että salausaliavaimen salasanansuojaus ja pura
näyte tyhjennetyn salasanavälimuistin jälkeen. Varmuuskopion vienti ja varmuuskopiosta
palauttamisen koe ovat eri todisteita. Pelkkää vientiä ei merkitä
palautuskokeeksi. GitHub saa vasta käyttöönoton jälkeen vain julkisen avaimen.

Viimeinen muuttuja on ylläpitäjän vahvistus tehdystä kokeesta, ei itsenäinen
kryptografinen todistus avaimen hallinnasta. Muuttujien kirjoittajalla on
luottamusvastuu. Avaimen vaihdossa poista vahvistus ensin ja tee purkukoe
uudelleen. Tyhjä vahvistus poistaa keräyksen käytöstä. Fork-PR ei käynnistä
tätä valinnaista keräystä. Työnkulun luotettavuus on edelleen tärkeää:
salaus ei suojaa haitallisen työnkulun tahalliselta raakajulkaisulta.

## Testiperheiden virheaineisto

`ciFailureEvidence.mjs` käyttää workspace-keräimen nykyistä varmennettua
tiedostokopiointia, gzip/JSON-kuorta ja OpenPGP-apuria. Se ei käynnistä tai
pysäytä testiprosesseja, tulkitse testiä hyväksytyksi eikä korvaa T3:n tai
V2:n prosessiomistajuutta. Windowsin ja Linuxin normaaliin testijobiin kytketään yksi
virheen jälkeinen keräys samalla julkisen avaimen vahvistuksella ja
fork-PR-estolla. Kytkentä ei riipu epäonnistuneen testitapauksen nimestä.
Uuden normaalin Windows- tai Linux-testijobin on käytettävä samaa jälkiaskeletta;
workflow-regressio tarkistaa kattavuuden. Käyttöönotto vaatii kyseisen alustan
hosted-toimituksen ja paikallisen purun todistuksen, ei vain toisen alustan
läpäisyä. Keräys sallitaan vain alustan kanssa täsmäävällä `RUNNER_OS`-arvolla
GitHubin hosted-ajossa. Tavalliset push-, schedule- ja workflow_dispatch-ajot
sekä saman repositoryn PR sallitaan; fork-PR ja `pull_request_target` estetään.
Luokittelu-, koonti- ja riippuvuusauditointijobit eivät tuota tämän sopimuksen
raakaa testiaineistoa eivätkä saa yleistä koko jobin tulostekaappausta.

| Lähde | Kerättävä sisältö | Rajaus |
| --- | --- | --- |
| Node- ja Vitest-testit | Yhteisen reporter-liitännän rajattu alkuperäinen poikkeus, kutsupino, syyketju ja testin sijainti sekä toimituksen yhteenveto. | Ei ohitettujen tai odotetusti hylättyjen testien poikkeuksia. Kytkentä on omistavissa testikomennoissa; riippuvuuksien valmisteluvirhe ei ole testitapaus. |
| Playwrightin välitön virheote | Nykyinen turvallinen reporter tallentaa odottamattoman testituloksen ja runner-virheen niiden saapuessa, ennen koko ajon JSON-raportin valmistumista. | Sama yhteinen projektio kuin Node/Vitestissä. Jokaisen retry-yrityksen virhe säilyy erikseen; onnistunut uusinta ei korvaa ensivirhettä. |
| Playwright system/web/Electron | Ajokohtaisen `results.private.json`-raportin virheet, testitulokset, stdout/stderr ja retry-yritykset. | Ennen salausta poistetaan konfiguraatio, metadata ja inline-liitteiden sisältö; alkuperäiset virhekentät säilyvät. Ei koko HTML-/attachment-hakemistoa tai siinä olevia SQLite-tiedostoja. Ennen runnerin raportin valmistumista katkennut ajo voi jäädä ilman tätä tiedostoa. |
| Backend/web/Electron-fixture | Nykyisten redaktoitujen stdout/stderr-lukijoiden rajattu otos omassa suoritusyrityskohtaisessa tiedostossaan myös testin rungon tai siivouksen epäonnistuessa. | Otos säilyy ennen muistitiedon katoamista, tiedosto liitetään nykyisen fixturen jälkiraportoinnissa. Windows-Electronin lähde on natiivi omistajaprosessi; workloadin omaa putkea ei muuteta tällä työllä. Käynnistyksen tai siivouksen kriittiselle polulle ei lisätä tiedostokuittausta. |
| Electronin lifecycle-todiste | Fixturen jo kirjoittama `test-results/run-<uuid>/<testin suoritusyritys>/electron-lifecycle.json` muuttamattomina tavuina. | Vain tämä täsmällinen nimi ja syvyys; ei yleistä JSON- tai liitekansion keräystä. `attempt`, käynnistyssukupolvet, `publicCloseFailure`, `ownership` ja `cleanup` säilyvät erillisinä havaintoina. Samat koko-, linkki- ja muuttumattomuusrajat kuin muilla lähteillä. |
| Native-komennot ja supervisorin sopimustestit | Nimetyt vaihe-, worker- ja caller-tulokset sekä olemassa olevat yksityiset prosessitulosteet. | Ei request/config-tiedostoja, profiileja tai tietokantoja. Siivouksen raakatulos säilyy erillään alkuperäisestä hylkäyksestä. Tarkoituksella lukemattoman putken koe säilyttää oman sopimuksensa. |
| Historical-legacy-käynnistyksen syyote | Legacy-komennon `fixtureCleanup/legacy-startup-terminal.json`-tiedostosta vain varmennettu ajosidonta ja `startupEvidence`-projektio. | Nykyinen terminal-kirjoitus säilyttää otteen ennen profiilin poistoa. Ei koko operational-lokia, profiilia, tietokantaa tai terminalin muuta sisältöä. Syykoodit ja vaiheet eivät tule julkiseen testitulosteeseen. |
| Synteettinen MSI-versiopolitiikan koe | Oman supervisor-testijuuren `policy-result.json` sekä numeroidut `source`, `target` ja `uninstall` -MSI-lokit muuttamattomina tavuina. | Vain suoraan testijuuren alla olevat nimet; ei descriptor-, request-, profiili- tai tietokantatiedostoja. Keskeytyneen MSI-komennon osittainen loki voidaan säilyttää ilman workerin lopputulosta. Samat koko-, linkki- ja muuttumattomuusrajat kuin muilla lähteillä. |
| Synteettisen workspace-päivityksen kohdeasennin | Täsmällinen `target-installer.private.log` ja sen ajosidonnan, koon ja tiivisteen sisältävä säilytyskuitti. | Vain markerilla ja nykyisellä proof-konfiguraatiolla hyväksytty source-handoff; Microsoftin `/L*v`, ei globaalia lokitusta tai käyttöliittymätilan muutosta. Enintään 64 MiB salattuun pakettiin; rajaa suurempaa tiedostoa ei julkaista osittaisena. |
| Testin omistaman MSI-asiakkaan odotusikkuna | Otsikko, tavallinen ilmoitusteksti, painikkeen teksti ja enabled-tila sekä havainnon saatavuus. | Vain nykyisen skenaarion Jobin elävä järjestelmän `msiexec.exe` samassa istunnossa. Ei muiden sovellusten ikkunoita, lomakekenttiä, kuvakaappauksia tai automaattisia käyttöliittymätoimia. Tarkka rajaus alla. |
| Packaged smoke | Rajattu prosessituloste, nykyinen smoke-tulos ja erikseen aktivoidun synteettisen käynnistyksen ensimmäinen alkuperäinen poikkeus ennen yleiseksi koodiksi muuntamista. | Poikkeus sidotaan ASAR-paketin build-identiteettiin, nonceen ja runtimeen. Epäonnistuneen testin juurta ei poisteta; keräin ei lue sen profiilia. Tyhjentynyt tuloste ei todista onnistunutta käynnistystä. |
| Muut komennot ja valmistelu | Nykyinen turvallinen GitHub-komentoloki. | Salattu keräys ei palauta tulostetta, jota aliohjelma ei tuottanut tai säilyttänyt. Riippuvuustyökalun raakavirheet jäävät erikseen rajatuiksi pois. |

### Asentimen rajattu ikkunahavainto

Omistajan hyväksymä lisäys käyttää nykyistä `WorkspaceMsiActivityObservation`-
kyselyä, ei uutta havaitsijaprosessia. Vain täsmälliseen järjestelmäasentimeen
kuuluva, elävä ja nykyisen Jobin omistama prosessi kelpaa. Kahva pidetään
auki, ja ikkunan PID, säie, näkyvyys ja sallittu luokka tarkistetaan tekstin
lukemisen molemmin puolin. Epävarma tai poistunut omistaja ei anna tekstiä.
Luetaan sallittu otsikko sekä Static- ja Button-kontrollien teksti.
Omistajan hyväksymä jatko sallii lisäksi vain tunnistetun, vastausta odottavan
sovellusten sulkemisilmoituksen suoran ListBox-lapsen sovellusnimet.
Ilmoituksen nykyiset suomen- ja englanninkieliset tekstit ovat täsmällinen
sallintalista; tuntematon ilmoitus ei laajenna keräystä. Muut listat sekä
Edit-, RichEdit-, salasana- ja mukautetut syötekontrollit jäävät pois.
Mitään ei paineta, valita, suljeta tai vahvisteta.

Listan teksti luetaan Windowsin omalla UI Automation 2 -rajapinnalla
samassa valinnaisessa kyselyssä, ilman uutta prosessia tai riippuvuutta.
Suoraa `LB_GETTEXT`-puskurilukua ei käytetä: sen tulospuskurilla ei ole
kapasiteettiparametria. Luku alkaa vain jo varmennetusta ListBox-kahvasta;
työpöydän automaatiopuuta ei haeta. Listan ja suorien listamerkintöjen
prosessitunnus ja kontrollityyppi varmennetaan. Tallennettu sovellusnimi ei
yksin todista tiedostoja käyttävän prosessin identiteettiä.

Yhteinen `msiWindowObservationContract.json` omistaa C#-tuottajan ja
JavaScript-lukijan rajat. Nykyiseen 60 sekunnin näyteväliin ja 128 näytteen
rajaan kuuluvat enintään 32 asiakasta, 32 ikkunatekstiä, 1 024 merkkiä
tekstille ja yhteensä 4 096 merkkiä näytteelle. Yksi viestikysely saa enintään
100 ms ja koko tekstinäytteen työbudjetti on 1 000 ms. Listan providerin
yhteys- ja vastausodotukselle asetetaan samat 100 ms:n rajat, ja omistajuus
sekä työbudjetti tarkistetaan lukujen välissä. Nämä eivät ole lupaus kaikkien
Windows-/COM-kutsujen tai tiedostokirjoituksen pakkokatkaisusta: nykyinen
terminal/cleanup ei odota valinnaista kyselyä. Nämä ovat havainnon rajoja,
eivät testin tai asennuksen uusia aikarajoja. Osittainen havainto säilyttää
osittaisuutensa; tyhjä lista ei todista odotuksen syytä tai kaikkien
mahdollisten ikkunoiden poissaoloa.

Luetteloluvun sopimustesti säilyttää ensimmäisen hylkäyksen vaiheen,
suljetun syyluokan ja mahdollisen alkuperäisen HRESULT-arvon nykyisessä
yksityisessä native-virhekuitissaan. Budjetin loppuminen, omistajuus- tai
ilmoitusvalinnan muuttuminen, ominaisuuden ristiriita ja providerin poikkeus
eivät muutu samaksi päätelmäksi. Kuitti ei sisällä uutta ikkunatekstiä tai
prosessitunnistetta eikä muuta julkista raporttia tai asennuksen hyväksyntää.
Sopimustestin tarkoituksellinen hylkäys varmennetaan myös nykyisen
salaus- ja purkuketjun yli; puuttuvaa havaintoa ei täytetä arvatulla syyllä.

Serialisointi ja tiedostokirjoitus kuuluvat samaan olemassa olevaan yhteen
taustakyselyyn. Terminal- tai cleanup-polku ei odota niiden valmistumista.
Jokainen enintään 64 KiB:n valmis näyte julkaistaan yksinomaisesti omana
`scenario/msi-window-NNN.private.json`-tiedostonaan. Keskeneräinen `.pending`
ei kelpaa keräykseen, eikä aiempaa näytettä korvata. Hakemistokahvat estävät
vanhempien vaihdon ja reparse-muutoksen kirjoituksen aikana. Lopullinen
tiedosto luodaan yksinomaisesti ilman lukijoiden jako-oikeutta; sitä ei
nimetä uudelleen lukittujen vanhempien alta. Pakkokatkaisun jättämä vajaa
JSON hylätään keräimen tiukassa rakennevalidoinnissa. Julkinen
`msiWindowEvidence` kertoo vain toimituksen tilan, ei tekstejä tai PID:itä.

Keräin varmentaa run/attempt/job/SHA-sidonnan, järjestysnumeron ja vieressä
olevan requestin noncen, skenaarion, descriptor-tiivisteen sekä omistetun
hakemiston. Temp-juuren konfiguroitu nimiesitys hyväksytään vain saman
kanonisen lähdejuuren vaihtoehtona; lapsikansioiden, tiedostojen ja vieraan
juuren aliaksia ei hyväksytä tällä perusteella. Requestia, komentoa tai
argumentteja ei sisällytetä pakettiin.
Alkuperäiset virheet ja uudet odotushavainnot käsitellään ennen toistuvia
supervisor-kuittauksia myös kilpailevien testikansioiden välillä. Luettelo
etsitään nykyisen lähteen syvyys- ja merkintärajan sisällä. Lähteen nykyisestä
viiden sekunnin ajasta etsintä käyttää enintään puolet, jotta jo löytyneen
aineiston talteenotolle jää aikaa. Keskeneräinen tiedostojärjestelmäkutsu voi
silti ylittää havainnointirajan; kyse ei ole käyttöjärjestelmäkutsun katkaisusta.
Lähdekohtaiset ja kokonaisbudjetit säilyvät ja
rajoittuminen ilmoitetaan edelleen. Tavallisten asenninlokien etusijaa ei
muuteta. Vain salattu nykyinen toimitus sallitaan yhden vuorokauden
säilytyksellä. Katkennut runner voi yhä estää toimituksen.

Nykyinen Windows-supervisorin sopimussarja todentaa oikeilla omistetuilla
testiprosesseilla myös ulkopuolisen Jobin, piilotetun ikkunan, vastaamattoman
ikkunan ja listaproviderin, väärän ilmoituksen/listan ja syötekentän
poissulkemisen, listan kokorajat sekä keskeytyneen julkaisun. Sama sarja
todentaa ilmoituksen sovellusnimen keräimestä oikean OpenPGP-salauksen
ja testiavainpurun läpi prosessien poistuttua. Se ei asenna MSI:tä tai
korvaa varsinaista Windows-asennuskokeen näyttöä.
Positiivinen luettelokoe ottaa ensin yhden kylmän valmistelunäytteen.
Täydellisen näytteen lisäksi valmistelussa hyväksytään vain tarkasti
`listProcessId/budgetExpired` ilman HRESULT-arvoa, kun nykyinen työbudjetti
on täyttynyt, tai `providerException` ja täsmällinen `0x80131505`-aikakatkaisu
`elementFromHandle`- tai `firstChild`-vaiheessa. Molemmissa otsikko,
ilmoitus ja painike löytyvät, sovellusnimiä ei ole ja omistettu prosessi on
edelleen todistetusti elossa. Muut osittaiset tulokset ja virheet
hylätään. Sen jälkeen otetaan täsmälleen yksi täydellisen luettelon vaativa
näyte samoilla rajoilla. Kolmatta näytettä, uusintasilmukkaa tai pidempää
budjettia ei ole. Tämä todentaa valmistellun providerin täydellisen luvun,
ei takaa ensimmäisen kylmän luvun täydellisyyttä. Kylmä näyte säilyy omalla
tilallaan salatun koetiedoston ensimmäisenä asiakkaana, mitattu näyte toisena.
Valmistelun suljettu syy säilyy fixturen yksityisessä tarkistusraportissa;
mitatun näytteen hylkäys liittää sen myös nykyiseen yksityiseen virhekuittiin.
Näytteen hylkäys säilyttää nykyisessä yksityisessä stderrissä
suljetun tulosluokan, odotettujen tekstiroolien löytymisen, keruun keston
sekä erilliset keruun jälkeiset prosessin poistumis- ja omistajuushavainnot.
Epäonnistuva lisäkysely ei peitä alkuperäistä hylkäystä. Hallittu native-virhe
todentaa saman merkinnän ja kutsupinon nykyisen tulostekeräyksen sekä oikean
OpenPGP-salauksen ja purun läpi; nämä havainnot eivät yksin nimeä Windowsin
sisäistä juurisyytä.
Skeema 2 nimeää listamerkinnän `application`-rooliksi; vanhan skeeman 1
rajattu luku säilyy, mutta se ei hyväksy tätä uutta roolia.

Skeema 3 lisää samaan näytteeseen valinnaisen `resources`-havainnon.
Nykyinen taustakysely käyttää Windowsin Restart Manageria vain testin
omistaman, sovellusten sulkemista pyytävän MSI-ilmoituksen yhteydessä.
Rekisteröitävät tiedostopolut tulevat lähdepaketin hyväksytyn inventaarion
samasta läpikäynnistä. Yksinomaisesti luotu yksityinen valintatiedosto
sidotaan skenaarioon, nonceen, descriptor-tiivisteeseen ja lähdeinventaarion
identiteettiin. Lukija vaatii täsmällisen asennusjuuren, rajatut suhteelliset
polut, tavalliset tiedostot ja reparse-vapaat esi-isät. Valintatiedostoa tai
sen polkuja ei kopioida virhepakettiin. Valinnan julkaisu ei ole skenaarion
hyväksymisehto eikä sitä odoteta siivouksessa.
Kiinteän callerin composition välittää supervisorin vaihehakemiston
worker-runtimen julkaisuun erikseen: materialisoidun työskentelykansion ja
native-supervisorin request/result-hakemiston ei oleteta olevan samat.

Vain tiedostot rekisteröidään; prosesseja ja palveluja ei rekisteröidä eikä
Restart Managerin sulkemis- tai käynnistystoimintoja käytetä. Näytteeseen
tulevat suljettu vaihe ja kattavuustila, alkuperäinen native-koodi,
erillinen session sulkukoodi, valinnan identiteetti ja määrä sekä enintään
32 prosessin PID, creation FILETIME ja `ownedJob`/`outsideJob`/`unknown`.
Jäsenyys tarkistetaan elävän prosessikahvan samalla PID-/aloitusaikasidonnalla
luvun molemmin puolin. Poistuminen tai identiteettiristiriita jää tuntemattomaksi.
Koko- ja näyterajat sekä julkiset tulosteluokat säilyvät; skeemojen 1 ja 2
tiukka lukutuki säilyy.

Tämä on nykyhetken havainto rekisteröidyistä tiedostoista. Se ei todista
MSI:n aiemman ilmoituksen estäjää, kaikkien lukkojen poissaoloa tai Jobin
jäsenen roolia sovelluksen pääprosessina. Polkujen tyyppi- ja rajatarkistukset
ovat hetkittäisiä; havainto ei ole jatkuvan tiedostoidentiteetin tai
sisältötavujen muuttumattomuuden valtuus. Tarkistus ei pidä asennustiedostoja
lukittuina MSI:n korvausoperaatioita vastaan. Puuttuva, muuttunut tai
epävarma valinta ja rajautunut kysely säilyttävät oman tilansa. Native-kutsun
viive ei siirry terminal-/cleanup-odotukseen: sama yksi valinnainen
taustakysely ja nykyinen ulompi prosessiraja omistavat sen elinkaaren.
Regressiot todentavat valinnan rajat, identiteetin vaihtumisen, keskeytyksen
sekä todellisen keräys-, salaus- ja purkuketjun. Havainnon onnistuminen
ei hyväksy asennusskenaariota tai korjaa historiallista timeoutia.

Nykyinen `packaged-boundary-diagnostic` käyttää samaa valinnaista salattua
jälkikeräystä epäonnistuneessa tai perutussa `legacy`- ja `workspace`-kokeessa.
Tämä ei käynnistä ulkoista jälkitallennusta, muuta hyväksyntää tai laajenna
muiden koeperheiden keräystä. Onnistunut koe ei tämän perusteella lähetä
raakahavaintoja.

### Yhteinen alkuperäisen testivirheen liitäntä

`test-reporters/` käyttää nykyisen `startupExceptionEvidence.ts`:n rajattua
poikkeusprojektiota. Se ei ole uusi testiruntime tai yleinen lokipalvelu.
Node- ja Vitest-komennot sekä nykyinen Playwright-reporter ottavat sen
käyttöön oletuksena. Native-harnessin clean-, upgrade-, legacy-, workspace-
ja MSI-policy-workerit sekä niiden command-phase-virherajat tarjoavat
poikkeuksen samalle liitännälle ennen suljettua virhekoodimuunnosta.
Sisäisen palvelun aiemmin korvaamaa
poikkeusta ei voi palauttaa reporterissa: kyseisen rajan omistaja säilyttää
alkuperäisen syyn ennen muunnosta. Rajattu sovelluskytkentä toimii vain
nykyisellä synteettisen käynnistyksen opt-in-valtuudella.

D2:n brokerin synteettinen fixture käyttää samaa liitäntää todellisen
viestinkäsittelijän `captureOriginalException`-kohdasta ennen koodimuunnosta.
Fixture säilyttää ensimmäisen syyn muistissa ja toimittaa sen vain
odottamattomasta testihylkäyksestä; tunnetut testisalaisuudet peitetään.
Tuotantoprofiilin observer ei saa tätä callbackia. Rajan koe vertaa myös
kytkemätöntä kontrollia ja todentaa, ettei pelkkä myöhempi assertion sisällä
alkuperäistä syytä. Salauskoe tarkistaa puretut tavut, tiivisteet, syyketjun
ja testiyrityksen sidonnan. Tämä ei ole väite hosted-ajon latauksesta tai
kaikkien alempien adapterien virheiden kattavuudesta.

Electronin migraatioaktivoinnin testivalmistelu säilyttää mainin alkuperäisen
sulkuvirheen tunnetun vaiheen ja syyluokan testikohtaisen virheen viestissä.
Ne luetaan elinkaaren omistamasta suljetusta sopimuksesta ennen Playwrightin
virhesiirtoa, joka ei säilytä rakenteista `cause`-oliota. Muut syyolion
kentät ja tuntemattomat syyt eivät muutu päätellyiksi tiedoiksi. Nykyinen
reporter ja salattu keräys käsittelevät tämän viestin; uutta kirjoitinta,
tiedostolajia tai odotusta ei lisätä. Viestisiirron rajattu kontrollikoe
vertaa vanhaa yleisvirhettä uuteen syyluokkaan ja tarkistaa puretun paketin.
Se ei yksin ole oikean Electron-prosessirajan tai hosted-toimituksen todistus
eikä osoita sulkuvirheen juurisyytä korjatuksi.

Yksityiset otteet ovat käyttöjärjestelmän temp-juuren
`eky-test-errors-<invocation UUID>/`-kansiossa. Yksi invokaatio tallentaa
enintään 128 otetta, kukin enintään 192 KiB ja nykyisten viesti-/pino-/syyketju-
rajojen sisällä. Otteen tiedostonimessä oleva järjestysnumero varmennetaan
sen sisällöstä. Keräys ottaa saman invokaation toimitusyhteenvedon ensin ja
sitten otteet syntyjärjestyksessä, jotta myöhemmät virheet eivät syrjäytä
ensivirhettä lähdekohtaisen tiedostorajan täyttyessä. Toimitusyhteenveto
ilmoittaa hylätyt ja pois rajatut otteet.
Keräimen nykyiset tiedostomäärä-, kokonaiskoko- ja lähdekohtaiset rajat
säilyvät; niiden täyttyminen näkyy osittaisena aineistona. Kattavuutta ei
päätellä pelkästä salatun tiedoston syntymisestä.

CI-ote sidotaan nykyiseen run/attempt/job/SHA-arvoon ja yksilölliseen
invokaatioon. Erikseen annettu matrix-jobKey tarkistetaan; ennen sen
asettamista syntynyt ote käyttää saman jobin tunnistetta. Paikallisella
ajolla on erillinen `local`-sidonta, jota CI-keräin ei hyväksy. Tunnetut
salaisuudet peitetään eikä poikkeuksen muita kenttiä kopioida. Julkiset
reporterit eivät saa uusia raakavirhekenttiä. Node/Vitestin aikaisempi
normaali konsoliraportti säilyy; salattu ote ei anna lupaa lisätä sinne
salaisuuksia tai oikeaa käyttäjädataa.

Kirjoitus käynnistyy virheen havaitsemisesta. Raportoinnin lopussa käytetään
nykyistä enintään 500 ms:n rajattua toimitusodotusta, ei kiinteää viivettä.
Tallennusvirhe ei muuta testitulosta tai korvaa siivousta; julkinen varoitus
sisältää vain toimituksen tilan ja lukumäärät. Puuttuva loppuyhteenveto voi
tarkoittaa keskeytystä. Prosessin pakkopysäytys tai runnerin menetys voi
estää otteen tai salatun liitteen valmistumisen kokonaan.

Uusi testi käyttää nykyistä omistavaa testikomentoa ja fixtureä, ei omaa
keräintä. Kytkentäregressio tarkistaa Node/Vitest-komennot ja nykyiset
workflow-kutsut. Salausregressio käynnistää oikean epäonnistuvan Node-,
Vitest- ja Playwright-testin sekä native-lifecycle-kokeen ilman MSI-asennusta,
kerää otteen ja tarkistaa alkuperäisen syyn oikeasti puretusta OpenPGP-
paketista. Native-koe kulkee todellisen command-phase/worker-liitännän
kautta. Packaged-ketjun koe käyttää oikeaa ASAR-build-identiteettiä ja
erillistä prosessia; se ei korvaa oikean Electron-paketin hyväksyntäajoa.
Nämä asennettuja testityökaluja tarvitsevat kokeet ovat tiedostossa
`originalFailureEvidenceOpenPgp.test.mjs` ja nykyisessä
`installer:test:encrypted-evidence`-komennossa riippuvuuksien valmistelun
jälkeen. Aiempi `encryptedEvidenceOpenPgp.test.mjs` säilyy ilman projektin
kolmannen osapuolen paketteja ajettavana Linuxin toimituskokeena; samaa
testiavainapuria käytetään molemmissa sarjoissa.

Workspace-kohdeasentimen lokipaikka varataan yksinomaan testin oman
proof-juuren `result`-kansiosta. Tavallinen sovellus ei valitse lokipaikkaa.
Nykyinen rajattu `fixtureCleanup` kopioi lokin caller-kansioon vasta
omistetun prosessipuun poistumisen jälkeen, ennen testikansion poistamista.
Caller-sidonta, invokaatio, alkuperäiset tavut ja säilytyskuitti varmennetaan
uudelleen keräyksessä. Epävarma kopiointi säilyttää alkuperäisen testiaineiston;
loki ei todista asennuksen tai siivouksen onnistumista. Historiallisessa
testipaketissa lokin puuttuminen sallitaan erillisenä havaintona.
Hallittu skenaarion katkaisu katetaan oikean prosessiketjun regressiolla.
Jos koko runner lakkaa toimimasta ennen jälkivaiheita, paikallisesti säilynyt
loki ei takaa salatun liitteen toimitusta. Raakalokia ei tulosteta eikä
lähetetä salaamattomana edes toimitusvirheessä. MSI:n oma lokikirjoitus
voi muuttaa ajoitusta, joten kokeen läpäisy ei yksin todista vanhaa timeoutia
korjatuksi.

Kohdeasentimen yhteinen 64 MiB:n raja koskee ennen fixture-poistoa tehtävää
säilytyskopiota sekä workspace- ja yleistä virhekeräystä. Se on omistajan
hyväksymä tutkimusaineiston budjetti, ei Windowsin tai GitHubin kokovaatimus.
Alkuperäinen yleisestä keräysrajasta lainattu 8 MiB ei riittänyt todellisessa
kokeessa; tarkkaa hylätyn lokin kokoa ei säilynyt. Suurempi budjetti ei takaa
kaikkien mahdollisten lokien mahtumista. Ylitys säilyttää alkuperäisen
testiaineiston ja ilmoitetaan hylkäyksenä. Omistajan myöhempi päätös nosti
myös muiden säilytettävien lokien ja raporttien budjettia alla kuvatusti.
Pienten sidonta- ja ohjaustiedostojen rajoja ei muuteta lokibudjetin perusteella.

Nykyisen workspace-työnkulun manuaalinen `artifact_only=true` valmistaa
synteettisen paketin ja ajaa sen valmistelusopimukset ilman MSI-kuluttajia.
Oletus on `false`, eikä reusable-työnkulku tarjoa tätä valintaa normaalille
PR/main-hyväksynnälle. Pelkkä valmistelu ei ole palautuksen hyväksyntä;
erikseen nimetty koe käyttää saman jäädytetyn revision pakettia ja sidontoja.

K:n nimetyn `linux-inspection-sandbox-probe`-kertakokeen omistaja hyväksyi
erikseen tarkistusajurin käännösvirheen rajatun poikkeuksen. Vain kyseisen
operaation omasta, identiteetillä sidotusta `build.private.log`-tiedostosta
luetaan enintään 64 KiB. Suuresta lokista säilyvät alku- ja loppuosat sekä
osittaisuuden tieto; puuttuvaa tai varmentamatonta lokia ei tulkita ehjäksi.
Ote kirjoitetaan vain nykyiseen valmistelun `process-output.private.json`-
tiedostoon ja salataan. Julkinen syykoodi ja stderr säilyvät ennallaan.
`boundedNativeBuildFailure`-manifestimerkintä koskee vain tätä nimettyä
job/job-key-paria sekä alla erikseen hyväksyttyä Windows-valmistelua.
Muissa jobeissa riippuvuustyökalujen raakalokikielto säilyy.
Poikkeus ei avaa native-temp-juuren, lähteiden, konfiguraation, profiilien tai
tietokantojen yleistä keräystä eikä muuta yhden vuorokauden säilytystä.

Omistajan erillinen Windows-rajaus koskee vain inspector-native-ajurin
epäonnistunutta käännöstä Electron E2E:n valmistelussa, job/job-key-parissa
`e2e-electron-windows-critical` / `core-electron-0`. Nykyinen valmistelija
varaa oman build-juuren ennen kutsua; loki luetaan vasta kääntäjäkutsun
päättymisen jälkeen. Jaettu lukija säilyttää enintään 64 KiB alku-/loppuosina
ja varmentaa tavalliset tiedostot sekä tarkat tiedostoidentiteetit ennen
lukua ja sen jälkeen. Linuxin käyttäjä-/oikeustarkistukset säilyvät;
Windowsin tarkistus ei oleta Linuxin UID- tai oikeusbittien olemassaoloa.
Ote säilyy vain nykyisessä `test-results/run-<invocation UUID>/preparation/`
`process-output.private.json`-tiedostossa. Tiukka receipt sitoo sen nykyiseen
run/attempt/job/job-key/SHA-arvoon ja kansion invokaatioon. Keräin hylkää
vieraan sidonnan, lisäkentät ja virheellisen koko-/base64-sopimuksen.
`missing` ja `unverified` eivät ole täydellistä aineistoa. Onnistuminen tai
muu valmisteluvirhe ei kerää käännöstulostetta. Valinnainen tallennus ei
korvaa alkuperäistä valmisteluvirhettä tai muuta julkista syykoodia.
Tämä ei ole koko riippuvuustyökalun, ympäristön tai build-juuren keräyslupa.
Valmistelija -> keräin -> OpenPGP -> erillisen testiavainkodin purku
todennetaan nykyisessä `encryptedEvidenceOpenPgp.test.mjs`-sarjassa ilman MSI:tä.

Jokainen paketti sidotaan run/attempt/job/matrix-revisioon. Testitapaus ja
sen retry sekä käynnistyssukupolvi säilyvät lähderaporteissa. Uusi paketti
ei kirjoita aiemman päälle. Keräys käsittelee sekä runnerin että natiivin
käyttöjärjestelmän temp-juuren, jotka eivät välttämättä ole sama hakemisto.
Vain tunnettujen testiraporttien nimialueet tutkitaan. Tiedostolinkit,
uudelleenohjaukset ja muuttuneet tiedostot hylätään.
Playwright-raportin projektio merkitään manifestiin: alkuperäisen lähteen
tiiviste ja salattavan projektion tiiviste eivät ole sama todiste.
Legacy-syyotteen manifesti erottaa samalla tavalla alkuperäisen
terminal-tiedoston tiivisteen ja salattavan projektion tiivisteen.
Muiden sallittujen tiedostojen tavut säilyvät muuttamattomina.
Packaged-legacy-palautus käyttää samoja `eky-desktop-smoke/<token>`-juuren
nimettyjä tulos- ja prosessitulostetiedostoja. Keräyksen regressio varmistaa
niiden säilymisen myös OS-native-temp-juuresta; `legacy-input`-backup,
identiteetti, vertailutila ja käyttäjäprofiili jäävät pois. Tämä ei lisää
uutta kerättävää tiedostolajia tai laajenna julkaisurajaa.
Electronin lifecycle-tiedosto kerätään omana lähteenään, koska raportin
inline-liitteiden sisältö poistetaan edelleen. Keräin ei päättele julkisen
sulkukutsun aikakatkaisusta prosessipuun tilaa eikä muuta cleanup-hylkäystä
hyväksynnäksi omistajatodisteen perusteella. Puuttuva tai kesken jäänyt
lifecycle-tiedosto ei synny keräyksessä uudelleen; julkisen raportin rajattu
projektio ei korvaa sen puuttuvia kenttiä.
Nykyinen fixture kirjoittaa lifecycle-tiedoston epäonnistuessaan tai
ensikäynnistystodisteen yhteydessä. Tavallinen läpäissyt testi ei siis
välttämättä tuota sitä. Keräys säilyttää vain tiedostossa olevat kentät;
puuttuvaa käynnistyssukupolvea tai omistajan lopputilaa ei päätellä.

### Legacy-käynnistyksen rajattu syyote

Nykyinen legacy-komennon omistaja lukee vain oman eristetyn
testikäynnistyksen desktop-lokin sen jälkeen, kun skenaarion olemassa oleva
supervisor-tulos todistaa prosessipuun poissaolon. Enintään kaksi
`desktop.bootstrapFailed`-tapahtumaa sidotaan skenaarion `runNonce`-arvoon,
artifact-descriptorin tiivisteeseen ja odotettuun kohdeversion build-revisioon.
Tapahtuman oma `runtimeInstanceId`, `eventId` ja UTC-aika säilyvät; ensimmäisen
tai toisen käynnistyksen järjestystä ei arvata aikaleimasta.

Ote sisältää vain nämä sidontakentät, syntaktisesti rajatun
`[A-Z][A-Z0-9_]{0,127}`-syykoodin, nykyisen sovelluskirjoittajan vaiheen
(`preWorkspaceBuildAdmission`, `workspaceFirstStartMigration` tai `startup`)
ja syytiedon saatavuuden. Virheviesti, pino, mielivaltainen payload ja
liiketoimintatunnisteet jäävät pois. Koodi on lokikirjoittajan tallentama
havainto, ei keräimen todistama juurisyy eikä uusi julkinen virhekoodiluettelo.

#### Hyväksytty alkuperäisen poikkeuksen rajaus

Erillisellä omistajapäätöksellä synteettisen Electron-käynnistyksen ensimmäinen
alkuperäinen poikkeus voidaan liittää samaan salattuun terminal-projektioon.
Tämä ei muuta production operational -lokin, Diagnosticsin tai tukipaketin
skeemaa. Opt-in vaatii nimetyn testikytkimen, skenaarion nonce-arvon,
odotetun build-identiteetin kontrollin ja täsmälleen johdetun eristetyn
testiprofiilin. Tavallinen käyttäjäprofiili ei voi aktivoida keräystä.

`startupExceptionEvidence.ts` omistaa rajat ja skeeman: viesti 2 048 merkkiä,
pino 8 192 merkkiä, enintään neljä syyketjun osaa ja 192 KiB tiedostoraja.
Muut poikkeuksen kentät, mielivaltaiset getterit, ympäristö, profiili,
tietokanta ja business-payload eivät kuulu otteeseen. Session-salaisuus ja
tunnetut ympäristösalaisuudet redaktoidaan; redaktion käsittelyrajan ylitys
peittää tekstin, ei päästä salaisuutta läpi. Native stack -accessor tunnistetaan
erikseen Noden nykyisen toteutuksen perusteella.

Poikkeus tarjotaan havaitsijalle ennen siivousta tai yleiseksi koodiksi
muuntamista. Ensimmäistä otetta ei korvata myöhemmällä fallbackilla.
Migraatiota edeltävän päätöksen kohdalla sekä ensimmäisen käynnistyksen
koordinaattori että backend-prosessin callback-vastaanottaja käyttävät
compositionin samaa opt-in-havaitsijaa. Se saa alkuperäisen hylkäyksen ennen
recovery-journalin kirjoitusta tai `abortStartup`-viestiä, myös jos
koordinaattori on jo pysäyttänyt käynnistysprosessin. Havaitsijaa ei odoteta
tässä rajassa eikä sen virhe muuta päätöstä. Julkiset virheet, statusviestit
ja operational-tapahtumat eivät saa raakaa `cause`-ketjua. Tämä kytkentä ei
väitä, että alemman palvelun jo korvaama poikkeus voitaisiin palauttaa.
Jokainen runtime saa oman exclusive-tiedoston. Prosessipuun poissaolon jälkeen
nykyinen fixtureCleanup omistaa luvun ja terminal-kirjoituksen ennen poistoa.
Kelvollinen ensimmäinen ote säilytetään, vaikka toinen olisi rikkinäinen.
Puuttuva, osittainen tai varmentamaton ote ei anna fixturen poistamislupaa.
Havainto ei ole sama asia kuin todistettu juurisyy.

Omistaja hyväksyi vain tämän eristetyn synteettisen käynnistyksen
virhepolulle enintään 500 ms:n asynkronisen tallennuksen valmistumisodotuksen
ennen hallittua `app.exit()`-poistumista. Odotus päättyy heti kirjoituksen
valmistuttua; ei kiinteää unta, synkronista kirjoitusta tai rajaamatonta
kuittausta. Sama odotus ei käynnisty toistamiseen. Tavallinen käyttäjäkäynnistys
ja onnistunut polku eivät odota. Kirjoituksen virhe tai aikakatkaisu ei muuta
alkuperäistä käynnistysvirhettä eikä anna fixturen poistamislupaa ilman
varmennettua otetta. Nykyiset testien hyväksyntäaikarajat säilyvät.

**Rajattu toimitus on todennettu:** [nimetty Windows-koe](https://github.com/eky-software/eky/actions/runs/37616471588)
läpäisi revisiolla `6c096474`. Nykyisen Windows-supervisorin omistama
Electron-fixture todisti alkuperäisen poikkeuksen säilymisen oikean
`app.exit()`-rajan yli ja prosessipuun poissaolon. Salattu julkaisu ja
yksityinen purku varmistivat viestin, pinon, syyketjun, ajosidonnan ja
tiivisteet. Onnistuneen fixturen native-tulosta ei sisällytetä liitteeseen:
poistumistodiste perustuu saman jäädytetyn kokeen tiukkoihin assertioihin,
liitteen sisältötodiste purkuun. Luonnollinen Node-poistuminen ei korvaa tätä
näyttöä. Tämä ei ole paketoidun tuotantokäynnistyksen hyväksyntä:
legacy-sovellusvika ja uuden paketin normaali hyväksyntä säilyvät avoimina.

Nimetty `startup-exception-exit-proof` on nykyisen feasibility-workflowin
manuaalinen kertakoe, ei normaali hyväksyntäportti. Se kääntää jäädytetyn
revision nykyisen omistajakoodin, käynnistää yhden eristetyn Electron-fixturen
nykyisen Job Object -supervisorin alla ja vaatii alkuperäisen poikkeuksen
säilymisen todellisen `app.exit()`-rajan yli. Vasta tämän todisteen jälkeen
nykyinen salattu keräin toimittaa täsmälleen nykyisen legacy-terminalin.
Jobin vihreys edellyttää myös onnistunutta salattua julkaisua; paikallinen
purku varmistaa sisällön, sidonnan ja tiivisteet. Ei MSI-asennusta, raakajäljen
uploadia, uutta riippuvuutta tai testien automaattista uusintaa.
Rajattu paikallinen komento on
`pnpm --filter @eky/desktop installer:proof:startup-exception-exit`.

Luku rajataan 16 nykyisen nimisäännön mukaiseen lokitiedostoon ja nykyiseen
5 MiB:n tiedostorajaan. Linkit, muuttunut sisältö, keskeneräinen viimeinen
rivi, virheellinen sidonta tai puuttuva aineisto eivät muutu onnistuneeksi
havainnoksi. Puuttuva tai varmentamaton syytieto säilyttää alkuperäisen
testifixturen; sille ei päätellä poistamislupaa onnistuneesta MSI-siivouksesta.
Normaalin hyväksyntätuloksen ja siivouksen nykyiset ehdot säilyvät.

Otetta ei toimiteta uudella kirjoittimella: nykyinen `fixtureCleanup`-vaiheen
atominen terminal-kirjoitus sisältää sen ennen mahdollista profiilin poistoa.
Keräin hyväksyy vain tämän legacy-terminalin täsmällisen nimen ja projektoi
sen erikseen ennen salausta. Onnistuneeseen käynnistykseen ei lisätä lokikuittausta,
valmiusehtoa tai odotusaikaa; edellä hyväksytty rajattu virhepolku on erillinen.
Keräimen nykyiset kokonaisrajat ja salauksen
fail-closed-käytäntö säilyvät. Tämä testikohtainen yksityinen ote ei kuulu
Diagnosticsiin, Activityyn tai sovelluksen tukipakettiin.

Erillinen olemassa olevia asennuspaketteja käyttävä
`packaged-boundary-diagnostic` kutsuu samaa jälkikeräysactionia vain
legacy-variantin hylkäyksen tai keskeytyksen jälkeen. Valmiiksi tarkistetun
julkisen salausavaimen ja hosted-admission ehdot säilyvät. Asennuskomento,
pakollinen tulosverifier ja paketin jälkivarmennus eivät saa
`continue-on-error`-poikkeusta; vain nykyinen valinnainen salattu toimitus saa
olemassa olevan kolmen minuutin rajauksensa. Diagnostiikka ei korvaa
normaalia saman revision PR/main-hyväksyntää.

MSI-politiikan erillisessä manuaalisessa `msi-file-version-policy`-kokeessa
`--retain-evidence` säilyttää myös läpäisseen kokeen nimetyn tutkimusaineiston.
Tämä ei ohita hosted-admissiota, tuotteen poistamista tai prosessisiivouksen
varmennusta. Sama keräin salaa aineiston kokeen jälkeen myös epäonnistuttaessa;
jobin todellinen tila säilyy sidonnassa eikä onnistumista muuteta virheeksi
keräyksen käynnistämiseksi. Julkaisu sallii vain varmennetun salatekstin
yhdeksi vuorokaudeksi. Normaali CI säilyttää nykyisen virheen jälkeisen
keräyksen; manuaalisen kokeen onnistunut toimitus ei hyväksy normaaleja portteja.

Yleisen virhekeräimen rajana on 256 tiedostoa, 64 MiB yksittäiselle
sallitulle lokille tai raportille ja 512 MiB yhteensä. Sama 64 MiB:n
tiedostobudjetti koskee myös muita MSI-lokeja; workspace-kohdeasentimen
lokilta vaaditaan edelleen täsmällinen säilytyskuitti. Kerättävien lähteiden
nimet, projektiot, ajosidonta ja linkkien sekä muuttuneen sisällön hylkäys
eivät laajene budjetin mukana. Tämä on säilytyksen raja, ei lupa kerätä
uutta aineistoa tai kasvattaa alkuperäisten kirjoittajien protokollaviestejä.
Hakemistoluvulla on oma määrä-, syvyys- ja aikaraja. Raportit kerätään
ennen natiiveja tuloksia lähdekohtaisin tilavarauksin; saman lähteen uusimmat
testijuuret käsitellään ensin. Aiemmin säilyneet natiivitulokset eivät siten
voi käyttää raporttien koko tiedostokiintiötä. Asiaankuulumattomat temp-nimet
eivät kuluta 4 096 soveltuvan hakemistomerkinnän rajaa, mutta niidenkin
läpikäynti kuuluu lähteen viiden sekunnin hakubudjettiin. Tämä ei muuta
testin aikarajaa eikä lisää odotusta testin kriittiselle polulle.
`results`-lähteen nykyinen 64 tiedoston kiintiö on yhteinen prosessitulosteille
ja lifecycle-tiedostoille. Monen testin epäonnistuminen voi täyttää sen;
lähteen `limited`-tila ei lupaa kaikkien yritysten aineistoa.
Manifesti erottaa säilyneen,
puuttuvan, liian suuren, kokonaisrajan ylittäneen ja varmentamattoman tiedoston
sekä puuttuvan/osittaisen/rajatun lähdehaun. `complete` tarkoittaa vain
lähdehaun valmistumista, ei täydellistä kaatumisvedosta. Nolla säilynyttä
tiedostoa ei ole vian selitys. Testi, cleanup, keräys, salaus, upload ja purku
ovat erillisiä tuloksia. Jobin tila ei yksin todista prosessisiivousta.

Koko tracea, verkkokaappausta, muistivedosta, ympäristöä tai tietokantaa ei
kytketä tällä muutoksella. Erityisesti `retain-on-failure` ei yksin ratkaise
Electron-contextin tallennusta tai testi-istunnon salaisuuksien rajausta.
Runnerin pakkokatkaisu voi estää myös tämän jälkikeräyksen. Puuttuva näyttö
ilmoitetaan sellaisena; sitä ei korvata automaattisella uusinnalla tai
väitteellä infrastruktuuriviasta.

## Workspace-keräys ja tulokset

`workspaceEncryptedEvidence.mjs` valmistelee erillisen temp-juuren ennen
testin käynnistystä. Sidonta sisältää CI-ajon, suoritusyrityksen, matriisin
toiston, lähderevision, paketin descriptorin ja callerin käynnistystunnisteen.
Uusi yritys ei kirjoita vanhan päälle eikä build tyhjennä tätä hakemistoa.

Workspace-keräimen nykyiset säilytysbudjetit ovat:

| Sisältö | Yksittäisen tiedoston raja |
| --- | --- |
| Nimetyt tallennus-, tilasto-, stderr- ja virhelokit | 64 MiB |
| `command-export.private.log` | 128 MiB |
| `capture.etl` | 256 MiB, ennallaan |
| Varmennettu workspace-kohdeasentimen loki | 64 MiB |
| `export-metadata.private.json` | 1 MiB, ennallaan |
| Caller-tulos ja MSI-lokin säilytyskuitti | 8 KiB kumpikin, ennallaan |
| Keräyksen konteksti | 4 KiB, ennallaan |

Workspace- ja yleinen keräin käyttävät samaa 512 MiB:n säilytettyjen
tiedostotavujen kokonaisbudjettia: summataan manifestin säilyneiden
merkintöjen `bytes`, ei `sourceProof.bytes`. Yleisen keräimen projektoidun
raportin budjetti lasketaan projektion jälkeen; alkuperäinen lähdekoko
säilyy erillisessä `sourceProof`-todisteessa. JSON/base64-kuori ja salattu siirtotiedosto
ovat erillisiä esityksiä; purkajan on huomioitava base64:n kokolisä
varmentaessaan saman revision budjettia. Paketti kirjoitetaan nykyisellä
virtaavalla kirjoittimella. Koko aineistoa ei lueta kerralla muistiin
salauksen vuoksi. Salaustyökalun nykyinen määräaika, paketin sidonta,
tiivisteiden uudelleentarkistus ja yhden vuorokauden salattu säilytys
eivät muutu. Rajan ylitys ilmoitetaan; sitä ei tulkita testin onnistumiseksi.

Manuaalisen `packaged-boundary-diagnostic`-kokeen opt-in-workspace-fault-keräys
käyttää samaa keräintä ja kolmea sallittua valintaa:
`acceptanceInterruption`, `activeWorkspaceFirstStartFailure` tai
`passiveWorkspaceMigrationFailure`. Konteksti, manifesti ja caller-tuloksen
varmennus sidotaan samaan `packagedWorkspaceFaultRollback`-skenaarioon ja
täsmälliseen `faultScenario`-arvoon. Väärää skenaariota ei tulkita
onnistuneeksi siivoukseksi. Tavallisen success-keräyksen sidonta säilyy.

Kahdella jälkimmäisellä valinnalla tallennus alkaa ennen valitun skenaarion
komentoa, ei vasta aikaisempien pitkien prefix-kokeiden jälkeen. Vanha
`acceptanceInterruption`-oletus säilyttää prefixinsä. Pysäytys, salaus ja
vain salatun tiedoston toimitus käyttävät nykyisiä virheen-/keskeytyksen
jälkiaskeleita. Fault-aineisto suljetaan talteen ennen mahdollista hidasta
paketin jälkivarmennusta ja vientianalyysiä; manifestin niiden tulokset ovat
silloin `skipped`. Niiden myöhemmät erilliset tulokset ovat edelleen
pakollisia, eikä varhainen talteenotto hyväksy testiä tai pakettia.
Puuttuva caller-tulos säilyttää saatavilla olevan sallitun aineiston,
mutta siivous jää `unverified`-tilaan. Tiedostonimi-, koko-, avain-, salaus-
ja säilytysrajat eivät laajene. Tämä kytkentä ei käynnistä koetta eikä muuta
normaalin CI-matriisin valintaa.

Nykyinen rajattu WPR-keräin käynnistetään ennen varsinaista komentoa ja
pysäytetään sen jälkeen myös testin epäonnistuessa, jos runner on vielä
käytettävissä. Normaali caller, sen verifier ja paketin jälkivarmennus
säilyvät pakollisina. Tallennus ei muuta niiden tulosta, retryä tai aikarajaa.

Kerääjä lukee vain ennalta nimetyt ETL-, vienti-/tallennuslokit ja callerin
tulostiedoston. Se ei kopioi koko temp- tai profiilikansiota, ympäristöä,
Git-tunnuksia tai tietokantoja. Symboliset linkit, uudelleenohjaukset ja
hardlinkit hylätään. Tiedostojen määrä, yksittäiset koot ja yhteiskoko on
rajattu. Puuttuva tiedosto merkitään `missing`-tilaan; muuttunut, liian suuri
tai muuten varmentamatta jäänyt tiedosto saa yhteisen `unverified`-tilan.
Salauksen sisällä oleva `failureCode` erottaa nyt `sizeLimitExceeded`-,
`pathRejected`-, `identityChanged`-, `sourceChanged`-, `writeIncomplete`-,
`sourceMissing`-, `accessDenied`-, `storageFull`- ja `ioFailure`-havainnot.
Tuntematon virhe on `unclassified`; natiivivirheen viestiä, pinoa, polkua tai
muita ominaisuuksia ei kopioida. Hylätyn tiedoston tavuja tai kokoa ei lisätä
pakettiin. Vanha manifesti ilman syykoodia ei osoita juuri kokoylitystä.
Syytieto ei muuta tiedoston hyväksymisehtoa tai julkista yhteenvetoa.
ETL otetaan mukaan vain varmennetun tallennuksen pysäytyksen jälkeen.
Rajattu järjestelmäjälki voi silti sisältää arkaluonteisia komentorivejä
tai istuntotietoja. Pelkkä tiedostorajaus ei puhdista niiden sisältöä;
siksi myös synteettisen CI:n aineisto salataan eikä sitä tulosteta julkisesti.

Paketti on tavallinen gzip-pakattu JSON: manifesti sekä nimettyjen
tiedostojen base64-tavut. Manifestin koko- ja SHA-256-tiedot mahdollistavat
purkutuloksen vertailun. Tämä sisäinen manifesti pysyy salauksen sisällä.
OpenPGP salaa koko gzip-tiedoston. Julkaisu hyväksyy vain onnistuneen
salausaskeleen nimenomaisen `.gpg`-tiedoston, ei globia tai hakemistoa.

Julkisessa yhteenvedossa erotetaan testin, paketin jälkivarmennuksen,
tallennuksen aloituksen/pysäytyksen ja analyysin tulokset sekä siivouksen
varmennus. `sealed` tarkoittaa salauksen valmistumista, ei latauksen,
purun, analyysin tai testin hyväksyntää. Puuttuvaa syytä ei arvata.
Normaali kuluttaja ei tee vientianalyysiä ennen talteenottoa: analyysi on
`skipped`, ja säilynyt ETL voidaan tutkia myöhemmin yksityisesti ilman
uutta MSI-asennusta. Vanhan kokeen raakaa vientivirhettä tämä ei palauta.

## Säilytys ja rajat

- Vain salattu liite säilytetään GitHubissa yhden vuorokauden ajan.
  Asetus ei muuta repositoryn muiden artifactien tai konsolilokien säilytystä.
- Ajon seuraaja lataa salatun liitteen ennen vanhenemista yksityiseen
  tutkimusalueeseen ja varmentaa purun, sidonnan sekä tiedostojen tiivisteet.
  Latauksen tai purun puute kirjataan puuttuvaksi näytöksi.
- Paikallinen säilytys tarkistetaan 14 vuorokauden kohdalla. Ratkaisemattoman
  virheen tai varmentamattoman siivouksen ainoaa aineistoa ei poisteta
  automaattisesti. Tämä koodi ei poista tutkimusaineistoa.
- Salausta ei pidä tulkita julkaisijan allekirjoitukseksi. Aineiston lähde
  yhdistetään luotetun GitHub-ajon artifactiin ja sen manifestiin.
- Runnerin menetys, koko jobin pakkokatkaisu, vanheneminen tai peruutus voi
  estää jälkiaskeleet. `always()` ei takaa niitä. Nykyinen jobin 30 minuutin
  ja komennon 25 minuutin raja säilyy; erillistä varmaa toimitusvarausta ei
  tässä luvata. Ennen ikkunaa syntynyt virhe voi näkyä ETL:ssä, mutta tämä
  ei ole täydellinen prosessivedos, verkkokaappaus tai Playwright-trace.

### Historiallisen kertakokeen säilytysraja

Aiemman erikseen hyväksytyn yksityisen kertakokeen seitsemän vuorokauden
GitHub-säilytys oli vain kyseisen kokeen toimitusraja. Se ei muuta nykyisen
salatun liitteen yhden vuorokauden säilytystä eikä uusi suljetun kokeen
käynnistyslupaa. Kokeen ehto oli aineiston viipymätön lataus ja varmennus;
ETL:n talteenotto ennen jobin loppua oli tavoite, ei toimitustakuu. Paikallinen
14 vuorokauden tarkistus ei ole automaattinen poistomääräaika. Ratkaistun
virheen aineisto voidaan poistaa vain hyväksytyn säilytyskäytännön ja
varmennetun siivouksen mukaisesti. Ratkaisemattoman virheen tai epävarman
siivouksen ainoa aineisto säilytetään ja jatkosäilytyksestä pyydetään erillinen
päätös. Turvallinen tulosraportti säilyy; tästä ei synny uutta ajastinta,
CI-käynnistintä tai testilupaa.

## Todennus

### Rajattu toimituskoe

Käyttöönoton kohdennettu hosted-koe on olemassa olevan feasibility-workflow'n
erikseen valittava `encrypted-evidence-delivery-proof`. Se käyttää vain
synteettistä näytettä, ei EKY-asennusta, paketin buildia, WPR-tallennusta tai
riippuvuuksien asennusta. Sen manifesti kertoo toimituskokeen luonteen;
siihen ei keksitä MSI-paketin descriptor-identiteettiä eikä sovellustestin
onnistumista. Tavallinen workspace-kuluttaja säilyttää oman sopimuksensa.

Kokeen valitseminen edellyttää varmennettua julkista avainta. Sen salauksen
tai täsmällisen salatun liitteen uploadin virhe hylkää toimituskokeen.
Tavallisen sovellustestin valinnainen diagnostiikka on eri asia: sen tulosta
ei muuteta sovelluksen toiminnalliseksi hylkäykseksi. Kokeella on oma
concurrency-ryhmä, jotta se ei peruuta varsinaista hyväksyntäajoa.

Testiperheiden laajennuksen toimituskoe lisää samaan valintaan tarkoituksella
epäonnistuvan synteettisen aliprosessin. Ennalta määrätty poistumiskoodi ja
näytteen syntyminen varmistetaan ennen yhteisen jälkikeräysactionin kutsua.
Normaalin työn valinnaisuudesta poiketen kokeen salaus ja upload ovat
pakollisia; odottamaton onnistuminen tai puuttuva näyte hylkää kokeen.
Paikallisen purun pitää palauttaa ensivirheen täsmälliset tavut.

Linux-kytkennällä on oma `linux-encrypted-evidence-delivery-proof`-valinta
samassa workflow'ssa. Se ajaa olemassa olevat keräys- ja OpenPGP-regressiot
valmiilla työkaluilla sekä tarkoituksella epäonnistuvan aliprosessin ja
yhteisen salatun toimituksen. Viiden minuutin rajattu koe ei käynnistä
Windows-koetta, MSI-asennusta tai normaalia hyväksyntäkierrosta. Hosted-kokeen
onnistumisen lisäksi sama salattu liite puretaan oikealla paikallisella
avaimella: lähde, suoritusyritys, job, tiivisteet ja ensivirheen tavut
varmistetaan ennen tavallisten Linux-jobien kytkennän julkaisemista.

Toimituskokeen virhetuloste erottaa suljetulla vaihe-arvolla kutsun
kontekstin, Node-version, tapahtumatiedoston ja sen JSON-tulkinnan,
checkout-revision, keräyksen, salauksen, salatekstin tarkistuksen sekä
output-julkaisun. Vaihe kertoo hylkäyskohdan, ei juurisyytä. Raakavirhe,
polku tai ympäristö ei kuulu tulosteeseen. Normaali workspace-kuluttaja
ei käytä tätä kertakokeen lisätulostetta.

Salauksen kohdalla kertakoe välittää lisäksi vain yhteisen
`encryptedEvidenceFailureCodes.json`-sopimuksen täsmällisen koodin.
PowerShell ei julkaise poikkeustekstiä, eikä Node poimi tunnettua sanaa
muun tulosteen sisältä: vain yksi kokonainen sallittu koodirivi hyväksytään.
Apurin puuttuminen tai käynnistysoikeuden puute erotetaan nimellä
`EVIDENCE_HELPER_START_FAILED`. Tuntematon tai virheellinen vastaus pysyy
yleisenä hylkäyksenä. Normaalin workspace-kuluttajan ilmoitus ei muutu.

Valmistuminen vaatii ajon seuraajalta yksityisen latauksen ja purun,
manifestin run/attempt/revision-sidonnan tarkistuksen sekä näytteen tavujen
ja tiivisteiden vertailun. Hosted-ajon vihreä salaus/upload ei yksin täytä
tätä porttia. Tämä koe ei sulje vanhaa timeoutia tai todista tallennuksen
toimivuutta pakkokatkaisussa. Ensimmäisen oikean keräyksen kattavuus
arvioidaan sen omasta manifestista.

### Kohdetestit

Rajattu komento on `pnpm --filter @eky/desktop installer:test:encrypted-evidence`.
Testit kattavat tiedostorajat, ensiyrityksen erottelun, väärät avaimet,
salauksen ja purun sekä todellisen workflow-kytkennän sopimuksen. Windowsin
ja Linuxin GnuPG-kokeet käyttävät vain erillisiä synteettisiä testiavaimia.
Niiden preferenssit nimetään sovitulle MDC-profiilille; työkalun vaihtuva
AEAD-oletus ei muuta testifixtureä tai salauksen hyväksyntää. Varsinaisen
toimituksen algoritmi ja MDC varmistetaan edelleen GnuPG:n tilatulosteesta.
Vain Windowsin workspace-toimitus-CLI:n ja Git-asennuksen erityiskokeet
ohitetaan Linuxissa; yhteinen oikean prosessin keräys, CLI, salaus, purku,
väärän avaimen esto ja määräajan todistus suoritetaan molemmissa.
Keräyksen käyttöönotto vaatii lisäksi ylläpitäjän oman avaimen purkukokeen
ja kohdennetun hosted-toimituksen varmennuksen. Paikallinen läpäisy ei ole
hosted-toimituksen todiste eikä alkuperäisen timeoutin korjaus.

Työpuun paikallinen checkpoint: yhdistetty 55/55 Windows-tarkistus
läpäisi ilman ohituksia. Todellinen keräys -> OpenPGP -> purku sekä
synteettisen toimituskokeen CLI -> salaus -> purku todennettiin.
Nykyinen `test:ci` läpäisi lisäksi 357/357 sopimustestiä ilman ohituksia.
Toimituskokeen työkalujen ennakkotarkistus käyttää olemassa olevaa rajattua
prosessiapuria ja eristettyä temp-juurta; työkalujen raakaa tulostetta ei
julkaista. Riippumaton lukukatselmus ei löytänyt estävää puutetta.
Katselmuksen nimeämä hylkäystestien aukko täydennettiin tämän jälkeen:
todellinen toimitus-CLI hylkää väärän checkout-revision sekä rikkinäisen
tai liian suuren tapahtuma-JSON:n ennen aineiston valmistelua ja
julkaisuoutputin muutosta. Täydennetty OpenPGP-kohdesarja läpäisi 16/16
tarkistusta ilman ohituksia; aiempaa koko `test:ci`-sarjaa ei ajettu tämän
pelkän testitäydennyksen vuoksi uudelleen.
Julkaisua edeltävä yhdistetty kohdesarja läpäisi tämän jälkeen 58/58
tarkistusta ilman ohituksia, mukaan lukien täydentävät hylkäysregressiot.
Tämä on työpuun näyttöä, ei jäädytetyn hosted-revision hyväksyntä.
Käyttöönoton paikallinen hyväksyntäportti täyttyi; yksityiskohtainen
näyttö säilyy yksityisenä. Tässä vaiheessa hosted-toimitus oli vielä
avoinna. Paikallinen käyttöönotto ei yksin aktivoi GitHubin avainmuuttujia.

Ensimmäinen revision `9daf3209` hosted-toimituskoe hylättiin salausaskeleen
yleisellä virhekoodilla työkalujen ennakkotarkistuksen jälkeen. Salattua
liitettä ei syntynyt eikä salaamatonta varavaihtoehtoa käytetty. Normaalia
hyväksyntää tai MSI-asennusta ei ajettu. Hyväksytty revision `9f8f7c34`
jatkokoe rajasi hylkäyksen vaiheeseen `encryption`, mutta ei salausapurin
sisäiseen syyhyn. Tästäkään ajosta ei syntynyt liitettä. Molemmat hylkäykset
säilyvät. Turvallisen sisäisen koodin välityksen jälkeen revision `b5c26c05`
kolmas koe hylättiin koodilla `EVIDENCE_GPG_UNAVAILABLE`; liitteitä ei
syntynyt. Usean Git-osuman työkaluhakuvirhe toistettiin erillisellä
synteettisellä regressiolla ja korjattiin yllä kuvattuun ensimmäisen osuman
valintaan. Korjauksen yhdistetty kohdesarja läpäisi 63/63 ilman ohituksia,
mukaan lukien usean osuman todellinen salaus/purku. Tässä vaiheessa
hosted-vastaavuus oli vielä todentamatta ja keräyksen vahvistus poistettu.

Omistajan hyväksymä korjatun revision `f69f3d76` kertakoe
[36930438493](https://github.com/eky-software/eky/actions/runs/36930438493),
suoritusyritys 1, läpäisi tämän jälkeen salauksen ja julkaisun.
Artifactin `11195722296` yksityinen lataus, eheys, kylmä purku,
manifestin sidonta ja tavujen vertailu todennettiin. Vahvistusportti on
käytössä; purkuavain ja salasana pysyvät paikallisina. Rajattu toimitusportti
on hyväksytty, ei alkuperäinen timeout tai normaali hyväksyntäkierros.
Ajantasaisen hyväksynnän ja seuraavan päätöksen omistaa
[M1-suunnitelma](release-0.3.0-m1-preparation-plan.md#salatun-toimituksen-hyväksyntä).

Lähteet: [GnuPG:n vastaanottajavalinta](https://www.gnupg.org/documentation/manuals/gnupg/GPG-Key-related-Options.html),
[artifactien säilytys](https://github.com/actions/upload-artifact#retention-period)
ja [testauskäytäntö](../ai/testing-rules.md#ensivirhe-uusinta-ja-rajattu-poikkeus).
