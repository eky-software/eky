# Local Runtime Trust And Authorization Plan

Tämä dokumentti määrittää Eky local-runtimen luottamus-, autentikointi- ja
valtuutusmallin suunnittelulinjan. Tavoitteena on säilyttää sama application- ja
domain-ydin paikallisessa offline-versiossa, pilvessä ja myöhemmässä
monilaitemallissa.

Dokumentin local-session-, pysyvä local-identiteetti-, HTTP-middleware-,
`ActorContext`-, Electron `safeStorage` -brokeri- ja rajattu
sähköpostisalaisuuden HTTP/UI-lifecycle on toteutettu. DNA SMTP -providerin
testivastaanottajapolku ja käyttäjän vahvistama asiakaslähetys on toteutettu
delivery event -auditointeineen. Firebase-identityä ja cloud-
salaisuusadapteria ei ole toteutettu.

## Perusperiaate

Paikallinen backend kuuntelee vain loopback-osoitteessa. Loopback on tärkeä
verkkorajaus, mutta se ei yksin ole autentikointi tai käyttöoikeusmalli.

Eky local-version ensisijainen tuotemainen käyttötapa on käyttäjän omalle
koneelle asennettava Electron-desktop-sovellus. Päätös ja turvallinen session-
bootstrap on kuvattu dokumentissa
`docs/decisions/ADR-0007-local-desktop-shell-and-session-bootstrap.md`.
Pilvipalvelut, synkronointi ja suora web-käyttö lisätään myöhemmin erillisinä
runtime- ja infrastructure-adaptereina.

Ekyä ei laajenneta pilveen avaamalla käyttäjän paikallista backendia
internetiin. Paikallinen ja pilvessä ajettava runtime käyttävät samaa
application- ja domain-ydintä eri adapterien kautta.

```text
Local installed edition
  -> local UI
    -> loopback backend
      -> verified local actor context
        -> application services
          -> SQLite adapters
          -> local secret store adapter
          -> outbound integrations

Cloud edition
  -> web UI over HTTPS
    -> cloud backend
      -> verified Firebase identity and company membership
        -> application services
          -> PostgreSQL adapters
          -> cloud secret manager adapter
          -> outbound integrations
```

Paikallinen SMTP-yhteys on ulospäin lähtevä yhteys. Se ei tee loopbackiin
sidotusta backendista internetistä saavutettavaa. Se tuo kuitenkin uuden
luottamusrajan, koska backend käsittelee salaisuutta ja lähettää laskun tietoja
sekä PDF-tiedoston ulkoiselle palveluntarjoajalle.

## Yhteinen Actor Context

Application service saa käyttäjän ja yrityksen vain backendin vahvistamasta
kontekstista. Request body, query-parametri tai frontendin oma tila ei ole
luotettu identiteetin tai `companyId`-arvon lähde.

Yhteinen sopimus on toteutettu `packages/auth`-pakettiin:

```ts
interface ActorContext {
  actorId: string;
  companyId: string;
  permissions: readonly Permission[];
  authenticationMode: 'local' | 'firebase';
}
```

`packages/auth` omistaa ympäristöriippumattoman, validoidun ja muuttumattoman
`ActorContext`-sopimuksen sekä authentication mode -tyypin.
`packages/permissions` omistaa permission-tyypit, turvallisen authorization-
virheen ja heittävän deny-by-default-tarkistuksen. Permissions-paketti käyttää
tarkistuksessa vain permission-listan sisältävää rakenteellista kontekstia,
jotta `auth`- ja `permissions`-pakettien välille ei muodostu kiertoriippuvuutta.

Electron main processin luoma session varmennetaan backendin HTTP-
middlewaressa, minkä jälkeen backend muodostaa tietokantaan tallennetusta
local-runtime-identiteetistä `ActorContext`-olion. Firebase-, HTTP-, desktop-
tai Windows-tyypit eivät vuoda application-palvelujen sopimuksiin.

Ensimmäiset toteutetut local-owner-permissionit ovat:

- `manageCompanySettings`
- `manageInvoiceSettings`
- `manageInvoiceNumberingSeries`
- `manageInvoiceCorrections`
- `manageInvoicePayments`
- `manageCompanyEmailSettings`
- `manageCompanyEmailSecret`
- `sendInvoices`
- `viewActivity`
- `viewDiagnostics`
- `createSupportBundle`

`manageInvoiceNumberingSeries` on käytetyn laskunumerosarjan korvaavan uuden
sarjan korkean kitkan poikkeustoiminto. Se ei sisälly
`manageInvoiceSettings`-oikeuteen implisiittisesti. Backend vaatii oikeuden
sekä esikatselussa että aktivoinnissa ja ottaa yrityksen sekä actorin vain
vahvistetusta `ActorContext`-kontekstista.

Local ownerin oikeudet luetellaan eksplisiittisesti. Uuden permission-arvon
lisääminen `packages/permissions`-pakettiin ei saa automaattisesti antaa sitä
local ownerille.

Nämä permissionit ovat backendin teknisiä toimintokohtaisia portteja. Ne eivät
vielä tarkoita valmista käyttäjä-, rooli- tai työntekijähallintaa. Isän
ensimmäisessä yhden käyttäjän local-asennuksessa pysyvä `local-owner` toimii
ainoana paikallisena actorina. Tuleva rooli- ja permission-malli, käyttäjä-UI
sekä yritysjäsenyydet hyväksytään erikseen pilvi- ja monikäyttäjävaiheessa.

## Local Identity Adapter

Yhden käyttäjän paikallinen versio tarvitsee aidon paikallisen session, vaikka
se ei ensimmäisessä vaiheessa tarvitse koko Firebase Auth -mallia.

Toteutetut ensimmäisen local-session-vaiheen säännöt:

- backend kuuntelee vain `127.0.0.1`- tai vastaavassa varmennetussa
  loopback-osoitteessa
- local runtime muodostaa käynnistyksessä vahvan satunnaisen session
- kirjoittavat ja arkaluonteiset reitit vaativat session
- sessionia ei sijoiteta URL:iin, lokiin tai selaimen pysyvään storageen
- origin on sallittujen paikallisten originien listalla ja CORS on deny by
  default
- CSRF- ja cross-origin-riskit käsitellään myös loopback-käytössä
- backend muodostaa `ActorContext`-olion session perusteella
- SQLite-tietokannan singleton `local_runtime_identity` säilyttää asennuksen
  sisäisen `installationId`-, `companyId`- ja `actorId`-identiteetin
- `companyId` ei tule request bodysta tai querysta
- käyttöoikeudet tarkistetaan deny-by-default-periaatteella

Uudessa asennuksessa `installationId` ja sisäinen `companyId` luodaan kerran
migraatiossa. Uudelleenkäynnistys, Electronin päivitys tai sovelluksen uusi
build ei vaihda niitä. Vanhassa yhden yrityksen local-kannassa migraatio
säilyttää olemassa olevan yritysrajan. Jos vanhasta local-kannasta löytyy
useita eri yritysrajoja, migraatio epäonnistuu turvallisesti eikä valitse yhtä
yritystä hiljaa.

`installationId` on tekninen paikallisen asennuksen tunniste. Sitä voidaan
myöhemmin käyttää yhdessä `companyId`-arvon kanssa käyttöjärjestelmän secret
store -avaimen nimiavaruudessa. Avainta ei johdeta sähköpostiosoitteesta,
Y-tunnuksesta tai muusta muuttuvasta liiketoimintadatasta.

Electron main process muodostaa runtime-sessionin ja välittää sen backendille
yksityisen prosessikanavan kautta. Renderer ei saa raakaa session-salaisuutta,
vaan käyttää preloadin ja main processin kapeaa, validoitua API-transporttia.
Main process lisää session-todisteen loopback-backendille lähtevään pyyntöön.

Sessionia ei saa välittää URL:ssa, komentorivillä, localStoragessa,
kovakoodattuna arvona, julkisena build-time-asetuksena tai lokitettavassa
ympäristömuuttujassa.

## Cloud Identity Adapter

Pilvessä backend muodostaa saman `ActorContext`-olion esimerkiksi seuraavista
vahvistetuista tiedoista:

- Firebase ID token
- käyttäjän aktiivinen jäsenyys yrityksessä
- backendin lukemat roolit ja permissionit
- pyynnön yrityskonteksti, jonka jäsenyyden backend on tarkistanut

Firebase on auth-adapteri. Se ei saa vuotaa domainiin tai application service
-sopimuksiin. Pilviversio ei kutsu käyttäjän paikallista loopback-backendia.

## Cloud Connected Local Mode

Paikallinen sovellus voi myöhemmin synkronoida pilveen tekemällä itse
ulospäin lähteviä HTTPS-pyyntöjä. Paikallista backendia ei avata lähiverkkoon
tai internetiin.

Synkronointi kulkee erillisen sync-kerroksen ja pilvibackendin autentikointi-,
permission-, validointi- ja auditointisääntöjen kautta. Raakaa SQLite-tiedostoa
ei kopioida pilveen.

## SMTP-Salaisuuden Turvallisuusportti

Secret store -portti ja lifecycle-testit valmisteltiin synteettisillä
testiarvoilla ennen oikean SMTP-salaisuuden käyttöönottoa. Oikeaa SMTP-
salasanaa ei saa vastaanottaa suojaamattomalla HTTP-profiililla, näyttää
webissä tai välittää Electron rendererille. Salaisuuden asettaminen kulkee
Electron-sessionilla suojatun backend-reitin ja main processin `safeStorage`-
brokerin kautta vasta local identity- ja permission-mallin jälkeen.

Salaisuuden asettaminen, vaihtaminen ja poistaminen vaativat
`manageCompanyEmailSecret`-permissionin. Oikea laskun lähetys vaatii
`sendInvoices`-permissionin.

Salaisuuden arvo:

- ei mene request- tai application-lokiin
- ei palaudu API-vastauksessa
- ei tallennu tavalliseen SQLite-kenttään
- ei tallennu selaimen storageen
- ei näy audit-eventissä
- luetaan secret storesta vain backendin provider-kutsua varten

## Runtime-Konfiguraation Rajat

Kaikkia toistuvia arvoja ei keskitetä yhteen yleiseen ohjain- tai
`constants.ts`-tiedostoon.

Keskitetään runtime-profiilin asetukset, kuten:

- local/cloud/runtime mode
- backendin host ja portti
- sallitut paikalliset originit
- sessionin turvallisuusasetukset
- tietokanta- ja storage-adapterin valinta
- auth- ja secret-adapterin valinta
- timeoutit ja muut ympäristökohtaiset tekniset rajat

Moduuliin jätetään sen omistamat arvot, kuten:

- laskutuksen tilat ja tilasiirtymät
- ALV- ja rahalaskennan säännöt
- laskurivien sallitut yksiköt
- moduulikohtaiset validointirajat
- PDF-layoutin mitat
- käyttäjälle näkyvät i18n-tekstit

`packages/config` voi myöhemmin omistaa ympäristöriippumattomat
konfiguraatiotyypit ja turvallisen runtime-asetusten lukumallin. Se ei saa
sisältää salaisuuksia, liiketoimintasääntöjä tai yhtä yleistä kaikkien
moduulien constants-kaatopaikkaa.

Nykyiset business-HTTP-reitit eivät valitse yritystä tai käyttäjää omilla
kovakoodatuilla `dev-company`- tai `dev-user`-vakioillaan. Customers-, Company
Settings-, Invoice Draft-, Invoice Numbering-, Invoice Payment Settings- ja
Approved Invoice -reitit käyttävät backendin vahvistamaa `ActorContext`-
kontekstia. Request bodyn tai queryn yritystunniste ei voi ohittaa sitä.

## Turvallisuustestit

Ensimmäisen local trust -toteutuksen pitää testata vähintään:

- ei-loopback-bind estetään tuotemaisessa local-profiilissa
- puuttuva, virheellinen ja vanhentunut local session hylätään
- väärä origin hylätään
- kirjoittava tai arkaluonteinen reitti ei toimi ilman permissionia
- request bodyn tai queryn `companyId` ei ohita actor contextia
- toisen yrityksen dataa ei voi lukea tai muuttaa
- salaisuus ei näy vastauksessa, virheessä, auditissa tai lokissa
- salaisuuden lifecycle käyttää vain backendin vahvistamaa yrityskontekstia
- local-identiteetti säilyy uudelleenkäynnistyksessä ja vanha yhden yrityksen
  local-data säilyttää yritysrajansa
- usean yritysrajan sisältävä vanha local-kanta epäonnistuu fail-closed
- local owner ei saa uutta permissionia pelkän permission-listan kasvamisen
  seurauksena
- Firebase-adapterin puuttuminen ei muuta local-sessionia automaattisesti
  pilviauthiksi

## Toteutusjärjestys

1. Local/cloud-yhteinen trust-malli on hyväksytty.
2. Ympäristöriippumaton `ActorContext`, ensimmäiset permissionit ja deny-by-
   default-tarkistus on toteutettu ilman Firebase- tai HTTP-riippuvuutta.
3. Electron-shell ja main processin hallitsema session-bootstrap on valittu
   ADR-0007:ssä.
4. Sähköpostin secret store -portti ja permissioneja vaativat lifecycle-
   palvelut on toteutettu ilman runtime-kytkentää.
5. Rajattu Electron- ja Windows-paketointispike ilman oikeaa dataa on
   toteutettu.
6. Local-session-adapteri ja HTTP-middleware negatiivisine
   turvallisuustesteineen on toteutettu.
7. Pysyvä local-runtime-identiteetti ja nykyisten business-reittien
   `ActorContext`-yritysrajaus on toteutettu.
8. Salaisuuden asettamisen ja poistamisen audit luo ennen secret store
   -operaatiota yhden `pending`-rivin ja päivittää sen `succeeded`- tai
   `failed`-tilaan. Epäselvä auditin loppupäivitys jää näkyvästi `pending`-
   tilaan myöhempää reconciliation-tarkistusta varten.
9. Electron main processin `safeStorage`-broker ja utility processin yksityinen
   `MessagePort`-client on toteutettu ilman uutta riippuvuutta.
10. Rajattu HTTP-, API-client- ja UI-lifecycle on toteutettu. Reitit
    rekisteröidään vain Electron desktop -compositionissa, request ei hyväksy
    `companyId`-arvoa ja response sisältää vain `configured`-tilan.
11. SMTP-provider portilla `465`, implicit TLS -mallilla ja pakotetulla test
    recipient -osoitteella on toteutettu ja varmennettu.
12. Asiakaslähetyksen prepare/confirm/send-polku, delivery event -auditointi ja
    vain varmasti onnistuneen toimituksen `sent`-tilasiirtymä on toteutettu.
13. Pilviversiossa toteutetaan erikseen Firebase identity -adapteri ja cloud
   secret manager -adapteri saman application-tason sopimuksen ympärille.

## Seurattava Tekninen Velka

Seuraavat kohdat saa siirtää laskutuksen toimitusputken jälkeen tehtävään
rajattuun runtime- ja rakennecleanupiin, mutta niitä ei saa unohtaa tai ohittaa
ennen oikeaa tuotantodataa:

- laajempi moduulikohtainen permission-migraatio; sähköpostin application-
  palvelut tarkistavat jo omat permissioninsa
- käyttäjä-, rooli- ja yritysjäsenyyshallinta monikäyttäjä- ja pilvivaihetta
  varten
- Viten toistuvan backend-proxyosoitteen keskittäminen
- runtime-profiilien tyypitetty konfiguraatiomalli `packages/config`-rajalla

Laaja cleanup voidaan ajoittaa laskutusmoduulin valmistumisen jälkeen. Oikean
SMTP-salaisuuden HTTP/UI-polku, oikea asiakkaalle lähetys ja oikean asiakas- tai
laskutusdatan tuotantokäyttö eivät kuitenkaan saa ohittaa local desktop
-luottamusrajan toteutusta ja release security review -tarkistusta.

## Ei Vielä Toteuteta

- Firebase Authia
- cloud identity -adapteria
- cloud secret manager -adapteria
- monikäyttäjän rooli- ja yritysjäsenyyshallintaa
- pilvisynkronointia
- uusia riippuvuuksia

## Liittyvät Dokumentit

- `AGENTS.md`
- `docs/architecture/security-principles.md`
- `docs/architecture/email-delivery-and-secrets-plan.md`
- `docs/architecture/local-cloud-sync.md`
- `docs/decisions/ADR-0003-technical-foundation.md`
- `docs/decisions/ADR-0004-local-backend-runtime.md`
- `docs/decisions/ADR-0007-local-desktop-shell-and-session-bootstrap.md`
