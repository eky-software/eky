# Turvallisuusperiaatteet

Tämä dokumentti määrittelee Eky-projektin turvallisuuden pääperiaatteet.

Turvallisuus on ensisijainen vaatimus koko projektissa.

## Pääperiaate

Frontend ei ole luotettu ympäristö.

Backend tarkistaa aina:

- käyttäjän tunnistamisen
- käyttöoikeudet
- yritysrajauksen
- syötteen oikeellisuuden
- liiketoimintasäännöt

## Liikenne

Tuotannossa kaikki liikenne kulkee salattuna.

Perusmalli:

- frontend -> backend: HTTPS
- backend -> tietokanta: salattu tai hallittu pilviyhteys
- backend -> ulkoiset palvelut: salattu yhteys

Lokaalissa kehityksessä voidaan käyttää `localhost`-yhteyksiä, mutta tuotantoturvallisuutta ei saa suunnitella paikallisen oletuksen varaan.

## Salaisuudet

Salaisuuksia ei tallenneta frontendiin.

Salaisuuksia ovat esimerkiksi:

- API-avaimet
- tietokannan salasanat
- service account -avaimet
- yksityiset tokenit
- webhook-salaisuudet

Salaisuudet hallitaan runtime-profiilin hyväksytyllä secret store -adapterilla.
Pilvessä käytetään hallittua Secret Manager -palvelua. Eky Localin Electron-
profiilissa salaisuus suojataan vain main processin `safeStorage`-adapterilla ja
versionoidulla salatulla `userData`-blobilla. Renderer, preload, HTTP-vastaus,
SQLite, URL, komentorivi, ympäristömuuttuja ja loki eivät saa salaista arvoa.

## Julkisen repositoryn turvallisuus

Repository voi sisältää arkkitehtuurin, koodin, testit, moduulirajat ja yleiset turvallisuusperiaatteet.

Arkkitehtuuripäätökset eivät ole salaisuuksia. On hyväksyttävää dokumentoida, että Eky käyttää esimerkiksi backendin käyttöoikeustarkistuksia, adaptereita, paikallista SQLite-profiilia, pilven PostgreSQL-profiilia tai Firebase Authia adapterin takana.

Repository ei saa sisältää:

- salaisuuksia
- tuotantoavaimia
- tietokannan salasanoja
- Firebase service account -avaimia
- oikeaa asiakasdataa
- laskutietoja
- varmuuskopioita
- arkaluonteista ympäristökonfiguraatiota
- yksityisiä tokeneita
- webhook-salaisuuksia

Paikalliset tietokantatiedostot, varmuuskopiot ja `.env`-tiedostot pidetään Gitin ulkopuolella.

Jos tuotantoympäristöön liittyvä tieto auttaa hyökkääjää suoraan, sitä ei dokumentoida julkiseen repositoryyn.

Backup- ja päivitysarkkitehtuurin yleiset periaatteet saa dokumentoida
julkisesti. Repositoryyn ei kuitenkaan tallenneta oikeaa `.ekybackup`-
tiedostoa, palautuspistettä, päivityspakettia, allekirjoitusavainta,
backup-salasanaa, kryptografista avainmateriaalia, paikallista
yritysprofiilia tai installerin konekohtaista journalia.

## Backup-, restore- ja päivitysturvallisuus

- siirrettävä business-datan varmuuskopio on aina autentikoidusti salattu
- konekohtainen palautuspiste ei ole siirrettävä backup
- restore validoi artifactin ja käyttää staging-profiilia ennen aktiivisen
  profiilin vaihtoa
- schemaa muuttava päivitys vaatii validoidun palautuspisteen
- käynnissä oleva sovellus ei korvaa omia binaarejaan
- renderer ei saa backup-, restore- tai update-polkuja, avaimia, URL:eja tai
  prosessiargumentteja
- asennin ei omista eikä poista business dataa
- paikallista update-artifactia ei suoriteta USB-/käyttäjäpolusta, vaan
  Electron main kopioi sen Eky-private stagingiin ja varmentaa staged tavut
  uudelleen ennen handoffia
- update-artifactin eheys ja julkaisijan identiteetti ovat eri todisteita:
  SHA-256 ei korvaa Authenticodea tai allekirjoitettua manifestia
- normaali in-app update ei suorita allekirjoittamatonta pakettia ilman
  erikseen hyväksyttyä trust anchor -mallia
- virhetilanne ei saa johtaa salaamattomaan fallbackiin, osittaiseen restoreen
  tai reverse SQL -migraatioon

Tarkat päätökset ovat ADR-0009:ssä ja ADR-0010:ssä.

ADR-0009:n R0-toteutus on lisäksi todistettava hardened Windows package
-artifactilla kahdessa prosessissa. Testi vertaa palautetun SQLite-tiedoston
ennen backendin avausta, auktoritatiiviset PDF:t restartin jälkeen, uuden
runtime-sessionin, backupin jälkeisen mutaation poistumisen ja konekohtaisen
salaisuuden säilymisen backupin ulkopuolella. Testin koordinaatiotila ei saa
sisältää salasanaa, sessionia, raakaa polkua tai business dataa.

## Autentikointi

Firebase Auth on alustava valinta käyttäjän tunnistamiseen.

Backend tarkistaa käyttäjän tokenin.

Pelkkä frontendissä näkyvä kirjautumistila ei riitä turvallisuudeksi.

## Käyttöoikeudet

Käyttöoikeudet tarkistetaan backendissä.

Frontend voi piilottaa painikkeita tai näkymiä käyttökokemuksen vuoksi, mutta se ei ole varsinainen suojaus.

Käyttöoikeuksissa noudatetaan deny by default -periaatetta: jos oikeutta ei ole nimenomaisesti annettu, toimintoa ei sallita.

Käyttöoikeudet voivat perustua:

- rooleihin
- permission-sääntöihin
- yritysjäsenyyteen
- moduulikohtaisiin oikeuksiin

## Tenant-eristys

Järjestelmä suunnitellaan niin, että sitä voidaan myöhemmin käyttää useassa yrityksessä.

Keskeinen periaate:

- käyttäjä kuuluu yritykseen
- data kuuluu yritykseen
- backend varmistaa, että käyttäjä saa käsitellä vain oman yrityksensä dataa

Tärkeissä tauluissa käytetään `companyId`-tyyppistä yritysrajausta.

## Syötteen validointi

Kaikki ulkoinen syöte validoidaan backendissä.

Ulkoinen syöte voi tulla:

- frontendistä
- mobiilista
- AI-agentilta
- integraatiosta
- tiedostotuonnista
- webhookista

Frontend-validointi ei korvaa backend-validointia.

## Audit trail

Kriittisistä toiminnoista kirjataan audit log.

Audit logiin voidaan kirjata esimerkiksi:

- kuka teki toiminnon
- milloin toiminto tehtiin
- mitä toimintoa tehtiin
- mihin kohteeseen toiminto liittyi
- mistä lähteestä toiminto tuli
- mitä oleellista muuttui

Audit logia tarvitaan erityisesti laskutuksessa, käyttöoikeuksissa ja yritysasetuksissa.

## Hashaus ja salaus

Hashausta käytetään oikeisiin käyttötarkoituksiin.

Esimerkkejä:

- salasanoja ei tallenneta itse, jos käytetään Firebase Authia
- tokenit ja salaisuudet eivät saa tallentua raakamuodossa
- tiedoston eheyteen voidaan käyttää hashia
- audit trailiin voidaan myöhemmin harkita hash-pohjaista muuttumattomuuden tarkistusta

Kaikkea dataa ei hashata. Liiketoimintadata suojataan käyttöoikeuksilla, yhteyksien salauksella, tietokannan suojauksella ja audit traililla.

## AI-agentit

AI-agentit ovat järjestelmän toimijoita, eivät poikkeuksia turvallisuuteen.

AI-agentit eivät saa:

- kirjoittaa suoraan tietokantaan
- ohittaa käyttöoikeuksia
- ohittaa domain-sääntöjä
- ohittaa audit logia
- käyttää salaisuuksia suoraan ilman hallittua rajapintaa

AI-agenttien toiminta pitää olla jäljitettävää.

## Paikallinen käyttö

Paikallinen kehityskäyttö ei saa heikentää tuotantoturvaa.

Local development voi käyttää paikallista tietokantaa ja kehitysautentikointia.

Tuotantokäytössä oikea autentikointi, käyttöoikeudet ja salattu liikenne ovat pakollisia.

### Nykyisen Local-MVP:n Turvallisuusraja

Electron-local-profiili käyttää main processin muistissa luotua sessionia,
backendin vahvistamaa pysyvää local-runtime-identiteettiä ja `ActorContext`-
yritysrajausta. Nykyiset business-reitit saavat yrityksen tästä kontekstista,
eivät request bodysta, querysta tai omasta reittivakiosta. Local ownerille
annetaan vain eksplisiittisesti luetellut permissionit.

Selainpohjainen development-profiili on edelleen tarkoituksellinen
kehityspoikkeus ilman Electron-sessionia. Siksi koko nykyinen toteutus on yhä
release security reviewtä edeltävä local-MVP:

- backend ja web-palvelin sidotaan vain loopback-osoitteeseen, oletuksena `127.0.0.1`
- käytetään vain synteettistä testi- ja kehitysdataa
- development-profiilia ei pidetä tuotantoautentikointina
- SQLite-tiedosto pidetään backendin ei-julkisessa, Gitin ulkopuolisessa datahakemistossa
- käyttö perustuu toistaiseksi luotettuun paikalliseen kehityskoneeseen ja sen käyttöjärjestelmätason käyttäjä- sekä tiedosto-oikeuksiin

Development-profiilissa käynnistettyä backendia ei saa:

- sitoa `0.0.0.0`-, `::`- tai muuhun verkosta saavutettavaan osoitteeseen
- julkaista internetiin, lähiverkkoon tai julkiselle palvelimelle
- käyttää oikealla asiakas-, lasku-, henkilö- tai tuotantodatalla
- käsitellä tuotantovalmiina vain siksi, että se toimii paikallisesti

Ei-loopback-verkkosidonta vaatii erikseen hyväksytyn deployment- ja turvallisuusmallin. Ennen sitä tarvitaan vähintään:

- backendin vahvistama autentikointi
- backendin permission- ja yritysrajaustarkistukset
- luotettu käyttäjä- ja `companyId`-konteksti
- HTTPS tai hallittu salattu reverse proxy
- tarkoituksellinen origin-, CORS-, cookie-, token- ja CSRF-malli
- turvallinen virheenkäsittely ja lokitus
- abuse-, request size- ja tarvittaessa rate limit -rajat
- audit trail kriittisille toiminnoille
- turvallisuustestit

Oikean paikallisen asiakasdatan käyttöönotto vaatii erillisen release security review -tarkistuksen, vaikka sovellus pysyisi offline-tilassa.

### Local Desktop Shell

Eky local-MVP:n ensisijainen desktop shell on Electron dokumentin
`docs/decisions/ADR-0007-local-desktop-shell-and-session-bootstrap.md`
mukaisesti.

Electron renderer on epäluotettu ympäristö samalla tavalla kuin selain-
frontend. Desktop shell ei saa siirtää backendin permission-, yritysrajaus-,
validointi- tai auditointivastuuta rendererille tai preloadiin.

Paikallinen sähköpostisalaisuus kulkee vain backend utility processin ja
Electron main processin välisessä yksityisessä `MessagePort`-brokerissa.
`safeStorage`a käyttää vain main process. Jos käyttöjärjestelmän salaus ei ole
saatavilla tai blobia ei voi purkaa, toiminto epäonnistuu ilman plaintext-
fallbackia.

Ennen oikean datan käyttöä paketoidusta desktop-artifactista tarkistetaan
vähintään rendererin sandbox ja context isolation, Node-integraation esto,
rajattu IPC, CSP, navigoinnin esto, Electron fuses, ASAR-integriteetti,
allekirjoitus, tuettu Electron-versio ja dependency audit. Electronin debug-
rajapinnat, remote code, salaamaton local-session tai rendererille paljastuva
session-salaisuus eivät ole sallittuja tuotantoprofiilissa.

## Pakollinen Turvallisuusarvio Muutoksille

Jokaisessa koodi-, API-, data-, integraatio- tai riippuvuusmuutoksessa tarkistetaan:

- muuttuuko luottamusraja tai palvelun verkkonäkyvyys
- mitkä syötteet tulevat frontendistä, mobiilista, tiedostosta, integraatiosta, webhookista tai AI-agentilta
- validoidaanko syötteen tyyppi, muoto, pituus, lukurajat ja sallittu arvojoukko backendissä
- hylätäänkö JSON-kentän väärä tyyppi ennen application serviceä sen sijaan,
  että numero, boolean, taulukko tai objekti muunnettaisiin puuttuvaksi tai
  tyhjäksi arvoksi
- tulevatko käyttäjän identiteetti, yritysjäsenyys ja `companyId` luotetusta backend-kontekstista
- estetäänkö toisen yrityksen dataan pääsy sekä luku- että kirjoituspoluissa
- onko käyttöoikeus deny by default
- voiko syöte aiheuttaa SQL-, komento-, polku-, otsake-, loki- tai sisältöinjektion
- palauttaako API vain käyttötapauksen tarvitsemat kentät
- ovatko virheilmoitukset käyttäjälle turvallisia ja tekniset tiedot rajattu lokeihin
- sisältävätkö lokit, testidata tai repository salaisuuksia tai oikeaa henkilötietoa
- tarvitaanko audit-tapahtuma
- tarvitaanko negatiivinen turvallisuustesti
- onko dependency- ja lockfile-muutokselle ajettu tietoturvatarkistus

Turvallisuutta ei kuitata yleisellä toteamuksella. Tarkistus suhteutetaan muutoksen todelliseen vaikutusalueeseen.

## Release Security Gate

Ennen oikean asiakas- tai laskutusdatan käyttöä ja ennen verkkoon tai pilveen julkaisemista pitää olla dokumentoidusti kunnossa:

- autentikointi
- käyttöoikeudet
- tenant- ja yrityseristys
- backend-validointi
- turvallinen salaisuuksien hallinta
- salattu liikenne
- audit trail kriittisille muutoksille
- varmuuskopioiden ja paikallisen tietokannan suojaus
- tuettu ja päivitetty Windows, rajattu käyttäjätili, automaattinen
  näytönlukitus sekä BitLocker tai Device Encryption oikeaa dataa käyttävällä
  local desktop -laitteella
- turvallinen virheenkäsittely ja lokitus
- dependency audit ja tunnettuja haavoittuvuuksia koskeva käsittely
- palautus-, päivitys- ja tietoturvapoikkeaman toimintamalli

Tämän portin puuttuvia kohtia ei saa korvata sillä oletuksella, että hyökkääjä ei tunne arkkitehtuuria tai lähdekoodia.
R0-pilottilaitteen tarkka hyväksyntälista on dokumentissa
`docs/architecture/windows-installer-and-update-plan.md`.

## Kiellettyjä ratkaisuja

Älä tee:

- API-avaimia frontendiin
- käyttöoikeuksia vain frontendissä
- suoria tietokantakutsuja frontendistä
- tuotantodatan käyttöä testidatana
- salaisuuksien logitusta
- kovakoodattuja salasanoja
- kovakoodattuja yritys-ID:itä
- AI-agentille suoraa tietokantaoikeutta

## Avoimet turvallisuuskysymykset

- Tarkka rooli- ja permission-malli
- Audit login rakenne
- Tuotantoympäristön salaisuuksien hallinta
- Firebase Auth tokenin tarkistustapa backendissä
- Mobiilin offline-synkronoinnin konfliktiturva
- Tenant-eristyksen tarkka tietomalli
