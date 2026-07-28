# Diagnostics-moduuli

## Tarkoitus

Diagnostics tarjoaa käyttäjälle rajatun, vain lukuun tarkoitetun teknisen
näkymän Eky-runtimen operational- ja security-tapahtumista.

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

Paketoidun desktopin smoke todentaa koko julkisen diagnostiikkaketjun
JSONL-readerista HTTP-projektioon, API-clientin strict parseriin ja oikeaan
paketoituun Diagnostiikka-näkymään. Tuntematon vanha JSONL-event voidaan
ohittaa turvallisesti, mutta HTTP-projektion tuntematon event torjutaan
clientissä.

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
`companyId`- tai actor-tunnisteita, correlation-tunnisteita, raakaa
lokisisältöä tai salaisuuksia.

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
