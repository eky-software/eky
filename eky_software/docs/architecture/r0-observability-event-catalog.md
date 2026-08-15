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
- `restore.rollbackStarted`
- `restore.rollbackCompleted`
- `restore.rollbackFailed`
- `restore.recoveryRequired`

`electron.permissionDenied` säilyy vain olemassa olevien lokien
yhteensopivuuden vuoksi. Tavallinen Chromiumin permission check estetään
hiljaisesti. Vain varsinainen permission request kirjoittaa deduplikoidun
`electron.permissionRequestBlocked`-eventin ilman raakaa URL-osoitetta.

Lokikansion capability kirjoittaa vain avatun, epäonnistuneen tai estetyn
toiminnon tapahtuman. Se ei tallenna absoluuttista polkua tai
Windows-käyttäjänimeä.

Portable-varmuuskopion tapahtumat sisältävät vain operaation
korrelaatiotunnisteen, rajatun vaiheen, keston ja turvallisen virhekoodin.
Niihin ei kirjoiteta kohde- tai lähdepolkua, yritystunnistetta, manifestia,
salasanaa eikä salt-, nonce- tai authentication tag -arvoja.

Recovery point -tapahtumien sallitut vaiheet ovat `automaticCheck` ja
`creation`. Luodun pisteen allowlistattu kind on `daily`, `weekly`, `monthly`,
`manual`, `preRestore` tai `preUpdate`. Restore-tapahtumien sallitut vaiheet
ovat `inspection`, `staging`, `activation`, `restoredProfile`,
`rolledBackProfile`, `activationRollback`, `startupRollback` ja
`failedSafeJournal`. `restore.activationFailed` käyttää aina vaihetta
`activation`. `restore.recoveryRequired` sallitaan vain failed-safe-journalin,
rollbackatun profiilin epäonnistuneen validoinnin tai epäonnistuneen
activation/startup-rollbackin yhteydessä.

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

### Local update

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
