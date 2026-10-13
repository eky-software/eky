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

Projektio ei sisällä raakaa JSONL-riviä, payload-metadataa, stack tracea,
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

Workspace-varmuuskopion tuonnin ja korvauksen `workspaceBackup.operationFailed`
sekä erillinen `workspaceBackup.cleanupFailed` kuuluvat tähän tekniseen
lukuprojektioon ja sanitoituun tukipakettiin. Niiden syy, käyttötapauksen
vaihe ja kentät tarkistetaan tapahtumakohtaisesti; raw Error, stack,
tietokantasisältö ja business-tunnisteet ovat kiellettyjä. Tarkka sopimus
on [tapahtumakatalogissa](../architecture/r0-observability-event-catalog.md#desktop-operational-ja-security).
Tapahtuman käyttötapaus ei yksin kerro, että palautus on osittain tehty tai
peruttu onnistuneesti. K:n tämän ketjun kohdenäyttö ja vielä avoimet portit
erotetaan [M1:n jatkamiskohdassa](../architecture/release-0.3.0-m1-preparation-plan.md#v2k-workspace-varmuuskopion-turvallinen-lukuketju).

Portable-backupin `backup.failed` ja `backup.inspectionFailed` säilyttävät
K-P3:n hyväksytyn teknisen ensisyyn nykyisessä `errorCode`-kentässä ennen
yleistä käyttäjävirhettä. Muut kentät ja incident-poissulut säilyvät
[tapahtumakatalogin](../architecture/r0-observability-event-catalog.md#desktop-operational-ja-security)
mukaisina. [V2m:n portable-tiedostoketju](../architecture/release-0.3.0-m1-preparation-plan.md#v2m-portable-backupin-turvallinen-lukuketju)
ja [V2n:n palautuskuluttajien erillinen näyttö](../architecture/release-0.3.0-m1-preparation-plan.md#v2n-palautuskuluttajien-turvallinen-ensisyy)
käyttävät nykyisiä palveluja ja oikeita lokitiedostoja synteettisillä porteilla.
Jälkimmäisessä ensivirhe ja rollbackin selvitystulos säilyvät erillisinä.
Aktivoinnin epävarma journal-valmistelu tai sulku välittää erikseen myös
`restore.recoveryRequired`-tilan allowlistatussa `activation`-vaiheessa.
Sen alkuperäinen syy säilyy edeltävässä `restore.activationFailed`-tapahtumassa;
tilatapahtuma ei väitä rollbackin alkaneen eikä sisällä journalin raakasisältöä.
Onnistuneen sisältövalidoinnin jälkeinen `restore.acceptanceFailed`
erottaa hyväksynnän valmistelun, julkaisun ja loppusiivouksen. Se säilyttää
turvallisen ensisyyn myös hallittuun uudelleenkäynnistykseen päättyvässä
haarassa. Vaihe ei todista journalin lopputilaa, eikä tapahtuma muuta
aiempaa `restore.validationCompleted`-tulosta. Sen pakolliset kentät ja
suljettu syyjoukko tarkistetaan kaikilla lukurajoilla
[katalogin mukaan](../architecture/r0-observability-event-catalog.md#desktop-operational-ja-security).
[V2o:n lukijapariteetti](../architecture/release-0.3.0-m1-preparation-plan.md#v2o-palautustapahtumien-lukijoiden-sopimustarkistus)
tarkistaa myös API-clientissä ja tukipaketissa tapahtuman perheen, tason,
lopputuloksen, vaiheen, pakolliset kentät ja sallitun metadatan.
Kelvollisen vanhan projektion valinnaiset kentät säilyvät valinnaisina.
Tapahtumakatalogin sallima turvallinen virhesormenjälki säilyy;
toisen tapahtumaperheen tiedot hylätään. Tämä on kohdetodennettu
tiedostoketju, ei renderer-IPC:n tai todellisen Electron-mainin/paketoidun
sovelluksen hyväksyntä. [V2p:n erillinen tuontikoe](../architecture/release-0.3.0-m1-preparation-plan.md#v2p-tuonnin-todellinen-mainipc-lukuketju)
todentaa import-as-new-polun schema-hylkäyksen oikean mainin ja hallitun
uudelleenkäynnistyksen kautta samoihin lukijoihin sekä tarkistettuun
gzip-tukipakettiin. Yksityiskohtainen loki ja minimoitu incident-indeksi
ovat eri projektioita, eivät saman listan kaksi diagnostiikkatapahtumaa.
[V2q:n korvauskoe](../architecture/release-0.3.0-m1-preparation-plan.md#v2q-korvauksen-todellinen-mainipc-lukuketju)
todentaa erikseen saman schema-syyn todellisen main/IPC-, native-vahvistus-,
uudelleenkäynnistys- ja lukijaketjun aktiivisen yrityksen korvauksessa.
Varmuuskopion jälkeinen asiakas, lasku, PDF ja yritysrekisteri säilyvät;
`unknown`-sivuvaikutusluokitus ei muutu tämän jälkivarmennuksen perusteella.
V2p/V2q ovat rajattuja erillistodisteita. Niitä täydentävät
[V2r:n pysyvät Electron-testit](../architecture/release-0.3.0-m1-preparation-plan.md#v2r-pysyvät-workspace-schema-hylkäystestit)
tuonnin ja korvauksen schema-hylkäykselle. Ne käyttävät nykyistä fixtureä,
todellista main/IPC-ketjua ja samoja tiedostolukijoita; kohdeajo läpäisi,
mutta normaalin PR/CI-kierroksen hyväksyntä on vielä avoin.
K3:n muiden kuluttajien todelliset runtime-polut ja paketoidun sovelluksen
hyväksyntä pysyvät erillisinä avoimina portteina.

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
