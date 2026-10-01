# CI:n salattu tutkimusaineisto

## Rajaus

Omistaja hyväksyi rajatun GnuPG/OpenPGP-salauksen testityökaluksi.
Ensimmäinen kuluttaja on normaali Windowsin `workspace_consumer`, ei uusi
testialusta tai pysyvä yksityinen CI. Tämä sopimus ei koske käyttäjän koneen
mittauksia, sovelluksen tukipakettia, tuotantodataa tai varmuuskopioita.
Työn nykytilan omistaa [M1-suunnitelma](release-0.3.0-m1-preparation-plan.md#salatun-tutkimusaineiston-välitavoite).

Turvallinen julkinen testiraportti säilyy. Raaka-aineisto saa poistua
synteettiseltä CI-runnerilta vain erikseen hyväksytylle julkiselle avaimelle
salattuna. Lyhyt säilytysaika ei itsessään ole tietosuoja. Salausvirheessä
ei lähetetä salaamatonta tiedostoa, kansiota tai lokia varavaihtoehtona.

## Työkalu ja avain

Käytetään Git-työkaluketjun GnuPG:tä eristetystä apurista. Se ei ole uusi
npm-riippuvuus eikä kuulu toimitettavaan EKY-sovellukseen. Käytössä ovat
OpenPGP:n julkisen avaimen salaus ja AES-256; omaa salausformaattia ei
toteuteta. GnuPG on ylläpidetty GPL-3.0-or-later-työkalu. Sen ja Gitin
päivitykset sekä ilmoitetut haavoittuvuudet kuuluvat CI-työkaluketjun
ylläpitoon, vaikka npm-audit ei niitä kata. Runnerilta puuttuva tai
yhteensopimaton työkalu estää salatun aineiston toimituksen, ei salli
automaattista latausta tai salaamattomaan tapaan palaamista.

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

## Keräys ja tulokset

`workspaceEncryptedEvidence.mjs` valmistelee erillisen temp-juuren ennen
testin käynnistystä. Sidonta sisältää CI-ajon, suoritusyrityksen, matriisin
toiston, lähderevision, paketin descriptorin ja callerin käynnistystunnisteen.
Uusi yritys ei kirjoita vanhan päälle eikä build tyhjennä tätä hakemistoa.

Nykyinen rajattu WPR-keräin käynnistetään ennen varsinaista komentoa ja
pysäytetään sen jälkeen myös testin epäonnistuessa, jos runner on vielä
käytettävissä. Normaali caller, sen verifier ja paketin jälkivarmennus
säilyvät pakollisina. Tallennus ei muuta niiden tulosta, retryä tai aikarajaa.

Kerääjä lukee vain ennalta nimetyt ETL-, vienti-/tallennuslokit ja callerin
tulostiedoston. Se ei kopioi koko temp- tai profiilikansiota, ympäristöä,
Git-tunnuksia tai tietokantoja. Symboliset linkit, uudelleenohjaukset ja
hardlinkit hylätään. Tiedostojen määrä, yksittäiset koot ja yhteiskoko on
rajattu. Puuttuva, muuttunut tai liian suuri tiedosto merkitään erikseen.
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

Toimituskokeen virhetuloste erottaa suljetulla vaihe-arvolla kutsun
kontekstin, Node-version, tapahtumatiedoston ja sen JSON-tulkinnan,
checkout-revision, keräyksen, salauksen, salatekstin tarkistuksen sekä
output-julkaisun. Vaihe kertoo hylkäyskohdan, ei juurisyytä. Raakavirhe,
polku tai ympäristö ei kuulu tulosteeseen. Normaali workspace-kuluttaja
ei käytä tätä kertakokeen lisätulostetta.

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
GnuPG-kokeet käyttävät vain erillisiä synteettisiä testiavaimia.
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
Käyttöönoton paikallinen hyväksyntäportti on täytetty; yksityiskohtainen
näyttö säilyy yksityisenä. Hosted-toimitus on vielä avoinna, eikä
paikallinen käyttöönotto yksin aktivoi GitHubin avainmuuttujia.

Ensimmäinen revision `9daf3209` hosted-toimituskoe hylättiin salausaskeleen
yleisellä virhekoodilla työkalujen ennakkotarkistuksen jälkeen. Salattua
liitettä ei syntynyt eikä salaamatonta varavaihtoehtoa käytetty. Normaalia
hyväksyntää tai MSI-asennusta ei ajettu. Hyväksytty revision `9f8f7c34`
jatkokoe rajasi hylkäyksen vaiheeseen `encryption`, mutta ei salausapurin
sisäiseen syyhyn. Tästäkään ajosta ei syntynyt liitettä. Molemmat hylkäykset
säilyvät; toimitus-/purkuportti on avoin ja keräyksen vahvistus on poistettu.
Turvallisen sisäisen virhekoodin puuttuvan välityksen seuraava päätös ja työn
nykytila ovat [M1-suunnitelmassa](release-0.3.0-m1-preparation-plan.md#salatun-tutkimusaineiston-välitavoite).

Lähteet: [GnuPG:n vastaanottajavalinta](https://www.gnupg.org/documentation/manuals/gnupg/GPG-Key-related-Options.html),
[artifactien säilytys](https://github.com/actions/upload-artifact#retention-period)
ja [testauskäytäntö](../ai/testing-rules.md#ensivirhe-uusinta-ja-rajattu-poikkeus).
