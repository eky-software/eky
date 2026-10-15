# R0 observability event catalog

Tämä on Eky R0:n vakaa tuotantoperustan lähtöluettelo. Toteutuksen pitää
käyttää täsmällisiä tyypitettyjä event-nimiä niiden omistavan moduulin tai
infrastruktuurivastuun kautta. Uusi nimi lisätään katalogiin ja testeihin
ennen instrumentointia. Moduuli ei rakenna katalogin rinnalle yleistä
logger-manageria tai arbitrary metadata -kanavaa.

Operational-eventien yhteinen build-konteksti on validoitu `appVersion`,
`buildRevision` ja käynnistyskohtainen `runtimeInstanceId`. Tunnisteet eivät
ole käyttöoikeus- tai autentikointitietoja.

## Backend operational

### Runtime ja database

- `backend.starting`
- `backend.started`
- `backend.shutdownStarted`
- `backend.shutdownCompleted`
- `database.opening`
- `database.opened`
- `database.openFailed`
- `database.integrityCheckFailed`
- `migration.started`
- `migration.completed`
- `migration.failed`

`migration.failed` ei väitä koko startup-ajon peruuntuneen. Yksi migraatio
suoritetaan yhdessä transaktiossa, mutta aikaisemmin saman käynnistyksen aikana
valmistuneet migraatiot voivat jo olla pysyviä. Tapahtuman
`sideEffectState` on siksi aina `unknown`. Sallittu lisämetadata on vain
allowlistattu `failureStage`, turvallinen `errorCode`, tämän ajon aikana
valmistuneiden migraatioiden lukumäärä ja kesto. SQL:ää, migraation nimeä,
tiedostopolkua, tietokantavirhettä tai stackia ei kirjata.

### HTTP ja authorization

- `http.requestFailed`
- `http.unknownRoute`
- `http.invalidBody`
- `permission.denied`
- `tenant.boundaryBlocked`
- `runtimeSession.missing`
- `runtimeSession.invalid`

`http.invalidBody` sisältää correlation ID:n lisäksi turvallisen
virheluokan ja vaiheen. Kun reitti on ottanut käyttöön tyypitetyn
HTTP-operationaalisen kontekstin, eventti saa sisältää myös vakaan loogisen
toiminnon, kuten `invoiceDraft.create`. `http.requestFailed` saa käyttää samaa
toiminto- ja vaihekontekstia odottamattoman virheen rajaamiseen. Kentät ovat
allowlistattuja eivätkä saa sisältää raakaa reittiä, resurssi-ID:tä,
query-parametreja, Content-Type-arvoa, request bodya, funktion argumentteja,
poikkeuksen viestiä tai stackia. Reitti ilman tyypitettyä kontekstia käyttää
edelleen geneeristä turvallista fallback-luokitusta.

### Laskudokumentit ja toimitus

- `invoicePdf.generationFailed`
- `invoicePdf.storageFailed`
- `invoicePdf.missingFile`
- `invoiceDelivery.prepareBlocked`
- `invoiceDelivery.providerFailed`
- `invoiceDelivery.outcomeUnknown`
- `invoiceDelivery.finalizationFailed`
- `smtp.connectionFailed`
- `smtp.connectionSecured`
- `smtp.tlsFailed`
- `smtp.authenticationFailed`
- `smtp.deliveryCompleted`
- `smtp.deliveryFailed`
- `smtp.deliveryOutcomeUnknown`
- `businessAudit.writeFailed`

B3:n nykyisen PDF:n GET-/metadataluvun ja tapahtumaan sidotun historiallisen
PDF-luvun eheysvirhe käyttää olemassa olevaa
`invoicePdf.storageFailed`-eventtiä: `INVOICE_PDF_INTEGRITY_FAILED`,
`stage=read`, `retryable=false`, `sideEffectState=none`. Puuttuva esikatselu
(404), puuttuva historiallinen tapahtuma (404), vanhan tapahtuman alkuperäinen
null-PDF-viite (409) tai välissä vaihtunut nykyvalinta (409) ei ole
tiedostoeheysvirhe. Tapahtuman rikkinäinen ei-null-viite on eheysvirhe.
Detailed-eventin rajatut entity-tunnisteet eivät siirry Diagnosticsiin,
tukipaketin lukuprojektioon tai incident-indeksiin. Raakavirheitä, PDF-tavuja,
tiivisteitä tai polkuja ei kirjata. Luku ei tuota business-audit-tapahtumaa.

B-P3:n säilytetyn PDF:n esivalmistelu käyttää samaa eheysvirheen tapahtumaa,
mutta `sideEffectState=unknown`: itsenäinen kopio on voinut jo syntyä.
Jos julkaisukonfliktin jälkeen operaation oman ehdokastiedoston siivous
epäonnistuu, sama `invoicePdf.storageFailed` sisältää
`INVOICE_PDF_CLEANUP_FAILED`, `stage=cleanup`, `retryable=false` ja
`sideEffectState=unknown`. Alkuperäinen konfliktivastaus säilyy eikä
lokitusvirhe korvaa sitä. Diagnostics, tukipaketin diagnostiikkaprojektio ja
incident-indeksi lukevat nykyistä sanitoitua ketjua; polkua, raakavirhettä,
PDF-tavuja tai tiivistettä ei julkaista. Esivalmistelu ei luo toimitus- tai
Activity-tapahtumaa. Tämä ei muuta lokien säilytysaikoja tai käynnistä
automaattista tiedostojen lisäsiivousta.

Säilytetyn dokumentin täsmällinen HTTP-luku käsittelee tunnetun eheysvirheen
yllä olevalla `invoicePdf.storageFailed`-tapahtumalla ja `none`-
sivuvaikutuksella. Odottamaton luokittelematon poikkeama rajataan geneeriseksi
500-vastaukseksi ennen kehyksen raakaa stderr-käsittelyä. Nykyinen HTTP-
middleware kirjaa silloin `http.requestFailed` / `HTTP_REQUEST_FAILED`;
luokittelematonta syytä ei väitetä tiedostoeheysvirheeksi. Tämä käyttää
olemassa olevaa Diagnostics-/tukipaketti-/incident-ketjua eikä muuta
tapahtumien kenttä- tai säilytysrajoja.

B4:n durablen asiakaslähetyksen jälkeinen laskun vastausluvun virhe käyttää
olemassa olevaa `invoiceDelivery.finalizationFailed`-eventtiä:
`INVOICE_DELIVERY_COMMITTED_READ_FAILED`, `stage=read`, `retryable=false`,
`sideEffectState=committed`. Tämä ei tarkoita SMTP-lähetyksen epäonnistumista
eikä oikeuta automaattista uudelleenlähetystä. Tapahtuma, laskun sent-tila ja
attemptin onnistuminen säilyvät. Diagnostics, tukipaketin diagnostiikkaluku
ja incident-indeksi käyttävät nykyisiä minimoituja projektioita; raakavirhe,
viestisisältö, valtuutus ja business-tunnisteet eivät siirry niihin.
Oikean composition-/HTTP-/lokikytkennän alempi testi on
`invoicingSmtpComposition.test.ts`; UI-/native-hyväksyntä on vielä avoin.

B-P3:n vanhan approved-laskun selvitysesto käyttää nykyistä
`invoiceDelivery.prepareBlocked`-varoitusta:
`INVOICE_LEGACY_DELIVERY_REVIEW_REQUIRED`, `stage=prepare`,
`retryable=false`, `sideEffectState=none`. Esto koskee myös vanhan laskun
uudelleenavausta muokattavaksi; se ei ole SMTP-providerin virhe.
Tapahtumaan ei lisätä lasku-, yritys- tai käyttäjätunnisteita tai raakavirhettä.
Diagnostics ja tukipaketin diagnostiikkaluku säilyttävät turvallisen syyn.
Varoitus ei kuulu pitkän ajan incident-indeksiin eikä luo business-audit-
tapahtumaa tai Activity-merkintää. Oikea composition-/HTTP-/lokikytkentä ja
lukuprojektiot todennetaan `invoicingLegacyReviewComposition.test.ts`:ssä;
käyttöliittymän koko native-polun hyväksyntä on erillinen portti.

`smtp.connectionSecured` ja `smtp.deliveryCompleted` ovat 12 kuukauden
info-eventtejä. Detailed-loki saa sisältää vain SMTP-profiilin, portin 465,
TLS-version, allowlistatun cipherin, sertifikaatin SHA-256-sormenjäljen,
validoidun etä-IP:n ja IP-perheen, attempt ID:n, stagen ja keston.
Diagnostics-projektio saa näyttää vain SMTP-profiilin, TLS-version, cipherin
ja sormenjäljen. Etä-IP, portti ja attempt ID eivät siirry tukipakettiin tai
incident-indeksiin.

Failure-mapping:

- `SMTP_TLS_FAILED` -> `smtp.tlsFailed`
- `SMTP_AUTHENTICATION_FAILED` ja `SMTP_AUTHENTICATION_UNAVAILABLE`
  -> `smtp.authenticationFailed`
- `SMTP_CONNECTION_FAILED` sekä connect-vaiheen sulkeutuminen ja timeout
  -> `smtp.connectionFailed`
- `SMTP_OUTCOME_UNKNOWN` -> `smtp.deliveryOutcomeUnknown`
- muut greeting-, envelope-, DATA-, protokolla-, sulkeutumis- ja timeout-
  virheet -> `smtp.deliveryFailed`

Failure-eventti sisältää turvallisen error coden, operation ID:n, stagen,
keston, retryable- ja side-effect-tilan. Jos TLS-transportin turvallinen
diagnostiikkayhteenveto on saatavilla, detailed-eventti saa lisäksi
allowlistatut SMTP-, TLS-, cipher-, sormenjälki- ja etäverkkokentät.
Diagnostiikkakirjoitus on best effort eikä saa muuttaa toimituksen
lopputulosta.

Implicit TLS portissa 465, `rejectUnauthorized`, sertifikaatin ja hostnamen
validointi sekä TLS 1.2/1.3 -raja ovat ehdottomia turvallisuusportteja.
Cipherin nimi, sormenjälki ja etäverkkokentät ovat diagnostiikkametadataa:
niiden puuttuminen tai tuntematon turvallinen arvo jättää transport-
yhteenvedon ja `smtp.connectionSecured`-eventin pois, mutta ei muuta
turvallista TLS-yhteyttä virheeksi.

### Diagnostiikka

- `operationalLog.capacityReached`
- `operationalLog.writeFailed`
- `operationalLog.retentionCompleted`
- `businessAudit.retentionCompleted`
- `businessAudit.retentionFailed`

`operationalLog.capacityReached`- ja `operationalLog.writeFailed`-tilanteista
kirjoitetaan enintään yksi prosessikohtainen, ei-rekursiivinen yhteenveto
olemassa olevaan incident-indeksiin per event- ja stream-yhdistelmä.
Yhteenveto ei sisällä company-, actor- tai entity-tunnisteita eikä
liiketoimintasisältöä.

## Desktop operational ja security

- `desktop.starting`
- `desktop.started`
- `desktop.bootstrapFailed`
- `desktop.shutdownStarted`
- `desktop.shutdownCompleted`
- `desktop.shutdownFailed`
- `backendProcess.starting`
- `backendProcess.started`
- `backendProcess.healthFailed`
- `backendProcess.unexpectedExit`
- `backendProcess.stopFailed`
- `applicationWindow.loadFailed`
- `applicationWindow.renderProcessGone`
- `applicationWindow.navigationBlocked`
- `applicationWindow.newWindowBlocked`
- `electron.permissionDenied`
- `electron.permissionRequestBlocked`
- `pdfPreview.openFailed`
- `secretStorage.decryptFailed`
- `secretStorage.writeFailed`
- `packagedSmoke.started`
- `packagedSmoke.completed`
- `packagedSmoke.failed`
- `operationalLog.writeFailed`
- `operationalLogFolder.opened`
- `operationalLogFolder.openFailed`
- `operationalLogFolder.requestBlocked`
- `supportBundle.creationStarted`
- `supportBundle.creationCompleted`
- `supportBundle.creationFailed`
- `backup.started`
- `backup.completed`
- `backup.failed`
- `backup.inspectionCompleted`
- `backup.inspectionFailed`
- `recoveryPoint.started`
- `recoveryPoint.completed`
- `recoveryPoint.failed`
- `restore.inspectionCompleted`
- `restore.inspectionFailed`
- `restore.stagingCompleted`
- `restore.stagingFailed`
- `restore.activationStarted`
- `restore.activationFailed`
- `restore.validationCompleted`
- `restore.validationFailed`
- `restore.acceptanceFailed`
- `restore.rollbackStarted`
- `restore.rollbackCompleted`
- `restore.rollbackFailed`
- `restore.recoveryRequired`
- `workspaceBackup.operationFailed`
- `workspaceBackup.cleanupFailed`

`electron.permissionDenied` säilyy vain olemassa olevien lokien
yhteensopivuuden vuoksi. Tavallinen Chromiumin permission check estetään
hiljaisesti. Vain varsinainen permission request kirjoittaa deduplikoidun
`electron.permissionRequestBlocked`-eventin ilman raakaa URL-osoitetta.

Lokikansion capability kirjoittaa vain avatun, epäonnistuneen tai estetyn
toiminnon tapahtuman. Se ei tallenna absoluuttista polkua tai
Windows-käyttäjänimeä.

### Tarkistuksen ensisyy ja lukijaketju

K-P3:n suljetut tekniset tarkistussyyt ovat:

- `PROFILE_SCHEMA_UNSUPPORTED`
- `PROFILE_INSPECTION_LIMIT_EXCEEDED`
- `PROFILE_INSPECTION_TIMEOUT`
- `PROFILE_INSPECTION_PROTOCOL_INVALID`
- `PROFILE_INSPECTION_CLEANUP_UNVERIFIED`

Koodi valitaan vain bounded ensivirhehaarasta. Tuntematon, syklinen, liian
syvä tai poikkeuksen heittävä ketju säilyttää kuluttajan nykyisen yleiskoodin;
ordered aggregaten myöhempi cleanup-haara ei korvaa ensisyytä. Pelkästä
exit-koodista tai vaiheesta ei päätellä OOM:ia, schema-poikkeamaa, onnistunutta
rollbackia tai sivuvaikutuksettomuutta. Väärän salasanan ja autentikointivirheen
yhteinen käyttäjäilmoitus pysyy muuttumattomana. Raakaa `Error.cause`-oliota,
SQL:ää, polkua, profiilitunnistetta tai checksumia ei projisoida eteenpäin.

Omistava runtime kytkee observerin nykyiseen operational-writeriin ja
runtime-identiteettiin. Todellinen reader -> HTTP -> strict client ->
Diagnostics sekä sanitoitu tukipaketti vaativat saman tapahtumakohtaisen
sopimuksen; loggerin yksikkötesti ei todista tätä ketjua. Keskeytynyt
tarkistus ei tarkoita osittaista palautusta tai oikeutta korvata aktiivista
yritysdataa. Teknisiä backup-tapahtumia ei lisätä Activityyn tai business-
auditiin; incident-projektio säilyttää vain nykyisen minimoidun ytimen.

Portable-varmuuskopion tapahtumat sisältävät vain operaation
korrelaatiotunnisteen, rajatun vaiheen, keston ja turvallisen virhekoodin.
Niihin ei kirjoiteta kohde- tai lähdepolkua, yritystunnistetta, manifestia,
salasanaa eikä salt-, nonce- tai authentication tag -arvoja.

`backup.failed` ja `backup.inspectionFailed` käyttävät K-P3:n hyväksyttyä
teknistä tarkistussyytä vain bounded ensivirhehaarasta: schema-hylkäys,
resurssiraja, tarkistuksen aikakatkaisu, private-protokollan hylkäys tai
varmentamaton tarkistusprosessin siivous. Tuntematon syy säilyttää vastaavasti
`PROFILE_BACKUP_CREATE_FAILED`- tai `PROFILE_BACKUP_INSPECTION_FAILED`-koodin.
Siivoushaaraa ei nosteta ensisyyksi eikä IPC-virhe sisällä sisäistä syyoliota.
Syyjoukon ja lukijaketjun nykyisen sopimuksen omistaa tämä osio;
päivätty hyväksyntänäyttö on [M1:n kautta](release-0.3.0-m1-preparation-plan.md#jatka-tästä).
Tämä ei muuta tapahtumien `portable`-vaihetta, tasoa, retryable- tai
side-effect-kenttää. Incident-indeksiin kuuluu error-tason `backup.failed`,
ei warn-tason `backup.inspectionFailed` tai info-tapahtumia.

Palautuksen `restore.inspectionFailed`, `restore.stagingFailed`,
`restore.activationFailed` ja `restore.validationFailed` sekä
`recoveryPoint.failed` käyttävät samaa K-P3:n rajattua ensisyyvalintaa.
Tuntematon tarkistussyy säilyttää kuluttajan nykyisen turvallisen
fallbackin; ordered aggregaten lisävirhettä ei nosteta ensisyyksi.
Ulompi virhe, palautuspisteiden saatavuus ja rollbackin ohjaus eivät muutu.
`restore.rollbackFailed` ja `restore.recoveryRequired` säilyttävät
`PROFILE_RESTORE_RECOVERY_REQUIRED`-koodin erillään alkuperäisestä syystä.
Sisäisen ensisyyn ja erillisen lisävirheen yhteinen sääntö on
[virheenkäsittelyohjeessa](error-handling-principles.md#ensisyy-ja-erillinen-lisävirhe).

`restore.acceptanceFailed` kuuluu onnistuneen sisältövalidoinnin jälkeiseen
hyväksyntään. Omistava palautuspalvelu kirjaa sen kerran ennen virheen
välittämistä myös lykätyssä hyväksynnässä ja aiemmin hyväksytyn journalin
loppusiivouksessa. `restore.validationCompleted` pysyy totuudenmukaisena;
hyväksyntävirheestä ei tehdä `restore.validationFailed`-tapahtumaa.
Taso on `error`, kategoria `restore` ja lopputulos `failure`.
Pakolliset nykyiset payload-kentät ovat tekninen `correlationId`,
`durationMs`, `stage`, `errorCode`, `retryable: false` ja
`sideEffectState: unknown`. Sallitut vaiheet ovat:

- `acceptancePreparation`: hyväksynnän valtuuden valmistelu ennen transaktion kutsua
- `acceptanceCommit`: hyväksynnän julkaisu ja sen tuloksen tarkistus
- `acceptedCleanup`: hyväksytyn aineiston loppusiivous, myös valtuuden vapautus sen jälkeen

Vaihe on viimeksi aloitettu työ, ei juurisyy tai varma journalin lopputila.
`errorCode` on yksi K-P3:n viidestä ensisyystä (`PROFILE_SCHEMA_UNSUPPORTED`,
`PROFILE_INSPECTION_LIMIT_EXCEEDED`, `PROFILE_INSPECTION_TIMEOUT`,
`PROFILE_INSPECTION_PROTOCOL_INVALID`, `PROFILE_INSPECTION_CLEANUP_UNVERIFIED`)
tai tuntemattoman syyn `PROFILE_RESTORE_RECOVERY_REQUIRED`.
Lisävirhettä ei nosteta tuntemattoman ensisyyn tilalle. Korrelaatio säilyy
myös journalin onnistuneen poiston jälkeisessä valtuuden vapautusvirheessä.
Writer, Diagnostics, API-client ja tukipaketin lukija vaativat tämän saman
suljetun sopimuksen; uusi tapahtuma ei peri vanhojen tapahtumien valinnaisia
payload-kenttiä. Raakavirhettä, syyoliota tai uutta metadataa ei lisätä.
Mahdollinen `restore.recoveryRequired` säilyy erillisenä tilatapahtumana.
Operational-kirjoituksen epäonnistuminen ei korvaa alkuperäistä virhettä.

Backup-, recoveryPoint- ja restore-tapahtumien projektion kentät ja
semantiikka tarkistetaan uudelleen myös API-clientin ja tukipaketin
lukurajoilla. Pelkkä tunnistemuotoinen vaihe ei riitä. Turvallinen
virhesormenjälki on sallittu nykyisen failure-payloadin mukaan;
onnistumistapahtuma ei saa virheen tai toisen perheen metadataa.
Jo valinnaiset duration/retryable/side-effect- ja app/build/runtime-kentät
säilyvät valinnaisina, mutta activationFailed- ja recoveryRequired-ehtoja
ei löysennetä. Desktopin omistavia event-specejä käytetään sen omissa
lukijoissa; HTTP-clientin vastevalidointi pysyy riippumattomana backendin
ja desktopin sisäisistä tyypeistä. Väärä perhe, stage, kind, palautumistila
tai toisen perheen metadata hylätään. Backend hylkää myös puuttuvan tai
nykyisen HTTP-rajan ylittävän virhekoodin. Malformed-rivi ei syrjäytä
kelvollisia tapahtumia; tukipaketin lähteen osittaisuus ilmoitetaan.

Recovery point -tapahtumien sallitut vaiheet ovat `automaticCheck` ja
`creation`. Luodun pisteen allowlistattu kind on `daily`, `weekly`, `monthly`,
`manual`, `preRestore` tai `preUpdate`. Restore-tapahtumien sallitut vaiheet
ovat `inspection`, `staging`, `activation`, `restoredProfile`,
`rolledBackProfile`, `activationRollback`, `startupRollback`,
`failedSafeJournal` sekä yllä kuvatut kolme hyväksyntävirheen vaihetta.
`restore.activationFailed` käyttää aina vaihetta
`activation`. `restore.recoveryRequired` sallitaan lisäksi aktivoinnin
vaiheessa `activation`, jos valmistelujournalin pysyvä tila tai runtimen
pysähtyminen jää epävarmaksi. Muut sallitut yhteydet ovat failed-safe-journal,
rollbackatun profiilin epäonnistunut validointi ja epäonnistunut
activation/startup-rollback. Vaihe ei väitä, että aktiiviset tiedostot olisi
jo korvattu tai rollback aloitettu.

`restore.activationFailed` kirjoitetaan täsmälleen kerran aktivoinnin
epäonnistuessa ennen mahdollista rollbackia. Se sisältää vain teknisen
UUID-korrelaation, vaiheen, keston, turvallisen virhekoodin, `retryable`-arvon
ja `sideEffectState`-arvon. Rollbackia vaativan epäonnistumisen järjestys on
`restore.activationStarted` -> `restore.activationFailed` ->
`restore.rollbackStarted` -> `restore.rollbackCompleted` tai
`restore.rollbackFailed`.

`restore.recoveryRequired` tarkoittaa, ettei business-UI:ta voida avata
turvallisesti ilman manuaalista palautusta. Sen virhekoodi on aina
`PROFILE_RESTORE_RECOVERY_REQUIRED`, `retryable` on `false` ja
`sideEffectState` on `unknown`. Tapahtumaan ei kopioida journal phasea vapaana
tekstinä eikä journalin sisältöä.

Aktivoinnin valmisteluhylkäyksessä alkuperäinen `restore.activationFailed`
kirjataan ennen erillistä `restore.recoveryRequired`-tilaa. Ensimmäinen
säilyttää turvallisen ensisyyn; jälkimmäinen kertoo estyneestä jatkosta, ei
korvaa syytä. Desktop-writer, Diagnostics, API-client ja tukipaketin lukija
validoivat saman suljetun `activation`-vaiheen ja samat pakolliset kentät.

Restoren stagingissa luotu journalin `operationId` on satunnainen tekninen
UUID. Samaa arvoa saa käyttää prosessien yli vain operational-eventin
`correlationId`-kenttänä, jotta aktivointi, seuraavan prosessin validointi ja
mahdollinen rollback voidaan yhdistää. Sitä ei julkaista eventissä
`operationId`:nä, se ei ole backupin operation ID, eikä sitä viedä
incident-indeksiin. Raakaa aktivointijournalia ei lueta Diagnosticsiin tai
tukipakettiin.

Näiden eventien sallittu metadata rajoittuu korrelaatiotunnisteeseen,
allowlistattuun vaiheeseen ja recovery point -kindiin, kestoon, turvalliseen
virhekoodiin, retryable- ja side-effect-tilaan sekä yhteiseen validoituun
app/build/runtime-identiteettiin. Salasana, avain, salt, nonce, tag, manifesti,
entry- tai paikallinen polku, `profileId`, `companyId`, `invoiceId`,
`documentId`, `artifactId`, checksum-lista, journalin raakasisältö, raw Error
ja stack ovat kiellettyjä.

Recovery point- ja restore-eventit ovat teknistä Diagnostics-dataa. Niistä
ei muodosteta Activity-tapahtumaa eikä palautettavaan SQLite-kantaan
kirjoiteta business auditia. Operational-writerin virhe ei saa muuttaa
backupin, restoren, validoinnin tai rollbackin lopputulosta.

Workspace-tuonnin ja same-lineage-korvauksen hallintapalvelu toimittaa
`workspaceBackup.operationFailed`-tapahtuman nykyiseen operational-ketjuun.
Sen `errorCode` on ensimmäisen virhehaaran syvin tunnettu suljettu syy tai
`unknown`; raakaa poikkeusta tai kutsupinoa ei serialisoida. Virheketjun
luku on rajattu, ja rikkoutunut ketju jää tuntemattomaksi. Erillinen
`workspaceBackup.cleanupFailed` syntyy vain, jos järjestetty virheketju
sisältää myös palautuksen, siivouksen tai varauksen vapautuksen hylkäyksen.
Aikaisempi tuntematon lisävirhe ei vaihdu myöhemmäksi tunnetuksi syyksi.
Lisävirhe ei korvaa operaation ensisyytä.

Molemmissa tapahtumissa category on `backup`, level `error` ja outcome
`failure`. Sallittu payload on vain satunnainen `correlationId`, kesto,
suljettu `errorCode`, `retryable: false`, `sideEffectState: none|unknown`
sekä `stage: import|replace` ja yhteinen validoitu app/build/runtime-
identiteetti. Syyjoukon omistaa
`apps/desktop/src/runtime/workspaceCandidateMessages.ts`; Diagnostics-,
API-client- ja tukipakettilukijat tarkistavat oman rajansa saman suljetun
sopimuksen mukaan. Vapaa turvallisen näköinen merkkijono ei ole sallittu
syy tai vaihe. `stage` nimeää käyttötapauksen, ei todista sisäistä vaihetta
tai juurisyytä. Tapahtuma ei itsessään todista onnistunutta rollbackia.

Tapahtumat luetaan nykyiseen Diagnostics- ja sanitoituun tukipakettiin.
Error-tason incident-indeksi säilyttää nykyisen minimoidun tapahtuma-/
virhekoodiyhteenvedon, ei correlation-, runtime- tai business-tunnisteita.
Activityä, business auditia, retentionia tai tukipaketin formaattia ei muuteta.
Tuotannon composition välittää nykyisen loggerin ja runtime-identiteetin
havaitsijalle; kummankin tapahtuman best-effort-kirjoitus on erillinen eikä
saa muuttaa hallintatoiminnon palautusta tai peittää ensivirhettä.

### Local update

ADR-0010 omistaa päivityksen runtime- ja datarajat. C2:n jo määritellyt
`update.operationStarted`, `update.operationCompleted` ja
`update.operationFailed` sekä niiden `preUpdateRecovery`, `runtimeShutdown`,
`installerHandoff` ja `firstStartValidation` -vaiheet omistaa
[installer-suunnitelman nykyinen C2-sopimus](windows-installer-and-update-plan.md#16-health-ja-hyväksyntä).
Ne eivät automaattisesti laajenna alla olevaa C3C-sopimusta.

G:n [D029-02](diagnostics-0.2.9-completion-plan.md#d029-02-päivitystapahtumien-katalogikatkos)
omistaa toteuttamattoman lukijaketjun ja sen perhekohtaisen sisällytys- tai
poissulkukartan. C2:n julkinen projektio ja mahdollinen kohdeversiotieto
pysyvät siellä nimettyinä rajauksina; writerin olemassaolo ei hyväksy vientiä.
Nykyisiä kenttiä tai allowlistoja ei laajenneta dokumentaation siivouksessa.

Paikallisen päivityksen tekniset tapahtumaperheet ovat:

- `update.packageInspectionStarted|Succeeded|Failed`
- `update.packageStagingStarted|Succeeded|Failed`
- `update.currentPackageRegistrationStarted|Succeeded|Failed`
- `update.candidateDiscardStarted|Succeeded|Failed`
- `update.confirmationStarted|Succeeded|Failed`
- `update.recoveryPointStarted|Succeeded|Failed`
- `update.runtimeShutdownStarted|Succeeded|Failed`
- `update.installerHandoffStarted|Succeeded|Failed`
- `update.firstStartValidationStarted|Succeeded|Failed`
- `update.businessRollbackStarted|Succeeded|Failed`
- `update.binaryRollbackStarted|Succeeded|Failed`
- `update.restoreCompatibilityStarted|Succeeded|Failed`
- `update.installerNotApplied`
- `update.accepted`
- `update.recoveryRequired`.

Sallittu payload on rajattu `correlationId`-, allowlistattuun `stage`-,
`durationMs`-, turvalliseen `errorCode`-, `retryable`- ja
`sideEffectState`-kenttään sekä yhteiseen app/build/runtime-identiteettiin.
Raaka tiedostopolku, komentorivi, installer-output, manifesti, täysi hash,
`companyId`, `profileId`, asiakas- tai laskudata, salaisuus, runtime-session,
recovery-payload, raw Error ja stack ovat kiellettyjä. Update on teknistä
Diagnostics-dataa eikä Activity- tai business audit -dataa. Operational-
writerin virhe ei saa muuttaa päivityksen, hyväksynnän tai rollbackin
lopputulosta.

`desktop.bootstrapFailed` sisältää vain allowlistatun virhekoodin. Raw
virheviestiä, stack tracea, asar- tai käyttäjäpolkua ei kirjoiteta eventtiin
eikä näytetä käyttäjälle.

## Module-owned business audit

### Invoicing

Invoicing säilyttää nykyisen `invoice_audit_events`- ja
`invoice_delivery_events`-omistajuuden. Activity-projektio saa näyttää
turvalliset hyväksyntä-, lähetys-, peruutus- ja hyvitystapahtumat.

- `invoiceVatRates.updated`
- `invoiceNumberingSettings.updated`
- `invoicePaymentSettings.updated`

Laskutusasetusten audit ei tallenna asetusten vanhoja tai uusia arvoja.

### Customers

- `customer.created`
- `customer.updated`
- `customer.activated`
- `customer.deactivated`

Sallitut changed field categories:

- `identity`
- `contact`
- `billing`
- `pricing`
- `status`

### Company Settings

- `companySettings.updated`
- `companyEmailSecret.configured`
- `companyEmailSecret.removed`

Sallitut changed field categories:

- `identity`
- `address`
- `contact`
- `banking`
- `invoicingDefaults`
- `emailConfiguration`

Audit ei tallenna kenttäarvoja.

Activity saa näyttää Customers- ja Company Settings -päivityksistä korkeintaan
kolme allowlistattua muutoskategoriaa. Laajempi muutos näytetään yleisenä
usean tietoryhmän päivityksenä. Tuntematon, väärän moduulin tai kahdentunut
kategoria hylätään API-rajalla. Invoicing-asetusten vakaa action kertoo
muutoksen ryhmän eikä erillistä vapaata metadataa tarvita.

## Incident-indexiin oikeuttavat tapahtumat

Vain failure-, blocked- tai turvallisuusmerkityksinen event voidaan tiivistää
10 vuoden minimoituun incident-indeksiin ilman suoria tunnisteita. Indeksi ei
sisällä actor-, company- tai entity-tunnisteita.
Onnistuneita business-muutoksia ei indeksoida. Indeksiin ei myöskään viedä
runtime-, correlation- tai operation-tunnisteita eikä teknisen tapahtuman
vapaamuotoista sisältöä.
