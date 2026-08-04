# ADR-0010: Windows-asennin ja päivitysorkestrointi

## Tila

Hyväksytty.

## Päätös

Eky Local käyttää yhtä Windows-asennin- ja päivitysmoottoria. Sama
allekirjoitettava release-artifacti tukee:

- puhdasta asennusta
- olemassa olevan asennuksen päivitystä suoraan Setup-ohjelmalla
- myöhemmin Eky-sovelluksen käynnistämää paikallista päivitystä

Installeriteknologiaa tai uutta riippuvuutta ei valita tässä ADR:ssä. Valinta
tehdään erillisessä dependency-, security-, Windows-paketointi- ja
ylläpitoarviossa.

## Omistajuus

Electron mainin infrastructure-kerrokseen tulee myöhemmin kapea Eky Update
Coordinator. Se omistaa sovelluksen sisäisen päivityksen valmistelun:

1. validoi valitun päivityspaketin ja manifestin
2. tarkistaa nykyisen ja kohdeversion yhteensopivuuden
3. varmistaa pakollisen pre-update-palautuspisteen
4. kirjoittaa minimoidun päivitysjournalin
5. sulkee backendin, SQLite-yhteyden ja runtime-sessionin hallitusti
6. käynnistää ulkoisen asentajan tai updaterin tarkasti rakennetulla
   argumenttilistalla
7. lopettaa nykyisen Eky-prosessin

Käynnissä oleva Eky ei koskaan korvaa omia binaarejaan. Binaryjen asennus,
korvaaminen ja mahdollinen binary rollback kuuluvat ulkoiselle
asennin-/päivitysmoottorille.

## Asentajan dataraja

Asennin omistaa vain ohjelmabinaarit ja releaseen kuuluvat staattiset
resurssit. Se ei omista eikä poista:

- SQLite-tietokantaa
- yritysprofiilia tai business-artifacteja
- hyväksyttyjen laskujen PDF-varastoa
- operational- tai security-lokeja
- sähköpostisalaisuuksia tai `safeStorage`-tiedostoja
- palautuspisteitä tai siirrettäviä varmuuskopioita
- toimitettujen laskujen valinnaista PDF-arkistoa

Electronin `userData`- ja profiilijuuri pysyvät vakaassa, asennushakemiston
ulkopuolisessa sijainnissa puhtaan asennuksen, päivityksen ja
uudelleenasennuksen aikana.

Uninstall ei poista business dataa oletuksena. Mahdollinen erillinen
"poista myös kaikki paikalliset tiedot" -toiminto suunnitellaan myöhemmin
omana vahvistettuna ja auditoituna toimintona.

## Päivityslähde

Update Coordinator käyttää päivityslähteen adapteria:

- R0-pilotissa paikallinen tiedosto tai USB-media
- myöhemmin erikseen hyväksytty etäjulkaisukanava

Renderer ei anna main-prosessille raakaa tiedostopolkua, URL:ia,
komentoriviargumentteja tai käynnistettävää prosessia. Renderer käyttää vain
nimettyjä capabilityja, kuten päivityksen valinta, tarkistus, vahvistus ja
tilan näyttäminen. Native file dialog, polku ja prosessin käynnistys kuuluvat
Electron mainille.

Paikallisessa päivityksessä tarkistetaan vähintään:

- Eky-sovellusidentiteetti
- platform ja arkkitehtuuri
- lähtö- ja kohdeversio
- release-kanava
- paketin koko ja SHA-256
- tiukasti validoitu versionoitu manifesti

Paketin SHA-256 ei saa olla itseään sisältävä tiiviste. Myöhempi R0-installer
käyttää package-artifactista erillistä sidecar-manifestia tai muuta
ei-itseviittaavaa, allekirjoitettavaa envelope-rakennetta. Manifesti nimeää ja
tiivistää paketin, mutta ei sijaitse samassa tavujonossa, jonka SHA-256-arvon se
itse ilmoittaa.

Laajassa tai verkon kautta tehtävässä jakelussa vaaditaan lisäksi
allekirjoitettu julkaisu, tunnettu publisher, HTTPS-lähde ja erikseen
validoitu pakettiallekirjoitus ennen suorittamista.

## Päivitysjournalin tila

Update Coordinator käyttää yksityistä, minimoitua journalia
keskeytyksistä palautumiseen. Journalissa saa olla vain päivityksen
tilakoneeseen tarvittava tieto, kuten:

- journaliformaatin versio
- nykyinen ja kohdesovellusversio
- release-kanava
- paketin turvallinen tunniste ja tiiviste
- palautuspisteen sisäinen viite
- päivitysvaihe
- turvalliset aikaleimat

Journalissa ei ole yrityksen nimeä, `companyId`:tä, asiakas- tai laskudataa,
salaisuutta, raakaa paikallista polkua tai asentajan vapaamuotoista
komentoriviä. Journal ei ole julkinen HTTP-resurssi eikä rendererin
muokattava state.

Tilasiirtymät ovat yksisuuntaisia ja idempotentteja. Uudelleenkäynnistys ei
saa käynnistää samaa asentajaa huomaamatta toistamiseen.

## Ensimmäinen käynnistys päivityksen jälkeen

Asentajan onnistunut poistumiskoodi ei vielä tarkoita, että päivitys on
hyväksytty. Ensimmäinen Eky-käynnistys tarkistaa:

1. build- ja sovellusidentiteetin
2. päivitysjournalin
3. pre-update-palautuspisteen saatavuuden
4. migration chainin yhteensopivuuden
5. tietokannan migraatiot hallitussa maintenance-tilassa
6. SQLite integrity- ja foreign key -tilan
7. backendin readiness- ja health-tilan

Päivitys merkitään hyväksytyksi vasta terveen käynnistyksen jälkeen.
Hyväksymättä jäänyt käynnistys säilyttää palautumisessa tarvittavan
journalin ja palautuspisteen.

## Virhe ja rollback

Business-datan rollback käyttää ADR-0009:n pre-update-palautuspistettä.
Binary rollback kuuluu valitulle asennin-/päivitysmoottorille. Eky ei yritä
korjata epäonnistumista ajamalla SQL-migraatioita taaksepäin.

Jos käyttäjä käynnistää uuden `Setup.exe`-tiedoston suoraan ilman Eky Update
Coordinatorin journalia, ensimmäinen uusi Eky-runtime tekee pakollisen
pre-migration-palautuspisteen ennen ensimmäistä schemaa muuttavaa
migraatiota.

Jos asennin vaihtaa binaarit mutta uusi runtime ei käynnisty lainkaan,
binary rollbackin pitää olla mahdollinen asenninmoottorin avulla. Tämän
käyttäytyminen on osa installeriteknologian myöhempää hyväksyntäporttia.

## Release-kanavat

Ensimmäinen isän hallitulla koneella tehtävä R0-pilotti käyttää `pilot`-
kanavaa, paikallista mediaa ja käyttäjän vahvistamaa Setup-ajamista. Sitä ei
merkitä `stable`-julkaisuksi.

Tuleva etäpäivitys vaatii ennen käyttöönottoa:

- allekirjoitetut binaarit ja asennin
- hallitun code signing -avaimen lifecycle-mallin
- HTTPS-julkaisulähteen
- allekirjoitetun ja versionoidun päivitysmanifestin
- version, kanavan ja downgrade-politiikan
- katkenneen latauksen, rollbackin ja uudelleenkäynnistyksen E2E-testit
- release- ja incident-prosessin

Automaattista hiljaista päivitystä ei oteta käyttöön R0:ssa.

## Tausta ja perustelut

Eky on local-first-ohjelma, jossa tietokanta ja auktoritatiiviset lasku-
artifactit sijaitsevat samalla koneella kuin sovellus. Päivitys ei siksi ole
pelkkä binaarien vaihto: ennen schemaa muuttavaa käynnistystä pitää olla
todennettu palautumispiste ja hallittu runtime-sulku.

Yksi asenninmoottori pienentää eroa puhtaan asennuksen ja päivityksen välillä.
Ulkoinen asentaja ratkaisee myös Windowsin tiedostolukot turvallisemmin kuin
käynnissä olevan sovelluksen oma binaarien korvaus.

## Seuraukset

Hyödyt:

- sama artifacti ja asennuslogiikka palvelevat puhdasta asennusta sekä
  päivitystä
- ohjelmabinaarit ja business data säilyvät eri omistajuuksissa
- päivitys ei aloita migraatiota ilman palautumismahdollisuutta
- myöhempi paikallinen ja etäpäivitys voidaan toteuttaa saman adapterirajan
  taakse
- renderer ei saa yleistä prosessi-, polku- tai URL-valtaa

Rajoitteet:

- installeriteknologia, allekirjoitus ja binary rollback vaativat vielä
  erillisen arvioinnin
- ensimmäinen pilotti ei vielä tarjoa automaattista etäpäivitystä
- business- ja binary-rollback ovat kaksi erillistä mekanismia
- uusi versio voidaan hyväksyä vasta terveellä ensimmäisellä käynnistyksellä

ADR-0009:n salattu backup, konekohtaiset recovery pointit, restore staging,
aktivointijournal, rollback ja kaksiprosessinen Windows packaged smoke ovat
toteutettu 4.8.2026. Tämä sulkee installerin business-data recovery
-esiehdon, mutta ei hyväksy installeria, code signingia, update-manifestia,
binary rollbackia tai automaattipäivitystä. Ne ovat tämän ADR:n seuraava
erillinen toteutus- ja release-portti.

## Ei toteuteta tässä päätöksessä

- installeria, makeria tai updateria
- uutta riippuvuutta
- code signing -avainta tai julkaisupalvelua
- etäpäivitystä
- hiljaista automaattipäivitystä
- update-UI:ta
- business- tai binary-rollback-koodia
- tietokantamigraation reverse-polkuja

## Liittyvät dokumentit

- `AGENTS.md`
- `apps/desktop/AGENTS.md`
- `docs/architecture/local-backup-and-restore-plan.md`
- `docs/architecture/local-desktop-dependency-review.md`
- `docs/architecture/local-desktop-implementation-plan.md`
- `docs/architecture/release-versioning-policy.md`
- `docs/architecture/windows-installer-and-update-plan.md`
- `docs/decisions/ADR-0007-local-desktop-shell-and-session-bootstrap.md`
- `docs/decisions/ADR-0008-local-desktop-company-workspaces.md`
- `docs/decisions/ADR-0009-local-backup-encryption-and-recovery-points.md`
