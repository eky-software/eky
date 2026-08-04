# Observability- ja auditointisuunnitelma

Tämä dokumentti määrittelee Eky R0:n lokituksen, liiketoiminta-auditoinnin ja
turvallisuushavaintojen vastuut. Tavoitteena on diagnosoitava local-first-
sovellus ilman tarpeetonta henkilötietojen, laskusisällön tai salaisuuksien
kopiointia lokitiedostoihin.

R0-observability on tuotantoperusta, ei väliaikainen testitoteutus. Uusi
moduuli käyttää tätä ydinsopimusta eikä rakenna omaa loggeria, event-kuorta,
retention-mallia tai tukipakettiformaattia uudelleen. Moduuli määrittelee vain
omat tyypitetyt tapahtumansa ja projektiopäätöksensä alla kuvatun portin
mukaisesti.

## Tietosuojan lähtökohta

Eky noudattaa tarkoitussidonnaisuutta, tietojen minimointia, säilytyksen
rajaamista sekä eheyttä ja luottamuksellisuutta. Teknisissä lokeissa ei
tallenneta käyttäjän liiketoimintasisältöä vain siksi, että se on saatavilla.

Lasku- ja asiakasnumero ovat pseudonyymejä viitteitä. Ne voivat olla
henkilötietoja, jos ne voidaan yhdistää luonnolliseen henkilöön. Siksi niitä
käytetään vain yritys- ja permission-rajatussa liiketoimintahistoriassa, ei
pitkäaikaisessa teknisessä incident-indeksissä.

R0:n säilytysajat ovat dokumentoitu oletuspolitiikka, eivät väite siitä, että
kaikki audit-tapahtumat olisivat kirjanpitoaineistoa. Rekisterinpitäjän pitää
ennen oikean henkilödatan käyttöönottoa dokumentoida käsittelyn tarkoitukset,
oikeusperusteet, rekisteröidyille annettavat tiedot ja säilytysaikojen
perustelut. Säilytysajat tarkistetaan, jos laki, sopimus tai organisaation tarve
edellyttää muuta.

Keskeiset viralliset lähteet:

- [GDPR 5 artikla: minimointi, säilytyksen rajaaminen ja luottamuksellisuus](https://eur-lex.europa.eu/eli/reg/2016/679/2016-05-04/eng)
- [EDPB: tietosuoja sisäänrakennettuna ja oletusarvoisena](https://www.edpb.europa.eu/sme/be-compliant/be-compliant_en)
- [Kirjanpitolaki 2 luvun 10 §](https://finlex.fi/fi/lainsaadanto/1997/1336)

Tämä dokumentti on tekninen suunnitelma eikä oikeudellinen lausunto.

## Kolme erillistä vastuuta

### Module-owned business audit trail

Liiketoimintamoduuli omistaa omat pysyvät tapahtumansa ja niiden tietomallin.
Audit kertoo, että liiketoiminnan kannalta merkityksellinen muutos tehtiin,
kenen vahvistetussa actor-kontekstissa se tehtiin ja mihin yritykseen se
kuului.

- Kriittinen audit-kirjoitus kuuluu samaan tietokantatransaktioon varsinaisen
  muutoksen kanssa.
- Audit-virhe peruu kriittisen business-muutoksen.
- Audit ei sisällä vanhoja tai uusia kenttäarvoja, asiakas- tai laskusisältöä,
  yhteystietoja, pankkitietoja tai salaisuuksia.
- JSONL-loki ei ole business auditin totuuden lähde.

### Operational developer log

Operational-loki kertoo runtimen, tietokannan, HTTP:n, PDF:n, tiedostojen ja
integraatioiden turvallisista onnistumis-, esto- ja virhetiloista.

- Lokin kirjoitusvirhe ei muuta business-operaation lopputulosta.
- Lokitus ei korvaa business auditia.
- Kaikkia onnistuneita GET-pyyntöjä ei lokiteta.
- Eventit ovat tyypitettyjä, rajattuja ja redaktoituja.

### Security log

Security-loki sisältää vain merkitykselliset autentikointi-, permission-,
tenant-, protocol-, navigation-, permission- ja salaisuusrajojen tapahtumat.

- Security-loki ei ole request dump.
- Se ei sisällä tokeneita, session-salaisuutta, cookieita, headereita,
  request bodya tai asiakkaan yhteystietoja.
- Security-eventin kirjoitus ei paljasta hyökkääjälle toisen yrityksen
  resurssin olemassaoloa.

## Tapahtumasopimukset

Operational- ja security-eventit ovat TypeScriptin discriminated union
-tyyppejä. `eventName` on vakaa union/enum ja jokaisella eventillä on oma
tarkasti tyypitetty input tai builder.

Kiellettyjä malleja:

- yleinen `LoggerManager`
- `logger.info(string, unknown)`
- arbitrary metadata -objekti
- vapaa `message`, `details`, raw `Error`, raw stack tai provider response
- yleiset `utils`, `helpers` tai `common` -lokikaatopaikat

Yksi kirjoitin omistaa yhden koherentin tiedostovirran. Backend ja desktop
saavat omat adapterinsa. Yhteistä toteutusta irrotetaan vasta todennetun
toiston perusteella. Renderer ei kirjoita tiedostojärjestelmään eikä saa
lähettää vapaamuotoista lokitekstiä backendille tai Electron mainille.
Tapahtuma kulkee aina sen omistavan moduulin tai infrastruktuurivastuun
tyypitetyn sopimuksen kautta. Yleistä `LoggerManager`-palvelua tai
vapaamuotoista metadataa ei lisätä.

## Sallitut ja kielletyt tiedot

Ydinkentät rajataan tapahtuman mukaan:

- UTC-aikaleima, schema-versio ja event ID
- eventName, category, level, component ja outcome
- app version, build revision ja runtime instance ID tarkasti mallinnetuissa
  paikallisissa operational-eventeissä
- tarvittaessa correlation ID, operation ID, stage, turvallinen error code,
  retryable, side-effect state, duration ja fingerprint
- vain business auditissa tai tarkasti rajatussa activity-projektiossa
  tarvittava company, actor ja entity-viite

Operational- ja security-lokeissa kielletään:

- salasanat, tokenit, sessionit, valtuutukset, cookiet ja salausavaimet
- request/response body, MIME, sähköpostirunko ja providerin raakavastaus
- PDF-data ja laskurivien tai muun entityn sisältö
- IBAN, henkilötunnus ja tietokantayhteysmerkkijono
- asiakkaan nimi, osoite, puhelin ja sähköposti
- paikalliset käyttäjäpolut, ympäristömuuttujat ja raw stack

Sallitut merkkijonot sanitoidaan kontrollimerkeistä. Koko, pituus, taulukon
alkiomäärä ja sisäkkäisyys rajataan. Tuntematon kenttä tai eventName hylätään.

`appVersion`, `buildRevision` ja `runtimeInstanceId` ovat vianrajaustietoja.
Ne eivät ole autentikointi-, tenant-, permission- tai artifactin
allekirjoitustietoja. Runtime-tunniste vaihtuu käynnistyksittäin eikä sitä
viedä pitkäaikaiseen incident-indeksiin.

Incident-indeksin sallittu build-konteksti on `appVersion`, turvallinen
`buildRevision`, component, eventName, outcome, errorCode, fingerprint ja
UTC-aikaleima. Indeksi ei sisällä runtime-, correlation-, operation-, actor-,
company- tai entity-tunnisteita, paikallisia polkuja tai liiketoimintadataa.

Onnistuneen DNA SMTP -transportin detailed-loki saa sisältää tarkasti
validoidun SMTP-profiilin, target-portin 465, TLS 1.2/1.3 -version,
allowlistatun cipherin, sertifikaatin SHA-256-sormenjäljen, etä-IP:n ja sen
IP-perheen sekä yritys- ja henkilötiedottoman attempt ID:n. Etä-IP,
target-portti ja attempt ID eivät siirry Diagnostics-projektioon,
tukipakettiin tai incident-indeksiin. SMTP-käyttäjänimeä, lähettäjää,
vastaanottajaa, otsikkoa, runkoa, salasanaa, MIMEä, PDF-tietoa tai
sertifikaatin raakadataa ei tallenneta.

SMTP:n transport-virheet instrumentoidaan seuraavasti:

| Kuljetusvirhe | Operational-event |
| --- | --- |
| TLS-virhe | `smtp.tlsFailed` |
| autentikoinnin hylkäys tai puuttuva tuettu mekanismi | `smtp.authenticationFailed` |
| yhteyden muodostusvirhe, connect-vaiheen sulkeutuminen tai aikakatkaisu | `smtp.connectionFailed` |
| epäselvä lopullinen toimitustulos | `smtp.deliveryOutcomeUnknown` |
| muut greeting-, envelope-, DATA-, protokolla-, sulkeutumis- ja aikakatkaisuvirheet | `smtp.deliveryFailed` |

Transport-eventti täydentää yleistä
`invoiceDelivery.providerFailed`/`invoiceDelivery.outcomeUnknown`-eventtiä,
mutta ei korvaa toimituksen business-eventtiä. Diagnostiikan kirjoitus on best
effort: sen epäonnistuminen ei muuta SMTP-toimituksen lopputulosta.

SMTP:n ehdottomia turvallisuusportteja ovat implicit TLS portissa 465,
`rejectUnauthorized`, sertifikaatin ja hostnamen validointi sekä vähintään
TLS 1.2. TLS 1.3 sallitaan. Cipherin nimi, sertifikaatin sormenjälki, etä-IP
ja IP-perhe ovat vain diagnostiikkametadataa. Jos turvallinen TLS-yhteys on
muodostunut mutta metadataa ei voida validoida projektiota varten, lähetys saa
jatkua ilman transport-yhteenvetoa ja `smtp.connectionSecured`-eventtiä.

Kenttärajat pidetään erillisinä:

| Taso | Sallittu sisältö |
| --- | --- |
| paikallinen detailed JSONL | tapahtuman tyypitetyt, allowlistatut tekniset kentät; SMTP:n etä-IP, portti ja operation ID vain tässä tasossa |
| Diagnostics-UI | uudelleenvalidoitu turvallinen projektio; SMTP:stä profiili, TLS-versio, cipher, sormenjälki, stage ja kesto |
| tukipaketti | viimeisen 30 päivän warning/error/security-projektio ilman info-eventtejä, etä-IP:tä, porttia tai operation ID:tä |
| pitkäaikainen incident-indeksi | minimoitu incident-indeksi ilman suoria tunnisteita, raw-rivejä tai business-sisältöä |

Toimitetun lasku-PDF:n paikallisen arkistotehtävän queue-virhe kirjataan
`invoicePdfArchive.queueFailed`-eventtinä vain, jos arkistointibrokeri ei
vastaanota tehtävää onnistuneen toimituksen jälkeen. Event on best effort eikä
muuta delivery eventin terminal-tilaa tai laskun `sent`-tilaa. Sen sallittu
payload on kiinteä turvallinen `errorCode`, `stage = queue`, failure-outcome,
`retryable = true`, `sideEffectState = none` sekä normaali runtime- ja
build-identiteetti.

Queue-eventissä ei saa olla company-, invoice-, delivery event-, document-,
customer- tai operation-tunnistetta, laskunumeroa, PDF-tiivistettä,
paikallista polkua, sähköpostia tai raakaa virheviestiä. Tämän eventin
kirjoitusvirhe ei saa korvata alkuperäisen toimituksen onnistunutta tulosta.

## Uuden moduulin observability-portti

Jokaiselle uudelle moduulille määritellään ennen toteutusta:

1. moduulin omistama business event catalog
2. operational event catalog
3. security event catalog
4. jokaisen tapahtuman omistava moduuli tai infrastruktuurivastuu
5. transaction ownership: mitkä audit-eventit kuuluvat samaan transaktioon
6. jokaisen tapahtuman sallitut ja kielletyt kentät
7. kenttien henkilötieto- ja pseudonyymiluokitus
8. tarkoitukseen perustuva retention class
9. Activity-projektio tai perusteltu poissulku
10. Diagnostics-projektio tai perusteltu poissulku
11. support bundle -sisällytys tai poissulku
12. incident-index-kelpoisuus tai poissulku
13. writer-, audit- ja projektiovirheiden vaikutus business-operaatioon
14. redaction-, salaisuus-, henkilötieto- ja kontrollimerkkitestit
15. onnistuvan ja rikkoutuvan polun yksikkö-, integraatio- ja E2E-testit

## Activity- ja diagnostics-rajat

Activity on read-only composition. Se yhdistää moduulien turvallisia
projektioita erillisten reader-porttien kautta eikä omista audit-kirjoituksia.
Frontend ei saa raw event metadataa. Customers-moduulin ja oman yrityksen
asetusten päivityksistä saa välittää vain omistavan moduulin allowlistan
mukaiset muutoskategoriat ilman kenttänimiä tai vanhoja ja uusia arvoja.

Diagnostics lukee vain kiinteästä Eky logs-rootista, validoi eventit uudelleen
ja palauttaa rajatun projection. Se ei hyväksy tiedostopolkua tai filenamea
requestista. Lokikansion avaaminen ja tukipaketin tallennus ovat desktop mainin
omistamia capabilityja.

R0:ssa tukipaketti muodostetaan vain desktopissa. Backend palauttaa
permission-rajatun sanitoidun teknisen projektion, mutta renderer ei saa
sisäistä reittiä, runtime-sessionia, tallennuspolkua tai paketin sisältöä.
Electron main vahvistaa toiminnon, validoi backend-vastauksen uudelleen ja
kirjoittaa checksumeilla varustetun `.json.gz`-artifactin. Vanha
`.ekysupport`-pääte säilyy vain tarkastimen legacy-yhteensopivuutena.

R0-observabilityn toteutus sisältää nyt tyypitetyt backend- ja desktop-eventit,
rotatoidut JSONL-lokit, moduulien audit-kirjoitukset, Activity- ja
Diagnostics-read modelit, turvallisen lokikansion avauksen sekä sanitoidun
tukipakettiviennin. Customers-, Company Settings- ja Invoicing-moduulien
business audit -retention suoritetaan moduulikohtaisten porttien kautta
startupissa. Invoicing omistaa myös ALV-kantojen, laskunumeroinnin ja
maksuasetusten auditoinnin, vaikka niiden lomakkeet näkyvät Oma yritys
-näkymässä.
Laskun manuaalisen maksutilan append-only-tapahtumat kuuluvat samoin
Invoicingille. Activity saa niistä vain laskunumeron, tapahtuma-ajan ja
allowlistatun toiminnon. Maksupäivä, euromäärä, maksulähde, actor-tunniste,
pankkitieto ja asiakastieto eivät siirry Activity-projektioon, teknisiin
lokeihin, Diagnosticsiin, incident-indeksiin tai tukipakettiin.

Paketoitu smoke todentaa myös Diagnostics-eventtien HTTP- ja UI-ketjun,
lokikansiocapabilityn stubatun avauksen sekä tarvittavat pakettiartifactit.
Electronin permission check ei tuota security-lokikohinaa; vain todellinen
request kirjataan kerran turvallista luokitusta kohden. Varhainen
desktop-käynnistys rajaa käyttäjä- ja smoke-virheet vakioituihin koodeihin ja
kirjoittaa loggerin valmistumisen jälkeisestä virheestä turvallisen
bootstrap-eventin.

R0:n diagnostiikkaperusta on valmis. Tukipaketin formaatti on versio 2,
30 päivän lähdekatkaisu raportoidaan rehellisesti, incident-indexistä luetaan
vain minimoituja ryhmäyhteenvetoja ja packaged smoke todentaa oikean
tukipakettiviennin. Tukipaketin 25 MiB:n kokonaisbudjetissa varataan
vähintään 5 MiB ydinosioille; diagnostiikkatapahtumien osabudjetti on 16 MiB
ja incident-yhteenvetojen 4 MiB. Ylityksessä säilytetään uusimmat prefiksit,
katkaistaan ensin diagnostiikkatapahtumia ja vasta niiden tyhjennyttyä
incident-yhteenvetoja. Manifesti ja checksumit rakennetaan lopullisesta
sisällöstä. Smoke raportoi vain allowlistatun viimeisen vaiheen:
`startup`, `backend`, `diagnostics`, `logFolder`, `supportBundle`,
`secretStorage`, `pdfPreview` tai `shutdown`.

R0:n local-first-lokit ja business auditit eivät ole kryptografisesti
muuttumaton forensiikka-audit. Kun Eky laajenee usean käyttäjän tai pilven
käyttöön, arvioidaan erikseen append-only-tallennus, hash chain,
keskitetty audit-palvelu ja valvottu vienti. Näitä ei jäljitellä nykyisessä
yhden hallitun koneen toteutuksessa.

Kahden tukipakettiadapterin yhteinen tiedostotason vastuu on rajattu
Diagnostics-moduulin `boundedJsonlSourceReader`-primitiveen. Se omistaa vain
regular file/no symlink -tarkistuksen, rajatun tail-luvun, osittaisen
ensimmäisen rivin poiston sekä tavu- ja truncation-tiedot. Tiedostonimimallit,
hakemistovalinta, tapahtumavalidointi, ryhmittely, deduplikointi ja
osabudjetit säilyvät erillisissä read model -adaptereissa.

Seuraava observabilityn testausvaihe on dokumentoitu Playwright/E2E-kokonaisuus.
Playwrightia tai muuta uutta riippuvuutta ei lisätä ilman erillistä
riippuvuuspäätöstä.

Operational-writerin kapasiteetti- tai kirjoitusvirhe ei yritä kirjoittaa
rekursiivisesti samaan streamiin. Siitä muodostetaan rajattu prosessikohtainen
yhteenveto olemassa olevaan incident-indeksiin. Laskutus- ja SMTP-virheiden
yksityiskohtaisessa, lyhyemmän retentionin lokissa voidaan käyttää
vianrajausta varten tarpeellisia `companyId`-, `invoiceId`- ja
`operationId`-tunnisteita. Niitä ei viedä incident-indeksiin,
Diagnostics-projektioon tai tukipakettiin.

## Backup-, restore- ja update-tapahtumat

ADR-0009:n portable backup -capability käyttää toteutettuja, suljetun
kenttäsopimuksen operational eventejä:

- `backup.started`
- `backup.completed`
- `backup.failed`
- `backup.inspectionCompleted`
- `backup.inspectionFailed`

Ne sisältävät vain nimetyn vaiheen tai turvallisen virhekoodin ja
korrelaatiotunnisteen. Portable backupin sisältöä, salaustietoja tai raakaa
polkua ei kirjata.

Restore-, recovery point- ja update-lifecyclejen tulevat käyttäjälle
merkitykselliset operational eventit vaativat vielä erillisen event catalog
-päätöksen. Varatut tapahtumaperheet ovat:

- `restore.*`
- `recoveryPoint.*`
- `update.*`

Niiden tarkkoja event-nimiä, outcome-arvoja tai retentionia ei lukita ennen kuin
application/use case-, transaction ownership- ja failure behavior -rajat on
mallinnettu. Tapahtumat noudattavat nykyistä yhteistä event envelopea eivätkä
luo omaa loggeria tai vapaamuotoista metadataa.

Tapahtumiin ei saa tallentaa backup- tai update-payloadia, salasanaa,
avainmateriaalia, salt/nonce/tag-arvoja, manifestia, raakaa paikallista
polkua, installer commandia, yrityksen nimeä tai business dataa.

## Testaus ja failure behavior

- Business audit -virhe rollbackaa saman transaktion kriittisen muutoksen.
- Operational- tai security-writerin virhe ei kaada business-polkua eikä
  peitä alkuperäistä turvallista käyttäjävirhettä.
- Lokituksen omaa virhettä ei kirjoiteta rekursiivisesti samaan kirjoittimeen.
- Redaction testataan myös tuntemattomilla kentillä, kontrollimerkeillä,
  henkilötiedoilla ja salaisuuksilla.
- Yritys- ja permission-rajat testataan backendissä.
- Testeissä käytetään vain synteettistä dataa.

Säilytys, rotaatio ja levybudejetit määritellään dokumentissa
`operational-log-retention-plan.md`. Tukipaketin rajat määritellään
`support-bundle-plan.md` ja E2E-strategia `e2e-testing-strategy.md`.
