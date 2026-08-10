# Paikallisen palautuksen recovery-runbook

## Tarkoitus

Tämä ohje koskee tilannetta, jossa Eky ei pysty viimeistelemään tai perumaan
profiilin palautusta varmasti. Tällöin business-käyttöliittymää ei avata ja
tila vaatii luotetun tukihenkilön tarkistuksen.

## Käyttäjän toiminta

1. Sulje Eky palautusvirheen dialogista.
2. Älä käynnistä palautusta toistuvasti, poista tiedostoja tai muokkaa
   tietokantaa, recovery pointteja, stagingia tai aktivointijournalia käsin.
3. Valitse tarvittaessa `Avaa lokikansio`. Eky avaa vain main-prosessin
   tunteman oman operational-lokikansion; renderer ei anna polkua.
4. Säilytä alkuperäinen `.ekybackup`, nykyinen kone ja Windows-käyttäjäprofiili
   muuttamattomina.
5. Ota yhteys luotettuun tukihenkilöön. Toimita lokit tai tukipaketti vain
   ennalta sovitulla turvallisella kanavalla.

Dialogissa tai lokien avauksessa ei näytetä raakaa filesystem-, SQLite-,
journal-, backup- tai profiilipolkua. Käyttäjää ei ohjata kokeilemaan
satunnaisia tiedostotoimia.

## Tukihenkilön tarkistus

Tukihenkilö:

1. varmistaa, ettei Eky- tai backend-prosesseja ole käynnissä
2. ottaa tutkimista varten muuttamattoman kopion runtime-lokeista ja
   palautuksen teknisistä tilatiedostoista turvalliseen paikalliseen
   työhakemistoon
3. tarkistaa operational-eventit, aktivointijournalin tilan ja tunnetut
   recovery pointit ilman business-datan tulostamista tai lähettämistä
4. tunnistaa viimeisen varmasti valmistuneen aktivointivaiheen
5. käyttää vain dokumentoitua rollback- tai recovery point -polkua; ei aja
   reverse-SQL:ää eikä yhdistä profiileja käsin
6. validoi ennen avaamista SQLite integrityn, foreign keyt, migraatioketjun,
   profiili-identiteetin ja auktoritatiiviset business-artifactit
7. käynnistää Eky:n vasta, kun journalitila on ratkaistu idempotentisti ja
   backendin health- sekä business-validointi onnistuvat

Jos turvallista automaattista tai dokumentoitua palautumista ei voida todistaa,
tila jätetään suljetuksi. Oikeaa dataa ei korvata arvaamalla.

## Todiste ja jälkitoimet

Ratkaisusta säilytetään minimoitu tekninen incident-yhteenveto:

- sovellus- ja build-versio
- turvallinen virhekoodi ja tapahtuma-aika
- käytetty dokumentoitu recovery-polku
- validointien tulokset ilman henkilötietoja tai raakadataa
- tieto siitä, avattiinko business-runtime vai jäikö se suljetuksi

Salasanoja, runtime-sessionia, asiakkaiden tai yrityksen tietoja,
laskusisältöä, raakaa manifestia tai siirrettävän backupin kohdepolkua ei
kirjata incident-yhteenvetoon.

Tämän runbookin manuaalinen harjoitus synteettisellä profiililla kuuluu R0:n
release security review -porttiin. Installer ja automaattipäivitys käyttävät
samaa recovery-required-pysäytyssääntöä.
