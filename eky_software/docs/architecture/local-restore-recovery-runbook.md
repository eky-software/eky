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

## Keskeytynyt workspace-import

ADR-0011:n W3-import ei käytä aktiivisen profiilin restore-journalia. Sen
oma `WorkspaceBackupImportJournalV1` ratkaistaan startupissa ennen uuden
workspace-rootin tai registry-entryn käyttämistä.

Recovery hankkii ensin installation-scoped `import`-maintenance-leasen. Sen
jälkeen se validoi W3:n yksityisen plaintext-karanteenin ja poistaa vain
canonical UUID v4 -nimiset, rajatut tavalliset stale-payloadit. Tämä tehdään
ennen import-journalin lukemista ja myös silloin, kun journalia ei ole. Cleanup
ei avaa SQLitea eikä tarvitse alkuperäistä backupia tai salasanaa.

Jos karanteenissa on tuntematon nimi tai tyyppi, linkki, ylikokoinen payload,
epäselvä containment tai muu kuin W3:n allowlistattu entry, recovery pysähtyy
`recoveryRequired`-tilaan. Tukihenkilö ei poista tai nimeä sisältöä käsin,
eikä karanteenia käsitellä registry-, backup- tai workspace-rootina.

- Ennen `rootPublished`-tilaa operaatio perutaan: candidate-kahvat suljetaan,
  candidate poistetaan tai jätetään turvallisesti karanteeniin ja registry
  säilyy muuttumattomana. Tuontia ei jatketa ilman backupin ja salasanan uutta
  valintaa.
- `rootPublished`-tilassa tukipolku todistaa runtime-absence-rajan ja validoi
  lopullisen rootin migration-, identity-, SQLite- ja artifact-sopimuksen
  ennen registry-julkaisua.
- `registryPublished`-tilassa registry-entryn, johdetun rootin ja lineagen
  täsmällinen vastaavuus todistetaan ennen journalin poistoa.

Ristiriita jää `recoveryRequired`-tilaan. Tukihenkilö ei nimeä rootteja,
muokkaa registryä, yhdistä SQLite-rivejä eikä korvaa työtilaa käsin. W3-
recovery ei tarvitse eikä saa säilyttää backupin lähdepolkua, salasanaa tai
avainta.

W3 ja tämä quarantine-recovery ovat vielä inertti foundation. Ne eivät ole
production-startupissa, package-payloadissa, preloadissa, IPC:ssä tai UI:ssa.
