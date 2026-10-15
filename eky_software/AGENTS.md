# Eky-projektin AI-ohjeet

Tämä tiedosto on pakollinen lähtökohta kaikelle AI-avusteiselle työlle tässä repositoriossa.

Lue tämä tiedosto aina ennen kuin teet muutoksia projektiin.

Omistajan ja hänen koneensa tiedot pysyvät paikallisina. Noudata kaikessa
raportoinnissa ja julkaisemisessa tämän tiedoston
[konekohtaisten tietojen julkaisukieltoa](#konekohtaisten-tietojen-julkaisukielto).
Tutkimus- tai lukulupa ei ole julkaisulupa.

Eky-projektissa tekoäly ei saa arvata arkkitehtuuria, liiketoimintasääntöjä, turvallisuussääntöjä tai moduulien vastuita. Jos jokin asia on epäselvä, työ rajataan pienemmäksi tai kysytään lisäohje.

## Projektin tavoite

Eky on modulaarinen ERP-tyylinen ohjelmisto rakennusalan yrityksen käyttöön.

Ensimmäinen käytännön tavoite on web-pohjainen asiakaskortisto ja laskutusmoduuli. Myöhemmin järjestelmään voidaan lisätä työmääräykset, tuntikirjaukset, materiaalikirjaukset, mobiilisovellus työntekijöille, raportointi, integraatiot, varastonhallinta ja AI-agenttien ohjaama automaatio.

Projektia ei rakenneta yksittäiseksi laskutusohjelmaksi, vaan pitkäikäiseksi, turvalliseksi ja laajennettavaksi Eky Base -järjestelmäksi.

## Työskentelymalli

Ihminen toimii ratkaisuarkkitehtina ja päätöksentekijänä.

AI-avustajat voivat auttaa suunnittelussa, arkkitehtuurin arvioinnissa, dokumentoinnissa, koodin luonnissa, testien tekemisessä ja vaihtoehtojen vertailussa.

Codex tai muu koodausagentti toimii toteuttajana, mutta ei saa tehdä laajoja arkkitehtuuripäätöksiä itsenäisesti.

### Agenttien ja aliagenttien käyttö

Projektin omistaja antaa pysyvän, nimenomaisen luvan käyttää agentteja ja
aliagentteja sekä delegoida niille rajattuja osatehtäviä jokaisella
työskentelykierroksella, ellei omistaja erikseen kiellä tai rajaa niiden
käyttöä. Erillistä lupaa delegointiin ei tarvitse kysyä joka tehtävässä.
Lupa koskee kaikkia käytettävissä olevia päättelytasoja, ei vain Ultraa,
eikä edellytä agenttien käyttöä pienessä tai suoraviivaisessa tehtävässä.

Sovella [agenttien tarkoituksenmukaisen käytön ohjetta](docs/ai/workflow.md#agenttien-tarkoituksenmukainen-käyttö):
vältä päällekkäistä työtä ja tarpeetonta kontekstin kopiointia. Agenttien
määrä on pääagentin harkinnassa, ei kiinteä kiintiö tai uusi lupaportti.
Pakollisia lukureittejä, katselmuksia tai testinäyttöä ei kevennetä
tokenisäästön vuoksi.

Pääagentti arvioi hyödyn, rajaa vastuut ja antaa kullekin aliagentille
tarvittavat projektiohjeet, tehtävärajauksen ja hyväksyntäehdot. Rinnakkaisten
muokkausten kirjoitusalueet erotetaan. Pääagentti tarkistaa tulokset ja
muutokset ennen niiden hyväksymistä osaksi kokonaisuutta sekä vastaa
yhteenvetoon merkityistä todisteista ja avoimista kohdista.

Samat tietoturva-, yksityisyys-, moduuliraja-, riippuvuus-, testaus- ja
hyväksyntäsäännöt koskevat kaikkia agentteja. Delegointi ei laajenna tehtävän
valtuuksia, ohita työkalujen rajoituksia tai käynnistä keskeytettyä työtä
uudelleen. Tämä lupa koskee kehitystyön avustajia, ei sovelluksen tulevien
AI-toimijoiden ajonaikaisia käyttöoikeuksia.

### Mallin ja päättelytason suositus

Anna jokaisen uuden tehtävän alussa lyhyt, perusteltu suositus siihen
sopivasta mallista ja päättelytasosta. Myös nykyisen valinnan säilyttäminen
on suositus. Arvioi valinta uudelleen työn vaikeuden tai riskin muuttuessa;
samaa suositusta ei tarvitse toistaa jokaisessa väliviestissä. Noudata
[työnkulun valintaohjetta](docs/ai/workflow.md#mallin-ja-päättelytason-valinta).
Suositus ei vaihda käyttäjän asetusta eikä alenna hyväksyntävaatimuksia.
Tarkista myös `.eky-local/local-toolchain-runbook.md`:n mallivalintaosio,
jos tiedosto on olemassa. Omistajan paikallinen vähimmäistaso koskee myös
aliagentteja; henkilökohtaista mallivalintaa ei kopioida julkisiin ohjeisiin.

### Mergen valtuus hyväksytyssä Goalissa

Projektin omistaja antaa pysyvän luvan hyväksytyn, käynnissä olevan Goalin
rajaukseen kuuluvaan normaaliin PR-mergeen ilman uutta lupakysymystä, kun
tehtävän vaatimukset, katselmus ja kyseisen revision nykyiset PR-portit ovat
hyväksytysti täyttyneet. Noudata [mergen valtuus- ja tarkistusohjetta](docs/ai/workflow.md#mergen-valtuus-hyväksytyssä-goalissa)
ja varmista mergen jälkeen mainin omat vaaditut tarkistukset.
Omistajan uudempi kielto, tauko tai rajaus on aina ensisijainen. Lupa ei
laajenna Goalia eikä ohita riippuvuus-, arkkitehtuuri-, tietosuoja-,
julkaisu- tai muita erillisiä päätösportteja.

## Ohjeiden etusija ja ristiriitatilanteet

Jos kaksi projektin ohjetta vaikuttavat ristiriitaisilta, noudata seuraavaa etusijajärjestystä:

1. Projektin omistajan nykyisessä tehtävässä antama nimenomainen päätös.
2. Repositorion juuri-`AGENTS.md` ja sen ydinperiaatteet.
3. Kohdekansion lähin `AGENTS.md`, joka tarkentaa kyseisen kansion työtä.
4. Hyväksytyt ADR-päätökset `docs/decisions/`-kansiossa.
5. Arkkitehtuuri-, turvallisuus-, riippuvuus- ja tietomalliohjeet `docs/architecture/`-kansiossa.
6. Moduulien vastuut `docs/modules/`-kansiossa.
7. Rajatut toteutus- ja vaiheistussuunnitelmat.

Kohdekansion `AGENTS.md` saa tarkentaa juuri-`AGENTS.md`:ää, mutta se ei saa kumota tämän tiedoston ydinperiaatteita ilman projektin omistajan nimenomaista päätöstä.

Vanha suunnitelmadokumentti ei saa kumota myöhemmin hyväksyttyä ADR-päätöstä tai projektin omistajan uudempaa päätöstä.

Jos ristiriitaa ei voida ratkaista varmasti etusijajärjestyksen avulla:

- älä valitse tulkintaa itsenäisesti
- älä jatka ristiriidan vaikutusalueella
- rajaa muu turvallisesti tehtävissä oleva työ erilleen
- kerro projektin omistajalle, mitkä ohjeet ovat ristiriidassa
- pyydä projektin omistajalta päätös ennen jatkamista

Sama pysäytyssääntö koskee tilannetta, jossa liiketoimintasääntö, moduulin omistajuus, turvallisuusvaatimus tai arkkitehtuurin vaikutus jää epäselväksi.

## Pakollinen lukujärjestys

Lue aina ensin tämä tiedosto.

Ohjeiden tarkistus kuuluu jokaiseen tehtävään, myös pieneen korjaukseen,
testiin, katselmukseen ja dokumentointiin, eikä vain tietyn julkaisun
roadmapiin. Tunnista kosketettavat ohjelman osat ja noudata
[työn aloitusjärjestystä](docs/ai/workflow.md#työn-aloitusjärjestys).
Lue niiden soveltuvat ohjeet ennen muutoksia. Jos työ laajenee uuteen
osaan tai vastuurajaan, tarkista sen ohjeet ennen siihen kohdistuvaa työtä.
Pelkkä aiempi lukukerta tai keskustelumuisti ei korvaa ajantasaisen
ohjeen tarkistusta.

Windows/WSL/Git/Node/pnpm/.NET/WiX- tai paikallista release-työtä varten lue
Gitistä ohitettu `.eky-local/local-toolchain-runbook.md` ja käytä
`.eky-local/toolchain.local.json`-inventaarioa, jos nämä paikalliset tiedostot
ovat olemassa. Niihin ei saa tallentaa salaisuuksia.

Testiajojen, CI:n, pushin, PR:n ja mergen yhteydessä noudata myös
[CI-ajon seurannan ja virhetodisteiden ohjetta](docs/ai/workflow.md#ci-ajon-seuranta-ja-virhetodisteet).
Ensivirheen säilyttämistä, yhtä hallittua uusintaa ja määräaikaisia
kehityspoikkeuksia ohjaa [yhteinen testauskäytäntö](docs/ai/testing-rules.md#ensivirhe-uusinta-ja-rajattu-poikkeus).

Lue tehtävän aihekohtaiset lähteet [ohjehakemiston lukureitistä](docs/README.md).
Sen ehdolliset lukemisvelvoitteet ovat osa tätä aloitusporttia. Moduulirajan
ylityksessä luetaan molempien osapuolten sopimukset. Kohdepolun oma
`AGENTS.md` luetaan erikseen ennen muutoksia; alihakemistoja ja linkkien
kohteita ei oleteta automaattisesti ladatuiksi.

## Pakollinen turvallisuusportti

Turvallisuusarvio tehdään aina, kun työ koskee:

- tuotantokoodia
- HTTP- tai API-reittejä
- käyttäjän tai ulkoisen järjestelmän syötettä
- tietokantaa, tiedostoja tai henkilötietoja
- autentikointia, käyttöoikeuksia tai yritysrajausta
- ympäristömuuttujia, salaisuuksia tai lokitusta
- riippuvuuksia tai lockfilea
- synkronointia, integraatioita, tiedostotuontia tai AI-agentteja

Näissä tehtävissä lue aina myös:

- `docs/architecture/security-principles.md`
- `docs/ai/review-checklist.md`
- `docs/ai/testing-rules.md`

Ennen muutoksen hyväksymistä tarkista vähintään:

1. Mitkä arvot ja pyynnöt tulevat luottamusrajan ulkopuolelta?
2. Validoiko backend tyypin, muodon, pituuden, rajat ja liiketoimintasäännöt?
3. Tulevatko käyttäjän identiteetti ja `companyId` luotetusta backendin vahvistamasta kontekstista?
4. Onko käyttöoikeus deny by default ja tarkistetaanko se backendissä?
5. Voiko syöte vaikuttaa SQL:ään, HTTP-otsakkeisiin, tiedostopolkuihin, lokiin tai renderöityyn sisältöön?
6. Vuotaako vastauksissa, virheissä tai lokeissa salaisuuksia tai tarpeetonta henkilötietoa?
7. Tarvitaanko audit-tapahtuma tai turvallisuustesti?
8. Muuttuuko palvelun verkkonäkyvyys, CORS-, cookie-, token- tai deployment-malli?
9. Onko muuttuneiden riippuvuuksien tietoturvatila tarkistettu?

Jos jokin kohta jää epäselväksi, kyseistä vaikutusaluetta ei toteuteta ennen projektin omistajan päätöstä.

## Backup- ja palautusportti

Uuden moduulin tai pysyvän tiedostoartifactin pitää ilmoittaa
backup inclusion/exclusion, auktoritatiivinen sisältö, snapshot-portti,
restore-validator, formaattiyhteensopivuus ja recovery-testi. Yhteinen
backup-infrastruktuuri ei arvaa moduulin tiedostoja tai kopioi koko
`userData`-juurta.

Backup-, restore-, SQLite-, business-artifact-, `safeStorage`-, desktop
process lifecycle- tai aktiivisen profiilin polkua muuttava työ vaatii
alemman tason testien lisäksi hardened Windows packaged backup -> inspect ->
restore -> restart -> compare -todistuksen synteettisellä profiililla.
Installer ja automaattipäivitys ovat tästä erillisiä hyväksyntäportteja.

## Konekohtaisten tietojen julkaisukielto

Omistajaan tai hänen tietokoneeseensa liittyvät tiedot pidetään paikallisina.
Kielto koskee myös ei-salaisia tietoja: asennettuja ohjelmia, ajureita,
valmistajia, versioita, käyttöjärjestelmä- ja laitteistoinventaariota,
suojaus- ja verkkoasetuksia sekä näistä tehtyjä havaintoja. Pelkkä nimen,
polun tai tunnisteen poistaminen ei tee konekohtaisesta raportista julkista.

Näitä tietoja ei kirjoiteta versionoituihin tiedostoihin, commit-viesteihin,
PR-kuvauksiin tai kommentteihin, issueihin, CI-lokeihin eikä ladattaviin
artifacteihin. Raakajäljet, komentotulosteet ja yksityiskohtaiset paikalliset
mittaukset kuuluvat vain jo olemassa oleviin Gitistä ohitettuihin paikkoihin.
Myöskään paikallinen runbook tai työkalujen inventaario ei kuulu Gitiin.

Yhteiseen dokumentaatioon kirjataan vain projektin yleiset sopimukset,
korjattu käyttäytyminen, testien hyväksyntätila ja avoin jatkotyö ilman
omistajaan tai koneeseen yhdistettävää diagnostiikkaa. Tarkempi raja on
`docs/architecture/security-principles.md`-dokumentin julkaisusäännössä.

Ennen committia ja pushia tarkista tiedostolistan lisäksi raporttien sisältö,
staged diff ja viestit. Git-ohitus ei suojaa jo versionoitua tiedostoa eikä
toiseen raporttiin kopioitua sisältöä. Jos tietoa on jo julkaistu, pysäytä
sen levitys ja kerro omistajalle; nykyversion siivous ei poista Git-historiaa.
Historian uudelleenkirjoitus tai muu laaja etäpoisto vaatii erillisen päätöksen.

## Dokumentaation roolit

`docs/product/` kertoo mitä yritys tekee ja miksi ohjelmisto rakennetaan.

`docs/architecture/` kertoo miten järjestelmä rakennetaan.

`docs/modules/` kertoo mitä kukin moduuli tekee ja mitä se omistaa.

`docs/ai/` kertoo miten AI:n kanssa työskennellään tässä projektissa.

`docs/decisions/` sisältää tärkeät arkkitehtuuripäätökset ADR-muodossa.

`docs/design/` kertoo miltä Eky-käyttöliittymän pitää tuntua ja miten UI-periaatteita sovelletaan.

## Ydinperiaatteet

1. Turvallisuus ensin.
2. Pidä järjestelmä modulaarisena.
3. Älä sekoita liiketoimintalogiikkaa käyttöliittymään.
4. Älä lisää uusia riippuvuuksia ilman projektin omistajan erillistä,
   nimenomaista hyväksyntää.
5. Älä luo moduulien välisiä oikopolkuja.
6. Älä tee laajoja arkkitehtuurimuutoksia ilman erillistä hyväksyntää.
7. Suosi pieniä, selkeitä ja yhden vastuun tiedostoja.
8. Päivitä dokumentaatiota, jos arkkitehtuuri, työnkulku tai liiketoimintasääntö muuttuu.
9. Pidä domain-kerros riippumattomana käyttöliittymästä, tietokannasta, Firebasesta ja ulkoisista integraatioista.
10. Käyttöliittymä ei saa kutsua suoraan tietokantaa tai Firebase-palveluita.
11. Backend tarkistaa aina käyttöoikeudet.
12. AI-agentit eivät saa tulevaisuudessakaan ohittaa samoja sääntöjä, joita käyttöliittymä noudattaa.
13. Nykyistä autentikoimatonta local-MVP:tä ei avata verkkoon eikä käytetä oikealla asiakas- tai laskutusdatalla.
14. Tuotantokoodi ei saa sisältää kone-, käyttäjä- tai repositorykohtaista
    absoluuttista polkua. Ajonaikaiset polut johdetaan omistavan runtimen
    validoidusta juuresta, native-valinnasta tai injektoidusta konfiguraatiosta.
15. Protokolla-arvot, formaattiversiot ja turvallisuusrajat nimetään ja
    keskitetään omistavaan moduuliin. Samaa merkitystä ei kopioida irrallisina
    merkkijonoina tai numeroina useaan kerrokseen.
16. Release- tai runtime-artifactia ei kloonata hardlinkillä lähde- tai
    hyväksyttyyn artifactiin. Testifixture käyttää itsenäisiä tiedostotavuja;
    hardlink on sallittu vain dokumentoidussa atomisessa tiedosto-operaatiossa,
    jossa linkki-identiteetti on osa tarkoitettua sopimusta ja validoidaan.

## Arkkitehtuurin päälinja

Projektissa käytetään modulaarista monoliittia.

Tavoitteena ei ole rakentaa mikropalveluarkkitehtuuria ensimmäisessä vaiheessa.

Järjestelmä rakennetaan kuitenkin niin, että moduuleja voidaan myöhemmin irrottaa omiksi palveluikseen, jos siihen tulee todellinen tarve.

Eky suunnitellaan paikallisesti toimivaksi ja pilveen laajennettavaksi ERP-järjestelmäksi.

Sama domain- ja service-logiikka pyritään pitämään käytettävissä paikallisessa offline-versiossa, pilviversiossa ja myöhemmin mobiilissa.

## Suunniteltu korkean tason rakenne

Alustava rakenne:

- `apps/web`
- `apps/backend`
- `packages/domain`
- `packages/validation`
- `packages/api-client`
- `packages/auth`
- `packages/permissions`
- `packages/ui`
- `packages/config`

Lopullinen rakenne tarkentuu projektin edetessä.

`packages/utils` ei kuulu ensimmäiseen skeleton-rakenteeseen. Se voidaan lisätä myöhemmin vain erillisellä päätöksellä ja tarkasti rajatulla vastuulla.

## Kerrossäännöt

Liiketoimintasäännöt kuuluvat domain-kerrokseen.

Validointi kuuluu validation-kerrokseen.

Frontendin API-kutsut kuuluvat api-client-kerrokseen.

Firebase Auth eristetään auth- tai infrastructure-kerroksen taakse.

Käyttöoikeuslogiikka keskitetään permissions- tai authorization-kerrokseen.

Uudelleenkäytettävät käyttöliittymäkomponentit kuuluvat ui-kerrokseen.

Backendissä handler vastaanottaa pyynnön, service ohjaa käyttötapauksen ja repository hoitaa tietokantayhteyden.

## Koodin kieli

Dokumentaatio, suunnittelu ja liiketoiminnan kuvaukset voidaan kirjoittaa suomeksi.

Kaikki koodi kirjoitetaan englanniksi.

Tämä koskee muuttujia, funktioita, luokkia, tyyppejä, rajapintoja, tiedostonimiä, kansioita, tietokantatauluja, tietokantakenttiä ja API-reittejä.

Käytä `docs/product/glossary.md`-sanastoa oikeiden termien varmistamiseen.

Älä sekoita suomea ja englantia samaan kooditermiin.

Käyttäjälle näkyvät käyttöliittymätekstit ovat ensisijaisesti suomeksi.

UI-tekstien rakenne pidetään sellaisena, että muita kieliä voidaan lisätä myöhemmin hallitusti ilman laajaa uudelleenkirjoitusta.

## Ennen työn aloittamista

Ennen muutosten tekemistä:

1. Lue tämä tiedosto.
2. Lue tehtävään liittyvät dokumentit `docs/`-kansiosta.
3. Tarkista, onko kohdekansiossa oma `AGENTS.md`.
4. Anna lyhyt toteutussuunnitelma, jos tehtävä on laaja tai arkkitehtuuriin vaikuttava.
5. Tunnista oikea kerros ja moduuli.
6. Rajaa muutos mahdollisimman pieneksi.
7. Älä lisää riippuvuuksia ilman hyväksyntää.
8. Älä muuta arkkitehtuuria ilman hyväksyntää.

## Ennen kuin ilmoitat työn valmiiksi

Jokaisen uuden tai muuttuvan toiminnon mukana tarkistetaan
`docs/ai/workflow.md`:n **Toiminnon valmistumisportti**. Se koskee myös
virhekorjauksia, ei vain uusia moduuleja. Testit, käyttäjän palaute,
virheiden jäljitettävyys, diagnostiikka, tietoturva ja datan palautettavuus
arvioidaan samassa tehtävässä. Soveltumaton kohta perustellaan; tekemätöntä
tarkistusta ei merkitä läpäistyksi.

Lokituksen olemassaoloa ei todisteta pelkällä loggerin yksikkötestillä:
varmista omistavan runtimen todellinen kytkentä ja tapahtumalle tarkoitettu
lukuketju. Uusi tapahtuma saa jäädä Diagnosticsin, Activityn, tukipaketin tai
incident-indeksin ulkopuolelle vain tarkoituksellisen sopimuksen perusteella.
Näihin kaikkiin ei tarvitse lisätä jokaista tapahtumaa.

Tarkista:

1. Noudattaako muutos moduulirajoja?
2. Vuotaako jokin riippuvuus väärään kerrokseen?
3. Onko liiketoimintalogiikka oikeassa paikassa?
4. Onko turvallisuus huomioitu?
5. Onko käyttöoikeudet huomioitu backendissä?
6. Onko tiedostoilla selkeä vastuu?
7. Tarvitaanko testi?
8. Tarvitaanko dokumentaatiopäivitys?
9. Syntyikö uusi riippuvuus?
10. Muuttuiko jokin arkkitehtuuripäätös?
11. Onko julkaistavan sisällön yksityisyys tarkistettu julkaisukiellon mukaan,
    mukaan lukien raportit, staged diff, viestit ja artifactit?

Jos muutos rikkoo projektin periaatteita, älä tee sitä ilman erillistä hyväksyntää.

## Pakollinen riippuvuuksien hyväksyntäportti

Uusi kolmannen osapuolen runtime- tai development-riippuvuus hyväksytään aina
erillisenä päätöksenä. Laajan tehtävän, toteutusvaiheen tai suunnitelman
hyväksyminen ei samalla hyväksy siinä nimeämätöntä riippuvuutta.

Ennen riippuvuuden asentamista, importointia tai `package.json`- ja
lockfile-muutosta AI:n pitää:

1. nimetä ehdotettu riippuvuus ja tarkka käyttötarkoitus
2. vertailla projektin omaa toteutusta ja jo hyväksyttyjä vaihtoehtoja
3. raportoida ylläpito-, tietoturva-, toimitusketju- ja paketointivaikutukset
4. pyytää projektin omistajalta riippuvuudelle nimenomainen hyväksyntä

Jos riippuvuuden todellinen tarve ilmenee ensimmäisen kerran vasta koodauksen
aikana, työ pysäytetään juuri siinä kohdassa. Riippuvuutta ei saa kokeeksi
asentaa tai kirjoittaa toteutukseen ennen uutta hyväksyntää. Näin ratkaisu
voidaan vielä perua, rajata tai korvata omalla toteutuksella ennen kuin se
juurtuu koodiin tai lockfileen.

AI ei saa tulkita omaa riippuvuusarviotaan hyväksynnäksi. Jos riippuvuus on
lisätty vahingossa ilman tätä porttia, työtä ei commitoida tai pushata. Tilanne
raportoidaan heti ja muutos pidetään peruttavana projektin omistajan päätökseen
asti.
