# ADR-0009: Paikallisen varmuuskopion salaus ja palautuspisteet

## Tila

Hyväksytty.

## Päätös

Eky Local erottaa kaksi eri palautumiseen tarkoitettua artifactia:

1. käyttäjän siirrettävä, salasanalla suojattu `.ekybackup`-varmuuskopio
2. Eky-runtimen hallitsema, kone- ja Windows-käyttäjäkohtainen palautuspiste

Yksi varmuuskopio tai palautuspiste koskee aina täsmälleen yhtä ADR-0008:n
mukaista yritysprofiilia. Kumpikaan artifacti ei ole tukipaketti,
toimitettujen laskujen valinnainen PDF-arkisto tai pilvisynkronointi.

## Siirrettävä `.ekybackup`

Siirrettävä varmuuskopio sisältää henkilötietoa ja liiketoimintadataa. Se on
aina salattu:

- käyttöliittymä ei tarjoa salaamatonta vaihtoehtoa
- käyttäjä antaa varmuuskopiokohtaisen salasanan
- sisältö salataan AES-256-GCM:llä
- avain johdetaan salasanasta `scrypt`-avaimenjohtamisfunktiolla
- jokaisella varmuuskopiolla on kryptografisesti satunnainen salt
- jokaisella salauksella on uniikki nonce
- GCM authentication tag säilytetään kokonaisena
- versionoitu otsake sidotaan salaukseen additional authenticated data
  -tietona
- salaamattomassa otsakkeessa ei ole yrityksen nimeä, `companyId`:tä,
  paikallista polkua tai muuta henkilötietoa

Tarkkoja `scrypt`-parametreja ei arvata tässä päätöksessä. Ne valitaan
toteutusvaiheessa kohde-Windows-laitteella tehdyn muistinkäyttö- ja
suorituskykybenchmarkin sekä turvallisuusarvion perusteella. Parametrit
versionoidaan artifactissa, niille asetetaan turvalliset minimi- ja
maksimirajat ja liian heikko tai resurssien käytöllä palvelunestoon pyrkivä
arvo torjutaan.

Salasanaa, johdettua avainta tai selväkielistä varmuuskopiosisältöä ei
tallenneta levylle, lokiin, diagnostiikkaan, tukipakettiin, komentoriville,
URL:iin tai ympäristömuuttujaan. Selväkielisen datan ja avainmateriaalin
elinikä prosessimuistissa pidetään mahdollisimman lyhyenä.

Unohtuneelle varmuuskopiosalasanalle ei tehdä takaovea tai palautusavainta.
Käyttöliittymän pitää kertoa ennen varmuuskopion luontia, ettei Eky voi
palauttaa unohtunutta salasanaa.

## Konekohtainen palautuspiste

Automaattinen palautuspiste on eri artifacti kuin `.ekybackup`:

- se on tarkoitettu saman paikallisen asennuksen tekniseen palautumiseen
- se ei ole käyttäjän siirrettävä varmuuskopio
- sisältö salataan satunnaisella data-avaimella
- data-avain suojataan Electron main processin `safeStorage`-rajapinnalla
- Windowsissa suojaus on sidottu käyttöjärjestelmän käyttäjäkontekstiin
- renderer, backendin julkinen HTTP-rajapinta ja tukipaketti eivät saa avainta
  tai salattua payloadia
- jos `safeStorage` ei ole käytettävissä, palautuspistettä ei kirjoiteta
  salaamattomana

Palautuspiste ei korvaa käyttäjän erilliseen sijaintiin tallentamaa
siirrettävää varmuuskopiota. Koneen, levyn tai Windows-profiilin menetys voi
tehdä myös paikalliset palautuspisteet käyttökelvottomiksi.

## Palautuspisteiden ajastus

Eky tarkistaa palautuspisteen tarpeen:

- terveen käynnistyksen jälkeen, jos viimeisestä hyvästä pisteestä on vähintään
  24 tuntia
- rajatulla päivittäisellä tarkistuksella pitkään auki olevassa runtimessa
- pakollisesti ennen tietokantamigraatiota
- pakollisesti ennen ohjelmapäivitystä
- pakollisesti ennen palautusoperaatiota
- sammutuksessa vain best effort -toimintona

Palautuspiste tehdään vain terveestä profiilista. Epäsiistin sammutuksen
jälkeen Eky tekee ensin integrity- ja recovery-tarkistuksen eikä tallenna
mahdollisesti vioittunutta tilaa uutena hyvänä palautuspisteenä.

## Rotaatio

Palautuspisteiden rotaatio huomioi:

- päivittäiset pisteet
- viikoittaiset pisteet
- kuukausittaiset pisteet
- pre-update-pisteet
- pre-restore-pisteet
- absoluuttisen levybudjetin

Uusinta validoitua hyvää pistettä ei poisteta. Aktiivista pre-update- tai
pre-restore-pistettä ei poisteta ennen kuin sitä seuraava käyttöönottovaihe on
hyväksytty tai uudempi korvaava piste on validoitu.

Tarkat säilytysmäärät ja levybudjetti määritetään toteutusvaiheessa
kohdelaitteen kapasiteetin perusteella. Retention ei saa perustua pelkkään
tiedostonimeen tai luontiaikaan, vaan artifactin validointi- ja
käyttöönottotilaan.

## Palautuksen atomisuus

R0 palauttaa aina kokonaisen yritysprofiilin. Taulu-, lasku-, asiakas- tai
tiedostokohtaista osapalautusta ei toteuteta.

Palautus käyttää seuraavaa mallia:

1. lähdeartifacti avataan Electron mainin omistamalla capabilitylla
2. formaatti, rajat, salaus, manifesti ja checksumit validoidaan
3. sisältö kirjoitetaan uuteen staging-profiiliin
4. SQLite integrity, foreign keys, migraatioyhteensopivuus ja business-
   artifactien viittaukset tarkistetaan
5. aktiivisesta profiilista tehdään pre-restore-palautuspiste
6. nykyinen runtime, session ja tietokantayhteys suljetaan
7. staging-profiili aktivoidaan atomisesti
8. uusi runtime käynnistetään ja health-check suoritetaan
9. epäonnistumisessa palataan pre-restore-pisteeseen

Backup-formaatin yhteensopivuus ja sovellusversion yhteensopivuus ovat eri
asioita. Tiedostopääte ei ratkaise kumpaakaan, eikä restore saa ajaa
automaattista reverse-migraatiota vanhempaan schemaan.

## Yritysprofiilin raja

R0:ssa toisesta asennuksesta tuotu varmuuskopio voidaan palauttaa vain tyhjään
Eky-asennukseen. Olemassa olevan eri yrityksen profiilin päälle sitä ei
palauteta.

Myöhemmin mahdollinen multi-profile-tuki voi tarjota toiminnon "palauta uutena
yritysprofiilina". Se vaatii erillisen profiilirekisterin, lifecycle-säännöt
ja cross-profile-eristystestit.

## Tausta ja perustelut

Pelkkä SQLite-tiedoston kopio ei kata laskujen auktoritatiivisia PDF-
artifacteja eikä takaa käynnissä olevan tietokannan eheyttä. Salaamaton
siirrettävä varmuuskopio taas altistaisi asiakas- ja laskutustiedot
muistitikulla, pilvikansiossa tai väärälle vastaanottajalle lähetettynä.

Kaksi artifactityyppiä ratkaisee eri tarpeet:

- `.ekybackup` on käyttäjän hallitsema ja koneiden välillä siirrettävä
- palautuspiste mahdollistaa nopean teknisen rollbackin samalla koneella

Pakollinen autentikoitu salaus estää myös varmuuskopion huomaamattoman
muuttamisen. Staging ja atominen profiilinvaihto estävät aktiivisen datan
osittaisen korvautumisen epäonnistuneessa palautuksessa.

## Uhkamalli ja rajoitteet

Päätös suojaa erityisesti:

- kadonneelta tai väärään paikkaan kopioidulta varmuuskopiotiedostolta
- sisällön luvattomalta muuttamiselta
- osittaiselta tai väärään profiiliin tehdyltä palautukselta
- rikkoutuneelta päivitykseltä tai migraatiolta
- rendereristä tulevilta raaoilta tiedostopoluilta ja salausparametreilta

Päätös ei yksin suojaa:

- haittaohjelmalta, joka toimii samalla Windows-käyttäjätilillä Ekyä
  käytettäessä
- heikolta käyttäjän valitsemalta varmuuskopiosalasanalla
- levyrikolta, jos sekä data että kaikki palautuspisteet ovat samalla levyllä
- käyttäjän unohtamalta varmuuskopiosalasanalla

Salasanapolitiikka, memory-hard-parametrit, brute-force-rajojen
käyttökokemus ja mahdollinen turvallinen salasanan vahvuusohjaus täsmennetään
ennen tuotantokoodia.

## Ei toteuteta tässä päätöksessä

- backup-, restore- tai palautuspistetuotantokoodia
- käyttäjän valitsemaa salaamatonta varmuuskopiota
- pilvivarmuuskopiota
- automaattista palautusta ilman käyttäjän tai update coordinatorin hallittua
  päätöstä
- osapalautusta
- multi-profile-käyttöliittymää
- uutta kryptografia- tai pakkausriippuvuutta
- tarkkoja `scrypt`-parametreja ilman benchmarkia

## Liittyvät dokumentit

- `AGENTS.md`
- `docs/architecture/local-backup-and-restore-plan.md`
- `docs/architecture/local-desktop-implementation-plan.md`
- `docs/architecture/security-principles.md`
- `docs/architecture/support-bundle-plan.md`
- `docs/decisions/ADR-0006-local-database-and-query-layer.md`
- `docs/decisions/ADR-0007-local-desktop-shell-and-session-bootstrap.md`
- `docs/decisions/ADR-0008-local-desktop-company-workspaces.md`
