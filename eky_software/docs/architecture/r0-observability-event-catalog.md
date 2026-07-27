# R0 observability event catalog

Tämä on Eky R0:n vakaa lähtöluettelo. Toteutuksen pitää käyttää täsmällisiä
tyypitettyjä event-nimiä. Uusi nimi lisätään katalogiin ja testeihin ennen
instrumentointia.

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

### HTTP ja authorization

- `http.requestFailed`
- `http.unknownRoute`
- `http.invalidBody`
- `permission.denied`
- `tenant.boundaryBlocked`
- `runtimeSession.missing`
- `runtimeSession.invalid`

### Laskudokumentit ja toimitus

- `invoicePdf.generationFailed`
- `invoicePdf.storageFailed`
- `invoicePdf.missingFile`
- `invoiceDelivery.prepareBlocked`
- `invoiceDelivery.providerFailed`
- `invoiceDelivery.outcomeUnknown`
- `invoiceDelivery.finalizationFailed`
- `smtp.connectionFailed`
- `smtp.tlsFailed`
- `smtp.authenticationFailed`
- `smtp.deliveryFailed`
- `smtp.deliveryOutcomeUnknown`
- `businessAudit.writeFailed`

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
- `pdfPreview.openFailed`
- `secretStorage.decryptFailed`
- `secretStorage.writeFailed`
- `packagedSmoke.started`
- `packagedSmoke.completed`
- `packagedSmoke.failed`
- `operationalLog.writeFailed`
- `supportBundle.creationStarted`
- `supportBundle.creationCompleted`
- `supportBundle.creationFailed`

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

## Incident-indexiin oikeuttavat tapahtumat

Vain failure-, blocked- tai turvallisuusmerkityksinen event voidaan tiivistää
10 vuoden indeksiin. Indeksi ei sisällä actor-, company- tai entity-tunnisteita.
Onnistuneita business-muutoksia ei indeksoida.
