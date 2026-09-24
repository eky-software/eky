# Eky 0.2.8 -pilotin manuaalinen käyttäjätestaus

## Kohde ja käyttö

Testattava julkaisu on `94cd4a04af9cb51168909b0c93ca6a6d9e6b5db1`, ei
myöhemmästä päähaarasta rakennettava paketti. Käyttöliittymävaiheet ja
testiviitteet on tarkistettu tämän revision lähteistä. Tämä ohje ei ole
käyttäjän suorittaman testin tulos eikä hyväksy oikean datan käyttöä.

Hyväksytyn bundlen tiedostot ovat `Eky-0.2.8-x64.msi`,
`Eky-0.2.8-x64.manifest.json` ja `Eky-0.2.8-x64.sha256.txt`.
MSI:n SHA-256 on
`fbd1c02eab28aac231d0fb9813e53586fe7e9a52fed4c437053c15d887ca2276`.
Manifestin version pitää olla `0.2.8`, revision yllä mainittu ja checksumin
viitata samaan MSI:hin. Pelkkä tiedostonimi ei todenna pakettia.

[Julkaisutodiste ja rajaukset](../architecture/windows-installer-acceptance-harness-v2.md#ajantasaiset-julkaisuesteet-ja-päätökset):
[release-ajo 35270207550](https://github.com/eky-software/eky/actions/runs/35270207550),
artifact `10518655376`. Kyseessä on rajattu allekirjoittamaton pilotti.

Tee ensin vain A-osuus ja palauta havainnot ennen B- ja C-osuutta.
Jokainen tehtävä on aluksi **Ei tehty**. Automaation vihreä tulos ei muuta
sitä käsin läpäistyksi. Lopeta kyseinen polku heti pysäytysehdon täyttyessä;
älä toista epäonnistunutta muuttavaa toimintoa summittaisesti.

## Turvarajat

- Ennen asennusta jokaisesta säilytettävästä yrityksestä tarvitaan tuore,
  onnistuneeksi varmennettu salattu `.ekybackup`, sen tunnettu salasana ja
  erillinen turvallinen säilytyspaikka. Pelkkä viimeisen varmuuskopion
  päivämäärä tai konekohtainen palautuspiste ei riitä. Älä korvaa aiempaa
  varmuuskopiota testikopiolla. Jos vanha sovellus ei ole käytettävissä ja
  kopio puuttuu, pysähdy sopimaan turvallinen varmistus erikseen.
- Jos profiilissa on oikeaa asiakas- tai laskutusdataa, varmista ennen
  asennusta pilottilaitteen hyväksytty datankäyttöraja. Siihen kuuluvat
  päivitetty käyttöjärjestelmä, suojattu käyttäjätili ja automaattilukitus,
  profiilin ja asiakirjat kattava levysalaus, rajatut käyttöoikeudet,
  suojausten säilyminen, vain paikallinen backend sekä salattu erillinen
  varmuuskopio ja sovittu palautusvalmius. Puuttuva ehto vaatii päätöksen,
  ei tämän ohjeen perusteella tehtävää poikkeusta.
- A-osuudessa vanhoja tietoja vain katsotaan. B- ja C-osuuksien kaikki
  kirjoitukset tehdään erikseen luotuun synteettiseen yritykseen.
  Vanhaa profiilia, oletusyritystä tai tietokantaa ei poisteta tai muokata
  käsin. Myös vanha tyhjä yritys voi olla oma erillinen työtilansa.
- Ei oikeita vastaanottajia, sähköpostilähetystä, pankkitoimintoja,
  yrityksen poistoa, pakotettuja prosessikatkaisuja eikä asennuksen
  keskeyttämistä. Älä muuta tietoturva-asetuksia asennuksen vuoksi.
- Salasanoja, varmuuskopioita, konepolkuja, oikean datan kuvia ja täytettyjä
  raportteja ei viedä Gitiin tai CI:hin. Tallenna havainnot ja mahdolliset
  kuvat vain `.eky-local`-kansioon tai ennestään hyväksyttyyn yksityiseen
  paikkaan. Julkiseen ohjeeseen ei täytetä tuloksia.

## A. Asennus ja säilyminen

### P028-01: Varmista lähtötilanne

- **Tarkoitus ja lähtöehdot:** oikeat pakettitavut, palautumismahdollisuus
  ja datankäyttölupa ennen ensimmäistä muuttavaa toimenpidettä.
- **Vaiheet:** varmista yllä kuvatut kolme tiedostoa, varmuuskopiot ja
  salasanan saatavuus. Kirjaa yksityisesti asennetun sovelluksen versio tai
  se, ettei asennusta ole, sekä ennestään tunnetut yritykset. Valitse
  muistissa olevista tiedoista yksi asiakas ja yksi lasku vertailukohdiksi;
  merkitse ne yksityisesti, älä lähetä niiden oikeita sisältöjä. Älä käynnistä
  toista sovellusversiota vain lähtötiedon keräämiseksi.
- **Odotettu tulos:** erotat tyhjän ensiasennuksen, olemassa olevan
  asennuksen päivityksen ja uuden asennuksen vanhan profiilin kanssa.
  Varmuuskopioiden ja datankäytön hyväksyntä on nimenomaisesti vahvistettu.
- **Kirjaa ongelmasta:** mikä edellytys puuttuu tai jäi epäselväksi;
  ei salasanaa eikä varmuuskopion sisältöä.
- **Pysäytä:** kopio, salasana, eheys, lähtötilanne tai datankäyttölupa
  puuttuu. Älä siirry asennukseen ennen asian selvittämistä.

### P028-02: Asenna käsin hyväksytty MSI

- **Tarkoitus ja lähtöehdot:** P028-01 hyväksytty; asennetaan juuri toimitettu
  paketti. Tämä tehtävä ei käytä vanhan sovelluksen päivitystoimintoa.
- **Vaiheet:** sulje mahdollinen Eky normaalisti ikkunan sulkupainikkeella.
  Älä poista aiempaa asennusta tai profiilia. Avaa varmennetun bundlen
  `Eky-0.2.8-x64.msi` kaksoisnapsauttamalla. Anna Windows Installerin
  valmistua normaalisti. Avaa sen jälkeen **Eky** Windowsin Käynnistä-valikosta,
  ei kehityksen `out`-paketista. MSI:lle ei oleteta erillisiä
  Seuraava/Valmis-painikkeita: paketti ei määrittele tällaista ohjattua UI:ta.
- **Odotettu tulos:** asennus valmistuu ilman virhettä tai vaadittua
  uudelleenkäynnistystä; Eky on käynnistettävissä. Tietojen säilyminen
  tarkistetaan erikseen seuraavassa tehtävässä.
- **Kirjaa ongelmasta:** näkyvä ilmoitus ja mahdollinen virhekoodi,
  tapahtuiko se ennen asennusta, sen aikana vai käynnistyksessä.
- **Pysäytä:** Windows estää paketin, pyytää odottamatonta korotusta tai
  uudelleenkäynnistystä, tarjoaa korjausta/uudelleenasennusta jo samalle
  versiolle tai ilmoittaa virheen. Älä ohita suojauksia, käynnistä toista
  asentajaa tai yritä väkisin uudelleen. Jos asennus jää odottamaan,
  kirjaa odotuksen kesto ja kysy ohje ennen puuttumista.

### P028-03: Ensimmäinen käynnistys ja vanhat tiedot

- **Tarkoitus ja lähtöehdot:** P028-02 valmistui; tässä ei luoda uutta
  yritystä vanhojen tietojen näkyvyyden korvaamiseksi.
- **Vaiheet:** avaa **Oma yritys**. Etsi **Tuki ja historia** ja avaa
  **Diagnostiikka**. Tarkista **Sovellusversio** `0.2.8`, **Build revision**
  alkaa `94cd4a0` ja **Buildin tila** on **Puhdas**. Tarkista vasemman
  yläkulman aktiivinen yritys. Avaa yritysvalitsin ja vertaa yrityslistaa
  P028-01:een. Sulje valitsin sen sulkupainikkeesta. Avaa **Asiakkaat** ja
  **Laskutus** ja katso valitut vertailutiedot ilman muokkausta. Jos ne ovat
  toisessa tunnetussa yrityksessä, valitse sen riviltä **Avaa yritys** ja
  vahvista **Vaihda yritys**; normaali uudelleenkäynnistyminen kuuluu vaihtoon.
- **Odotettu tulos:** oikea versio aukeaa ilman käynnistysvirhettä;
  ennestään tunnetut yritykset ja vertailutiedot löytyvät muuttumattomina.
  Aidosti tyhjässä ensiasennuksessa puuttuva vanha data kirjataan
  soveltumattomaksi, ei säilymistestin läpäisyksi.
- **Kirjaa ongelmasta:** versio/revision alku, mikä näkymä ei auennut,
  löytyivätkö vertailutiedot ja näkyvä virhe. Oikeat sisällöt vain paikalliseen
  raporttiin, eivät jaettavaan tilanneviestiin.
- **Pysäytä:** väärä versio, odottamatta tyhjä yrityslista, puuttuva data,
  käynnistysvirhe tai palautusta/manuaalista tarkistusta vaativa ilmoitus.
  Älä palauta varmuuskopiota, luo korvaavaa yritystä tai muuta tiedostoja.

### P028-04: Normaali sulkeminen ja toinen käynnistys

- **Tarkoitus ja lähtöehdot:** P028-03 onnistui; kirjattu aktiivinen yritys
  ja samat kaksi vertailutietoa.
- **Vaiheet:** sulje Eky normaalisti. Kun ikkuna on sulkeutunut, avaa
  **Eky** uudelleen Käynnistä-valikosta. Tarkista aktiivinen yritys sekä
  samat asiakas- ja laskutiedot. Älä avaa rinnakkaisia käynnistyksiä.
- **Odotettu tulos:** sama yritys ja tiedot näkyvät myös toisella
  käynnistyksellä; uutta ensikäyttöä tai virheilmoitusta ei tule.
- **Kirjaa ongelmasta:** poikkesiko toinen käynnistys ensimmäisestä,
  näkyvä virhe ja onnistuiko normaali sulkeminen.
- **Pysäytä:** sulkeminen tai avaaminen ei valmistu, data muuttuu tai
  sovellus pyytää korjaavaa toimintoa. Ei pakotettua katkaisua.

**A-osuuden jälkeen:** palauta P028-01...04-havainnot ja odota ennen
kirjoittavia B- ja C-tehtäviä. Käsin ajettu MSI ei todista sovelluksen
**Sovellus ja päivitykset** -toimintoa. Sen manifestin valinta,
palautuspaketti, ennakkopalautuspiste ja sulkemis-/handoff-polku ovat eri
testi. Älä kokeile niitä tässä rinnalla tai yritä päivittää 0.2.8:aa
samalla 0.2.8-paketilla.

## B. Synteettinen yritys ja laskupolku

Näiden tehtävien aloitus edellyttää A-havaintojen käsittelyä. Nimet, osoitteet
ja tunnisteet ovat testisyötteitä, eivät todellisen yrityksen tai pankkitilin
varmennuksia. Älä lähetä niistä laskuja tai tee maksuja.

### P028-05: Luo ja avaa oma testiyritys

- **Tarkoitus ja lähtöehdot:** eristä kaikki tulevat kirjoitukset vanhoista
  yrityksistä; nimeä `PILOTTI 028 A` ei ole vielä käytössä.
- **Vaiheet:** avaa vasemman yläkulman yritysvalitsin → **Lisää yritys Ekyyn**
  → **Yrityksen nimi** `PILOTTI 028 A` → **Luo yritys**. Normaalin
  uudelleenkäynnistyksen jälkeen avaa valitsin uudelleen. Valitse uuden
  yrityksen riviltä **Avaa yritys** → **Vaihda yritys**. Tarkista sen
  aktiivinen nimi ja tyhjä asiakaslista.
- **Odotettu tulos:** yritys syntyy; luonti ei itsessään vaihda aktiivista
  yritystä. Erikseen tehty vaihto avaa uuden tyhjän työtilan. Sen näyttönimi
  ei vielä täytä laskuttavan yrityksen Oma yritys -tietoja.
- **Kirjaa ongelmasta:** kumman toiminnon jälkeen yritys vaihtui, näkyikö
  uusi rivi ja oliko lista tyhjä.
- **Pysäytä:** uuden työtilan sijaan näkyy vanhaa yritysdataa, väärä nimi
  pysyy aktiivisena tai luonti/vaihto epäonnistuu. Älä luo lisäkopioita.

### P028-06: Täytä laskuttavan yrityksen tiedot ja numerointi

- **Tarkoitus ja lähtöehdot:** aktiivinen yritys on `PILOTTI 028 A`.
- **Vaiheet:** **Oma yritys**: **Yrityksen nimi** `Synteettinen Pilottiyritys Oy`,
  **Y-tunnus** `7654321-0`, **ALV-tunnus** `FI76543210`, **Katuosoite**
  `Testikatu 1`, **Postinumero** `00100`, **Kaupunki** `Testikaupunki`,
  **IBAN** `FI2112345600000785` → **Tallenna**. Jätä sähköposti-, yhteys- ja
  SMTP-tiedot tyhjiksi; **Sähköpostin lähetystapa** on **Kuivaharjoittelu**.
  **Laskunumerointi**: **Numerointitapa** = **Kalenterivuosittainen numerointi**,
  **Tilikauden aloituskuukausi** = **Tammikuu**, **Numeron vähimmäispituus**
  `4`, **Ensimmäinen numero** `1` → **Tallenna numerointiasetukset**.
  Käy toisessa näkymässä ja palaa tarkistamaan arvot.
- **Odotettu tulos:** molemmat erilliset tallennukset onnistuvat ja arvot
  säilyvät. Työtilan näyttönimi on edelleen `PILOTTI 028 A`.
- **Kirjaa ongelmasta:** kumpi tallennus epäonnistui, kenttä ja näkyvä virhe.
- **Pysäytä:** aktiivinen työtila ei ole testiyritys, arvot eivät säily
  tai toiminto vaatii oikeita lähetys-/pankkitunnuksia.

### P028-07: Asiakas, tavallinen syötevirhe ja muokkaus

- **Tarkoitus ja lähtöehdot:** `PILOTTI 028 A` aktiivinen, asiakaslista tyhjä.
- **Vaiheet:** **Asiakkaat → Uusi asiakas → Syötä itse**. Anna
  **Asiakasnumero \*** `P028-001`, mutta jätä **Nimi \*** ensin tyhjäksi:
  **Lisää** ei saa olla käytettävissä. Täytä **Asiakastyyppi \*** **Yritys**,
  **Nimi \*** `Synteettinen Asiakas Oy`, **Tila \*** **Aktiivinen**, osoite
  `Testikatu 2`, `00100`, `Testikaupunki`; muut kentät tyhjiksi → **Lisää**.
  Asiakaskortilla **Muokkaa** → katuosoitteeksi `Testikatu 3` →
  **Tallenna muutokset**. Palaa **← Asiakaslistaan** ja hae numerolla
  kentässä **Hae asiakasta**.
- **Odotettu tulos:** tyhjä nimi estää tallennuksen, vain yksi asiakas syntyy
  ja muokattu osoite löytyy haulla ja kortilta.
- **Kirjaa ongelmasta:** estyikö tyhjän nimen tallennus, mikä arvo ei säilynyt
  tai syntyikö useampi asiakas.
- **Pysäytä:** kirjoitus kohdistuu väärään yritykseen tai syntyy tahaton
  tallennus/duplikaatti. Älä korjaa sitä tietokannasta.

### P028-08: Laskuluonnos ja laskenta

- **Tarkoitus ja lähtöehdot:** yritystiedot, numerointi ja P028-001-asiakas
  tallennettu testiyritykseen.
- **Vaiheet:** **Laskutus → Uusi lasku**. **Asiakas** = testiasiakas,
  **Aihe** `PILOTTI 028 A`, **Laskun päiväys** `29.7.2026`,
  **Maksuehto päivinä** `14`, **Eräpäivä** `12.8.2026`.
  Valitse **Veroton hinta**, vastaanottaja **Sama kuin asiakas** ja
  suoritusajankohta **Sama kuin laskun päivä**. Rivin kenttiin
  **Nimike / Määrä / Yksikkö / Yksikköhinta / ALV %**:
  `Synteettinen työ / 2 / h / 100,00 / 25,50 %`.
  **Lisää rivi**: `Synteettinen materiaali / 1,5 / kpl / 20,00 / 25,50 %`.
  Ei alennuksia. Odota **Tallennettu**. Palaa **Laskutus**-näkymään ja
  avaa sama luonnos uudelleen.
- **Odotettu tulos:** **Veroton** `230,00 €`, **ALV** `58,65 €`,
  **Yhteensä** `288,65 €`; molemmat rivit ja päivämäärät säilyvät.
  Nämä ovat tarkoituksella kiinteät synteettiset testipäivämäärät.
- **Kirjaa ongelmasta:** eroava summa, päivämäärä, rivi tai tallennustila.
- **Pysäytä:** summa/tallennus on väärä, asiakas vaihtuu tai luonnos
  hyväksytään ilman omaa hyväksyntää. Älä jatka laskun hyväksymiseen.

### P028-09: Hyväksy synteettinen lasku

- **Tarkoitus ja lähtöehdot:** P028-08 täsmää; hyväksyntä tekee virallisen
  laskun vain synteettisen yrityksen numerointiin.
- **Vaiheet:** **Hyväksy laskuksi** → **Hyväksynnän vahvistus** →
  tarkista tiedot → **Hyväksy laskuksi** → **Avaa hyväksytty lasku**.
- **Odotettu tulos:** tila **Hyväksytty**, laskunumero ja viitenumero syntyvät;
  yritys, asiakas, rivit ja `288,65 €` säilyvät. Kirjaa testilaskun numero
  yksityiseen havaintopohjaan myöhempiä vertailuja varten.
- **Kirjaa ongelmasta:** puuttuiko vahvistus, numero, tieto tai tuliko virhe.
- **Pysäytä:** väärä yritys, asiakas tai summa; tietojen puute tai virhe.
  Älä hyväksy uudelleen, jos et tiedä syntyikö lasku.

### P028-10: PDF-esikatselu

- **Tarkoitus ja lähtöehdot:** P028-09:n hyväksytty testilasku auki.
- **Vaiheet:** **Luo PDF** → **Avaa PDF**. Jos PDF on jo olemassa, valitse
  suoraan **Avaa PDF**. Tarkista esikatselusta nimet, osoitteet, kaksi riviä,
  lasku-/viitenumero sekä `288,65 €`. Sulje vain esikatseluikkuna.
- **Odotettu tulos:** PDF vastaa laskua; luonti tai katselu ei merkitse
  laskua toimitetuksi. PDF:n vientiä tiedostoon ei tässä tehtävässä vaadita,
  koska katselimen vientipainiketta ei ole varmennettu samaksi käyttöliittymäksi.
- **Kirjaa ongelmasta:** avautuiko PDF, tyhjä/väärä sisältö tai virhe.
- **Pysäytä:** PDF sisältää toisen yrityksen tietoja tai sovellus ehdottaa
  todellista lähettämistä. Älä lähetä tai tulosta oikealle vastaanottajalle.

### P028-11: Käsintoimituksen ja maksun tilamerkinnät

- **Tarkoitus ja lähtöehdot:** testilasku ja PDF kunnossa. Nämä ovat
  pelkkiä synteettisiä tilamerkintöjä, eivät oikea toimitus tai maksu.
- **Vaiheet:** **Merkitse käsin toimitetuksi** → vahvista samalla nimisellä
  painikkeella. Tarkista **Lähetetty**. **Merkitse maksetuksi** →
  **Maksupäivä** `30.7.2026` → **Merkitse maksetuksi**.
- **Odotettu tulos:** tila **Maksettu**, maksettu määrä `288,65 €`, sama
  laskunumero ja PDF. Sähköpostia ei lähetetä.
- **Kirjaa ongelmasta:** mikä tilasiirtymä, summa tai päivämäärä poikkesi.
- **Pysäytä:** olet muussa kuin synteettisessä testiyrityksessä/laskussa,
  sähköpostin lähetysikkuna avautuu tai tila muuttuu ilman vahvistusta.
  Älä paina lähetyspainiketta.

## C. Varmuuskopio, peruutukset ja rajattu palautus

**Palautuksen sääntö:** työtilan sisäinen alkuperätunniste eli lineage
ratkaisee yhteensopivuuden. Näyttönimi, Y-tunnus tai tyhjältä näyttävä kanta
ei tee kahdesta yrityksestä samaa. **Korvaa tiedot varmuuskopiosta** saa
korvata vain aktiivisen, saman alkuperän yrityksen tiedot. Palautus ei
yhdistä vanhaa ja uutta dataa, vaan palauttaa varmuuskopion tilanteen.

**Tuo yritys varmuuskopiosta** on eri toiminto: se luo uuden yritystyötilan
vain alkuperälle, jota ei jo ole rekisteröity. Saman yrityksen kopion tuonti
uudella nimellä ei tee sallittua toista yritystä eikä korvaa toista tyhjää
yritystä. Onnistuneen tuonnin jälkeen aiempi yritys pysyy aktiivisena;
tuotu yritys avataan erikseen. Vanhan 0.1.0-aineiston tuonti on erillinen
jatkotesti, kun sen sisältö, alkuperä ja turvallinen testikäyttö on vahvistettu.
Tässä ei käytetä säilytettävän vanhan yrityksen varmuuskopiota.

Salattu varmuuskopio sisältää työtilan tietokannan ja sen omistamat
laskuasiakirjat. Se ei ole koko koneprofiilin kopio: esimerkiksi
sähköpostisalaisuudet ja valinnainen ulkoinen PDF-arkisto eivät siirry sillä.
Ennakkopalautuspiste ei korvaa erillistä salattua varmuuskopiota.

### P028-12: Luo ja tarkista testiyrityksen varmuuskopio

- **Tarkoitus ja lähtöehdot:** vain `PILOTTI 028 A` aktiivinen; P028-11 valmis.
- **Vaiheet:** **Oma yritys → Varmuuskopiointi ja palautus → Luo varmuuskopio**.
  Tallenna Windowsin **Tallenna salattu Eky-varmuuskopio** -ikkunassa uuteen
  tiedostoon; älä korvaa vanhaa kopiota. **Suojaa varmuuskopio salasanalla**:
  oma yksityisesti säilytetty 16–256 merkin salasana kenttiin **Salasana** ja
  **Salasana uudelleen** → **Jatka**. Onnistumisen jälkeen **Tarkista
  varmuuskopio**, valitse sama tiedosto, **Avaa salattu varmuuskopio**:
  **Salasana** → **Jatka**.
- **Odotettu tulos:** ensin **Salattu varmuuskopio luotiin ja tarkistettiin
  onnistuneesti.**, sitten **Varmuuskopion salasana, eheys ja sisältö
  tarkistettiin onnistuneesti.** Yhteenvedon Eky-versio on `0.2.8`,
  laskuasiakirjoja on mukana ja työtilavastaavuus **Nykyinen yritystyötila**.
- **Kirjaa ongelmasta:** luonti vai tarkistus, näkyvä virhe ja vastaavuus.
  Älä kirjaa salasanaa tai liitä varmuuskopiota raporttiin.
- **Pysäytä:** tallennuskohde korvaisi aiemman kopion, tarkistus epäonnistuu
  tai vastaavuus on väärä. Älä käytä epäselvää kopiota palautukseen.

### P028-13: Peruutukset eivät muuta yritystä

- **Tarkoitus ja lähtöehdot:** `PILOTTI 028 A` aktiivinen ja P028-12:n kopio
  tarkistettu; muista sen asiakas, laskunumero ja maksettu tila.
- **Vaiheet:** avaa yritysvalitsin → **Korvaa tiedot varmuuskopiosta** →
  **Jatka tiedoston valintaan** ja peruuta Windowsin tiedostonvalinta.
  Toista alku, valitse testikopio ja valitse salasanaikkunassa **Peruuta**.
  Toista vielä alku ja tiedostonvalinta, anna oikea salasana → **Jatka**;
  valitse lopullisessa **Korvaa aktiivisen yrityksen tiedot** -varoituksessa
  **Peruuta**, ei **Korvaa tiedot**. Tarkista asiakas ja lasku jokaisen
  peruutuksen jälkeen.
- **Odotettu tulos:** tiedot ja aktiivinen yritys eivät muutu, eikä
  peruutus käynnistä palautusta tai uudelleenkäynnistystä.
- **Kirjaa ongelmasta:** missä kolmesta kohdasta peruutit ja mikä muuttui.
- **Pysäytä:** varoitus nimeää muun yrityksen, palautus käynnistyy tai
  sisältö muuttuu peruutuksesta huolimatta.

### P028-14: Palauta vain saman synteettisen yrityksen kopio

- **Tarkoitus ja lähtöehdot:** P028-12:n varmasti tarkistettu kopio ja
  P028-13:n peruutukset kunnossa; vain `PILOTTI 028 A` aktiivinen.
- **Vaiheet:** luo P028-07:n tapaan toinen asiakas: numero `P028-002`,
  nimi `Kopion jälkeinen testimerkki Oy`, tyyppi **Yritys**, tila **Aktiivinen**.
  Tarkista sen näkyminen. Avaa yritysvalitsin → **Korvaa tiedot
  varmuuskopiosta** → tarkista **Aktiivisen yrityksen palautus** ja yritys
  → **Jatka tiedoston valintaan** → valitse P028-12:n kopio → salasana →
  **Jatka**. Vain kun viimeinen varoitus nimeää `PILOTTI 028 A`:n, valitse
  **Korvaa tiedot**. Anna automaattisen uudelleenkäynnistyksen valmistua.
  Tarkista alkuperäinen asiakas, laskunumero, maksettu tila ja **Avaa PDF**.
  Sulje ja avaa Eky normaalisti vielä kerran ja vertaa samat tiedot.
- **Odotettu tulos:** `P028-002` puuttuu, koska se lisättiin kopion jälkeen;
  `P028-001`, lasku ja PDF palaavat kopion mukaisina samaan työtilaan.
  Muut yritykset säilyvät. Sovellus tekee ennakkopalautuspisteen; sen
  sisäistä sijaintia ei tarvitse tutkia käsin.
- **Kirjaa ongelmasta:** varoituksen yritys, palautuksen vaihe, näkyvä virhe,
  näkyikö merkki ennen/jälkeen ja säilyikö alkuperäinen lasku/PDF.
- **Pysäytä:** yritys tai kopio on epäselvä, palautus epäonnistuu tai
  manuaalista tarkistusta vaaditaan. Älä yritä toista palautusta, poista
  tiedostoja tai käsittele oikean yrityksen aineistoa.

### P028-15: Toisen yrityksen kopio hylätään

- **Tarkoitus ja lähtöehdot:** P028-14 kunnossa; käytössä edelleen vain
  synteettinen kopio. `PILOTTI 028 B` -nimistä yritystä ei vielä ole.
- **Vaiheet:** luo P028-05:n tavalla `PILOTTI 028 B`, avaa se erikseen
  **Avaa yritys → Vaihda yritys** ja varmista tyhjä asiakaslista. Tässä
  tarkoituksellisessa hylkäystestissä avaa **Korvaa tiedot varmuuskopiosta**
  → **Jatka tiedoston valintaan** → valitse A:n testikopio → oikea salasana
  → **Jatka**. Vain jos viimeinen varoitus nimeää tyhjän `PILOTTI 028 B`:n,
  valitse **Korvaa tiedot**. Odotetun hylkäyksen jälkeen sulje valitsin,
  tarkista B:n tyhjä lista ja vaihda takaisin A:han; vertaa sen asiakas ja lasku.
- **Odotettu tulos:** **Yritysten tietoja ei voitu käsitellä turvallisesti.**
  B ei saa A:n tietoja eikä hylkäys aiheuta palautuskäynnistystä. A säilyy
  ennallaan. Tyhjän B:n korvaamista ei sallita vain sen tyhjyyden perusteella.
- **Kirjaa ongelmasta:** tuliko odotettu ilmoitus ja säilyivätkö molempien
  yritysten tiedot erillään.
- **Pysäytä:** vahvistus koskee muuta kuin uutta tyhjää B:tä, A:n tietoja
  ilmestyy B:hen tai odottamaton palautus alkaa. Älä jatka muuttavia toimia.

## Tyhjä havaintopohja

Täytä erilliseen yksityiseen tiedostoon yksi tietue per tehtävä. Tiloiksi
sopivat **Ei tehty / Läpäisi / Poikkeama / Pysäytetty / Ei sovellu**.
Älä lisää yksilöiviä tuloksia tähän versionoituun ohjeeseen.

| Kenttä | Täytettävä tieto |
| --- | --- |
| Tehtävätunnus | P028-__ |
| Lähtötila | Aktiivinen testiyritys ja olennaiset edellytykset |
| Tehdyt vaiheet | Mitä todella teit; myös poikkeama ohjeesta |
| Odotettu tulos | Ohjeen mukaan |
| Todellinen tulos | Mitä näkyi; tila yllä olevasta joukosta |
| Näkyvä virhe | Viestin teksti; salaisuudet pois |
| Toistuminen | Ensimmäinen havainto; uusittiin vain sovitusti / ei uusittu |

Turvallinen tilanneviesti voi olla esimerkiksi
`P028-03: poikkeama, versio oikein mutta asiakkaat eivät näy; en jatkanut.`
Kuvakaappaus ei ole pakollinen. Säilytä mahdollinen kuva paikallisesti;
älä tallenna salasanaikkunaa tai levitä oikeita yritystietoja.

## Tekninen testikartta

Alla ovat olemassa olevat testit ja niiden rajat toimitetussa revisiossa.
Viitteet eivät tarkoita, että sarjoja olisi ajettu ohjetta kirjoitettaessa,
eivätkä ne korvaa näitä käsin tehtäviä tehtäviä. Havaittu aukko ei tässä
työpaketissa valtuuta uusia testejä tai sovelluksen muuttamista.

| Tehtävä | Omistava alue | Nykyinen automaattinen vastine | Kattavuusraja |
| --- | --- | --- | --- |
| P028-01 | Julkaisu, backup, pilotin turvaraja | [Bundle-sopimukset](../../apps/desktop/installer/scripts/createLocalPilotReleaseBundle.test.mjs): muuttuneet MSI-tavut ja väärä pilot-identiteetti hylätään | Ei todista käyttäjän kopioiden saatavuutta, salasanaa tai laitteen datankäyttölupaa. |
| P028-02 | Installer, profiilin säilyminen | [Clean lifecycle](../../apps/desktop/installer/windows-acceptance-harness/cleanInstallUninstallLifecycle.test.mjs): repair/reinstall; [legacy lifecycle](../../apps/desktop/installer/windows-acceptance-harness/legacyUpgradeLifecycle.test.mjs): major upgrade; julkaisutodisteen kaksi clean-consumeria | Synteettinen automaatio ei todista Windowsin käsikäyttöä tai käyttäjän nykyistä profiilia. |
| P028-03 | Desktop startup, workspace, diagnostiikka | [Release-candidate-käynnistys](../../apps/desktop/scripts/packaged-release-candidate.mjs); [desktopCapabilities](../../apps/e2e/tests/electron/desktopCapabilities.spec.ts): DESK-WORKSPACE-FIRST-START-001, DESK-WORKSPACE-STARTUP-001 | RC käyttää synteettistä profiilia, Electron-E2E development-runtimea; vanhan käyttäjäprofiilin sisältövertailu jää ihmiselle. |
| P028-04 | Desktop persistence | [desktopCapabilities](../../apps/e2e/tests/electron/desktopCapabilities.spec.ts): DESK-RESTART-001; RC:n ensimmäinen ja toinen käynnistys | Ei korvaa toimitetun paketin normaalia sulkemista kyseisellä profiililla. |
| P028-05 | Workspace registry ja vaihto | [workspaceSelectorJourneys](../../apps/e2e/tests/electron/workspaceSelectorJourneys.spec.ts): DESK-WORKSPACE-UI-001 | Development-Electron; oikean paketin näkyvät nimet ja toiminnon ymmärrettävyys käsin. |
| P028-06 | Company Settings, laskunumerointi | [customerAndCompanyJourneys](../../apps/e2e/tests/web/customerAndCompanyJourneys.spec.ts): COMPANY-UI-001; [issuance readiness](../../apps/web/src/features/invoicing/components/InvoiceIssuanceReadinessPanel.test.tsx) | Invoice-E2E alustaa numeroinnin API:lla; tyhjän yrityksen koko UI-asetuspolku ei tule siitä todistetuksi. |
| P028-07 | Customers, validointi | [customerAndCompanyJourneys](../../apps/e2e/tests/web/customerAndCompanyJourneys.spec.ts): CUS-UI-001, CUS-OVERVIEW-001, CUS-INPUT-001 | CUS-INPUT kattaa mm. tekstirajat; tyhjän nimen painike-ehto tarkistettu CustomerForm-toteutuksesta, ei väitettä juuri tämän osavaiheen omasta E2E:stä. |
| P028-08 | Invoicing draft ja laskenta | [invoicingJourneys](../../apps/e2e/tests/web/invoicingJourneys.spec.ts): INV-LIFECYCLE-001 | Selainpolku ja autosave; toimitetun paketin käyttö ja palaute käsin. |
| P028-09 | Invoicing approval ja snapshot | [invoicingJourneys](../../apps/e2e/tests/web/invoicingJourneys.spec.ts): INV-LIFECYCLE-001, INV-SNAPSHOT-001 | Puuttuvien yritystietojen koko UI-korjauskierros ei ole tämän tehtävän näyttö. |
| P028-10 | Invoice documents, desktop PDF | [desktopCapabilities](../../apps/e2e/tests/electron/desktopCapabilities.spec.ts): DESK-PDF-001; INV-SNAPSHOT-001 edellä | Katselu katettu; katselimen tiedostoviennin käyttöliittymää ei luvata. |
| P028-11 | Invoice delivery ja payment | [invoiceLifecycleTransitionJourneys](../../apps/e2e/tests/web/invoiceLifecycleTransitionJourneys.spec.ts): INV-MANUAL-DELIVERY-001; [invoicePaymentJourneys](../../apps/e2e/tests/web/invoicePaymentJourneys.spec.ts): INV-PAYMENT-001 | Erilliset web-testit; maksutestin fake SMTP ei ole sama kuin tämä käsintoimitusketju. |
| P028-12 | Portable profile backup | [portableProfileBackup](../../apps/desktop/src/profileBackup/portableProfileBackup.test.ts), [inspectEncryptedProfileBackup](../../apps/desktop/src/profileBackup/inspectEncryptedProfileBackup.test.ts), [profileBackupCapability](../../apps/desktop/src/profileBackup/profileBackupCapability.test.ts) | Salaus, tarkistus ja main-raja; oikea tiedostonvalinta ja salasanan säilytys käsin. |
| P028-13 | Workspace replacement, native dialogs | [workspaceSelectorJourneys](../../apps/e2e/tests/electron/workspaceSelectorJourneys.spec.ts): DESK-WORKSPACE-REPLACE-CANCEL-001/002/003 | E2E käyttää kontrolloituja native-dialogivastauksia; oikeat peruutukset tässä käsin. |
| P028-14 | Exact-lineage replacement, restart, PDF | [workspaceSelectorJourneys](../../apps/e2e/tests/electron/workspaceSelectorJourneys.spec.ts): DESK-WORKSPACE-REPLACE-001; [workspaceBackupReplacement](../../apps/e2e/tests/system/workspaceBackupReplacement.spec.ts): WORKSPACE-REPLACE-001/002/003 | Synteettinen end-to-end ja historiallinen formaatti eivät hyväksy tuntemattoman oikean vanhan kopion palautusta. |
| P028-15 | Workspace isolation ja lineage | [workspaceSelectorJourneys](../../apps/e2e/tests/electron/workspaceSelectorJourneys.spec.ts): DESK-WORKSPACE-REPLACE-WRONG-LINEAGE-001; [workspaceBackupImportCoordinator](../../apps/desktop/src/workspaces/import/workspaceBackupImportCoordinator.test.ts): duplicate-lineage | Väärän alkuperän hylkäys; onnistunut tuonti uudeksi yritykseksi on eri polku kuin tämä hylkäystesti. |

## Käyttöliittymän ja sääntöjen lähteet

- [Suomenkieliset tekstit](../../apps/web/src/i18n/fi.ts),
  [yritysasetusten näkymä](../../apps/web/src/features/companySettings/CompanySettingsPageView.tsx),
  [asiakaslomake](../../apps/web/src/features/customers/CustomerForm.tsx),
  [laskupolun käyttöliittymävaiheet](../../apps/e2e/src/journeys/invoicingWebJourney.ts).
- [Synteettiset syötteet](../../apps/e2e/src/data/syntheticBusinessInputs.ts),
  [MSI-määritys](../../apps/desktop/installer/wix/Package.wxs).
- [Backupin ja palautuksen nykyinen sopimus](../architecture/local-backup-and-restore-plan.md),
  [moniyritysmalli](../decisions/ADR-0011-local-multi-workspace-company-model.md),
  [palautusvirheen käsittely](../architecture/local-restore-recovery-runbook.md).
- [Installerin ja pilottilaitteen turvarajat](../architecture/windows-installer-and-update-plan.md),
  [testausohje](../ai/testing-rules.md),
  [yksityisyys ja turvallisuus](../architecture/security-principles.md).
