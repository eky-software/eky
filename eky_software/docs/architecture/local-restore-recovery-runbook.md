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

## Tarkistushylkäys ja lisävirhe

Palautuksen kirjoitussuojan vanhentuminen tai hallintakanavan katkeaminen
ei valtuuta jatkamaan eikä vapauttamaan business-kirjoituksia. Sama koskee
mainin toteamaa epävarmaa journalitilaa. Säilytä aineisto ja käytä hallittua
uudelleenkäynnistystä; uusi runtime avaa työtilan vasta nykyisten journal-,
omistajuus- ja terveystarkistusten jälkeen. Epäselvä tila pysyy suljettuna.
Tämän [hyväksytyn suojasopimuksen](local-backup-and-restore-plan.md#palautuksen-kirjoitussuojan-erillinen-vapautussääntö)
tilakone-/broker-näyttö ei yksin hyväksy varsinaista aktivointikytkentää.

Pelkkä ennen aktivointia keskeytynyt varmuuskopion tarkistus ei tarkoita
osittaista palautusta. Aktiivista yritystä ei korvata eikä sen tietoja
palauteta uudelleen vain tarkistushylkäyksen vuoksi.

Aktivoinnin valmistelukutsu voi epäonnistua myös sen jälkeen, kun journal
on tallentunut. Journalin puuttuminenkaan ei yksin todista puhdasta
epäonnistumista: valmistelussa luotu rollback- tai failed-kansio voi olla
jäljellä. Tällainen ristiriita säilyttää aineiston ja estää uuden aktivoinnin
tai stagingin poiston; kansiota ei siivota arvaamalla. Jos valmistelu on
pysyvä tai sen tila epävarma, sama slot ei enää kuulu discard-toiminnolle.
`restore.activationFailed` säilyttää ensisyyn ja erillinen
`restore.recoveryRequired` vaiheessa `activation` kertoo selvitystarpeesta.
Kumpikaan ei yksin todista, että business-tiedostoja olisi jo siirretty.

`restore.acceptanceFailed` tarkoittaa, että jo validoidun palautuksen
hyväksynnän valmistelu, julkaisu tai loppusiivous epäonnistui. Tarkista
turvallinen ensisyy ja saman korrelaation muut tapahtumat: aiempi
`restore.validationCompleted` ei takaa koko palautuksen valmistumista.
`acceptanceCommit` ei yksin todista hyväksynnän julkaisun epäonnistuneen,
eikä `acceptedCleanup` todista kaiken siivoutuneen. `unknown`-sivuvaikutus
ei oikeuta aineiston poistamiseen tai uuteen palautukseen. Nykyinen
journalin ja runtimen palautuspolku ratkaisee jatkon; sitä ei päätellä
lokimerkinnästä. Mahdollinen `restore.recoveryRequired` on erillinen
selvitystila, ei alkuperäisen syyn korvaaja.

Workspace-tuonnin tai korvauksen turvallinen `workspaceBackup.operationFailed`
säilyttää tunnetun ensisyyn tai `unknown`-luokituksen. Samalla korrelaatiolla
kirjattu `workspaceBackup.cleanupFailed` kertoo erillisestä palautuksen,
siivouksen tai varauksen vapautuksen hylkäyksestä. Se ei muuta ensisyytä
eikä yksin todista, missä sisäisessä vaiheessa palautus oli. `import|replace`
on käyttötapaus, ei aktivointivaihe. `sideEffectState: unknown` ei ole todiste
muuttumattomasta datasta tai onnistuneesta rollbackista.

Käytä journalin ja runtimen nykyistä palautuspolkua ratkaisemattoman tilan
arviointiin. Älä poista epävarmaa aineistoa tai aloita uutta korvausta
tapahtumakoodin perusteella. Diagnostiikka ja tukipaketti sisältävät vain
[suljetun teknisen projektion](r0-observability-event-catalog.md#desktop-operational-ja-security),
eivät raw Error -ketjua, journalia tai tietokantasisältöä.

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

Recovery hankkii ensin installation-scoped `import`-maintenance-leasen.
Nimenomainen kylmäkäynnistyksen `beforeRuntimeStart`-tila todistaa lisäksi
runtime-poissaolon ennen journalin tai karanteenin käsittelyä. Sen
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

Kylmäkäynnistyksen reconciliation-pala noudattaa
[ADR-0011:n hyväksyttyä terminal-rajaa](../decisions/ADR-0011-local-multi-workspace-company-model.md#createimport-recoveryn-kylmäkäynnistyksen-terminal):
täsmällinen jatkettava ready-workspace ja muuttumaton registry varmennetaan
ennen journalin poistoa, mutta business-runtime käynnistetään ja validoidaan
erikseen. Julkaisematon ensimmäinen tuonti ilman jatkettavaa työtilaa jää
suljetuksi journalin kanssa. C:n production-startup-kytkentä ja
packaged-keskeytystodennus kuuluvat sen
[hyväksyttyyn integraatiocheckpointiin](release-0.3.0-m1-preparation-plan.md#jatka-tästä).
K:n myöhempi rakenne- ja tarkistusmuutos tarvitsee oman palautus- ja
pakettitodennuksensa; C:n läpäisy ei hyväksy sitä automaattisesti.

## Keskeytynyt same-lineage workspace -korvaus

W3b-korvaus käyttää nykyistä profile restore activation journalia ja
`ProfileRestoreStartupRecovery`-tilakonetta workspace-kohtaisilla poluilla.
Sille ei ole erillistä rollback-journalia. Recovery muodostaa transactionin
vain registryn aktiiviselle `ready`-entrylle ja todistaa ennen jatkamista,
että registryssä on täsmälleen yksi samaa lineagea käyttävä entry.

Activation journalin vaihe ratkaistaan nykyisen restore-runbookin mukaisesti:

- ennen `validationStarting`-vaihetta transaction jatkaa idempotentisti
  atomisen siirron loppuun tai aloittaa rollbackin
- `validationStarting` vaatii saman workspacen uuden runtimen health-,
  identity-, migration- ja artifact-validoinnin
- `accepted` tarkoittaa pysyvää hyväksyntää, ei automaattisesti valmistunutta
  siivousta. Keskeytynyt siivous odottaa tuoreen runtimen sisältövalidointia;
  siivousvirhe ei aloita vanhan sisällön rollbackia
- `rollbackStarting` ja `rolledBack` palauttavat sekä todistavat vanhan
  workspace-datan ennen journalin poistoa. Jos journal todistaa alkuperäisen
  tietokannan puuttuneen, business-käynnistys estetään selvitykseen ennen
  uuden tyhjän kannan luontia; journal ja tiedostot säilyvät
- `failedSafe` tai epäselvä registry/lineage jättää workspacen
  `recoveryRequired`-tilaan.

Tukihenkilö ei muokkaa registryä, vaihda active pointeria, kopioi backupin
rivejä aktiiviseen SQLiteen eikä poista rollback-rootia käsin. Registry,
muiden workspacejen rootit, salaisuudet, PDF-arkisto, update/cache ja lokit
ovat korvauksen ulkopuolella. W5A:n sisäinen production-lifecycle ratkaisee
keskeytyneen korvauksen ennen business-runtimen avaamista.

Jos `rolledBack`-loppusiivous hylätään rollback-juuren tuntemattoman tai
myöhäisen sisällön vuoksi, myös tuo sisältö ja journal säilytetään.
Tuntematonta tiedostoa tai kansiota ei poisteta käsin pelkän käynnistyksen
vapauttamiseksi. [Loppusiivouksen rajattu sopimus](local-backup-and-restore-plan.md)
ei yksin todista profiilin terveyttä tai oikeuta uuteen rollbackiin.

Hyväksynnän julkaisun varmentamaton kuittaus ei todista, ettei hyväksyntää
tapahtunut. Tällainen tila säilytetään selvitykseen eikä palautusta tai
aineiston poistoa pakoteta käsin. [Rajattu terminal-tilakytkentä](release-0.3.0-m1-preparation-plan.md#v2az-hyväksynnän-pysyvyys-ja-alkuperäiskannan-poissaolo)
ei yksin todista vielä koko K:n uutta live-/native-valtuutta tai paketoituja
palautusportteja.

W5B.2:n käyttäjäpolku ei tarjoa recovery-journalin korjausta tai manuaalista
rollbackia. Toiminto näytetään vain aktiiviselle `ready`-workspacelle
normaalissa `idle`-tilassa. Electron main omistaa backupin valinnan, salasanan,
lopullisen native-varoituksen ja aktiivisen kohteen johtamisen. Peruutus ennen
service-kutsua ei muuta registryä, journalia tai runtimea. Kun replace-
transaction on käynnistynyt, onnistunut aktivointi tai todistettu rollback
päättyy hallittuun uudelleenkäynnistykseen; epäselvä tila pysyy
`recoveryRequired`-tilassa eikä UI saa ohittaa sitä.

W5B.2:n hyväksytty Electron-E2E-polku todistaa exact-lineage-korvauksen,
väärän lineagen fail-closed-torjunnan sekä tiedoston valinnan, salasanan ja
viimeisen native-vahvistuksen peruutukset. Testi ei käytä oikeaa profiilia,
yritysdataa tai salaisuutta eikä avaa UI:lle recovery-journalin hallintaa.
