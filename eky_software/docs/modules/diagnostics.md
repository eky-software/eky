# Diagnostics-moduuli

## Tarkoitus

Diagnostics tarjoaa käyttäjälle rajatun, vain lukuun tarkoitetun teknisen
näkymän Eky-runtimen operational- ja security-tapahtumista.

Diagnostiikan tarkennukset ja avoimet korjaukset on koottu dokumenttiin
[Diagnostiikan 0.3.0-täydennyssuunnitelma](../architecture/diagnostics-0.2.9-completion-plan.md).
Suunnitelma ei tarkoita, että korjaukset olisivat jo toteutettuja.

## Omistajuus

Diagnostics omistaa vain turvallisen lukuprojektion. Se ei omista
operational-lokien kirjoittamista, business auditia, sovelluksen
liiketoimintadataa eikä desktopin käyttöjärjestelmäcapabilityja.

## Turvallinen projektio

Runtime-yhteenveto sisältää validoidun sovellusversion, build revisionin,
build-ajan ja dirty-tilan sekä käynnistyskohtaisen runtime instance ID:n.

Julkinen tapahtumaprojektio sisältää vain:

- UTC-aikaleiman
- tunnetun tapahtumanimen
- komponentin
- kategorian
- tason ja lopputuloksen
- valinnaisen turvallisen virhekoodin
- projektion sisäisen tapahtumatunnisteen

Projektio ei sisällä raakaa JSONL-riviä, vapaamuotoista payload-metadataa, stack tracea,
paikallista polkua, actor-, company- tai entity-tunnistetta,
liiketoimintasisältöä, yhteystietoja, pankkitietoja eikä salaisuuksia.

Paikallinen, permission-suojattu tapahtumanäkymä saa näyttää vain erikseen
mallinnetut tekniset `correlationId`-, `operationId`- ja
`runtimeInstanceId`-tunnisteet. Ne eivät ole käyttäjä-, yritys- tai
autentikointitietoja eikä niitä viedä pitkäaikaiseen incident-indeksiin.
HTTP-tapahtuman `operationId` voi olla vakaa looginen käyttötapaus ja `stage`
sen allowlistattu käsittelyvaihe. Näkymä ei näytä sisäistä kutsupinoa,
funktion argumentteja, request bodya, reitti- tai resurssitunnisteita eikä
poikkeuksen raakaa viestiä.

SMTP-transportin Diagnostics-projektio näyttää failure- ja success-
tapahtumista vain allowlistatut SMTP-profiili-, TLS-versio-, cipher-,
sertifikaatin sormenjälki-, stage- ja kestokentät silloin, kun ne ovat
saatavilla. Detailed-lokin etä-IP, portti ja operation ID eivät kuulu
tukipakettiin tai pitkäaikaiseen incident-indeksiin. Onnistuneet info-eventit
eivät kuulu tukipakettiin.

Backend lukee vain compositionissa annetusta absoluuttisesta Eky logs-rootista.
HTTP-pyyntö ei voi antaa polkua, tiedostonimeä tai globia. Tuntemattomat
tiedostot, symlinkit, katkenneet rivit ja uudelleenvalidoinnin hylkäämät eventit
ohitetaan.

Käyttötapaus vaatii `viewDiagnostics`-oikeuden. Browser-developmentissa
diagnostiikkalista voi olla tyhjä, jos backendille ei ole annettu logs-rootia.

Lokikansion avaaminen ja tukipaketin tallennus toteutetaan erillisinä Electron
mainin omistamina, käyttäjän käynnistäminä capabilityina.

Paketoidun desktopin smoke todentaa edustavan julkisen diagnostiikkaketjun
JSONL-readerista HTTP-projektioon, API-clientin strict parseriin ja oikeaan
paketoituun Diagnostiikka-näkymään. Tuntematon vanha JSONL-event voidaan
ohittaa turvallisesti, mutta HTTP-projektion tuntematon event torjutaan
clientissä.

Smoke ei yksin todista kaikkien event-katalogien kattavuutta tai jokaisen
ominaisuuden observer-kytkentää. Niille tarvitaan erilliset sopimus- ja
composition-testit.

## K:n tarkistushylkäys ja lukuketju

K:n hyväksytty lukuketju on nykyinen sopimus; päivätty integraationäyttö ja
mahdollinen uusi havainto erotetaan
[M1:n jatkamiskohdassa](../architecture/release-0.3.0-m1-preparation-plan.md#jatka-tästä).
Vanhojen V2-checkpointien avoimet PR/CI-portit eivät ole nykyinen työjono.
K:n hyväksyntä ei tarkoita G:n kaikkien diagnostiikkatoiveiden valmistumista.

Workspace-composition välittää operational-loggerin ja runtime-identiteetin
observerille. Tuonnin ja same-lineage-korvauksen
`workspaceBackup.operationFailed` sekä todellisen lisävirheen erillinen
`workspaceBackup.cleanupFailed` kuuluvat tähän tekniseen projektioon ja
sanitoituun tukipakettiin. `stage: import|replace`, suljettu syy ja
tapahtumakohtaiset kentät validoidaan kaikilla rajoilla
[katalogin mukaan](../architecture/r0-observability-event-catalog.md#tarkistuksen-ensisyy-ja-lukijaketju).
Lisävirhe ei korvaa ensimmäistä syytä. `retryable: false` ja alkuperäinen
`sideEffectState: unknown` eivät muutu onnistuneen uudelleenkäynnistyksen
tai jälkivarmennuksen perusteella. Vaihe ei todista sisäistä juurisyytä,
osittaista palautusta tai onnistunutta rollbackia.

Portable-backupin `backup.failed` ja `backup.inspectionFailed` sekä
`restore.inspectionFailed`, `restore.stagingFailed`,
`restore.activationFailed`, `restore.validationFailed` ja
`recoveryPoint.failed` käyttävät vain katalogin viittä teknistä ensisyytä
tai kuluttajan nykyistä turvallista fallbackia. Raaka `cause`-olio ei kuulu
IPC:hen, lokiin tai tukipakettiin. `restore.rollbackFailed` ja
`restore.recoveryRequired` säilyttävät erillisen
`PROFILE_RESTORE_RECOVERY_REQUIRED`-selvityskoodin.

Aktivoinnin epävarman journal-valmistelun tai sulun alkuperäinen
`restore.activationFailed` edeltää erillistä
`restore.recoveryRequired`-tilaa allowlistatussa `activation`-vaiheessa.
Tilatapahtuma ei väitä rollbackin alkaneen. Sisältövalidoinnin jälkeinen
`restore.acceptanceFailed` erottaa `acceptancePreparation`-,
`acceptanceCommit`- ja `acceptedCleanup`-vaiheet eikä muuta aiempaa
`restore.validationCompleted`-tulosta. Sen pakolliset correlationId-,
durationMs-, stage-, errorCode-, retryable- ja sideEffectState-kentät
säilyvät pakollisina; vaihe ei todista journalin durable-lopputilaa.

API-client ja tukipakettilukija tarkistavat perheen, tason, lopputuloksen,
vaiheen, kindin, pakolliset kentät ja sallitun metadatan uudelleen.
Kelvollisen vanhan projektion app/build/runtime- sekä jo valinnaiset
duration/retryable/side-effect-kentät säilyvät valinnaisina.
Aktivointi-/recovery-required-/acceptance-failure-sopimuksia ei löysennetä.
Turvallinen virhesormenjälki säilyy vain katalogin sallimassa yhteydessä;
onnistumistapahtuma tai toinen perhe ei peri virheen metadataa.

Todellinen main/IPC-, native-vahvistus-, runtime-generationin vaihto ja
lukijaketju kuuluvat schema-hylkäyksen kuluttajakohtaiseen näyttöön.
Yksityiskohtainen operational-tapahtuma ja minimoitu incident-indeksi ovat
eri projektioita, eivät saman listan kaksi tapahtumaa. Incidentissä ei ole
correlation-, runtime- tai business-tunnisteita. Pelkkä no-op-loggerin
koostetesti ei todista lukuketjua. Pysyvät tuonti-/korvausregressiot
säilyttävät asiakas-/laskusisällön, PDF:t, yritysrekisterin ja omistetun
syötteen; aktiivisen SQLite-tiedoston raakatavujen identtisyyttä normaalin
WAL-sulkemisen yli ei väitetä.

Lokikansion avaaminen ei hyväksy rendereriltä polkua. Electron main muodostaa
kiinteän `userData/runtime/logs`-juuren, tarkistaa trusted main frame
-kutsujan eikä seuraa symlinkkiä. Smoke käyttää `openPath`-stubia eikä avaa
Explorer-ikkunaa.

Electronin tavallinen permission check estetään ilman eventtiä. Todellinen
permission request estetään, luokitellaan ilman raakaa URL:ia ja
deduplikoidaan saman runtime-käynnistyksen aikana.

Varhaisen desktop-käynnistyksen virhe näyttää vain vakioidun suomenkielisen
ilmoituksen. Smoke saa vain allowlistatun virhekoodin. Jos operational logger
on jo käytettävissä, virheestä kirjoitetaan turvallinen
`desktop.bootstrapFailed`-eventti.

## Tukipakettiprojektio

Backend tarjoaa tukipakettia varten erillisen `createSupportBundle`-
permissionilla suojatun read-only-projektion. Se sisältää vain:

- backend-version
- SQLite `quick_check` -tuloksen
- ajettujen migraatioiden määrän ja viimeisimmän turvallisen migraationimen
- enintään 5 000 viimeisen 30 päivän sanitoitua warn-, error- tai
  security-diagnostiikkatapahtumaa
- enintään 16 MiB diagnostiikkatapahtumia ja 4 MiB minimoituja
  incident-yhteenvetoja 25 MiB:n kokonaisbudjetissa, jossa ydinosioille
  varataan vähintään 5 MiB
- tiedon siitä, katkaistiinko tapahtumaosio

Projektio ei palauta tietokantapolkua, business-taulujen rivejä,
`companyId`- tai actor-tunnisteita, raakaa lokisisältöä tai salaisuuksia.
Tekninen korrelaatiotunniste on sallittu vain erikseen hyväksytyssä
tapahtumaprojektiossa `support-bundle-plan.md`:n mukaisesti; esimerkiksi
recovery/restore-tapahtumien satunnainen `correlationId` on tällainen.
Tämä ei salli business-tunnisteita, runtime-sessionia tai korrelaatiota
pitkäaikaiseen incident-indeksiin.

Tukipakettidatan HTTP-reitti ei kuulu rendererin yleiseen desktop-protokollan
allowlistiin eikä API-clientin julkiseen sopimukseen. Paketoidussa
desktopissa vain Electron main hakee projektion vahvistetulla
runtime-sessionilla. Browser-kehityksessä tukipaketin luontitoimintoa ei
näytetä.

Electron main validoi backend-vastauksen uudelleen, muodostaa
checksumillisen gzip-pakatun `.json.gz`-tiedoston ja kirjoittaa sen
käyttäjän vahvistamaan kohteeseen. Renderer ei anna backend-osoitetta,
runtime-sessionia, tiedostopolkua eikä tukipaketin sisältöä. Legacy-
`.ekysupport`-paketit säilyvät virallisen tarkastimen tukemina.

Support bundle -adapterit käyttävät yhtä Diagnostics-moduulin sisäistä
bounded JSONL -tiedostolukijaa. Primitive omistaa vain regular file/no symlink
-tarkistuksen, rajatun tail-luvun, osittaisen ensimmäisen rivin poisjätön sekä
`bytesRead`- ja `sourceTruncated`-tiedot. Tapahtumavalinta, domainvalidointi,
ryhmittely, deduplikointi ja budjetit säilyvät erillisissä read model
-adaptereissa.

Jos lopullinen kokobudjetti ylittyy, Electron main säilyttää uusimmat
prefiksit, katkaisee ensin diagnostiikkatapahtumia ja vasta niiden
tyhjennyttyä incident-yhteenvetoja. Manifestin truncation-tiedot ja
checksumit vastaavat aina lopullista sisältöä.

R0:n tekniset retention-ajat ovat info 12 kuukautta,
warning/error/security 24 kuukautta, minimoitu incident-indeksi ilman suoria
tunnisteita 10 vuotta ja runtimen väliaikainen tukipaketti 30 päivää.
Moduulien business audit säilyy tapahtumavuoden ja seitsemän täyden
kalenterivuoden ajan. Nämä tekniset säännöt eivät yksin ole oikeudellinen
compliance-sertifiointi.
