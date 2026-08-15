# Release-versiointi ja build-identiteetti

Tämä dokumentti määrittelee Eky-artifactin version ja buildin jäljitettävyyden.
Release-identiteetti auttaa tunnistamaan ajetun ohjelmaversion diagnostiikassa
ja tukipaketissa. Se ei ole autentikointi-, valtuutus- tai eheystodiste.

## Version omistajuus

Desktop-jakelun SemVer-version auktoritatiivinen lähde on
`apps/desktop/package.json`. Uudet Eky-julkaisut käyttävät kaikissa
jakelumuodoissa vain kolmiosaista numeerista SemVer-ydintä, esimerkiksi
`0.1.0`.

Versio päivitetään tarkoituksella ennen jaeltavan artifactin muodostamista:

- patch kuvaa yhteensopivaa virhe- tai turvallisuuskorjausta
- minor kuvaa yhteensopivaa uutta käyttäjäominaisuutta
- major varataan yhteensopimattomalle julkiselle sopimus- tai
  käyttöönottomuutokselle
- `0.x` kertoo, että julkinen sopimus voi vielä kehittyä ennen versiota `1.0.0`

Julkaisun kypsyys ja jakeluoikeus ilmaistaan `releaseChannel`-arvolla sekä
release gateilla, ei version tekstissä olevalla prerelease-tunnisteella.
Uuden artifactin `appVersion` ei sisällä `alpha`-, `beta`-, `rc`- tai build-
metadataosaa. Runtime säilyttää vanhojen prerelease-versioiden rajatun
lukuyhteensopivuuden, jotta hyväksyntä-, päivitys- ja rollback-historia voidaan
validoida turvallisesti siirtymäkauden yli.

Pelkkä paikallinen kehitysbuild ei edellytä version nostoa. Git-revision avulla
samasta versiosta tehdyt kehitysbuildit erotetaan toisistaan.

## Paketoidun buildin identiteetti

Windows-paketointi muodostaa build-infon vasta buildin alussa:

- `appVersion`: desktop-paketin SemVer-versio
- `buildRevision`: Git HEAD:n 7-40 merkin heksadesimaalinen revision tunniste
- `buildCreatedAt`: UTC-aikaleima
- `buildDirty`: oliko työpuussa paketoitaessa muutoksia
- `schemaVersion`: build-info-sopimuksen versio

Paketoitu sovellus validoi build-infon ja version vastaavuuden ennen
käynnistystä. Jaettava release-artifact muodostetaan puhtaasta työpuusta.
Dirty-build on sallittu vain paikalliseen kehitys- ja vianrajauskäyttöön, ja
sen tila näytetään diagnostiikassa.

Development-ajossa revision on `development` ja build merkitään dirtyksi.
`EKY_BUILD_REVISION` on vain hallitun build-ympäristön revision syöte; sitä ei
lueta rendereriltä eikä käyttäjäpyynnöstä.

## Runtime-identiteetti

Electron main luo jokaiselle käynnistykselle uuden
`runtimeInstanceId`-tunnisteen ja välittää saman tunnisteen hallitulle
backend-prosessille. Sen avulla saman käynnistyksen turvalliset tapahtumat
voidaan yhdistää.

Runtime-tunniste:

- ei ole käyttäjän, yrityksen, laitteen tai asennuksen pysyvä tunniste
- ei ole salaisuus, session tunniste eikä käyttöoikeustodiste
- ei korvaa `ActorContext`- tai runtime-session-tarkistusta
- saa näkyä vain erikseen mallinnetussa paikallisessa diagnostiikassa
- ei kuulu pitkäaikaiseen incident-indeksiin

## Sovellusidentiteetti ja asennus

Puhdas asennus ja päivitys käyttävät samaa vakaata Eky-
sovellusidentiteettiä. Version, build revisionin tai release-kanavan muutos ei
saa luoda uutta `userData`-juurta tai siirtää business dataa
asennushakemistoon.

Jaeltava Windows-paketti sisältää tiukasti validoitavan versionoidun
manifestin, jossa on vähintään:

- app identity
- app version, MSI product version ja build revision
- platform ja architecture
- release channel
- paketin koko ja SHA-256
- manifest format version

Build identity todistaa jäljitettävyyden, ei artifactin alkuperää tai eheyttä.
Digitaalinen allekirjoitus, tunnettu publisher ja allekirjoitettu
päivitysmanifesti ovat erillisiä laajemman jakelun turvallisuustodisteita.

### SemVer ja Windows Installer -tuoteversio

Windows-jakelulla on kaksi eri versiota, joiden vastuita ei yhdistetä:

- `appVersion` on käyttäjälle ja runtimelle näkyvä kolmiosainen numeerinen
  SemVer-versio, esimerkiksi `0.1.0`
- `msiProductVersion` on Windows Installerin käyttämä kolmiosainen numeerinen
  `major.minor.build`-arvo.

`msiProductVersion` ei ole SemVerin tekstimuunnos eikä sitä johdeta Git-
commitien määrästä, build-ajasta tai paikallisen koneen kellosta. Se annetaan
release-prosessissa tarkoituksellisesti ja sen pitää olla jokaista uutta
jaeltua MSI-versiota varten aikaisempaa suurempi. Toteutuksen validaattori
rajaa kaikki kolme osaa valitun Windows Installer -työkaluketjun hyväksymiin
numeerisiin rajoihin.

Nykyisen installer-prototyypin sovellus- ja MSI:n Windows-vertailuversio on
`0.2.1`. Aikaisemmat paikalliset pilotit käyttivät
`0.1.0-alpha.x`-versioita. Numeerinen `0.1.0` on SemVer-järjestyksessä niitä
uudempi, joten siirtymä ei avaa downgradea. Vanhoja prerelease-arvoja saa vain
lukea olemassa olevasta hyväksyntä-, manifesti- tai rollback-metadatasta; niitä
ei enää kirjoiteta uusiin release-konfiguraatioihin.

Yksi jaeltu `appVersion` ja `msiProductVersion`-pari vastaa yhtä täsmällistä
MSI-artifactia. Samaa `appVersion`-arvoa ei käytetä eri payloadille:

- saman täsmällisen artifactin uudelleenajo on vain eksplisiittinen repair
- muuttunut payload vaatii uuden `appVersion`-arvon ja suuremman
  `msiProductVersion`-arvon
- normaali päivitys vaatii sekä hyväksytyn SemVer-siirtymän että kasvavan
  MSI-tuoteversion
- downgrade estetään oletuksena molempien versiosopimusten tasolla.

Release candidate -portti todistaa Gitin first-parent-historiasta, että
nykyinen numeerinen `appVersion` on otettu käyttöön vasta tarkistettavassa
HEAD-commitissa. Jos sama versio löytyy myös HEADin vanhemmasta
first-parent-commitista, artifactin rakentaminen pysähtyy. Näin versionoston
jälkeen tehty payloadia tai build-revisiota muuttava commit vaatii uuden
versionoston ennen uuden jaeltavan desktop- tai MSI-artifactin rakentamista.

Release-manifesti sisältää molemmat arvot. Desktopin build-info ja käyttäjälle
näkyvä versio käyttävät `appVersion`-arvoa; MSI:n `ProductVersion` käyttää vain
`msiProductVersion`-arvoa. Kumpikaan ei yksin todista paketin alkuperää tai
publisheria.

## Release-kanavat

Suunnitellut kanavat ovat:

- `development`: paikallinen dirty tai muuten ei-jaettava kehitysbuild
- `pilot`: hallitulle testilaitteelle tarkoitettu rajattu R0-julkaisu
- `stable`: myöhempi allekirjoitettu ja laajemman release gaten läpäissyt
  julkaisu

Kanavaa ei päätellä pelkästä SemVer prerelease -tunnisteesta. Manifestin,
paketin ja päivitysjournalin kanavien pitää vastata toisiaan.

## Version vertailu ja downgrade

Päivityspolku käyttää SemVer-vertailua:

- uudempi yhteensopiva versio voidaan hyväksyä manifestin ja release gaten
  jälkeen
- sama versio torjutaan normaalina päivityksenä, ellei kyse ole erikseen
  hyväksytystä repair-polusta
- downgrade estetään oletuksena
- downgrade ei koskaan aja reverse SQL -migraatiota
- binary rollback käyttää edellisen version binaareja vain yhdessä
  yhteensopivaksi palautetun pre-update-yritysprofiilin kanssa; se poistaa
  epäonnistuneen target-version ennen täsmällisen rollback-paketin asennusta
  eikä avaa yleistä MSI-downgradea
- jos rollback-paketin asennus epäonnistuu target-version poistamisen jälkeen,
  koordinoitu polku yrittää palauttaa täsmälleen saman target-paketin recovery-
  käyttöliittymän säilyttämiseksi

## Jaettavan artifactin portti

Dirty-buildia ei jaeta. Release-artifacti muodostetaan puhtaasta,
jäljitettävästä commitista, ja paketin build-infon, manifestin sekä desktop-
paketin version pitää täsmätä.

Projektin omistaja on hyväksynyt yhden hallitun pilottilaitteen
allekirjoittamattoman artifactin vain ADR-0010:n `localUnsignedPilot`-mallissa.
Tällaisen manifestin `releaseChannel` on aina `pilot` ja allekirjoitustila aina
`unsigned-prototype`. `stable` ei hyväksy allekirjoittamatonta artifactia.
Laajempi jakelu vaatii code signing-, publisher-, installer-, rollback- ja
päivitysketjun erillisen hyväksynnän.

Build-revision, versionumero ja runtime-tunniste eivät yksin todista artifactin
alkuperää. Windows-asennus- ja päivitysrajat on määritelty ADR-0010:ssä ja
`docs/architecture/windows-installer-and-update-plan.md`-dokumentissa.

### Nykyinen pilot-paketoinnin portti

`pnpm --filter @eky/desktop package:windows` säilyy paikallisen
kehityspaketin komentona. Se ei ole jakelukelpoinen release-todiste.

`pnpm --filter @eky/desktop package:windows:pilot` muodostaa ennen varsinaista
installeria käytettävän unpacked pilot -artifactin ja torjuu:

- dirty worktreen
- build revisionin ja Git HEAD:n ristiriidan
- muun kuin kolmiosaisen numeerisen SemVer-version
- muun release-kanavan kuin `pilot`
- version ja build-infon ristiriidan
- puuttuvan tai muuttuneen pilot-manifestin
- application-, backend-, desktop-runtime- tai final package -inventaarion
  epäonnistumisen

Manifesti ja inventaario todistavat suljetun sisällön sekä jäljitettävyyden,
eivät vielä publisheria tai digitaalista alkuperää. Varsinainen installer-
manifesti, code signing ja `stable`-kanava kuuluvat myöhempään release gateen.

Puhtaan pilot-buildin jälkeen `smoke:windows:release-candidate` todistaa juuri
saman `out/Eky-win32-x64`-artifactin kahdella käynnistyksellä eristetyssä
synteettisessä profiilissa. Profiili sisältää ennen ensimmäistä käynnistystä
vain suljetun, repositoryn first-parent-versiohistoriasta johdetun edellisen
hyväksytyn pienemmän numeerisen version build-identiteetin. Näin portti
havaitsee puhtaan profiilin smoken ohi jäävän tilanteen, jossa eri payload on
rakennettu uudelleen samalla jo hyväksytyllä versiolla. Testi ei lue tai
muuta käyttäjän normaalia `%APPDATA%\Eky`-profiilia.

Release-candidate-smoken jälkeen artifactia ei rakenneta uudelleen käyttäjän
manuaalista testiä varten. Rebuild muodostaa uuden ehdokkaan, jolle sama portti
on ajettava uudelleen.

### Pilot-artifactin alkuperä

Nykyinen paikallinen `package:windows:pilot`-komento todentaa puhtaan työpuun,
HEAD-revision, build-infon, manifestin ja suljetun paketti-inventaarion. Se ei
vielä todista, että käyttäjälle annettu artifacti on täsmälleen sama tavujono,
jonka CI testasi. Paikallisesti CI-ajon jälkeen uudelleen rakennettua pakettia
ei saa nimetä CI-testatuksi release-artifactiksi, vaikka lähdecommit olisi sama.

Ensimmäisen installer- ja päivityspolun release pipeline muodostaa artifactin
vain kerran, testaa juuri sen artifactin ja julkaisee saman hashilla sidotun
artifactin ilman paikallista uudelleenrakennusta. Manifesti, package inventory,
testitulokset ja myöhempi allekirjoitus sidotaan samaan artifactiin.

Nykyinen Windows MSI -release gate toteuttaa build-once-, inspect- ja
SHA-256-sidecar-sidonnan. Se varmentaa samat MSI-tavut vielä lifecycle- ja
upgrade-fixture-testien jälkeen. CI ei tässä vaiheessa lataa MSI:tä
release-jakeluun eikä väitä allekirjoittamatonta prototyyppiä julkaistuksi
artifactiksi.

Upgrade-fixture käyttää N-versiona juuri tätä sidecarilla sidottua MSI:tä eikä
rakenna release-N:ää uudelleen. Synteettiset N+1- ja rollback-paketit ovat
erillisiä testiartifacteja. Tulevassa allekirjoitetussa releaseputkessa signing
tehdään ennen lopullista SHA-256-tiivistettä ja manifestia; lifecycle- ja
upgrade-portit käyttävät sen jälkeen täsmälleen samoja allekirjoitettuja
tavuja. Nykyinen `unsigned-prototype`-sidecar ei väitä publisher trustia.

Paikallisen pilotin jakelukokonaisuus sisältää täsmälleen MSI:n, sen
sidecar-manifestin ja MSI-tavut nimeävän SHA-256-tiedoston. Julkaisun nimeä tai
versiota ei käytetä uudelleen eri tavuille. Paikalliseen release-arkistoon ja
USB-medialle kopioidut tavut tarkistetaan hashilla kopioinnin jälkeen. Vähintään
nykyinen ja edellinen hyväksytty kokonaisuus säilytetään hallittua rollbackia
varten.

### Production-profiilin puhtaus

Lopullinen production-profiili luodaan tyhjästä sovelluksen hallitulla
bootstrapilla. Siihen ei kopioida eikä myöhemmin poistamalla "puhdisteta"
synteettisiä asiakkaita, laskuja, sähköposteja, salaisuuksia, smoke-fixturejä
tai muuta testidataa.

Lopullisen production-profiilin ensimmäinen hyväksytty lasku on oikea.
Sama artifacti on sitä ennen testattu erillisellä synteettisellä profiililla,
erillisellä Windows-käyttäjällä tai virtuaalikoneessa.

Production-profiili, testiprofiili ja release-artifact ovat eri asioita.
Release-artifact ei sisällä profiilia tai business dataa, eikä testi- tai
production-profiilia käytetä artifactin alkuperän todisteena.

## Liittyvät dokumentit

- `docs/architecture/local-desktop-dependency-review.md`
- `docs/architecture/local-desktop-implementation-plan.md`
- `docs/architecture/windows-installer-and-update-plan.md`
- `docs/decisions/ADR-0010-windows-installer-and-update-orchestration.md`
