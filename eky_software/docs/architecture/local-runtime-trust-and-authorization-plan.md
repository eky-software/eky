# Local Runtime Trust And Authorization Plan

Tämä dokumentti määrittää Eky local-runtimen luottamus-, autentikointi- ja
valtuutusmallin suunnittelulinjan. Tavoitteena on säilyttää sama application- ja
domain-ydin paikallisessa offline-versiossa, pilvessä ja myöhemmässä
monilaitemallissa.

Tämä on suunnitelma. Dokumentti ei lisää autentikointia, sessionhallintaa,
Firebase-riippuvuutta, HTTP-middlewarea, salaisuuden tallennusta tai uusia
riippuvuuksia.

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

Toteutus ei vielä muodosta `ActorContext`-oliota HTTP-pyynnöstä tai desktop-
sessionista. Firebase-, HTTP-, desktop- tai Windows-tyypit eivät vuoda
sopimuksiin.

Ensimmäiset toteutetut sähköpostipolun permissionit ovat:

- `manageCompanyEmailSettings`
- `manageCompanyEmailSecret`
- `sendInvoices`

Laajempi rooli- ja permission-malli hyväksytään erikseen.

## Local Identity Adapter

Yhden käyttäjän paikallinen versio tarvitsee aidon paikallisen session, vaikka
se ei ensimmäisessä vaiheessa tarvitse koko Firebase Auth -mallia.

Tavoiteltuja sääntöjä:

- backend kuuntelee vain `127.0.0.1`- tai vastaavassa varmennetussa
  loopback-osoitteessa
- local runtime muodostaa käynnistyksessä vahvan satunnaisen session
- kirjoittavat ja arkaluonteiset reitit vaativat session
- sessionia ei sijoiteta URL:iin, lokiin tai selaimen pysyvään storageen
- origin on sallittujen paikallisten originien listalla ja CORS on deny by
  default
- CSRF- ja cross-origin-riskit käsitellään myös loopback-käytössä
- backend muodostaa `ActorContext`-olion session perusteella
- `companyId` ei tule request bodysta tai querysta
- käyttöoikeudet tarkistetaan deny-by-default-periaatteella

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

Secret store -portti ja lifecycle-testit voidaan valmistella synteettisillä
testiarvoilla ennen local-sessionin valmistumista. Oikeaa SMTP-salasanaa ei saa
vastaanottaa HTTP:llä, näyttää webissä tai kirjoittaa Windows Credential
Manageriin ennen kuin local identity- ja permission-malli on toteutettu ja
turvallisuustestattu.

Salaisuuden asettaminen, vaihtaminen ja poistaminen vaativat myöhemmin
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

Nykyiset `dev-company`- ja `dev-user`-arvot ovat väliaikainen local development
-oikopolku. Ne korvataan reittien yhteisellä backendin vahvistamalla
`ActorContext`-mallilla, ei siirtämällä samoja tunnisteita vain uuteen
constants-tiedostoon.

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
5. Tehdään rajattu Electron- ja Windows-paketointispike ilman oikeaa dataa.
6. Toteutetaan local-session-adapteri ja HTTP-middleware negatiivisine
   turvallisuustesteineen.
7. Korvataan reittien `dev-company`- ja `dev-user`-oikopolut backendin
   vahvistamalla actor contextilla.
8. Lisätään salaisuuden asettamisen ja poistamisen audit-tapahtumat ennen
   oikeaa HTTP- tai UI-kytkentää.
9. Toteutetaan Windows Credential Manager -adapteri erillisen dependency- ja
   turvallisuusarvion jälkeen.
10. Toteutetaan SMTP-provider portilla `465` ja implicit TLS -mallilla ensin
   pakotettuun test recipient -osoitteeseen.
11. Pilviversiossa toteutetaan erikseen Firebase identity -adapteri ja cloud
   secret manager -adapteri saman application-tason sopimuksen ympärille.

## Seurattava Tekninen Velka

Seuraavat kohdat saa siirtää laskutuksen toimitusputken jälkeen tehtävään
rajattuun runtime- ja rakennecleanupiin, mutta niitä ei saa unohtaa tai ohittaa
ennen oikeaa tuotantodataa:

- reittien kovakoodatut `dev-company`- ja `dev-user`-arvot
- toteutetun `ActorContext`-mallin kytkeminen backendin vahvistamaan sessioniin
- päätetyn Electron-bootstrapin runtime- ja paketointitoteutus
- kirjoittavien ja arkaluonteisten reittien permission-middleware
- Viten toistuvan backend-proxyosoitteen keskittäminen
- runtime-profiilien tyypitetty konfiguraatiomalli `packages/config`-rajalla

Laaja cleanup voidaan ajoittaa laskutusmoduulin valmistumisen jälkeen. Oikean
SMTP-salaisuuden HTTP/UI-polku, oikea asiakkaalle lähetys ja oikean asiakas- tai
laskutusdatan tuotantokäyttö eivät kuitenkaan saa ohittaa local desktop
-luottamusrajan toteutusta ja release security review -tarkistusta.

## Ei Vielä Toteuteta

- local-session-koodia
- HTTP-auth-middlewarea
- Firebase Authia
- SMTP-salaisuuden HTTP- tai UI-polkuja
- Windows Credential Manager -adapteria
- SMTP-provideria
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
