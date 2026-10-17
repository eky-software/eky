# 0.3.0: D-paketin toteutussuunnitelma

## Tila ja rajaus

**17.10.2026: D-P1 ja D-P2/A hyväksytty; D1:n kohdetodennus läpäisi.**
Lähtö on PR #307:n hyväksytty main
`da93cf53b7c608f825629d60404dce4c839dcb6a`.
[M1:n jatkamiskohta](release-0.3.0-m1-preparation-plan.md#jatka-tästä)
omistaa ajantasaisen integraatiotilan; tämä tiedosto tarkentaa vain
[roadmapin D-paketin](release-0.3.0-plan.md#m3-muut-invariantit-diagnostiikka-ja-ylläpidettävyys)
R07/R14/R16-korjausten työjärjestyksen ja hyväksynnän. Se ei ole uusi roadmap.

T/A/B/C/K ja CS-1/CS-2 säilyvät hyväksyttyinä. Historiallisia timeout-syitä
ei selvitetä uudelleen ilman tähän muutokseen kohdistuvaa näyttöä.
Alkuperäinen valmistelu perustui lähdehavaintoihin. Alla oleva D1:n
kohdenäyttö ei vielä ole koko D:n tai uuden revision integraatiohyväksyntä.

Omistaja hyväksyi alla kuvatun D-P1:n ja D-P2:n vaihtoehdon A.
D2 etenee edelleen ensin rajattuun sopimus- ja kilpailukokeeseen;
tuotantokytkentä edellyttää alla nimettyä elinkaaritodistusta.
Toteutuksen, testien ja integraation hyväksyntä on avoin.

### D1:n kohdenäyttö ja seuraava työ

D1:n nykyiseen muokkaussessioon ja latausyritykseen sidottu alkuluku,
virheen jälkeinen käsin tehtävä uudelleenluku sekä perustietolomakkeen
kirjoitusesto on toteutettu. Kahdeksan uutta latausregressiota ja kolme
aiempaa tallennusregressiota läpäisivät samassa ajossa. Neljä lataustapausta
todennettiin koko web-polussa ja neljä selainkomponentin todellisella
unmount-/client-vaihdolla; jälkimmäisiä ei nimetä koko navigoinnin E2E:ksi.
Myös nykyiset Company Settingsin web- ja API/audit-käyttöpolut,
webin 949 yksikkötestiä, webin tyypitys ja tuotantobuild läpäisivät.

Ensimmäisten uusien testien pyyntölaskenta ja virhetekstiodotus korjattiin:
aloitusnäkymän omat lukupyynnöt erotetaan testattavasta näkymästä
HTTP-vastausten avulla, ja virheellinen DTO odottaa nykyistä turvallista
virheviestiä. Tuotantokoodia tai aikarajoja ei muutettu näiden hylkäysten
vuoksi. Ensivirheet säilyvät erillään hyväksytystä kohdeajosta.
Rajattu riippumaton D1-tuotantokoodin ja päätösten katselmus ei löytänyt
korjattavaa. Tämä ei korvaa koko D:n loppukatselmusta tai PR/main-portteja.

**Seuraava työ on D2:n rajattu sopimus- ja kilpailukoe.** Salaisuuksien
brokeria, tallennusta tai auditin lopputulosta ei ole vielä muutettu.
Alla oleva elinkaaritodistus vaaditaan ennen niiden tuotantokytkentää.

## Omistajat ja säilytettävät ehdot

- [Company Settings](../modules/company-settings.md) omistaa perustiedot,
  permissionit, salaisuusoperaation käyttötapauksen ja SQLiten lifecycle-auditin.
- [Sähköposti ja salaisuudet](email-delivery-and-secrets-plan.md) omistaa
  brokerin, salatun tallennuksen ja backend-only salaisuuden lukurajan.
- [Desktop](local-desktop-implementation-plan.md) omistaa prosessien ja
  profiilin elinkaaren. Main ei avaa business-SQLiteä.
- API-client validoi vastaukset; web näyttää tilan, ei päätä tallennuksen
  onnistumista tai myönnä uusia oikeuksia. Invoicingin toimitussäännöt säilyvät.
- CS-1: permission ja koko syöte validoidaan ensin. PUTin tilaluku tapahtuu
  ennen perustietojen ja auditin atomista kirjoitusta, ei commitin jälkeen.
  Tilaluvun häiriö ei nykyisessä sopimuksessa muuta tietoja tai auditia.
- CS-2: yksi tallennus kerrallaan; odotusaikana tehdyt uudet muokkaukset
  säilyvät. Vanhan session vastaus ei muuta uuden session tilaa.
- Normaali onnistuva perustietojen luku/tallennus ja salaisuuden
  set/status/remove säilyvät. Salaisuuden poisto ei poista perustietoja.
- Ei uusia riippuvuuksia, salasanan säilytysmallia, backup-formaattia,
  OAuth-provideria, yleistä manageria tai testialustaa. Ei oikeaa SMTP:tä,
  salasanoja tai käyttäjäaineistoa testeihin. Aika- ja CI-rajat säilyvät.

Toteuttaja lukee ensin juuri- ja kohde-AGENTS-ohjeet sekä
[aihekohtaisen lukureitin](../README.md). Desktopin, runtime-valtuuksien,
backupin tai diagnostiikan rajan koskettaminen edellyttää sen täysien
omistavien sopimusten lukemista; tämä suunnitelma ei korvaa niitä.

## Lähdehavainto ja vaikutusalue

Täydet polut ovat sovellusjuuresta; samassa solussa lyhennetty polku viittaa
edellä nimettyyn kansioon tai moduuliin. Ne nimeävät tarkastettavan omistajan,
eivät velvoita muuttamaan kaikkia mainittuja tiedostoja.

| Kohta | Nykyinen havainto | Ensisijaiset lähteet |
| --- | --- | --- |
| R07 | Epäonnistunut ensimmäinen GET päättää lataustilan mutta näyttää lomakkeen. Tallennus ei vaadi saman session onnistunutta alkulukua. | `apps/web/src/features/companySettings/CompanySettingsPageView.tsx`; nykyinen `companySettingsSavingJourneys.spec.ts`. |
| R14, transport | Client poistaa timeoutissa odottavan vastauksen. Mainin jo alkanut set/remove voi silti valmistua. Brokerin synkroninen `close()` ei odota aktiivista tiedostotyötä. | `apps/desktop/src/secrets/secretBrokerClient.ts`, `secretBrokerMain.ts`, `secretBrokerProtocol.ts`; `apps/desktop/src/runtime/backendRunner.ts` ja `apps/desktop/src/main/desktopComposition.ts`. |
| R14, tallennus | `write()` voi ilmoittaa virheen uuden current-tiedoston julkaisun jälkeisessä siivouksessa; `remove()` voi epäonnistua vasta osittaisen poiston jälkeen. Myös read/has voi vahvistaa recovery-slotin tai uudelleensalata sen. | `apps/desktop/src/secrets/encryptedSecretFile.ts`; `secretBrokerMain.ts`. |
| R14, audit | Store-poikkeus johtaa nykyisin failed-loppukuittaukseen, vaikka sivuvaikutus voi jäädä epäselväksi. Audit-loppukirjoituksen virhe jo säilyttää pending-rivin. | `apps/backend/src/modules/companySettings/application/executeCompanyEmailSecretOperation.ts`; moduulin audit-portti, SQLite-writer ja retention. |
| R16 | Commitin jälkeinen tilaluku on jo korjattu. GET odottaa yhä salaisuuden tilaa; sen häiriö estää myös perustietojen lukemisen. | `apps/backend/src/composition/companySettingsComposition.ts`; `application/updateCompanySettings.ts`; `packages/api-client/src/companySettings/`. |

Boolean `emailSecretConfigured` kulkee domain/read-mallista API-parseriin
ja webin form-malliin. SMTP- ja testilähetyksen saatavuus käyttävät sitä.
Oma yritys -salasanapaneelilla on erillinen `configured`-tilareitti.
Customers käyttää perustietovastauksesta oletustuntihintaa, Invoicing myös
asetuksia. Repositoryn oletus `false` ei ole todiste salaisuuden puuttumisesta.
Nykyistä erillistä salaisuuden tilareittiä ei voi siirtää kaikkien lukijoiden
käyttöön huomaamatta: se vaatii `manageCompanyEmailSecret`-permissionin ja
puuttuu selainkehityksestä. Oikeuksia ei laajenneta tämän työn sivutuotteena.

## D1: Perustietojen onnistunut alkuluku

**Toteutussuunta on rajattu; ei uutta business- tai tietomallipäätöstä.**

1. Sido onnistunut lataus nykyiseen muokkaussessioon ja latausyritykseen.
   Vain sen validoitu GET-vastaus saa alustaa lomakkeen ja sallia PUTin.
2. Estä tallennus itse käsittelijässä ja käyttöliittymässä ennen onnistunutta
   lukua. Älä näytä virheen jälkeen kirjoitettavia oletuksia tai edellisen
   session tietoja. Onnistunut tyhjä GET säilyy normaalina ensikäyttönä.
3. Tarjoa nimenomainen uudelleenluku. Ei automaattista tallennusta tai
   tallennuksen uusintaa. Vanha success/catch/finally ei muuta nykyistä tilaa.
4. Rajaa esto perustietolomakkeeseen. Erillisiä backup-, diagnostiikka- tai
   muiden asetusten polkuja ei suljeta tämän lomakkeen lukuvirheen vuoksi.

Laajenna nykyistä web-featureä, suomenkielisiä viestejä ja lisää alkuluvun
regressiot samaa fixtureä käyttävään `companySettingsLoadingJourneys.spec.ts`-
tiedostoon. Nykyinen `companySettingsSavingJourneys.spec.ts` säilyttää CS-2-kattavuuden.
Älä rakenna yleistä lomakeframeworkia. Clientin vaihtuminen tarvitsee
suoritettavan testin; pelkkä sivulta poistuminen ei todista samaa tapausta.

## D2: Salaisuusoperaation todellinen lopputulos

### D-P1: Hyväksytty epäselvän tuloksen jatkotapa

**Omistajan päätös 17.10.2026: rajattu epäselvä tila ja hallittu uudelleenkäynnistys.**
Timeoutia ei luvata peruutukseksi. Vain varmasti ennen vaikutusta hylätty
operaatio voidaan kirjata epäonnistuneeksi. Muut epäselvät tulokset jäävät
nykyiseen pending-auditiin, ja käyttäjälle kerrotaan epävarmuus.
Kaikki uudet ja vielä aloittamattomat jonotetut broker-operaatiot, myös
tilaluku ja salaisuuden käyttö SMTP:ssä, estetään kyseisessä epävarmassa
runtime-sukupolvessa. Jo alkanutta SMTP-toimitusta ei väitetä
perutuksi, eikä sen toimitushistoriaa muuteta. Muuta laskutusta ei estetä.

Jatkaminen edellyttää vanhan omistajan päättymisen todistavaa hallittua
uudelleenkäynnistystä ja salaisuuden nykytilan turvallista lukua. Tämä voi
palauttaa myös vanhan salaisuuden; epävarma poisto ei takaa sen poissaoloa.
Uusi käyttäjän vahvistama SMTP-lähetys saa käyttää tätä
validoitua nykytilaa. Salaisuuden uudelleensyöttöä ei pakoteta, mutta
käyttäjä voi tarvittaessa asettaa tai poistaa sen uudella nimenomaisella
operaatiolla. Tämä vapautusehto sisältyy D-P1-päätökseen. Jos jokaisen
epävarman muutoksen jälkeen vaaditaan uusi set/remove myös restartin yli,
sen pysyvä estotieto ja palautussäännöt on suunniteltava erikseen.
Sovellus ei käynnistä itseään automaattisesti
uudelleen eikä hävitä odottavia lomakemuokkauksia huomaamatta.

Purkamiskelvoton tai ristiriitainen sisältö ei muutu `false`-tilaksi eikä
restart lupaa korjata sitä. Mainin todettu exit poistaa vanhan suorittajan,
mutta ei yksin todista puhdasta sammutusta tai tiedostojen eheyttä.
Uusi käynnistys käy kaikki nykyiset validointiportit.

Nykytilan `hasSecret` ei todista vanhan operaation tulosta: vanha pending
säilyy ratkaisemattomana eikä muutu onnistumiseksi restartin perusteella.
Vanhoja pending-rivejä ei toisaalta tulkita ikuiseksi globaaliksi estoksi.
Pienimmässä vaihtoehdossa timeoutin jälkeinen vastaus sivuutetaan kuten
nykyisin; uutta taustalla tapahtuvaa auditin sovitusta ei lisätä.
Jos myöhemmin valitaan täsmällinen myöhäinen kuittaus, se tarvitsee erikseen
operaatio-/sukupolvisidonnan ja tietokannan elinaikasuojan. Suljettua
SQLiteä ei avata taustalta eikä uutta sessiota vapauteta vanhalla vastauksella.

**Haitta:** harvinainen epäselvä salasanamuutos voi vaatia käyttäjältä
uudelleenkäynnistyksen ja uuden syötön. Joidenkin vanhojen operaatioiden
tulos jää rehellisesti tuntemattomaksi. Nämä seuraukset kuuluvat hyväksyttyyn rajaukseen.

Vaihtoehto on pysyvä operaatiokohtainen kuittaus ja automaattinen sovitus.
Se tarvitsee myös poistetun salaisuuden tulostodisteen sekä erikseen
suunnitellut yhteensopivuus-, säilytys- ja palautussäännöt. Sitä ei lisätä
huomaamatta broker-korjaukseen. Pelkkä pidempi timeout, Promise-peruutus
tai automaattinen retry ei ratkaise kadonneen kuittauksen ongelmaa.

### Rajattu toteutussopimus

| Todettu tilanne | Audit ja vastaus |
| --- | --- |
| Permission/syöte hylätty ennen operaation aloitusta | Ei store-kutsua; nykyinen turvallinen hylkäys. |
| Pending-auditin luonti epäonnistuu | Ei store-kutsua eikä onnistumisväitettä. |
| Todistettu hylkäys ennen tiedostovaikutusta | Sama pending voidaan päättää failed-tilaan; turvallinen virhe. |
| Sama operaatio kuitataan valmistuneeksi ja auditin loppukirjoitus onnistuu | succeeded ja normaali onnistumisvastaus. |
| Timeout, katkennut kanava tai vaikutuksiltaan epäselvä tiedostovirhe | pending säilyy; turvallinen epäselvän tuloksen vastaus, ei automaattista uusintaa. |
| Tallennus kuitattu, mutta auditin loppukirjoitus epäonnistuu | Säilytä erillinen audit-incomplete-syy ja pending; älä ilmoita tallennuksen varmasti epäonnistuneen. |

Toteutus etenee kahdessa rajatussa palassa:

1. **Sopimus ja pieni kilpailukoe.** Nimeä backend-operaation,
   broker-pyynnön ja runtime-sukupolven sidonta sekä suljettu tulosluokitus.
   Käytä olemassa olevaa sarjallistettua brokeria ja virhekanavaa.
   Luokitus syntyy sivuvaikutuksen omistajassa; yleisestä virhekoodista ei
   arvata, oliko muutos jo tapahtunut. Tarkista myös epäonnistunut poisto
   ja commitin jälkeinen siivous. Ensimmäinen syy säilyy erillään siivouksesta.
2. **Kytkentä nykyisiin omistajiin.** Backend muuntaa todistetun tuloksen
   auditiksi ja turvalliseksi HTTP-vastaukseksi. Strict API-client ja
   salasanapaneeli erottavat tuntemattoman tilan puuttuvasta salaisuudesta.
   Vanha vastaus ei saa muuttaa uuden näkymän viestiä, tilaa tai lukkoa.

**Pakollinen elinkaaritodistus ennen tuotantokytkentää:** clientin close,
backendin exit ja mainin tiedostotyön päättyminen ovat eri tapahtumia.
Pelkkä backendin restart, uusi client tai suljettu portti ei aloita
turvallista uutta sukupolvea. Uusi broker, profiilin muuttaminen tai vanhojen resurssien siivous ei saa
alkaa ennen aktiivisen työn todettua päättymistä. Tämä sovitetaan nykyiseen
desktopin close-/workspace-omistajaan, ei uuteen valvojaan. Jonossa oleva
mutaatio ei saa käynnistyä suljetun omistajan jälkeen. Huomioi myös
read/has-kutsujen recovery- ja uudelleensalausvaikutukset.
Epävarma sulku säilyttää aineiston ja nykyiset suljetun virhepolun ehdot;
pelkkä odotuksen aikakatkaisu ei vapauta omistajuutta.

Kokeen on osoitettava muuttumaton onnistuva polku, timeout ennen työn alkua,
myöhäinen vaikutus, kadonnut kuittaus ja sulkeminen aktiivisen työn aikana.
Jos nykyisillä omistajilla ja aikarajoilla ei saada tätä todennettua,
pysähdy täsmälliseen vaihtoehtopäätökseen. Älä laajenna C:tä tai aloita
uutta yleistä lifecycle-hanketta.

## D3: Perustietojen saatavuus tilapalvelun häiriössä

### D-P2: Hyväksytty GET-käyttäytyminen

| Vaihtoehto | Hyöty ja seuraus |
| --- | --- |
| **A, pienin rajaus: säilytä nykyinen saatavuus** | Tilahäiriö estää yhä GETin ja PUTin. D1 estää virheellisen oletustallennuksen, CS-1 säilyy täysin. Käyttäjä voi joutua korjaamaan salaisuuspalvelun ennen perustietojen muokkausta. |
| B, erillinen perustietojen luku | Perustiedot voidaan näyttää tilahäiriössä. Tarvitaan hyväksytty erillinen projektio tai täsmällinen unknown-tila nykyiseen DTO:hon. PUT säilyy CS-1:n mukaisena; lukuvalmius ei lupaa tallennusvalmiutta. |
| C, erillinen luku ja tallennus | Perustiedot toimivat myös salaisuuspalvelun häiriössä, mutta tämä muuttaa hyväksytyn CS-1:n fail-closed-tilalukusääntöä ja molempien vastausten sopimuksia. |

**Omistaja hyväksyi vaihtoehdon A 17.10.2026.** Tämä on nimenomainen
saatavuusvalinta, ei väite R16:n kaikkien vaikutusten poistumisesta.
Vaihtoehdot B/C eivät kuulu D:n toteutukseen. Jos niitä myöhemmin harkitaan,
täsmennä ennen erillistä päätöstä DTO:n kaikki tuottajat ja
kuluttajat, permissionit, selainkehitys sekä SMTP:n unavailable-viesti.
Unknownia ei esitetä `false`-arvona tai merkitsemättömänä vanhana välimuistina.
Pelkkä kolmitilainen DTO ei rajaa loputtomasti odottavaa kutsua.

## Hyväksyntä ja testit

Käytä nykyisiä yksikkö-/sopimustestejä ja yhteisiä E2E-fixtureitä.
Uudet tapaukset lisätään oikeisiin ajokomentoihin ja
[testimatriisiin](r0-e2e-test-matrix.md#company-settings); testitiedoston
olemassaolo ei yksin todista ajamista.

| Taso | Vähimmäistodiste |
| --- | --- |
| D1, web | Pending/failed/malformed GET ei salli PUTia; onnistunut tyhjä GET toimii; käsin tehty uusi luku toimii; vanhat success/error/finally ja clientin vaihto eivät muuta nykyistä sessiota. CS-2:n uudet muokkaukset säilyvät. |
| D2, broker ja tiedosto | Hallittu viive ja menetetty kuittaus set/remove-operaatioissa, virhe ennen/jälkeen vaikutuksen, osittainen poisto, jonon sulku sekä aktiivisen read/has-recoveryn päättyminen. Todelliset testitavut verrataan, ei vain Promise-tulosta. |
| D2, backend ja HTTP | Oikea pending/failed/succeeded, auditin alku-/loppuvirhe, tuntematon tulos ja vanha operaatio; permission/yritys/session-raja. Ei uusia audit-rivejä myöhäisestä vastauksesta eikä false-successia. |
| D2, UI ja kuluttajat | Tuntematon tila ei näy puuttuvana salasanana; uudelleensyöttö-/restart-ohje, tuplapyyntö ja vanha session vastaus. Uusi salaisuutta tarvitseva SMTP-kutsu estyy, jo alkanutta toimitusta ei merkitä uudelleen. |
| D3 ja CS-1 | Valitun GET-säännön testit, precommit-tilaluku, pakollinen auditrollback ja muuttumaton persisted-response; ei commitin jälkeistä salaisuuskutsua. |
| Todellinen desktop | Backend -> yksityinen broker -> salattu tiedosto -> audit -> HTTP/UI. Salaisuuden synteettinen viive, close/restart ja uusi nimenomainen operaatio samalla testiprofiililla. Vanhasta pendingistä ei keksitä lopputulosta. |
| Palautus ja toimitus | Sama puhdas hardened Windows -paketti: backup -> inspect -> restore -> restart -> compare; konekohtaiset salaisuudet eivät siirry backupiin. Nykyinen native-/paketointi- ja CI-kattavuus säilyy. |

Nopeassa palautteessa käytetään pakettien nykyisiä Vitest-ajureita ja
tyyppitarkistuksia. Kokonaisportteina säilyvät `pnpm --filter @eky/backend test`,
`pnpm --filter @eky/desktop test`, `pnpm --filter @eky/api-client test`,
`pnpm --filter @eky/web test` sekä vaikutusalueen buildit ja nykyiset
`pnpm test:e2e:critical` / `pnpm test:e2e:electron:critical`-ajot.
Valmistelut, native-ajuri ja paikalliset komentopolut varmistetaan nykyisestä
runbookista. Koko D:n portit ovat edelleen avoimia; yllä mainittu D1:n
kohdenäyttö ei korvaa niitä.

## Palaute, diagnostiikka ja valmistuminen

- Käyttäjäviesti erottaa varmasti hylätyn muutoksen, epäselvän tuloksen ja
  auditin loppukirjoitusvirheen. Ei raakavirhettä tai salasanaa.
- Nykyinen turvallinen tapahtumaketju säilyttää vaiheen, suljetun syykoodin
  ja sivuvaikutuksen epävarmuuden. Jos tapahtuma/koodi muuttuu, päivitä
  [tapahtumakatalogi](r0-observability-event-catalog.md) ja testaa tarkoitettu
  writer -> reader -> HTTP -> client -> Diagnostics/tukipaketti -ketju.
- Pending/failed-salaisuusoperaatio ei muutu Activityn onnistuneeksi
  business-tapahtumaksi. Nykyinen retention säilyttää pending-aineiston.
- Julkiset lokit ja salattu testiaineisto noudattavat nykyisiä rajoja.
  Salaisuuksia, niiden tiivisteitä tai oikeita profiileja ei kerätä.
- Kukin pala päivittää omistavan sopimuksen, testimatriisin ja lyhyen
  jatkamiskohdan. Korvattu toteutus poistetaan vasta kattavuuden todennuksella;
  rinnakkaista vanhaa ja uutta lifecyclea ei jätetä pysyvästi.

Loppukatselmus arvioi erityisesti unknown/failed-eron, aktiivisen työn
omistajuuden, sessionvaihdot ja muuttumattoman normaalikäytön. Sen jälkeen
jäädytetyn revision nykyiset PR-portit ja auditointi, normaali valtuutettu
merge sekä uuden mainin omat portit. Suunnitelma, paikalliset kohdetestit tai
yksi onnistunut koe eivät sulje D:tä. D:n jälkeen jatketaan roadmapin
seuraavaa pakettia, ei uutta testialusta- tai rakennesiivousta.
