# Release-versiointi ja build-identiteetti

Tämä dokumentti määrittelee Eky-artifactin version ja buildin jäljitettävyyden.
Release-identiteetti auttaa tunnistamaan ajetun ohjelmaversion diagnostiikassa
ja tukipaketissa. Se ei ole autentikointi-, valtuutus- tai eheystodiste.

## Version omistajuus

Desktop-jakelun SemVer-version auktoritatiivinen lähde on
`apps/desktop/package.json`. Nykyinen R0-versio on ennakkoversio, esimerkiksi
`0.1.0-alpha.1`.

Versio päivitetään tarkoituksella ennen jaeltavan artifactin muodostamista:

- patch kuvaa yhteensopivaa virhe- tai turvallisuuskorjausta
- minor kuvaa yhteensopivaa uutta käyttäjäominaisuutta
- major varataan yhteensopimattomalle julkiselle sopimus- tai
  käyttöönottomuutokselle
- `0.x`-vaiheessa ennakkoversion tunniste kertoo, ettei kyse ole valmiista
  tuotantojulkaisusta

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

Build-revision, versionumero ja runtime-tunniste eivät yksin todista artifactin
alkuperää. Laajemman jakelun allekirjoitus- ja päivitysketju käsitellään
erillisessä release security gate -vaiheessa.
