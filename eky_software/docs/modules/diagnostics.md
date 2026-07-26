# Diagnostics-moduuli

## Tarkoitus

Diagnostics tarjoaa käyttäjälle rajatun, vain lukuun tarkoitetun teknisen
näkymän Eky-runtimen operational- ja security-tapahtumista.

## Omistajuus

Diagnostics omistaa vain turvallisen lukuprojektion. Se ei omista
operational-lokien kirjoittamista, business auditia, sovelluksen
liiketoimintadataa eikä desktopin käyttöjärjestelmäcapabilityja.

## Turvallinen projektio

Julkinen projektio sisältää vain:

- UTC-aikaleiman
- tunnetun tapahtumanimen
- komponentin
- kategorian
- tason ja lopputuloksen
- valinnaisen turvallisen virhekoodin
- projektion sisäisen tapahtumatunnisteen

Projektio ei sisällä raakaa JSONL-riviä, payload-metadataa, stack tracea,
paikallista polkua, actor-, company-, entity- tai correlation-tunnistetta,
liiketoimintasisältöä, yhteystietoja, pankkitietoja eikä salaisuuksia.

Backend lukee vain compositionissa annetusta absoluuttisesta Eky logs-rootista.
HTTP-pyyntö ei voi antaa polkua, tiedostonimeä tai globia. Tuntemattomat
tiedostot, symlinkit, katkenneet rivit ja uudelleenvalidoinnin hylkäämät eventit
ohitetaan.

Käyttötapaus vaatii `viewDiagnostics`-oikeuden. Browser-developmentissa
diagnostiikkalista voi olla tyhjä, jos backendille ei ole annettu logs-rootia.

Lokikansion avaaminen ja tukipaketin tallennus toteutetaan erillisinä Electron
mainin omistamina, käyttäjän käynnistäminä capabilityina.

## Tukipakettiprojektio

Backend tarjoaa tukipakettia varten erillisen `createSupportBundle`-
permissionilla suojatun read-only-projektion. Se sisältää vain:

- backend-version
- SQLite `quick_check` -tuloksen
- ajettujen migraatioiden määrän ja viimeisimmän turvallisen migraationimen
- enintään 5 000 viimeisen 30 päivän sanitoitua warn-, error- tai
  security-diagnostiikkatapahtumaa
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
checksumillisen gzip-pakatun `.ekysupport`-tiedoston ja kirjoittaa sen
käyttäjän vahvistamaan kohteeseen. Renderer ei anna backend-osoitetta,
runtime-sessionia, tiedostopolkua eikä tukipaketin sisältöä.
