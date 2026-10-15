# 0.3.0: varmuuskopion tarkistuksen historia

<a id="m1-unit-preparation-1095-1489"></a>

> Historical source: `eky_software/docs/architecture/release-0.3.0-m1-preparation-plan.md:1095-1489` (original and provenance retained privately).
> Original source-unit checksums are retained privately. Historical pending states are not current authority.

<a id="m1-source-preparation-l1095"></a>

### Laskuhistorian ennakkorajan päätös

Rajattu loppukatselmus vahvisti K-P1:n sisältöluennan ennakkorajassa puutteen:
PDF-luettelo on rajattu, mutta laskut, sisältörevisiot, rivit, ALV-erittelyt,
nykyrevision osoittimet ja toimitustapahtumat luetaan vielä kokonaisina
muistirakenteina. PDF:ttömän revision historia kuuluu samaan eheystarkistukseen.
Pelkkä SQLiten tai tarkistusprosessin muistiraja ei korvaa ennen
materialisointia tehtävää tarkistusta. Omistaja hyväksyi 12.10.2026 rajatun
suunnittelun ja synteettiset kokeet, ei tuotantokytkentää tai uutta kokorajaa.

SQL-ennakkotarkistuksen koe laskee rivit ja arvojen tavumäärät tietokannassa
ennen nykyisiä eheysvalidoijia. Vain rajatut laskentatulokset siirtyvät tässä
vaiheessa JavaScriptiin. Samassa lukutransaktiossa säilyvät nykyinen
schema-portti, koko historian tarkistus, PDF-metadatan rajat ja katalogin
muodostus. Koetodennus kattaa myös ylimääräisen schema-sarakkeen hylkäyksen,
raja-arvot, UTF-8-/BLOB-arvot, historian loppupään virheen ja PDF:ttömän
vanhan revision. Nykyisen 038 -> 039 -synteettisen kopion katalogi säilyi
muuttumattomana. Kokeen 24 tapausta ja erillinen tyyppitarkistus läpäisivät;
ne eivät ole tuotantokorjauksen, native-resurssirajan tai koko K:n hyväksyntä.

**Valittu jatkosuunta 12.10.2026:** omistaja hyväksyi pienissä osissa
lukevan historiantarkistuksen jatkosuunnittelun. Uutta koko laskuhistorian
rivi-/tavurajaa ei valita ratkaisuksi; yllä oleva ennakkorajaprototyyppi
säilyy vertailukokeena, ei tuotantoon kytkettävänä korjauksena.
Tämä päätös ei vielä hyväksy tuotantokytkentää, uutta hyväksyntärajaa tai
nykyisten aika-/resurssirajojen muutosta.

Suunnitelman pitää nimetä korvattavat koko historian luvut ja muistissa
pidettävät kartat: pelkkä `.all()`-kutsun vaihto iteraattoriin ei riitä.
Nykyisen moduulin eheysvalidoijien säännöt ja sama johdonmukainen
tietokantakuva säilyvät. Myös erien väliset viittaukset, historian loppupään
virheet ja PDF:ttömät revisiot tarkistetaan. Yksittäisen arvon, rivin ja
revision käsittely rajataan ennen mahdollista suurta materialisointia;
suunnittelussa ei oleteta koko yhden laskun historiankaan mahtuvan muistiin.
Nykyisiä PDF-määrä-, metadatateksti- tai HTTP-syöterajoja ei tulkita uuden
historiallisten varmuuskopioiden hyväksyntärajan luvaksi.

Ennen tuotantokytkentäpäätöstä vaaditaan rajattu suunnitelmakatselmus ja
synteettinen näyttö vanhojen tuettujen kopioiden säilymisestä, erien
ylittävien virheiden hylkäyksestä, rajatusta luennasta sekä virheen ja
peruutuksen siivouksesta. Muutos käyttää nykyistä tarkistinta ja sen
testiperustaa; uutta yleistä streamaus-, lokitus- tai prosessikehystä ei
lisätä. Tuettujen formaattien säilyttäminen ei lupaa rajoittamatonta
aineistokokoa tai suoritusaikaa.

Erillinen saman katalogin syyhäviö toistettiin hallitulla
`SQLITE_NOMEM`-poikkeuksella: yleinen virhemuunnos hävittää alkuperäisen syyn.
Tämä ei ole mitattu muistin loppuminen tai vanhan timeoutin juurisyy.
Korjauksen pitää säilyttää turvallinen resurssirajan syy nykyiseen
diagnostiikkaketjuun ilman raakoja virheitä tai rinnakkaista loggeria.

<a id="m1-source-preparation-l1146"></a>

### Katalogin muistivirheen syyketju

Yllä nimetty syyhäviö on korjattu rajatusti. Katalogi säilyttää täsmällisen
natiivin `SQLITE_NOMEM`-poikkeuksen; muu revisiokatalogin hylkäys pysyy
`INVOICE_BACKUP_CATALOG_INVALID`-virheenä eikä käynnistä legacy-fallbackia.
Stagingin sekä cold-palautuksen molempien sisältöpolkujen omistava runtime
luokittelee muistivirheen nykyiseksi `PROFILE_INSPECTION_LIMIT_EXCEEDED`-
syyksi ennen mahdollista sulkuvirheiden yhdistämistä. Alkuperäinen poikkeus
säilyy vain sisäisessä syyketjussa. Natiivikoodia ei päätellä viestistä tai
myöhemmästä siivousvirheestä, eikä julkista statuskanavaa laajenneta.

Uudet SQL-kutsuihin kohdistetut regressiot toistivat puutteen ennen korjausta
ja läpäisivät korjattuina. Kohdenäyttö kattaa nykyisen ja tuetun vanhan
katalogin, aktivoinnin valmistelun, molemmat cold-sisältöpolut, ensivirheen
ennen sulkuvirhettä, lähdetavujen säilymisen sekä nykyisen desktop-statuskanavan.
Muiden katalogikutsujien testit läpäisivät; alustakohtaiset ohitukset eivät
ole läpäisyjä. Tämä on syyketjun näyttö, ei aito muistirajan täyttymiskoe,
uusi prosessirajan todennus, hardened-palautus tai koko K:n hyväksyntä.

<a id="m1-source-preparation-l1165"></a>

### Historian eristetyn ajon kohdenäyttö

Historian tuotantokytkentä on ajettu nykyisen Electronin pääprosessin omistaman
`runProfileSnapshotInspection`-polun ja oikean Electron-tarkistusutilityn
kautta. Ehjän synteettisen revisio- ja tapahtumahistorian tarkistus sekä
aktivoinnin valmistelu läpäisivät. Erikseen vioitettu tekninen tunniste
hylättiin ilman onnistumiskuittia. Tarkistuslapsen poistuminen, varauksen
palautuminen, omistetun tarkistuskopion siivous ja lähdekannan sekä katalogin
tavujen säilyminen todennettiin erikseen. Muun kuin nimetyn turvallisen
syyn hylkäys säilyttää nykyisen `unknown`-luokituksen; julkista virhesopimusta
ei laajennettu koetta varten. Aktiivisen profiilin konteksti annettiin kokeessa
synteettisenä; oikean brokerin kontekstihakua ei todisteta tällä kokeella.

Erillinen nykyisen natiiviajurin Electron-koe läpäisi varsinaisen
SQLite-muistirajan ylityksen hylkäyksen ja sen jälkeisen tavallisen kyselyn,
readonly-suojan sekä nykyisen ja tuetun historiallisen scheman tarkistuksen.
Myös puuttuva, muuttunut tai väärän alustan ajuritoimitus hylättiin.
Tämä on eri näyttö kuin katalogiin injektoidun muistivirheen syyketju:
aidon muistirajan täyttymistä juuri historiakatalogin sisällä ei väitetä
toistetuksi. Kokeet eivät osoita koko prosessin RSS-kattoa tai kaiken
formaattirajoihin mahtuvan historian valmistumista työaikarajassa.

Tuotantokoodi, tuetut formaatit ja hyväksytyt resurssirajat säilyivät.
Ensimmäisen koevalmistelun virhe korjattiin vain synteettiseen aineistoon;
se ei ollut sovelluksen tarkistusajon epäonnistuminen.
Rajattu riippumaton koenäytön katselmus ei löytänyt estävää puutetta.
Historian kytkennän jälkeinen yksi normaali työtilan testikierros ja yhteinen
tyyppitarkistus läpäisivät muuttumattomilla asetuksilla. Ohituksia ei laskettu läpäisyiksi eikä
testiperustan sopimustestejä väitetä varsinaisiksi E2E-käyttäjäpoluiksi.
Oikea Linux-Electron-ajopolku, puhtaan paketin mittaus, hardened-palautus,
binaarihandoff sekä PR/main-portit ovat yhä erillisiä avoimia ehtoja.
Näitä tuloksia ei lasketa koko K:n tai aiempien timeoutien hyväksynnäksi.

<a id="m1-source-preparation-l1198"></a>

### Laskuhistorian inkrementaalisen luennan suunnitelma

**Rajattu suunnittelu ja luentakoe, ei tuotantokytkentä.** Omistajan valitsema
suunta säilyy: koko historialle ei lisätä uutta rivi- tai tavumäärärajaa.
Koe erottaa muistissa pidettävän työjoukon aineiston hyväksyntärajasta.
Tarkistettavaa historiaa ei typistetä eikä suurta arvoa hyväksytä pelkän
alkuosan perusteella. Nykyiset prosessin aika- ja resurssirajat säilyvät.

Muutos rajataan nykyisiin Invoicingin infrastructure-validoijiin:

| Nykyinen vastuu | Suunniteltu muutos ja säilyvä sääntö |
| --- | --- |
| `SqliteInvoiceBackupArtifactCatalog` | Omistaa edelleen yhden lukutransaktion, version mukaisen katalogin ja nykyiset dokumenttirajat. Schema-portti edeltää sisältöä. Virhe ei julkaise osittaista hyväksyttyä katalogia. |
| `validateInvoiceRevisionCatalog` | Kokonaisten invoice-/revision-/current-taulukoiden ja kasvavien karttojen tilalle rajatut projektiot sekä nimetyt viite- ja duplikaattitarkistukset. Myös PDF:ttömät revisiot käsitellään. |
| `invoiceContentRevisionMapping` ja `validateInvoiceContentRevision` | Otsikon, rivin, ALV-ryhmän ja loppuehtojen nykyiset säännöt erotetaan yhteiskäyttöön; normaali mapper ja inkrementaalinen tarkistus käyttävät samaa sääntöä. Ei keinotekoisia sisältöolioita, korvaustekstejä tai rinnakkaista laskentaa. |
| Yhden revision rivit ja ALV | Myös nämä luetaan osissa. Täsmälliset summat kertyvät `BigInt`-arvoina; rivitunnisteiden, järjestysten ja verokantojen tarkistus ei kasvata rajaamatonta JavaScript-joukkoa. Historiallisia summia ei lasketa uudelleen laskuriveistä. |
| Nykyrevision vertailu | Persistence-mapperin täsmälliset sisältökentät ja järjestetyt rivit säilyvät vertailussa. Maksu-, toimitus- tai peruutustilaa ei lisätä muuttumattoman sisällön vertailuun. |
| Hyvitysviitteet | Viite kohdistuu täsmärevisioon, ei laskun nykyrevisioon. Yritys, alkuperäislasku, standard-laji, numeron/päivän snapshotit ja lähderivin jäsenyys säilyvät. Legacy-lähteen nykyinen hyväksyntä ei muutu. |
| `validateInvoiceRevisionCatalogDocuments` ja `readInvoiceEventDocument` | Dokumenttien nykyinen rajattu validointi säilytetään. Tapahtumien koko taulukko ja kasvava ratkaisemattomien lähetysten joukko korvataan. Sidossääntö jaetaan nykyisen lukijan kanssa; `legacyMissingDocument`, preserved-kopio ja testin/asiakaslähetyksen erot säilyvät. |

**Luennan rajat:** 039:n historiataulut ovat osin `WITHOUT ROWID` -tauluja.
Niille ei oleteta numeerista `rowid`-jatkoavainta eikä mahdollisesti pitkää
tekstitunnistetta siirretä kokonaisena vain sivutusta varten. Kokeen
SQLite-kursori palauttaa rajattuja skalaariprojektioita; pitkän tekstin
jatkoluku käyttää samaa tietokantakuvaa ja yksikäsitteistä järjestystä.
Kokeen ordinal/OFFSET-jatkoa ei vielä hyväksytä tuotannon hakuratkaisuksi:
sen kertautuva työ ja indeksien hyödyntäminen on arvioitava ennen kytkentää.

**Semanttinen portti:** JavaScriptin merkkijonon dekoodaus, tarkka yhtäsuuruus,
`trim()` ja UTF-16-pituus eivät kaikissa tapauksissa vastaa SQL-vertailua.
Koe toisti kahden eri virheellisen UTF-8-tavujonon muuttumisen samaksi
JavaScript-merkkijonoksi. Pelkkä SQL-join voi tällöin ohittaa nykyisen
duplikaatti- tai viitesäännön. Paloittainen dekoodattu vertailu läpäisi
rajatut kontrollit, mutta koko tunnistehaun ja duplikaattitarkistuksen
korvausta ei ole vielä todistettu. Uutta merkkikoodaus- tai yksittäisen
arvon hylkäysrajaa ei hyväksytä tämän kokeen perusteella. Myös tietokannan
merkistön ja schema-portin edellytykset kirjataan ennen tuotantototeutusta.

**Kohdenäyttö:** koe todensi rajatun JavaScriptiin luennan, pitkän arvon ja
avaimen, Unicode-/NUL-käsittelyn, myöhemmän tapahtuman virheen, lukukuvan
säilymisen toisen yhteyden kirjoittaessa sekä lukijan sulkemisen virheessä
ja hallitussa peruutuksessa. Jatkoluku katettiin usealla pitkällä rivillä
sekä kesken yhden arvon lukemisen tehtävällä WAL-kirjoituksella. Tekstivertailu
hylkää myös samanpituisen arvon viimeisen merkin eron. Ensivirhe säilyy
erillään sulkuvirheestä; pelkkäkään sulkuvirhe ei tuota onnistumistulosta.
Nykyisen 038 -> 039 -fixturen katalogi säilyi. Lopullisen rajatun koesarjan
37 tapausta ja tyyppitarkistus läpäisivät. Riippumaton lukupohjainen
katselmus ei löytänyt korjatusta luentakokeesta avointa oikeellisuusvirhettä.
Tämä ei todista koko uuden validaattorin sääntövastaavuutta, natiivin
muistikattoa, ulkopuolelta tulevaa prosessiperuutusta tai paketoitua palautusta.
Sulkuvirhekoe todistaa virheiden erottelun, ei natiivisti sulkematta jäävän
kursorin onnistunutta siivousta.

**Aiempi rajattu suunnitteluportti:** täsmennä yhteisten sääntöjen
kenttäkohtainen jako sekä koko avain-/viitevertailun rajattu toteutustapa ja
todista niiden vastaavuus nykyiseen tarkistimeen. Ei uutta yleistä tekstin-
streamaus- tai validointikehystä. Riippumaton katselmus ja tämän portin
näyttö edeltävät erillistä tuotantokytkentäpäätöstä. Tämän portin jälkeinen
hyväksytty toteutusrajaus on alla. K:n muut loppuportit ja
erillinen muistivirheen syyketjukorjaus säilyvät.

Indeksoitu SQL-haku edellyttää molempien puolten tyyppi-, dekoodaus-,
collation- ja null-sääntöjen vastaavuutta. Poikkeavien dekoodattujen
avainten duplikaattitarkistusta ei saa tehdä vain SQL-haun puuttuessa:
ristiriita voi olla olemassa myös täsmällisen SQL-osuman rinnalla.
Tämä on kokeen nimenomainen hylkäyskontrolli, ei uusi
hyväksyntäpolitiikka tai lupa tunnisteiden normalisointiin.

**Viitevertailun jatkokoe ja rajattu suunnittelupäätös:** erilliset 12 synteettistä
avainvertailutapausta sekä tyyppitarkistus läpäisivät. Nykyinen katalogi voi
hyväksyä PDF:ttömän legacy-revision, jonka tekninen tunniste sisältää
virheellisesti koodattuja tavuja. Tallennettujen tavujen SQL-vertailu,
dekoodatun tunnisteen vertailu ja sen palauttaminen SQL-parametriksi eivät
ole tällöin sama sääntö. Tämä ei osoita koko varmuuskopioketjun hyväksyntää
eikä koske havaintoa käyttäjän aineistosta. Kelvollisen Unicoden ja pitkän
tunnisteen kontrollit säilyivät.

Omistaja hyväksyi jatkosuunnitelman suunnaksi virheellisen koodauksen
hylkäämisen nimetyissä relaatiotunnisteissa. Tämä on hyväksyntäkäytöksen
rajattu muutos, ei väite vanhan tarkistimen täydestä vastaavuudesta.
Vanha tuettu skeema ja siitä tehtävä migraatio eivät ole vioittunut tunniste;
niiden yhteensopivuus pitää edelleen todistaa. Tunnisteita ei normalisoida,
korjata tai poisteta automaattisesti. Yhteinen katalogi osallistuu myös uuden varmuuskopion luontiin
ja palautumisen tarkistuksiin, joten päätös ei koske vain vanhan kopion
tuontia. Vapaata tekstiä, kelvollisia Unicode-merkkejä, formaattien nykyistä
tukea tai kokorajoja ei muuteta tällä suunnittelulla. Täsmällinen kenttärajaus,
rajattu toteutustapa ja katselmus viimeistellään ennen erillistä
tuotantokytkentäpäätöstä.

<a id="m1-source-preparation-l1287"></a>

#### Historian luennan toteutussopimus

**Omistaja hyväksyi rajatun tuotantokytkennän ja testit 13.10.2026.**
Hyväksyntä kattaa alla nimetyn osissa luennan, yhteiset tarkistussäännöt ja
rajatun virheellisen tunnistekoodauksen hylkäyksen. Se ei hyväksy K:n
kokonaisuutta tai mergeä eikä muuta formaatteja, riippuvuuksia tai rajoja.

Suunnittelu koskee nykyisen katalogin `revisionHistory`-haaraa.
`legacyDocuments`-valinta säilyy varmennetun skeemaversion perusteella;
vanhaa aineistoa ei käsitellä uuden skeeman kyselyillä. Migraation jälkeinen
revisiohistoria tarkistetaan uuden haaran sopimuksella. Historiallisia
migraatioita, palautusformaattia, laskentasääntöjä tai tavallisen sovelluksen
kokonaisia laskumalleja ei muuteta tämän luentatavan vuoksi.

Tuotantoehdokas korvaa katalogin kasvavat rakenteet yhtenä rajattuna muutoksena:

1. Invoicingin sisäiset, täsmällisesti nimetyt SQL-projektiot palauttavat
   rajattuja numero-/tekstihavaintoja. Etenemisavaimet pysyvät SQLiten
   sisällä; pitkää tunnistetta ei lueta kokonaisena JavaScriptiin sivutusta
   varten. Pelkkä `.iterate()` koko riville ei täytä muistirajausta.
2. Nykyisen mapperin otsikko-, rivi-, ALV-ryhmä- ja loppusäännöt erotetaan
   pieniksi saman moduulin yhteisiksi tarkistuksiksi. Normaali mapper ja
   varmuuskopion tarkistin käyttävät niitä molemmat. Ei korvaavia tyhjiä
   sisältöolioita, toista laskentaa tai yleistä validointikehystä.
3. Nykyrevision vertailu käyttää persistence-mapperin yhteisiä täsmällisiä
   kopio-/lähdekenttiä ja lähteen tarkistusta. Kenttäkohtainen kattavuustesti
   estää uuden snapshot-kentän unohtumisen vertailusta. Null-ero, dekoodatun
   tekstin yhtäsuuruus ja molempien järjestettyjen rivijonojen loppuminen
   säilyvät. `invoices.credited_invoice_id` ei kuulu uuden koodauseston
   kenttiin: sen lähdevertailu säilyy dekoodattuna, ei uutena SQL-oikopolkuna.
4. Nimetyt orpo-, historia-, nykyrevisio- ja hyvityslähdekyselyt korvaavat
   kasvavat kartat ja joukot. Jokaisella laskulla on historia; sallitut tilat
   ovat `approved`, `sent`, `cancelled` ja `reopened_for_edit`. Uudelleenavatulla
   ei ole nykyrevisioviitettä, muilla on. Hyvityslähteen ei tarvitse olla
   nykyinen: sen yritys, täsmärevisio, standard-laji, numero ja päivä säilyvät
   tarkistuksessa. Null-lähderiviviite ei muutu pakolliseksi.
5. Myös yhden revision rivit ja ALV-ryhmät käsitellään osissa. Jokaisen
   ALV-ryhmän verokanta ja kolme summaa ovat ei-negatiivisia turvallisia
   kokonaislukuja; ryhmän oma `net + vat = gross` tarkistetaan ennen
   kokonaissummia. Verokantajoukkojen vastaavuus tarkistetaan molempiin suuntiin.
6. Tapahtumaluenta jakaa nykyisen dokumenttisidoksen säännön sen lukijan
   kanssa. Legacy-tapahtuman nykyinen aikainen paluu ja PDF:n puuttumisen
   poikkeus säilyvät. Nykyisin rajattua dokumenttiluetteloa ei kirjoiteta
   uudelleen. Korvatut historian kokonaistaulukot poistetaan vasta vastaavan
   kattavuuden jälkeen; rinnakkaista vanhaa katalogitarkistinta ei jätetä.

**Rajattu tekstitarkistin:** `validateInvoiceRevisionIdentifiers` käyttää
samassa lukutransaktiossa kiinteitä otsikko- ja rivikenttiä sekä aiempaa
natiiviavaimella etenevää tavuluentaa. Tavallisen mapperin nonblank-sääntö
ja yksikön trimmatun UTF-16-pituuden sääntö ovat yhteisiä. Vain työmuisti
rajataan: pitkä tunniste, kuvaus tai yksikön ympäröivä tyhjätila ei saa
uutta kokorajaa. Null, tyhjä ja whitespace-only säilyvät eri arvoina.
Tämä kenttäjoukko ei laajenna relaatiotunnisteiden koodausestoa.

Vapaan tekstin tulkinta säilyy tavallisen tietokanta-ajurin mukaisena.
UTF-16-tallennuksen osissa luenta käyttää rajattujen fragmenttien SQLite-
muunnosta samalla yhteydellä; tavallinen tekstidekooderi yksin ei säilyttänyt
kaikkien virheellisesti koodattujen vapaiden arvojen aiempaa tulkintaa.
Muunnos valmistellaan ennen kursorin avaamista. Ensimmäinen lukuvirhe
säilyy sulkuvirheestä erillään, ja yhä varattu kursori estää onnistumisen.
Tekstitarkistin kuuluu nyt alla kuvatun yhtenäisen katalogikytkennän osaksi.
Sen oma kohdenäyttö ei yksin todista koko K:n muistirajaa tai palautusta.
Tekstiosan seitsemän tiedoston regressiokierros ja tyyppitarkistus läpäisivät.
Rajattu riippumaton katselmus ei löytänyt avointa toteutusvirhettä;
sen pyytämät natiivin muunnosvirheen ja samanaikaisen sulkuvirheen kontrollit
läpäisivät. Koko historian kytkentä ja jäljempänä vaaditut loppuportit säilyvät.

**Rajattu numero-, tila- ja ALV-lukija:** `validateInvoiceRevisionScalars`
käsittelee otsikot, rivit ja järjestetyt ALV-ryhmät samassa lukutransaktiossa.
`invoiceRevisionScalarScanSql` palauttaa vain kiinteät tyyppi-/viitehavainnot,
numerot ja nykyisen kieliopin rajaamat pienet enum-/päiväarvot. Tunnisteita
tai vapaita tekstejä ei palauteta kokonaisina. Se edellyttää skeeman,
relaatiokoodauksen ja nonblank-/yksikköarvojen tarkistusta samassa lukukuvassa.
Skeeman varmennetut avaimet takaavat rivien järjestysnumeroiden ja
ALV-kantojen yksilöllisyyden; kyselysuunnitelman tarkistus kattaa järjestetyn
luennan ilman tulosjoukon kokoista välilajittelua.

Tavallinen mapper ja uusi lukija jakavat provenienssin, kokonaislukujen,
tilojen, rivisuhteiden ja summien säännöt. Kolme `BigInt`-kertymää nollataan
revision vaihtuessa. Verokantojen vastaavuus tarkistetaan molempiin suuntiin;
laskurivien summista ei lasketa uudelleen historiallista ALV-erittelyä.
Legacy-erittelyn puuttuminen ja käännetyn verovelvollisuuden aikainen haara
säilyvät. UTF-16:n tavallisen ajurin ohittama pariton lopputavu ei saa
muuttaa pienen vapaan kentän hyväksyntää uudeksi koodausestoksi.

Skalaarilukijan, tavallisen lukijan ja nykyisten katalogien regressiokierros,
tyyppitarkistus sekä rajattu riippumaton katselmus läpäisivät. Kontrollit
kattavat vanhan skeeman migraation, suuren rivijoukon myöhemmän virheen,
tarkat summat, WAL-lukukuvan sekä alkuperäisen virheen säilymisen myös
kursorin sulkemisen epäonnistuessa. Lukija kuuluu nyt yhtenäiseen
katalogikytkentään; vanha materialisoiva tarkistin on korvattu eikä jää
sen rinnalle tai uuden luennan perään.
Tämä osatulos ei vielä todista koko prosessin resurssirajaa tai palautusta.

**Nykyrevision ja hyvityslähteen luenta:** `validateInvoiceRevisionCatalog`
käyttää rajattuja teksti-, skalaari-, suhde- ja paritarkistuksia yhden
lukukuvan sisällä. Vanha laskujen/revisioiden/rivien kokonaisluenta sekä
sen kasvavat kartat ja joukot on poistettu. Katalogin omistava transaktio,
skeeman valinta ja erikseen rajattu dokumenttiluettelo säilyvät.

Tallennus ja vertailu jakavat `invoiceContentRevisionPersistenceRows`-
kenttäsopimuksen ja lähdesäännön. Natiivien järjestysavainten varaan tehtävä
riviparitus tarkistaa kattavuuden molempiin suuntiin sekä kaikki rivikentät,
myös rivitunnisteen ja järjestysnumeron. Näin se säilyttää järjestettyjen
jonojen vertailun ilman kokonaisia rivejä muistissa. Aukottomia
järjestysnumeroita ei vaadita. Hyvityksen täsmällisen lähderevision ei
tarvitse olla nykyinen, eikä null-lähderivistä tule pakollista viitettä.

Vapaat vertailutekstit dekoodataan rajatuissa osissa tavallisen ajurin
säännöillä. Eri tavumäärä tai lukupalojen eri pituus ei yksin tarkoita
sisältöeroa. Null-, teksti- ja numeroeroja ei peitetä SQL-muunnoksilla.
Nykyisen laskun koodauseston ulkopuolinen `credited_invoice_id` säilyy
dekoodattuna vertailuna. Kummankin lukijan sulku yritetään myös virheessä;
sulkuvirhe ei korvaa ensivirhettä. Yksikään aktiiviseksi jäävä lukija ei
oikeuta onnistunutta tulosta.

Pariluennan ja nykyisten katalogien kohderegressiot sekä rajattu riippumaton
katselmus läpäisivät. Sisäistä tarkistinta suoraan käyttäneet legacy-testit
on sovitettu katalogin oikeaan transaktio-omistajaan, ja palautusketjun
kutsujatestit läpäisivät. Sisältö- ja historiavaatimuksia ei kevennetty.
Tämä on katalogikytkennän checkpoint, ei koko K:n hyväksyntä.
[Muistivirheen turvallinen syyketju](release-0.3.0-profile-validation-history.md#m1-source-preparation-l1146) on
kohdetodennettu erikseen. Eristetyn ajurin resurssitodennus, paketoitu
palautus sekä PR/main-portit pysyvät erillisinä loppuehtoina.

**Lukutavan jatkonäyttö:** kiinteän revisiotaulun natiivi etenemiskoe läpäisi
31 tapausta sekä tyyppitarkistuksen. Rajattu näyttö sisältää pitkät avaimet
ja tekstit, myöhemmän rivin virheen, lähdetavujen säilymisen, keskeytyksessä
sulkeutuvan lukijan sekä samassa lukukuvassa pysymisen toisen kirjoittajan
muuttaessa seuraavia tavuja. Ensimmäisen koeversion oma tekstimuotoinen
SQL-rakennetarkistus korjattiin; sen hylkäys säilyy erillisenä.
Lukutavan omissa kokeissa sulkuvirhe ei peitä ensivirhettä eikä yksinään
tuota onnistumista. Koefixturen siivous yrittää myös muiden omistettujen
yhteyksien sulkua yhden tallennus- tai sulkuvirheen jälkeen; epävarma siivous
estää tutkimusaineiston poistamisen.

Kokeen yksi alkuarvo ja enintään yksi seuraaja käyttävät `UNION ALL` -kyselyä.
Todennettu kyselysuunnitelma käyttää pääavainhakuja ja co-routine-luentaa.
SQLiten [rekursiivisen kyselyn kuvaus](https://www.sqlite.org/lang_with.html#recursive_common_table_expressions)
selittää jonon ja duplikaattiseurannan eron, mutta se ei korvaa oman kyselyn
todennusta. Pitkä avain ja tietokantamoottorin välitulokset kuluttavat silti
natiivimuistia: tämä ei ole koko prosessin muistirajan todiste.

**Ennen kytkennän hyväksyntänäyttöä:** pysyvät regressiot kattavat myös yhdistelmä-
ja nullable-avaimet, kaikki yllä nimetyt säännöt, nykyisen ja historiallisen
aineiston, pitkät yksittäiset arvot ja suuren määrän pieniä revisioita,
parivertailut sekä virheen/sulkemisen erottelun. Vanhaan tarkistimeen verrataan
hyväksyntätulosta kaikissa muissa tapauksissa kuin erikseen hyväksytyissä
virheellisen tunnistekoodauksen poikkeuksissa. Natiivin tarkistusajurin ja
paketoidun palautuksen näyttö vaaditaan edelleen. Erillinen `SQLITE_NOMEM`-
syyn säilyttäminen tehdään nykyiseen virheketjuun. Ei uusia riippuvuuksia,
aikarajoja, historiakokorajoja tai testialustaa. Tämä on hyväksytty toteutusrajaus,
ei ilmoitus koko tarkistimen tai K:n valmistumisesta.

**Ensimmäinen toteutuspala:** tallennettujen arvojen sekä otsikon, rivien ja
ALV-koosteen säännöt on erotettu Invoicingin sisäisiksi yhteisiksi funktioiksi
ja kytketty tavalliseen revisiolukijaan. Rajattu riippumaton katselmus ei
löytänyt hyväksyntäsäännön regressiota. Katselmuksen jälkeen säilytettiin
käännetyn ALV:n aikainen paluu ja lisättiin oikean lukijan Unicode- sekä
usean samanaikaisen virheen kontrollit. Lopullinen 12 tiedoston kohdeajo
läpäisi 373 testiä ja backendin tyyppitarkistuksen, mukaan lukien vanhan
skeeman migraatio ja palautuksen valmistelu. Nämä eivät ole koko työtilan tai paketoidun ketjun
hyväksyntä.

**Relaatiotunnisteiden toteutuspala:** nimetyn kenttäjoukon koodausesto on
kytketty katalogin nykyiseen lukutransaktioon ennen historiatarkistuksia.
Kiinteät SQL-projektiot pitävät etenemisavaimet SQLitessä ja palauttavat
vain rajattuja tavupaloja. Yhdistelmäavaimet sekä vanhojen taulujen todelliset
rivitunnisteet käsitellään erikseen; nullable-ID ei saa aiheuttaa rivin
ohitusta. UTF-8- ja UTF-16-tallennuksen käsittely ei muuta skeeman erillistä
yhteensopivuuspäätöstä. Vain nimettyjen tekstiviitteiden virheellinen koodaus
hylätään tällä säännöllä; muut tyyppi- ja null-säännöt jäävät nykyisille
tarkistimille. Pitkän avaimen natiivimuisti kuuluu edelleen eristetyn
tarkistusprosessin nykyisiin rajoihin, ei JavaScript-palakoosta johdettuun
oletukseen. Historian muut rajatut projektiot, parivertailut ja kasvavien
katalogirakenteiden korvaaminen ovat edelleen kesken.
Tämän palan rajattu katselmus ei löytänyt toteutusvirhettä. Sen nimeämät
tyhjän/täsmämittaisen tekstin ja palarajan ylittävän UTF-16-merkin kontrollit
lisättiin. Lopullinen kuuden tiedoston kohdeajo läpäisi 221 testiä; yksi
ennestään ohitettu tapaus pysyi ohitettuna. Erillinen palautuskutsujien ajo
läpäisi 217 testiä kolmella ennestään ohitetulla tapauksella. Backendin
tyyppitarkistus läpäisi. Nämä ovat lähdekoodin kohdetodennuksia, eivät
paketoidun palautuksen tai koko K:n hyväksyntä.

**Toimitushistorian toteutuspala:** tapahtumien kokonaistaulukko ja
ratkaisemattomien toimitusten kasvava muistijoukko on korvattu kiinteillä
SQL-tarkistushavainnoilla. Dokumenttisidoksen sääntö on yhteinen tavallisen
historian PDF-lukijan kanssa. Katalogin tapahtumaluenta tapahtuu vasta
relaatiokoodauksen, revisioiden ja rajattujen dokumenttien tarkistuksen
jälkeen samassa lukutransaktiossa. Legacy-null, legacy-haaran aikainen paluu,
yritysrajaus sekä nykyiset toimitus- ja todistevaatimukset säilyvät.
Korvattu algoritmi on vain testiorakkelina, ei rinnakkaisena tuotantopolkuna.
Rajattu riippumaton katselmus ei löytänyt hyväksymissäännön regressiota;
sen nimeämät tunnisteiden tyyppi-/Unicode- ja rajauskontrollit lisättiin.
Lopullinen kahdeksan tiedoston kohdeajo läpäisi 219 testiä yhdellä ennestään
ohitetulla tapauksella. Mukana ovat vanhan skeeman palautuksen valmistelu,
tavallinen historian PDF-luku, muuttumaton lukukuva toisen kirjoittajan
aikana sekä ensivirheen ja sulkuvirheen erottelu. Backendin tyyppitarkistus
läpäisi. Nämä ovat kohdetodennuksia, eivät koko K:n hyväksyntä.
Revision otsikoiden, rivien, ALV-ryhmien ja nykyrevision parivertailun
kokonaistaulukoiden korvaaminen sekä natiivi- ja palautusportit ovat yhä
avoimia. Tätä palaa ei tulkita koko katalogin muistirajan hyväksynnäksi.


<a id="m1-unit-preparation-1510-2394"></a>

> Historical source: `eky_software/docs/architecture/release-0.3.0-m1-preparation-plan.md:1510-2394` (original and provenance retained privately).
> Original source-unit checksums are retained privately. Historical pending states are not current authority.

<a id="m1-source-preparation-l1510"></a>

### Suuren katalogin palautusraja

Nimetty suuremman synteettisen PDF-katalogin koe ei vielä läpäise cold-forward-
palautuksen nykyistä yhteistä työbudjettia. Tarkistusutility valmistui ja
poistui, mutta sen jälkeen saman sisällön toistuvat tarkistukset saavuttivat
aikarajan ennen live-terminalin hyväksyntää. Rajattu vaihehavainto erotti
tämän tarkistusprosessin jumittumisesta. Alkuperäinen tietokanta, PDF:t,
staging-aineisto ja journal säilyivät; siivousvaltuutta ei päätelty tästä.
Ensimmäisen ajon erillinen varauksen sulkuvirhe säilyy omana havaintonaan.

Tarkistuskohtien lähdekartoitus ja pieni synteettinen koe erottivat
journal-kirjoitukset, korjaavat luvut ja business-tiedostomuutokset.
Koe käytti nykyistä journal-storea ja siirtotransaktiota oikeisiin
synteettisiin tiedostoihin; sisällön tarkistus oli rajattu hash-kontrolli,
ei SQLite-, native-omistajuus- tai suorituskykytodistus.

Rajattu riippumaton suunnittelukatselmus vahvisti, ettei business-siirron
myöhempi hylkäys korvaa journalin omia tarkistuskohtia: ilman niitä muuttunut
sisältö voisi sallia uuden journal-välitilan julkaisemisen tai edeltäjän
poistamisen. `read` puolestaan voi korjata tai poistaa sivuslotin. Puuttuvan
slotin havainnon jälkeen ei saa jättää suojaamatonta poistokutsua, joka voisi
osua myöhemmin ilmestyneeseen tiedostoon.

**Rajattu lukutehon koe hyväksytty 12.10.2026, ei tuotantokytkentää.**
Omistaja hyväksyi suunnittelun ja synteettisen kokeen enintään neljän PDF-tiedoston rinnakkaisesta luvusta
yhden sisältötarkistuksen sisällä. Tietokannan luku säilyisi erillisenä,
journalin ja transaktion tarkistuspaikat ennallaan. Koe ei käytä vanhan
tarkistuksen hashia, aikaleimaa tai kuittia uusien tavujen korvikkeena.
Erillinen koeehdokas on toteutettu ilman tuotannon lähde- tai build-muutoksia.

Kokeen vähimmäisehdot ovat samat koko-, hash-, PDF-alkutunniste-,
polku-/kahvaidentiteetti- ja linkkitarkistukset sekä viimeinen uudelleensidonta
tuoreen valtuustarkistuksen jälkeen. Rinnakkaisuus ja puskurit rajataan;
virhe tai peruutus estää seuraavan erän aloittamisen. Käynnissä olevien
lukujen ja kahvojen päättyminen todetaan ennen onnistumista tai vapautusta,
ja ensimmäinen virhe säilyy erillään mahdollisista sulkuvirheistä. Myöhäinen
luku ei anna poisto- tai jatkovaltuutta. Nykyinen epävarman aineiston
säilytyssääntö pätee edelleen.

Ensin verrataan muuttuneiden samankokoisten tavujen, vanhentuneen valtuuden,
slot-ristiriitojen ja sulkuvirheiden hylkäyksiä nykyisiin kohderegressioihin.
Vasta vastaavan turvallisuuskäyttäytymisen jälkeen nimetään rajattu
vertailu samalla synteettisellä aineistolla. Jos hyöty ei riitä, tulos
kirjataan ja vaihtoehdot tuodaan omistajan päätettäväksi; tästä ei seuraa
automaattista tarkistusten vähentämistä, yleistä välimuistia tai uutta
testialustaa. Tuotantokytkentä ja oikean palautusketjun hyväksyntä ovat
erillisiä myöhempiä portteja.

Koeehdokkaan ja nykyisen sarjaluennan sekä koeraportin 50 kontrollia läpäisivät.
Mukana ovat DB-/PDF-slottiyhdistelmät, muuttuneet tavut ja tiedostoidentiteetti,
myöhäinen muutos viimeisessä valtuustarkistuksessa, vanhentunut valtuus sekä
kesken lukuerän tapahtuva peruutus, määräajan päättyminen ja luku-/sulkuvirhe.
Hallittu suoritusjärjestys todisti, ettei uusi erä tai tietokannan luku ala
epäonnistuneen erän jälkeen eikä tulos valmistu keskeneräisten lukujen yli.
Varmistamattoman sulun koe jäi hylätyksi ja säilytti aineiston; koeharnessin
myöhempi kahvan sulkeminen ei ollut tarkistimen onnistumista.
Katselmuksen osoittamat koepuutteet korjattiin: hash-hylkäys erotettiin
alkutunnisteen hylkäyksestä, ensivirheen säilyminen todistettiin ensimmäisen
sulun ollessa edelleen estettynä ja lähdetiivistevirheen loppuraportti
todennettiin erillään alkuperäisestä virheestä.

Ensimmäinen koe pysähtyi suurten PDF:ien kontrollin virheelliseen täsmällisen
rinnakkaisuusmäärän odotukseen. Sallittu raja on enintään neljä; erillinen
hallitun järjestyksen koe todistaa neljän yhtäaikaisen luvun. Vain tämä
testiodotus korjattiin ennen nimettyä uutta koetta. Ensihylkäys säilyy.
Rajattu sarja-/eräluvun vertailu osoitti nopeushyötyä samoilla synteettisillä
tavuilla, mutta ei todenna koko cold-palautuksen aikabudjettia. Kokeen
tietokantatiedosto oli tarkoituksella pelkkiä testitavuja, ei SQLite-kanta;
native-omistajuutta, RSS-rajaa tai paketoitua palautusta ei tällä hyväksytä.
Riippumaton rajattu koekatselmus ei jättänyt korjattavaa tarkennettuihin
kontrolleihin. Tuotantokytkentä ja koko palautusketjun jatkoratkaisu ovat
edelleen avoinna; ne eivät seuraa automaattisesti yksittäisen lukijan nopeutumisesta.

**Jatkokokeen tulos 12.10.2026: lukunopeutus ei yksin riitä.** Erillinen
koekytkentä läpäisi Node- ja Electron-tarkistukset sekä rajatun katselmuksen.
Lukijan todellinen käyttö, tarkka koetoteutus ja lähteiden muuttumattomuus
varmennettiin; pelkkää moduulin lataamista ei tulkittu käyttötodisteeksi.
Koekytkennän ensimmäisen tarkistuksen oma käynnistysvirhe säilyy erillisenä
koeharnessin havaintona, ei sovelluksen vikana.

Yksi nimetty suuren katalogin oikean prosessiketjun koe eteni aiempaa
pidemmälle mutta hylättiin edelleen nykyisessä yhteisessä aikabudjetissa.
Ensimmäinen tarkistusutility valmistui ja poistui; toistuva sisältötyö kulutti
budjetin ennen seuraavan slottivalinnan erillisen tarkistuksen valmistumista.
Myös tämän tarkistajan poistuminen havaittiin. Live-terminalin hyväksyntään
ei päästy. Alkuperäinen kanta ja PDF:t, palautettavat tavut ja journal
varmennettiin säilyneiksi. Tämä ei todista koko ulomman prosessipuun puuttumista
eikä anna aineiston poisto- tai palautusvaltuutta.

Vain koepääprosessi käytti erälukuehdokasta. Tuotannon lähde ja build sekä
utilityn, journalin, aikarajan ja siivouksen sopimukset pysyivät muuttumattomina.
Tuotantokytkentää tai uutta pitkää uusinta-ajoa ei tehdä tämän tuloksen perusteella.
Seuraava päätös koskee koko palautuksen tarkistustyön rajattua suunnittelua,
ei uuden loggerin rakentamista. Journalin teknisten välivaiheiden ja varsinaisen
sisällön julkaisu-/siirtorajojen erottaminen on vasta ehdotus: nykyistä
sisältöporttisopimusta ei muuteta ilman omistajan päätöstä ja regressiotodistusta.

Tämän aiemman kokeen aikana [viiden mutaatiorajan sopimus](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2272)
säilyi voimassa. Myöhempi erillinen [tuotantopäätös](release-0.3.0-profile-validation-history.md#m1-source-preparation-l1926)
hyväksyi alla kuvatut tarkistuskohtamuutokset; se ei hyväksynyt hylättyä
hyväksyntäjournalin nopeutusta tai muiden tarkistusten poistamista.
Aika- ja muistirajat säilyvät. Kohdekokeita ei nimetä suuren katalogin
onnistumisen, hardened-palautuksen, enimmäisformaatin tai historiallisten
CI-aikakatkaisujen ratkaisuksi.

<a id="m1-source-preparation-l1615"></a>

#### Tarkistuskohtien jatkosuunnittelu

**Alkuperäinen päätös 12.10.2026 koski vain rajattua suunnittelua ja synteettistä koetta.**
Tuotannon viiden sisältöportin sopimus säilyy kokeen aikana. Seuraavat kolme
muutosta arvioidaan erillisinä ja yhdessä nykyisten omistajien koekopioilla:

1. Journalin `write`: nextin luonti/kirjoitus ja currentin siirto backupiksi
   käyttäisivät tuoretta omistajuus-, valinta- ja slottitarkistusta. Koko
   sisällön tarkistus säilyisi ennen nextin julkaisua ja ennen edeltäjän
   poistamista. Avatun nextin identiteetti ja muuttumattomat journal-tavut
   tarkistetaan edelleen; erillistä sisältöporttia vailla oleva kutsuja ei
   saa tätä kevennystä.
2. Journalin `read`: jos poistettava sivuslotti on aidosti poissa, sille ei
   tehdä poistokutsua lainkaan. Läsnä olevan slotin korjaus/poisto vaatii
   edelleen nykyisen valtuuden. Poissaolohavainto ei oikeuta myöhemmin
   ilmestyneen tiedoston poistamista. `clear` säilyy ennallaan.
3. Cold-forward-siirron kohdekansion valmistelu erotettaisiin payloadin
   siirrosta. Kansion luonti/oikeuksien rajaus säilyttäisi tuoreen omistajuuden,
   journal-valinnan sekä tuoreen rakenteen, slottien ja polkujen tarkistuksen
   ennen jokaista valmistelumuutosta; varsinainen rename ja
   aktivoitujen DB-/PDF-kohteiden oikeusmuutos vaatisivat edelleen tuoreen
   sisältötarkistuksen. Yhdistettyä vanhaa valtuutta käyttävät kutsujat ja
   rollbackin siirtovaltuus säilyvät ennallaan.

Tämä muuttaisi sallittuja teknisiä välitiloja: sisältövirhe voisi jättää
nextin, siirtää nykyisen journalin backupiksi tai valmistella kohdekansion
ennen hylkäystä. Se ei saa julkaista tarkistamatonta nextiä, siirtää business-
sisältöä tai poistaa palautusaineistoa. Uusi käynnistys tarkistaa sisällön
uudelleen; tekninen journal-valinta ei itsessään ole palautusvaltuus.

Kokeessa säilytetään ensivirhe ja molemmat aineistot. Muuttuneet DB-/PDF-tavut,
vanhentunut valtuus, next-/backup-ristiriidat ja keskeytykset ennen julkaisua
sekä ennen poistoa katetaan. Onnistuvan forward-polun lisäksi vanhat yhdistetyt
kirjoittajat ja rollback toimivat kontrollina. Tarkistusmäärä mitataan samalla
pienellä tiedostoaineistolla, mutta siitä ei päätellä suuren katalogin
suorituskykyä. Ei hash-välimuistia, tarkistuskuitin siirtämistä toiseen
slottiin, uutta rajapintakehystä, prosessia tai aikarajamuutosta.
Riippumaton suunnittelukatselmus ja koe edeltävät mahdollista tuotantopäätöstä.

**Rajattu koetulos:** korjattu ehdokas läpäisi 61 synteettistä tapausta.
Samalla pienellä aineistolla koko sisältö tarkistettiin lähtöpolussa 70 kertaa,
journal-muutoksen jälkeen 43, poissaolevien slottien no-op-erottelulla 39 ja
rakenteen tarkistavalla kansiovalmistelulla 27 kertaa. Nämä ovat kokeen
tarkistusmääriä, eivät suuren aineiston suorituskyky- tai aikarajatodistus.

Katselmus osoitti koekansion valmistelussa puuttuvan polkuselvityksen ennen
muutosta. Hakemistolinkkikoe toisti puutteen; koekopio korjattiin käyttämään
nykyistä forward-rakennetarkistusta omistajuus-/valintatarkistusten välissä.
Korjattu koe hylkää linkin ennen kansiomuutoksia. Tuotannon nykyiseen
toteutukseen tätä koepuutetta ei siirretty. Muut katselmuspuutteet katettiin
sisältöhylkäysten täydellisellä journal-slottien läsnäolo-/tiivistevertailulla,
siirron jälkeisillä hylkäyksillä sekä erillistä sisältöporttia käyttävän cold-
rollbackin keskeytys- ja jatkamiskokeilla. Aiemmat koetulokset jäävät historiaksi.

Muuttumaton nykyinen palautuskoodi jatkoi kahdeksasta tiedostosiirron jälkeisestä
intent-/completed-välitilasta ja hylkäsi muuttuneen aineiston ennen korjauksia.
Tämä ei ollut aiemman julkaistun ohjelmaversion tai käyttöjärjestelmän
kaatumiskoe. Cold-rollbackin jatko todettiin koekopiossa, ei vanhassa binäärissä.
Riippumaton lähdekatselmus ei jättänyt estävää löydöstä korjattuun rajaukseen;
tuotannon lähde ja build säilyivät muuttumattomina.

Omistaja hyväksyi seuraavaksi yhden nimetyn oikean palautusketjun kokeen, joka
yhdistää tarkistuskohtien ehdokkaan ja aiemman erälukuehdokkaan vain
koepääprosessissa. Koe käyttää oikeaa SQLitea ja tuhatta synteettistä PDF:ää
nykyisen aikarajan sisällä. Se ei ole hyväksytty tuotantokytkentä, aikarajan nosto
tai lupa toistaa koetta vihreäksi. K:n native-/Linux-/hardened-/PR-/main-portit
säilyvät erillisinä.

Nimetty yhdistetty koe on ajettu, mutta koko palautusketjun hyväksyntä puuttuu.
Live-terminalin loppusiivouksen rajattu lähde- ja työmääräkartoitus sekä
riippumaton tulkintakatselmus on tehty. Ne eivät sulje aikarajahavaintoa tai
hyväksy oikean palautusketjun loppusiivousta. Tarkempi aineisto säilyy paikallisena.

Nykyisen poistovaltuuden regressiot on täsmennetty erottamaan koko inventaarion
tarkistus yksittäisen poistokohteen odotettavasta identiteettiluvusta. Testit
todistavat, että sen aikana menetetty live-kirjoitussuoja tai sitä seuraavan
journal-luvun aikana vanhentunut valtuus estää poiston ja säilyttää hyväksytyn
journalin sekä alkuperäisen ja palautetun aineiston. Kahden testitiedoston
263 tapausta ja desktopin tyyppitarkistus läpäisivät. Tämä on nykyisen sopimuksen
regressionäyttöä testiadaptereilla, ei native-varausten, suorituskyvyn tai koko
palautusketjun hyväksyntä eikä lupa muuttaa tarkistuspisteitä.

Omistaja hyväksyi rajatun suunnittelun ja synteettisen kokeen vain
hyväksyntäjournalin toistuvien tiedostoluettelotarkistusten vähentämiseksi.
Inventaario todistaa
tiedostoidentiteettejä ja rakennetta, ei korvaa sisältövalidointia. Mahdollisen
suunnittelu- ja synteettisen kokeen pitää säilyttää tuore live-valtuus, täsmällinen
journal-valinta sekä jokaisen nimetyn tiedostopoiston valtuustarkistus myös
odotettujen lukujen jälkeen. Nykyistä sopimusta ei muuteta tämän kartoituksen
perusteella. Kylmävaiheen koekorjaukset eivät oikeuta muuttamaan poiston
valtuusrajoja, uuteen pitkään kokeeseen tai ehdokkaiden tuotantokytkentään.

Koe rajataan `commitAcceptance`-journalikirjoituksen nykyiseen
`separateContent`-sopimukseen. Journalin viisi mutaatioporttia, hyväksynnän
alkutarkistus, sisältövalidointi, muiden kutsujien sopimus ja nimettyjen
aineistopoistojen tarkistukset säilyvät. Erilliset muuttuneen aineiston,
vanhentuneen valtuuden ja journal-ristiriidan kokeet arvioivat myös odotusten
väliin jäävät rajat. Tarkistusmäärän väheneminen ei yksin hyväksy muutosta;
tuotantokytkentä vaatii kokeen ja katselmuksen jälkeen erillisen päätöksen.

**Hyväksyntäjournalin koetulos: ehdokas hylätty.** Rajattu koe valmistui ja
toisti kaksi turvallisuuseroa nykyiseen polkuun: journalin odotettavan luvun
aikana muuttunut inventaario voi tulla hylätyksi vasta `accepted`-julkaisun
jälkeen, tai journalin edellinen `.backup`-versio voi ehtiä poistua ilman
hylkäystä. Nykyinen yhdistetty tarkistus estää nämä samat koetilanteet ennen
kyseistä muutosta. Pelkkä lopullisen virheen tarkistus ei siis riitä; myös
pysyvät välivaiheet on verrattava. `.backup` tarkoittaa tässä journal-slottia,
ei käyttäjän varmuuskopiota tai alkuperäisten business-tiedostojen poistoa.

Onnistumispolku, viiden portin edellä tehdyt muutokset, omistajan menetys ja
journal-ristiriidat sekä keskeytystilat katettiin. Kahden myöhäisen lukuvälin
negatiivinen näyttö riittää hylkäämään tämän ehdokkaan; kaikkia mahdollisia
odotusvälejä ei väitetä katetuiksi. Synteettinen omistaja ja merkkitiedostot
eivät todista native-varauksen tai sisältövalidoinnin toteutusta. Nykyistä
tuotanto- tai build-koodia ei muutettu. Riippumaton lähde- ja koekatselmus
vahvisti hylkäyspäätöksen; säilytetyn aineiston jälkitarkistus läpäisi.
Mahdollinen uusi tarkistusten
sijoittelu on ensin suunniteltava näiden vastatapausten pohjalta; nykyiset
aineistopoistojen suojat, aikarajat ja K:n loppuportit säilyvät.

<a id="m1-source-preparation-l1735"></a>

##### Hyväksyntäjournalin viimeiset lukuvälit

Omistaja hyväksyi seuraavaksi vain rajatun suunnittelun ja synteettisen
kokeen kahden myöhäisen lukuvälin sulkemiseksi. Koekopio säilyttää nykyiset
viisi sisältöporttia ja arvioi lisätarkistusta ennen julkaisua sekä
journalin edeltäjäversion poistoa. Myös lisätarkistuksen aikana muuttuneet
journal-slotit, sisäisen valtuustarkistuksen viimeinen odotettava luku ja
yhteisten cold-kutsujien käyttäytyminen kuuluvat vertailuun. Pysyvät
välivaiheet ja säilyneet tiedostot ratkaisevat, ei pelkkä lopullinen
virhekoodi. Tämä ei hyväksy tuotantokytkentää, pitkää palautusajoa tai
muutosta nykyisiin aika-, sisältö- tai poistovaatimuksiin.

**Jatkokoe valmistui, ehdokas hylätty.** Lisätarkistukset estivät aiemmin
toistetut muutokset suorien journal-lukujen aikana. Viimeisen
lisätarkistuksen aikana muuttunut `.next` tai edeltäjän `.backup` voi
kuitenkin jäädä valitsematta: `peek` lukee kulloinkin ensisijaisen slotin,
ei kaikkia sivuslotteja. Seurauksena voi olla muuttuneen nextin julkaisu
tai journalin varakappaleen poisto ennen ristiriidan havaitsemista.
Näitä koekorjauksia ei kytketty tuotantoon.

Kunkin vaihtoehdon onnistumispolusta tunnistettiin myös viimeinen odotettava
journal-luku ennen julkaisua ja edeltäjän poistoa. Siihen ajoitettu
inventaarion tai valitun journalin muutos toistui myös nykyisen,
julkaisemattoman K-työpuun vertailupolussa; omistajan menettäminen estettiin.
Tämä on tiedostotransaktion koe testikorvatulla omistajuudella, ei todellisen
native-varauksen ohitustodiste tai asennetun version virhehavainto.
Kaikki alkuperäiset ja tuotavat koetavut säilytettiin tarkoituksellisia
virhemuutoksia lukuun ottamatta. Onnistuvat cold-forward-/rollback-kontrollit
eivät korvaa niiden kaikkia virhe- tai resurssikokeita. Lähde ja build
säilyivät muuttumattomina; tuotantokytkentä ja K:n loppuportit ovat avoinna.
Pelkkää tarkistusten toistamista ei pidetä näiden tulosten perusteella
riittävänä korjaussuunnitelmana.

Riippumaton lähde-, koe- ja tuloskatselmus sekä säilyneen aineiston
jälkitarkistus valmistuivat. Rajattu suunnittelu ja koe suljetaan kielteiseen
päätökseen, ei tuotantokytkentään. Nykyisen polun kanssa yhteiset
pakotetut tiedostomuutokset ohittivat kokeen omistajuussopimuksen; kokeessa
ei osoitettu vastaavaa kilpailevaa, valtuutettua Eky-kirjoittajaa.
[ADR-0009:n uhkarajaus](../decisions/ADR-0009-local-backup-encryption-and-recovery-points.md)
ja nykyinen yksinomaisen operaatio-omistajan sopimus eivät lupaa
käyttöjärjestelmätason atomisuutta saman tilin ulkopuolisille kirjoittajille.
Yhteinen havaintoraja ei siis yksin avaa uutta arkkitehtuuri- tai
omistajuusremonttia. Ehdokkaan uudet slot-regressiot hylätään silti nykyisiä
nimenomaisia suojia vasten. Seuraavan nopeutusehdotuksen pitää säilyttää
nämä suojat nykyisen omistajuussopimuksen sisällä; uutta ehdokasta tai
tuotantokytkentää ei hyväksytä tällä koetuloksella.

<a id="m1-source-preparation-l1782"></a>

##### Tiedostoluettelon rajatun lukuerän ehdotus

**Tila: rajattu tuotantokytkentä hyväksytty ja toteutettu työpuuhun;
laajemman todennuksen erillinen hylkäys jää avoimeksi.** Journalin
tarkistuskohtien siirtämisen sijaan muutos koskee vain jo kaapatun, muuttumattoman
tiedostoluettelon merkintöjen uudelleentarkistusta enintään neljän erissä.
Omistaja on nykyinen `assertTerminalCleanupCensus`. Erä voi sisältää
sekä tiedostoja että kansioita; pelkkä vierekkäisten tiedostojen erä ei kata
hierarkkisen PDF-arkiston lukutyötä. Tämä ei ole aiempi PDF-sisältötavujen
erälukuehdotus tai uusi yhteinen ajastin.

Rajattu riippumaton lähdekatselmus ei löytänyt kaapatun lapsimerkinnän
tarkistuksesta riippuvuutta vanhemman tarkistustulokseen. Sen metatietoluku
voisi kuitenkin alkaa ennen vanhemman hylkäystä. Koe ei siis saisi luvata
identtistä virhehetken lukujärjestystä tai käyttöjärjestelmätason atomisuutta.
Alkuperäinen puun keräys, polkujen ja linkkien tarkistukset sekä nykyinen
yksinomaisen operaatio-omistajan uhkarajaus säilyvät.

Hyväksytyn kokeen ja tuotantokytkennän rajat:

- Kaikki nykyiset census-provenienssi-, journal-/revisio-, juuri- ja
  ankkuritarkistukset säilyvät samoissa kohdissa. Journalin yhdistettyjä
  suojia, sisältöportteja tai nimetyn tiedostopoiston ketjua ei muuteta.
- Kukin merkintä suorittaa nykyiset identiteetti-, tiedostotyyppi-, linkki-
  ja kansiosisältötarkistuksensa samassa sisäisessä järjestyksessä.
  Puuttuvan tai jo poistetun kohteen tarkistukset ja juurten vaihdot pysyvät
  sarjallisina; käynnissä oleva erä päättyy ennen niitä.
- Enintään neljä merkintää saa olla tarkistuksessa kerrallaan. Jokainen
  aloitettu tarkistus odotetaan loppuun ennen erän tulosta; hylätyn erän
  jälkeen ei aloiteta uutta. Useasta virheestä säilytetään census-järjestyksen
  ensimmäisen hylätyn merkinnän alkuperäinen syy, ei nopeimman lupauksen syytä.
  Ulompi aikaraja ja valtuuden menetys eivät oikeuta myöhäistä muutosta;
  lupauksen hylkäystä ei väitetä käyttöjärjestelmän lukupyynnön peruutukseksi.
- Hallittu viivytys ja synkroninen/asynkroninen hylkäys todistavat erärajan,
  kaikkien aloitettujen lukujen päättymisen ja jatkon eston. Muuttunut tiedosto,
  kansio tai linkki, ylimääräinen lapsi, osittain poistettu aineisto sekä
  menetetty omistajuus tarkistetaan myös säilyneiden tavujen ja journalien
  avulla. Nykyiset viimeisen journal-luvun ja poistovaltuuden regressiot
  sekä onnistumispolku säilyvät vertailussa.

**Koetulos:** nykyisen ja eräehdokkaan hierarkkisen synteettisen aineiston
42 vertailu- ja kontrollitapausta valmistuivat hyväksytysti. Mukana ovat
sama onnistuvan luvun jäsenyys ja tarkistusjärjestys merkinnän sisällä,
eräraja ja kaikkien aloitettujen tarkistusten päättyminen, alkuperäisen
virheen säilyminen, muuttunut/linkitetty aineisto, osittainen poisto,
vanhentunut valtuus sekä nykyiset journal-julkaisun ja nimetyn poiston suojat.
Varsinainen ajokomento hylättiin silti loppuvertailussa: kahden odotetun
tiedostovirheen teksteissä oli eri synteettisen operaation tunniste.
Alkuperäinen hylkäys säilytettiin. Erillinen jälkitarkistus sitoi viestit
täsmällisiin säilyneisiin journaleihin ja varmisti tapausraportit,
säilyneet tiedostot sekä lähde- ja koekopiot ilman uutta koeajoa.

Tämä on tiedostojärjestelmä- ja journal-näyttöä korvatulla omistajuudella,
ei native-varauksen, SQLite-sisällön tai koko palautusketjun aikarajan
todennus. Odottavan lukulupauksen päättyminen ei todista käyttöjärjestelmän
lukupyynnön peruuttamista. Riippumaton tuloskatselmus ei löytänyt rajatusta
ehdokkaasta tai jälkitarkistuksesta etenemisen estettä. Kokeessa lähde ja build eivät
muuttuneet; tuotantokytkentä,
uusi pitkä Windows-palautusajo, aikarajan muutos tai K:n muiden porttien
ohittaminen eivät sisälly koetulokseen.

**Hyväksytty rajattu tuotantokytkentä:** kytkettiin vain nykyisen
`assertTerminalCleanupCensus`-tarkistuksen tunnetun luettelon lukusilmukkaan
enintään neljän merkinnän erä. Rajalla on omistavan moduulin nimetty
vakio; uutta yleistä ajuria, rajapintaa tai riippuvuutta ei lisätä. Puuttuvien
ja poistettujen merkintöjen sekä juurten sarjalliset rajat, kaikkien
aloitettujen tarkistusten päättyminen ja alkuperäisen census-järjestyksen
virhe säilyvät. Journalin tarkistuskohdat, sisältövalidointi ja poistojen
suojat eivät muutu. Pysyvät regressiot ovat transaktion vieressä omassa
rajatussa testitiedostossa; vaikutusalueen palautustodennus ja sen
hylkäykset käsitellään erikseen. Tämä päätös ei kata uutta pitkää Windows-ajoa
eikä K:n jäljellä olevien hyväksyntäporttien ohittamista.

**Rajattu toteutusnäyttö:** uusi 11 tapauksen pysyvä regressiosarja läpäisi.
Se todistaa erärajan, ensimmäisen luettelojärjestyksen virheen säilymisen,
aloitettujen tarkistusten päättymisen myös hylkäyksessä, osittaisen erän
odottamisen ennen poissaolotarkistusta sekä journalin lopputarkistuksen.
Riippumaton katselmus ei löytänyt tuotantokoodista estettä. Katselmuksessa
vahvistettiin yhden testin osittaisen erän todistus ennen lopullista ajoa.
Desktopin tyyppitarkistus ja build läpäisivät.

Laajemmassa palautus-, päivityspalautus- ja käynnistysketjun sarjassa
896 tapausta läpäisi ja yksi `desktopRestoreStartup`-testi aikakatkaistiin.
Sen jälkeinen testikansion siivous epäonnistui erikseen. Testi tarkistaa
terveyshylkäyksen jälkeistä rollbackia ennen hyväksyntää. Yksi sääntöjen
mukainen, samaa lähdettä käyttävä eristetty uusinta läpäisi; alkuperäistä
ajoa ei merkitä hyväksytyksi eikä juurisyytä korjatuksi. Tämä havainto ja
aiempi suuren katalogin palautusaikakatkaisu pidetään erillään. K:n
laajempi hyväksyntä jää avoimeksi, eikä rajattu eräluenta ole vielä koko
palautusketjun suorituskyky- tai paketoidun toimituksen todistus.

**Avoimen käynnistystestin rajaus:** lähdekoodin mukaan nimetty testi tekee
palautuksen valmistelun ja lykätyn validoinnin, hylkää toisen terveyskyselyn
ja peruu palautuksen pysäytetyn backendin jälkeen. Hyväksynnän
`commitAcceptance`-kutsua tai sen uutta census-erälukua ei tällä tarkoitetulla
polulla saavuteta. Tämä erottaa muutosalueet, mutta ei todista alkuperäisen
aikakatkaisun käynnissä ollutta vaihetta tai syytä.

Testitiedoston yhteinen `afterEach` poistaa rekisteröidyt juuret ja palauttaa
mokit myös aikakatkaisun jälkeen ilman testirungon päättymistodistetta.
Siksi siivous voi kilpailla kesken olevan testityön kanssa ja hävittää
ensivirheen aineistoa. Säilynyt aineisto on osittainen. Tämä on erillinen
testin elinkaaripuute, ei näyttö sovelluksen palautusvirheen juurisyystä.

**Hyväksytty aineistonsäilytyksen korjaus on kohdetodennettu.** Nimetty testi
käyttää nykyisten `profileRestoreStagingService`- ja `localUpdatePackageCache`-
testien mallin mukaista testikohtaista omistajuutta ja `onTestFinished`-koukkua.
Sen rajattu `desktopRestoreStartupTestSupport`-apuri säilyttää epäonnistuneen,
keskeytetyn tai vielä käynnissä olevan testirungon tiedostot. Myöhäinen jatko
ei siirrä juuria seuraavan testin siivouslistaan. Aloitettu ja valmistunut
vaihe, rungon päättyminen sekä resurssisiivouksen tulos erotetaan juurisyystä
suljetuilla testihavainnoilla; polkuja tai raakavirheitä ei lisätä tulosteeseen.

Broker-asiakkaiden sulku ja mokkien palautus odottavat tämän testirungon
päättymistä. Seuraavan testin valmistelu hylätään ennen yhteisten mokkien
nollausta, jos edeltävä työ tai sen resurssisiivous on vielä epävarma.
Jokainen sulku ja palautus yritetään erillisen virheen jälkeenkin. Myöhäisen
siivousvirheen turvallinen luokka jää havaintoon ilman uutta siivouskutsua;
sitä ei heitetä alkuperäisen virheen päälle. Tämä ei ole käyttöjärjestelmän
prosessipuun tai koko testialustan uusi elinkaarisopimus.

Seitsemän hallitun keskeytyksen, myöhäisen jatkon, aineistonsäilytyksen ja
resurssisiivouksen regressiota sekä desktopin tyyppitarkistus läpäisivät.
Riippumaton katselmus sulki myöhäisen siivousvirheen raportointipuutteen;
rajauksessa ei jäänyt uusia löydöksiä. Yksi nimetty kohdeajo läpäisi alkuperäisen
rollback-tapauksen ja sitä seuraavan sulkuvirhekontrollin, joka käyttää
tavallista testisiivousta. Muut tiedoston tapaukset rajattiin tästä ajosta pois,
eikä niiden todennusta uusittu. Käännöksen lähdeluettelo vahvisti, että apuri
ja testit jäävät tuotantokäännöksen ulkopuolelle.

Sovelluskoodi, nykyinen testiaikaraja ja palautuksen sisältöehdot säilyvät.
Korjatun aineistonsäilytyksen kohdenäyttö ei selitä alkuperäistä aikakatkaisua,
hyväksy aiempaa hylättyä sarjaa tai korvaa K:n puuttuvia loppuportteja.
Pitkää Windows-palautusajoa, uutta alustaa tai CI-kierrosta ei käynnistetty.

**Omistaja hyväksyi seuraavan valmistelun ja yhden koko ketjun kokeen.**
Hyväksytty census-eräluku yhdistetään vain koepääprosessissa aiempiin PDF-luku-
ja tarkistuskohtien koeehdokkaisiin. Nykyiset lähteet, kytkentä ja rajatut
kontrollit varmennetaan ennen yhtä oikean SQLiten ja synteettisen PDF-katalogin
Windows-koetta. Vanhan kokeen aineistoa ei korvata. Kysymys on myös
live-terminalin loppusiivouksen valmistumisesta nykyisissä aikarajoissa,
ei vain cold-vaiheen onnistumisesta. Tämä ei hyväksy journal- tai PDF-ehdokkaita
tuotantoon, hylättyä hyväksyntäjournalin sijoitteluehdokasta tai aikarajamuutosta.

<a id="m1-source-preparation-l1926"></a>

##### PDF-luvun ja cold-journalin tuotantokytkentä

**Yhdistetty koe läpäisi; erillinen tuotantokytkentä hyväksyttiin 12.10.2026.**
Nykyisiin lähteisiin sidottu valmistelu ja rajatut kytkentäkontrollit
todennettiin ennen yhtä nimettyä koetta. Oikean SQLiten ja tuhannen
synteettisen PDF:n ketju läpäisi cold-palautuksen, backendin terveystarkistuksen,
live-terminalin hyväksynnän ja loppusiivouksen nykyisissä aikarajoissa.
Tarkistajien päättyminen, varausten palautuminen, journal-slottien ja
operaation työkansioiden poistuminen sekä kaikkien kohde-PDF:ien tarkat
tavut varmennettiin. Vanhoja epäonnistumisia ei korvattu tällä tuloksella.
Koekytkentä ei vielä ole pysyvän tuotantototeutuksen tai koko K:n hyväksyntä.

Omistajan uusi päätös hyväksyy pysyvän toteutuksen, regressiot ja katselmuksen:

- PDF-lukija käsittelee korkeintaan neljä tiedostoa erässä. Kaikki aloitetut
  luvut ja sulut päättyvät ennen jatkoa; alkuperäinen virhe säilyy myös
  sulkuvirheen yhteydessä. DB-tarkistus, oikeat tiivisteet, koot, polku- ja
  kahvaidentiteetit sekä omistajuus säilyvät.
- Cold-journalin edeltäjäkirjoituksen tekninen valmistelu käyttää tuoretta
  omistajuutta ja täsmällistä slottivalintaa. Sisältö tarkistetaan uudelleen
  ennen nextin julkaisua ja ennen edeltäjän poistoa. Muuttuneet next-tavut,
  vieras backup tai uudelleen ilmestynyt next säilyttävät aineiston.
- Korjaava journal-luku ei poista todetusti puuttuvaa sivuslottia.
  Läsnä olevan sivuslotin poisto vaatii ennallaan säilyvän valtuuden.
- Cold-forwardin kansiovalmistelu käyttää tuoretta rakenne-, valinta- ja
  omistajuustarkistusta. Sisältösiirrot ja aktivoitujen tiedostojen
  oikeusmuutokset pysyvät tuoreen sisältötarkistuksen suojaamina.

`clear`, alkujulkaisu, tavallisten kutsujien yhdistetty tarkistus, rollbackin
siirtovaltuus ja hyväksyntäjournalin nykyiset tarkistuskohdat säilyvät.
Hylättyä hyväksyntäjournalin nopeutusehdotusta ei siirretä tuotantoon.
Pysyvä tuotantokytkentä, rajatut regressiot ja riippumaton katselmus läpäisivät.
PDF-eräluvun 22 testiä kattavat erärajan, aloitetun työn ja sulkujen
päättymisen, ensivirheen luokittelun sekä muuttuneen sisällön ja valtuuden
hylkäykset. Journal-storen 48 testiä, sisältövaltuuden 24 testiä ja koko
siirtotransaktion 249 testiä läpäisivät. Kansiovalmistelun jälkeinen
samankokoinen DB- tai PDF-muutos estää siirron todellisen tiivistetarkistuksen
perusteella; kansion luonnin aikana menetetty valtuus estää oikeusmuutoksen
ja siirron. Testit vertaavat myös säilynyttä aineistoa.

Vaikutusalueen muut cold-/rollback-/käynnistys-/hyväksyntä- ja
virheluokittelutestit, desktopin tyyppitarkistus ja build läpäisivät.
Ensimmäiset testimokkien kytkennän ja testiapurin tyypin hylkäykset säilyvät
erillisinä; niitä ei tulkita sovelluksen palautusvirheiksi tai hyväksytyiksi
ajoiksi. Katselmuksen kaksi regressionäytön puutetta korjattiin ja suljettiin.

Laajemmat palautusportit, puhtaan paketin mittaus ja Linux-todennus ovat
edelleen avoimia. Tämä kohdenäyttö ei muuta aikarajoja, muistirajaa tai
formaattirajaa eikä hyväksy koko K:ta tai mergeä.

<a id="m1-source-preparation-l1976"></a>

### Linux-tarkistuksen ajopolun päätös

Nykyisellä backend-buildillä ajettu erillisen Linux-tarkistusajurin seitsemän
kohdekontrollia läpäisivät. Ne kattavat nykyisen ja hyväksytyn historiallisen
rakenteen, todellisen SQLite-muistirajan hylkäyksen ja tarkistusresurssin
virhepolut. Tämä on Node-ajurin näyttöä, ei Electron-utilityn tai CI:n hyväksyntä.

Nykyiseen [Linux-testinomistajaan](e2e-test-environment.md#tuetut-suoritusympäristöt)
on lisätty vain varmuuskopion tarkistukseen rajattu `profileInspection`-hosti
backend-, Vite- ja Chromium-profiilien rinnalle. Omistaja hyväksyi rajatun
kytkennän ja testit 12.10.2026. Käynnistys-, tulos-, siivous- ja
ajokytkentäsopimusten kohdetestit läpäisivät; varsinainen Linux-Electron- ja
normaalien PR/main-porttien hyväksyntä on edelleen avoin; yllä nimetty
erillinen Linux-Electron-kertakoe läpäisi. Electron-käyttäjäpolut ovat Windows-only.
Linux-käyttäjäpolkuja
ei laajenneta, uutta supervisoria ei rakenneta eikä sandboxia tai prosessipuun
poistumisen vaatimusta ohiteta. Puuttuvat järjestelmätyökalut eivät saa johtaa
automaattiseen asennukseen tai varapolkuun.

Ajokytkentä kuuluu nykyiseen Linux-verifiointiin backend- ja desktop-buildien
jälkeen, nykyisine komento- ja vaihepeittosuojineen. Nimetty komento on
`pnpm --filter @eky/desktop inspection:proof:linux`.
Valmistelu käyttää hyväksyttyä native-käännöstä ja itsenäisten resurssitavujen
toimitusporttia; koe käyttää todellista mainin tarkistusporttia ja utilitya.
Vanha Windows-toimitusadapteri ja T3:n muut käyttäjät eivät muutu tämän perusteella.

Koe vaatii kolme erillistä tulosta: ehjän nykykopion hyväksynnän, muutetun
rakenteen schema-hylkäyksen ja puuttuvan tarkistusajurin hylkäyksen. Kukin käyttää
omaa operaatiota ja alkuperäistä rajattua elinkaarta. Todellinen utilityn
poistumiskoodi, mainille palautunut varaus, lähdetavujen säilyminen ja ulomman
Linux-omistajan koko puun pysähtyminen tarkistetaan erikseen. Puuttuva tai
vanhaan suoritukseen sidottu tulos estää hyväksynnän. Epäonnistuneen tapauksen
aineisto säilyy; rajattu prosessituloste kuuluu nykyiseen salattuun keräykseen.
Testihostin normaali nollapoistuminen vaaditaan tämän rajatun profiilin
työprosessilta erikseen; onnistunut tulostiedosto ei ohita myöhempää
epänormaalia poistumista. Katselmuksessa korjattiin puuttuvan ajurin
fixturen hakemistoraja, tämä poistumistodiste sekä valmistelun turvallisen
ensisyyn säilyminen. Rajatut sopimus-, kytkentä- ja tyyppitarkistukset
läpäisivät. Yllä nimetty oikean Linux-Electron-ajon kohdenäyttö läpäisi,
mutta normaalin PR/main-integraation hyväksyntä on yhä avoin.
Kohdetestien mockit eivät korvaa tätä oikeaa prosessinäyttöä. Kolme tapausta
eivät myöskään yksin kata historiallisia formaatteja, muistirajaa tai hardened
Windows -palautusporttia.

<a id="m1-source-preparation-l2020"></a>

### Candidate-tarkistuksen avausportti

`validatePublished`, `validateHistoricalPublished` ja `validateAndMaterialize`
käyttävät `openAttestedMigrationDatabase`-apua ilman uuden tai tyhjän kannan
hyväksyntää. Olemassa olevan tiedoston polku-, tyyppi- ja linkkirajat sekä
readonly-yhteyden schema/history-attestointi edeltävät `fileMustExist`-
kirjoitusavausta. Uusi yhteys attestoi rakenteen uudelleen; nykyiset pending-,
identiteetti-, eheys-, FK- ja PDF-katalogitarkistukset säilyvät. Vain
historiallinen tarkistus käyttää hyväksyttyä `restoreCompatible`-politiikkaa.
Tämä ei anna yhdellekään näistä operaatioista hot-journalin recovery-valtuutta.

Pelkkää pysyvää readonly-yhteyttä ei valittu: ehjä WAL-kanta voisi jättää
sivutiedostoja ja rikkoa seuraavan julkaisuportin täsmällisen tiedostojoukon.
Yhteinen avausapu säilyttää luotettavan kannan nykyisen natiivin sulkemisen;
sivutiedostoja ei poisteta uudella omalla poistologiikalla. Alkuperäisen
tuontisnapshotin erillinen kertakopiosopimus ei muutu.

Tarkistusvirhe säilyy ensimmäisenä myös readonly-esitarkistuksen tai lopullisen
kahvan sulkemisen epäonnistuessa. Sulkemisvirhe jää erilliseksi lisävirheeksi;
ulompi käyttäjä-/IPC-virhesopimus ja julkaisuraja eivät muutu.

Ennen korjausta kuusi rajattua regressiota toisti puuttuvan kannan luomisen
ja hot-journalin kulumisen ennen hylkäystä. Esitarkistuksen kaksi lisätapausta
toistivat ensivirheen peittymisen ja sulkemisvirheen puuttuvan erottelun. Korjattu candidate-/avaus-
sarja läpäisi 138 testiä (kolme alustakohtaista ohitusta), ja yhteisen avausavun
muiden kutsujien sarja läpäisi 48 testiä. Sarjat ovat osin päällekkäisiä.
Tyypintarkistus ja backend-build läpäisivät.
Erillinen 17 testin laskuhistoriasarja läpäisi myös ei-tyhjän PDF-katalogin
ja WAL-kannan yhdistelmän sekä 038-metadatan kanssa että ilman sitä.
Rajattu riippumaton lähdekatselmus ei löytänyt uutta ohitusta tai regressiota.
Sulkemisvirheet on injektoitu oikean sulkemisen jälkeen; ne todistavat
virheiden järjestyksen, eivät aidosti auki jäävän natiivikahvan siivousta.
Nykyiset prosessin exit- ja epävarman siivouksen säilytysrajat pysyvät voimassa.

Oikean Electron-utilityn kuusi tapausta kattavat kunkin operaation puuttuvan
kannan sekä ehjän WAL-kannan; historiallinen kontrolli käyttää hyväksyttyä
metadataa vailla olevaa 038-kantaa. Puuttuva tiedosto ei synny, terveiden
kantojen tavut ja suljettu tiedostojoukko säilyvät, lapsen exit todetaan ja
mainin varaus palautuu. Tämä on kohdenäyttö kehitysruntimessa, ei hardened-
paketin, Linuxin tai PR/mainin hyväksyntä. Alkuperäiset hylkäykset säilyvät.

<a id="m1-source-preparation-l2061"></a>

### Natiivin muistivirheen luokittelukorjaus

Kokonaiskytkennän katselmuksessa nimetty puute on korjattu rajatusti.
Scheman ja migraatiohistorian lukijat säilyttävät poikkeuksen täsmällisen
`SQLITE_NOMEM`-koodin, ja tarkistusoperaatio muuntaa sen nykyiseksi
`PROFILE_INSPECTION_LIMIT_EXCEEDED`-syyksi. Sama luokitus kattaa tarkistimen
eheys-, FK- ja identiteettiluvun sekä rajatut readonly-/referenssiavausvirheet.
Virheviestistä ei päätellä natiivikoodia; muu schema- tai historiahylkäys
säilyttää oman syynsä. Allokaation hylkäys ei yksin todista, mikä resurssi
loppui tai että juuri asetettu muistikatto tuli vastaan.

Alkuperäinen poikkeus säilyy prosessin sisäisenä syynä, ei julkisena
virhetekstinä. Tarkistuksen ensivirhe edeltää mahdollista sulkemisvirhettä;
pelkkä siivouksen muistivirhe ei korvaa aiempaa schema-hylkäystä. Nykyinen
tiukka statuskanava välittää vain sallitun turvallisen ensisyyn. Uutta
lokitusta, protokollaa, riippuvuutta tai resurssirajaa ei lisätty.

Kahdeksan uutta tapausta toisti luokittelupuutteen ennen korjausta.
Lopullinen backendin kohdesarja läpäisi 152 testiä kahdeksasta tiedostosta
ja desktopin runner-/virhe-/prosessisarja 116 testiä kolmesta tiedostosta,
ilman ohituksia. Näyttö käyttää injektoituja natiivipoikkeuksia todellisessa
tarkistusoperaatiossa ja erillisiä runnerin sopimustestejä. Se ei ole uusi
oikean utility-prosessin muistirajamittaus tai hardened-palautustodistus.
Backendin ja desktopin tyyppitarkistukset sekä backendin build läpäisivät.
Rajattu riippumaton lähdekatselmus ei löytänyt korjauksesta estävää havaintoa;
myös alla kuvattu testijako tarkistettiin erikseen. Katselmukset eivät kata
koko K:n vielä keskeneräistä kytkentää.

Kohdesarjan ensimmäinen ajo hylkäsi lisäksi kaksi aiempaa cold-palautuksen
matriisitestiä aikakatkaisulla ja yhden niitä seuranneen mock-kutsumäärän
tarkistuksen. Yksi muuttumattoman lähteen diagnostinen uusinta toisti vain
molemmat aikakatkaisut. Omistajan erillisellä hyväksynnällä kaksi neljän
sijaintiyhdistelmän silmukkatestiä jaettiin kahdeksaksi itsenäiseksi
testiksi. Jokainen säilyttää samat sisältö- ja omistajuustarkistukset sekä
viiden sekunnin rajan; nykyinen jälkisiivous suoritetaan jokaisen jälkeen.
Koko matriisin sallittu testiaika kasvoi hyväksytysti. Uusi kohdeajo läpäisi,
mutta alkuperäiset hylkäykset säilyvät eikä niiden juurisyytä nimetä
korjatuksi pelkän läpäisyn perusteella. Tämä testijako ei muuta sovellusta.

<a id="m1-source-preparation-l2100"></a>

### Aktiivivalidoinnin kutsujakohtainen omistajuus

Rajattu lähdekatselmus täsmensi seuraavan kytkennän. Tavallinen ja palautuksen
jälkeinen startup, live-päivityksen valmistelu ja handoff sekä ensimmäinen
käynnistys ja erillinen C-konteksti on kytketty alla kuvatusti.
Nykyinen eristetty tarkistusmoottori ja `captureCurrentOwner` riittävät;
yleistä varauksen siirto- tai pakkovapautusrajapintaa ei lisätä.

- Tavallinen ja palautuksen jälkeinen startup saavat nimenomaisen,
  mainin omistaman restore-varauksen. Tarkistin lainaa sen täsmällistä
  omistajuutta; se ei vapauta lainaamaansa varausta. Onnistuminen vapauttaa
  varauksen vasta nykyisten tarkistus- ja siivousehtojen täytyttyä.
- Hylätty palautus voi jatkaa samalla varauksella alkuperäisen aineiston
  rollbackiin vasta tarkistajien ja backendin varmennetun pysähtymisen sekä
  main-varauksen palautumisen jälkeen. Cold-rollback-kutsuja ei hanki samaa
  varausta uudelleen eikä vapauta lainaamaansa omistajuutta. Epävarma stop,
  kadonnut omistaja tai siivousvirhe estää jatkon ja säilyttää aineiston.
- Live-päivityksen valmistelu lainaa koordinaattorin jo omistamaa
  update-varausta. Ennen update-fenceä tehtävässä tarkistuksessa käytetään
  nykyistä tavallista snapshot-suojaa; journalin ja update-fencen nykyistä
  valmistelujärjestystä ei muuteta tämän kytkennän perusteella.
- Handoff lainaa samaa update-varausta ja jo voimassa olevaa update-fenceä.
  Snapshot muodostetaan sen operaatiotunnuksella vasta aiemman saman
  tunnuksen snapshotin todistetun poistamisen jälkeen. Tarkistus välittää
  update-kontekstin erikseen eikä päättele sitä varauksen kiireisyydestä.
  Update-fencen vapauttaminen jää koordinaattorille, ei tarkistimelle.
- Päivityksen ensimmäinen käynnistys on uusi runtime. Sen tarkistus
  säilyttää nykyisen validointi-, salaisuusidentiteetti-, hyväksyntä- ja
  siivousjärjestyksen sekä tilakohtaisen ketjuvertailun. Sitä ei rinnasteta
  elävän vanhan runtimen handoffiin tai hyväksytä vain tavallisella
  startup-testillä. Se tekee tuoreen eristetyn tarkistuksen mainin uudella
  restore-varauksella eikä käytä aiemman startup-tarkistuksen tulosta.
- C:n oma `validateActiveProfileForRollback`-portti välittää odotetun
  alkuperäisketjun ja koko valitun update-journalin tuoreen tarkistusfunktion.
  Kontekstia ei päätellä kiireisestä varauksesta tai globaalista fence-tilasta.
  Sama sidonta koskee journalitonta valmistumiskutsua ja restore-journalin
  terminal-kutsua. Vanhentunut valinta estää hyväksynnän ja journal-kirjoituksen.

Live-päivityksen sisäinen `validateActiveProfileForUpdate`-portti välittää
täsmällisen operaation ja vaiheen sekä kutsun elinikään sidotun omistajuuden
ja siivouskuittauksen. Main tarkistaa lisäksi todellisen update-leasen,
elävän sovellusinstanssin ja sen, ettei sulku ole alkanut. Startupin jo
päättynyttä valtuutta ei lainata live-päivitykseen. Tarkistimen puuttuva
kuittaus, varmentamaton lapsen poistuminen, poistovirhe tai suojan menetys
säilyttää omistajuuden. Myöhäinen vastaus ei kuittaa päättynyttä kutsua.
Siististi päättynyt sisältöhylkäys voi käyttää nykyistä abort-vapautusta
vasta omistetun aineiston poiston ja suojan tarkistuksen jälkeen.
Myös pre-update-palautuspisteen nykyinen tunnistettu cleanup-epävarmuus
estää vapautuksen. Alkuperäinen virhe säilyy sisäisenä syynä; julkinen
operational-tapahtuma käyttää nykyistä turvallista koodia ja tarvittaessa
`unknown`-sivuvaikutustilaa. Uutta protokollaa tai yleistä omistajaa ei lisätty.

Todennukseen kuuluvat oikea lease ja nykyiset kutsujat: onnistuva vapautus,
saman omistajan jatkuminen hylkäyksestä rollbackiin, väärä tai vanhentunut
omistaja, epävarma tarkistaja-/backend-stop, myöhäinen vastaus sekä
päivityksen valmistelu ja handoff ilman kaksoisvarausta tai fence-vaihtoa.
V2bj:n vanha konservatiivinen itse omistetun varauksen polku säilyy, kunnes
korvaavien kutsujien näyttö on olemassa. Journalittoman C-palautuksen
alkuperäisketjun sidonnan kohdenäyttö on kirjattu alle; koko K:n loppuportit
eivät sulkeudu sen perusteella.

**Startupin rajattu kytkentänäyttö:** omistajuuden, tarkistusclientin, cold-recoveryn ja
käynnistysrajojen kuuden tiedoston 234 testiä läpäisivät. Viisi nimettyä mainin
regressiota läpäisivät: sama omistaja kahdessa rollback-polussa, epävarma
tarkistajan poistuminen sekä alkuperäisen syyn säilyminen stop-/rollback-virheessä.
Lineage hylätään nyt jo validoinnissa; myöhempi virhe käyttää nykyistä
`PROFILE_RESTORE_RECOVERY_REQUIRED`-koodia ja säilyttää alkuperäisen syyn.
Koko main-sarjan ensimmäinen ajo ei läpäissyt: kahden virhekoodiodotuksen
lisäksi aiempi C:n ennen migraatioita tapahtuvan hylkäyksen rollback-testi
ylitti rajansa myös yhdessä muuttumattoman lähteen erillisajossa. Ensimmäisen
ajon siivoushylkäys säilyy erillisenä; aikarajaa ei muutettu eikä koko sarjaa
merkitä hyväksytyksi kohdetestien perusteella.

Eristetyn utilityn ja native-varauksen kahdeksan tapausta läpäisivät nyky-/038-
aineistolla sekä väärällä ketjulla ja muutetulla schemalla. Sekä itse omistettu
että lainattu varaus tarkistettiin; kaikki lapset poistuivat ja alkuperäiset
tavut säilyivät. Snapshot-muodostaja oli tässä rajattu testiadapteri: tämä ei
ole koko mainin, todellisen backup-muodostajan tai hardened-paketin hyväksyntä.
Desktopin tyyppitarkistus, build ja rajattu riippumaton lähdekatselmus
läpäisivät. Päivityksen vanhaa validaattoria ei poistettu tämän startup-näytön nojalla.

**Live-päivityksen rajattu kytkentänäyttö:** yhdeksän tiedoston 265 kohdetestiä
läpäisivät ilman ohituksia. Mainin erillisessä kohdeajossa 14 nimettyä testiä
läpäisivät; muut 121 eivät kuuluneet rajaukseen. Mukana ovat todellinen
update-lease, valmistelu ja handoff, epävarman tarkistussiivouksen omistajuus
sekä päällekkäisten ordinary/update-sulkujen nykyiset turvallisuusehdot.
Kun ordinary-sulku on jo alkanut, handoff hylätään ennen tarkistusta eikä
installer käynnisty. Vastakkaisen järjestyksen olemassa oleva odotus säilyy.
Ensimmäinen main-ajo paljasti väärän startup-valtuuden käytön live-kutsussa;
se korjattiin elävän instanssin ja sulkutilan tarkistuksella. Seuraavan ajon
kaksi vanhaa vaiheodotusta korjattiin todentamaan aikaisempi suljettu hylkäys,
ei pidentämällä aikarajaa tai poistamalla sulkuassertioita.

Eristetyn utilityn ja native-varauksen neljä live-päivitystapausta läpäisivät:
nykyinen ja muutettu schema sekä valmistelussa että handoffissa. Jokaisen
lapsen poistuminen, alkuperäisten tavujen säilyminen, siivouskuittaus ja
lainatun update-omistajan säilyminen todistettiin. Handoff ei vapauttanut
kirjoitussuojaa. Snapshot-muodostaja oli edelleen rajattu testiadapteri;
tämä ei ole oikean asentajan, koko main-ketjun tai hardened-paketin hyväksyntä.
Desktopin tyyppitarkistus ja build läpäisivät. Rajatun riippumattoman
katselmuksen löytämä pre-update-siivouksen vapautusaukko korjattiin ja
katettiin regressiolla; korjauksen uusintakatselmuksessa ei ollut avoimia
löydöksiä. Tässä live-päivitysvaiheessa ensimmäinen käynnistys ja C käyttivät
vielä vanhaa validaattoria; niiden myöhempi kytkentä on kuvattu alla.
Alkuperäistä C-aikakatkaisua ei merkitä korjatuksi.

<a id="m1-source-preparation-l2206"></a>

#### Ensimmäisen käynnistyksen ja C-kutsun kytkentä

FirstStart ja C käyttävät nyt mainin omistamaa eristettyä tarkistusta.
Ensimmäisen käynnistyksen hyväksyntä ei lainaa tavallisen startupin vanhaa
tulosta: se hankkii oman täsmällisen restore-varauksensa, tekee uuden
tarkistuksen ja jatkaa vasta sen jälkeen nykyisessä hyväksyntäjärjestyksessä.
Tarkistusvirheen alkuperäinen sisäinen syy säilyy `FirstStartUpdateError`-
syyketjussa ja nykyisessä yksityisessä havaitsijassa. Havaitsijan virhe ei
peitä ensivirhettä; julkista virhe- tai lokisopimusta ei laajenneta.

C:n erillinen portti välittää valitun journalin alkuperäisketjun sekä
täsmällisen valinnan tarkistuksen yhteiselle tarkistusapurille. Odotuksen
aikana muuttunut journal hylätään, myös silloin kun operaation tunnus,
tila ja revisio näyttävät samoilta mutta muu sidottu sisältö muuttuu.
Sisältöhylkäyksen jälkeen main pitää samaa restore-omistajaa varmennetun
tarkistaja-/backend-sulun ja alkuperäisaineiston rollbackin yli.
Epävarma sulku säilyttää palautusaineiston ja estää jatkon; UI tai
binaaripalautus ei avaudu sillä perusteella.

Koordinaattorien ja tarkistusapurien viiden tiedoston 129 testiä sekä koko
main-palautustiedoston 139 testiä läpäisivät ilman ohituksia. Uudet main-
tapaukset kattavat tuoreen FirstStart-tarkistuksen onnistumisen ja hylkäyksen,
C:n saman omistajan jatkuvuuden sekä epävarman tarkistaja-/backend-sulun.
Ensimmäisten kohdeajojen fixture-virheet säilyvät erillisinä hylkäyksinä;
session-hylkäyksen stub ja sulkutodiste korjattiin nykyisen sopimuksen
mukaisiksi. Rajatun katselmuksen löytämä liian heikko journal-kilpailutestin
väite vahvistettiin todentamaan oikean virhehaaran saavuttaminen ja koko
korvaavan journalin säilyminen. Uusintakatselmuksessa ei ollut avoimia löydöksiä.

Journaliton C-käynnistys läpäisi kuusi oikean prosessiketjun tapausta:
nykyinen ja metadataa vailla oleva 038-kanta kussakin kolmessa business-
palautustilassa. Kaikkien 30 utility-prosessin poistuminen ja varausten
palautuminen todistettiin. Koe käyttää todellista main-/W6-/backend-ketjua,
mutta tarkistusresurssien kehitystoimitusadapteria ja hallittua binaarikoordinaattoria.
Se ei ole varsinaisen asentajan, hardened-paketin tai Linuxin hyväksyntä.
Desktopin tyyppitarkistus ja build läpäisivät. Aikarajoja, riippuvuuksia tai eheysvaatimuksia ei muutettu;
aiemman C-aikakatkaisun juurisyytä ei päätellä myöhemmästä läpäisystä.

**Restore-journalillisen C:n native-kohdenäyttö:** nykyinen ja metadataa
vailla oleva 038-kanta läpäisivät oikean main-/W6-/backend-ketjun.
Ennen hallittua binaarikoordinaattorin kutsua koe vaatii kolme eristettyä
sisältötarkistusta, `businessRollbackCompleted`-tilan, restore-journalin
poistumisen, alkuperäisen DB:n ja rekisterin tavujen säilymisen sekä kaikkien
lasten exitit. Nykykannan PDF-katalogi on ei-tyhjä; 038-kontrollin PDF-joukko
on tyhjä. Molempien tapausten kahdeksan utility-prosessia poistuivat ja
mainin varaus palautui. Uutta käyttöliittymää tai migraatiota ei avattu.
Katselmuksen kaksi liian väljää ajoitus-/määräväitettä tiukennettiin ennen
lopullista kohdeajoa. Binaarikoordinaattori on yhä kontrolloitu, ei oikea MSI.

**FirstStartin native-kohdenäyttö:** nykyisen scheman synteettinen direct-Setup-
tilanne läpäisi sekä ehjän toisen tarkistuksen että nimenomaan toiseen
snapshotiin injektoidun schema-hylkäyksen. Aiempi startup-tarkistus ei riitä
version hyväksynnäksi. Ehjä toinen tarkistus edeltää uutta accepted-build-
tietoa; hylkäys säilyttää vanhan tiedon ja alkuperäisen DB:n, rekisterin sekä
ei-tyhjän PDF-katalogin. Turvallinen ensisyy säilyy todellisen utility-rajan
yli, lasten exitit havaitaan ja mainin varaus palautuu.
Onnistumiskontrolli pysähtyy hallitusti vasta hyväksynnän jälkeen ennen UI:ta;
se ei todista business-UI:n normaalia käyttöä. Tässä kontrollissa ei ole
odottavia migraatioita eikä pre-migration-palautuspistettä; W6:n haara on
`notRequired`. Katselmuksen jälkeen testiväitteet vaativat koko hyväksyntä-
metadatan ja kummankin snapshotin omaan operaatioon sekä sukupolveen sidotun
inspector-tuloksen ja exitin. Lopullinen kohdeajo ja rajattu uusintakatselmus
läpäisivät. Molemmat kokeet
käyttävät nykyistä kehitystoimitusadapteria, eivät hardened-pakettia.
K:n paketointi-, Linux-, resurssi-, palautus- ja PR/main-loppuportit säilyvät.

<a id="m1-source-preparation-l2272"></a>

### Journalin valinta- ja sisältötarkistuksen rajattu koe

Tämä osio säilyttää alkuperäisen viiden sisältöportin kokeen ja toteutuksen
historian. Voimassa oleva myöhempi rajaus on
[PDF-luvun ja cold-journalin tuotantokytkentä](release-0.3.0-profile-validation-history.md#m1-source-preparation-l1926).

**Omistajan hyväksymä suunnittelu, koe ja myöhempi rajattu toteutus 12.10.2026.**
Tavoite on erottaa kevyt omistajuuden ja täsmällisen journal-valinnan tarkistus
tuoreesta sisältötodisteesta nykyisen kirjoitusketjun sisällä. Alkuperäinen
koelupa ei hyväksynyt tuotantokytkentää; omistaja hyväksyi sen erikseen kokeen
jälkeen vain alla nimetyille kutsujille. Ei yleistä välimuistia, uutta valvojaa
tai aikarajamuutosta.

Ensimmäinen koe on rajattu `ProfileRestoreActivationJournalStore.write`-
metodin olemassa olevan edeltäjän siirtymään. Sisäiset omistajuus- ja
valintatarkistukset säilyvät. Erillinen sisältöportti vaaditaan ennen
next-slotin luontia, next-tavujen kirjoitusta, current -> backup -siirtoa,
next -> current -julkaisua ja edeltäjän poistamista. Odotettujen slottien ja
valtuuden tarkistus toistetaan odotetun sisältötyön jälkeen. Julkaistun nextin
tavut ja poistettavan backupin täsmällinen edeltäjä luetaan tarvittaessa
uudelleen; vanha sisältökuitti ei oikeuta muuttuneen journalin julkaisua.

Uuden journalin luonti ilman edeltäjää, palautuksen business-tiedostosiirrot,
terminal-siivous sekä `read`- ja `clear`-metodit säilyvät tässä kokeessa
ennallaan. `read` voi korjata ja poistaa journal-slotin, joten sitä ei saa
käsitellä yleisesti kevyenä lukuna. Sen nykyistä mutaatiosuojaa ei poisteta.

**Rajattu näyttö:** 17 synteettistä tapausta läpäisi. Koe käytti nykyistä
transaktiota oikeisiin forward-/rollback-tiedostosiirtoihin sekä journal-
Storen erillistä koekopiota. Todellisista synteettisistä tavuista lasketut
tiivisteet toimivat sisältökontrollina; SQLite-, native-varaus- tai main-
runtimeketjua ei tällä korvata tai väitetä todennetuksi. Tapaukset kattavat
muuttuneen samankokoisen sisällön, vanhentuneen valtuuden, vaihdetun journalin,
muuttuneen next-/backup-slotin, puuttuvan sisältöportin, onnistuvan siirto-
ja palautusketjun sekä business-siirtoa edeltävän DB-/PDF-hylkäyksen.
Julkaisun jälkeinen virhe säilyttää epävarman palautusaineiston ja ensisyyn.

Hyväksytty tuotantosovitus rajataan nykyisten cold-forward- ja rollback-
kirjoittajien nimenomaiseen valtuusvarianttiin, jossa molemmat portit ovat
pakolliset. Muiden kutsujien nykyinen yhdistetty tarkistus säilytetään;
pelkkään kevyeen callbackiin ei saa pudota oletuksena. Koekopion rajapinta
ei sellaisenaan ole kaikkien nykyisten kirjoittajien hyväksytty sopimus.

Katselmuksen kaksi slot-havaintoa toistettiin sekä lähtötoteutuksessa että
koekopiossa: muuttunut avattu next saattoi ylikirjoittua, ja uudelleen
ilmestynyt next jäi huomaamatta ennen backupin poistoa. Ne eivät syntyneet
erottelusta. Korjattu koekopio läpäisi 20 valittua tapausta; lähtötoteutuksen
kaksi tunnettua hylkäystä rajattiin tästä korjatun ehdokkaan ajosta pois eikä
niitä merkitty läpäisseiksi. Alkuperäinen hylkäysnäyttö säilyy.

Työpuun toteutus käyttää nimenomaista `separateContent`-valtuutta vain
sisältöä tarkistavissa cold-forward-/rollback-kirjoituksissa. Muut kutsujat
säilyttävät yhdistetyn tarkistuksen. Avatun nextin kahva/polku/tyhjyys sekä
nextin poissaolo ennen backupin poistoa tarkistetaan myös yhdistetyissä
edeltäjäkirjoituksissa. Tuotannon kohdetestit todentavat nämä rajat erikseen.
Rajattu riippumaton lähdekatselmus ei löytänyt estettä nykyisen yksinomaisen
operaatio-omistajan mallissa; tämä ei lupaa atomisuutta saman käyttäjätilin
haitallisille kirjoittajille eikä korvaa runtime-todennusta.

Tuotantokytkennän journal-/transaktioregressiot läpäisivät 309 testiä kolmesta
tiedostosta ilman ohituksia; mukana ovat slot-virheet sekä tavallisen ja
cold-kutsujan erilliset valtuusvariantit. Desktopin tyyppitarkistus ja käännös
läpäisivät. Nimetty palautussarja läpäisi 227 testiä neljästä tiedostosta
ilman aikarajamuutoksia. Tavallisen aktivoinnin, käynnistyspalautuksen ja
cold-valmistelun erillinen kutsujasarja läpäisi 123 testiä neljästä tiedostosta.
Kummassakaan sarjassa ei ollut ohituksia. Aiemmat hylkäykset säilyvät omalle
lähteelleen; muuttuneen lähteen läpäisy ei selitä kaikkia vanhoja aikakatkaisuja.
Nykyisen ja historiallisen 038-testikannan kuusi C-käynnistystapausta läpäisivät
myös varsinaisen main-/W6-kytkennän kokeessa. Tarkistusprosessien poistuminen,
varausten palautuminen ja alkuperäisketjun säilyminen varmennettiin. Kokeen
binaaripalautuksen koordinaattori oli hallittu korvike: näyttö ei kata oikeaa
asenninkutsua, erillistä cold-rollback-kuluttajaa tai hardened-pakettia.
Kohdenäyttö ei sulje alkuperäisiä aikakatkaisuja, suuren katalogin resurssirajoja
tai K:n packaged-/Linux-/PR-/main-portteja. Tavallisen live-palautuksen
todellinen runtime-näyttö säilyy erillisenä vaatimuksena.

**Native-toimituksen hyväksyntä:** [rajattu toimitussopimus](release-0.3.0-profile-validation-history.md#m1-source-preparation-l5431)
hyväksyttiin 10.10.2026. [V2s](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3189)
erottaa toteutetun kohdenäytön keskeneräisistä toimitus- ja palautusporteista.
Business-ajurin vaihtamista tai resurssirajojen kasvattamista ei hyväksytty.

**Nykyinen K3-käyttäjäpolkutodennus:** [V2ah](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3849)
omistaa eristetyn tarkistusajurin kytkennän jälkeisen näytön ja ensihylkäykset.
Sen korjatun sulkujärjestyksen kolme käyttäjäpolkua läpäisivät yhden
nimetyn Windows-Electron-ajon ilman uusintaa.
[V2r:n pysyvien regressioiden](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3147)
aiempi tuonti-/korvausläpäisy säilyy oman toteutusvaiheensa historiassa;
se ei hyväksy myöhemmin muuttunutta tarkistusketjua. PR/CI- ja packaged-portit
ovat edelleen avoinna.
[V2q](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3095)
todentaa same-lineage-korvauksen schema-hylkäyksen, native-vahvistuksen ja
varmuuskopion jälkeen lisättyjen tietojen säilymisen. [V2p](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3044)
todentaa vastaavan import-as-new-polun. Molemmat käyttävät oikeaa Electron-mainia,
native-salasanaikkunaa ja hallittua uudelleenkäynnistystä. Sama turvallinen
ensisyy säilyy yksityiskohtaisessa lokissa, Diagnostics/API-projektiossa ja
tarkistetussa gzip-tukipaketissa; incident-indeksi pysyy minimoituna.
[V2o](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3005)
tarkistaa backup-/restore-projektion tapahtumakohtaisesti myös API-clientissä
ja tukipaketissa. Nykyisten kuluttajien erilliset tiedostoketjut läpäisivät
muuttuneilla lukijoilla. [V2n:n ensisyy](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2910),
rollbackin lisävirhe ja selvitystä vaativa lopputila säilyvät erillisinä.
[V2m:n portable-ketju](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2864) ja
[V2l:n sisäinen syysidonta](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2835)
säilyvät pohjana. K3:n muiden kuluttajien todelliset runtime-polut, K2 sekä yllä
olevat päätös- ja hyväksyntäportit ovat avoinna.

**C:n hyväksyntää edeltävän kokonaisajon historia:** desktopin
testikomento läpäisi 9.10.2026 revisiolla `b6416bcc` yhteensä 2 595 Vitest-testiä ja 270 Node-sopimustestiä.
Kolme ennestään alustakohtaista testiä ohitettiin, eikä niitä lasketa
läpäisyiksi. Näyttö kattaa myös R04:n kirjoitussuojan ja R18-varauksen alemmat testikytkennät,
mutta tämä testikomento ei yksin todista todellisia
packaged-/installer-/PR-/main-portteja. Saman puhtaan revision hardened-
palautus ja kolme packaged-palautustapausta läpäisivät erikseen. Muiden kohdeajojen määriä ei summata
tähän yhteistarkistukseen, koska kattavuus on päällekkäinen. Myöhemmän
muutoksen kohdenäyttö ei päivitä tätä kokonaisajon hyväksyntää.

Hyväksyntä on sidottu yllä olevaan revisioon, ei automaattisesti myöhempään
työpuuhun. Dokumenttimuutoksen toteutuneet tarkistukset ja mahdollisen
integraation lopputulos kirjataan sen omaan hyväksyntächeckpointiin;
pelkän tuloksen ilmoittamiseksi ei tehdä uutta tilakirjauscommittia.
Jokainen uusi toteutuspala alkaa omalla preflightilla. Sivulla ei ylläpidetä Goal-työkalun
ajonaikaista tilaa.


<a id="m1-unit-preparation-2395-5765"></a>

> Historical source: `eky_software/docs/architecture/release-0.3.0-m1-preparation-plan.md:2395-5765` (original and provenance retained privately).
> Original source-unit checksums are retained privately. Historical pending states are not current authority.

<a id="m1-source-preparation-l2395"></a>

### K-paketin valmistelu ja hyväksyntärajat

**Valmistelun checkpoint 9.10.2026:** lähtö on yllä hyväksytty PR #299:n
main. Alkuperäisen keskeytetyn Security-skannauksen S030-01/S030-02-
havaintojen näyttö ja korjausehdotukset on luettu uudelleen. Scan ei ole
valmis koko repositorion tarkastus. Nykyisestä lähteestä tarkistettu
kutsuketju tukee alla olevia puutteita; K:n runtime-toistoa tai korjausta
ei vielä ole todennettu. Riippumaton rajattu lähdekatselmus vahvisti myös
candidate-migraation, julkaistun kohteen ja palautuskäynnistyksen
kattavuustarpeen. Alla oleva 9.10.2026 toteutussuunnitelma täsmentää nämä
rajat. Sen riippumaton rajattu suunnitelmakatselmus ei löytänyt estettä.
Omistaja hyväksyi K-P1/K-P2/K-P3-päätökset 9.10.2026; toteutuksen näyttö
on vielä avoin.
**V2a:n työpuu 9.10.2026:** yhteinen luotetuista migraatiotavuista muodostuva
schema-referenssi, rajattu teknisen scheman ja historiarivien luku sekä
täsmällinen objektivertailu on toteutettu. Snapshot-tarkistin käyttää niitä
ennen sisältökyselyitä. Alkuperäinen rajattu toisto hyväksyi ylimääräiset
table/view/trigger-objektit; korjauksen jälkeen ne hylätään. Rajattu sarja
kattaa myös muutetut guardit, constraintit/defaultit/indeksit, identity-view'n,
teknisen historiataulun korvaamisen näkymällä ja liian suuret arvot.
Aiemman julkaisun tekniseen DDL:ään sekä hyväksyttyyn 038-ketjuun sidotut
fixturet läpäisevät metadataa sisältävänä ja ilman metadataa; 038 -> 039
säilyttää profiili-identiteetin. Yhdistetty migraatio-/snapshot-regressio
läpäisi 226 testiä; kaksi ennestään alustakohtaista ohitusta eivät ole
läpäisyjä. Tämän jälkeen backendin koko testikomento läpäisi 2 904 testiä
259 tiedostossa; viisi ennestään alustakohtaista ohitusta eivät ole
läpäisyjä. Kohdesarjoja ei summata tähän päälle. Backendin tyyppitarkistus
ja tuotantobuild läpäisivät; uudet testit ja fixture eivät sisälly
tuotantobuildiin. Riippumaton rajattu koodikatselmus ei löytänyt konkreettista
ohitusreittiä tai regressiota tässä palassa. Tämä on työpuun kohdenäyttö,
ei paketoidun sovelluksen, PR:n tai mainin hyväksyntä. V2b/V2c/V3 sekä
K1/K2:n kokonaisuuden sulkeminen ovat avoinna. V2c:n pre-write-kytkentä ja
sitä todistavat vakoilutestit eivät sisälly tähän hyväksyttyyn kohdenäyttöön.

**V2b:n ensimmäinen checkpoint 9.10.2026:** stagingin tarkistus ja
activation-materialisointi on erotettu palveluun, jolle ei anneta aktiivista
tietokantayhteyttä. Nykyinen broker-adapteri säilyttää entisen lopputuloksen;
se poistetaan vasta utility-/broker-v10-siirron todennuksen jälkeen. Schema,
eheys, identity ja artifact-katalogi tarkistetaan samalla readonly-yhteydellä,
joka suljetaan myös hylkäyksessä. Kohde- ja backend-regressiot läpäisivät
(koko backend 2 915 testiä, viisi ennestään alustakohtaista ohitusta), samoin
tyyppitarkistus ja tuotantobuild. Riippumaton rajattu koodikatselmus ei
löytänyt tässä valmistelupalassa konkreettista ohitusreittiä tai regressiota.
Tämä ei vielä eristä kuormaa aktiivisesta backendistä.

**V2c:n käynnistys-/migraatiokytkentä 9.10.2026:**
`inspectMigrationStartupState` käyttää yhteistä schema-tarkistinta.
`runMigrations` tarkistaa rakenteen ennen ensimmäistä valmistelu-/migraatio-
kirjoitusta ja uudelleen ennen onnistunutta paluuta. Sen aiempi täsmällisen
legacy-prefixin baseline on erillinen sisäinen politiikka, ei palautuksen
038-poikkeuksen laajennus. Ensitoisto hyväksyi view-only-kannan tyhjänä,
ylimääräisen triggerin ja näkymäksi korvatun historiataulun; regressiot
hylkäävät ne nyt ennen kirjoituksia. Migraation kesken syntyvän virheen
testit käyttävät statement-vakoilua ylimääräisen scheman sijaan ja todistavat
business-SQL:n ehtineen suoritukseen ennen rollbackia. Loppuattestoinnin
virhe säilyttää jo valmistuneiden migraatioiden määrän.
Kohdesarja läpäisi 296 testiä, ja koko backendin testikomento 2 924 testiä
260 tiedostossa. Molempien viisi ennestään alustakohtaista ohitusta eivät
ole läpäisyjä; kohdemäärää ei summata kokonaisajoon. Tyyppitarkistus ja
tuotantobuild läpäisivät; vikainjektion fixture ei kuulu tuotantobuildiin.
Riippumaton rajattu lähdekatselmus ei löytänyt konkreettista ohitusreittiä tai
regressiota tässä palassa. Readonly-esitarkistus ennen kirjoitettavaa avausta,
kopiointi-/käyttösidonta, julkaistun kohteen tarkistusjärjestys ja K3:n
syyraportointi ovat avoinna. Erityisesti julkaistun kohteen nykyinen
identity-before-invalidHistory-järjestys on sovitettava schema-before-content-
vaatimukseen niin, ettei epäluotettu identity-luku tai väärän profiilin
palautus tule mahdolliseksi. Tässä checkpointissa sitä ei ole muutettu.
Paketoitu sovellus sekä PR-/main-portit eivät ole vielä hyväksyttyjä.

**V2c:n readonly-avausjatko 9.10.2026, hyväksymätön ehdokas:** backendin `createApp` käyttää
yhteistä `openAttestedMigrationDatabase`-porttia ennen palvelurekisteröintiä.
Se tarkistaa olemassa olevan kannan readonly-yhteydellä, sulkee sen ja
attestoi myös kirjoittavan yhteyden ennen luovutusta. Puuttuvan kannan
luonti on erillinen lupa; kadonnutta jo tarkistettua tiedostoa ei luoda
uudelleen. Sisäinen runner-baseline ja portillisen restore-käynnistyksen
038-raja säilyvät erillään. Ensitoisto osoitti avausten väärän järjestyksen;
korjauksen 203 kohdetestiä läpäisivät, samoin tyyppitarkistus.
Koko backendin testikomento läpäisi 2 941 testiä 262 tiedostossa; viisi
ennestään alustakohtaista ohitusta eivät ole läpäisyjä. Myöhemmin lisätty
oikean sovelluskoosteen legacy-baseline-regressio läpäisi erillisessä
seitsemän testin sarjassa; sitä ei lasketa aiemman kokonaisajon luvuksi.
Tuotantobuild läpäisi, eikä apurin testi sisälly buildiin. Riippumaton
katselmus löysi kaatumispalautusregression: hot rollback journal vaatii
SQLiten oman palautuksen ennen schema-lukua, mutta readonly-yhteys estää
sen `SQLITE_READONLY_ROLLBACK`-virheellä. Pieni erillinen synteettinen
keskeytyskoe vahvisti löydön. Uusi portti hylkäsi käynnistyksen tiedostoja
muuttamatta, kun aiempi kirjoittava avaus palautti commitoidut rivit ja
hylkäsi keskeneräisen transaktion oikein. Koe on regressiota vahvistava
näyttö, ei korjauksen läpäisy. Aiempi vihreä testisarja ei sulje löydöstä.
Ehdokasta ei hyväksytä eikä julkaista ennen ratkaisua.

**Kaatumispalautus hyväksytty 10.10.2026; toteutus ja kohdenäyttö [V2u:ssa](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3281).**
Rajattu poikkeus sallii vain todistetusti omistetun paikallisen työtilan SQLiten
natiivin kaatumispalautuksen ennen tiukkaa schema-porttia. Tuotu backup
ei saa poikkeusta; business-kyselyt ja migraatiot jäävät portin taakse.
Omistajuustodiste, sivuvaikutukset ja oikean keskeytyksen regressio
vaaditaan. Tämä tarkentaa aiempaa ennen kirjoittavaa avausta -sääntöä;
poikkeus perustuu erilliseen päätökseen, ei pelkkään K:n toteutuslupaan.
Candidate-kopiointi-/käyttösidonta, K2, K3 ja
paketoidun sovelluksen hyväksyntä eivät valmistu tästä kohdeajosta.

<a id="m1-source-preparation-l2496"></a>

#### V2e: erillisen tarkistuskopion koe

**Checkpoint 9.10.2026, ei hyväksytty tuotantokytkentä.** Candidate-kopioinnin
ehdokas tarkistaa lähteen ennen kohteen luontia, sitoo lähteen ja kopion
todelliseen SHA-256:een sekä kokoon ja lukee kohteen tavut takaisin.
Eksklusiivisen luonnin törmäys ei poista olemassa olevaa tiedostoa;
epävarma sulkeminen säilyttää osittaisen kopion. Schema ja artifact-katalogi
tarkistetaan samalla readonly-yhteydellä ennen kirjoittavaa avausta.
Rajattu regressiosarja läpäisi 314 testiä; viisi ennestään alustakohtaista
ohitusta eivät ole läpäisyjä. Tyyppitarkistus ja tuotantobuild läpäisivät.
Myöhempi WAL-kontrolli kuitenkin hylättiin: suljetun, ehjän WAL-tilasta
tehdyn snapshotin readonly-avaus loi sivutiedostot, jotka ehdokas tulkitsi
ristiriidaksi. Sama sarja läpäisi 29 muuta testiä ja ohitti yhden entisen
alustakohtaisen tapauksen. Ehdokas ei ole hyväksytty; aiempi vihreä näyttö
ei sulje tätä regressiota.

Omistaja hyväksyi rajatun jatkosuunnittelun ja synteettisen kokeen, jossa
SQLite avaa vain uuden kertakäyttöisen kopion operaation omassa kansiossa.
Alkuperäistä snapshotia tai tuntemattomia sivutiedostoja ei poisteta.
Testi `workspaceSnapshotIsolationExperiment.test.ts` todensi seitsemän
tapausta: onnistuneen tarkistuksen ja sulkemisen sekä säilytyksen, kun
sulkemistodiste puuttuu, kansion identiteetti vaihtuu, kansiossa on vieras
tiedosto tai rollback-journal, WAL ei ole tyhjä tai SHM on hardlinkitetty.
Koekansion poistaminen edellytti todettua sulkemista, samaa omistettua
kansiota ja täsmällisesti sallittua sisältöä. Alkuperäisen snapshotin koko
ja tiiviste säilyivät. Tämä on testin oman kansion näyttö, ei utilityn
prosessipoistumisen, C-varauksen tai ylemmän siivouksen hyväksyntä.
Koelogiikkaa ei ole kytketty tuotantopolkuun.

**Rajattu jatkosuunnitelma ennen kytkentää:**

1. Käytä nykyisen candidate-operaation validoidun `candidateRoot`-juuren
   omaa uutta tarkistusalikansiota, ei lähdesnapshotin kansiota eikä
   julkaisukelpoista runtime/data-kansiota. Sido kopio todellisiin lähde-
   ja kopiotavuihin nykyisillä rajatuilla luku-, tyyppi-, polku- ja
   linkkitarkistuksilla. Epäselvä lähde tai ennestään oleva sivutiedosto
   ei saa muuttua hiljaiseksi onnistumiseksi.
2. Kokoa readonly-schema-, identity-, eheys- ja katalogitarkistus samaan
   omistettuun koekopioon. Vältä alkuperäisen tai lopullisen ehdokkaan
   toista readonly-avausta, joka palauttaisi saman WAL-sivutiedostoriskin.
   Varmenna kohteen todelliset tavut ennen kirjoittavaa avausta ja säilytä
   nykyinen saman kirjoittavan yhteyden pre-/post-migration-attestointi.
3. Todista SQLite-yhteyden ja tiedostokahvojen sulkeminen, operaation
   omistajuus sekä virhepolulla myös nykyisen prosessiomistajan vaatima
   poistuminen. Poista vain todistetusti tämän operaation luoma koekansio.
   Epäselvä sisältö, sulkeminen tai omistajuus säilyttää aineiston ja estää
   jatkamisen. Sulkemis-/siivousvirhe ei peitä ensivirhettä.
4. Säilytys myös caller-tasolla import-, replacement- ja
   activation-migration-poluissa on kohdetodennettu
   [V2f-checkpointissa](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2558). Korvauksen
   `discardBeforeActivation` tarkistaa nyt lähdestagingin ja ehdokasjuuren
   ennen ensimmäistä poistoa. Epävarmaa koekansiota ei lisätä yleiseen
   rekursiiviseen poistolupaan. Koekopion omistajan prosessipoistuminen
   ja sen todellinen utility-kytkentä ovat edelleen todistettavia;
   caller-testit eivät korvaa C:n prosessivarausta.
5. Ennen kytkennän hyväksyntää tarvitaan WAL- ja tavallisen snapshotin
   todelliset kuluttajaregressiot, ennestään olevien ja kesken ilmestyvien
   sivutiedostojen säilytys, sisältömuutokset, keskeytys, sulkemisvirhe ja
   vanhan 038-backupin migraatio. Tämän jälkeen vaaditaan edelleen K:n
   packaged-/PR-/main-portit. Tämä koe ei anna native-käännös-,
   kaatumispalautus- tai publisher-päätöstä eikä aloita uutta kehystä.

<a id="m1-source-preparation-l2558"></a>

#### V2f: kutsujien aineiston säilytys

**Rajattu työpuukorjaus 9.10.2026:** lähdeaineiston säilytys ei saanut
riippua vasta myöhemmin tarkistettavasta ehdokaskansiosta. Kolme
regressiota osoitti, että korvauksen `discardBeforeActivation` poisti
lähdestagingin ennen kuin se hylkäsi ylimääräisen tarkistuskansion,
WAL-tiedoston tai hardlinkitetyn ehdokaskannan. Nyt molemmat puut
tarkistetaan ennen ensimmäistä poistoa. Poistokohteet, allowlist,
linkki-/polkutarkistukset ja turvallinen virhekoodi/vaihe säilyvät.
Lähteen hardlink-hylkäys säilyttää myös ehdokkaan. Uutena tuonnin
juurisiivous validoi ennestään koko osittaisen operaatiopuun ennen poistoa;
sen toteutusta ei muutettu.

Oikeiden koordinaattorien ja tiedostoadapterien synteettiset testit
todistavat lähteen, ehdokkaan ja epäselvän koekansion säilymisen.
Korvaus ei aktivoi eikä käynnistä vanhaa runtimea siivouksen hylkäyksen
jälkeen; tämä kattaa myös relaunch-handoffin. Activation migration
säilyttää palautuspisteen stagingin, vaatii recoveryn eikä valitse lähdettä
tai relaunchaa. Uutena tuonti säilyttää journalin ja rekisterin eikä julkaise
ehdokasta. Sen nykyinen, erillinen aiemman runtimen palautussääntö säilyy:
todennettu runtime-poissaolo sallii tunnetun aiemman työtilan käynnistyksen,
mutta puuttuva tai epäselvä omistajuustodiste estää sen edelleen.

Viiden kohdetiedoston 66 testiä läpäisivät. Laajempi import-, replacement-
ja update-palautusregressio läpäisi 338 testiä 28 tiedostossa; päällekkäisiä
kohdeajoja ei summata tähän. Desktopin tyyppitarkistus ja tuotantokäännös
läpäisivät. Juurisiivouksen riippumaton rajattu katselmus ei löytänyt
korjattavaa. Tämä ei tee monen kansion poistosta atomista: tarkistuksen
jälkeinen tiedostomuutos tai osittainen poistovirhe eivät saa tämän
checkpointin perusteella yleistä säilytystakuuta.

Koekopio on edelleen testilogiikkaa, ei hyväksytty tuotantokytkentä.
Tämän checkpointin jälkeen utilityn omistajuus-/sulkemis-/exit-ketjun
rajattu synteettinen koe on todennettu [V2g:ssä](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2597).
Tuotantokuluttajan todellinen kytkentä ja WAL-kuluttajaregressio,
K3:n ensisyy ja siivoustulos sekä packaged-/PR-/main-portit ovat avoinna.
Tämä korjaus ei ratkaise alla olevia kolmea omistajapäätöstä eikä muuta
varmuuskopioformaattia, riippuvuuksia tai C:n prosessiomistajuutta.

<a id="m1-source-preparation-l2597"></a>

#### V2g: tarkistuskopio todellisessa utility-prosessissa

**Rajattu synteettinen koe 9.10.2026, ei tuotantokytkentä.** Nykyinen
`ElectronWorkspaceCandidateRuntimeFactory`, `workspaceCandidateRunner`
ja mainin C-varausomistaja suorittivat viisi tapausta oikealla
`utilityProcess`-lapsella. Vain lapsen koeaineistoon kohdistuva backend-
operaatio korvattiin testilogiikalla. Main loi uuden koekansion todetun
varauksen ja nykyisen import-ylläpitolukon aikana, ennen luovutusta.
Poistoon käytettiin mainin omaa kansioidentiteettiä, ei lapsen antamaa
poistopolkua. SQLite avasi vain kopion; alkuperäisen snapshotin koko,
tiiviste ja sivutiedostottomuus säilyivät kaikissa tapauksissa.

- Normaali readonly-schema-/sisältötarkistus ja natiivi sulkeminen
  läpäisivät. Terminal-viesti ei vielä palauttanut varauksen omistajuutta.
  Main sai sen takaisin vasta todetun lapsen poistumisen jälkeen.
- Todellinen ylimääräisen schema-objektin hylkäys säilytti turvallisen
  ensimmäisen syyn erillisessä koehavainnossa. Omistettu koekopio voitiin
  poistaa vasta yhteyden sulkemisen, lapsen poistumisen ja varauksen
  palautuksen jälkeen; alkuperäinen virheellinen snapshot säilyi.
- Puuttuva sulkemiskuittaus säilytti koekopion, vaikka testin todellinen
  SQLite-yhteys oli suljettu. Tämä on kuittausepävarmuuden simulointi,
  ei toteutunut native-sulkuvirhe.
- Avoimen SQLite-yhteyden kanssa tarkoituksella kesken jätetty operaation
  Promise ei valmistunut pelkästä peruutuksesta. Nykyinen C-factory
  pakkopysäytti vain omistetun lapsen, todensi poistumisen ja palautti
  varauksen. Operaatio hylättiin ja koekopio säilyi. Pelkkä exit-koodi
  nolla ei tehnyt tästä onnistunutta tarkistusta.
- Vieras koekansion tiedosto esti poiston myös onnistuneen sulkemisen,
  poistumisen ja varauksen palautuksen jälkeen. Vieras sisältö sekä
  alkuperäinen snapshot säilyivät.

Kaikki viisi koetapausta läpäisivät korjatulla valmistelulla. Aiemmat
valmisteluhylkäykset säilytettiin: ne eivät olleet natiivin tarkistuksen
läpäisyjä tai tuotantovikoja. Koefixturen käynnistys ja polut sovitettiin
nykyisiin entrypoint-, parser- ja loader-ehtoihin; tuotantofactory,
runner, varaus, riippuvuudet ja niiden aikarajat pysyivät muuttumattomina.
Katselmuksessa löytynyt kokeen havaintokirjoituksen ensisyyn peitto
korjattiin. Kaksi suoraa natiivioperaation virhekoetta todensivat, että
kirjoitusvirhe säilyy erillisenä ja schema-hylkäys pysyy ensisyynä.
Korjauksen jälkeen kaikki viisi utility/C-tapausta läpäisivät uudelleen.
Rajattu riippumaton katselmus suljettiin ilman avoimia deltalöydöksiä.
Kirjoitusvirhekoe ei ole utility/C:n toimitusvirhepolun hyväksyntä;
kokeen ensisyyn säilytys ei vielä todista K3:n varsinaista diagnostiikan
tai käyttäjäpalautteen lukuketjua.

Tämä näyttö täydentää V2e:n kansiorajojen ja V2f:n caller-säilytyksen
testejä. Se ei vielä hyväksy varsinaista kopiointi-/migraatiokuluttajaa,
artifact-katalogin utility-kytkentää, raskaan syötteen muistibudjettia,
historiallista backupia, palautusta tai hardened packaged -ketjua.
Kolme alla olevaa päätöstä ja K:n PR-/main-portit pysyvät avoimina.

<a id="m1-source-preparation-l2648"></a>

#### V2h: WAL-kuluttajaregressio ja kytkentäpäätös

**Checkpoint 9.10.2026, vain regressiot ja suunnittelu.** Varsinaisen
`runWorkspaceCandidateOperation`-migraation kuusi synteettistä tapausta
ajettiin nykyistä ehdokasta vastaan. Kolme hylkäystä vahvisti korjaustarpeen:
ehjä nykyinen ja metadataa vailla oleva hyväksytty 038-WAL-backup eivät
migroidu, ja virheellisen scheman hylkäys jättää lähdekansioon tarkistuksen
luomat WAL-/SHM-tiedostot. Alkuperäisen tietokantatiedoston tavut säilyivät.
Kolme ennestään olevan WAL-, SHM- tai journal-tiedoston säilytystestiä
läpäisi ilman tarkistus- tai kirjoittavaa avausta. Muut 20 testiä rajattiin
pois tästä kohdeajosta; niitä ei merkitä läpäisyiksi. Backendin
tyyppitarkistus läpäisi. Tämä on ehdokkaan regressiota todentava näyttö,
ei korjauksen, tuotantokytkennän tai asennetun sovelluksen hyväksyntä.

Rajattu riippumaton lähdekatselmus ja sen tarkistus osoittivat
kytkentäkohdan nykyisessä `ElectronWorkspaceCandidateRuntimeFactory`ssa:
`migrateBackup` tarvitsee oman tarkistuskopion elinkaaren. Mainin nykyinen
C-varaus koskee asennusjuurta, ei tarkistuskansiota; sitä ei korvata uuden
kansion varauksella. Mainin luoma kansio ja sen paikallinen identiteetti
on valmisteltava nykyisen omistus-/valtuustarkistuksen aikana ennen
varauksen luovutusta. Lapsen ilmoittama polku ei anna poistolupaa.

Nykyinen epäonnistunut terminal-viesti ei todista tarkistusyhteyden
sulkemista tai kuljeta tarkkaa turvallista ensisyytä. Kytkentäsuunnitelmassa
nykyisen tiukan yksityisen viestisopimuksen tuottaja, parseri ja vastaanottaja
on sovitettava yhteen; metadata-ketjun tunniste ei korvaa kopiotavujen
koko-/tiivistesidontaa. Siivous vaatii todetun sulkemisen, lapsen poistumisen,
prepare-/grant-kutsujen valmistumisen ja C-varauksen palautuksen. Virheen
turvallinen siivous ja migraation onnistuminen ovat eri tuloksia;
nykyistä onnistumisen ehtoa ei löysennetä. Caller-allowlistat ja epäselvän
aineiston säilytys pysyvät ennallaan. Ensisyy säilytetään erillään
siivous-/recovery-virheestä nykyisessä K3-ketjussa, ei uudella loggerilla.

**Kytkentäpäätös 9.10.2026:** omistaja hyväksyi rajatun tuotantokytkennän
V2e/V2g/V2h:n omistajuus-, tavusidonta- ja siivousrajoilla. Main valmistaa
operaation oman kansion ennen nykyisen C-varauksen luovutusta; backend
tarkistaa siinä samat kopiotavut ennen migraatiota. Tuettujen aiempien
backupien, mukaan lukien hyväksytty metadataa vailla oleva 038-ankkuri,
yhteensopivuus säilyy hyväksyntäehtona. Formaattia, riippuvuuksia,
aikarajoja tai caller-allowlistoja ei tämän päätöksen perusteella muuteta.
Kytkentä ja sen todennus ovat kesken, eikä ehdokasta ole hyväksytty.
Alla olevat kolme aiempaa päätöstä, K2/K3 sekä packaged-/PR-/main-portit
ovat edelleen avoinna; tämä hyväksyntä ei ratkaise niitä.

<a id="m1-source-preparation-l2692"></a>

#### V2i: tarkistuskopion tuotantokuluttaja

**Työpuun kytkentä 9.10.2026, ei julkaisuhyväksyntä.**
`ElectronWorkspaceCandidateRuntimeFactory` sitoo migraatioon oman
generaatioon sidotun tarkistusjuuren. Nykyisen main-varauksen `prepare`
suorittaa kansion eksklusiivisen valmistelun omistus-/valtuusrajan sisällä,
tarkistaa omistajuuden uudelleen ja vasta sitten luovuttaa nykyisen C-varauksen.
Varaus koskee edelleen asennusjuurta. Uutta prosessiomistajaa ei lisätä.

Backend kopioi ensin suljetun lähteen itsenäiset tavut tarkistuskansioon.
Schema/history, identiteetti, eheys ja artifact-katalogi luetaan samasta
readonly-yhteydestä. Vasta sen sulkemisen jälkeen lähteen uusi kopiointi
voi luoda migraatiokohteen; koko ja SHA-256 vaativat juuri tarkistettujen
tavujen vastaavuuden. Alkuperäistä eikä lopullista migraatiokohdetta avata
tässä välissä readonly-tarkistukseen. Kirjoittavan yhteyden pre-/post-migraation
schema- ja identiteettitarkistukset säilyvät.

Nykyinen yksityinen terminal-kanava välittää vain todetun tarkistusyhteyden
sulkemiskuittauksen ja suljetun turvallisen ensisyyluokan. Main hyväksyy
siivouksen vasta sidotun terminalin, todellisen lapsen poistumisen,
prepare-/grant-kutsujen valmistumisen sekä varauksen palautuksen jälkeen.
Kansion ja sen vanhemman identiteetit tulevat mainin omasta receiptistä,
eivät lapsen ilmoittamasta polusta. Journal, vieras sisältö, hardlink,
korvattu juuri, ei-tyhjä WAL tai epävarma kuittaus säilyttää aineiston.
Kopiointivirhe ei poista edes suljettua osakopiota lapsiprosessissa.
Main tarkistaa sisältöjoukon ja tiedostoidentiteetit uudelleen ennen
nimettyjen tiedostojen poistoa. Siivouksen keskeytyminen estää seuraavat
poistokutsut; jo aloitettu tiedosto-operaatio voi silti valmistua.
Poisto ei käytä rekursiivista vieraan sisällön siivousta; caller-allowlistat
ja operaation onnistumisen ehdot eivät muutu. K3:n koko ylempi palautusketju
on edelleen erikseen todennettava.

Ensimmäiset hylkäykset säilyvät: uuden sisäisen parametrin fixture-kutsut,
vanhan avaustavan varaan jäänyt mutaatiokoe ja parserin tyyppirajaus.
Kokeen havainnointikohta siirrettiin uuteen readonly-kopioon, eikä saman
kokoisten lähdemuutosten torjuntavaatimusta muutettu. Rajattu riippumaton
katselmus havaitsi osakopion ennenaikaisen poiston, aikarajan jälkeen
jatkuvat poistokutsut sekä sulkemisvirheen voivan peittää tuntemattoman
ensisyyn. Nämä korjattiin regressioineen; jälkikatselmuksessa ei jäänyt
näihin korjauksiin avointa löydöstä. AggregateErrorin ensimmäinen syyhaara
luokitellaan itsenäisesti: tuntematon syy pysyy `unknown`-arvona eikä muutu
sulkemisen syyksi.

Lopullisen työpuun backendin 52 koetta ja viiden desktop-sopimustiedoston
116 koetta läpäisivät. Backendin yksi alustakohtainen koe jäi ajamatta.
Työtilojen tuonnin, korvauksen, aktivoinnin ja muiden nykyisten callerien
regressiokokonaisuus läpäisi 1 133 koetta; kaksi alustakohtaista koetta jäi
ajamatta. Nämä määrät ovat osin päällekkäisiä, eikä niitä summata.
Backendin ja desktopin tyypintarkistukset sekä build läpäisivät.
Todellinen main/factory/runner/backend-utilityketju todennettiin uudelleen
viimeisten korjausten jälkeen: nykyinen WAL-backup, metadataa vailla oleva
038-WAL-backup ja virheellisen scheman hylkäys läpäisivät. Alkuperäinen
tiedosto ja lähdekansion sisältö säilyivät; sulkeminen, poistuminen,
C-palautus ja kansion poisto todennettiin. Kertakokeen ensimmäinen
käynnistinkutsu pysähtyi ennen koetta väärään työhakemistoon; tulos säilyi
epäonnistumisena ja korjattu käynnistin pääsi samaan varsinaiseen kokeeseen.
Kohdenäyttö ja staattinen katselmus eivät korvaa K2-, packaged-, PR- tai
main-portteja.

<a id="m1-source-preparation-l2751"></a>

#### V2j: ylemmän virheketjun ensisyyn säilyminen

**Rajattu työpuun toteutuspala, kohdetodennettu 9.10.2026.** K3:n lähdejäljitys osoitti,
että candidate-prosessin jo toimittama turvallinen syy katoaa import- ja
replacement-virheen muunnoksessa. Palautuksen lisävirhe tai ylläpitovarauksen
vapautuksen virhe voi lisäksi korvata alkuperäisen poikkeuksen. Korjaus
käyttää näiden nykyisten virhetyyppien sisäistä `Error.cause`-sidontaa ja
`AggregateError`-haaroja: ensivirhe on ensimmäinen, palautuksen ja vapautuksen
virheet erillisiä myöhempiä haaroja. Nykyinen ulompi koodi/vaihe sekä
palautus-, omistajuus- ja siivousjärjestys säilyvät. Raakaa ketjua ei
serialisoida rendererille, lokiin tai tukipakettiin.

Kohderegressiot vaativat alkuperäisen syyn säilymisen tavallisessa
hylkäyksessä sekä palautuksen ja vapautuksen yhteisvirheessä. Tuntematonta
ensisyytä ei korvata lisävirheen luokituksella. Yleinen management-virhe
säilyttää sisäisen ketjun mutta palauttaa edelleen vain nykyisen turvallisen
käyttäjäkoodin. Uutta virhekehystä, loggeria tai riippuvuutta ei lisätä.

Ensimmäinen regressioajo toisti kaikki 11 uutta syyn säilytyspuutetta.
Ensimmäisen korjauksen jälkeen yksi testi osoitti vielä restart-virheen
muunnoksen katkoksen; se korjattiin muuttamatta palautuksen ehtoja.
Tyypintarkistuksen uusi testiparametri täsmennettiin ilman runtime-muutosta.
Lopulliset 77 kohdetestiä läpäisivät, mukaan lukien oikean capability-handlerin
IPC-vuotosuoja. Työtilojen 1 145 regressiota läpäisivät; kaksi ennestään
alustakohtaista ohitusta eivät ole läpäisyjä. Määrät ovat päällekkäisiä,
eikä niitä summata. Desktopin tyypintarkistus ja tuotantobuild läpäisivät.
Rajattu riippumaton staattinen katselmus ei löytänyt uutta konkreettista
vikaa tai tietovuotoa; se ei korvaa runtime- tai packaged-todennusta.

V2j-checkpointissa `WorkspaceManagementService`-havaitsin oli compositionissa
kytkemättä. Sen myöhempi tuotantokytkentä ja rajattu lokitiedoston lukuketju
kuvataan seuraavassa V2k:ssa, ei tämän aiemman kohdeajon hyväksyntänä.
K3:n muiden kuluttajien näyttö, kolme muuta K-päätöstä, packaged-portti sekä
PR/main-portit säilyvät avoimina.

<a id="m1-source-preparation-l2786"></a>

#### V2k: workspace-varmuuskopion turvallinen lukuketju

**Rajattu työpuun toteutuspala, kohdetodennettu 10.10.2026.** Tuonnin ja
same-lineage-korvauksen hallintapalvelu luokittelee sisäisen ensivirhehaaran
rajatusti ja toimittaa vain tunnetun teknisen syyn tai `unknown`-arvon
nykyiseen observeriin. Ordered aggregate erottaa aikaisimman lisävirheen;
se ei saa korvata tuntematonta ensisyytä tai aikaisempaa tuntematonta
siivoussyytä myöhemmällä tunnetulla syyllä. Rikkoutunut ketju ei luo
olemattomasta siivousvirheestä havaintoa. Nykyinen turvallinen ulompi
käyttäjäkoodi, IPC-sanitointi, palautusjärjestys ja siivousvastuu säilyvät.

Main ja workspace-composition välittävät nykyisen operational-loggerin ja
runtime-identiteetin havaitsijalle. Se kirjoittaa
`workspaceBackup.operationFailed`- ja tarvittaessa erillisen
`workspaceBackup.cleanupFailed`-tapahtuman samalla korrelaatiolla.
Operational-validator, backendin projektori, API-client ja mainin
tukipakettilukija vaativat suljetun syyn, `import|replace`-vaiheen ja
tapahtumakohtaiset kentät. Raakaa poikkeusta, kutsupinoa, polkua tai
tietokantasisältöä ei kirjoiteta. Tapahtumien tekninen vaihe ei todista
sisäistä juurisyytä tai onnistunutta rollbackia. Error-tason incident-
projektio säilyttää nykyisen minimoidun virhekoodiyhteenvedon ilman
correlation-/runtime-/business-tunnisteita. Ei uutta loggeria, manageria,
riippuvuutta, formaattia, retentionia tai odotusmekanismia.

Rajatut desktop-regressiot läpäisivät 148 testiä, Diagnosticsin projektori-
ja tiedostolukijat 69 testiä ja API-client 25 testiä. Lukijoiden positiiviset
regressiot kattavat kaikki 15 sallittua syytä; vapaat syyt, vaiheet,
ristiriitaiset tilat ja muiden tapahtumien kentät hylätään. Ensimmäisen
kokeen löydös korjattiin erottamalla puuttuva cleanup-havainto tuntemattoman
cleanup-syyn havainnosta. Ensivirhettä ei merkitä myöhemmin läpäistyksi.
Riippumaton rajattu staattinen katselmus ei löytänyt uutta konkreettista
vikaa tämän lukuketjun lopullisesta tuotantototeutuksesta.

Erillinen synteettinen koe käytti oikeaa hallintapalvelua, nykyisiä JSONL-
ja incident-kirjoittajia, tiedostolukijoita, strict-clientiä sekä sanitoidun
gzip-tukipaketin virallista eheystarkastajaa. 34 virhetoimintoa tuottivat
38 turvallista tapahtumaa; ensisyy ja neljä lisävirhettä pysyivät erillisinä.
Kaksi onnistuvaa porttikontrollia säilyivät ennallaan. Virheellinen
lähdetapahtuma ohitettiin ja tukipaketin lukukattavuus merkittiin osittaiseksi.

Tämä koe ei ajanut oikeaa tarkistusprosessia, Electron mainia tai
käyttöliittymää eikä korvaa hardened-paketin hyväksyntää. K3:n muut
backup-/restore-kuluttajat ja koko K:n integraationäyttö ovat edelleen
avoinna. Tarkat tapahtumat ja tukitoimet on päivitetty
[katalogiin](r0-observability-event-catalog.md#desktop-operational-ja-security),
[Diagnostics-ohjeeseen](../modules/diagnostics.md),
[tukipakettisopimukseen](support-bundle-plan.md) ja
[palautus-runbookiin](local-restore-recovery-runbook.md#tarkistushylkäys-ja-lisävirhe).

<a id="m1-source-preparation-l2835"></a>

#### V2l: backup- ja palautuskuluttajien sisäinen ensisyy

**Rajattu työpuun toteutuspala, kohdetodennettu 10.10.2026.** Tavallisen
varmuuskopion luonti ja tarkistus, autentikoidun sisällön staging sekä
palautuksen ja päivityspalautuspisteen aktivointikutsujat säilyttävät
alkuperäisen poikkeuksen nykyisen virhetyypin sisäisessä `Error.cause`-
sidonnassa. Aktivoinnin ja rollbackin yhteisvirheessä ordered aggregate
pitää ensivirheen ensin ja rollbackin lisävirheen toisena. Ulompi virhekoodi,
väärän salasanan yhteinen palaute, tilatieto, palautusjärjestys ja
tiedostojen siivousvastuu eivät muutu.

Ensitoisto osoitti syytiedon katoamisen 11 regressiossa; 38 kontrollia
läpäisi. Korjauksen lopullinen kahdeksan tiedoston kohdesarja läpäisi
68 testiä. Se kattaa viisi K:n teknistä tarkistussyytä ja tuntemattoman
poikkeuksen, kaksi sisäistä muunnosta, aktivointia edeltävän hylkäyksen,
rollback-lisävirheen sekä IPC:n ja observerien vuotosuojan. Ulompi IPC-virhe
ei sisällä syyoliota. Tyypintarkistus ja desktopin käännös läpäisivät.
Rajattu riippumaton staattinen katselmus ei löytänyt uutta konkreettista
vikaa tästä sisäisestä syysidonnasta.

Tämä on sisäisen syyn säilytys, ei muiden backup-/restore-tapahtumien
täydellisen Diagnostics-ketjun hyväksyntä. Raakaa syyoliota ei projisoida
lokiin, käyttöliittymään tai tukipakettiin. K2:n eristetty tarkistusportti,
todellinen exit-/varaus-/siivoustodiste, muut K3-kuluttajat sekä hardened-
backup -> inspect -> restore -> restart -> compare ja PR/main-portit
ovat edelleen avoinna. [V2k:n](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2786)
workspace-lukuketjun näyttö säilyy erillisenä; sitä ei yleistetä näihin
kuluttajiin. Alla olevia päätösportteja ei tämän työn perusteella ohiteta.

<a id="m1-source-preparation-l2864"></a>

#### V2m: portable-backupin turvallinen lukuketju

**Rajattu työpuun toteutuspala, kohdetodennettu 10.10.2026.** Mainin
`profileBackupCapability` kirjaa `backup.failed`- ja
`backup.inspectionFailed`-tapahtumaan K-P3:n viidestä hyväksytystä teknisestä
syystä vain ensivirheen haarasta löytyvän tarkan koodin. Tuntematon,
syklinen, liian syvä tai poikkeuksen heittävä syyketju säilyttää nykyisen
yleiskoodin. Ordered aggregaten siivoushaaraa tai raakaa viestiä ei nosteta
ensisyyksi. IPC:hen palautetaan edelleen uusi yleinen virhe ilman sisäistä
`cause`-oliota; käyttäjän ilmoitus, tilat, ylläpitovaraus ja siivous eivät muutu.

Nykyinen rajattu ensisyyhaku on yksi runtime-apu, jota työtilatoiminnot ja
portable-backupin kaksi kuluttajaa käyttävät omilla suljetuilla syyjoukoillaan.
K:n viisi koodia on keskitetty desktopin omistajaan; työtilaprotokollan
hyväksytty syyjoukko ja versio eivät muutu. Uutta loggeria, tapahtumaformaattia,
kirjoittajaa tai prosessienhallintaa ei lisätä.

Ensitoisto hylkäsi kymmenen puuttuvan teknisen syyn regressiota; 30 kontrollia
läpäisi. Korjauksen seitsemän tiedoston kohdesarja läpäisi 123 testiä ja
erillinen neljän olemassa olevan työtilakuluttajan sarja 64 testiä.
Tyypintarkistus ja desktopin käännös läpäisivät. Riippumaton rajattu
staattinen katselmus ei löytänyt konkreettista uutta vikaa tästä muutoksesta.

Synteettinen koe käytti oikeaa capability-toteutusta injektoiduilla
backup-porteilla sekä nykyistä operational- ja incident-kirjoittajaa,
tiedostolukijoita, API-parseria, tukipaketin validointia, gzip-muodostusta
ja virallista tarkastinta. 14 hylättyä operaatiota, kaksi onnistumista ja
kaksi peruutusta tuottivat 24 turvallista eventtiä. Tukipakettiin päätyi
14 warn/error-eventtiä ja incident-yhteenvetoon seitsemän error-tapahtumaa.
Info- ja warn-poissulut incidentistä säilyvät tarkoituksellisina.
Polku, salasana, raakaviesti, pino tai sisäinen syyolio ei päätynyt ketjuun.

Kokeen ensimmäinen loppuväite oletti yleiselle backup-tukipakettilukijalle
tapahtumakohtaisen vaiheallowlistan. Nykyinen lukija tarkistaa vaiheelle
tunnistemuodon, kun taas backendin projektori tarkistaa backup-vaiheen
`portable`-arvoon. Korjattu koeväite todentaa nykyisen sopimuksen eikä
muuta tuotantovalidointia tai väitä tätä eroa korjatuksi. Yleisten
backup-lukijoiden tapahtumakohtainen uudelleenvalidointi kuuluu jäljellä
olevaan K3-sopimuskatselmukseen.

Koe ei suorita todellista Electron-mainia, renderer-IPC:tä, eristettyä
tarkistusprosessia tai paketoitua palautusta. Restore-/recovery-kuluttajien
erillinen kohdenäyttö on [V2n:ssä](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2910);
sitä ei päätellä tästä kokeesta. Native-toimituksen päätös, K2:n omistajuus
ja koko V3:n packaged-/PR-/main-portit pysyvät avoimina. Tämä ei sulje K:ta.

<a id="m1-source-preparation-l2910"></a>

#### V2n: palautuskuluttajien turvallinen ensisyy

**Rajattu työpuun toteutuspala, kohdetodennettu 10.10.2026.** Palautuksen tarkistus, staging,
aktivointi ja käynnistysvalidointi sekä palautuspisteen luonti ja
automaattinen tarkistus käyttävät V2m:n bounded ensisyyhakua vain
operational-tapahtuman K-P3-koodin valintaan. Nykyinen ulompi virhe,
saatavuustilan tulkinta, rollback, journal, varaus ja siivous säilyvät.
`restore.recoveryRequired` ja rollbackin lisävirhe pysyvät erillisinä;
siivoushaaraa ei nosteta ensisyyksi.

Ensitoisto hylkäsi 41 syytiedon katoamisen regressiota; 61 kontrollia läpäisi.
Lopullinen seitsemän tiedoston kohdesarja läpäisi 120 testiä. Se sisältää
myös tunnetun tarkistusvirheen ja todellisen rollback-lisävirheen yhteistestin:
ensivirheen koodi ja järjestetty sisäinen ketju säilyvät, mutta
`restore.rollbackFailed` ja `restore.recoveryRequired` käyttävät edelleen
omaa selvityskoodiaan. Tyypintarkistus ja desktopin käännös läpäisivät.
Rajattu riippumaton staattinen katselmus ei löytänyt konkreettista uutta
tuotantovikaa tästä viiden kuluttajatiedoston muutoksesta.

Synteettinen koe suoritti nykyiset palvelut injektoiduilla porteilla sekä
oikean operational- ja incident-kirjoituksen, tiedostolukijat, API-parserin,
tukipaketin validoinnin, gzip-muodostuksen ja virallisen tarkastimen.
Viiden suljetun syyn kahdeksan käyttötapaa tuottivat 40 epäonnistunutta
operaatiota ja 75 turvallista eventtiä. Tukipaketin 55 warn/error-eventtiä
ja incident-indeksin 25 error-tapahtumaa säilyivät tarkoitettujen
poissulkujen mukaisina. Raakaa viestiä, pinoa tai sisäistä syyoliota ei
kirjoitettu. Backend hylkäsi lisäksi väärän vaihe-arvon lukuaineistosta.

Kokeen ensimmäinen tukipakettiväite hylättiin, koska synteettisestä
aineistosta puuttui pakollinen runtime-yhteenveto. Korjattiin vain
koeaineisto; lukijan vaatimuksia ei muutettu. Ensimmäinen hylkäys säilyy
erillisenä, eikä sitä nimetä sovelluksen palautusviaksi.

Koe ei suorita todellista Electron-mainia, renderer-IPC:tä, native-
tarkistusta tai palautuksen prosessiomistajuutta. Native-toimitus,
paketoitu palautus ja PR/main-portit ovat avoinna. Yleisten API-/
tukipakettilukijoiden tapahtumakohtainen uudelleenvalidointi ei sisälly
V2n:n näyttöön, vaan sen erillinen todennus on
[V2o:ssa](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3005).
Backendin vaiheallowlistan hylkäys ei yksin todista tätä muissa lukijoissa.
Tämä kohdetulos ei sulje K:ta.

<a id="m1-source-preparation-l2952"></a>

##### Hyväksynnän loppuvaiheen syytieto

**Omistajan hyväksymä rajattu korjaus on toteutettu ja kohdetodennettu
12.10.2026; koko K ei ole valmis.** Alkuperäinen palvelu- ja lukuketjukoe
osoitti hyväksynnän ensisyyn katoamisen operational-tapahtumista, vaikka
se säilyi sisäisessä virheketjussa. Havainto koski sisältövalidoinnin
jälkeistä työtä, eikä tehnyt onnistunutta validointia virheelliseksi.

Nykyinen `ProfileRestoreStartupRecovery.finishAcceptance` kirjaa yhden
`restore.acceptanceFailed`-tapahtuman ennen virheen välittämistä. Sama raja
kattaa välittömän ja lykätyn hyväksynnän, aiemmin hyväksytyn journalin
siivouksen sekä valtuuden vapautusvirheen. Korrelaatio otetaan valitusta
journalista ennen mahdollista onnistunutta poistoa. Vaiheet ovat
`acceptancePreparation`, `acceptanceCommit` ja `acceptedCleanup`.
Vaihe kertoo viimeisen aloitetun työn, ei juurisyytä tai varmaa lopputilaa.
Pakolliset nykyiset failure-kentät ja kuusi sallittua syykoodia on lukittu
[tapahtumakatalogiin](r0-observability-event-catalog.md#desktop-operational-ja-security).
Tuntematon ensisyy säilyttää yleiskoodin; siivouksen lisävirhe ei korvaa sitä.

Epävarman hyväksynnän composition-käärintä säilyttää alkuperäisen sisäisen
syyn. `restore.validationCompleted` pysyy totena ja `restore.recoveryRequired`
erillisenä selvitystilana. Hallittu rollback/relaunch voi edelleen palauttaa
ilman `desktop.bootstrapFailed`-tapahtumaa; uusi virhetapahtuma syntyy ennen
tätä haaraa. Ohjaus, rollback, journal-portit, tiedostot, aikarajat ja
poistumiskäyttäytyminen eivät muutu.

Desktopin writer, Diagnostics-projektori, API-client ja tukipaketin lukija
validoivat saman rajatun tapahtuma- ja vaihesopimuksen. Desktop käyttää
yhteistä nykyistä katalogiaan; muut vastuurajat säilyttävät omat
wire-sopimustarkistuksensa. Error-tason minimoitu incident-yhteenveto ei
sisällä vaihetta, kestoa tai korrelaatiota. Activity ja business audit ovat
edelleen poissuljettuja. Ei uutta loggeria, lokikanavaa, kuittausodotusta,
payload-kenttää, riippuvuutta tai raakavirheen julkaisua.

Kohderegressiot läpäisivät: kolme vaihetta, K-P3:n viisi ensisyytä,
tuntematon syy, ensivirhe/lisävirhe-erottelu, observerin virhe, jatkettu
accepted-siivoaminen, valtuuden vapautusvirhe ja onnistumiskontrollit.
Todellisen composition-funktion testit kattavat hallitun relaunchin,
epävarman hyväksynnän ja loppusiivouksen hylkäyksen molemmilla
profiilityypeillä; koko nykyinen käynnistys-/palautustestitiedosto läpäisi.
Erillinen tiedostokoe todensi tapahtuman oikeasta JSONL-kirjoittimesta
Diagnostics/API-lukijoihin, incident-indeksiin ja gzip-tukipaketin
viralliseen tarkistimeen. Virheellisen vaiheen torjunta, salaisuuksien
poissulku ja onnistuneen polun säilyminen todennettiin. Rajattu riippumaton
lähdekatselmus ei löytänyt hyväksynnän estävää puutetta; tyypintarkistukset
ja muuttuneiden pakettien käännökset läpäisivät.

Composition-testien hallitut prosessi- ja UI-rajat sekä palvelukokeen
injektoidut portit eivät todista native-omistajuutta tai hardened-palautusta.
Tämä korjaus ei hyväksy uutta pitkää palautusajoa, tarkistusten kevennystä,
paketointirajaa tai K:n PR/main-integraatiota. Suuren katalogin loppuportti
ja muut K:n avoimet päätökset säilyvät erillisinä.

<a id="m1-source-preparation-l3005"></a>

#### V2o: palautustapahtumien lukijoiden sopimustarkistus

**Rajattu K3-lukuketju kohdetodennettu 10.10.2026; K ei ole valmis.**
API-clientin ja tukipaketin tunnistemuotoinen vaihevalidointi on tarkennettu tapahtumakohtaiseksi
nykyisen operational-katalogin mukaan. Desktopin omistavat tapahtumaspecit,
pakolliset payload-kentät ja vaihejoukko käytetään uudelleen samassa
desktop-moduulissa. HTTP-clientin oma vastevalidointi pysyy riippumattomana
backendin ja desktopin sisäisistä tyypeistä. Ei uutta pakettia, loggeria,
protokollaversiota, metadataa tai tapahtumaa.

Sallitun vanhan projektion valinnaiset app/build/runtime-kentät sekä
duration-, retryable- ja side-effect-tiedon tarkoituksellinen puuttuminen
säilyvät. Aktivointivirheen ja `recoveryRequired`-tapahtuman jo pakolliset
kentät eivät muutu valinnaisiksi. Väärä perhe, vaihe, kind tai epäyhtenäinen
palautumistila ja toisen perheen metadata torjutaan. Turvallinen
virhetapahtuman sormenjälki säilyy sallittuna nykyisen katalogin mukaan.
Backendin lähdeprojektio hylkää näiden tapahtumien väärät payload-kentät
sekä puuttuvan tai nykyisen HTTP-rajan ylittävän virhekoodin.

Ensitoiston 29 regressiota vahvistivat väärän vaiheen hyväksymisen.
Lopullinen kohdesarja läpäisi 236 testiä 22 tiedostossa:
API-client 54, desktopin observability/tukipaketti 75 ja backendin
Diagnostics 107. Aiemmat suppeammat ajot ovat päällekkäistä näyttöä,
eivät lisätestejä. Muuttuneiden osien tyypintarkistus ja käännös läpäisivät.
Rajattu riippumaton katselmus ei löytänyt uutta tuotantovikaa; sen
nostamat valinnaisen app/build/runtime-kontekstin ja puuttuvan
`recoveryPoint.failed`-kindin kontrollit lisättiin pysyviin regressioihin.

Oikea tapahtumakirjoittaja, operational-/incident-tiedostot, backendin
projektori ja lukijat, API-client, tukipaketin gzip sekä virallinen tarkastin
läpäisivät 20 tapahtumanimen ja kaikkien 29 vaihesopimuksen kokeen.
58 kelvollista tapahtumaa ja 174 hylkäysvarianttia todennettiin; tukipaketin
38 warn/error-tapahtumaa noudattivat nykyisiä poissulkuja. Virheelliset
rivit eivät syrjäyttäneet kelvollisia; tukipaketin lähteen osittaisuus näkyi.
V2k/V2m/V2n:n erilliset nykyisten kuluttajien synteettiset tiedostoketjut
läpäisivät muuttuneilla lukijoilla. Tämä ei ole todellisen Electron-mainin
tai palautusprosessin hyväksyntä. Native-päätökset, prosessiomistajuus,
todellinen main/IPC, packaged ja PR/main pysyvät erillisinä portteina.

<a id="m1-source-preparation-l3044"></a>

#### V2p: tuonnin todellinen main/IPC-lukuketju

**Import-as-new-polun schema-hylkäys kohdetodennettu 10.10.2026; K ei ole valmis.**
Koe käyttää olemassa olevaa eristettyä Electron-testipohjaa ja tuotannon
compositionia. Synteettinen kelvollinen varmuuskopio läpäisee tarkistuksen;
sen omassa kertakopiossa lisätty hyväksymätön schema-objekti hylätään.
Muokatun, uudelleen salatun säiliön todennus ja checksumit läpäisevät,
joten schema-hylkäystä ei korvata container-virheellä.

Oikea yritysvalitsin, native-tiedostovalinta ja mainin salasanaikkuna
käynnistävät tuonnin. Candidate-utilityn `PROFILE_SCHEMA_UNSUPPORTED`
säilyy mainin operational-tiedostossa sekä backendin HTTP-projektiossa,
API-clientin strict parserissa ja gzip-tukipaketissa. Virallinen tukipaketin
tarkastin ja osioiden checksumit läpäisevät. Yksityiskohtainen tapahtuma
ja incident-indeksi luetaan erillisinä projektioina: yksi tapahtuma
kummassakin, sama turvallinen syy, mutta incidentissä ei korrelaatio-,
runtime- tai business-tunnisteita. Ensisyy ja sivuvaikutusten `unknown`
säilyvät; vaihe tai onnistunut uudelleenkäynnistys eivät väitä kaikkia
sivuvaikutuksia olemattomiksi.

Hylkäys käynnistää nykyisen hallitun paluun edelliseen yritykseen.
Vanha ikkuna sulkeutuu, runtime/session vaihtuu ja aiempi yritys sekä
backend avautuvat terveinä. Alkuperäinen lähdetietokanta, valittu säiliö,
yritysrekisterin tavut ja asiakaslista säilyvät. Kokeen tietosuojatarkistus
kattaa molempien runtime-sukupolvien native-havainnot, rendererin,
Diagnosticsin ja tukipaketin. Synteettisiä salaisuuksia tai lähdepolkuja
ei havaittu näissä ulostuloissa. Tavallinen onnistuva tuonti ja nykyinen
workspace-koostetodistus läpäisivät erillisinä kontrolleina.

Koostetodistuksen testikuluttaja päivitettiin K:n nykyiseen porttiin:
pakollinen operational-konteksti sekä todellinen `assertMainOwned` ja
`prepareMainOwned` välitetään nykyiselle varausomistajalle. Testin
liiketoiminta-, eristys-, poistumis- ja palautusvaatimuksia ei muutettu.
Porttiregression ensitoisto vahvisti puuttuvan kytkennän; korjatun portin
ja nykyisten varaussopimusten 19 kohdetestiä sekä E2E-käännös läpäisivät.
Koostetestin no-op-loggeri ei ole diagnostiikan hyväksyntänäyttö;
yllä oleva erillinen main-koe käyttää oikeaa tiedostolokitusta.

Kokeen aiemmat fixture-/lukija-/kyselyvirheet säilyvät epäonnistumisina,
eivätkä ole sovelluksen palautusvikoja tai onnistuneita testejä. Rajattu
riippumaton katselmus korjautti kahden runtime-sukupolven havaintojen
tietosuojatarkistuksen. Tämä ei ole koko K:n loppukatselmus.

Vanhan snapshot-brokerin erillinen tarkistuspolku voi yhä pelkistää
schema-syyn yleiseksi virheeksi. Sitä ei yhdistetä tämän tuontikokeen
polkuun eikä korjata rinnakkaisella fallbackilla: hyväksytty K2:n
utility-/broker-v10-siirto omistaa sen poistamisen ja korvaavan ketjun
todennuksen. K3:n muiden kuluttajien todelliset runtime-polut, native-
tuotantopäätös, hot-journal-palautus, inventaarion järjestys, hardened-
paketti sekä PR/main ovat erillisiä avoimia portteja.

<a id="m1-source-preparation-l3095"></a>

#### V2q: korvauksen todellinen main/IPC-lukuketju

**Yhden same-lineage-korvauksen schema-hylkäys kohdetodennettu 10.10.2026;
K ei ole valmis.** Rajattu erilliskoe käyttää nykyistä eristettyä
Electron-testipohjaa, tuotannon compositionia ja aktiivisen synteettisen
yrityksen todellista salattua varmuuskopiota. Kelvollinen alkuperäinen
läpäisee tarkistuksen. Hyväksymätön schema-objekti lisätään vain purettuun
omistettuun kopioon; uudelleen salatun säiliön autentikointi, checksumit ja
sama lineage todistetaan erikseen. Hylkäys ei siis johdu väärästä yrityksestä,
salasanasta tai muuttuneesta container-checksumista.

Oikea yritysvalitsin, mainin tiedostovalinta, salasanaikkuna ja viimeinen
native-vahvistus käynnistävät korvauksen. Schema-portti hylkää candidate-
käsittelyn ennen aktiivisen sisällön vaihtamista. Vanha runtime on tässä
vaiheessa jo suljettu, joten nykyinen koordinaattori pyytää yhden hallitun
uudelleenkäynnistyksen. Vanha ikkuna sulkeutuu, runtime/session vaihtuu ja
sama aktiivinen yritys käynnistyy terveenä.

`PROFILE_SCHEMA_UNSUPPORTED` säilyy yksityiskohtaisessa desktop-lokissa,
backendin HTTP-projektiossa, strict-API-clientissä ja gzip-tukipaketissa
vaiheella `replace`. Incident-indeksiin tulee erillinen minimoitu projektio
samasta syystä ilman korrelaatio-, runtime- tai business-tunnisteita.
Virallinen tukipaketin tarkastin ja kaikki osioiden checksumit läpäisevät.
Ensisyyn `sideEffectState: unknown` säilyy; onnistunut toipuminen ei muuta
tapahtuman lupausta jälkikäteen sivuvaikutuksettomaksi. Erillistä
`workspaceBackup.cleanupFailed`-tapahtumaa ei tässä tapauksessa synny.

Varmuuskopion jälkeen lisätty asiakas, ennestään oleva asiakas, laskun
API-sisältö, PDF-tavut, rekisterin tavut ja aktiivisen yrityksen identiteetti
säilyvät. Myös valittu muokattu container ja kokeen oma SQLite-syöte pysyvät
muuttumattomina. Tämä ei väitä aktiivisen SQLite-tiedoston raakatavujen
säilyvän samoina normaalin WAL-sulkemisen ja uudelleenkäynnistyksen yli.
Molempien runtime-sukupolvien native-havainnot, renderer, lokiprojektiot,
Diagnostics ja tukipaketti tarkistetaan nimettyjen salaisuuksien ja
kiellettyjen business-arvojen varalta.

Rajattu riippumaton katselmus korjautti kokeen tietosuojatarkistuksen:
JSONin puretut merkkijonoarvot ja avaimet tarkistetaan, jotta Windows-polun
merkkikoodaus ei peitä mahdollista vuotoa. Tarkistuksen regressio ja sama
korvauskoe läpäisivät korjatulla testillä; aiempi näyttö säilytetään erillään.
Kyse oli tarkistuspuutteesta, ei havaitusta tietovuodosta. Rajattu katselmus
ei korvaa koko K:n loppukatselmusta.

Nimetty hylkäyskoe läpäisi ensimmäisellä ajolla. Tavallinen saman yrityksen
korvaus ja väärän yrityksen esto läpäisivät erillisinä muuttumattomina
kontrolleina. Tämä on rajattu erillistodistus, ei uusi pysyvä
CI-skenaario tai koko K:n hyväksyntä. Sovelluskoodia, riippuvuuksia,
aikarajoja, prosessiomistajuutta tai normaaleja testiehtoja ei tämän kokeen
perusteella muutettu. K2, muiden kuluttajien todellinen näyttö, native-
tuotantopäätös, hot-journal-palautus, inventaarion järjestys sekä hardened-
paketti ja PR/main pysyvät erillisinä avoimina portteina.

<a id="m1-source-preparation-l3147"></a>

#### V2r: pysyvät workspace-schema-hylkäystestit

**Kaksi pysyvää Electron-regressiota kohdetodennettu 10.10.2026;
K ja PR/main-portit ovat avoinna.**
[Nykyinen testitiedosto](../../apps/e2e/tests/electron/workspaceBackupSchemaRejection.spec.ts)
käyttää samaa eristettyä Electron-fixtureä sekä tavallista ajovalintaa:
`DESK-WORKSPACE-IMPORT-SCHEMA-001` ja
`DESK-WORKSPACE-REPLACE-SCHEMA-001` kuuluvat kriittisiin recovery-/security-
testeihin. Uutta testiruntimea, riippuvuutta tai aikarajaa ei lisätty.

Valmistelu muuttaa vain omistettua purettua kopiota ja muodostaa oikean
autentikoidun säiliön uudelleen. Vertailu vaatii muuttuneen tietokannan
todellisen koon ja tiivisteen; muut manifestikentät ja tiedosto-osat
säilyvät täsmällisinä. Ensimmäinen ajo pysähtyi uuden testiapurin
virheelliseen alkuperäisen tietokantatiivisteen odotukseen, ei sovelluksen
hylkäyspolkuun. Tämä odotus korjattiin; alkuperäistä epäonnistumista ei
merkitty läpäisyksi.

Lopullinen paikallinen kohdeajo läpäisi molemmat korjatut testit.
Ne todentavat tiedostovalinnan, native-salasanaikkunan, korvauksen
erillisen vahvistuksen, main/IPC-käsittelyn ja hallitun uudelleenkäynnistyksen.
Schema-syy säilyy yksityiskohtaisessa lokissa, minimoidussa incident-indeksissä,
strict-Diagnostics-lukijassa sekä virallisen tarkastimen ja checksumien
varmentamassa tukipaketissa. Nimetyt salaisuudet ja kielletyt business-arvot
tarkistetaan puretuista merkkijonoista ja avaimista, ei JSONin
merkkikoodauksesta.

Asiakaslista, varmuuskopion jälkeen lisätty asiakas, laskun API-sisältö,
PDF-tavut, aktiivisen yrityksen identiteetti, rekisteri ja omistetut
syötetiedostot säilyvät. Aktiivisen SQLite-tiedoston raakatavujen
identtisyyttä normaalin WAL-sulkemisen yli ei väitetä. V2p/V2q:n aiemmat
erilliskokeet säilyvät omana näyttönään; pysyvien testien todellinen
PR/CI-ajotodistus ja paketoitu palautus ovat erillisiä avoimia portteja.
Rajattu riippumaton katselmus täydensi loppulukijoiden vertailuja:
myös alkuperäinen `unknown`-sivuvaikutusluokitus ja `retryable: false`
vaaditaan Diagnosticsissa ja tukipaketissa. Korjattu testipari ja
E2E-tyyppitarkistus läpäisivät; katselmuksen jälkitarkistus ei löytänyt
saman havainnon jäljellä olevaa estettä. Tämä ei ole koko K:n loppukatselmus.
Native-toimituksen, hot-journal-palautuksen ja inventaarion päätökset
hyväksyttiin erikseen 10.10.2026; niiden toteutusnäyttö ja K2/K3:n muut
ehdot pysyvät erillisinä.

<a id="m1-source-preparation-l3189"></a>

#### V2s: Tarkistusajurin erillinen toimitus

**Työpuun rajattu kohdenäyttö 10.10.2026; ei koko K:n hyväksyntä.**
[Hyväksytty toimitussopimus](release-0.3.0-profile-validation-history.md#m1-source-preparation-l5431)
on toteutettu erillisenä build-/toimituspolkuna. Yksi database/infrastructure-
omistajan suljettu sopimus nimeää ajuriversion, eheydet, kohdealustan,
native-tavut ja metatiedon. Käännös varmennetaan lukituista lähteistä,
ympäristö rajataan ja ainoa lähdepatch on muistiseurannan asetus.
Buildin yksityinen työalue säilyy erillään pakkausvaiheen tyhjentämistä
hakemistoista. Epävarmaa käännös- tai kopioaineistoa ei poisteta.

Toimitus käyttää itsenäisiä tavukopioita, kiinteää kahden tiedoston
resurssia ja avattuun tiedostoon sidottua kokorajattua lukua. Linkki,
muuttunut lähde, väärä metadata/alusta tai puuttuva ajuri hylätään.
Katselmuksessa löydetty kasvavan lähteen kopiointiraja on korjattu ja
toistettu regressiossa. Kohde varmennetaan uudelleen pakkaajan jälkeen;
pelkkä stage-tiiviste ei hyväksy toimitettua tiedostoa.

Tarkistusyhteyden factory vaatii tämän ajurin kaikille omistetuille
yhteyksille, myös luotetun vertailuscheman muistiyhteydelle. Business-
oletusajuri ja sen pakkausportit säilyvät. Node- ja Electron-utilityn
seitsemän erillistä synteettistä kontrollia läpäisivät: nykyinen 039,
tuettu metadatallinen ja metadataless 038, pitkä resurssipolku sekä
puuttuva, muuttunut ja väärän alustan ajuri. Todellinen SQLite-rajan
ylitys torjuttiin ja tavallinen vain-luku-kontrolli läpäisi sen jälkeen.
Omistetut sulut ja utilityn poistuminen todennettiin. Tämä ei todista
K2:n varsinaista operaatiovarausta, broker-kytkentää tai prosessin RSS-kattoa.

Erilliset käännös-, luokittelu-, toimitus-, hash-/kopio- ja pakkauskytkennän
regressiot sekä tyyppitarkistukset läpäisivät. Windows-pakkaus muodosti
sovellusosan ja erillisen resurssin; kaikkien pakattujen sovellustiedostojen
tavuvastaavuus ja toimitetun ajurin sidonta läpäisivät erillistarkistuksen.
**Koko paketin inventaario hylkäsi silti pakkaustiedoston kokorajaan.**
Rajaa ei muutettu eikä tätä ajoa merkitä läpäistyksi. Mahdollinen
pakkaustiedoston rajapoikkeus on erillinen päätös ja vaatii rajatestit;
Windowsin kohdetulos ei hyväksy Linux-vastinetta tai hardened-palautusta.

Seuraavaksi tarvitaan K2:n main-owned entrypoint, varausluovutus ja
broker-v10 sekä hyväksytyn hot-journal-politiikan kytkentä.
Inventaarion toteutus ja erillinen kohdenäyttö ovat [V2t:ssä](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3233).
Sama testattu output, Linux-vastine, todelliset kuluttajapolut,
hardened-palautus, loppukatselmus ja täsmärevision PR/main-portit ovat
edelleen avoimia. K:n välitilaa ei julkaista.

<a id="m1-source-preparation-l3233"></a>

#### V2t: Inventaarion suljettu virhepolku

**Työpuun rajattu toteutus 10.10.2026; ei koko K:n hyväksyntä.**
Julkaistun työtilan tarkistus todistaa koko scheman ja migraatiohistorian
ennen identity-, integrity- tai foreign-key-lukua. Tuntematon schema,
muuttunut tai vajaa historia ja korruptoitunut tiedosto keskeyttävät koko
inventaarion. Identityä tai turvallista migraatioprefixiä ei arvata.
Todennetun scheman tavallinen sisältövirhe säilyttää `invalidHistory`-
luokituksen. Backend ei muuta lähdetietokantaa.

Registry-portin erillinen `inspect()` lukee nykyisen slotin tai puuttuessa
backup-/next-slotin ilman korjaamista, siirtoa tai poistoa. Inventaario ja
normaali first-start/active-valinta käyttävät tätä porttia; journalin
omistamat erilliset recovery-polut ja kirjoittava `read()` säilyvät.
Virheellisen korkeamman slotin jälkeen ei vaihdeta alemman auktoriteettiin.
Vastaavat nykyohjeet on päivitetty [ADR-0011:een](../decisions/ADR-0011-local-multi-workspace-company-model.md)
ja [workspace-suunnitelmaan](local-company-workspace-plan.md).

Turvallinen schema/history-ensisyy säilyy nykyisen candidate-kanavan,
inventaarion, first-startin ja aktivoinnin virheketjussa. Peruutus sulkemisen
aikana säilyttää jo syntyneen syyn mutta pitää peruutuksen oman lopputilan.
Raakavirheitä tai identiteettejä ei lisätä julkisiin projektioihin.
Ennen korjausta tehdyt toistot ja katselmuksen kaksi syytiedon puutetta
on erotettu korjatusta kohdenäytöstä. Backendin 62 kohdetestiä sekä koko
backendin 3 031 testiä ja neljä build-kontrollia läpäisivät; viisi aiempaa
ohitusta eivät ole läpäisyjä. Korjatut desktopin 129 kohdetestiä ja yhteinen
tyyppitarkistus läpäisivät. Määriä ei summata päällekkäisen kattavuuden vuoksi.

Desktopin kokonaisajossa kaksi olemassa olevaa palautustestiä ylitti oman
aikarajansa; myös keskeneräisen testin siivous epäonnistui. Alkuperäinen
näyttö säilyy. Yksi sallittu kohdennettu uusinta läpäisi 86 testiä, mutta se
ei muuta kokonaisajoa onnistuneeksi tai selitä timeoutien syytä. Kokonaisajon
jälkeinen Node-testivaihe ei käynnistynyt.

Todelliset Electron-kontrollit käyttävät samaa testipohjaa: luotetun scheman
sisältövirhe, epäluotettu schema ja väärä historia, pysäytys ennen myöhempiä
työtiloja sekä kolmen registry-slotin, tietokanta-/artifact-tavujen ja
prosessiomistajuuden säilyminen. Kolme nimettyä nykyisen Electron-development-
runtimen testiä (inventory, first-start ja activation) läpäisivät ensimmäisellä
yrityksellä nykyisin aikarajoin. Ensisyy- ja peruutusregressiot sekä
Electron-koeaineiston muutos on katselmoitu; rajattu jälkitarkistus ei löytänyt
uutta estettä. Inventoryn hylkäyskoe käyttää oikeaa koordinaattoria ja
candidatea, ei koko first-start-koosteen hylkäyspolkua. Tämän koosteen
hyväksytyn buildin tilan säilyminen, backup-/next-only-slotit ja epävarman
siivouksen todellinen polku tarvitsevat vielä oman todennuksensa.
Hardened-palautus ja PR/main-portit ovat vielä avoinna. Kohdenäyttö ei sulje
K2:n utility-, muistibudjetti- tai varausluovutussopimusta eikä hot-journal-poikkeusta.

<a id="m1-source-preparation-l3281"></a>

#### V2u: Omistetun paikallisen työtilan kaatumispalautus

**Hyväksytty rajaus ja työpuun toteutus 10.10.2026; ei koko K:n hyväksyntä.**
Backendin `recoverOwnedLocalDatabase` sallii SQLiten natiivin rollbackin
ennen schema-lukua vain yksityisen, elävän omistajuusportin kautta.
Main johtaa valinnan normaalin rekisteröidyn työtilan tai strictin
inventaarion `ready`-entryn juuresta. Yksityinen valinta sitoo juuren
tiedostojärjestelmäidentiteetin; child johtaa täsmällisen tietokantapolun
samasta profiililayoutista ja tarkistaa nykyisen prosessivarauksen,
käynnistyssukupolven ja peruutuksen. Pelkkä path, operaatio tai DTO ei anna
palautusoikeutta. Childin funktiovalta ei tule rendereriltä tai backupista.

Poikkeus on kytketty vain normaaliin local-käynnistykseen ja julkaistun
paikallisen työtilan inventaarioon. Adoption-, migration-activation-,
restore-/rollback-validation-, import-/replacement- ja snapshot-polut eivät
saa sitä. Tietokanta ja journal ovat kanonisia yhden linkin tiedostoja;
ristiriitaiset WAL/SHM-sivutiedostot, muuttunut identiteetti, katkennut varaus
tai peruutus estävät etenemisen. SQLite itse palauttaa journalin;
sovellus ei tulkitse, poista tai muokkaa sen sisältöä. Vain
`trusted_schema=OFF`, `query_only=ON` ja lukevan `main.schema_version`-
pragman alkuperäinen pager-käsittely ovat sallittuja tässä vaiheessa.
Sen jälkeen yhteys suljetaan ja normaali koko scheman/historyn portti
suoritetaan ennen identity-, business- tai migraatiokyselyitä.

Palautus voi muuttaa tietokantaa ja journalia, vaikka myöhempi schema- tai
omistajuusportti hylkää käynnistyksen. Sivuvaikutusta ei silloin merkitä
olemattomaksi. Ensimmäinen syy säilyy sisäisessä ketjussa; julkinen
database-/migration-virhe pysyy turvallisena. Epävarma omistajuus ei
käynnistä omaa tiedostokorjausta tai poistoa. Terveen tiedoston, tyhjän
TRUNCATE-journalin sekä nykyisen WAL-käynnistyksen normaali polku säilyy.

Rajatut backend- ja desktop-regressiot sekä tyyppitarkistus ovat
läpäisseet. Kolme nimettyä Electron development -kontrollia läpäisivät:
inventory todellisine keskeytyksineen, ensimmäisen käynnistyksen migraatio
ja passiivisen yrityksen aktivointi. Inventory todistaa kirjoittajan exitin
ennen uutta candidatea, muuttuneiden tietokantatavujen täsmällisen palautumisen,
keskeneräisen muutoksen peruutuksen, rekisteri-/artifact-tavujen säilymisen
ja seuraavan inventaarion sivuvaikutuksettomuuden. Riippumaton katselmus
löysi yhden palautus-/schema-portin testinäytön puutteen; korjattu regressio
todistaa aidon levyspillauksen, alkuperäisten tavujen palautumisen ja
schema-hylkäyksen ennen kirjoitettavaa avausta tai palvelurekisteröintiä.
Kohdetesti ja löydöksen uudelleenkatselmus läpäisivät. Tämä ei vielä todista
kaikkia main-compositionin palautusvalintoja tai testikirjoittajan jokaista
epäonnistumis-/säilytyshaaraa; ne huomioidaan jäljellä olevassa todennuksessa.
Linux, hardened backup -> inspect -> restore -> restart -> compare ja
PR/main-portit ovat erillisiä, vielä avoimia hyväksyntäportteja. V2t:n
kokonaisajon epäonnistumista ei muuteta myöhemmällä kohdenäytöllä läpäisyksi.

<a id="m1-source-preparation-l3329"></a>

#### V2v: Eristetyn tarkistuksen prosessiraja

**Työpuun rajattu perusta kohdetodennettu 10.10.2026; kuluttajakytkentä avoinna.**
Backendin `runProfileInspection` käyttää pakollista erillistä tarkistusajuria
ja samoja nykyisiä schema-, sisältö- ja artifact-portteja. Yksi omistettu
readonly-tarkistus palauttaa kuitin todellisista tietokanta- ja katalogitavuista;
identiteetit sekä koko/hash tarkistetaan myös työn jälkeen. Activationin
valmistelu ei tee toista rinnakkaista tarkistusta. Sulkemisen lisävirhe ei
peitä aiempaa tarkistusvirhettä eikä anna onnistunutta kuittia.

Desktopin `profileInspectionMessages`, `profileInspectionRunner` ja
`profileInspectionProcess` muodostavat suljetun private-sopimuksen,
kiinteän utility-entrypointin ja rajatun poistumisketjun. Niissä säilyvät
K-P2:n resurssibudjetit, yksi terminal ja operation/generation/session-sidonta.
Main luovuttaa vain operaation oman varauksen, ei installation-writerin
varausta. Oikea onnistunut exit ja palautunut varaus tarvitaan ennen
hyväksyntää; killin palautus tai exit-koodi yksin ei riitä. Myöhäinen
valmistelu, peruutus tai uudelleen sisään tuleva omistajuuscallback ei saa
julkaista tulosta. Tunnettu ensisyy ja epävarma cleanup pysyvät erillisinä.

Backendin ja desktopin rajatut regressiot, yhteinen tyyppitarkistus sekä
tuotantobuildit läpäisivät. Samassa oikeassa Electron-utilityssa kahdeksan
synteettistä tapausta todensi nykyisen ja kummankin tuetun 038-muodon,
activation-valmistelun, epäluotetun scheman, puuttuvan tarkistusresurssin,
ennenaikaisen exitin ja kesken työn tehdyn pakkopysäytyksen. Kuitit,
todellinen exit, varauksen palautuminen ja lähteen muuttumattomuus
tarkistettiin erikseen. Ensimmäiset koejärjestelyn epäonnistumiset säilyvät;
käynnistimen korjaus tai ennen työtä tapahtunut keskeytys ei ole näyttö
sovelluksen historiallisten vikojen syystä.

Riippumaton katselmus löysi kolme rajattua puutetta: SQL-katalogin liian
myöhäinen määräraja, vain varauksen palautuksessa syntyvän virheen liian
yleinen syy ja valmisteluvaiheen sidotun failure-terminalin syyn katoaminen.
Kohdetoistot vahvistivat puutteet. Korjaus tarkistaa Invoicingin omistamat
dokumenttirajat ennen rivien materialisointia ja säilyttää valmisteluvirheen
ensisyyksi; varauksen palautuksen oma virhe luokitellaan erikseen.
Virheellinen tai ennen valmistelulupaa tuleva terminal ei saa tätä poikkeusta.
Lukumäärän lisäksi dokumenttikatalogin tekstiarvojen tavuraja ja numeerisen
kokokentän tyyppi tarkistetaan ennen materialisointia. Nykyinen sallittu
määräraja säilyy; rajalla oleva katalogi läpäisee. Korjatun ehdokkaan
kohderegressiot, tyyppitarkistus ja tuotantobuildit läpäisivät.
Riippumaton täsmällisten löydösten jälkikatselmus sulki kaikki kolme puutetta.
Sen jälkeen sama kahdeksan tapauksen oikean prosessirajan koe läpäisi
lopullisella ehdokkaalla; myös katalogin todellinen koko/hash ja lähteen
muuttumattomuus varmennettiin. Tämä ei hyväksy kytkemättömiä kuluttajia.

Tämä perusta ei vielä kytke tavallista Inspectiä, portable-backupin tai
recovery pointin itsevalidointia eikä restore-aktivointia utilityyn.
V2v:n koehetkellä broker oli versiossa 9; [V2x](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3427)
täydentää sen kevyen kontekstin. Vanha raskas käsittely säilyy väliaikaisesti
kunnes todelliset kuluttajat ja niiden siivous-/maintenance-ehdot on todennettu.
Installation-kohtainen busy-portti ja päivitysoperaation uudelleentarkistus
kuuluvat tähän seuraavaan kytkentään, eivät tämän perustan valmiusväitteeseen.
Kytkentävaiheen katselmus, Linux, koko paketti, hardened-palautus ja PR/main-
portit ovat avoinna. V2t:n epäonnistunutta kokonaisajoa ei hyväksytä näillä
päällekkäisillä kohdeajoilla.

<a id="m1-source-preparation-l3386"></a>

#### V2w: Luotettu konteksti ja tarkistuksen koostaminen

**Rajattu koostamispala kohdetodennettu 10.10.2026; broker- ja kuluttajakytkentä avoinna.**
Backendin `activeProfileInspectionContext` lukee vain jo hyväksytyn aktiivisen
yhteyden profiilisidonnan ja tyhjyystilan. `createApp` rekisteröi tämän
nimetyn portin; tuodun kannan tarkistaja ei saa aktiivista tietokantayhteyttä.
Nykyinen väliaikainen snapshot-adapteri käyttää samaa kontekstin lukijaa.

Mainin `runProfileSnapshotInspection` koostaa nykyisen julkisen validointituloksen
luotetusta kontekstista ja eristetyn tarkistimen private-kuitista. Konteksti
tarkistetaan ennen työtä ja uudelleen todellisen exitin sekä varauksen
palautumisen jälkeen. Profiilin tai elävän auktoriteetin vaihtuminen hylkää
tuloksen. Sama alkuperäinen työmääräaika kattaa kontekstihaut ja tarkistuksen;
valmistelun myöhäinen valmistuminen ei käynnistä uutta työtä. Vain operaation
oma varaus luovutetaan, ja prosessilla on uusi private-generation sekä session.
Kuitin tiedostotiivisteet eivät siirry validoinnin julkisiin kenttiin.

Rajatut backend- ja desktop-testit, yhteinen tyyppitarkistus sekä kyseisten
pakettien buildit läpäisivät. Oikean prosessirajan 13 synteettistä tapausta
todensivat nykyisen ja tuetut historialliset aineistot, valmistelun,
sisältöhylkäykset, peruutukset, kontekstin vaihtumisen sekä operaatiokansion
identiteetin vaihtumisen ennen työtä ja sen jälkeen. Viimeisissä tapauksissa
aineisto säilyi, eikä vanha varaustieto antanut poisto- tai käyttöoikeutta.

Riippumaton rajattu katselmus löysi epäonnistuneen kontekstihaun vanhentuneen
siivousvarmuuden sekä mitätöinnin lisävirheen aiheuttaman ensisyyn katoamisen.
Korjaus varmentaa omistajuuden tuoreeltaan nykyisen rajatun siivousbudjetin
sisällä ja säilyttää alkuperäisen syyn. Jälkikatselmuksen löytämä myöhäisen
Promise-tuloksen rajatapaus tarkistaa myös monotonisen määräajan, ei vain
ajastimen suoritusta. Regressiot kattavat nämä haarat, ja täsmällinen
jälkikatselmus sulki kaikki kolme puutetta.

Kooste ei vielä ole tavallisten backup-/restore-kutsujien production-portti.
Broker-v10, update-/maintenance-omistajan tarkistus oikeassa kanavassa,
installation-busy, varauksen koko staging-elinkaari ja hallittu shutdown
ovat seuraavan yhtenäisen kytkennän ehtoja. Vanha raskas adapteri poistetaan
vasta vastaavan kattavuuden todennuksen jälkeen; varapolkua ei jätetä.
Linux, kokonaispaketti, hardened-palautus, todellinen diagnostiikkaketju ja
PR/main-portit jäävät avoimiksi. Tämä pala ei sulje koko K:ta tai alkuperäistä
Security-havaintoa.

<a id="m1-source-preparation-l3427"></a>

#### V2x: Kevyt broker-v10-konteksti

**Kevyt kontekstiketju ja rajattu katselmus valmistuneet 10.10.2026; kuluttajakytkentä avoinna.**
Nykyinen private snapshot-broker käyttää versiota 10 ja nimettyä
`readProfileInspectionContext`-pyyntöä. Tarkistin saa vain luotetun aktiivisen
profiilin sidonnan ja tyhjyystilan, ei polkuja, rivejä, katalogia tai salaisuuksia.
Lähettäjä, parseri, vastaanottaja ja `backendRunner`-rekisteröintiadapteri
käyttävät samaa suljettua sopimusta. Vanha versio ja ylimääräiset kentät hylätään.

Kutsujan sama monotoninen määräaika kattaa valmiusviestin odottamisen ja
kontekstivastauksen; valmius tai myöhäinen vastaus ei aloita uutta budjettia.
Peruutus sulkee pyynnön kuuntelijat, ja vanhan yksityisen kanavan sulkeminen
mitätöi sen auktoriteetin myös silloin, kun uusi runtime käyttää samaa profiilia.
Restore-valmistelu edellyttää täsmällistä tavallisen maintenance-operaation
omistajaa. Päivitys edellyttää eksplisiittistä update-omistajaa ennen kontekstin
luovutusta ja uudelleen vastauksen hyväksymisessä; katko ei avaa kirjoituksia.

Rajatut protokolla-, backend-, koostamis- ja adapteritestit sekä yhteinen
tyyppitarkistus ja buildit läpäisivät. Oikean Electron-viestikanavan 17
synteettistä tapausta todensivat tarkistusutilityn onnistumiset ja hylkäykset,
varauksen palautuksen, alku-/loppukontekstin katkot ja update-suojan
mitätöitymisen. Epävarman kansion alkuperäiset tavut säilyivät, ja tuore varaus
varmennettiin erikseen mainin poistumisen jälkeen. Tämä ei ole koko
tuotantobackendin utility-rekisteröinnin tai tavallisten kuluttajien hyväksyntä.
Riippumaton rajattu lähdekatselmus ei löytänyt tästä muutoksesta uutta ohitusta
tai regressiota; se ei korvaa yllä rajattua runtime- tai pakettinäyttöä.

Vanhoja raskaita broker-operaatioita ei ole vielä poistettu. Tätä yksityistä
välitilaa ei commitoida tai julkaista, eikä uusi kontekstipolku käytä vanhaa
raskasta operaatiota varapolkuna. Seuraava yhtenäinen kytkentä siirtää todelliset
kuluttajat, installation-busy-rajan, nykyisen runtime-generationin sekä varauksen
koko inspect -> käyttö -> siivous -elinkaaren ja hallitun sulun. Vasta vastaavan
kattavuuden jälkeen korvattu raskas käsittely poistetaan. K3:n todellinen
diagnostiikkaketju, Linux, hardened-palautus, loppukatselmus ja PR/main-portit
säilyvät avoimina. Tämä osatulos ei sulje K:ta tai Security-havaintoa.

<a id="m1-source-preparation-l3463"></a>

#### V2y: Omistettu Inspect-kuluttaja

**Rajattu kuluttajatoteutus 10.10.2026; tämän checkpointin main-kytkentä oli avoin.**
`inspectOwnedEncryptedProfileBackup` käyttää nykyistä autentikoitua purkajaa
ja kiinteää tarkistusutilitya. Operaation varaus on pakollinen, eikä raskas
business-backend-operaatio toimi varapolkuna. Yhteinen staging-palvelu ei enää
poista tarkistuskansiota hylätyn validointipyynnön perusteella: hylätty Promise
tai aikakatkaisu ei todista lukevan prosessin poistumista.

Varauksen hankinta, luotettu konteksti ja utility-työ käyttävät yhtä alkuperäistä
tarkistusbudjettia. Myöhäinen hankinta ei anna työlupaa eikä poisto-oikeutta;
kutsuja voi välittää jäljellä olevan monotonisen määräajan, mutta ei kasvattaa
budjettia. Containerin autentikointi/purku säilyttää nykyiset omat formaatti- ja
sisältörajansa, eikä samaa budjettia aloiteta uudelleen kontekstissa tai lapsessa.

Yhteenveto palautetaan vasta todetun utility-exitin, varauksen takaisinoton,
tuoreen main-omistajuustarkistuksen ja omistetun siivouksen jälkeen. Ensivirhe
ja siivouksen varmuus säilyvät erillisinä. Myöhäinen siivoushavainto ei käynnistä
poistoa; vaihtunut kansio tai epävarma exit/takaisinotto säilyttää aineiston.
Alkuperäistä salattua varmuuskopiota ei poisteta eikä muokata.

Rajattu regressio kattaa tämän kuluttajan ja nykyiset purkuhelperin kuluttajat.
Todellinen Electron-development-koe käyttää tuotannon varausadapteria,
viestikanavaa, MEMSTATUS-ajuria ja kiinteää utilitya. Sen synteettiset nyky- ja
038-varmuuskopiot sekä schema-, manifesti-, toimitus-, exit- ja peruutusvirheet
erottavat ensisyyn turvallisesta siivouksesta. Kansion vaihtumisen alkuperäiset
tavut säilyvät; varauksen vapautuminen tarkistetaan erikseen mainin poistuttua.
Lopullinen kohdesarja läpäisi 94 testiä viidessä tiedostossa; yhteinen
tyyppitarkistus, desktop-build ja yhdeksän todellista prosessitapausta
läpäisivät samalla katselmoidulla lähteellä. Määräaikarajalla tapahtuvan
hankinnan katselmointilöydös toistettiin ensin erillisellä regressiolla:
kahvan hyväksyntä oli tarkistettava myös `await`-jatkossa ennen siivouslupaa.
Korjaus ja täsmällinen regressio sulkeutuivat saman rajatun katselmuksen
jälkitarkistuksessa. Aikaisemmat kohdeajot säilyvät erillisinä, eikä niitä
summata tähän tulokseen. Tämä ei korvaa kokonaisuuden hyväksyntäportteja.

Tässä checkpointissa uutta funktiota ei vielä ollut kytketty tavallisen UI:n tuotantocompositioniin.
Portable-backupin lähdesnapshot, recovery point, palautusta odottava staging,
activation/discard, cold-recovery ja shutdown tarvitsevat yhtenäisen jäljellä
olevan omistajuuskytkennän. Vanhoja raskaita broker-operaatioita ei poisteta
ennen vastaavaa kattavuutta, eikä niitä lisätä uuden kuluttajan fallbackiksi.
Linux, hardened-palautus, koko K:n katselmus ja PR/main-portit ovat avoinna.
Tätä välitilaa ei julkaista eikä Security-havaintoa merkitä korjatuksi.

<a id="m1-source-preparation-l3507"></a>

#### V2z: Portablen main-kuluttajaportti

**Rajattu tuotantokytkentä 10.10.2026; muiden kuluttajien vaihto jatkuu.**
Mainin `ProfileSnapshotInspectionClient` toteuttaa pakollisen
`ProfileSnapshotInspectionPort`-sopimuksen. Portable-varmuuskopion luonti
ja tarkistus käyttävät kiinteää utilitya; aktiivinen business-backend antaa
vain luotetun kontekstin ja lähdesnapshotin. Erillinen toimitussopimus
johdetaan validoidusta backend-resurssista, ei toisesta native-ajuriversiosta.
Palveluun ei lisätä raskasta tarkistusta varapolkuna.

Operaation lähdekansio säilyy C-varauksella tarkistuksen, containerin
kirjoituksen ja riippumattoman itsevalidoinnin yli. Kirjoitettavat tietokanta-
ja katalogitavut sekä PDF-määrä, koko ja täsmällinen polku-/koko-/SHA-256-joukko
sidotaan tarkistusreceiptin sisältöön. PDF:n tallennusnimi johdetaan nykyisestä
dokumentti-identiteetistä, ei PDF-tavujen tiivisteestä. [V2ah](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3849)
korjaa tämän kuittisidonnan muuttamatta tallennusnimiä tai backup-formaattia.
Itsevalidointi käyttää eri omistettua kansiota;
lähdekansion varaus ei vapaudu sen ajaksi. Tavallinen varmuuskopioformaatti
ja tuettu historiallinen 038-yhteensopivuus säilyvät.

Portable-operaatio, myös pelkkä Inspect, hankkii nykyisen installation-leasen.
Main sulkee uuden työn pääsyn synkronisesti ennen hallittua sulkua ja odottaa
rajatusti koko omistettua kuluttajaa, ei vain päättynyttä tarkistusutilitya.
Ennen lähdetavujen käyttöä tarkistetaan sekä tuore natiiviomistajuus että
receiptin nykyinen yksityinen backend-generation; `await` ei säilytä vanhaa
työlupaa. Myöhäinen snapshot-vastaus tai epävarma kirjoittaja ei anna toiselle
operaatiolle käyttö- tai siivousoikeutta.

Varmentamaton siivous säilyttää lähdeaineiston ja estää puhtaan sammutuksen
merkinnän. Muut omistetut sulut yritetään siitä huolimatta. Portable-luonnin
ensisyy ja siivouksen epävarmuus säilyvät erillisinä, eikä epävarmaa poistoa
yritetä toistamiseen tai merkitä turvallisesti uusittavaksi. Käyttäjärajan
yleinen virheilmoitus säilyy; operational-lukija saa vain sallitun ensisyyn,
uusittavuuden ja sivuvaikutustilan, ei poikkeuksen raakasisältöä.

Rajattu lähdekatselmus löysi kaksi toistettavaa puutetta: työlupa oli
tarkistettava vielä natiiviawaitin jälkeen ja luonnin siivouksen epävarmuus
oli säilytettävä ensisyyn rinnalla. Molempien regressiot hylkäsivät korjausta
edeltävän toteutuksen; korjaukset suljettiin saman katselmuksen jälkitarkistuksessa.
Lopullinen kohdesarja läpäisi 184 testiä yhdeksässä tiedostossa, desktopin
tyyppitarkistus ja build läpäisivät. Kahdeksan todellista Electron-koetta
käyttivät tuotannon kuluttajapalvelua, viestikanavaa, varausadapteria,
MEMSTATUS-ajuria ja kiinteää utilitya. Nyky-/038-containerit, schema-hylkäys,
ennenaikainen exit, peruutus ja kansion identiteetin menetys erottivat
ensisyy-, exit-, takaisinotto- ja säilytystulokset. Luontikoe todensi myös
riippumattoman itsevalidoinnin. Lähde- ja build-tavut säilyivät samoina kokeessa.

Todennus käyttää hallittua synteettistä snapshot-kirjoittajaa ja kontekstin
lukijaa. Se ei korvaa koko tavallisen UI:n backend-käynnistyksen,
recovery-/restore-kuluttajien, cold-recoveryn tai paketoidun palautuksen
hyväksyntää. Palautusta odottavan aineiston varaus sekä activation/discard
ja durable-handoff toteutetaan seuraavassa rajatussa kytkennässä. Vanha
raskas broker palvelee vielä vain vaihtamattomia kuluttajia; se poistetaan
ennen koko K:n hyväksyntää vastaavan kattavuuden jälkeen. Linux,
hardened-kokonaispaketti, loppukatselmus ja PR/main-portit pysyvät avoinna.
Tämä kohdetulos ei sulje K:ta tai Security-havaintoja eikä julkaise välitilaa.

<a id="m1-source-preparation-l3564"></a>

#### V2aa: Palautuspisteen lähdevaraus

**Lähdekuluttajan kytkentä 10.10.2026; Store ja palautus ovat avoinna.**
`RecoveryPointService` käyttää mainin pakollista inspection-porttia kaikissa
lähdesnapshotin luontitavoissa. Yksi omistettu operaatio kattaa muodostamisen,
eristetyn tarkistuksen, tallennuksen, rotationin, tilapäivityksen ja siivouksen.
Tietokanta- ja katalogitavut sekä PDF-inventaario sidotaan receiptin sisältöön
ennen tallennusta; varaus säilyy koko kuluttajatyön yli.

Päivityksen caller-owned maintenancea ei hankita tai vapauteta uudelleen.
Erillinen update-omistaja välittyy tarkistukseen, ja voimassaolo tarkistetaan
ennen käyttöä sekä siivouksen jälkeen ennen onnistumiskuittausta. Myöhäinen
suojan menetys säilyttää jo tallennetun hyvän palautuspisteen. Lähteen poistoon
kelpaa vain natiiviomistajan todistus, ei brokerin assertion-kuittaus tai
ehdoton tiedostopoisto. Epävarma siivous säilyttää ensisyyn, estää turvallisen
uusinnan ilmoittamisen ja pitää palvelun unavailable-tilassa. Automaattisen
luonnin onnistumistapahtuma tulee vasta tämän elinkaaren jälkeen.

Alkuperäiset regressiot toistivat puuttuvan käyttövarauksen, receiptin
sisältöeron, ensisyyn rinnalta katoavan siivousepävarmuuden ja ennenaikaisen
onnistumistapahtuman. Lopullinen kohdesarja läpäisi 90 testiä seitsemässä
tiedostossa; erillinen päivityssuojan composition-sarja läpäisi seitsemän
testiä. Tyyppitarkistus ja build läpäisivät. Yhdeksän todellista Electron-
prosessikoetta todensivat nyky-/038-lähteet, update-omistajan, schema- ja
tavuhylkäyksen, peruutuksen, sulun kesken tallennuksen ja myöhäisen suojan
menetyksen. Exit, varauksen takaisinotto ja alkuperäisten tavujen säilyminen
tarkistettiin erikseen; lähde ja build eivät muuttuneet kokeen aikana.

Kokeen snapshot-kirjoittaja, kontekstinlukija ja Store-callback ovat hallittuja.
Katselmus vahvisti muodostajan nykyisen eristämättömän kopiotarkistuksen:
`createSqliteSnapshot` kutsuu `inspectSqliteProfileDatabase`-funktiota ennen
mainin eristettyä utilitya. Tämä on avoin koko K:n este, ei uuden lähde-
elinkaaren regressio eikä kokeella suljettu polku. Store-containerin
itsevalidointi ja materialisointi käyttävät vielä vanhaa tarkistuspolkua;
ne eivät ole uuden lähdekuluttajan fallback. Niiden sekä restore-stagingin,
activation/discardin, cold-recoveryn, todellisen muodostajan, Linuxin,
hardened-palautuksen ja PR/mainin hyväksyntä on edelleen avoin.

<a id="m1-source-preparation-l3602"></a>

#### V2ab: Valmistellun palautuksen omistajuuden siirto

**Valmistellun slotin esitason kohdetoteutus 10.10.2026; native-kytkentä on avoin.**
Tavallinen restore-staging ja palautuspisteen staging käyttävät samaa
yksinomaista prepared-slotin claimia. Claim estää kilpailevan valmistelun,
aktivoinnin ja discardin ennen ensimmäistä odotusta. Valmistelun pysyvä
journal tai epävarma readback siirtää slotin recovery-omistukseen ennen
runtimen sulkua. Metadataa ei enää voi käyttää uuden aktivoinnin lupana.
Vanha vapautettu claim ei vapauta uuden kutsun omistajuutta.

Hylätty prepare-kutsu ei todista journalin puuttumista. Puhdas hylkäys
edellyttää myös operaation rollback- ja failed-kansioiden puuttumista;
jäljelle jäävää aineistoa ei poisteta tai nimetä uudelleen arvaamalla.
Palvelun catch ei vapauta maintenancea pysyvässä tai epävarmassa handoffissa.
Alkuperäinen turvallinen syy säilyy `restore.activationFailed`-tapahtumassa,
ja erillinen `restore.recoveryRequired` käyttää täsmällistä `activation`-
vaihetta kaikissa nykyisissä lukijoissa. Se ei väitä rollbackin alkaneen.

Lopulliset kohderegressiot läpäisivät erikseen desktopissa 216 testiä
13 tiedostossa, backend-lukijoissa 80 testiä ja API-clientissä 55 testiä.
Tyyppitarkistus ja käännökset läpäisivät. Käännetyn Windows-kuluttajan
seitsemän synteettistä tapausta todensivat todellisen journalin ja
tiedostojärjestyksen, ensisyyn/lisävirheen sekä nykyisen observerin,
JSONL:n, Diagnosticsin ja API-clientin kytkennän. Lukijapariteetin erillinen
tiedostokoe tarkisti 30 tapahtuma/vaihe-sopimusta, myös tukipakettiin asti.
Tarkistuksen snapshot- ja Store-portit ovat näissä hallittuja, eivät
todellinen eristetty native-tarkistin tai backend-prosessin exit-todiste.

Native-varauksen säilyminen odottavan stagingin ja durable-handoffin yli,
vanhan brokerin ajastettu/katkeamisen jälkeinen vapautus, Store-itsevalidointi,
C:n offline-kulutus ja cold-recovery jäävät avoimiksi integraatioehdoiksi.
Myös todellinen muodostaja, Linux, hardened-palautus ja PR/main vaaditaan.
Tämä prerequisite ei sulje K:ta, S030-havaintoja tai koko palautussuojaa.

<a id="m1-source-preparation-l3636"></a>

#### V2ac: Snapshotin hyväksyntäkäytännön sidonta

**Rajattu muodostajapolun edellytys; kohdetodennus läpäissyt.** Muodostetun
snapshotin `exactCurrentManifest` tai `compatibleHistoricalPrefix` säilytetään
mainin yksityisessä operaatiotietueessa ja välitetään pakollisena eristetyn
tarkistimen prepare-pyyntöön. Tuodun aineiston tarkistus käyttää erikseen
`restoreCompatible`-käytäntöä. Puuttuvaa tai tuntematonta käytäntöä ei
korvata oletuksella prosessirajalla. Vastaanottaja käyttää samaa nykyistä
schema-/migraatiotarkistusta; kuittauksen käytännön pitää vastata pyyntöä
sekä runnerissa että mainissa ennen tiedostojen käyttöoikeutta.

Regressiot vaativat täyden nykyketjun hyväksynnän, tavallisen snapshotin
vajaan ketjun hylkäyksen, eksplisiittisen historiallisen prefixin hyväksynnän
ja julkaistun 038-palautuksen rajojen säilymisen. Eri käytännön kuittaus,
puuttuva kenttä tai väärän lähteen uudelleenkäyttö ei saa tuottaa onnistumista.
Omistajuus, poistumistodiste, resurssirajat ja ensimmäinen syy säilyvät.

Tämän checkpointin aikaan Store- ja durable-kutsujat käyttivät vielä vanhaa
brokeria. Store-kytkentä on tämän jälkeen kohdetodennettu [V2ad:ssa](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3703),
mutta durable-aktivointi on avoin. Vanhaa muodostajan kopiotarkistusta ei
poisteta vielä. Poisto tehdään vasta kaikkien muodostetun snapshotin todellisten
kutsujien vastaavan eristetyn tarkistuksen todennuksen jälkeen. Tämän vaiheen
olemassa olevaan fixtureen perustuva oikean muodostajan ja utility-prosessin
koe ei korvaa hardened-palautusta, Linuxia tai PR/main-portteja.

Ensimmäinen oikean WAL-muodostajan koe hylättiin ennen prosessitapausten
hyväksyntää. Muodostajan vanha readonly-kopiotarkistus jätti snapshot-juureen
SQLite-sivutiedostoja, joita tiukka katalogin sisältötarkistus ei hyväksy.
Alkuperäinen aineisto säilyy. Jatko käyttää jo hyväksyttyä erillisen
tarkistuskopion omistajuusmallia; sisältöjoukkoa ei väljennetä eikä
alkuperäisiä sivutiedostoja poisteta arvaamalla. Vanhan muodostajavaiheen
poisto ja kaikkien sen kutsujien vastaava todennus ovat edelleen avoinna.

Main johtaa erillisen tarkistuskansion sidotusta prosessisukupolvesta ja
luo sen nykyisen varauksen valmistelucallbackissa ennen luovutusta.
Callbackin toteutuminen on pakollinen onnistumisehto. Eristetty tarkistin
sitoo lähdekannan ja katalogin tavut, tekee nykyisellä rajatulla kopiointiapurilla
itsenäisen kopion ja lukee schema/historyn, identiteetin, eheyden ja katalogin
vain siitä samalla readonly-yhteydellä. Sulkemisen jälkeen sekä kopion että
alkuperäisen aineiston identiteetti, koko ja tiiviste tarkistetaan uudelleen.
Alkuperäisen snapshot-juuren tiukka sisältöjoukko säilyy muuttumattomana.

Siivous kuuluu mainille ja vaatii utilityn todellisen poistumisen, varauksen
palautuksen, tuoreen kansio-omistajuuden ja rajatun keskeytyssignaalin.
Vain todistetusti oma tyhjä käyttämätön kansio saa tyhjän kansion poistopolun;
muut kopiot noudattavat nykyistä tiukkaa tiedosto- ja WAL-sääntöä. Myös
viimeisen hakemistoluvun aikana tullut keskeytys estää uuden poistokutsun.
Epävarma poistuminen, vieras sisältö tai siivousvirhe säilyttää aineiston
ja estää onnistumisen. Ensimmäinen prosessisyy ja siivoustulos ovat erilliset.

Lopullinen kohdesarja läpäisi desktopissa 228 testiä kahdeksassa tiedostossa.
Backendin erillinen kohdesarja läpäisi 64 testiä kolmessa tiedostossa;
yksi ennestään alustakohtainen ohitus ei ole läpäisy. Tyyppitarkistus ja
desktop/backend-käännökset läpäisivät. Riippumaton rajattu katselmus löysi
keskeytysaukon; korjattu kohta ja sen täsmällinen regressio tarkistettiin
uudelleen ilman jäljelle jäävää löydöstä tässä rajauksessa.

Seitsemän synteettistä tapausta todensi lopullisen koodin todellisessa
tarkistusprosessissa: nykyinen ketju, eksplisiittinen historiallinen prefix,
038-palautus ja tarkoitukselliset hylkäykset pysyivät erillään. Neljä lähdettä
muodostettiin nykyisellä oikealla WAL-muodostajalla. Hyväksyttävät syötteet
siirrettiin hallitusti vain ilmoitetuista loogisista tiedostoista itsenäisiin
juuriin; vanhan muodostajan sivutiedostoja sisältävä juuri hylättiin edelleen.
Tämä koe todentaa mainin kopio-/varauskytkennän, native-exitin ja siivouksen,
ei tuotannon muodostajavaiheen eristystä tai Store-/restore-vaihtoa.
Linux, koko käynnistys, hardened-palautus ja PR/main-portit jäävät avoimiksi.

<a id="m1-source-preparation-l3703"></a>

#### V2ad: Palautuspisteen tallennuksen native-kytkentä

**Store-kuluttaja kohdetodennettu; durable-palautus avoinna.** Oikea main-
composition antaa `RecoveryPointStore`-tallennukselle nykyisen
`ProfileSnapshotInspectionClient`-portin. Salatun palautuspisteen purku ja
itsevalidointi vaativat pakollisen operaation seurannan, kuittaukseen sidotun
tiedostokäytön ja omistetun siivouksen. Valinnainen settlement-kuittaus ja
suora staging-poisto eivät enää anna native-tarkistuksen poistolupaa.
Lähdesnapshotin oma varaus säilyy sisäkkäisen itsevalidoinnin yli; tarkistin
käyttää toisen operaation riippumatonta juurta eikä siirrä lähteen varausta.

Tarkistuksen ensivirhe säilyy erillään epävarmasta siivouksesta. Epävarma
siivous jättää stagingin, salatun palautuspisteen ja avainkuoren selvitystä
varten; pistettä ei merkitä `validatedGood`-tilaan. Todennettu hylkäys
siivoaa vain omistajan portin kautta. Tavallinen onnistuminen poistaa
itsevalidoinnin stagingin kerran. `stageForRestore` jättää onnistuneen
materialisoinnin varauksen jatkavalle palautusomistajalle; sisältöristiriidan
poisto käyttää samaa omistettua porttia. Formaatit, historiakäytännöt,
nykyiset resurssirajat ja business-ajuri säilyvät.

Kohderegressiot läpäisivät 100 testiä viidessä tiedostossa; tyyppitarkistus
ja desktop-käännös läpäisivät. Riippumaton rajattu lähdekatselmus ei löytänyt
uutta korjattavaa tässä kytkennässä. Todellisen Electron-/native-ketjun
neljä synteettistä tapausta todensivat tavallisen ja päivitystä edeltävän
pisteen itsevalidoinnin, historiallisen prefixin, schema-hylkäyksen ja
nykyisen sekä historiallisen palautuspisteen omistetun purun. Raskaita
broker-tarkistuksia ei kutsuttu; kaikki odotetut prosessit poistuivat.
Kokeen lähdemuodostaja, kontekstinlukija ja avainsuojaus olivat hallittuja.
Näyttö ei todista koko käynnistystä tai `safeStorage`-toimitusta.

Vanhan muodostajan eristämätön tarkistus ja vanhat durable-aktivoinnit
eivät vielä ole vaihdettuja. Erityisesti C:n offline-palautus tarvitsee oman
luotetun kontekstin ja varauksen; elävä broker ei korvaa runtime-absence-
tai cold-recovery-valtuutta. Pysyvä kirjoitussuoja, journal-handoff,
Linux, hardened-palautus, koko K:n katselmus sekä PR/main-portit vaaditaan.

<a id="m1-source-preparation-l3739"></a>

#### V2ae: Odottavan palautusstagingin native-omistajuus

**Valmistelukuluttajat kohdetodennettu; aktivointi avoinna.** Portable-
palautuksen `ProfileRestoreStagingService` ja palautuspisteen
`RecoveryPointRestoreStagingService` käyttävät pakollista mainin native-porttia.
Tarkistus ja valmistelu kuuluvat nykyiseen operaation seurantaan. Valmisteltu
metadata julkaistaan vasta kuittaukseen sidotun tiedostokäytön viimeisen
omistajuustarkistuksen jälkeen. Odottava aineisto pysyy varattuna; V2ab:n
claim estää kilpailevan aktivoinnin ja peruutuksen.

Tavallinen portable-peruutus käyttää vain omistettua poistopolkua.
Epävarma siivous säilyttää tavut, estää uuden valmistelun ja claimin eikä
tarjoa epävarmaa metadataa aktivoitavaksi. Ensisyy säilyy erillään
siivousvirheestä. Peruutuksen hylkäys kulkee olemassa olevan
`restore.stagingFailed`-tapahtuman kautta; epävarma sivuvaikutus merkitään
`unknown`-tilaksi ja uudelleenyritys estetään. Uutta loggeria tai
tapahtumaformaattia ei lisätty.

Lopullinen kohdesarja läpäisi 151 testiä kahdeksassa tiedostossa; koko
työpuun tyyppitarkistus ja desktop-käännös läpäisivät. Riippumaton rajattu
lähdekatselmus ja viimeisen lisäyksen erillinen tarkistus eivät löytäneet
korjattavaa. Todellisen Electron-/native-ketjun neljä synteettistä tapausta
todensivat portable-tarkistuksen, odottavan varauksen, estetyn ja tavallisen
peruutuksen sekä nykyisen ja historiallisen palautuspisteen valmistelun.
Prosessit poistuivat ja lähdetavut säilyivät. Viimeistelyn ensimmäinen
prosessikoe hylkäsi vanhentuneen tapahtumaodotuksen; korjattu koe vaatii
nyt myös estetyn peruutuksen täsmällisen syy- ja tilatiedon. Tuotantotavut
ja aikarajat eivät muuttuneet kokeen korjauksessa.

Lähdemuodostaja, kontekstinlukija, avainsuojaus ja portable-polun
pre-restore-callback olivat kokeessa hallittuja. Todennus ei kata journalin
omistajuushandoffia, pysyvää kirjoitussuojaa, offline/cold-palautusta,
koko käynnistystä, Linuxia, `safeStorage`-toimitusta tai hardened-palautusta.
Nämä sekä koko K:n katselmus ja PR/main-portit ovat edelleen avoinna.
Palautuksen kirjoitussuojan suljettu virhepolku hyväksyttiin myöhemmin
[V2ai:ssa](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3907); tämä valmistelun
kohdenäyttö ei vielä todista sitä. Välitilaa ei julkaista.

<a id="m1-source-preparation-l3777"></a>

#### V2af: Tarkistusajurin alustakohtainen todennus

**Ajuri ja resurssi kohdetodennettu; koko toimitus avoinna.** Hyväksytyn
tarkistusajurin tuotantokäännös läpäisi Windowsissa ja Linuxissa. Kääntäjän
sisäisen tiedostoaliaksen vuoksi käännöstoimitus tekee nyt erillisen
varmennetun kopion ennen latausta ja toimitusta. Vain käännöksen oman
täsmällisen kahden nimen pari voidaan hyväksyä välituotteena; tuntematon
lisälinkki, väärä identiteetti ja linkitetty hakemisto hylätään. Kopion pitää
olla yksilinkkinen, eri tiedostoidentiteettiä ja samoja varmennettuja tavuja.
Toimitettavan resurssin tyyppi-, koko-, hash- ja linkkirajat eivät löysene.

Samat 14 käännössopimustestiä läpäisivät kummallakin alustalla ilman
ohituksia. Riippumaton rajattu lähdekatselmus ei löytänyt korjattavaa.
Linuxin Node-prosessit sekä Windowsin Node- ja Electron-utility-prosessit
läpäisivät kukin seitsemän synteettistä ajuritapausta: nykyinen rakenne,
historiallinen prefix metadataa käyttäen ja ilman sitä, pitkä resurssipolku
sekä puuttuvan, muutetun ja väärän alustan ajurin hylkäys. Varsinainen
SQLite-muistirajan ylitys torjuttiin; tavallinen kysely läpäisi sen jälkeen.
Readonly säilyi, kaikki havaitut native-yhteydet sulkeutuivat, prosessit
poistuivat ja oletusajurin normaali luku/kirjoitus sekä tavut säilyivät.
Alustojen lähde- ja patch-identiteetit sekä SQLite-lähdetunniste täsmäsivät;
eri alustojen binääritavujen tai kääntäjäasetusten samuutta ei väitetä.

Resurssin riippumaton toimitus ja kohdesidonta läpäisivät kummallakin
alustalla seitsemän kontrollia. Linuxissa käytettiin nykyistä backendin
resurssiporttia, ei Windowsille tarkoitettua paketointivarmenninta.
Synteettinen resurssiasettelu ei ole koko sovelluksen paketointihyväksyntä.
Ensihylkäykset säilyvät erillisinä myöhemmästä korjatusta kohdenäytöstä.

Tämä ei sulje Linuxin Electron/runtime- ja CI-toimitusta, varausluovutusta,
durable-aktivointia, pysyvää kirjoitussuojaa, offline/cold-valtuutta,
muodostajan eristystä, hardened-palautusta tai PR/main-portteja. Ajuri-,
tietomalli- ja backup-versiot sekä nykyiset resurssirajat säilyvät.
Välitilaa ei julkaista; V2ae:n avoin kirjoitussuojapäätös säilyy.

<a id="m1-source-preparation-l3812"></a>

#### V2ag: Snapshot-muodostajan eristetty tarkistusketju

**Oikean muodostajan kohdenäyttö hyväksytty; koko K avoinna.**
`SqliteProfileSnapshotService` muodostaa nyt suljetut snapshot-tavut
nykyisellä SQLite backup -API:lla avaamatta kopiota uudelleen business-
backendin SQLite-tarkistukseen. Muodostajan tiedosto-, koko-, hash-,
peruutus- ja maintenance-rajat säilyvät. Muodostuksen tulos ei ole
hyväksyntäkuittaus: portable-varmuuskopio ja palautuspisteen muodostus
vaativat edelleen native-validoinnin ja samoihin tavuihin sidotun
kuittauksen ennen salausta ja julkaisua. Schema/history-, integrity-,
foreign-key- ja katalogitarkistukset ovat eristetyn tarkistimen vastuulla.
Migraatiokäytäntöä ei poisteta tarkistusportista tai aktiivisesta runtimesta.

Muodostajan, nykyisten kuluttajien ja tarkistimien 213 kohdetestiä
läpäisivät 12 testitiedostossa. Yksi ennestään Windowsissa ohitettu
POSIX-symbolilinkkitesti ei ole läpäisy. Backendin ja E2E:n kokonaiset
tyyppitarkistukset sekä backend-build läpäisivät. Poistetun tarkistuksen
kutsumisen todentanut ensihylkäys säilyy erillisenä myöhemmästä
korjausnäytöstä. Riippumaton rajattu lähdekatselmus ei löytänyt korjattavaa.

Oikean Electron-mainin ja utilityn kahdeksan kontrollia läpäisivät.
Viisi tapausta käytti todellista nykyisestä tai historiallisesta WAL-
työtilasta muodostettua snapshotia ilman hallittua loogisten tiedostojen
siirtoa. Nykyinen tiukka käytäntö, hyväksytty historiallinen prefix ja
eksplisiittinen legacy-restore säilyivät erillisinä. Väärä käytäntö,
muutettu schema ja tuntematon sivutiedosto hylättiin; alkuperäiset tavut
ja tuntematon aineisto säilyivät. Todellinen native-exit, varauksen palautus
ja mainin oman tarkistuskopion siivous todennettiin. Koe ei käytä koko
sovelluksen käynnistystä tai paketoidun palautuksen hyväksyntäketjua.

Tämä sulkee muodostajan eristämättömän kopiotarkistuksen nimetyn puutteen,
ei durable-aktivointia, pysyvää kirjoitussuojaa, offline/cold-valtuutta,
vanhan raskaan brokerin kaikkien kuluttajien vaihtoa, Linuxin koko runtime-/
CI-toimitusta, hardened-palautusta tai PR/main-portteja. V2ae:n avoin
kirjoitussuojapäätös ja nykyiset resurssi- sekä yhteensopivuusrajat säilyvät.
Välitilaa ei julkaista.

<a id="m1-source-preparation-l3849"></a>

#### V2ah: Electron-testiruntimen tarkistusajuritoimitus

**Rajattu toimitus- ja kuluttajakorjaus; koko K avoinna.** Kanoninen
Electron-valmistelu muodostaa backendin ja tarkistusajurin tuoreisiin
toimituskansioihin paketoinnin samalla rajatulla ajuriportilla.
Puuttuva kääntäjä tai epäonnistunut käännös hylkää valmistelun;
vanhaa ajuria ei käytetä fallbackina. Testiruntime saa itsenäiset
ajuri-/metadatatavut sekä runnerin mainin todelliseen `dist/runtime`-
käynnistyspaikkaan. Resurssihakemiston toinen runner-kopio ei yksin riitä.
Windows-only-Electron-, T3- ja resurssirajat säilyvät.

Todellinen PDF-muodostaja nimeää tiedoston dokumentti-identiteetistä.
Kuittivertailun aiempi oletus nimen yhtäsuuruudesta PDF:n sisältötiivisteen
kanssa hylkäsi ehjän snapshotin. Yksityinen tarkistusreceipt sitoo nyt
validoidun artifact-joukon täsmälliset loogiset polut, koot ja todelliset
SHA-256:t kanoniseksi sisältöidentiteetiksi. Utility ja main käyttävät
samaa protokollan omistavaa laskentaa; backend saa sen kiinteän utilityn
sisäisenä funktiona, ei sovellusten välisenä lähdeimporttina. Tarkistus
käyttää samaa yhtä tietokanta-avausta. Tiedostojen vaihto tai uudelleennimeäminen
hylätään edelleen. Tietomalli, tallennusnimet, containerit ja historiallinen
backup-yhteensopivuus eivät muutu, eikä receipt laajene julkiseen HTTP:hen,
rendererille tai diagnostiikkaan.

Sisältösidonnan ja nykyisten desktop-kuluttajien sarja läpäisi 329 testiä
15 tiedostossa; backendin 53 testiä läpäisivät kahdessa tiedostossa ja yksi
ennestään Windowsissa ohitettu POSIX-testi ei ole läpäisy. Valmistelun ja
komentokytkentöjen 108 Node-sopimustestiä sekä backendin, desktopin ja E2E:n
kokonaiset tyyppitarkistukset läpäisivät. Todellinen PDF-stager todensi
tallennusnimen yhteensopivuuden erillään utilityn varsinaisesta kytkennästä.
Nämä sarjat eivät ole keskenään yhteen laskettavia kattavuusmääriä.

Käyttäjäpolkujen ensihylkäykset erottivat puuttuvan runnerin, väärän
PDF-kuittioletuksen ja preRestorea edeltävän liian aikaisen sulun.
Workspace-korvauksen kirjoitusquiesce pysäyttää ajastimen, mutta sen pitää
säilyttää tarkistusportti turvapalautuspisteen luontiin asti. Portti suljetaan
jo olemassa olevassa lopullisessa capability-disposalissa; tavallinen
shutdown sulkee uuden työn pääsyn edelleen synkronisesti. Tuotantokytkennän
uusi regressio hylkäsi korjausta edeltävän sulkujärjestyksen. Korjauksen
jälkeiset 130 kohdetestiä kuudessa tiedostossa, desktopin tyyppitarkistus ja
tuore kanoninen valmistelu läpäisivät. Kirjoitusten quiesce, maintenance-lease,
native-omistajuus ja puhtaan sammutuksen ehdot eivät kevene.

Korjatun toteutuksen kolme Windows-Electron-käyttäjäpolkua läpäisivät
yhden nimetyn kohdeajon ilman uusintaa. Tuonti-/korvaushylkäys todensi
alkuperäisen schema-syyn säilymisen todellisessa operational-, Diagnostics-
ja tarkistetussa tukipakettiketjussa sekä muuttumattoman yritysdatan ja
hallitun restartin. Korvaus loi ensin oikean turvapalautuspisteen PDF:ineen.
Native-vahvistuksen peruutus todensi oikean dialogin ja nollan lisävirheikkunaa;
se päättyy ennen korvauksen tarkistusutilitya eikä todista sen käyttöä.
Lähde-, build- ja ajuritavut säilyivät samoina kokeessa. Riippumattomat
rajatut lähdekatselmukset eivät löytäneet korjattavaa. Ensihylkäykset
säilyvät erillisinä eivätkä muutu myöhemmän läpäisyn perusteella onnistuneiksi.

Durable-aktivointi, palautuksen pysyvän kirjoitussuojan toteutus, offline/cold-
valtuus, vanhan raskaan brokerin poisto, koko Linux-runtime/CI,
hardened backup -> inspect -> restore -> restart -> compare ja PR/main-portit
ovat edelleen avoinna. Tätä välitilaa ei julkaista eikä K:ta suljeta.

<a id="m1-source-preparation-l3907"></a>

#### V2ai: Palautuksen suljettu kirjoitussuoja

**Omistajan päätös hyväksytty; tilakone ja broker kohdetodennettu. Aktivoinnin
ja offline/cold-polun kytkentä on kesken.** Palautuksen
kymmenen minuutin suoja-ajan päättyminen, yksityisen hallintayhteyden
katkeaminen tai epävarma palautusjournal pysäyttää jatkamisen ja säilyttää
business-kirjoitusten eston hallittuun uudelleenkäynnistykseen sekä
turvalliseen palautumistarkistukseen asti. Tiedostot ja journal säilytetään.
Uudelleenkäynnistys ei yksin hyväksy ratkaisemattoman tilan avaamista.
Onnistuminen tai ennen pysyviä muutoksia todennettu turvallinen peruutus
saa vapauttaa edelleen voimassa olevan suojan normaalisti. Tavallisen
backupin vapautus, formaatit, riippuvuudet ja nykyiset aikarajat säilyvät.

Ensimmäinen toteutuspala täydentää nykyistä `ProfileMaintenanceState`a
palautuksen omistajuudella ja tiukkaa yksityistä snapshot-brokeria nimetyillä
begin/assert/end/invalidate-operaatioilla. Väärä omistaja tai tavallinen
end/force-end ei vapauta palautusta. Odottavan vastauksen on tarkistettava
sama suojan omistaja ennen kuittausta. Tiukasti validoitu exact-owner-
mitätöinti käsitellään odottavasta työjonosta riippumatta; muut operaatiot
säilyvät sarjajonossa. Protokollaversio erottaa uuden
sopimuksen vanhasta; julkinen HTTP, preload ja renderer eivät saa uusia
operaatioita. Journalin turvallisuuden todistaminen kuuluu mainin
nykyiselle palautusomistajalle, ei backendin arvaamalle journalitilalle.

Kohderegressiot vaativat turvallisen vapautuksen, väärän omistajan,
drain-virheen, monotonic-expiryn ilman ajastimen callbackia, yhteyskatkon,
epävarmuuden lukituksen sekä myöhäisen kuittauksen hylkäyksen. Sama
tilakone ja todellinen yksityinen kanava on todennettava yhdessä. Sen
jälkeen durable-aktivoinnin ja offline/cold-palautuksen kytkentä käyttää
samaa sopimusta. Pelkkä tilakoneen tai brokerin läpäisy ei hyväksy näitä
kutsujia, hardened-palautusta tai koko K:n PR/main-portteja.

Tilakoneen 22 ja broker-sopimuksen 58 kohdetestiä, nykyiset tyyppitarkistukset
sekä backend-/desktop-käännökset läpäisivät. Rajattu katselmus löysi jonossa
viivästyvän mitätöinnin, joka toistettiin asiakkaan kautta ennen korjausta;
sen regressiot ja uusintakatselmus läpäisivät. Oikea tilakone ja Electronin
yksityinen viestikanava läpäisivät korjatulla toteutuksella yhdeksän
kontrollia, myös mitätöinnin kirjoituksen drainin ja kontekstikyselyn aikana.
Tämä ei ole backend-utilityn pysäytyksen, journal-handoffin, Linuxin tai
paketoidun palautuksen hyväksyntä. Alkuperäiset epäonnistumiset säilyvät.

Seuraava kytkentä koskee molempia nykyisiä durable-palautuskuluttajia:
valmisteltu native-slot tarkistetaan suojatun restore-omistajan alla,
journalin pysyvyys luetaan takaisin ja snapshotin omistajuus luovutetaan
ennen koko tarkistusasiakkaan sulkua. Sulku ei saa odottaa omaa kuluttajaansa
tai poistaa journalin omistamaa aineistoa. Backendin saman restore-omistajan
nimetty pysäytyspohja on todennettu alla V2aj:ssa; aktivointikuluttajan on
käytettävä sitä nykyisellä todellisella exit- ja varauksen palautumistodisteella.
Offline-vaiheen sekä cold-recoveryn valtuus
ja journal-sidonta todistetaan erikseen ennen vanhan raskaan polun poistoa.
Tämä on hyväksytyn K-kytkennän vaiheistus, ei uusi prosessienhallintakehys.

<a id="m1-source-preparation-l3959"></a>

#### V2aj: Palautuksen nimetty backend-pysäytys

**Nimetty pysäytyspohja kohdetodennettu; ei aktivoinnin tai palautuksen
hyväksyntää.** Nykyisessä backend-command-sopimuksessa on exact-operation-`shutdownForRestore`
ja lähettäjän `stopForRestore()`. Backend vaatii valmistuneen käynnistyksen
sekä saman restore-suojan ennen ja jälkeen odottavan palvelinsulun. Ensimmäinen
sulun tarkoitus säilyy; eri operation tai update/restore-ristiriita ei saa
tuottaa onnistumista. Kaikki omistetut broker-sulut yritetään virheessäkin.
Main vaatii nykyisen todellisen graceful-exitin ja varauksen palautuksen;
kolmen sekunnin strict-raja sekä ordinary/update-käyttäytyminen säilyvät.

Kohdenäyttö kattaa viestiparserin, runnerin suojan menetyksen sulun aikana,
ristiriitaiset seuraajat ja lähettäjän exit-/reservation-rajat. Oikean
utility-prosessin, oikean business-palvelimen, brokerin ja main-varauksen
ketju läpäisi kuusi synteettistä kontrollia: suojattu palautussulku,
puuttuva suoja, väärä omistaja, mitätöity suoja sekä ordinary/update-verrokit.
Jokaisessa todettiin prosessin exit ja varauksen takaisinotto; virhe-exit
ei muuttunut graceful-hyväksynnäksi. Tämä on development-prosessinäyttö,
ei durable-aktivoinnin tai paketoidun palautuksen hyväksyntä.

Rajattu katselmus ei löytänyt tuotantoregressiota, mutta löysi seuraajien
hyväksynnän rajatestiaukon. Täydennetty testiketju läpäisi: voimassa oleva
suoja hyväksyy saman restore-pyynnön ja ordinary-seuraajan; ristiriita
pysyy hylkäyksenä myöhempien hyväksyttyjen seuraajien yli. Viisi kohdetiedostoa
ja 207 testiä läpäisivät. Laajennus havaitsi myös composition-fixturen
puuttuvan toimitusmetadatan ennen backend-käynnistystä. Puute toistettiin
nykyisellä startup-observerilla ja korjattiin vain synteettiseen fixtureen.
Ensimmäiset epäonnistumiset säilyvät erillään korjauksen näytöstä.

Electronin synteettinen testibackend hylkää sekä update- että restore-
pysäytyksen: se ei voi todistaa tuotannon maintenance-suojaa. Sen yhdeksän
kohdetestiä ja backendin, desktopin sekä E2E:n tyyppitarkistukset läpäisivät.
Tavallinen testisammutus säilyy, eikä sen läpäisy korvaa suojatun sulun näyttöä.

Kylmäkäynnistyksen migraatioportin oma pysäytys ei muutu valmiin
business-backendin pysäytykseksi. Native-slotin receipt-, claim- ja journal-
handoff on seuraava erillinen kytkentä; koko K:n portit säilyvät avoinna.

**Seuraavan kytkennän lähderaja:** sekä tavallinen profile-aktivointi että
päivityksen palautuspisteaktivointi käyttävät samaa activation-palvelua,
mutta niiden pysäytysvaltuudet ovat erilliset. Migraatioportissa snapshot-
palvelu on rekisteröity, vaikka business-backend ei ole vielä ready.
Se mahdollistaa valmistelun nykyisen startup-omistajan alla; valmiille
backendille tarkoitettua `stopForRestore()`-hyväksyntää ei saa käyttää
startup-stopin korvikkeena. Journalin `prepared`-readback ja native-slotin
luovutus on tehtävä ennen inspectorin globaalia sulkua kummassakin
kuluttajassa. Journalin epävarmuus säilyttää sekä staging-claimin että
tarkistusasiakkaan aineiston; pelkkä claim ei vielä estä jälkimmäisen
automaattista cleanupia. Alla oleva V2ak todentaa tämän live-kytkennän;
offline/cold-portit säilyvät avoimina. Journaliformaatti ei muutu.

<a id="m1-source-preparation-l4010"></a>

#### V2ak: Native-stagingin durable-handoff

**Live-kuluttajat kohdetodennettu; ei koko palautuksen tai K:n hyväksyntää.**
Molemmat `ProfileRestoreActivationService`-kuluttajat käyttävät rajattua
restore-inspection-porttia, eivät business-backendin raskasta tarkistusta.
Yksi native-valmistelu tarkistaa ja materialisoi saman operaation tavut
exact-operation-restore-suojan alla. Valmistelun turvallinen validointitulos
ja tarkistajan receipt-sidonta eivät anna offline- tai cold-valtuutta.

Tarkistajan poistamisen esto asetetaan ennen mahdollista journal-kirjoitusta.
Sekä kuittauksen että kirjoitusvirheen jälkeen luetaan täsmällinen
`prepared`/`notPrepared`-tila. Vain hylätyn kirjoituksen todennettu
`notPrepared` sekä tuore restore-, main- ja native-varausvaltuus sallivat
säilytysesteen peruutuksen. Suojan vapautuksen kuittaus ja sitä seuraava
tuore omistajuustarkistus kuuluvat samaan seurattuun peruutukseen; poistoeste
purkautuu vasta koko peruutuksen onnistuttua. Shutdown odottaa tätä nykyisellä
rajatulla drainilla eikä voi väliin poistaa tiedostoja. Onnistumiskuittaus ilman `prepared`-todistetta,
ristiriitainen journal, lukuvirhe tai epävarma varaus säilyttää claimin ja
aineiston sekä mitätöi palautusvaltuuden. Alkuperäinen virhe säilyy ennen
readback-/peruutusvirhettä; yleinen UI-virhe ei korvaa turvallista syyketjua.

Varmistetussa handoffissa native-varaus vapautetaan tiedostoja poistamatta
ennen tarkistajan globaalia sulkua. Sulku vapauttaa myös epävarman journalin
säilytetyn, mutta todistetusti päättyneen tarkistuksen varauksen poistamatta
sen tiedostoja. Epävarma prosessi tai siivous säilyttää molemmat. Säilytettyä
operaatiota ei saa tarkistaa uudelleen, käyttää tavallisena backup-lähteenä
tai poistaa. Aktivointia ei lisätä tarkistajan omaan drain-odotukseen.
Tavallisen backupin siivous- ja vapautussääntö säilyy.

Valmis backend pysäytetään `stopForRestore(operationId)`-portilla.
Migraatiokutsujassa käytetään edelleen juuri sen pending-startupin
`stopStartupRuntime()`-valtuutta, ei ready-only-porttia. Tiedostosiirto
alkaa vasta omistetun backendin todellisen poistumisen ja varauksen
palautumisen jälkeen. Molemmat oikean Electron-utilityn, native-ajurin,
brokerin ja durable-journalin kontrollit läpäisivät; staged DB:n tavut
säilyivät varauksen luovutuksessa ja täsmäsivät aktivoituun tiedostoon.
Lähde ja build pysyivät muuttumattomina kokeen aikana.

Ensiregressio toisti vanhan sulun poistavan journalille kuuluvan tiedoston.
Korjattu sama testi sekä rajatut journal-, omistajuus-, sulku- ja composition-
testit läpäisivät. Kattavuus sisältää kirjoituskuittauksen epävarmuuden,
hylätyn mutta sitoutuneen kirjoituksen, suojan menetyksen, failed cleanupin
sekä sulun journal-kirjoituksen ja varauksen vapautuksen aikana. Katselmuksen
löytämä peruutuksen liian aikainen poistoesteen purku toistettiin ennen
korjausta. Korjauksen jälkeinen riippumaton lähdekatselmus ei löytänyt siitä
jäljelle jäävää puutetta; yhdistetyt seitsemän kohdetiedostoa ja 277 testiä,
backendin/desktopin/E2E:n tyyppitarkistukset ja backendin/desktopin buildit
läpäisivät. Molempien todellisten kuluttajien prosessikoe todennettiin myös
tämän korjauksen jälkeen. Kohdesarjoja ei summata päällekkäisenä kattavuutena.
Kylmäpalautus, koko käynnistyshyväksyntä, vanhan raskaan polun poisto,
Linux-runtime/CI, nyky-/038-paketin hardened-palautus ja PR/main-portit
säilyvät avoimina. Tämä ei muuta journalin tai backupin formaattia,
riippuvuuksia, tietomallia tai aikarajoja.

<a id="m1-source-preparation-l4064"></a>

#### V2al: Kylmäpalautuksen vaihekohtainen tiedostotarkistus

**Forward-polun tiedostopaikat kohdetodennettu; cold-valtuus ja eristetty
sisältötodiste vielä avoinna.** Nykyinen activation transaction tarkistaa
ennen startupin forward-jatkoa saman journalin operationin, revision,
vaiheen ja alkuperäisten slottien läsnäololiput. Vaiheiden järjestys tulee
samasta journalin omistavasta määrittelystä kuin tiedostosiirroissa.
Valmistuneen vaiheen ohittaminen ei korvaa sen tiedostojen tarkistusta.

Tietokannan ja PDF-kansion active-, staging- ja rollback-slotit vastaavat
journalin vaihetta erikseen. Siirron intent-vaihe hyväksyy täsmälleen yhden
lähde- tai kohdeslotin myös keskeytyksessä juuri renamen jälkeen. Tyhjä
alkuperäinen slotti ei oikeuta ylimääräistä rollback- tai active-sisältöä.
Tiedostotyypit, linkit ja canonical-polut tarkistetaan; puuttuvan slotin
ensimmäinen olemassa oleva vanhempi tarkistetaan ennen mahdollista mkdir-
tai chmod-toimea. Failed-rootin epävarma aineisto estää forward-jatkon.

Startup ottaa journalista muuttumattoman kopion. Tarkistuksen molemmat
readbackit ja forward-jatkon ensimmäinen journal-luku vaativat samat
kentät. Puuttuva, muuttunut tai lukukelvoton jatko-journal ei valtuuta
uuden operationin omaksumista tai automaattista rollbackia. Tarkistusvirhe
säilyttää tiedostot ja journalin sekä ensisyyn nykyisessä virheketjussa.
Nykyinen turvallinen `restore.recoveryRequired`-tapahtuma
kertoo selvitystarpeesta eikä julkaise raakaa poikkeusta.
Tämä ei lisää uutta lokitus- tai prosessienhallintakerrosta.

Ensiregressiot toistivat puuttuvan valmistuneen tietokanta-/PDF-slotin sekä
journalin vaihdon ja puuttuvan slotin linkitetyn vanhemman. Korjauksen
jälkeinen 12 kohdetiedoston ja 368 testin sarja sekä backendin, desktopin
ja E2E:n tyyppitarkistukset läpäisivät. Sarja sisältää oikeat synteettiset
tiedostot kaikissa forward-vaiheissa, alkuperäisten slottien yhdistelmät,
siirtokeskeytykset, journalin vaihtumisen sekä nykyiset startup-, yrityksen
korvaus- ja live-handoff-verrokit. Backendin ja desktopin buildit läpäisivät.
Rajattu riippumaton loppukatselmus ei löytänyt korjausten jälkeen jäljelle
jäävää puutetta tämän portin lähteestä ja testiapureista. Katselmus ei
hyväksy koko kylmäpalautusta tai K:ta. Testisarjoja ei summata päällekkäin.

Tiedostopaikkojen census ei ole schema-, sisältö-, lineage- tai receipt-
todiste eikä osoita aiemman tarkistusprosessin poissaoloa. Seuraava K-työ
kytkee tuoreen main-/operaatio-omistajuuden ja bounded-native-tarkistuksen
täsmällisiin vaihekohtaisiin lähdetavuihin ennen mutaatiota. `accepted`,
rollback ja niiden cleanup vaativat omat nykyiset valtuutensa; niille ei
anneta forward-valtuutta tämän tarkistuksen perusteella. C offline,
koko startup, raskaan polun poisto, Linux-runtime/CI, hardened nyky-/038-
palautus ja PR/main-portit säilyvät avoimina. Journalin ja backupin formaatti,
riippuvuudet, business-säännöt ja aikarajat eivät muutu.

<a id="m1-source-preparation-l4111"></a>

#### V2am: Kylmäpalautuksen muuttamaton journal-valinta

**Alkuvalinta kohdetodennettu; ei vielä korjaus- tai sisältövaltuutta.**
Activation-journalin `peek()` ja korjaava `read()` käyttävät samaa
laiskaa nykyinen -> backup -> next -prioriteettia. Valitun slotin
virhe estää valinnan; alempaa slottia ei käytetä virheen kiertämiseen.
`peek()` palauttaa muuttumattoman journal-arvon eikä nimeä, poista tai
kirjoita tiedostoja. Nykyisen `read()`-polun korjausjärjestys säilyy.

Startup käyttää muuttamatonta valintaa sekä profile-palautuksen että
yrityksen korvauksen journalille. Päivitysjournalin erillinen politiikka
ei muutu. Valinta ei ota operaatiovarausta eikä todista aiemman prosessin
poissaoloa, sisältöä tai journalin säilymistä myöhemmän odotuksen yli.
Korjaava luku ja mutaatiot tarvitsevat edelleen tuoreen omistajuuden ja
saman journalin readbackin; aiempi muistissa ollut receipt ei anna niitä.

Journal-storen testit tarkistavat valinnan prioriteetin, hylkäykset,
muuttumattomat tiedostot ja vanhan korjauspolun. Todellisen compositionin
kuusi rajattua testiä pysähtyvät ennen palautusvaltuuden ratkaisemista ja
todistavat slotin säilymisen kummallakin restore-polulla kaikista kolmesta
lähtöslotista. Testin alkuperäinen poikkeus säilyy yksityisessä observerissa;
käynnistyksen julkinen virhe säilyy turvallisena.

Yhdistetty 12 kohdetiedoston ja 382 testin sarja, backendin, desktopin ja
E2E:n tyyppitarkistukset sekä backendin ja desktopin buildit läpäisivät.
Rajattu riippumaton lähdekatselmus ei löytänyt valintamuutoksesta
konkreettista ohitusreittiä tai regressiota. Kohdesarjoja ei summata
V2al:n aiempaan määrään. Tämä ei ole native-, packaged-, PR- tai main-
hyväksyntä. Seuraava kytkentä todistaa operaation tuoreen varauksen ennen
korjaavaa lukua sekä vaihekohtaisten tavujen eristetyn tarkistuksen ennen
siirtoja. Terminal-, rollback-, C offline-, Linux-, hardened- ja koko K:n
portit säilyvät avoimina. Formaatti, riippuvuudet ja aikarajat eivät muutu.

<a id="m1-source-preparation-l4144"></a>

#### V2an: Kylmäpalautuksen tuore forward-omistajuus

**Forward-omistajuus kohdetodennettu; sisältö- ja terminal-portit avoinna.**
Kummankin startupin restore-polun forward-jatko ottaa nykyisen yhteisen
installation-leasen ja mainin globaalin omistajuuden lisäksi natiivivarauksen
täsmälliseen olemassa olevaan operaatiokansioon. Puuttuvaa kansiota ei luoda
uudelleen varauksen hankkimiseksi. Muuttumaton journal ja sen kuusi kenttää
tarkistetaan ennen varausta ja uudelleen sen jälkeen. Korjaava luku vaatii
saman journalin sekä tuoreen valtuuden valinnan jälkeen ennen slotin
promootiota tai sivutiedoston poistamista.

Vaihekohtaisen tiedostocensuksen molemmat journal-readbackit ovat
muuttamattomia `peek()`-lukuja. Forward-mutaatiot tarkistavat valtuuden
intent-kirjauksen, hakemiston luonnin, käyttöoikeusmuutoksen ja jokaisen
nykyiseen rajattuun rename-uusintaan kuuluvan siirtoyrityksen yhteydessä.
Valtuusvirhe ei kuulu siirron uusittaviin virheisiin. Nykyiset siirron
odotukset ja aikarajat säilyvät.

Forward-valtuus ei anna rollback-valtuutta. Tällä rajatulla startup-polulla
myös tavallinen siirtovirhe säilyttää alkuperäisen syyn, journalin ja
palautusaineiston sekä pysäyttää jatkon selvitykseen. Vanhan ilman uutta
admissionia toimivan polun käsittely ei muutu. Terminal-vaiheita ei hyväksytä
forward-admissionilla; niiden omistajuus ja cleanup todennetaan erikseen.
Operaatiovaraus säilyy forward-jatkon yli ja suljetaan ennen backendin
käynnistystä. Leasen vapautusta yritetään erikseen myös varauksen
sulkuvirheessä. Ensivirhe ja järjestetyt sulkuvirheet säilyvät erillään;
varmentamaton sulku estää käynnistyksen. Tämä apuri ei poista aineistoa.
Selvitystarve kulkee nykyisen turvallisen `restore.recoveryRequired`-
havainnon kautta, ei uuden loggerin tai raakavirheen julkaisun kautta.

Ensimmäiset viisi hylkäysregressiota sekä riippumattoman katselmuksen kolme
konkreettista löydöstä toistettiin ennen korjausta. Viimeinen 17 kohdetiedoston
ja 486 testin sarja, backendin, desktopin ja E2E:n tyyppitarkistukset sekä
backendin ja desktopin buildit läpäisivät. Sarja kattaa oikean natiivivarauksen
kilpailun ja puuttuvan juuren, molemmat composition-kuluttajat, kaikki
forward-vaiheet, journalin vaihtumisen, mutaatiota edeltävän valtuushylkäyksen,
rename-odotuksen yli kadonneen valtuuden sekä ensivirheen ja sulkujen erottelun.
Rajattu lähteiden uusintakatselmus ei löytänyt jäljelle jäävää konkreettista
puutetta näissä rajoissa. Agentti ei ajanut testejä; yllä oleva näyttö on
erillinen toteutuksen todennus. Kohdesarjoja ei summata aiempiin sarjoihin.

Natiivivaraus sulkee pois saman varausrajapinnan kilpailevan omistajan.
Se ei yksin todista mielivaltaisten vieraiden prosessien poissaoloa eikä
tietokannan tai PDF:ien sisältöä, schemaa tai lineagea. Vaihekohtaisten
lähdetavujen eristetty tarkistus ennen siirtoja, terminal-/rollback-valtuus,
C offline, koko startup, vanhan raskaan polun korvaaminen, Linux-runtime/CI,
hardened nyky-/038-palautus ja PR/main-portit säilyvät avoimina. Tämä ei ole
paketoidun kylmäpalautuksen tai koko K:n hyväksyntä. Journalin ja backupin
formaatti, riippuvuudet, business-säännöt ja aikarajat eivät muutu.

<a id="m1-source-preparation-l4194"></a>

#### V2ao: Kylmäpalautuksen vaihekohtainen sisältöydin

**Sisältöydin kohdetodennettu; prosessi- ja startup-kytkentä avoinna.**
Aktivointitransaktio palauttaa saman muuttumattoman journalin ja strict-
tiedostocensuksen perusteella tietokannan ja dokumenttien lähdeslotit
itsenäisesti. Vanhan `assertForwardRecoveryState()`-portin void-sopimus
säilyy. Pelkkä lähdevalinta ei anna sisältö- tai siirtovaltuutta.

Backendin rajattu `inspectColdRestoreContent`-operaatio johtaa kiinteät
polut valitusta työtila- ja operaatiokansiosta. Se sitoo alkuperäiset tavut,
luo oman riippumattoman tarkistuskopion ja varmentaa scheman sekä historian
yhdestä readonly-yhteydestä ennen identiteetti-, eheys- ja katalogilukuja.
Nykyinen rajattu laskuartifact-adapteri valitsee PDF:t oikeasta lähteestä;
niiden todellinen koko, tiiviste, PDF-alku, polku ja tiedostoidentiteetti
tarkistetaan. Tuntemattomat sivutiedostot tai linkitetty aineisto hylätään
poistamatta alkuperäistä aineistoa. Tiedostokahvat suljetaan erikseen;
ensivirhe säilyy ennen mahdollista sulkuvirhettä.

Kopio sidotaan uudelleen viimeisen valtuusodotuksen jälkeen ennen SQLite-
avausta. Kaikki callerin valtuusodotukset päättyvät ennen viimeistä PDF-
sidontakierrosta. Erillinen cold-receipt sisältää lähdeslotit, tietokannan
tavusidonnan, profiilin, migration-ketjun ja artifact-joukon identiteetin;
se ei väitä puuttuvaa portable-katalogitiedostoa tarkistetuksi. Siirrettävän
backupin nykyinen operaatiomuoto ja receipt säilyvät erillisinä.

Viimeinen backendin seitsemän kohdetiedoston sarja läpäisi 134 testiä;
yksi ennestään alustakohtainen ohitus ei ole läpäisy. Desktopin neljän
slot-/palautustiedoston sarja läpäisi 186 testiä. Backendin, desktopin ja
E2E:n tyyppitarkistukset sekä rajattu riippumaton uusintakatselmus läpäisivät.
Katselmuksen kaksi odotusikkunaa toistettiin ennen tarkistusjärjestyksen
korjausta. Backendin ja desktopin buildit läpäisivät. Kuusi erillistä
native-lapsiprosessikoetta todisti alkuperäisten tietokantatavujen säilymisen
ja varauksen palautumisen vasta todellisen poistumisen jälkeen. Näiden
katalogit olivat tyhjiä: näyttö ei kata PDF:ien native-kytkentää, Electron-
protokollaa tai startup-kuluttajaa. Sarjoja ei summata aiempiin K-vaiheisiin.

Ydin ei vielä ole startupin käyttämä tarkistus. Sen seuraava kytkentä käyttää
nykyistä utility-prosessia ja tarkkaa cold-protokollaa sekä todistaa exitin,
varauksen palautumisen ja tuoreen journal-/census-/sisältö-/lineage-sidonnan
ennen siirtoja. Terminal-, rollback-, C offline-, Linux-, hardened- ja PR/main-
portit sekä koko K säilyvät avoimina. Riippuvuuksia, backup- tai journal-
formaattia, liiketoimintasääntöjä tai aikarajoja ei muutettu.

<a id="m1-source-preparation-l4237"></a>

#### V2ap: Kylmäsisällön nimetty prosessiraja

**Utility-raja kohdetodennettu; startup-kuluttaja on vielä avoin.**
Nykyisen tarkistusprotokollan nimetty `inspectColdRestoreContent`-prepare
sisältää vain valitun työtilajuuren ja itsenäiset database/documents-slotit.
Se ei tarjoa yleistä tiedostopolkua, SQL:ää, komentoa tai executable-valintaa.
Cold-policy on aina `restoreCompatible`. `coldCompleted` on erillinen,
tarkasti parsittu tulos ilman portable-katalogitiedostoa; portable- ja
cold-kuittia ei voi käyttää toistensa onnistumisena. Molemmat lähdeslotit
tarkistetaan jäädytettyä preparea vastaan myös vastaanottajassa.

Runner valitsee vain nimetyn kiinteän backend-moduulin. Cold ja portable
käyttävät samaa nykyistä prepare/grant/work/shutdown/exit/reclaim-ketjua.
Uusi nimetty main-API ei muuta portable-API:n tyypitystä tai kuluttajaa.
Vain cold-receiptin tarkka kenttämäärä poikkeaa; yhteinen viestikoko,
työ-/sulkuajat, heap-raja sekä sisältömäärä-/koko-/hash-rajat säilyvät.
Tulosta ei hyväksytä ennen onnistunutta todellista poistumista ja varauksen
palautumista. Ensimmäinen turvallinen syy säilyy erillään cleanup-tuloksesta.

Yhdeksän kohdetiedoston sarja läpäisi 284 testiä. Desktopin ja E2E:n
tyyppitarkistukset, desktop-build ja rajattu riippumaton katselmus läpäisivät.
Seitsemän oikean utility-prosessin cold-tapausta todisti neljä lähdeparia,
038-historian, schema-hylkäyksen ja poistumisen ilman terminalia.
Alkuperäiset tietokantatavut säilyivät ja varaus palautui vasta poistumisen
jälkeen. Kahdeksan portable-tapauksen utility-regressio läpäisi nykyisen
copy-prepare-sopimuksen mukaisella fixturellä. Fixturen ensimmäinen hylkäys
säilyy erillisenä valmistelupuutteena, ei sovelluksen korjauksena.

Utility-kokeiden katalogit olivat tyhjiä; ne eivät osoita PDF:ien koko native-
ketjua. V2ao:n PDF-kohderegressiot säilyvät eri näyttönä. Prosessikuitti ei ole
siirtovaltuus: startupin täytyy vielä sitoa tuore journal/census, lähdetavut,
luotettu profiililineage ja nykyinen omistajuus ennen mutaatiota. Omistetun
kopion valmistelu ja cleanup kuuluvat edelleen callerille. Terminal-/rollback-,
C offline-, Linux-, hardened- ja PR/main-portit sekä koko K ovat avoimia.
Riippuvuuksia, formaatteja, liiketoimintasääntöjä tai aikarajoja ei muutettu.

<a id="m1-source-preparation-l4273"></a>

#### V2aq: Kylmäsisältöportin omistettu tarkistuskopio

**Cold-kuluttajan orkestrointi kohdetodennettu; startup-siirtovaltuus avoin.**
Nimetty `runProfileRestoreColdInspection` valmistaa oman sukupolvisidonnaisen
kopion nykyisellä reservation-transferilla. Lähdepari parsitaan jäädytetyksi
ennen prosessityötä ja luetaan uudelleen oikean poistumisen, reclaimin ja
kopiosiivoamisen jälkeen. Työtilajuuren tai kumman tahansa slotin muutos
hylkää tuloksen. Cold-receiptiin ei hyväksytä portable-katalogia tai muuta
policya. Luotetun callerin lineage-tarkistus tehdään viimeisen omistajuus-
odotuksen molemmin puolin; main ei avaa SQLitea.

Portable ja cold käyttävät yhtä nykyisestä toteutuksesta erotettua
kopio-/deadline-/exit-/cleanup-orkestrointia, eivät rinnakkaisia valvojia.
Nimetyt prosessi- ja sisältöportit säilyvät erillisinä. Epävarma poistuminen
tai reclaim estää kopion poiston. Cleanup-virhe ei korvaa tunnettua ensisyytä;
allowlistin ulkopuolinen syy säilyy `unknown`-luokkana. Yhteinen työdeadline
ei uusiudu lähdekyselyn, prosessin tai loppuhyväksynnän välillä.

Yhdentoista kohdetiedoston sarja läpäisi 477 testiä. Desktopin ja E2E:n
tyypit, desktop-build ja rajattu riippumaton katselmus läpäisivät. Seitsemän
oikean cold-utility-prosessin tapausta todisti neljä lähdeparia, 038-historian,
schema-hylkäyksen ja poistumisen ilman terminalia sekä caller-owned-kopion
siivouksen. Kahdeksan nykyistä portable-caller-native-tapausta läpäisi samalla
buildilla; nykyiset/historialliset policyt ja alkuperäisen aineiston
säilyttäminen todennettiin. Ensimmäinen kohdeajon hylkäys oli testin oman
lineage-kutsumäärän virhe ja säilyy erillisenä, ei sovellusvikana.

Ensimmäisten native-kokeiden katalogit olivat tyhjiä. Täydentävä kuuden
utility-tapauksen koe käytti kahta synteettistä PDF:ää ja nykyiseen revisio-
malliin oikeilla migraatioilla sidottua katalogia. Kaikki neljä tietokanta-/
PDF-lähdeparia läpäisivät; puuttuva ja muuttunut PDF hylättiin. Tuloskuittiin
tuleva lukumäärä, tavumäärä ja aggregate tarkistettiin tunnetuista fixture-
tavuista. Prosessin todellinen poistuminen, reclaim, kopiosiivoaminen ja
alkuperäisten tietokanta-/PDF-tavujen säilyminen todennettiin myös hylkäyksissä.
PDF-hylkäysten turvallinen syy pysyy nykyisen allowlistin `unknown`-luokkana;
sen perusteella ei väitetä eritellyn perussyyn lukuketjua valmiiksi.

Erillinen kuuden Linux-backend-native-tapauksen koe läpäisi neljä lähdeparia,
038-historian ja schema-hylkäyksen. Oikean lapsiprosessin poistuminen,
varauksen takaisin hankkiminen ja lähdetavujen säilyminen todennettiin.
Tämä Linux-koe käytti tyhjiä katalogeja eikä Electron-utilitya tai koko
startupia; se ei korvaa Linux-runtime/CI- tai hardened-porttia. Nykyinen
tuotantolähde ja build säilyivät muuttumattomina näissä lisäkokeissa.

Lisänäyttö ei todista nykyisen startup-compositionin kytkentää. Lähdeparin yhtäsuuruus
ei todista kaikkien valittujen tavujen säilymistä myöhempien await- ja move-
rajojen yli. Cold-receiptin aggregate ei paljasta mainille auktoritatiivisen
PDF-joukon suhteellisia tiedostopolkuja; main ei saa ratkaista tätä lukemalla
SQLitea tai skannaamalla/korvaamalla koko dokumenttihakemistoa arvaamalla.

**Rajattu jatkopäätös hyväksytty ja kohdetoteutus todennettu V2ar:ssa:**
utilityn oman kertakopiokansion tarkka tiedostosidonta luetaan vasta
exit/reclaim-todistuksen jälkeen nykyisillä katalogi- ja sisältörajoilla.
Tämä V2aq-vaiheen orkestrointinäyttö ei itsessään todista myöhempää
tiedostosidontaa; [V2ar](release-0.3.0-profile-validation-history.md#m1-source-preparation-l4334) omistaa sen
nykyisen sopimuksen ja näytön. Tuore journal,
census, tavut ja lineage ennen jokaista mutaatiota sekä terminal-/rollback-,
C offline-, Linux-, hardened- ja PR/main-portit vaaditaan edelleen. Koko K
on kesken; riippuvuuksia, formaatteja, liiketoimintasääntöjä tai aikarajoja
ei muutettu.

<a id="m1-source-preparation-l4334"></a>

#### V2ar: Valittujen PDF-tiedostojen sidonta

**Hyväksytty tiedostosidonta kohdetodennettu; startup-kytkentä vielä avoin.**
Utility tuottaa schema-, identiteetti-, eheys- ja katalogitarkistuksen
valitsemista PDF:istä jäädytetyn luettelon omaan sukupolvisidonnaiseen
tarkistuskopioon. Kiinteä `cold-document-bindings-v1.json` sisältää vain
formaattiversion sekä loogiset ja suhteelliset tallennuspolut, koot ja
SHA-256:t. Tämä on lyhytikäinen yksityinen prosessitulos, ei backup-katalogi,
uusi backup-formaatti, journal tai business-rivien kopio. SQLite suljetaan
ennen tulostiedoston kirjoitusta, ja alkuperäiset tietokanta-/PDF-tavut
sidotaan vielä uudelleen kirjoituksen jälkeen ennen onnistumiskuittia.

Cold-receiptin tarkka `documentBindings`-kenttä sitoo luettelon todellisen
koon ja SHA-256:n. Mainin nimetty lukija johtaa polun nykyisestä omistetusta
tarkistuskopiosta, ei childin vapaasta polusta. Luku tapahtuu vasta
utility-exitin ja varauksen reclaimin jälkeen, ennen kopiosiivoamista.
Lukija tarkistaa kansio- ja tiedostoidentiteetin, tavut, koon, hashin sekä
luettelon tarkat kentät, turvalliset suhteelliset polut, yksiselitteiset
viitteet ja receiptin lukumäärän/tavumäärän/aggregaten. Tuloksen lista ja
rivit ovat muuttumattomia. Portable-receipt ja sen katalogisopimus säilyvät
erillisinä; vain cold-kopion poisto sallii uuden kiinteän tulostiedoston.

Nykyiset rajat säilyvät: IPC 4 KiB, luettelo 64 MiB, enintään 100 000
dokumenttia, yksi PDF 10 MiB, PDF-joukko 20 GiB, tietokanta 24 GiB,
työdeadline 35 sekuntia, sulkuraja 3 sekuntia ja utility-heap 512 MiB.
Sarjoituksen tavuraja tarkistetaan myös ennen koko JSON-tuloksen muodostusta.
Epäonnistunut tai aikakatkaistu mainin luku/sulku säilyttää tarkistuskopion
ja estää jatkovaltuuden: lapsen poissaolo ei todista mainin keskeneräisen
tiedostokahvan sulkeutumista. Myöhäinen luku ei käynnistä uutta poistoa.
Ensimmäinen syy ja epävarma cleanup pysyvät erillisinä.

`assertProfileRestoreColdSourceBytes` tarkistaa valitut lähdetavut mainissa
avaamatta SQLitea tai skannaamatta koko PDF-hakemistoa. Sama slot-pari,
receipt ja jäädytetty lista ohjaavat rajoitettua kahvalukua; polut,
tiedostoidentiteetit, PDF-alku, koot ja hashit varmennetaan. Lopputarkistus
huomaa myös aiemmin luetun PDF:n muutoksen myöhemmän tietokantaluvun aikana.
Tämä portti ei yksin anna siirtovaltuutta: omistava kuluttaja sitoo lisäksi
tuoreen journalin, censuksen, varauksen ja lineagen ennen jokaista mutaatiota
ja käyttää alkuperäistä yhteistä deadlinea. V2ar:n osanäyttö ei vielä
kytkenyt startup-compositionia; myöhempi [V2as](release-0.3.0-profile-validation-history.md#m1-source-preparation-l4400)
omistaa forward-kuluttajien nykyisen kytkennän.

Lopullinen 13 kohdetiedoston sarja läpäisi 384 testiä. Kaikkien
työtilapakettien tyyppitarkistus sekä backend- ja desktop-buildit läpäisivät.
Rajattu riippumaton katselmus löysi mainin keskeneräisen lukutehtävän
siivousriskin; säilytysehto ja timeout-/myöhäinen vastaus -regressio korjasivat
sen, ja uusintakatselmuksessa ei löytynyt muita raportoitavia puutteita.
Kuusi todellista Windows-utility-tapausta todisti kahden synteettisen PDF:n
luettelon välityksen, lähdetavujen uudelleenvarmennuksen kaikissa neljässä
slot-parissa sekä puuttuvan ja muuttuneen PDF:n hylkäyksen. Seitsemän tyhjän
tai historiallisen cold-tapauksen ja kahdeksan portable-tapauksen native-
regressiot läpäisivät samalla buildilla. Näyttömääriä ei summata aiempiin
K-vaiheisiin; hylkäysten syy pysyy nykyisen allowlistin mukaisena.

Kuusi Linux-backendin native-lapsiprosessitapausta läpäisi samalla
tuotantolähteellä ja buildilla: neljä slot-paria, 038-historia sekä
schema-hylkäys. Todellinen exit, reclaim ja lähdetavujen säilyminen
varmennettiin. Näissä katalogit olivat tyhjiä; tämä ei todista Linuxin
Electron-utilitya, main-calleria, ei-tyhjää PDF-ketjua tai koko startupia.

Koko startup-, terminal-/rollback-, C offline-, Linux-runtime/CI- ja
hardened current/038 backup -> inspect -> restore -> restart -> compare
-portit sekä loppukatselmus ja PR/main-hyväksyntä ovat avoimia. Uusi
riippuvuus, yleinen valvoja, loggeri tai muutos backup-formaattiin,
liiketoimintasääntöihin tai hyväksyntärajoihin ei kuulu tähän osaan.

<a id="m1-source-preparation-l4400"></a>

#### V2as: Startupin tuore sisältövaltuus

**Forward-kytkentä ja rajatut kuluttajakokeet todennettu; koko K on kesken.** Molemmat forward-
startup-kuluttajat käyttävät samaa nimettyä sisältövaltuutta nykyisen
activation transactionin ja operation-varauksen kautta. Ensimmäinen
eristetty tarkistus jäädyttää hyväksytyn sisällön. Census valitsee edelleen
tietokannan ja PDF:ien slotit toisistaan riippumatta. Slotin muuttuessa
nykyinen utility todentaa uuden lähdeparin; sen sisältöidentiteetin ja
valittujen PDF-sidontojen on vastattava ensimmäistä hyväksyttyä sisältöä.
Receiptin slotteja ei kirjoiteta uudelleen. Sama alkuperäinen työdeadline
koskee tarkistuksia ja forward-admissionia; se ei ala uudelleen siirrossa.

Ennen forward-kirjoitusta vaaditaan tuore täsmällinen journal, strict census,
elävä varaus, installation-lease, luotettu lineage ja valittujen tavujen
varmennus. Nykyinen rename-retry käyttää samaa rajaa jokaisella yrityksellä.
Journalin staged kirjoitus ja commit käyttävät vanhaa valtuutettua vaihetta;
onnistuneen commitin jälkeinen siivous käyttää uutta vaihetta. Epävarma
kirjoitus tai omistajuuden menetys ei oikeuta palauttavaan renameen tai
aineiston poistoon. Ensimmäinen syy ja vapautusvirheet säilyvät erillisinä.

Käynnistyskytkennän regressio paljasti kylmätarkistuksen väärän aktiivisen
polkuoletuksen. Sekä utility että main johtavat nyt aktiivisen tietokannan
ja PDF:t työtilan kanonisesta `runtime`-juuresta; staged-polut säilyvät.
Väärään layoutiin ei lisätty fallbackia, eikä runtime- tai backup-layoutia
muutettu. Testit hylkäävät väärin sijoitetun tietokannan. Lopullinen
metadatasidonta tapahtuu vasta awaited journal-/census-/owner-tarkistusten
jälkeen; PDF:n muutos tuossa odotusvälissä hylätään.

Lopullinen kohdesarja läpäisi 873 testiä 38 tiedostossa ilman ohituksia.
Kaikkien työtilapakettien tyyppitarkistus sekä backend- ja desktop-build
läpäisivät. Rajattu riippumaton katselmus ei löytänyt jäljelle jäävää
raportoitavaa puutetta journal-guardista, lopullisesta tavusidonnasta tai
polkukorjauksesta. Neljä todellista native-forward-tapausta käytti nykyisiä
profileRestore- ja workspaceReplacement-kuluttajia sekä nyky- ja 038-aineistoa.
Valittujen tavujen säilyminen, alkuperäinen rollback-aineisto, kolmen
utility-sukupolven exit/reclaim sekä operaatiovarauksen vapautuminen
varmennettiin. Koe päättyi `validationStarting`-rajaan; koko main-composition,
backendin jälkivalidointi, terminal-/rollback ja hardened-paketti eivät ole
tämän kokeen läpäisyjä. Kuusi erillistä native-caller-tapausta todensi myös
kaikki neljä DB/PDF-lähdeparia sekä puuttuvan ja muuttuneen PDF:n hylkäyksen
samalla korjatulla buildilla.

Kuusi Linux-backendin native-regressiota läpäisi korjatulla polkujohdannalla:
neljä lähdeparia, 038-aineisto ja schema-hylkäys. Näissä katalogit olivat
tyhjiä; tulos ei todista Linuxin Electron-utilitya, forward-compositionia,
ei-tyhjää PDF-ketjua tai nykyisen revision CI-portteja.

Todennus kattaa journalin commit-rajan, jokaisen aktivointivaiheen,
legitiimin slot-vaihdon, sisällön muutoksen, lineagen/omistajuuden menetyksen,
yhteisen deadlinen ja ensimmäisen virheen säilymisen. Koko startupin
toimitusnäyttö vaaditaan edelleen rajattujen kuluttajakokeiden lisäksi. Terminal/rollback,
C offline, Linux-runtime/CI, hardened nyky-/038-palautus sekä koko K:n
katselmus ja PR/main-portit pysyvät avoimina. Riippuvuudet, backup-formaatit,
liiketoimintasäännöt ja hyväksyntärajat eivät muutu.

<a id="m1-source-preparation-l4455"></a>

#### V2at: Loppuvaiheen journal-sidonta

**Rajattu jatko kohdetodennettu:** terminaaliin siirtymisen slot-census tarkistetaan
ennen `validationStarting`-hyväksyntää tai forward-vaiheen rollback-intentiä.
Puuttuva alkuperäinen rollback-slot ei saa tehdä uuden aktiivisen sisällön
tavuista vanhaa profiilia. Nykyinen strict-census hylkää myös päällekkäisen
staging-slotin ja odottamattoman failed-aineiston ennen journal-mutaatiota.
Neljä uutta regressiota toisti puutteen ennen korjausta. Tämä ei yksin ratkaise
jo `rollbackStarting`-vaiheessa olevan cold-recoveryn sisältövaltuutta.

**Rajattu työpuukorjaus; koko K:n hyväksyntä on avoinna.** Startupin
hyväksyntä, rollback ja `rolledBack`-siivous käyttävät jäädytettyä valittua
journalia. Transaction tarkistaa saman operaation, vaiheen, revision ja
alkuperäiset slot-liput ennen mutaatioita, rename-retryn yrityksiä ja
journalin kirjoitusta. Tuore valtuus voidaan tarkistaa samalla nykyisellä
callbackilla; journal-sidonta ei itsessään todista prosessipoissaoloa,
sisältöä tai lineagea eikä korvaa niiden omistavia portteja.

Journalin poisto käsittelee sivuslotit ennen auktoritatiivista pääslottia.
Kesken katkennut siivous ei poista jäljellä olevaa journalia valtuuden
menettämisen jälkeen. Rollbackin lisävirhe säilyttää ensimmäisen syyn.
Tavallisen forwardin keskeytyksessä nonmutating `peek` saa valita vain
saman operaation täsmällisesti sallitun vaihe/revision-etenemän; tuore
strict census ja rollbackin exact guardit vaaditaan sen jälkeenkin.
Vierasta, taaksepäin mennyttä tai ristiriitaista tilaa ei korjata arvaamalla.
Cold-forwardin virhe ei anna tämän fallbackin valtuutta.

Katselmuksessa löydetty oman vaihepäivityksen jälkeinen rollback-regressio
korjattiin ennen hyväksymistä. Nykyinen kohdesarja läpäisi 910 testiä
38 tiedostossa ilman ohituksia; työtilan tyyppitarkistus ja desktop-build
läpäisivät. Journal-korjauksen ja census-jatkon rajatut riippumattomat
katselmukset eivät löytäneet jäljelle jäävää raportoitavaa puutetta näistä
muutoksista.

Kahdeksan natiivia kuluttajakoetta läpäisi samalla muuttumattomalla buildilla:
molemmat restore-kuluttajat, nyky-/038-aineisto sekä hyväksyntä ja rollbackin
jälkeinen startup-validointi. Alkuperäisen ja tuotavan tietokannan tavut
erotettiin, ja kumpikin lopputila varmennettiin todellisella eristetyllä
SQLite-tarkistuksella. Kaikkien 36 utilityn poistuminen ja varauksen palautuminen
varmennettiin. Business-backendin health ja uudelleenkäynnistys olivat tässä
kontrolloidut rajat, eivät todellisen backendin tai hardened-paketin läpäisyjä.
Kokeen valmistelu- ja fixture-hylkäykset säilyvät erillisinä; niiden korjaus
ei muuttanut sovellusta tai hyväksyntäehtoja.

Terminal-/rollback-sisältö- ja native-valtuuksien tuotantokytkentä, C offline,
koko startup, Linux-runtime/CI, hardened nyky-/038-palautus, paketointirajat,
koko K:n loppukatselmus sekä PR/main-portit ovat edelleen avoinna. Tämä
muutos ei lisää riippuvuuksia, loggeria, valvojaa tai uutta testialustaa
eikä muuta backup-formaattia, liiketoimintalogiikkaa tai aikarajoja.

<a id="m1-source-preparation-l4505"></a>

#### V2au: Keskeytyneen rollbackin slot-valinta

**Rajattu työpuukorjaus kohdetodennettu; koko K avoinna.** Nykyinen palautustransaktio
valitsee `rollbackStarting`- ja `rolledBack`-vaiheissa alkuperäisen
tietokanta- ja dokumenttislotin täsmällisestä tiedostotilasta. Alkuperäinen
voi olla vielä rollback-slotissa, jo aktiivinen tai journalin mukaan
alun perin puuttuva. Tuotavan sisällön pitää samalla löytyä täsmälleen
yhdestä aktiivisesta, staging- tai failed-slotista. Puuttuvaa tai
päällekkäistä sisältöä ei arvata palautetuksi alkuperäiseksi.

Yksivastuinen slot-valinta ja nykyisen transactionin census tarkistetaan
ennen rollback-mutaatiota, rename-retryä ja terminal-journalin siivousta.
Kesken katkennut siirto jatkuu nykyisessä dokumentit-ennen-tietokantaa-
järjestyksessä; epävarma aineisto säilyy. Valittu journal ja nykyinen
omistajuuscallback pysyvät tuoreina. Uutta IPC-sopimusta, loggeria,
valvojaa, riippuvuutta tai aikarajaa ei lisätä.

Todennus sisältää sallitut ja hylättävät slot-yhdistelmät, siirtojen
väliset keskeytykset, alkuperäisen puuttumisen, journal-/omistajuuskatkon
sekä siivouksen keskeytyksen. Tämä tiedostotilan valinta ei ole schema-,
lineage-, sisältö- tai native-valtuustodistus. Kylmän rollbackin
sisältövaltuus ja koko K:n integraatioportit pysyvät erillisinä avoimina
vaatimuksina.

Viisi uutta regressiota toisti puutteen ennen korjausta: puuttuva
alkuperäinen saattoi jäädä uuden aktiivisen sisällön varaan, päällekkäinen
staging päästä rollback-siirtoihin tai terminal-journal poistua palautetun
slotin puuttuessa. Lopullinen kohdesarja läpäisi 958 testiä 43 tiedostossa
ilman ohituksia. Tyyppitarkistus ja desktop-build läpäisivät. Todellinen
startup-kuluttaja säilyttää hylkäyksen syyketjun ja nykyiset turvalliset
rollback- ja selvitystarvetapahtumat. Uuden observer-testin väärä odotus
korjattiin vastaamaan olemassa olevaa aloitus-/hylkäysjärjestystä;
tuotantolokitusta ei muutettu. Rajattu riippumaton lähdekatselmus ei
löytänyt tästä korjauksesta raportoitavaa puutetta.

Kahdeksan nyky-/038-aineiston natiivia kuluttajakoetta läpäisi nykyisellä
desktop-buildilla. Utilityjen poistuminen ja varauksen palautuminen
varmennettiin erikseen. Kokeen business-backend, health ja seuraava
startup olivat edelleen kontrolloidut rajat, eivät todellisen koko
käynnistyksen tai hardened-paketin hyväksyntöjä. Tämä ei sulje kylmän
rollbackin sisältövaltuutta, C offlinea tai K:n PR/main-portteja.

<a id="m1-source-preparation-l4547"></a>

#### V2av: Alkuperäissisällön tarkistussopimus

**P1/P2-päätökset hyväksytty 11.10.2026; P1 ja P2:n startup-rollback kohdetodennettu.** Loppusiivous ja koko K:n portit ovat erikseen avoinna. V2au valitsee
alkuperäisen slotin mutta ei tarkista sen sisältöä. Nykyinen
`inspectColdRestoreContent` käsittelee vain tuotavan sisällön `active`- ja
`staged`-slotit. Sen kuittia ei uudelleennimetä alkuperäisen sisällön
todisteeksi. Tarkistus pysyy nykyisessä eristetyssä utilityssa ja käyttää
samaa schema-, artifact-, kertakopio-, exit- ja reclaim-ketjua.

**V2av-P1 / hyväksytty nimetty private-sopimus:** erillinen
`inspectColdRestoreOriginal`-komento ja täsmällinen alkuperäistulos.
Main valitsee jäädytetyn journalin ja tuoreen V2au-censuksen perusteella
riippumattomat tietokanta- ja dokumenttislotit `active`, `rollback` tai
journalin todistama `absent`. Molempien palautuskuluttajien lähdepolut
johdetaan niiden omistamista kiinteistä layouteista; komentoon ei lisätä
yleistä tiedosto-, SQL- tai suorituskohdetta. Vastaanottaja tarkistaa saman
suljetun sopimuksen. Operation/generation/session, lähderooli ja slotit
sidotaan tulokseen; forward- tai eri operationin tulos hylätään.

Olemassa olevan alkuperäiskannan schema/history varmennetaan ennen
identityä ja katalogia nykyisellä `restoreCompatible`-politiikalla.
Tietokantakyselyt tehdään vain todellisiin lähdetavuihin sidotusta erillisestä
kopiosta. Katalogiin kuuluvien PDF:ien koko, tiiviste ja valitut
dokumenttisidonnat tarkistetaan nykyisillä rajatuilla lähdetavujen luvuilla;
uutta PDF-kopiohistoriaa ei muodosteta.
Alkuperäiskannan puuttuminen ei tuota `healthy`-, schema- tai
profile-identity-kuittia, eikä puuttuvaa kantaa luoda tarkistuksessa.
Puuttuva dokumenttislotti ei kelpaa, jos varmennettu katalogi vaatii PDF:iä.
Ilman alkuperäiskantaa dokumenttikansion säilyminen ei ole todiste
business-katalogista; nykyinen puuttumis- ja säilytyssopimus pidetään
erillään. Ensimmäinen varmennettu alkuperäissisältö säilyy siirtojen
vertailuperustana. Kuitti ei todista takautuvasti journalin syntyhetken
tavuja eikä anna mutaatiolupaa yksinään.

**V2av-P2 / hyväksytty siirroissa säilyvä omistaja:** muuttumaton staging-varaus ei
kelpaa sen oman juuren siirron jälkeen. Samoin rollback-juureen sidottu
varaus ei voi valtuuttaa journalin poistoa sen oman juuren poistamisen
jälkeen. Hyväksytty rajaus käyttää valitun operaation nykyistä `failedOperationRoot`-
kansiota tarkistuksen paikallaan pysyvänä ankkurina. Sen valmistelu
siirtyy vain teknisenä tyhjän kansion luontina alkuperäistarkistuksen
eteen: ensin tuore journal, census, asennuslease ja nykyisten lähdejuurten
native-poissaolo. Vierasta tai epäselvää kansiota ei omaksuta eikä poisteta.
Alkuperäistarkistus ei siirrä aktiivisen työtilan writer-varausta utilitylle.

Nykyisten siirtyvien tai poistettavien juurten erilliset varaukset
suljetaan vasta todetun lapsen exitin/reclaimin ja päättyneiden lukujen
jälkeen, juuri ennen niiden omaa nimettyä siirto- tai poistorajaa.
Asennusomistajuus, lease, valittu journal ja paikallaan pysyvä ankkuri
säilyvät; vanhan polun descriptorin uudelleenkirjoitus ei ole sallittu
oikotie. Tuore census ja alkuperäistavut tarkistetaan ennen jokaista
rollback-mutaatiota ja retryä. Epävarma sulku, myöhäinen lukija tai
vaihtunut juuri säilyttää aineiston ja estää jatkamisen.

Toteutus jaetaan nykyisen native-palvelun nimetyn alkuperäistarkistuksen
sekä molempien startup-kuluttajien rollback-kytkennän todennukseen.
Testit kattavat erilliset ja sekoittuneet alkuperäisslotit, puuttumisen,
nyky-/038-scheman, PDF-ristiriidan, muuttuneet tavut, väärän roolin/generationin,
keskeytyksen sekä omistajuuden ennen ja jälkeen staging-siirron.
Oikean utilityn exit/reclaim ja turvallisen ensisyyn lukuketju vaaditaan.
Myöhemmän business-backendin mahdollisesti muuttamia tavuja ei hyväksytä
vanhalla pre-rollback-kuitilla. `accepted`-/`rolledBack`-loppusiivouksen
ja C offline -polun omat valtuudet todennetaan edelleen erikseen.

Rajattu riippumaton lähdekatselmus vahvisti vanhan root-varauksen
rename-/poistorajan. Pieni nykyisen varausprimitiven synteettinen koe
todensi identiteetin säilymisen rename:ssa, vanhan polun hylkäyksen,
poissulkemisen jatkumisen vapautukseen asti ja tuoreen kohdevarauksen.
Se ei testannut Electronin luovutusta, utility-lasta, SQLitea tai
tuotannon rollbackia. P1/P2:n hyväksyntä on omistajan erillinen päätös,
ei tämän varauskokeen tulos. Riippuvuudet, durable-formaatit,
35 sekunnin työraja ja nykyiset hyväksyntäportit säilyvät.

**P1:n toteutusnäyttö:** original-komento ja suljettu tulos on lisätty
nykyiseen parseriin, runneriin ja prosessikutsuun. Samassa backendin
utility-moduulissa alkuperäisaineiston kaksi kiinteää layoutia käyttävät
nykyistä schema/history-, katalogi-, PDF- ja lähdetavujen sidontaa.
Poissaolotulos ei sisällä tietokantaterveyttä, profile-identityä tai
tietokanta-/dokumenttikuittia. Portable- ja forward-kutsut eivät hyväksy
original-terminalia. Operation/generation/session säilyvät original-tuloksen
vastaanottajalle asti; tulos palautuu vasta todellisen exitin ja reclaimin jälkeen.

`runProfileRestoreOriginalInspection` käyttää nykyistä kertakopion,
exit/reclaimin ja siivouksen omistajaa. Dokumenttisidonnat luetaan vasta
prosessirajan todennuksen jälkeen ja valittu lähde tarkistetaan uudelleen
ennen tuloksen palautusta. Poissaolotulos ei keksi katalogia tai lineageä;
sen siivous vaatii tyhjän kopion. Ristiriitainen tai myöhemmin ilmestynyt
sisältö säilyttää kopion ja estää hyväksynnän. Present-, forward- ja
portable-kuluttajien normaalit siivousvaatimukset säilyvät. Kesken jäävä
mainin luku ei anna lupaa siivota tai vapauttaa epävarmaa omistajaa.

Lopullinen kohdesarja läpäisi 1 036 testiä ilman ohituksia, myös nykyisille
portable-, forward- ja startup-kuluttajille. Koko projektin tyyppitarkistus
sekä backendin ja desktopin buildit läpäisivät. Rajattu riippumaton
lähdekatselmus ei löytänyt original-haaroista raportoitavaa puutetta.
Main-kuluttajan katselmuksessa todettu poissaolon siivouspuute toistettiin
regressiolla, korjattiin yllä kuvattuun tyhjän kopion sopimukseen ja
katselmoitiin uudelleen ilman löydöksiä.
Nimetyn main-kuluttajan utility-kokeen 12 tapausta kattoivat
molemmat layoutit, sekoittuneet slotit, nykyisen ja 038-kannan, alkuperäiskannan
poissaolon aktiivisen kohteen rinnalla sekä puuttuvan valitun kannan/PDF:n
hylkäyksen. Todelliset lapsen exitit, mainin poissulkeminen, varauksen
vapautuminen ja lähteiden säilyminen varmennettiin erikseen.
Kertakopion siivous ja present-kannan trusted-lineage-tarkistus todentuivat
samassa oikeassa kuluttajaketjussa; poissaolo ei saanut lineage-tarkistusta.
Tämä P1-näyttö koskee sisältökutsua; startupin siirtovaltuuden näyttö on alla.

**P2:n startup-rollback-kytkentä:** molemmat startup-kuluttajat käyttävät
valitun `rollbackStarting`-/`rolledBack`-journalin alkuperäistarkistusta.
Stationary-anchor valmistellaan vasta nykyisten lähdejuurten
identiteettisidottujen varausten jälkeen. Tuntematon rakenne, vaihtunut
juuri tai kilpaileva varaus ei anna lupaa journalin korjaukseen tai siirtoon.
Puuttuvan ankkurin viimeinen kansio luodaan yksinomaisesti; olemassa olevaa
vierasta kansiota ei korvata. Installation-valtuus ja lähdevaraukset
säilyvät utility-luovutuksen aikana. Ankkurin main-omistajuus vaaditaan
ennen tarkistusta ja todetun exitin/reclaimin jälkeen, ei luovutuksen aikana.

Alkuperäiskannan ja PDF:ien tavut sidotaan nykyiseen yhteiseen
tiedostovalidointiin. Receiptin ensimmäinen sisältö ei vaihdu siirtojen
mukana; slot-vaihdos vaatii uuden nimetyn tarkistuksen samoilla työrajoilla.
Tuore journal, census, lineage ja tavuvertailu portittavat korjaavan
journal-luvun sekä rollbackin siirrot ja oman `rolledBack`-revision.
Keskeneräinen luku tai menetetty valtuus estää jatkon; cold-haara ei
kirjoita `failedSafe`-journalia menetetyllä valtuudella.
Staging-varaus suljetaan vasta päättyneiden lukujen ja utilityn
exit/reclaimin jälkeen. Juuren talteen otettu identiteetti tarkistetaan
vapautuksen jälkeen, jokaisessa nykyisessä rename-uusinnassa ja kohteessa
siirron jälkeen. Vapautettua vanhan polun descriptoria ei käytetä uudelleen.

Kohdesarja läpäisi 348 testiä ilman ohituksia; koko projektin tyyppitarkistus
ja desktopin build läpäisivät. Tavallisen live-/forward-
palautuksen regressiot sekä oikean compositionin molemmat cold-kuluttajat
ovat mukana; viimeksi mainitun native-utility-raja on kontrolloitu.
Oikean Electron-utilityn ja SQLite-tarkistusajurin kahdeksan synteettistä
tapausta kattoivat molemmat layoutit, nyky-/038-kannan, sekoittuneet slotit,
jo siirretyn stagingin ja `rolledBack`-tilan ilman rollback-juurta.
Alkuperäinen palautui, korvattu sisältö säilyi, uusi cold-jatko läpäisi ja
varausten vapautuminen sekä 22 lapsen todelliset exit/reclaim-rajat
varmennettiin. Natiivikokeen business-backend oli poissa; se ei ole koko
compositionin, paketoidun palautuksen tai business-terveystarkistuksen näyttö.
Riippumaton rajattu lähdekatselmus löysi luovutuksen main-valtuuden ja
vapautetun stagingin identiteetin puutteet. Ne korjattiin regressioineen;
uudelleenkatselmuksessa ei löytynyt näistä poluista jäljelle jäävää puutetta.

Post-backend-terminal, C offline, Linux-runtime/CI, hardened-palautus,
koko K:n loppukatselmus ja PR/main-portit ovat edelleen avoinna. Vanhaa
pre-backend-receiptiä ei saa käyttää business-backendin jälkeisiin muutoksiin.

<a id="m1-source-preparation-l4694"></a>

#### V2aw: Rollbackin loppusiivouksen säilytys

**Rajattu työpuukorjaus kohdetodennettu; terminal-valtuus ja koko K avoinna.**
Palautuneen rollback-juuren rekursiivinen poisto saattoi hävittää sinne
ilmestyneen tuntemattoman sisällön ja poistaa journalin. Kuusi uutta
regressiota toisti puutteen ennen korjausta; keskeytyneen tyhjän siivouksen
jotkin kansiot saavat edelleen olla jo poissa.

`clearRolledBack` sallii nyt vain tyhjän `data`- ja `storage`-rakennekansion
sekä niiden tyhjän operation-juuren poiston. Poisto ei ole rekursiivinen:
myöhäinen tiedosto pysäyttää sen. Viimeisen ulkoisen valtuustarkistuksen
jälkeen tehdään kanoninen rakennetarkistus; journalin jokainen poistovartija
vaatii lopuksi rollback-juuren puuttumisen. Vaihtunut ancestor tai uudelleen
ilmestynyt juuri säilyttää aineiston ja auktoritatiivisen journalin.
Riippumaton katselmus löysi näiden kahden viimeisen await-rajan puutteet;
molemmat toistettiin, korjattiin ja katselmoitiin uudelleen ilman jäljelle
jäävää löydöstä kyseisissä poluissa. Tämä ei todista yleistä filesystemin
kilpailuttomuutta eikä korvaa native-omistajuutta.

Lopullinen kohdesarja läpäisi 398 testiä yhdeksässä tiedostossa ilman
ohituksia. Mukana ovat tavallinen live-aktivointi, cold-/forward-ketjut,
molemmat palautuskuluttajat ja startup-composition. Koko työtilan
tyyppitarkistus ja desktop-build läpäisivät. Todellinen startup-kuluttaja
välittää siivoushylkäyksen nykyisiin turvallisiin validation/recovery-
tapahtumiin; journal ja alkuperäiset tavut säilyvät.

Neljä todellista utility-/native-tapausta todensi cleanup-hylkäyksen
molemmilla kuluttajilla nyky-/038-aineistolla. Kaikki 20 lapsen exit/reclaim-
rajat sekä aineiston ja varausten säilytys/vapautus tarkistettiin.
Samalla muuttumattomalla buildilla kahdeksan tavallista hyväksyntä-/rollback-
kontrollia läpäisi; 36 lapsen exit/reclaim ja eri alkuperäis-/kohdetavut
varmennettiin. Natiivikokeen business-backend ja health olivat kontrolloidut
rajat, eivät koko mainin tai hardened-paketin läpäisyjä. Näitä tuloksia ei
summata aiempien vaiheiden hyväksyntänäytöksi.

<a id="m1-source-preparation-l4729"></a>

#### V2ax: Backendin jälkeisen terminal-valtuuden päätösrajat

**Omistaja hyväksyi kaikki kolme päätöstä 11.10.2026. Toteutus ja sen
hyväksyntänäyttö ovat vielä kesken.**
Katselmus vahvisti, että ennen backendin avaamista saadun kuittauksen
valtuus päättyy sen oman operaation sulkemiseen. Sallittu metadata-baseline,
migraatio ja startup-retention voivat muuttaa tietokantatavuja ja chainia.
Niitä ei hylätä pelkän vanhan byte-equalityn vuoksi, mutta myöhempi tarkistus
ei myöskään takautuvasti todista alkuperäistä sisältöä.

1. **Live-loppuhyväksyntä:** hyväksytty rajaus säilyttää business-backendin käynnissä
   normaalissa onnistumisessa. Nykyinen maintenance sulkee kirjoitukset;
   nykyinen snapshot-/eristetty tarkistus todistaa tuoreen versionmukaisen
   sisällön. Poistettavien operation-juurten native-omistajuus, lease,
   jäädytetty journal ja lineage varmennetaan erikseen. Uutta manageria,
   rinnakkaista schema/PDF-validaattoria tai ylimääräistä onnistumisen
   uudelleenkäynnistystä ei ehdoteta. Kuitti ei anna yleistä mutaatiolupaa.
2. **Accepted-cold-jatko:** hyväksytty rajaus lykkää jo hyväksytyn journalin
   keskeytyneen siivouksen uuden normaalin backend-/sisältövalidoinnin
   jälkeen. Osittain poissa olevat cleanup-juuret ovat sallittuja vain
   oman terminal-censuksen mukaan. Hyväksyttyä palautusta ei päätellä
   epäonnistuneeksi siivousvirheestä eikä käynnistetä vanhaa rollbackia.
3. **Alkuperäiskannan poissaolo:** hyväksytty rajaus pysäyttää rollbackin automaattisen
   business-käynnistyksen selvitykseen ennen uuden tyhjän kannan luontia.
   Kyse on journalin osoittamasta alkuperäiskannan puuttumisesta, ei tyhjästä
   asiakaslistasta tai tavallisen historiallisen varmuuskopion tuonnista.
   Tiedostot ja journal säilyvät; dokumenttislotin poissaolo pysyy erillisenä.

Rollbackin nykyinen tiukka restore-sulku, todellinen exit/reclaim ja tuore
alkuperäistarkistus vaaditaan ennen tiedostomuutoksia. Tavallinen pakotetun
stopin poissaolohavainto ei anna tätä valtuutta, eikä restore-aineistolle
laajenneta owned-local hot-journal -poikkeusta. Tämä nimenomainen hyväksyntä
ei muuta muita avoimia K-portteja. Toteutuksessa nimeä täsmällinen
kuluttajakytkentä ja todista oikea backend/migraatio/terminal-ketju; pelkkä
suurempi kohdetestimäärä tai V2aw:n siivousnäyttö ei sulje sitä.

<a id="m1-source-preparation-l4765"></a>

#### V2az: Hyväksynnän pysyvyys ja alkuperäiskannan poissaolo

**Rajattu tilakytkentä työpuussa; koko terminal-valtuus ei vielä ole valmis.**
Transactionin `commitAcceptance` julkaisee hyväksytyn journalin ja palauttaa
täsmällisen, jäädytetyn readbackin ilman juurten poistoa. `clearAccepted`
siivoaa erikseen saman valitun hyväksytyn journalin. Nykyinen `accept`
säilyy yhteensopivuuskutsuna näiden kahden operaation yli.

StartupRecovery erottaa aloittamattoman, varmentamattoman ja varmennetun
hyväksynnän. Kuittauksen puuttuminen ei anna rollback-valtuutta, vaikka
journalin julkaisu olisi voinut jo onnistua. Molempien startup-kuluttajien
composition säilyttää epäselvän palautustilan suojan eikä päättele hyväksyntää
uuden korjaavan journal-valinnan perusteella. Jo hyväksytty kylmä journal
odottaa uuden backendin sisältö-/terveystarkistusta. Sisällön tarkistuksen
onnistuminen ja myöhempi siivousvirhe eivät ole sama tapahtuma; ensisyy
säilyy sisäisenä, julkinen yleisvirheraja ei laajene. Hyväksytyn tai epävarman
hyväksynnän jälkeen ei käynnistetä vanhaa profiili-/workspace-rollbackia.

Journalin todistama alkuperäiskannan poissaolo pysäyttää sekä
`rollbackStarting`- että `rolledBack`-käynnistyksen ennen business-backendia.
Puuttuva kanta ei muutu uudeksi tyhjäksi kannaksi eikä journalia poisteta.
Tavallinen forward-palautus alun perin puuttuvaan kantaan säilyy erillisenä.

Kolme uutta regressiota toisti lähtöpuutteet. Lopullinen 422 testin
kohdesarja yhdeksässä tiedostossa, desktopin tyypit ja build läpäisivät.
Composition-näyttö käyttää kontrolloitua backendia ja todellisia journal-
ja tiedostotavuja; se ei ole paketoitu käyttäjäpolkutodiste. Neljä todellista
utility/native-tapausta nyky-/038-aineistolla todensi hyväksytyn journalin
siivousvirheen, sisällön säilymisen ja kylmän jatkon validoinnin. Kaikki
20 lapsen exit-/reclaim-rajat varmennettiin. Saman käännöksen kahdeksan
tavallisen hyväksynnän ja rollbackin native-kontrollitapausta läpäisivät;
niiden 36 lapsen exit-/reclaim-rajat varmennettiin. Business-/health-raja
on näissä kontrolloitu. Rajattu riippumaton ehdokaskatselmus havaitsi,
että alkuperäiskannan poissaolon esto saattoi hukata sitä edeltäneen
forward- tai validointivirheen. Kaksi regressiota toisti puutteen;
korjaus säilyttää ensisyyn sisäisessä ketjussa. Löydöksen jälkikatselmus
ei jättänyt uusia konkreettisia deltalöydöksiä. Tämä ei ole koko K:n katselmus.

Live-snapshotin tuore sisältötodiste, terminal-juurten census ja native-
poistovaltuus, oikea backend/migraatio/terminal-ketju, C offline ja K:n
Linux-, hardened-, paketointi- sekä integraatioportit pysyvät avoimina.
Tilakytkentä ei hyväksy vanhan receiptin uudelleenkäyttöä eikä yksin sulje
S030-01/S030-02-havaintoja.

<a id="m1-source-preparation-l4809"></a>

#### V2ba: Terminal-inventaario ja nimetty siivous

**Rajattu filesystem-kytkentä työpuussa; sisältö- ja native-valtuus ovat avoinna.**
Transaction jäädyttää valitun journalin, staging-/rollback-juuret, ankkurit,
tiedostoidentiteetit ja hakemistojen sallitut lapsilistat. Linkki, vaihtunut
tiedosto tai juuri ja sallitun rakenteen ulkopuolinen sisältö estävät jatkon.
Accepted-jatko sallii osittain poissa olevat juuret luomatta niitä uudelleen.

Siivous käyttää vain inventoituja `unlink`-/`rmdir`-kohteita, ei rekursiivista
poistoa. Myöhäinen tuntematon sisältö tai uudelleen ilmestynyt juuri säilyttää
hyväksytyn journalin; osittainen siivous ei anna rollback-valtuutta.
Journalin poisto vaatii lopuksi juurten poissaolon ja nykyiset vartijat.
Inventaario ei yksin todista, ettei juuri ollut vaihtunut jo ennen sen lukua.

Riippumaton katselmus löysi kokolaskennan yhteensopivuuspuutteen:
katalogin rajaa sovellettiin toistuviin absoluuttisiin polkuihin ja lapsilistoihin.
Korjaus säilyttää juuripolun kerran ja jäädytetyt vanhempi/nimi-rivit;
kompaktin kirjanpidon rajat pysyvät 64 MiB:n ja 100 000 PDF:n rajoissa.
Tyhjät hakemistotkin lasketaan. Rajatesti vertaa normaalin 100 000 dokumentin
rakenteen esityksiä, ei suorita sen koko filesystemiä eikä todista RAM- tai
aikarajaa tai jokaista historiallisen polun ääritapausta. Jälkikatselmus
sulki tämän rajatun löydöksen ilman uusia konkreettisia deltalöydöksiä.

Lopullinen 446 testin kohdesarja 11 tiedostossa ilman ohituksia, desktopin
tyypit ja build läpäisivät. Kaksitoista todellista utility/native-tapausta
nyky-/038-aineistolla kattaa molemmat palautuskuluttajat: accepted-cold-jatkon
sekä tavallisen hyväksynnän ja rollbackin. Kaikki 56 exit-/reclaim-rajat
varmennettiin. Business-backend ja health ovat näissä kontrolloidut rajat,
eivät mainin, Linuxin, hardened-paketin tai PR/main-porttien hyväksyntä.
Utility-kokeen ensihylkäys johtui fixturen laskuarkistoon lisäämästä ylimääräisestä
tekstitiedostosta. Fixture korjattiin katalogiin sidottuihin PDF-tavuihin;
tuotannon sallittua rakennetta ei laajennettu ja ensihylkäys säilytettiin.

Tuore live-sisältötodiste, sen sidonta journalin julkaisuun, juurikohtaiset
native-varaukset ja valtuuden säilyminen mutaatioon asti pysyvät V2ax:n
seuraavana työnä. Tämä vaihe ei yksin sulje S030-01/S030-02:ta tai koko K:ta.

<a id="m1-source-preparation-l4846"></a>

#### V2bb: Live-terminalin tuore valtuus

**Rajattu live-kytkentä ja oikean backendin kohdenäyttö; koko K on kesken.**
Molempien startup-palautuskuluttajien loppuhyväksyntä ottaa nykyisen
installation-leasen ja exact-owner restore-kirjoitussuojan, luo tuoreen
snapshotin ja tarkistaa sen nykyisellä eristetyllä tarkistusprosessilla.
Lineage ja versionmukainen sisältö varmennetaan migraation jälkeen;
onnistunut normaali polku ei sammuta business-backendiä uudelleen.

Snapshotin oma native-varaus säilyy paikallaan koko terminalin ajan.
Poistettavien operation-juurten varaukset sidotaan ennen niiden ottamista
jäädytettyyn inventaarioon. Journalin korjaava luku, hyväksynnän julkaisu
ja jokainen nimetty poisto vaativat tuoreen valtuuden; async-luku ja
inventaarion tarkistus eivät saa ohittaa valtuuden vanhentumista.
Jo poistettu juuri ei voi todistaa journalin poistovaltuutta.
Puuttuva accepted-juuri jätetään poissa olevaksi eikä sitä varata tai luoda.

Accepted-cold-kuluttaja käyttää ei-muuttavaa journal-valintaa ja säilyttää
myös sivuslotit tuoreeseen backend-/sisältövalidointiin asti. Siivouksen
epäonnistuminen säilyttää hyväksytyn tilan, ei anna rollback-valtuutta.
Valtuuden tai siivouksen epävarmuus säilyttää tutkimusaineiston ja
kirjoitussuojan. Myöhäinen tulos ei saa jatkaa mutaatioita valtuuden päätyttyä.

Riippumaton katselmus löysi brokerin liian suppean restore-context-ehdon,
valtuuden vanhentumisaukon viimeisessä journal-odotuksessa ja liian aikaisen
accepted-cold-sivuslotien siivouksen. Rajatut korjaukset ja niiden
jälkikatselmus kattavat nämä kolme lähdehavaintoa. Broker sallii vain saman
voimassa olevan restore-operaation inspect-lukukontekstin; vieras, päättynyt
tai update-omistaja ei saa uutta lupaa. Protokollaa tai riippuvuuksia ei lisätty.

Lopullinen kohdesarja läpäisi 566 testiä 15 tiedostossa ilman ohituksia;
desktopin tyypit ja build läpäisivät. Neljä normaalia ja neljä
accepted-cold-tapausta läpäisi oikealla business-backendillä,
snapshot-brokerilla, eristetyllä tarkistimella ja native-varauksilla.
Molemmat palautuskuluttajat sekä nykyinen ja historiallinen 038-aineisto
katettiin; kaikki 40 utility-/backend-poistumista ja varausten palautumiset
varmennettiin. Accepted-cold-koe aloittaa synteettisestä jo hyväksytystä,
osittain siivotusta tilasta; se ei ole todellisen kaatumisen koko main -koe.
Fixturen kaksi valmisteluhylkäystä korjattiin vastaamaan mainin nykyistä
snapshot-parentin valmistelua ja restoreCompatible-migraatiovalintaa.
Ensihylkäykset säilyivät eikä tuotannon sisältö- tai aikarajaa lievennetty.

Näyttö ei hyväksy ennen migraatioita toimivaa C-offline-kuluttajaa,
koko mainin palautusketjua, suuren katalogin koko terminal-resurssipolkua,
Linuxia, hardened-pakettia tai PR/main-portteja. Nämä ovat seuraavat
hyväksyntärajat, eivät uusilla kohdetestimäärillä korvattavia ehtoja.

<a id="m1-source-preparation-l4893"></a>

#### V2be: C:n business-valmistumisen journal-sidonta

**Rajattu kohdetoteutus; journaliton jatko ja koko K:n hyväksyntä ovat avoinna.**
Mainin C-palautus välittää alkuperäisen, validoidun update-journalin
`completeAfterProfileValidation`- ja `requireRecoveryAfterRestoreRollback`-
kutsuihin. Sama valinta tarkistetaan ennen ja jälkeen profiilivalidoinnin.
`readForLiveOwner()` ei korjaa sivuslotteja tai valitse uudempaa operaatiota
hiljaisesti. Myös jo valmistuneen journalin jatko tarvitsee muuttumattoman
valinnan; puuttuva kirjoitustarve ei anna oikeutta ohittaa tarkistusta.

Nykyisen journalivaraston ehdollinen kirjoitus vertaa koko validoitua
edeltävää journalia, ei vain korrelaatiota, tilaa tai revision alarajaa.
Vertailu ja julkaisu ovat saman store-instanssin nykyisen exclusive-operaation
sisällä. Mainin omistajuustarkistus on synkroninen; asynkronista tai
reentrant-kutsun lupausta ei hyväksytä valtuudeksi. Vieras `.backup` tai
`.next` estää live-kirjoituksen ja säilyy. Omistajuus tarkistetaan vielä
heti ennen ensimmäistä currentin siirtoa, ennen uuden currentin julkaisua ja
edellisen version loppusiivousta. Awaitista paluu ei yksin säilytä valtuutta.
Julkaisun jälkeinen valtuuden menetys säilyttää currentin ja backupin
selvitystä varten. Muut journal-kirjoittajat säilyttävät nykyisen sopimuksensa.
Havaittu currentin katoaminen ennen siirtoa hylätään; sitä ei käsitellä
ensimmäisen journalin luontina. Tämä ei lisää prosessien välistä CAS-palvelua
eikä lupaa estää kaikkia valtuussopimuksen ulkopuolisia tiedostokirjoittajia.

Virhehaara ei korvaa muuttunutta tai osittain julkaistua journalia vanhasta
valinnasta muodostetulla `recoveryRequired`-kirjoituksella. Alkuperäinen virhe
säilyy ennen mahdollista journalin lisävirhettä. Jos jo siirretyn currentin
takaisin palautus epäonnistuu, myös palautusvirhe säilyy erillisenä alkuperäisen
syyn jälkeen; backupia ei poisteta onnistuneen palautuksen oletuksella.
Turvallinen julkinen
`update.*`-tapahtumasopimus ja käyttäjän recovery-palaute eivät laajene;
raw-journalia, pakettitiivisteitä tai polkuja ei lisätä lokiin.

Viisi regressiota toisti alkuperäisen valinnan ylikirjoituksen tai väärän
valmistumisen ennen korjausta. Erillinen loppusiivousregressio toisti
valtuuden menetyksen jälkeisen backupin poistamisen; molempien versioiden
säilyminen on nyt kontrolloitu. Erillinen katoamisregressio toisti stale-
julkaisun ilman currentia; tämäkin hylätään. Rajatapaukset kattavat muuttuneen
paketti-identiteetin, jo valmistuneen tilan, stale-valinnan ennen tarkistusta,
julkaisun jälkeisen kirjoitusvirheen sekä async-/reentrant-valtuuden hylkäyksen.
Katselmuksen löytämä viimeisen awaitin jälkeinen valtuusaukko ja epäonnistuneen
takaisin siirron katoava syy toistettiin ennen korjausta. Kohdetodennuksen
229 testiä seitsemässä tiedostossa, desktopin tyyppitarkistus ja build
läpäisivät. Mukana ovat journalin muiden kirjoittajien nykyiset regressiot,
kutsujan valtuuden välittyminen ja samaan revisioon muuttunut paketti.
Riippumaton katselmus hyväksyi rajatun korjausdiffin; tämä ei sulje koko K:ta.

Olemassa olevan Electron/backend/native-kokeen normaalit ja muuttuvan
update-valinnan kontrollit kattavat nykyisen ja historiallisen 038-kannan.
Ehjä valinta valmistuu; muutettu valinta säilyy ja estää valmistumisen.
Neljän tapauksen kaikki 20 omistettua prosessia poistuivat onnistuneesti;
native-varauksen vapautuminen ja uudelleenvaraus varmennettiin.
Tämä on oikeiden palveluiden ennen migraatioita toimiva ketju, ei koko
mainin, oikean binaariasentimen tai hardened-paketin hyväksyntä. Journaliton
C-jatko, vanhan raskaan aktiivivalidoinnin korvaaminen, Linux, suuren
katalogin resurssinäyttö, K:n loppukatselmus ja PR/main-portit ovat avoinna.

<a id="m1-source-preparation-l4950"></a>

#### V2bh: Journalittoman C:n historiallinen käynnistysadmissio

**Rajattu pre-open-kytkentä; koko K:n hyväksyntä on avoin.** C:n alussa
valittu update-journal tarkistetaan lukevasti ennen backendin käynnistystä.
Vain täsmällisen käynnissä olevan kohteen `rollbackRequired`-,
`businessRollbackStarting`- tai `businessRollbackCompleted`-tila sekä
säilynyt palautuspisteviite ja alkuperäinen migraatioketju sallivat
`restoreCompatible`-schema-politiikan. Eksplisiittinen journalin poissaolo
ei adoptoi uutta operaatiota. Main varmennuttaa saman valinnan uudelleen
nykyisen varauksen prepare- ja grant-kohdissa. Muuttunut valinta tai
kutsujan valtuuden menetys estää käynnistyksen eikä kirjoita journalia.

Tämä valtuus koskee vain nykyisen schema-tarkistimen hyväksyttyä
yhteensopivuuspolitiikkaa. Metadataan sidotut historialliset prefixit
toimivat jo tavallisessa tiukassa polussa; metadataa vailla oleva hyväksytty
038-rakenne tarvitsee tämän palautuspoikkeuksen. Schema attestoi edelleen
ennen kirjoitettavaa avausta ja uudelleen samalla kirjoittavalla yhteydellä.
Admissio ei korvaa sisältö- tai PDF-tarkistusta eikä anna tiedostomutaatio-,
terminal- tai siivousvaltuutta. C:n nykyinen ennen migraatioita toimiva
alkuperäisketjun ja sisällön portti säilyy. Oman tavallisen paikalliskannan
hot-journal-poikkeusta ei yhdistetä tähän palautuspolitiikkaan.

Kolme main-kytkennän regressiota toisti historiallisen politiikan hylkäyksen
ennen korjausta. Rajattu desktop-sarja läpäisi 275 testiä viidessä
tiedostossa ilman ohituksia; nykyisen backendin erillinen schema- ja
migraatiokontrolli läpäisi 29 testiä kolmessa tiedostossa. Desktopin
tyyppitarkistus ja build läpäisivät. Kontrollit erottavat muuttuneen
valinnan, prepare-/grant-vaiheen hylkäyksen ja tavallisen käynnistyksen.

Nykyisen oikean backend-/Electron-/inspection-utility-kokeen kuusi
tapausta kattavat nyky- ja 038-kannan kaikissa kolmessa C-tilassa.
Kaikki 24 omistettua lapsiprosessia poistuivat onnistuneesti, varaus
palautui ja alkuperäisketju säilyi ennen binaarihandoffia. Koe mallintaa
journalittoman keskeytystilan hallitusti; se ei todista koko mainin
palautuskytkentää, oikeaa binaariasenninta, Linuxia tai hardened-pakettia.
Rajattu riippumaton diffikatselmus ei löytänyt uutta admissionin tai
prepare-/grant-sidonnan ohitusta, mutta löysi aiemman yhteensopivuusesteen:
rekisteröidyn työtilan W6-valmistelu inventoi kannan ennen tätä admissionia.
Metadataa vailla oleva 038-kanta hylätään tarkoituksellisesti tavallisessa
inventaarion schema-portissa. Mainin rajatut testit ohjaavat W6-valmistelua
mockilla eivätkä todista tämän rajan läpäisyä. V2bh ei siis ole tämän
historiallisen koko startup-polun hyväksyntä.

Oikean 038-fixturen metadataa käyttävä ja metadataa vailla oleva kontrolli
vahvistavat eron: ensimmäinen inventoidaan muuttumattomana, toinen hylätään
ennen identity-lukua ja ilman tiedostomuutosta. Niiden ja nykyisen
schema-avaussarjan 32 testiä kahdessa tiedostossa sekä backendin
tyyppitarkistus läpäisivät. Tämä kontrolli ei hyväksy järjestysmuutosta.

**Omistaja hyväksyi 11.10.2026:** eteenpäin päivityksen uusi W6-inventaario
ja valmistelu rajataan pois vain täsmällisesti valitusta C:n rollback-only-
käynnistyksestä. Hyväksytty rajaus säilyttää olemassa olevan W6-journalin
pakollisen recovery-käsittelyn, build-/registry-hash-todisteet sekä C:n
tuoreen schema-, alkuperäisketju-, sisältö-, artifact- ja soveltuvan lineage-
tarkistuksen. Palautushaara ei saa migroida eteenpäin, hyväksyä targetia,
siirtää passiivista registryä tai avata business-UI:ta. Binaarihandoff vaatii
edelleen varmennetun backendin pysähtymisen. Muuttunut valinta, omistajuuden
ristiriita tai epävarma palautuminen pysäyttää ketjun; siitä ei saa pudota
tavalliseen käynnistykseen. Myöhempi tavallinen forward-startup inventoi
edelleen normaalisti. Nykyinen [W6B-sopimus](windows-installer-and-update-plan.md)
ja [ADR-0011](../decisions/ADR-0011-local-multi-workspace-company-model.md)
päivitetään vastaamaan tätä hyväksyttyä rajattua poikkeusta.
Hyväksytyn valmistelurajauksen toteutus ja sen jälkitarkistus kuvataan
[V2bi:ssä](release-0.3.0-profile-validation-history.md#m1-source-preparation-l5019). Ensimmäisen ehdokkaan
225 kohdetestin läpäisy ei ole myöhemmän korjatun ehdokkaan hyväksyntä.
Rajattu käynnistysnäyttö, lähdekatselmus ja palautussarjan avoin hylkäys
pidetään erillään. Päätös ja kohdenäyttö eivät yksin hyväksy koko K:ta.
Yllä nimetyt koko K:n hyväksyntäportit säilyvät avoimina.

<a id="m1-source-preparation-l5019"></a>

#### V2bi: C:n palautuksen rajattu W6-valmistelu

Omistajan 11.10.2026 hyväksymä poikkeus erottaa uuden forward-valmistelun
epäonnistuneen päivityksen palautuksesta. Main jäädyttää C-valinnan ennen
W6-valmistelua. Olemassa oleva W6-recovery säilyy; jatkettava `prepared`-
journal varmennetaan edelleen täsmälliseen source/target-buildiin,
active-valintaan ja registry-tiivisteisiin. Vain `coordinatedUpdateTarget`
voi vastaanottaa tämän tuoreen C-valtuuden. `rollbackOnly` ei anna
forward-migraatio-, registry-siirtymä-, target-hyväksyntä- tai UI-valtuutta,
eikä sen jälkeen voi jatkaa tavalliseen päivityksen hyväksyntään.

Sama C-valinta, palautusomistajuus ja hyväksytyn lähdebuildin
versio/revisio/kanava tarkistetaan valmistelun ja backendin prepare-/grant-
kohdissa. Tämä koskee sekä journalitonta C:tä että C:n omaa keskeneräistä
palautusjournalia. Varauksen siirto käyttää olemassa olevan omistajan
vaihekohtaisia tarkistuksia; mainin hallussa olevaa varausta ei vaadita
sen jälkeen, kun siirto on jo alkanut. Schema-, sisältö-, alkuperäisketju-,
lineage- ja backendin pysäytysportit säilyvät ennallaan.

Ensimmäinen riippumaton rajattu katselmus löysi kaksi prepare/grant-
puutetta: omaa palautusjournalia käyttävän C:n guard ja hyväksytyn sourcen
tuoreus. Molemmat toistettiin regressioina ja korjattiin samaan nykyiseen
admission-ketjuun. Saman katselmuskierroksen korjatun diffiehdokkaan
lähdetarkistuksessa ei jäänyt näitä ohituksia. Tyyppitarkistus ja build
läpäisivät. Kuuden tapauksen oikea main-/W6-/Electron-koe kattaa nyky- ja
038-kannan kolmessa C-tilassa: kaikki 24 omistettua lapsiprosessia poistuivat,
mainin varaus vapautui, alkuperäiset tietokanta- ja registry-tavut säilyivät
eikä business-UI avautunut. Kehitysresurssien sijoitus ja binaariasentimen
käynnistys ovat kokeen hallittuja rajoja; tämä ei hyväksy hardened-pakettia
tai oikeaa binaariasenninta.

**Kohdehyväksyntä on avoin:** korjatun ehdokkaan palautussarjassa läpäisi
223 testiä ja neljä testiä ylitti nykyisen testikohtaisen aikarajan.
Niiden jälkeinen siivous epäonnistui myös; siivousvirhe ei korvaa ensivirhettä.
Yksi rajattu saman lähteen diagnostinen uusinta toisti kolme aikakatkaisua
ja läpäisi kaksi kontrollia. Hylkäykset koskevat sekä C:n että tavallisen
palautuksen polkuja, eikä niiden syytä ole vahvistettu. Testiehtoja tai
aikarajoja ei muutettu. Ensivirheet säilyvät, eikä uusinta tai onnistunut
käynnistyskoe hyväksy palautussarjan hylkäystä.
Erillinen yhden synteettisen forward-tapauksen tiedostotyön mittaus osoitti
lyhyiden lukutarkistusten kertautumisen. Se ei ole uusi hyväksyntäuusinta,
kaikkien aikakatkaisujen juurisyy tai lupa poistaa tuoreustarkistuksia.
Rajattu jatkosuunnittelu erottaisi omistajuus-/valintatarkistuksen raskaasta
sisältötarkistuksesta säilyttäen vaaditut julkaisu- ja mutaatiorajat;
tämän vaihtoehdon suunnittelu ja koe odottavat omistajan päätöstä.
Tuotantokytkentä vaatisi ensin sopimuksen ja kilpailuregressioiden todennuksen
sekä katselmuksen. Nykyiset aikarajat ja eheysvaatimukset säilyvät.
Jäljellä olevat raskaat aktiivivalidoinnit, koko K:n palautus- ja
resurssinäyttö sekä PR/main-portit säilyvät avoimina. Niiden eristetyn
käyttötapauksen valmistelu kuvataan [V2bj:ssä](release-0.3.0-profile-validation-history.md#m1-source-preparation-l5070).

<a id="m1-source-preparation-l5070"></a>

#### V2bj: Aktiiviprofiilin eristetyn tarkistuksen valmistelu

**Valmistelu on testattu; tuotantokutsujia ei ole vielä vaihdettu.**
`validateOwnedActiveProfile` käyttää nykyistä `ProfileSnapshotInspectionClient`-
porttia, installation-leasea ja täsmällisen operaation restore-kirjoitussuojaa.
Tavallinen startup vaatii `exactCurrentManifest`-tarkistuksen. Vain erikseen
sidottu C:n ennen-migraatio-palautus käyttää nykyistä `restoreCompatible`-
käytäntöä ja vaatii alkuperäisen ketjun täsmällisen vastaavuuden.
Muodostajan yhteensopivuusvalinta ei ohita backendin jo hyväksyttyä
schema-/katalogikäytäntöä. Uutta protokolla- tai schema-poikkeusta ei lisätä.

Tuloksena annetaan vain muuttumaton validointimetadata; se ei anna
palautus-, julkaisu- tai tiedostopoistovaltuutta. Käyttötapaus kuuluu
startupiin ennen UI:n avaamista. Epäonnistuminen vaatii omistavan kutsujan
hallitun runtime-sulun; helper ei yksin todista runtime-poissaoloa.
Fencen vapautus on viimeinen odotettava työ, ja lopulliset synkroniset
valtuus-/lineage-tarkistukset tehdään ennen installation-leasen vapautusta.
Puuttuva vapautuskuittaus ei ole onnistuminen. Virheessä lease pysyy
varattuna uudelleenkäynnistykseen asti, ja snapshot jää nykyisen asiakkaan
seurantaan; varmennettu asiakkaan shutdown saa siivota vain omistetun kopion.
Epävarma poistuminen tai omistajuus säilyttää aineiston. Myöhäinen vastaus
ei aloita uutta C-tarkistusta aikakatkaisun jälkeen. Ensisyy ja siivousvirhe
säilyvät erillisinä nykyisessä virheketjussa.

Rajattu katselmus löysi valmistelusta neljä korjattavaa valtuus-/cleanup-
kohtaa, jotka korjattiin ja katettiin regressioilla. Korjatun lähteen
90 kohdetestiä, desktopin tyyppitarkistus ja build läpäisivät. Neljän
tapauksen oikea utility-/native-varauskoe todensi nyky- ja metadataa vailla
olevan 038-kannan hyväksynnän sekä väärän ketjun ja muutetun scheman hylkäyksen,
prosessipoistumisen, omistetun siivouksen ja alkuperäisten tavujen säilymisen.
Snapshot-muodostus on tässä kokeessa hallittu; se ei hyväksy todellista
muodostajaa, backendin ennen-migraatio-kytkentää, koko main-startupia,
hardened-pakettia tai Linuxia. Viimeisen rajatun lähdekatselmuksen blocker
poistui, mutta tuotantokytkentä on katselmoimatta.

**Kytkentäeste:** [kokonaiskytkennän tarkistus](release-0.3.0-integration-history.md#m1-source-preparation-l958)
toisti ehdokkaan virheleasen ja rollbackin ristiriidan sekä päivityksen
jo omistaman leasen ristiriidan. Yllä kuvattu helperin virhesopimus ei siten
ole sellaisenaan hyväksytty kaikkien kutsujien sopimukseksi. Ratkaise
kutsujamatriisi ennen tuotantokytkentää; poista korvattu raskas validaattori
vasta vastaavan todellisen kutsujanäytön jälkeen. V2bi:n aikakatkaisut ja
hyväksytyn guard-/sisältötarkistuksen tuotantokytkennän todennus säilyvät
erillisenä avoimena työnä. Nykyisiä aikarajoja, riippuvuuksia, eheysvaatimuksia
tai koko K:n hyväksyntäportteja ei muutettu.

<a id="m1-source-preparation-l5115"></a>

#### V2bg: Aktivoinnin täsmällinen journal ja valtuus

**Rajattu activation-kytkentä; koko K:n hyväksyntä on avoin.** Valmistelu
tallentaa oman jäädytetyn `prepared@0`-kuittinsa ennen journalin julkaisua.
Readback vertaa kaikkia kenttiä tähän kuittiin eikä korjaa sivuslotteja tai
adoptoi pelkän operation-ID:n perusteella löytyvää journalia. Hylätty
kirjoitus voi olla julkaistu: readback tehdään myös hylkäyksen jälkeen,
ensivirhe säilyy ja epävarma tulos säilyttää stagingin recovery-omistuksen.
Vain todistettu journalin ja recovery-juurten poissaolo sallii retentionin
perumisen. Valmistelun alkuperäinen kutsumuoto säilyy sisarkuluttajille.

Transaktion initial-julkaisu vaatii current-, next- ja backup-slottien poissaolon
myös silloin, kun kutsuja ei anna erillistä valtuusfunktiota. Forward-julkaisu
sitoo aina edeltävän journalin ja oman uuden slotin jokaiseen julkaisuvaiheeseen;
kutsujan mahdollinen valtuus täydentää tätä sidontaa, ei kytke sitä päälle.
Vierasta sivuslottia ei
poisteta julkaisemisen tieltä. Julkaisun jälkeinen hylkäys säilyttää
palautusaineiston; se ei anna lupaa journalin takaisinpäinkirjoitukseen.
Tämä käyttää nykyistä installation-/writer-omistajuutta, eikä ole lupaus
käyttöjärjestelmätason compare-and-swapista tai suojasta saman tilin haittaohjelmaa vastaan.

Main välittää C:n täsmällisen update-valinnan activation-palveluun.
Live-valmistelu käyttää restore-maintenance-fenceä. Vasta varmennettu
runtime-stop sallii tiedostosiirrot; sen jälkeen omistajuus varmennetaan
mainin palautuneesta työtilavarauksesta, ei suljetun brokerin kutsulla.
Tavallisen jo käynnistyneen sovelluksen valtuus on sen elävän runtimen ja
single-instance-omistuksen valtuus, ei päättyneen startupin valtuus.
Aloitettu runtime-shutdown estää tämän polun.

Oman tavallisen forward-virheen jälkeen rollback saa vain täsmällisen
etenemän: operaation ja alkuperäisslottien liput säilyvät, revision ero
vastaa kanonisten forward-vaiheiden eroa ja tuore slot-census täsmää.
Sama matcher palvelee nykyistä startup-virhehaaraa; rinnakkaista
palautusjärjestelmää ei lisätä. Valinnan tai valtuuden menetys säilyttää
aineiston eikä anna kompensaatiolupaa. Alkuperäinen virhe ja mahdollinen
rollback-virhe pysyvät erillisinä. Cold-forward ei saa automaattista
rollbackia tämän live-kytkennän perusteella.

Todennus kattaa journalin julkaisun rajat, täsmällisen readbackin,
alkuperäisen syyn ja retentionin, oikean tiedostotransaktion keskeytyksen
ja sidotun rollbackin sekä tavallisen runtimen valtuuden startupin jälkeen.
Erillinen neljän tapauksen Electron-koe käyttää oikeaa business-backendiä,
inspection-utilitya, journalia ja varausluovutusta sekä valmiissa että
migraatiota odottavassa runtimessa. Kummankin onnistuva forward ja oman
keskeytyksen rollback erotetaan. Tämä ei todista koko mainin historiallista
journalitonta policy-valintaa, binaarihandoffia, Linuxia, hardened-
palautusta tai lopullista PR/main-integraatiota. Nämä säilyvät seuraavina
K-portteina, samoin vanhan raskaan aktiivivalidoinnin siirto nykyiseen eristettyyn porttiin.

Katselmuksessa löytynyt oletuskutsun julkaisun ohitus toistettiin ennen
korjausta sekä initial-sloteilla että muuttuneella forward-edeltäjällä.
Pelkkä sama operation-ID ei hyväksy muuttuneita alkuperäisslottien lippuja.
Nykyiset korvaus- ja migraatiokutsumuodot säilyvät tämän yhteisen suojan takana.
Ensivirheen järjestystä testaava readback-häiriö sidotaan forward-kutsun
todelliseen hylkäykseen, ei journalin vaiheeseen, joka näkyy jo julkaisun
jälkitarkistuksessa.

Lopullinen rajattu kohdekierros läpäisi 583 testiä kahdeksassa tiedostossa
ilman ohituksia; desktopin tyyppitarkistus ja build läpäisivät. Mukana ovat
korvauksen ja migraation nykyiset sisarkutsujat. Riippumaton rajattu katselmus
ja sen saman kierroksen korjausreadback eivät löytäneet jäljellä olevaa
ohitusta tai uutta regressiota tarkistetusta diffistä. Neljän prosessitapauksen
kaikki kahdeksan lapsiprosessia poistuivat onnistuneesti ja varaus palautui.
Kohdenäyttö ei korvaa tämän osion yllä nimettyjä koko K:n hyväksyntäportteja.

<a id="m1-source-preparation-l5180"></a>

#### V2bf: Journalittoman C:n valinnan jatkuminen

**Rajattu käynnistys- ja staging-sidonnan checkpoint.** Sen activation-
jatko on [V2bg](release-0.3.0-profile-validation-history.md#m1-source-preparation-l5115); koko K on avoin.
Main välittää alussa valitun update-journalin myös journalittomaan
`startIfRequired`-kutsuun. Eksplisiittinen poissaolo ei löydä uutta
operaatiota; luku ei korjaa sivuslotteja. Käynnistystulos sisältää saman
jäädytetyn journalin tai vain tämän oman täsmällisen starting-seuraajan.
Main käyttää tätä kuittia loppuvalidoinnissa eikä tee uutta valintaa.
Myös jo valmistunut journal säilyttää täsmällisen sidonnan ilman uutta
starting-kirjoitusta. Tilan, revision, operaation, palautuspisteen tai
samaversion pakettitiivisteen tai koon muuttuminen hylätään.

Starting- ja failed-safe-julkaisu käyttää nykyistä exact-selection-guardia
sekä mainin synkronista omistajuustarkistusta. Alkuperäinen palautusvirhe
säilyy ennen mahdollista journalin lisävirhettä. Valinta tarkistetaan
stagingin jälkeen ennen activation-kutsua. Kesken muuttunut valinta estää
tämän handoffin. Tämä alkuperäinen rajaus ei vielä suojannut activation-transaktion
sisäisiä journal-kirjoituksia tai poista sen omaa journal-valinnan aukkoa.
Tavallisen palautuksen kutsusopimus, turvallinen julkinen tapahtuma ja
hyväksyntäehdot säilyvät. Uutta loggeria, manageria tai riippuvuutta ei lisätä.

Korjatun checkpointin 437 kohdetestiä kuudessa tiedostossa, desktopin tyypit
ja build läpäisivät. Tavalliset journalittomat starting-/completed-kontrollit ja
vanhan palautusketjun regressiot säilyvät. Erillinen oikean backendin
neljän tapauksen koe todensi sidonnan restore-journalin poistumisen jälkeen
nyky-/038-aineistolla, mukaan lukien samaversion pakettikoon muutos.
Kaikki 20 omistettua lapsiprosessia poistuivat ja varaukset palautuivat.
Tämä koe antaa historiallisen restore-policyn eksplisiittisesti; se ei
vielä todista koko mainin historiallista journalitonta käynnistysvalintaa.
Katselmuksen löytämä väärä guarded-rollback-kutsu poistettiin ehdokkaasta;
se ei jää osaksi toteutusta. Tarkka palautusjournalin valinta ja valtuuden
säilyminen initial-/forward-julkaisun sisäisten awaitien yli olivat tämän checkpointin avoin jatko.
Ne vaativat oikean transaktion virhe- ja rollback-todisteen, eivät pelkkiä
service-mockeja. Nykyistä palautuspalvelua ei muutettu tässä checkpointissa.
Ennen backendin avausta vaadittava historiallisen journalittoman jatkon
policy-valinta, vanhan raskaan aktiivivalidoinnin siirto eristettyyn
tarkistukseen sekä lopullisen binary-handoffin sidonta ovat edelleen
avoimia. Activationin exact-journal- ja julkaisusopimuksen jatko on V2bg.
Tavallisen käynnistyksen schema-rajaa ei tämän työn perusteella
löysennetä. Koko mainin, Linuxin, suuren katalogin resurssipolun, hardened-
palautuksen, loppukatselmuksen ja PR/main-porttien näyttö vaaditaan erikseen.

<a id="m1-source-preparation-l5223"></a>

#### V2bd: Tarkistusvirheen jälkeinen rollback-valtuus

**Rajattu palautuksen virhehaaran kytkentä; koko K:n hyväksyntä on avoin.**
Epäonnistunut profiilitarkistus pysäyttää ensin omistetun backendin.
Main varmentaa myös tarkistusprosessien sulkemisen ja työtilavarauksen
palautumisen ennen tuoretta alkuperäissisällön tarkistusta. Sama nykyinen
alkuperäisinspektori, maintenance-lease sekä paikallaan pysyvän ankkurin ja
siirtyvien juurten native-varaukset palvelevat kylmäkäynnistystä ja tätä
virhehaaraa; uutta palautus- tai tarkistusjärjestelmää ei lisätä.

`validationStarting@r` voi edetä vain saman operaation
`rollbackStarting@r+1`- ja `rolledBack@r+2`-tiloihin. Alkuperäinen sisältö,
journal ja varaukset tarkistetaan ennen korjaavaa journal-lukua,
rollback-intentin julkaisua ja tiedostosiirtoja. Ennen intentiä alkuperäiset
slotit ovat rollback-juuressa tai journalin mukaisesti poissa; siirtoja ei
saa jo olla tehty. Tarkistusankkurin luominen ei yksin anna mutaatiolupaa.
Lykätty päätös käyttää samaa recovery-instanssia eikä nollaa sen tilaa
uudella startup-valmistelulla. Aloitettu tai epävarma hyväksyntä estää
rollbackin. Alkuperäiskannan poissaolo ei valtuuta tyhjän business-kannan
luontia. Ensivirhe ja rollback-/sulkuvirhe säilyvät erillisinä.
Puuttuva rollback-valtuus hylätään myös suorassa startup-kuluttajassa;
valtuudeton fallback ei korvaa tuotannon kytkentää. Valtuuden voimassaolo
tarkistetaan uudelleen viimeisen asynkronisen journal-lukemisen jälkeen.

Molemmat mainin palautuskuluttajat käyttävät tätä valtuutta. Hylätty valtuus
estää myös yleisen työtilapalautuksen kautta tapahtuvan uuden runtimen
valinnan. Myös onnistunut tiedostorollback, joka palauttaa alkuperäiskannan
poissaolon, lukitsee tämän yleisen runtimen palautuspolun; yritysrekisteri
ja journal säilyvät selvitystä varten. C:n ennen migraatioita toimiva virhehaara tarkistaa lisäksi saman
jäädytetyn update-journalin valtuuden odotusten ja sisältötarkistuksen yli.
Tämän jälkeinen valmistumis- ja virhekirjoituksen sidonta on toteutettu
rajatusti [V2be:ssä](release-0.3.0-profile-validation-history.md#m1-source-preparation-l4893).
Journaliton jatko ja koko palautusketjun hyväksyntä ovat edelleen avoinna.

Kohderegressiot kattavat alkuperäissisällön hylkäyksen, vanhentuneen
journalin tai sisällön, pysäytysvirheen, täsmällisen revisioetenemän ja
normaalin palautumisen. Kuuden tiedoston kohdesarja läpäisi 428 testiä ilman
ohituksia. Katselmuksen kolme rajattua havaintoa toistettiin ennen niiden
korjausta; ensihylkäykset säilytettiin. Oikean utility-/native-ketjun neljä tapausta
kattavat molemmat palautuslayoutit sekä nykyisen ja historiallisen 038-
aineiston; 14 poistumista ja varausten palautumista varmennettiin.
Tässä prosessikokeessa business-backendin pysäytys on kontrolloitu,
ei koko mainin tai paketoidun sovelluksen todiste. Composition-testit
todentavat erikseen molemmat kuluttajat sekä C:n virhehaaran ja
update-journalin muutoksen. Hardened-paketti, Linux, suuren katalogin
resurssinäyttö, loppukatselmus sekä PR/main-portit säilyvät avoimina.
Desktopin tyyppitarkistus ja build läpäisivät korjatulla lähteellä.
Rajattu riippumaton jatkokatselmus vahvisti kolmen havainnon korjaukset;
niihin ei löytynyt uutta konkreettista regressiota. Korjattu build toisti
yllä kuvatun neljän utility-/native-tapauksen näytön. Tämä katselmus ja
prosessikoe eivät korvaa koko K:n loppukatselmusta tai paketoitua ajoa.

<a id="m1-source-preparation-l5275"></a>

#### V2bc: C:n alkuperäisketjun terminal

**Rajattu ennen migraatioita toimiva kohdenäyttö; koko C/K-kytkentä on kesken.**
C:n `businessRollbackStarting`- ja restore-journalin valinta sidotaan
täsmälliseen operaatiopariin. Käynnistysinspectionin on osoitettava olemassa
oleva kanta ja journalin alkuperäinen `preUpdateMigrationChainIdentity`
ennen palautuksen hyväksyntää tai siivousta. Jäädytetty update-journal
sisältää myös paketti-identiteetit; muutos async-tarkistuksen aikana estää
terminalin. Jo hyväksytty restore-journal saa saman erillisen C-jatkon eikä
hyväksyttyä sisältöä palauteta takaisin siivouksen epäonnistumisen vuoksi.

Tavallinen live-terminal käyttää edelleen `exactCurrentManifest`-policya.
C käyttää eristetyn tarkistimen olemassa olevaa `restoreCompatible`-policya
sekä täsmälleen journalin alkuperäistä ketjua, ei mielivaltaista prefixiä.
Clientin nimenomainen `createRestoredProfileSnapshot` vaatii saman operaation
restore-kirjoitussuojan sekä voimassa olevan kanavan ennen ja jälkeen
odotuksen. Brokerin snapshot-pyyntö käyttää entistä
`compatibleHistoricalPrefix`-arvoa; protokollaa ei laajenneta. Snapshotin
luontipolicy ja tarkistimen policy pidetään erillisinä ja receipt sidotaan
juuri valittuun tarkistuspolitiikkaan. Tavallinen snapshot-kutsu ei hyväksy
restore-policya eikä heikompaa kuittia.

Backendin aktiiviprofiilin ja snapshot-katalogin schema-reader käyttää
palautuksen jo hyväksyttyä käynnistyspolicya vain `beforeMigrations`-gaten
aikana. Gaten päättyminen palauttaa tiukan policyn myös virheessä. Portti
ei luo legacy-metadataa tai aja migraatioita; tavallisen business-käynnistyksen
nykyisen historian ja nolla-pending-tarkistus säilyy. Muuten metadataa vailla
oleva kelvollinen 038-kanta hylkäytyisi tämän lukijan kautta, vaikka kylmä
palautus ja ensimmäinen käynnistysinspection olisivat hyväksyneet sen.

Kohdesarja läpäisi 237 desktop-testiä viidessä tiedostossa ja erillinen
backend-sarja 24 testiä kolmessa tiedostossa ilman ohituksia. Molempien
alueiden tyyppitarkistukset ja build läpäisivät. Composition-regressiot
kattavat tavallisen ja accepted-C-jatkon, alkuperäisketjun poikkeaman ja
update-journalin muutoksen odotuksen aikana. Backendin reset-kontrolli käyttää
samaa kelvollista metadatatonta 038-schemaa ennen gatea ja sen päätyttyä,
eikä vain poistettua metadataa nykyisestä schemasta.
Rajattu riippumaton katselmus tarkisti C-kytkennän, snapshot-clientin
policy-/kanava-/valtuusrajat ja backendin policy-resetin. Katselmuksen
löytämä liian heikko reset-testin loppukontrolli korjattiin ja tarkistettiin
uudelleen. Lopullisessa rajatussa jälkikatselmuksessa ei löytynyt uusia
korjattavia puutteita; tämä ei ole koko K:n loppukatselmus.

Kaksi normaalia ja kaksi jo hyväksytyn osittaisen siivouksen tapausta
läpäisivät oikean backendin käynnistysgaten, snapshot-brokerin, eristetyn
tarkistimen ja native-varaukset. Nykyinen ja metadataa vailla oleva 038-kanta
katettiin; kaikki 20 utility-/backend-poistumista ja varausten palautumiset
varmennettiin. Business-palautuksen valmistuminen ja startupin hallittu
pysäytys toteutuivat ennen eteenpäin vieviä migraatioita. Accepted-koe alkaa
synteettisestä jo hyväksytystä tilasta, ei todellisesta kaatumisesta.
Kaksi policy-hylkäystä paljastivat yllä korjatut lukuketjujen erot;
accepted-kokeen erillinen fixture-hylkäys johtui peittyneestä tilalipusta.
Ensihylkäykset säilytettiin eikä tuotannon hyväksyntäehtoja lievennetty.

Näyttö yhdistää oikeat C-palvelut ja backendin gaten, mutta ei ole koko mainin
tai oikean binaariasentimen koe. Mainin composition-testi käyttää
kontrolloitua inventory-valmistelua ja binaarihandoffia. V2bc:n jälkeen
epäonnistuneen live-validoinnin rollback-valtuus on kytketty [V2bd:ssä](release-0.3.0-profile-validation-history.md#m1-source-preparation-l5223).
Update-valinnan valmistumiskirjoitus on tämän jälkeen rajatusti kytketty
[V2be:ssä](release-0.3.0-profile-validation-history.md#m1-source-preparation-l4893). Journaliton jatko ja
jäljellä olevien raskaiden aktiivisten validatorien siirto eristettyyn porttiin
säilyvät seuraavina töinä. Linux,
suuren katalogin terminal-resurssinäyttö, hardened-paketti ja PR/main-portit
pysyvät avoimina. Tämä checkpoint ei sulje S030-01/S030-02:ta tai koko K:ta.

<a id="m1-source-preparation-l5340"></a>

#### V2ay: C:n palautuskutsujan sisäinen ensisyy

**Rajattu K3-korjaus työpuussa; ei offline- tai terminal-hyväksyntä.**
`UpdateBusinessRollbackCoordinator` säilyttää aktivoinnin tai palautetun
profiilin tarkistuksen alkuperäisen poikkeuksen sisäisen `Error.cause`-
sidonnan kautta. `failedSafe`- tai `recoveryRequired`-journalin lisävirhe
säilyy erillisessä järjestetyssä haarassa eikä peitä ensivirhettä tai estä
turvallisen failure-tapahtuman yrittämistä. Restore-transactionin tekemän
rollbackin jälkeinen journalivirhe säilyy saman yleisen recovery-virheen
sisäisenä syynä. Kirjoituksen epäonnistuminen ei todista durable-tilasiirtymää.
Ulompi viesti, update-tapahtumien yleiskoodi, hyväksyntäjärjestys ja
onnistuneen palautuksen käytös eivät muutu. Raakaa syyketjua ei julkaista.

Yhdeksän uutta regressiota toisti puutteen ennen korjausta. Lopullinen
227 testin kohdesarja yhdeksässä tiedostossa sisältää koordinaattorin
19 testiä ja säilytti myös live-palautuksen, startup-compositionin ja
nykyiset päivityspolut. Katselmuksen testitäsmennys tarkistaa alkuperäiset
olioviitteet, hyväksyntäjournalin kirjoitusvirheen sekä onnistumisen
observerhäiriöstä huolimatta. Tuntematon ensisyy ei luokitu lisävirheen
perusteella. Tyyppitarkistus, desktop-build ja rajattu riippumaton katselmus
läpäisivät. Todellisen journal-kirjoituksen osittainen onnistuminen ei saa
erillistä näyttöä näistä kontrolloiduista porteista. Kohdetuloksia ei summata
V2aw:n tai aiempien K-vaiheiden hyväksyntänäytöksi.

**C:n seuraavan kytkennän nykyinen lähdereitti:** main kokoaa palautuspisteen
staging-palvelun ja aktivointipalvelun samoihin omistajiin kuin muu palautus.
`beforeMigrations` kutsuu business rollback -koordinaattoria; stagingin
onnistuminen ei hyväksy palautusta. Palautetun profiilin erillinen
sisältö-/chain-tarkistus vaaditaan ennen `businessRollbackCompleted`-tilaa,
startup-backendin sulkua ja binaaripalautuksen omistajan kutsua. Nykyinen
broker- ja tarkistusclient-kytkentä ei itsessään todista K:n cold/offline-
mutaatiovaltuutta. Valittu update-journal, restore-journal, tuore valtuus ja
todellinen exit/reclaim pitää todistaa tämän callerin kautta. Älä korvaa
pending-startupin nimettyä sulkua valmiin backend-kahvan sululla tai rakenna
rinnakkaista schema-/PDF-validointia. V2ax:n avoimet päätökset, oikean
palautusketjun näyttö ja koko K:n hyväksyntäportit säilyvät.

<a id="m1-source-preparation-l5377"></a>

#### Muut avoimet K-päätökset

Omistaja hyväksyi 10.10.2026 alla olevat kolme rajattua tuotantopäätöstä.
Päätösportit ovat ratkaistut; niiden toteutus ja hyväksyntänäyttö eivät vielä
ole valmiit. Aiempi tarkistuskopion tai käännöskokeen lupa ei yksin hyväksynyt
niitä. Yllä oleva paikallisen hot-journal-palautuksen poikkeus säilyy erillisenä
tuodun varmuuskopion tarkistuksesta.

**Julkaistun kohteen hyväksytty rajaus:** ADR-0011:n nykyinen `invalidHistory`
voi johtaa passiivisen yrityksen registry-siirtymään `recoveryRequired`.
Kun koko schema/history ei ole luotettu, identityä ei voida lukea ensin
vain tämän luokituksen säilyttämiseksi. Omistaja hyväksyi rajatun
fail-closed-vaihtoehdon: tällainen hylkäys keskeyttää koko inventaarion ennen
registry-muutosta; todennetun scheman sisältövirhe säilyttää entisen
luokituksen. Tiedostot säilytetään; yhden epäluotettavan työtilan vuoksi
normaali käynnistys voi estyä selvitykseen asti. Kytkentä ja ADR:n vastaava
tarkennus on toteutettu [V2t:ssä](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3233);
sen kohdenäyttö ei hyväksy koko K:n integraatiota.

**K-P2:n hyväksytyn runtime-päätöksen peruste:** nykyisen lukitun `better-sqlite3`-ajurin
`SQLITE_DEFAULT_MEMSTATUS=0` poistaa muistiseurannan oletuksena. Erillinen
synteettinen prosessikoe osoitti, ettei positiivinen `hard_heap_limit`-
readback yksin todista valvontaa. Tämä vastaa [SQLiten dokumentoimaa
rajoitusta](https://www.sqlite.org/c3ref/hard_heap_limit64.html).
Valmisteltu utilityn alustustarkistus hylkää tämän ajurin ennen tuodun
tietokannan avausta; sitä ei ole kytketty nykyiseen aktiiviseen backendiin.
Hylkäysregression läpäisy ei ole hyväksytyn muistibudjetin läpäisy.
Ennen K2:n sulkemista tarvitaan hyväksytty toteutustapa ja sekä rajan ylityksen
torjunta että tavallisen aineiston läpäisy oikeassa paketoidussa runtimessa.
Omistaja hyväksyi 9.10.2026 rajatun, eristetyssä koekansiossa tehtävän saman
`better-sqlite3@13.0.2`-version käännös- ja muistirajakokeen. Koe muuttaa vain
muistiseurannan käännösasetusta ja käyttää synteettistä aineistoa. Lähteen
eheys, todellinen rajan ylityksen torjunta ja normaalin kyselyn läpäisy
varmennetaan erikseen. Hyväksyntä ei anna lupaa korvata nykyistä
esikäännettyä ajuria, asentaa uusia järjestelmätyökaluja tai kasvattaa budjettia.
**Rajattu koenäyttö (9.10.2026):** saman ajuriversion muistiseurannalla
käännetyn ehdokkaan kontrollitapaukset läpäisivät sekä Node-prosessissa
että Electron-utilityssa. Hyväksytyn SQLite-muistirajan ylitys torjuttiin
`SQLITE_NOMEM`-virheellä; normaali synteettinen vain-luku-kontrolli läpäisi
myös ylitysyrityksen jälkeen. Todellinen utility-exit todennettiin.
Koe ei korvannut projektin ajuria, manifestia tai lukitusta.

Tämä kohdenäyttö ei todista koko prosessin RSS-kattoa, kaikkien tuettujen
profiilien läpäisyä, Linux-vastinetta tai hardened-paketin hyväksyntää.
Tuotantotapa hyväksyttiin erikseen 10.10.2026: tarkistusajurin rajaus ja toimitus,
toistettava käännös, eheyssidos, ylläpito sekä nykyiset paketti-/runtime-/
yhteensopivuusportit ovat alla olevan toimitussopimuksen mukaiset.
Kokeen lupa ei hyväksy aktiivisen business-ajurin vaihtamista tai
muistibudjetin kasvattamista. Kokeen tulos ja tuotantotavan päätös
pidetään erillisinä; ensimmäinen epäonnistuminen säilytetään erillään
myöhemmästä hyväksytystä kohdenäytöstä.
Utility, varausluovutus, broker-v10, V2c ja packaged-/PR-/main-portit ovat
edelleen avoinna. Kokonaisuutta ei julkaista tässä välitilassa.

<a id="m1-source-preparation-l5431"></a>

#### K-P2:n tarkistusajurin toimitusehdotus

**Hyväksytty tuotantorajaus 10.10.2026; toteutus ja portit avoinna.** Sopimus koskee
vain K-P2:n lyhytikäisen tarkistusutilityn SQLite-ajuria. Nykyinen
`better-sqlite3@13.0.2`, Electron, tietokantamalli, backup-formaatit ja
aktiivisen business-runtimen oletusajuri säilyvät. Nykyinen
[prebuild-paketointisääntö](local-desktop-dependency-review.md#electron-43-ja-better-sqlite3)
säilyy business-ajurille. Omistajan hyväksymä poikkeus sallii vain alla
olevan erillisen tarkistusajurin käännöksen ja toimituksen. Uusia
järjestelmätyökaluja ei asenneta tällä luvalla.

1. **Lähde ja käännös.** Käytä saman lukitun ajuriversion eheydellä
   varmennettua upstream-lähdettä sekä nykyistä hyväksyttyä addon-api-lähdettä
   erillisessä build-kansiossa. Ainoa tarkoitettu lähdepoikkeama on
   `SQLITE_DEFAULT_MEMSTATUS=1`. Lukitse käännöksen syötteet, rajattu patch,
   kohdealusta ja työkaluketju sekä tallenna syntyneen tiedoston koko ja
   tiiviste build-todisteeseen. Kääntäjän metatieto voi erota upstream-
   prebuildistä; ero nimetään eikä väitetä kaikkien asetusten tai binääritavujen
   olevan samoja. Ei pnpm-varaston muokkausta, lifecycle-asennusta,
   C++-forkkia, `prebuild-install`-palautusta tai loppukäyttäjän koneella
   tehtävää käännöstä. Puuttuva käännöstyökalu on uusi päätösportti.
2. **Toimitus ja alkuperä.** Erillinen inspection-native-tiedosto sijoitetaan
   vain buildin omistamaan tarkistusresurssiin; se ei korvaa paketin
   `prebuilds`-tiedostoja. Main ratkaisee kiinteän tarkistusentrypointin ja
   ajuripolun omasta varmennetusta resurssijuurestaan. Backendin nykyiset
   build-metadata- ja paketti-inventaariotyökalut laajennetaan kattamaan
   tarkistusresurssin alkuperä, kohdealusta, koko, tavut ja erillinen vastuu.
   Resurssin mukana ei toimiteta build-työkaluja, lähdearkistoa, profiilia
   tai kokeen tietokantoja. Native-tiiviste todistaa tavujen sidonnan,
   ei julkaisijan luottamusta. Yksi testattu output säilyy samoina tavuina
   seuraaviin pakettiportteihin asti.
   Kääntäjän omistettu välituote kopioidaan ennen latausta yksilinkkiseksi
   erilliseksi tiedostoksi. Mahdollinen kääntäjän sisäinen linkkipari
   varmennetaan täsmällisinä niminä ja identiteetteinä ennen ja jälkeen
   kopioinnin; tuntematon linkki ei ole poikkeus toimitusrajaan.
3. **Lataus ja kaikki yhteydet.** Nykyisen ajurin oma `nativeBinding`-
   rajapinta sallii erillisen tiedoston latauksen muuttamatta oletusajuria.
   Tarkistusutilityn rajattu yhteydenluonti käyttää tätä valintaa pakollisesti:
   budjettia alustava muistiyhteys, tuodun kannan readonly-yhteys ja luotetun
   migration-scheman muistiyhteys käyttävät samaa valvottua ajuria. Nykyiset
   `profileInspectionSqlite.ts`, `inspectStagedProfileSnapshot.ts`,
   `inspectSqliteProfileDatabase.ts` ja `migrationSchemaReference.ts`
   tarkistetaan tämän yhteydenluonnin kuluttajina. Pelkkä ensimmäisen
   yhteyden vaihto ei riitä. Utilityssa ei sallita oletusprebuild-fallbackia;
   business-runtimen composition ja ajurivalinta eivät muutu. Tuotu aineisto,
   renderer tai broker-pyyntö ei valitse executablea, ajuripolkua tai
   käännösasetuksia.
4. **Rajan toiminta ja omistajuus.** Varmenna ajurin identiteetti ja
   muistiseuranta ennen tuodun tiedoston avausta. SQLite-rajan readback sekä
   todellinen ylitysvirhe ovat eri todisteet. Säilytä K-P2:n 256 MiB SQLite-,
   512 MiB V8-, 35 000 ms työ- ja nykyiset sulkubudjetit. V8/SQLite eivät
   todista koko prosessin RSS-kattoa. Varausluovutus, yksi terminal,
   havaittu exit ja mainin palautunut varaus vaaditaan edelleen ennen
   tuloksen hyväksyntää, cleanupia tai uudelleenkäyttöä. Ajurin vaihtaminen
   ei itsessään korjaa näitä prosessiehtoihin liittyviä puutteita.
5. **Pienin toimitustodistus.** Testaa puuttuva, väärän alustan tai
   ristiriitainen ajuri sekä oletusfallbackin esto; nämä eivät avaa tuodun
   kannan tiedostoa. Todista erillisessä oikeassa utilityssa budjetin
   ylityksen torjunta ja nykyisen sekä tuetun historiallisen synteettisen
   profiilin läpäisy samalla ajurilla. Varmenna readonly, kaikki omistetut
   sulut/exit, lähteen muuttumattomuus sekä aktiivisen backendin normaali
   luku/kirjoitus muuttumattomalla ajurilla. Windowsin paketoitu output ja
   nykyinen Linux-CI tarvitsevat kumpikin oman lähde-/ajuri-/runtime-
   todisteen; Windows-koe ei hyväksy Linuxia. Sen jälkeen vaaditaan K:n
   kuluttajamatriisi, hardened backup -> inspect -> restore -> restart ->
   compare, riippumaton katselmus sekä täsmällisen revision PR/main-portit.

**Ylläpitoraja.** Ajuriversion tai lähdeasetusten myöhempi muutos avaa tämän
rajatun native-todennuksen uudelleen. Ei lupa päivittää muita riippuvuuksia,
nostaa rajoja tai jättää epäluotettua SQL:ää aktiiviseen backendiin. Lähde-
ja toimitusrajaus sekä tarvittava dokumentointipoikkeus on hyväksytty;
nykyisiä dependency-, runtime- ja testausohjeita päivitetään toteutuksen
mukana vain hyväksytyltä osalta. Hot-journal-palautus ja julkaistun kohteen
schema-hylkäyspolitiikka ovat erikseen hyväksyttyjä, mutta niiden toteutus
ja regressiotodennus pysyvät omissa paloissaan.

Tämä osio tarkentaa roadmapin K:ta, ei luo
rinnakkaista työjonoa.

| Raja | Nykyinen lähde ja valmisteluhavainto | Korjauksen vaatimus |
| --- | --- | --- |
| K1 / S030-01 | Backendin `inspectSqliteProfileDatabase.ts` tarkistaa eheyttä, viitteitä ja migration-historiaa, mutta ei vertaa kannan todellisia objekteja ja SQL-määrittelyjä hyväksyttyyn schemaan ennen business-relaatioiden lukemista. | Todennetaan versionmukainen schema ennen epäluotettuja relaatiokyselyitä, kirjoitettavaa avausta tai migraatiota. Salattu container, checksum, readonly ja migration-ledger eivät yksin täytä tätä rajaa. |
| K1:n muut kuluttajat | Import ja korvaus käyttävät `runWorkspaceCandidateOperation.ts`:n kopioitua, kirjoitettavasti avattua kantaa. Julkaistun kohteen tarkistus sekä `app.ts`:n palautuskäynnistys tarvitsevat oman kattavuutensa. | Pelkkä Inspectin helperin muutos ei sulje K1:tä. Todiste sidotaan tarkistettuihin tavuihin myös uudelleenavauksen, kopion, migraation ja julkaisun yli; nykyiseksi migroitunut rakenne tarkistetaan uudelleen. |
| K2 / S030-02 | Tavallisen Inspectin `stageValidatedProfileBackup.ts` kutsuu private brokeria; `app.ts` kytkee `StagedProfileSnapshotValidationService`-palvelun aktiiviseen backendiin. Sen SQLite-tarkistukset ovat synkronisia. `ProfileSnapshotBrokerClient`-aikakatkaisu poistaa odottajan, ei keskeytä kyselyä. | Epäluotetun tarkistuksen työ eristetään business-runtimesta. Wall-clock-, resurssi- ja tulosrajat sekä todettu prosessin päättyminen ovat eri velvoitteita. |
| K2:n siivous | Inspectin ja stagingin virhepolut poistavat tarkistustiedostoja; broker-vastauksen aikakatkaisu ei itsessään todista niiden käyttäjän päättymistä. | Sama operaation omistaja todistaa tarkistusprosessin päättymisen ennen cleanupia tai uudelleenkäyttöä. Ensivirhe ja siivoustulos säilyvät erillisinä; epävarma siivous säilyttää aineiston. |

<a id="m1-source-preparation-l5517"></a>

#### K:n toteutussopimus: rakenne ennen sisältöä

**Hyväksytty K-P1 (9.10.2026).** Backendin database/infrastructure omistaa yhden
schema-tarkistuksen. Se muodostaa odotusrakenteet tyhjään muistissa olevaan
tietokantaan sovelluksen omasta, muuttumattomasta SQL-manifestista ja
`migrationMetadata.ts`:n omistamista teknisten taulujen määrittelyistä.
Tuodun kannan SQL:ää ei suoriteta odotusrakenteen muodostamiseksi.
Migraatioita ei kopioida käsin toiseen DDL-luetteloon. Ei uutta SQL-parseria,
riippuvuutta, business-migraatiota, backup-formaattia tai tuodun kannan
uudelleenrakennusta. Odotuskanta on hetkellinen tekninen apu, ei uusi
varmuuskopioitava business-artifacti.

Tarkistusjärjestys on seuraava:

1. Validoi omistettu tiedosto ja juuren identiteetti nykyisillä path/type/link-
   säännöillä. Avaa tarkistettava SQLite vain lukuun. Ota `trusted_schema=OFF`
   ja `query_only=ON` käyttöön ennen tietokantarelaatioiden kyselyjä;
   laajennuksia tai tuotuja SQL-funktioita ei rekisteröidä.
   Ainoa tätä avausta edeltävä kirjoittava poikkeus on erikseen hyväksytty
   [oman paikallisen työtilan natiivi kaatumispalautus](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3281).
   Tuotu backup tai staging ei saa poikkeusta.
2. Lue ensin vain rajattu `main.sqlite_schema`-inventaario. Varmista ledgerin
   ja mahdollisen metadata-taulun todellinen rakenne ennen niiden rivejä.
   Rivi- ja merkkijonobudjetit johdetaan luotettujen odotusrakenteiden
   enimmäiskoosta; ylimääräinen rivi tai liian suuri määrittely hylätään
   ennen suurten arvojen materialisointia. Ei rajaamatonta `.all()`-lukua.
3. Tarkista ledgerin ja metadatan rajatut rivit nykyisellä manifesti- ja
   prefix-sopimuksella. Kutsuja valitsee yhteensopivuuspolitiikan, ei backup.
   Vertaa sitten koko objektijoukko valitun hyväksytyn prefixin rakenteeseen.
4. Vertaa täsmällisesti `type`, `name`, `tbl_name` ja SQLiten tallentama `sql`.
   Fyysinen `rootpage` ei ole sama asia kuin looginen schema eikä sitä
   verrata. SQLite-autoindeksien `sql=null` on sallittu vain vastaavan
   luotetun objektin kohdalla. `sqlite_*` ei ole yleinen ohituslista.
   Ylimääräinen tai puuttuva table/index/trigger/view sekä muutettu SQL
   hylätään; nykyinen tuotantoschema ei tarvitse view- tai virtual table
   -poikkeusta. Litteraaleja, ehtoja, lainausmerkkejä tai välilyöntejä ei
   normalisoida arvaamalla. Historiallinen esitystapa hyväksytään vain
   luotettuun julkaisuun sidotulla erikseen todennetulla vastineella.
5. Vasta tämän jälkeen tehdään nykyiset integrity-, foreign-key-, identity-,
   moduulisisältö- ja artifact-tarkistukset. FK-virheistä riittää ensimmäinen
   rajattu havainto. Katalogin SQL-rivit ja niiden tekstikentät rajataan
   ennen materialisointia; nykyiset PDF-tavu-, hash- ja kokotarkistukset
   säilyvät. Schema-todiste ei korvaa sisältövalidointia.

SQLiten oma [schema-taulu](https://www.sqlite.org/schematab.html) on
inventaarion lähde, ei todiste luottamuksesta. `trusted_schema=OFF` on
[lisäsuoja](https://www.sqlite.org/security.html), ei korvaava
trigger-/constraint-vertailu. Kaikkien triggerien poistaminen olisi väärin:
ALV-, maksu-, numerointi- ja revisioguardien on säilyttävä.

**Historiallinen yhteensopivuus.** Nykyinen manifesti on 001-039.
Metadatallinen täsmällinen prefix voi läpäistä migration-historian, mutta
profiilin hyväksyntä tarvitsee edelleen käyttötapauksen identity- ja
artifact-sopimukset. `exactCurrentManifest`-nimi ei yksin kerro, vaatiiko
kutsuja kaikki nykyiset migraatiot vai salliiko käynnistys vielä pending-
migraatioita; nämä nykyiset ehdot säilytetään erillisinä.
Metadatatonta restore-poikkeusta ei laajenneta: vain nykyinen nimetty
038-anchor kelpaa `restoreCompatible`-valtuudella. Virheellinen metadata
ei muutu poikkeukseksi. Uuden tyhjän kannan schema sallitaan vain nykyisessä
työtilan luonti-/alustuspolussa, ei valmiina tuotuna backupina.

**Sidonta käyttöön asti.** Tarkistuspalvelu palauttaa suljetun, vain
prosessien sisäisen kuitin: operation, generation, valittu policy,
migration-chain, DB:n todellinen koko/hash sekä artifact-katalogin
nykyinen sisältösidonta. Kuitin profile-/hash-tiedot eivät kuulu julkiseen
lokiin tai Diagnosticsiin. Omistettu staging pysyy varattuna tarkistuksesta
kopiointiin tai aktivoinnin luovutukseen asti. Kopion todelliset tavut
verrataan lähteeseen; jokainen kirjoittava avaus tekee lisäksi schema-
tarkistuksen samassa yhteydessä ennen business-lukua tai migraation DDL/DML:ää.
Migraation jälkeen tarkistetaan uusi nykyinen schema ja koko sisältö uudelleen.
Vanhentunut kuitti, vaihtunut generation, polkuidentiteetti tai tavut
hylätään. Aktiivista WAL-kantaa ei sidota pelkän päätiedoston hashilla:
sen snapshot syntyy vain nykyisellä SQLite backup -API:lla.

| Kuluttaja | K1:n pakollinen sijoitus | K2:n työn omistaja |
| --- | --- | --- |
| Tavallinen Inspect ja restore-staging | Autentikointi/purku -> schema -> sisältö -> manifestin vastaavuus. Ei aktiivisen yrityksen tietokantakyselyitä tuodulle kannalle. | Uusi rajattu tarkistusutility, native-main omistaa operaation. |
| Portable backupin ja recovery pointin itsevalidointi | Sama tarkistin myös omalle snapshotille; oma alkuperä ei ohita eheyttä. | Sama tarkistusportti; nykyinen maintenance ja C:n update-sidonta säilyvät. |
| `prepareProfileRestoreActivation` | Tarkista staging ja sidonta uudelleen ennen nykyisen activation-sisällön valmistelua. | Sama utility saa kopioida vain tämän operaation uuteen activation-stagingiin nykyisellä materialisointipalvelulla; SQLite pysyy readonly. |
| Import uutena ja same-lineage-korvaus | Tarkista lähde ennen kopion kirjoittavaa avausta, kopio ennen migraatiota, nykyinen schema ja PDF-katalogi migraation jälkeen. | Nykyinen eristetty workspace candidate; C:n writer-varaus ei muutu. |
| Julkaistu candidate, migraatioinventaario ja cold recovery | Todista julkaistun kohteen schema/content ennen registry-/journal-päätöstä ja normaalia avaamista. | Nykyinen candidate-/käynnistysomistaja; samoja backend-helper-portteja käytetään. |
| `app.ts`:n restore-/rollback-/normaali käynnistys | Olemassa olevan tiedoston readonly-esitarkistus ennen kirjoittavaa avausta, sitten saman yhteyden tarkistus ennen migraatiota ja healthia. Uusi tyhjä kanta erotetaan. | Desktopin käynnistysomistajan rajattu valmistelu ennen business-readinessia; ei luottamista pelkkään journalin vaiheeseen. |

Normaalia käynnistystä ei muuteta kaikkien PDF-tavujen uudeksi skannaukseksi.
K1:n esitarkistus kohdistuu schemaan ja historiaan; kokonainen
backup-/artifact-tarkistus pysyy nykyisissä sitä vaativissa palautusporteissa.
Mahdollinen suora backend-käynnistys ei saa kiertää ennen migraatiota
tehtävää tarkistusta. Schema-tarkistus ei lupaa suojaa samanaikaisesti
samalla käyttöjärjestelmätilillä toimivalta haittaohjelmalta; ADR-0009:n
uhkamallin rajaus säilyy.

<a id="m1-source-preparation-l5608"></a>

#### K:n toteutussopimus: eristetty tarkistus ja siivous

**Hyväksytty K-P2 (9.10.2026).** Electron main käynnistää yhden lyhytikäisen utilityn
kiinteästä paketoidusta entrypointista. Backendin puhdas tarkistuspalvelu
suorittaa schema- ja sisältötyön siinä. Utility ei käynnistä HTTP-palvelua,
avaa aktiivista profiilia, peri session-/SMTP-salaisuuksia tai luo lapsiprosesseja.
Se ei aja tuotuja komentoja. Tämä on aktiivisen backendin kuorman eristys,
ei väite erillisestä käyttöjärjestelmäsandboxista.

Nykyinen `StagedProfileSnapshotValidationService` erotetaan aktiivisen
yrityksen kontekstin luvusta. Kevyt private broker -operaatio palauttaa vain
nykyisen sallitun tarkistuskontekstin. Sama palvelun julkinen lopputulos
koostetaan mainissa; profiilin vaihto tai vanhentunut runtime-generation
mitätöi tuloksen. Restore-aktivointi tarkistaa kontekstin uudelleen nykyisen
maintenance-suojan alla. C:n `updateMaintenanceOperationId` tarkistetaan
edelleen omistavassa backendissä ennen työn luovutusta ja onnistumisen
hyväksymistä; yhteyskatko ei vapauta update-kirjoitussuojaa.
Alkuperäinen private brokerin kontekstilaajennus nosti version 9:stä 10:een,
ja palautuksen maintenance-sopimus version 11:een. Korvattujen raskaiden
operaatioiden lopullinen poisto käyttää versiota 12; lähettäjä, parseri,
vastaanottaja ja testit päivittyvät yhdessä. Vanhaa versiota tai raskaita
komentoja ei hyväksytä yhteensopivuusfallbackina.
Rendererin backup-capability ja durable-formaatit eivät vaihdu.

| Raja | Suunniteltu ensimmäinen toteutus ja todennus |
| --- | --- |
| Rinnakkaisuus | Enintään yksi tarkistusutility installation-omistajaa kohti. Uusi rinnakkainen pyyntö saa nykyisen busy/unavailable-palautteen; ei rajatonta jonoa. |
| Työaika | Tarkistuspyynnön alusta terminal-tulokseen enintään nykyisen snapshot-brokerin 35 000 ms. Luotetun kontekstin haku, spawn ja valmistelu kuuluvat samaan määräaikaan. Ei aikarajan nollausta vaiheesta tai viestistä; decryptin ja candidate-migraation nykyisiä omia rajoja ei muuteta. |
| Pysäytys | Nykyinen 3 000 ms hallittu sulku ja 3 000 ms killin jälkeinen exit-odotus; nämä ovat siivousta, eivät jatkoa validointityölle. Killin palautusarvo tai tulosviesti ei ole exit-todiste. |
| SQLite-muisti | Hyväksytty 256 MiB `hard_heap_limit` asetetaan erillisessä utilityssa luotetun muistiyhteyden kautta ennen tuodun kannan avausta. Readbackin lisäksi valvonnan toiminta vaaditaan; `MEMSTATUS=0`-ajuria ei hyväksytä pelkän readbackin perusteella. `mmap_size=0`, rajattu cache ja muistissa pysyvä temp. Ei prosessiglobaalia heap-rajaa aktiiviseen backendiin. |
| JavaScript-muisti | Hyväksytty 512 MiB V8 old-space -raja utilityn kiinteässä käynnistyksessä. Tämä ja SQLite-raja eivät yhdessä todista koko prosessin RSS-kattoa. IPC-, Buffer-, katalogi- ja rivirajat tarvitaan lisäksi. |
| Syöte/tulos | Suljettu, versioitu private-protokolla, enintään 4 KiB viesti. Main omistaa pathit, operation/generation/policy-sidonnan; renderer ei valitse niitä. Vastaukseksi vain yhteenveto/kuitti tai turvallinen syy, ei SQL:ää, katalogia, rivejä tai raw-poikkeusta. Yksi terminal, väärä/ylimääräinen terminal hylätään. |
| Nykyiset sisältörajat | Container 32 GiB, entry 24 GiB, artifact-katalogi 64 MiB / 100 000 kohdetta, PDF 10 MiB ja artifactit yhteensä 20 GiB säilyvät. Suurin formaatin sallima koko ei lupaa valmistumista resurssibudjetissa. Tiedostot hashataan virtana. |

Budjetit ovat omistajan 9.10.2026 hyväksymät rajat, eivät tässä valmistelussa
todennettuja kaikkien suurten aineistojen läpäisyrajoja. Ensimmäinen
toteutuskoe varmentaa asetusten toiminnan nykyisessä paketoidussa Electronissa,
nimetyt raja-arvot ja hyväksytyt historialliset fixturet. Jos tarvitaan eri
budjetti tai hyväksytty normaali aineisto ei sovi, tulos tuodaan päätettäväksi;
rajoja ei kasvateta vihreyden vuoksi. SQLite- ja Electron-rajat perustuvat
nykyisiin [pragma-rajapintoihin](https://www.sqlite.org/pragma.html) ja
[utilityProcess-rajapintaan](https://www.electronjs.org/docs/latest/api/utility-process).

**Prosessivaraus ja cleanup:** käytetään nykyistä
`acquireWorkspaceProcessReservation`-primitiveä tarkistusoperaation oman
yksityisen juuren identiteetillä. Aktiivisen asennuksen writer-varausta ei
siirretä tarkistimelle. Utility hankkii operaatiovarauksen ennen tiedoston
avausta; main sitoo luvan elävään kanavaan ja käynnistyssukupolveen.
Parentin/childin luovutusaukko ei saa sallia cleanupia ja myöhäistä avausta
samalle juurelle. Tämä todennetaan ennen varsinaiseen backup-polkuun kytkentää.

Tulos hyväksytään vasta oikean terminalin ja onnistuneen exitin jälkeen.
Lopullinen mainin hallitsema varaus estää uuden lukijan ennen käyttöä tai
siivousta. Timeout/cancel säilyttää ensisyyn, odottaa rajatusti exitiä ja
tarkistaa varauksen. Epävarma exit/varaus estää poiston, aktivoinnin ja saman
stagingin uudelleenkäytön. Hallittu sovellussulku odottaa tätä omistettua
työtä nykyisessä sulkubudjetissa. Pakkokatkaisun jälkeen startup yrittää
varata tunnetun staging-juuren ennen poistoa; busy/epäselvä juuri säilytetään
selvitysohjeella. Parentin kuoleman ei oleteta todistavan lapsen poistumista.
Vanha staging ilman uutta kuitin muistia tarkistetaan uudelleen, sitä ei
hyväksytä journalin tai iän perusteella. Uutta yleistä supervisoria,
PID-hakua, pysyvää journaliformaattia tai T3-remonttia ei tarvita.

<a id="m1-source-preparation-l5671"></a>

#### K:n tiedostovastuut ja turvallinen palaute

| Omistaja | Rajattu muutos |
| --- | --- |
| `apps/backend/src/database/migration/` | Odotusscheman muodostus, schema-attestointi ja rajattu migration-historian luku. Metadata-DDL pysyy yhdessä omistajassa. Yksi yhteinen tarkistin myös kirjoittaville kuluttajille. |
| `apps/backend/src/runtime/profileSnapshot/` | `inspectSqliteProfileDatabase.ts`: järjestys; `validateProfileSnapshot.ts`: irti aktiivisesta DB:stä; `validateProfileArtifactCatalog.ts`: rivirajat ennen materialisointia. Nykyinen artifact-materialisointi säilyy omassa helperissään. |
| `apps/backend/src/runtime/workspaceCandidate/` ja `apps/backend/src/http/app.ts` | Readonly-esitarkistus ennen kirjoittavaa avausta, yhteyskohtainen tarkistus ennen migraatiota, julkaistun/migroidun scheman varmennus. Nykyinen varaus, numerointi ja transaktiot säilyvät. |
| `apps/desktop/src/profileBackup/` ja `apps/desktop/src/runtime/` | Kapea tarkistusportti, parseri ja utility-adapteri/entrypoint; nykyinen broker vain luotettuun kontekstiin ja aktiivisen snapshotin muodostamiseen. Kiinteä paketoitu polku sekä olemassa olevan reservation-primitiven sovitus. |
| Backup-, restore-, recovery point- ja workspace-composition | Kaikki nykyiset `validateProfileSnapshot`-/activation-kutsujat siirretään saman portin taakse. Vanha aktiivisen backendin raskas käsittely poistetaan kattavuuden todennuksen jälkeen; ei rinnakkaista fallbackia. |
| Nykyinen observability-/Diagnostics-ketju | Allowlistatut koodit, vaihe, kesto ja erillinen cleanup-tulos sekä todellinen käyttöliittymä-/tukipakettiprojektio. Ei uutta loggeria. |

**Hyväksytty K-P3:n palaute (9.10.2026):** pidä väärän salasanan ja autentikointivirheen
yhteinen ilmoitus muuttumattomana. Uudet suljetut tekniset syyt ovat
`PROFILE_SCHEMA_UNSUPPORTED`, `PROFILE_INSPECTION_LIMIT_EXCEEDED`,
`PROFILE_INSPECTION_TIMEOUT`, `PROFILE_INSPECTION_PROTOCOL_INVALID` ja
`PROFILE_INSPECTION_CLEANUP_UNVERIFIED`. Tuntematon poikkeus pysyy tuntemattomana;
OOM:ia tai tiettyä schema-poikkeamaa ei päätellä pelkästä exit-koodista.
Sisältöhylkäys, keskeytys ja uudelleenkäynnistystä/selvitystä vaativa
siivoushylkäys erotetaan käyttäjälle turvallisesti. Raaka SQL, polku,
profiilitunniste tai checksum ei näy ilmoituksessa, Diagnosticsissa tai
tukipaketissa. Ensivirhe ei vaihdu cleanup-virheeksi.

Päivitä toteutuksen mukana nykyiset backup-/restore-/recovery-tapahtumat ja
`r0-observability-event-catalog.md`, virhekoodien allowlistat sekä
`local-restore-recovery-runbook.md`. Todista mainin todellinen observer ->
operational-loki -> Diagnostics -> sanitoitu tukipaketti; error-tason
incident-projektio noudattaa nykyistä minimointia. Activityyn ja business-
auditiin ei lisätä teknisiä backup-tapahtumia. Opastuksen on kerrottava,
että keskeytynyt tarkistus ei ole osittainen palautus eikä aktiivisen
yrityksen dataa korvata sen vuoksi.

<a id="m1-source-preparation-l5702"></a>

#### K:n toteutusjärjestys ja hyväksyntä

**V1 / suunnitelma, hyväksytty 9.10.2026:** lähdevertailu ja rajattu luotettujen migraatioiden
muistissa muodostamisen valmistelukoe on tehty. Koe tukee toteutustapaa,
ei ole hyökkäys-, yhteensopivuus- tai korjauksen hyväksyntänäyttö.
Riippumaton suunnitelmakatselmus ei löytänyt konkreettista estettä.
Historiallisten esitysmuotojen, oikean utilityn resurssirajojen ja varauksen
luovutuskilpailujen todennus jäi tarkoituksellisesti toteutuksen porteiksi.
Omistaja hyväksyi molemmat päätöskysymykset: K-P1:n schema-portin sekä
K-P2/K-P3:n eristetyn tarkistuksen rajoineen. Tämä sulkee V1:n;
V2a:n schema-tarkistus ja kohderegressiot on aloitettu; V3:n
hyväksyntänäyttöä ei vielä ole.

**V2a / rakenne:** toteuta yhteinen odotusschema ja attestointi. Testaa
current 039, hyväksytty metadatallinen historia ja metadataless 038, aidot
guardit/autoindeksit, muuttunut trigger/constraint/default/index, poistettu
guard, ylimääräinen objekti, identity-view, väärä ledger-rakenne,
metadata-poikkeusyritys sekä SQL:n litteraalien/quotejen muuttuminen.
Testi ei saa luoda odotusta samasta hyökkääjän kannasta. Historiallinen
fixture perustuu aiempaan hyväksyttyyn toteutukseen, ei vain uuteen
generaattoriin. Kirjoittavan avauksen vakoilu todistaa, ettei hylätyn
lähteen trigger tai migraatio pääse suorittumaan.

**V2b / eristys:** toteuta portti ja yksi utility. Todista ensin pienillä
prosessi-fixtureillä raskaan SQL:n katkaisu, ensimmäisen ikkunan ulkopuolinen
virhe, myöhäinen/puuttuva/väärä tulos, exit ennen tulosta, tulos ilman exitiä,
rajat, peruutus, parentin kuolema ja varausluovutuksen kilpailut.
Samalla todista aktiivisen backendin health sekä normaali asiakkaan luku/
tallennus. Ei kiinteää nukkumista tai onnistumisen vaatimaa ajan nostoa.

**V2c / oikeat kuluttajat:** kytke yllä olevan taulukon kaikki entrypointit,
siivous, virhekoodit ja current/legacy-sopimukset. Kopiointi-/avaus-/restart-
väliin vaihdetut tavut hylätään, myöhäinen vastaus ei hyväksy uutta
generationia. Testaa myös normaali itsebackup, C:n pre-update-suoja,
import/replace sekä epävarman cleanupin restart. Poista korvattu aktiivisen
backendin tarkistus vasta näiden kohdetestien läpäistyä. Päivitä omistavat
backup-, workspace-, database-, event- ja recovery-ohjeet samassa palassa.

**V3 / integraatio:** kohdetestit ja tyyppitarkistus jokaisen palan jälkeen;
sen jälkeen nykyiset composition-/HTTP-/native-/security-portit ja hardened
Windows backup -> inspect -> restore -> restart -> compare nykyisellä sekä
hyväksytyllä historiallisella synteettisellä aineistolla. Paketoitu entrypoint,
ajuri ja muistibudjetin readback todennetaan Windowsissa ja nykyisessä
Linux-portissa. Riippumaton rajattu loppukatselmus, julkaisun yksityisyys ja
jäädytetyn revision normaali PR/riippuvuusajo edeltävät suojattua mergeä;
uusi main tarvitsee omat nykyiset pakolliset porttinsa. Vanha CI-timeout
säilyy omana havaintonaan. Ei peräkkäisiä ajoja kunnes vihreä.

**Omistajapäätös 9.10.2026:** K-P1:n täsmällinen versionmukainen
schema-portti sekä K-P2/K-P3:n eristetty tarkistus, yllä nimetyt resurssi- ja
private-protokollarajat ja turvallinen hylkäys-/säilytyskäyttäytyminen
on hyväksytty toteutettaviksi. Hyväksyntä ei korvaa toteutuksen todennusta.
Nykyinen toimintatapa terveellä varmuuskopiolla säilyy: tarkista, vahvista
ja palauta. Tuntematonta rakennetta ei hiljaisesti korjata tai hyväksytä.
Tarve uudelle riippuvuudelle, formaattimuutokselle, laajemmalle legacy-
poikkeukselle tai uudelle yleiselle omistajuusmekanismille palaa erikseen
päätettäväksi.

V1-valmistelu ei muuttanut tuotantokoodia. V2a:n työpuussa on yllä rajattu
schema-toteutus ja kohdenäyttö. Riippuvuuksia, backup-formaattia tai
CI-ehtoja ei ole muutettu eikä K:n kokonaishyväksyntäkierrosta ajettu.
Alkuperäiset havainnot eivät ole korjatuiksi merkittyjä. W7, D/E/F/G/H/I,
GitHub-asetukset ja julkaisun uusi Deep Scan säilyvät erillisinä töinä.
