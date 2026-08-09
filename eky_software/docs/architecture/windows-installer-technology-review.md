# Windows-installeriteknologian arvio

## Tila ja rajaus

Tämä arvio on 10.8.2026 tehty päätösportti. Se ei hyväksy riippuvuutta,
installeria, update-koodia, allekirjoitusavainta eikä release-artifactia.
Nykyinen baseline on `b50ec33fcddc03b20fbd09c9555099e415c2381f`.

Arvioidun desktop-pinon olennaiset versiot ovat:

- Electron `43.2.0`
- `better-sqlite3` `13.0.2`
- `@electron/packager` `20.0.4`
- `@electron/fuses` `2.1.3`

Nykyinen `package-windows.mjs` tuottaa kovennetun Windows-hakemiston, ei
asenninta. Se validoi native addonin, käyttää ASARia ja asettaa Electronin
fuset. Installerin pitää paketoida tämä jo tarkistettu kokonaisuus sitä
purkamatta tai rakentamatta uudelleen eri tavalla.

## Pakolliset ominaisuudet

R0-ehdokkaan pitää:

- käyttää samaa täyttä artifactia puhtaaseen asennukseen ja päivitykseen
- tukea ensisijaisesti per-user-asennusta ilman elevationia
- säilyttää vakaa app identity ja asennusjuuri
- korvata vain ohjelmabinaarit
- jättää Electron `userData` ja kaikki yritysprofiilit uninstallissa rauhaan
- antaa luotettava exit code ja tukea katkenneen asennuksen rollbackia
- toimia nykyisen Electron-, native addon-, ASAR- ja fuse-paketin kanssa
- olla rakennettavissa lukitusti Windows GitHub Actions -ympäristössä
- tukea Authenticode-allekirjoitusta ja RFC 3161 -aikaleimaa
- olla testattavissa clean install-, repair-, upgrade- ja rollback-poluissa.

R0 ei käytä hiljaista asennusta, delta-pakettia, automaattista latausta eikä
verkosta ohjattua päivitystä, vaikka valittu teknologia tukisi niitä.

## Vaihtoehto 1: nykyinen Packager-output sellaisenaan

Electron Packager muodostaa jaeltavan sovellushakemiston. Sen oma dokumentaatio
ohjaa käyttämään installerin tekemiseen Electron Forgea tai muuta erillistä
työkalua. Nykyinen ratkaisu on silti installerin hyvä, jo kovennettu input.

**Vahvuudet**

- ei uutta runtime- tai build-riippuvuutta
- nykyinen native addon-, ASAR-, fuse- ja packaged smoke -näyttö säilyy
- tiedostojoukko ja staging ovat Ekyllä tarkasti hallinnassa
- toimii myös portable-tyyppisessä sisäisessä testauksessa.

**Puutteet**

- ei clean install-, upgrade-, repair- eikä uninstall-semanticsia
- ei vakaata Windows Installer -tuoteidentiteettiä tai rekisteröityä asennusta
- ei transactional binary rollbackia eikä standardoitua exit code -mallia
- oma tiedostojen korvaaja kasvattaisi file lock-, antivirus-, rollback- ja
  oikeusmallin liian lähelle Eky-koodia.

**Johtopäätös:** Packager säilyy pakkausvaiheena, mutta sen päälle ei rakenneta
omaa yleistä filesystem-updateria. Se ei yksin täytä R0-porttia.

## Vaihtoehto 2: Electron Forge Squirrel.Windows

Electron Forge on Electronin ylläpidetty työkalu. Squirrel.Windows-maker
tuottaa `Setup.exe`-tiedoston, täyden NuGet-paketin ja release-metadatan.
Squirrel on luonteeltaan per-user ja tavallisesti ilman admin-oikeutta.

**Vahvuudet**

- Electron-ekosysteemiin sopiva ja tunnettu Setup-polku
- per-user-asennus sopii R0-pilotin lähtökohtaan
- Forge käyttää Electron Packager -pohjaa, joten nykyinen sovelluspaketti on
  käsitteellisesti yhteensopiva
- code signing on makerin tuettu käyttötapa.

**Heikkoudet ja avoimet riskit**

- vaatii uuden Forge-, maker-, Squirrel- ja niihin liittyvän build-ketjun;
  tarkka suora ja transitiivinen puu pitää tarkastaa vasta omistajan
  hyväksymässä dependency-spikessä
- Squirrel startup-eventit vaikuttavat sovelluksen lifecycleen
- release-metadata ja päivitysmalli tuovat R0:lle tarpeetonta update-pintaa
- Windows Installerin repair- ja upgrade-rollback-säännöt eivät ole yhtä
  suoraan Ekyssä authoroitavissa
- ensimmäisen käynnistyksen business-rollbackin ja edellisen allekirjoitetun
  binaariversion palautuksen yhteistyö vaatii oman kahden version testin.

**Johtopäätös:** varavaihtoehto, jos MSI-prototyyppi ei täytä per-user- tai
paketointivaatimuksia. Squirrel-riippuvuutta ei hyväksytä tässä arviossa.

## Vaihtoehto 3: Windows Installer -MSI WiXillä

MSI on Windowsin natiivi asennusmalli. WiX authoroi MSI-paketin nykyisen
Packager-outputin ympärille. Windows Installer tarjoaa install-, repair-,
uninstall- ja transaktiorollback-käytännöt sekä standardoidut exit codet.

**Vahvuudet**

- yksi täysi MSI voi palvella clean installia ja major upgradea
- paketti voidaan authoroida per-user-scopeen; per-machine voidaan arvioida
  myöhemmin erillisenä tuotteena eikä scopea vaihdeta kesken sarjan
- `MajorUpgrade`-ajoitus voidaan valita niin, että vanha versio voidaan
  palauttaa, jos uuden asennus epäonnistuu
- Windows Installer käsittelee repairin, tiedostokorvaukset, katkeamisen ja
  exit codet alustatasolla
- Packager-output, Electron, `better-sqlite3`, ASAR ja fuset pysyvät
  installerista riippumattomina payloadina
- MSI ja payload voidaan Authenticode-allekirjoittaa ja aikaleimata
- täysi paketti riittää R0:aan; WiX patch/Burn/delta-ominaisuuksia ei tarvita.

**Heikkoudet ja avoimet riskit**

- WiX on uusi build tool ja toimitusketjun osa, joten tarkka versio,
  checksum/provenance, lisenssi ja ylläpitomalli tarvitsevat omistajan
  erillisen hyväksynnän
- WiX 7.0.0 on julkaistu, ja virallinen binäärijulkaisu ilmoittaa Open Source
  Maintenance Fee -ehdoista; kustannus- ja käyttöehdot on selvitettävä ennen
  valintaa
- per-user MSI, major upgrade -ajoitus ja uninstallin dataomistajuus on
  todennettava oikealla kahden version paketointispikellä
- lukitut Eky-tiedostot, antivirus ja Explorer-preview voivat silti estää
  korvauksen; Update Coordinatorin graceful shutdown pysyy pakollisena
- väärin authoroitu component-, UpgradeCode- tai scope-muutos voi rikkoa
  päivityksen. Tuoteidentiteetit ovat immutable release-sopimuksia.

**Johtopäätös:** paras R0-ehdokas, jos lisenssi- ja riippuvuusportti
hyväksytään ja prototyyppi todistaa per-user major upgraden sekä rollbackin.

## Myöhempi R1-arvio: MSIX

MSIX tarjoaa Windowsin hallitun package identity-, allekirjoitus-, update- ja
deployment-mallin. Se on kiinnostava myöhempi jakeluvaihtoehto, mutta ei R0:n
valinta. MSIX virtualisoi osan tiedosto- ja rekisterikirjoituksista, ja
sovellusdata voi poistua uninstallissa. Nykyisen `%APPDATA%`-pohjaisen
yritysprofiilin säilyminen ei siksi saa jäädä oletuksen varaan.

MSIX voidaan arvioida R1:ssä vasta, kun:

- profile registry ja business-datan asennuksesta riippumaton juuri on valmis
- uninstall/reinstall- ja downgrade-semantics on todistettu oikealla paketilla
- package identity, signing ja jakelukanava on päätetty
- Electronin utility backend, native addon, PDF ja safeStorage on testattu
  MSIX-rajoissa.

## Vertailutaulukko

| Ominaisuus | Packager-hakemisto | Forge Squirrel | WiX/MSI |
| --- | --- | --- | --- |
| Clean install | Ei asenninta | Kyllä | Kyllä |
| Sama artifact upgradeen | Ei | Setup-mallissa kyllä, todistettava | Major upgrade -MSI, todistettava |
| Per-user ilman elevationia | Manuaalinen | Luontainen | Tuettu authoroituna |
| Per-machine | Ei mallia | Ei R0:n vahvuus | Tuettu erillisenä scopena |
| Repair | Ei | Rajallinen/työkalukohtainen | Windows Installer -malli |
| Installer rollback | Ei | Todistettava | Transaction rollback + authoroitu major upgrade |
| Edellisen version palautus first-start-failuressa | Ei | Oma koordinointi | Oma koordinointi + säilytetty aiempi MSI |
| Full package | Hakemisto | Kyllä | Kyllä |
| Delta | Ei | Mahdollinen, ei R0:ssa | Patch mahdollinen, ei R0:ssa |
| Code signing | EXE allekirjoitettavissa | Tuettu | MSI/payload allekirjoitettavissa |
| Uusi dependency/build tool | Ei | Kyllä | Kyllä |
| GitHub Actions Windows | Nykyisin todistettu | Todistettava | Todistettava |
| Uninstall säilyttää business-datan | Ei uninstallia | Todistettava | Authoroidaan payloadiin koskemattomaksi |

## R0-suositus

Suositus on **per-user Windows Installer -MSI**, joka authoroidaan
hyväksytyllä ja tarkasti lukitulla WiX-versiolla nykyisen kovennetun
Packager-outputin ympärille. Suositus ei ole riippuvuuspäätös.

R0 käyttää:

- yhtä täyttä MSI:tä clean installiin, repairiin ja major upgradeen
- vakaata UpgradeCodea, app identityä ja per-user install rootia
- erillistä sidecar-manifestia
- `pilot`-release-kanavaa
- käyttäjän vahvistamaa paikallista tiedostoa tai USB:tä
- Windows Installerin rollbackia kesken installin
- pre-update-palautuspistettä ja first-start business-validointia
- säilytettyä edellistä allekirjoitettua MSI:tä hallittuun binary rollbackiin.

Jos WiX:n lisenssi, per-user-prototyyppi tai kahden version rollback ei läpäise
porttia, toteutus pysähtyy. Seuraava arvioitava R0-ehdokas on Forge Squirrel,
ei Ekyyn käsin kirjoitettu tiedostokorvaaja.

## Binary rollback -malli

Binary rollbackissa on kaksi eri rajaa:

1. **Asennuksen aikainen virhe:** Windows Installer palauttaa saman
   transaktion muutokset. Major upgrade authoroidaan niin, ettei vanhaa
   versiota poisteta tavalla, joka jättää virheessä koneen ilman toimivaa
   versiota.
2. **Asennus onnistui, first-start epäonnistui:** Eky palauttaa ensin
   yritysprofiilin pre-update-pisteestä. Tämän jälkeen käyttäjälle tarjotaan
   vain allekirjoitetun, journalissa sidotun edellisen MSI:n hallittu
   palautus. Vanhaa binaaria ei käynnistetä uuden skeeman päällä.

Edellisen MSI:n säilytyspaikka, retention, allekirjoituksen uudelleenvalidointi
ja käynnistystapa ovat avoimia toteutuspäätöksiä. R0:aa ei julkaista ennen
kahden version rollback-E2E:tä.

## Code signing ja SmartScreen

- Eky.exe, mahdolliset muut executablet ja lopullinen MSI allekirjoitetaan
  samalla suojatulla publisher-identiteetillä.
- Allekirjoitus käyttää SHA-256:ta ja RFC 3161 -aikaleimaa.
- Allekirjoitusavain ei tule repoon, artifactiin, backupiin tai sovellukseen.
- Release pipeline ei allekirjoita dirty-buildia.
- Allekirjoitus tarkistetaan sekä buildissä että ennen paikallisen paketin
  hyväksymistä.
- SmartScreen-maine syntyy ajan myötä. Allekirjoitus ei takaa, ettei uusi
  julkaisu näyttäisi aluksi varoitusta, mutta vakaa publisher-identiteetti on
  maineen kertymisen edellytys.

## Dependency- ja supply chain -portti

Ennen mitään asennusta projektin omistajalle raportoidaan:

- tarkka suora dependency tai build tool ja versio
- kaikki olennaiset transitiiviset työkalut ja ladattavat binaarit
- virallinen release- ja checksum/provenance-lähde
- ylläpidettyjen versioiden politiikka ja security history
- lisenssi, EULA ja mahdollinen ylläpitomaksu
- GitHub Actions -asennus- ja cache-malli
- code signing -avaimen käyttöraja
- poistettavuus, jos prototyyppi hylätään.

Tämä arvio ei muuta `package.json`- tai lockfile-tiedostoja.

## Viralliset lähteet

- [Electron Packager](https://electron.github.io/packager/main/)
- [Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- [Electron Forge Squirrel maker](https://www.electronforge.io/config/makers/squirrel.windows)
- [Electron Forge releases](https://github.com/electron/forge/releases)
- [WiX Toolset](https://docs.firegiant.com/wix/)
- [WiX releases](https://github.com/wixtoolset/wix/releases)
- [WiX Package scope](https://docs.firegiant.com/wix/schema/wxs/package/)
- [WiX MajorUpgrade](https://docs.firegiant.com/wix/schema/wxs/majorupgrade/)
- [Windows Installer rollback](https://learn.microsoft.com/en-us/windows/win32/msi/rollback-installation)
- [msiexec](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/msiexec)
- [Authenticode timestamping](https://learn.microsoft.com/en-us/windows/win32/seccrypto/time-stamping-authenticode-signatures)
- [Windows SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
- [MSIX desktop runtime and app data](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes)

## Avoimet omistajapäätökset

- hyväksytäänkö WiX/MSI prototyyppiin uutena build toolina
- mikä WiX-versio ja lisenssimalli hyväksytään valintahetkellä
- vaaditaanko code signing jo yhden koneen R0-pilotissa
- säilytetäänkö edellinen MSI automaattisesti vai pyydetäänkö käyttäjää
  säilyttämään se suljetussa release-kansiossa
- hyväksytäänkö vain x64-paketti R0:ssa
- milloin R1/MSIX-arvio avataan uudelleen.
