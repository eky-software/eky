# Observability- ja auditointisuunnitelma

Tämä dokumentti määrittelee Eky R0:n lokituksen, liiketoiminta-auditoinnin ja
turvallisuushavaintojen vastuut. Tavoitteena on diagnosoitava local-first-
sovellus ilman tarpeetonta henkilötietojen, laskusisällön tai salaisuuksien
kopiointia lokitiedostoihin.

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

## Uuden moduulin observability-portti

Jokaiselle uudelle moduulille määritellään ennen toteutusta:

1. moduulin omistama business event catalog
2. saman transaktion kanssa pakolliset audit-eventit
3. operational- ja security-event catalog
4. sallitut ja kielletyt event-kentät
5. retention class
6. redaction- ja väärinkäyttötestit
7. loki- ja audit-virheiden vaikutus business-operaatioon
8. activity feed -read model
9. E2E-matriisi
10. support bundle -sisällytys tai poissulku

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
kirjoittaa checksumeilla varustetun `.ekysupport`-artifactin.

R0-observabilityn toteutus sisältää nyt tyypitetyt backend- ja desktop-eventit,
rotatoidut JSONL-lokit, moduulien audit-kirjoitukset, Activity- ja
Diagnostics-read modelit, turvallisen lokikansion avauksen sekä sanitoidun
tukipakettiviennin. Customers-, Company Settings- ja Invoicing-moduulien
business audit -retention suoritetaan moduulikohtaisten porttien kautta
startupissa. Invoicing omistaa myös ALV-kantojen, laskunumeroinnin ja
maksuasetusten auditoinnin, vaikka niiden lomakkeet näkyvät Oma yritys
-näkymässä.

Paketoitu smoke todentaa myös Diagnostics-eventtien HTTP- ja UI-ketjun,
lokikansiocapabilityn stubatun avauksen sekä tarvittavat pakettiartifactit.
Electronin permission check ei tuota security-lokikohinaa; vain todellinen
request kirjataan kerran turvallista luokitusta kohden. Varhainen
desktop-käynnistys rajaa käyttäjä- ja smoke-virheet vakioituihin koodeihin ja
kirjoittaa loggerin valmistumisen jälkeisestä virheestä turvallisen
bootstrap-eventin.

Operational-writerin kapasiteetti- tai kirjoitusvirhe ei yritä kirjoittaa
rekursiivisesti samaan streamiin. Siitä muodostetaan rajattu prosessikohtainen
yhteenveto olemassa olevaan incident-indeksiin. Laskutus- ja SMTP-virheiden
yksityiskohtaisessa, lyhyemmän retentionin lokissa voidaan käyttää
vianrajausta varten tarpeellisia `companyId`-, `invoiceId`- ja
`operationId`-tunnisteita. Niitä ei viedä incident-indeksiin,
Diagnostics-projektioon tai tukipakettiin.

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
