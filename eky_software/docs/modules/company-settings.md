# Company Settings -moduuli

Tämä dokumentti kuvaa ohjelmaa käyttävän yrityksen omien tietojen ja oletusasetusten moduulin.

Käyttäjälle näkyvä nimi voi olla esimerkiksi **Oma yritys**.

## Tarkoitus

Company Settings -moduuli sisältää ohjelmaa käyttävän yrityksen perustiedot ja oletusasetukset.

Se ei ole asiakas.

Se kuvaa yritystä, joka käyttää Ekyä ja joka myöhemmin muodostaa esimerkiksi laskun lähettäjän tiedot.

Ensimmäisessä vaiheessa moduulin tärkein tavoite on erottaa:

- ohjelmaa käyttävän yrityksen omat tiedot
- asiakkaiden tiedot
- laskutuksen myöhemmät snapshot-tiedot

## Moduuli Omistaa

Company Settings omistaa:

- oman yrityksen perustiedot
- oman yrityksen Y-tunnuksen
- oman yrityksen ALV-tunnuksen
- oman yrityksen yhteystiedot
- oman yrityksen kotisivutiedon
- oman yrityksen pääosoitteen
- oman yrityksen pankkitietojen master datan
- oletustuntihinnan
- tuntityön pikavalinnan
- oman yrityksen yleiset oletukset, jotka eivät kuulu toisen moduulin liiketoimintasäännöiksi

Laajempi käyttäjälle näkyvä Asetukset-osio voi sisältää usean moduulin näkymiä.

Invoicing omistaa omat liiketoimintakriittiset asetuksensa, kuten ALV-kannat,
maksuehdot, viivästyskoron, huomautusajan, numerointisarjat ja tilikauden.
Niitä ei siirretä Company Settingsin omistukseen vain siksi, että käyttöliittymä
näyttää asetukset samassa kokonaisuudessa.

## Moduuli Ei Omista

Company Settings ei omista:

- asiakkaita
- asiakaskohtaisia tuntihintaohituksia
- kohteita
- työmääräyksiä
- tuntikirjauksia
- materiaalikirjauksia
- laskuja
- laskurivejä
- laskulla käytettyjen tietojen snapshotteja
- maksutapahtumia

Customers-moduuli omistaa asiakaskohtaiset poikkeukset, kuten `hourlyRateOverrideCents`.

Invoicing-moduuli omistaa laskut, laskurivit ja laskulla käytetyt snapshot-arvot.

Käyttäjälle näkyvä Oma yritys -näkymä voi silti näyttää Invoicing-moduulin
omistamia laskutusasetuksia, kuten laskunumeroinnin, oletusviivästyskoron ja
huomautusajan. Tämä on UI-sijainti, ei moduuliomistajuuden muutos.

## MVP-Kentät

Ensimmäinen Company Settings MVP voi sisältää:

- `id`
- `companyId`
- `companyName`
- `businessId`
- `vatNumber`
- `streetAddress`
- `postalCode`
- `city`
- `email`
- `phone`
- `website`
- `emailDeliveryProvider`
- `emailSenderName`
- `emailSenderAddress`
- `emailSmtpHost`
- `emailSmtpPort`
- `emailSmtpSecurity`
- `emailUsername`
- `emailTestRecipientOverride`
- `emailSecretConfigured`
- `iban`
- `bic`
- `bankName`
- `defaultHourlyRateCents`
- `hourlyRateShortcut`
- `createdAt`
- `updatedAt`

Kenttien merkitys:

- `id` on asetusrivin tekninen tunniste.
- `companyId` rajaa tiedot nykyiseen yritykseen.
- `companyName` on oman yrityksen nimi.
- `businessId` on oman yrityksen Y-tunnus.
- `vatNumber` on oman yrityksen ALV-tunnus.
- `streetAddress`, `postalCode` ja `city` kuvaavat oman yrityksen pääosoitetta.
- `email`, `phone` ja `website` ovat oman yrityksen ensisijaiset yhteystiedot.
- `emailDeliveryProvider`, `emailSenderName`, `emailSenderAddress`,
  `emailUsername` ja `emailTestRecipientOverride` ovat sähköpostilähetyksen
  käyttäjän hallittavia ei-salaisia asetuksia.
- `emailSmtpHost`, `emailSmtpPort` ja `emailSmtpSecurity` ovat nykyisessä
  local-MVP:ssä vain kiinteän DNA-yhteysprofiilin yhteensopivuuslukutietoja.
  Niitä ei hyväksytä päivityspyynnöstä eikä näytetä muokattavina UI-kenttinä.
- `emailSecretConfigured` on käyttäjälle näytettävä tieto siitä, onko
  sähköpostisalaisuus asetettu myöhemmässä secrets-hallinnassa. Itse salaisuus
  ei kuulu Company Settings -tauluun eikä sitä palauteta frontendille.
- `iban`, `bic` ja `bankName` kuvaavat oman yrityksen maksutilin master dataa.
- `defaultHourlyRateCents` on oman yrityksen oletustuntihinta sentteinä.
- `hourlyRateShortcut` on käyttäjän määrittämä laskurivin nimike, joka voi
  ehdottaa tuntihinnan laskutus-UI:ssa.

## Oletustuntihinta

`defaultHourlyRateCents` on oman yrityksen oletustuntihinta sentteinä.

Ensimmäisessä toteutuksessa tuntihinta tallennetaan kokonaislukuna sentteinä, ei liukulukuna euroina.

Esimerkki:

```text
65,00 €/h -> 6500
```

Sitä käytetään myöhemmin, jos asiakkaalla ei ole asiakaskohtaista tuntihintaa.

Hinnoittelun perussääntö:

```text
jos customer.hourlyRateOverrideCents on asetettu
  -> käytä customer.hourlyRateOverrideCents
muuten
  -> käytä companySettings.defaultHourlyRateCents
```

Oletustuntihintaa voidaan käyttää myöhemmin esimerkiksi:

- työmääräyksissä
- työkirjauksissa
- laskutusluonnoksissa
- laskurivien muodostuksessa

Lopullinen hinnan käyttö päätetään kuitenkin laskutus-, työmääräys- ja työkirjausmoduulien yhteydessä.

## Tuntityön Pikavalinta

`hourlyRateShortcut` on valinnainen, enintään 50 merkin mittainen yhden rivin
teksti, esimerkiksi `työ` tai `laskutus`.

Kun käyttäjä kirjoittaa uuden laskurivin nimikkeeksi täsmälleen tämän arvon,
laskutus-UI saa ehdottaa riville tuntiyksikköä ja voimassa olevaa tuntihintaa.
Vertailu tehdään trimmattuna ja kirjainkoosta riippumatta.
Asiakas pitää valita ennen pikavalinnan kirjoittamista, jotta mahdollinen
asiakaskohtainen tuntihinta voidaan huomioida oikein.

Hintalähde ratkaistaan seuraavassa järjestyksessä:

```text
customer.hourlyRateOverrideCents
  ?? companySettings.defaultHourlyRateCents
```

Automaattitäyttö tapahtuu yhdelle lomakeriville enintään kerran. Jos käyttäjä
on syöttänyt tai muuttanut yksikköhintaa käsin, pikavalinta ei saa ylikirjoittaa
sitä. Tallennetusta luonnoksesta avattua hintaa ei myöskään täytetä uudelleen.

Pikavalinta on käyttökokemuksen oletus, ei laskennan domain-sääntö. Invoicing
tallentaa laskuriville käyttäjän hyväksymän eksplisiittisen yksikköhinnan, ja
backend validoi sekä laskee rivin normaalisti. Tyhjä `hourlyRateShortcut`
poistaa toiminnon käytöstä.

## Sähköpostiasetusten Ei-Salainen Runko

Oma yritys -näkymä voi näyttää ja tallentaa sähköpostilähetyksen ei-salaiset
asetukset:

- `emailDeliveryProvider`: `dryRun` tai `dnaSmtp`
- `emailSenderName`
- `emailSenderAddress`
- `emailUsername`
- `emailTestRecipientOverride`

`dnaSmtp` käyttää aina backendin omistamaa profiilia
`smtp.dnamail.fi:465` + implicit TLS, vähintään TLS 1.2. Hostia, porttia tai
security-mallia ei voi muuttaa Company Settingsistä. Lähettäjän osoitteen ja
DNA SMTP username -arvon pitää olla sama osoite. Nykyinen hallittu SMTP-testi
lähettää vain asetusten testivastaanottajalle eikä muuta laskua lähetetyksi.
Täysin paikallinen dry-run ei muodosta verkkoyhteyttä.

SMTP-salasanaa, OAuth-tokenia tai muuta salaisuutta ei tallenneta Company
Settings -tauluun, API-vastaukseen, frontendin pysyvään tilaan eikä
Git-repositorioon. Local desktop -salaisuuden lifecycle on toteutettu erillisen
`docs/architecture/email-delivery-and-secrets-plan.md` -linjan mukaisesti.

`emailSecretConfigured` on lukutieto. Se saa kertoa käyttäjälle, onko salaisuus
asetettu secret store -mallin kautta,
mutta se ei sisällä salaista arvoa eikä sitä käytetä salaisuuden
tallentamiseen.

Salaisuuspaneeli mountataan vain app-kerroksen vahvistamassa Electron-
runtimessa. Tavallinen selainkehitys ei kutsu sähköpostisalaisuuden tila-,
asetus- tai poistoreittejä.

Company Settingsin application-kerroksessa on toteutettu rajatut salaisuuden
asettamisen, poistamisen ja tilan tarkistamisen käyttötapaukset. Ne:

- saavat `companyId`-arvon vain validoidusta `ActorContext`-oliosta
- vaativat eksplisiittisen `manageCompanyEmailSecret`-permissionin
- käyttävät `CompanyEmailSecretStore`-porttia
- kirjoittavat asetus- ja poistotapahtumista rajatun audit eventin, jossa ei ole
  salaista arvoa tai siitä johdettua tietoa
- palauttavat vain `configured: true | false` -tilan
- eivät voi lukea tai palauttaa salaista arvoa

Koko Oma yritys -master-datan päivitys vaatii erillisen
`manageCompanySettings`-permissionin. Sähköpostisalaisuuden hallintaan
tarkoitettu `manageCompanyEmailSecret` ei anna oikeutta muuttaa yrityksen
nimeä, osoitetta, pankkitietoja tai muita Company Settings -kenttiä.

Secret lifecycle -audit käyttää yhtä operaatiokohtaista riviä. Ensin
tallennetaan `pending`, jonka jälkeen sama rivi päivitetään `succeeded`- tai
`failed`-tilaan. Jos secret store onnistuu mutta auditin loppupäivitys ei,
`pending` jää näkyviin myöhempää reconciliation-tarkistusta varten. Auditissa
ei ole salaista arvoa, hashia, pituutta, `secretRef`-arvoa tai muuta
salaisuudesta johdettua tietoa.

Käyttötapaukset on kytketty desktop-sessionilla suojattuihin tila-, asetus- ja
poisto-HTTP-reitteihin, API-clientiin ja Oma yritys -näkymän erilliseen
salasanapaneeliin. Tavallinen selainkehityksen backend ei rekisteröi näitä
reittejä. Salasanakenttää ei esitäytetä, arvoa ei pidetä React-tilassa ja kenttä
tyhjennetään onnistuneen tallennuksen jälkeen. Company Settings saa käyttää
vain lifecycle-storea ja konfigurointitilaa. Erillinen
`CompanyEmailSecretReader` on backend-only ja
varattu myöhemmälle hyväksytylle SMTP-providerille; sitä ei saa antaa HTTP:lle,
API-clientille, preloadille, rendererille tai web-UI:lle.

## Asiakaskohtainen Tuntihinta

Asiakaskohtainen tuntihinta ei kuulu Company Settings -moduulin omistamaan dataan.

Customers-moduuli omistaa kentän:

```ts
hourlyRateOverrideCents: number | null
```

Säännöt:

- jos `hourlyRateOverrideCents` on `null`, käytetään `companySettings.defaultHourlyRateCents`-arvoa
- jos `hourlyRateOverrideCents` on annettu, se ohittaa oletustuntihinnan kyseiselle asiakkaalle
- `0` ei tarkoita "ei asetettu"
- `0` tarkoittaa nolla senttiä eli nolla euroa
- puuttuva arvo kuvataan siksi `null`-arvolla

## Snapshot-Periaate

Oletustuntihinta ja asiakaskohtainen tuntihinta voivat muuttua ajan myötä.

Siksi laskulle tai laskuriville tallennetaan myöhemmin käytetty tuntihinta snapshotiksi.

Vanha lasku ei saa muuttua, vaikka:

- `companySettings.defaultHourlyRateCents` muuttuu
- `customer.hourlyRateOverrideCents` muuttuu
- asiakkaan muut tiedot muuttuvat

Invoicing-moduuli omistaa laskulla käytetyn tuntihinnan snapshotin.

Oman yrityksen pankkitiedot ovat Company Settings -master dataa. Hyväksytylle
laskulle tallennetaan myöhemmin maksutietojen snapshot, jotta vanhat laskut
eivät muutu, vaikka Oma yritys -kohdan IBAN, BIC tai pankin nimi muuttuu.
PDF, print-layout ja sähköpostilähetys käyttävät hyväksytyn laskun
snapshot-tietoja, eivät suoraan muuttuvaa Company Settings -dataa.

Oman yrityksen yhteystiedot, kuten sähköposti, puhelin ja kotisivu, kuuluvat
Company Settings -master dataan. Hyväksytty lasku snapshottaa laskulla
käytettävät yhteystiedot. Jos kotisivua ei ole annettu, sitä ei näytetä
laskulla tai PDF:n footerissa.

Oman yrityksen ALV-tunnus kuuluu samaan master-data-ajatteluun. Kun `vatNumber`
lisätään Company Settingsiin, hyväksytty lasku snapshottaa sen arvon
`seller_vat_number`-kenttään eikä hae sitä myöhemmin muuttuvista asetuksista.

## Moduulirajat

Company Settings omistaa:

- oman yrityksen tiedot
- oman yrityksen ALV-tunnuksen
- oman yrityksen yhteystiedot ja kotisivun
- oletustuntihinnan
- oman yrityksen yleiset oletukset
- tuntityön pikavalinnan
- oman yrityksen pankkitietojen master datan

Customers omistaa:

- asiakaskohtaisen tuntihintaohituksen
- asiakas-master-datan

Invoicing omistaa:

- laskut
- laskurivit
- ALV-kannat
- maksuehdot
- viivästyskoron ja huomautusajan laskutusasetukset
- numerointisarjat
- tilikauden
- laskulla käytetyn tuntihinnan snapshotin
- laskulla käytetyt lähettäjä- ja asiakastiedot snapshotteina, jos ne päätetään tallentaa laskulle
- hyväksytylle laskulle tallennettavan maksutietojen snapshotin

Work Orders ja Work Entries omistavat:

- työt
- tunnit
- mahdolliset työkohtaiset kirjaukset
- mahdolliset työkohtaiset hintapäätökset, jos sellainen sääntö myöhemmin päätetään

Toinen moduuli ei saa muuttaa Company Settings -dataa suoraan.

## UI-Ajatus

Sivupalkkiin voidaan myöhemmin lisätä kohta:

```text
Oma yritys
```

Ensimmäinen näkymä voi sisältää:

- oman yrityksen perustiedot
- oman yrityksen yhteystiedot
- oman yrityksen ALV-tunnuksen
- oman yrityksen osoitteen
- oman yrityksen pankkitiedot
- oletustuntihinnan
- tuntityön pikavalinnan

Oma yritys -näkymä kokoaa local-MVP:ssä myös ensimmäisiä laskutusasetuksia.
Tämä on käyttöliittymän koonti eikä moduulien yhdistäminen: laskutusasetusten
domain-, API- ja persistence-vastuu säilyy Invoicing-moduulilla.

Laskutusasetuksissa voidaan näyttää esimerkiksi:

- laskunumerointi
- numerointisarjat
- tilikausi
- maksuehdot
- ALV-kannat

Näiden UI-sijainti voi olla käyttäjän kannalta Oma yritys / Asetukset -kokonaisuudessa, mutta niiden domain-omistaja on Invoicing. Oma yritys -näkymä ei saa muodostaa laskunumeroita tai omistaa numerointisarjojen sääntöjä, vaikka se näyttäisi niiden lomakkeen käyttäjälle. Kun laskunumerointia on jo käytetty, Oma yritys -näkymän normaali numerointilomake lukitaan ja käyttäjälle näytetään varoitus, jotta laskunumerohistoriaa ei rikota. Laskunumeroinnin, hyväksynnän, snapshotin ja auditoinnin tarkempi periaate on kuvattu dokumentissa `docs/architecture/invoice-approval-numbering-plan.md`.

Käytetyn sarjan hallittu korvaaminen näytetään samassa näkymässä erillisenä
Invoicingin omistamana kaksivaiheisena poikkeustoimintona. Company Settings
ei muodosta teknistä sarja-avainta, laske turvallista aloitusnumeroa eikä
päättele aktivoinnin onnistumista paikallisesti. UI näyttää backendin
esikatselun, vaatii täsmällisen vahvistustekstin ja hakee aktivoinnin jälkeen
read-only-historian uudelleen. Vanhalle sarjalle ei tarjota muokkausta,
poistoa, resetointia tai uudelleenaktivointia.

Oma yritys omistaa yrityksen pankkitilien master datan. Ensimmäiset kentät ovat:

- `iban`
- `bic`
- `bankName`

Kentät ovat MVP:ssä valinnaisia. Kun pankkitiedot myöhemmin tarvitaan
hyväksytylle laskulle, Invoicing tallentaa laskulle maksutietojen snapshotin,
kuten `seller_iban`, `seller_bic` ja `seller_bank_name`. PDF, tulostus ja
sähköpostilähetys käyttävät hyväksytyn laskun snapshot-tietoja, eivät sen
hetkisiä muuttuvia Oma yritys -asetuksia.

Sähköpostin lähetysasetusten käyttäjälle näkyvä hallinta sijaitsee local-MVP:ssä
Oma yritys / Asetukset -kokonaisuudessa. Company Settings saa näyttää ja
muokata ei-salaisia asetuksia, kuten provider-valinnan, lähettäjän nimen,
lähettäjän sähköpostiosoitteen, username-arvon, testivastaanottajan ja tiedon
siitä, onko salaisuus asetettu. DNA SMTP:n host, portti ja implicit TLS
-turvallisuusmalli ovat backendin omistama kiinteä profiili.

Tavoiteltu käyttökokemus on, että käyttäjä voi myöhemmin määrittää oman
sähköpostitilinsä lähetysasetukset Ekyssä ja lähettää laskun suoraan
hyväksytyn laskun näkymästä. Tämä tarkoittaa backendin hallittua
SMTP/Gmail/Microsoft-provideria, ei webmail-käyttöliittymän automatisointia.

Company Settings ei saa näyttää, palauttaa API:ssa tai tallentaa näkyvään
tietokantakenttään SMTP-salasanaa, OAuth refresh tokenia tai muuta
sähköpostisalaisuutta. Salaisuuksien hallinta ja email-providerien tarkka malli
on kuvattu dokumentissa
`docs/architecture/email-delivery-and-secrets-plan.md`.

Asiakaskortissa on Hinnoittelu-osio asiakaskohtaista tuntihintaa varten.

Asiakaskortin tuntihintakentän ohjeteksti voi olla:

```text
Jos kenttä jätetään tyhjäksi, käytetään oman yrityksen oletustuntihintaa.
```

Käyttöliittymä saa ehdottaa tuntihintaa ja auttaa käyttäjää ymmärtämään,
mistä ehdotus tulee. Käyttäjän hyväksymä yksikköhinta välitetään laskurivillä
eksplisiittisesti. Backend validoi syötteen ja laskee laskun auktoritatiiviset summat;
se ei päättele piilossa eri hintaa laskuriville.

## Turvallisuus

Company Settings sisältää yrityksen omaa liiketoimintadataa.

Backend tarkistaa myöhemmin, että vain oikean yrityksen käyttäjä voi nähdä tai muokata näitä tietoja.

Frontend voi piilottaa toimintoja, mutta backend tekee lopullisen käyttöoikeuspäätöksen.

Oman yrityksen tietoja ei saa vuotaa toisen yrityksen käyttäjille.

## Rajataan Myöhemmäksi

Ei lisätä nykyiseen Company Settings MVP:hen ilman erillistä päätöstä:

- useita pankkitilejä
- verkkolaskuasetuksia
- OVT-tunnusta
- verkkolaskuoperaattoria
- useita hinnastoja
- tuoterekisteriä
- työroolikohtaisia hintoja
- työntekijäkohtaisia hintoja
- laskutusta
- dokumenttipohjia

ALV-kannat, maksuasetukset ja numerointiasetukset ovat Invoicing-moduulin
asetuksia, vaikka niiden lomakkeet näytetään local-MVP:ssä Oma yritys
-näkymässä. ALV-kantojen ensimmäinen yrityskohtainen hallintapolku on
toteutettu. Muutos ei päivitä hyväksyttyjen laskujen ALV-snapshotteja.

## Toimitettujen laskujen paikallinen PDF-kopio

Oma yritys -näkymä voi näyttää desktop-only-hallintapaneelin toimitettujen
laskujen valinnaiselle PDF-kopiolle. Paneelin sijainti Company Settings
-näkymässä ei tee asetuksesta Company Settings -master dataa.

Electron main omistaa konekohtaisen raakapolun, native-kansionvalinnan,
asetustiedoston, retry-journalin ja kansion avaamisen. Renderer saa vain
turvallisen näyttönimen, enabled-tilan, odottavien määrän, viimeisimmän
onnistumisajan ja sallitun virhekoodin. Selainversio näyttää vain
desktop-saatavuuden eikä jäljittele tiedostojärjestelmätoimintoa.

Valittu kansio otetaan käyttöön vasta, kun Electron main on todistanut siinä
saman exclusive temp + write + `fsync` + hard-link -finalisoinnin, jota oikea
laskuarkistointi käyttää. Epäonnistunut probe ei tallenna konekohtaista
asetusta eikä paljasta polkua rendererille tai virhevastaukseen.

Tarkka malli on dokumentissa
`docs/architecture/local-invoice-pdf-archive-plan.md`.

## Varmuuskopiointi ja palautus Oma yritys -näkymässä

Oma yritys -näkymä voi näyttää desktop-only-kortin
`Varmuuskopiointi ja palautus`. Sijainti ei tee backup-salasanasta,
backup-artifactista, palautuspisteestä, konekohtaisesta polusta tai
restore-journalista Company Settings -master dataa.

Company Settings -tauluun ei tallenneta:

- backup-salasanaa tai johdettua avainta
- `.ekybackup`-artifactia tai sen payloadia
- palautuspisteen salattua dataa tai `safeStorage`-avainta
- backup-, restore- tai activation-journalia
- käyttäjän valitsemaa raakaa tiedostopolkua

Electron main omistaa native-dialogit ja privileged tiedosto-operaatiot.
Renderer saa vain turvallisen tilan sekä nimetyt backup-, inspect- ja
restore-capabilityt. Selainversio ei jäljittele paikallista
tiedostojärjestelmätoimintoa.

Arkkitehtuurirajat on kuvattu ADR-0009:ssä ja dokumentissa
`docs/architecture/local-backup-and-restore-plan.md`.

Nämä ovat todennäköisiä tulevia tarpeita, mutta ne eivät kuulu ensimmäiseen suunnitteluvaiheeseen.

## Suhde Muihin Dokumentteihin

Liittyvät dokumentit:

- `AGENTS.md`
- `docs/architecture/module-boundaries.md`
- `docs/architecture/dependency-policy.md`
- `docs/architecture/invoicing-workflow-boundaries.md`
- `docs/modules/customers.md`
- `docs/modules/invoicing.md`
- `docs/architecture/customer-overview-plan.md`
- `docs/architecture/company-settings-implementation-plan.md`
- `docs/architecture/invoice-print-data-foundation-plan.md`
- `docs/architecture/local-backup-and-restore-plan.md`
- `docs/architecture/local-invoice-pdf-archive-plan.md`
- `docs/decisions/ADR-0009-local-backup-encryption-and-recovery-points.md`
