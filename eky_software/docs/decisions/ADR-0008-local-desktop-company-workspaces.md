# ADR-0008: Local desktop company workspaces

## Tila

Hyväksytty.

## Päätös

Eky Local R0 käyttää yhtä paikallista yritystyötilaa:

- yksi paikallinen profiili
- yksi SQLite-tietokanta
- yksi yritys
- yksi samanaikaisesti avoin desktop-runtime

R0:ssa ei toteuteta tuotantokäyttöön usean yrityksen valintaa, usean
tietokannan yhtäaikaista avaamista tai rendererin ohjaamaa profiilipolkua.
Backend muodostaa `companyId`:n edelleen luotetusta runtime-sessioniin
sidotusta `ActorContext`-kontekstista.

Tulevaisuudessa Eky Local voi tukea useita erillisiä paikallisia
yritysprofiileja samalla Windows-käyttäjällä. Silloinkin vain yksi profiili
saa olla auki kerrallaan. Profiilin vaihto on hallittu runtime-lifecycle:

1. keskeneräiset kirjoitukset ja taustatehtävät pysäytetään tai viimeistellään
2. backend suljetaan hallitusti
3. SQLite-yhteys suljetaan
4. runtime-session mitätöidään
5. profiilikohtaiset salaisuus-, config- ja tiedostoadapterit vapautetaan
6. vasta tämän jälkeen seuraavan profiilin runtime, tietokanta ja uusi session
   käynnistetään

Samanaikainen multi-company- tai multi-profile-runtime ei kuulu tähän
päätökseen. Pilven yritysjäsenyydet, roolit ja tenant-valinta ratkaistaan
erikseen pilvi-identiteetin mallissa.

## Tausta

Ensimmäinen Eky Local -asennus on yhden yrityksen hallittu desktop-sovellus.
Nykyinen Electron main omistaa backend-prosessin, runtime-sessionin ja
konekohtaiset privileged capabilityt. Backend käyttää yhtä SQLite-kantaa ja
muodostaa yrityskontekstin vahvistetusta paikallisesta runtime-identiteetistä.

Usean yrityksen avaaminen samaan runtimeen kasvattaisi luottamusrajaa:

- väärän tietokannan tai yrityksen käyttö pitäisi estää jokaisessa pyynnössä
- sessionin, salaisuuksien, PDF-varaston, auditin ja paikallisten asetusten
  profiilisidonta pitäisi todistaa
- keskeneräisten kirjoitusten ja taustatehtävien omistajuus pitäisi ratkaista
  profiilin vaihdossa
- varmuuskopiointi ja palautus pitäisi rajata täsmällisesti yhteen profiiliin

R0 ei tarvitse tätä monimutkaisuutta. Yhden profiilin malli pitää paikallisen
luottamusrajan ymmärrettävänä ja vähentää riskiä, että dataa kirjoitetaan
väärän yrityksen työtilaan.

## Tulevan profiilimallin rajat

Jos useat paikalliset yritysprofiilit myöhemmin hyväksytään:

- Electron main omistaa profiilirekisterin ja aktiivisen profiilin
- renderer saa vain rajatun profiilin valinta- tai vaihtocapabilityn, ei
  tietokanta- tai userData-polkuja
- jokaisella profiililla on erillinen tietokanta- ja business-artifact-juuri
- konekohtaiset asetukset ja salaisuusviitteet sidotaan profiiliin
- profiilin tunniste ei korvaa backendin `companyId`:tä eikä pilven tenant-
  identiteettiä
- profiilin vaihto vaatii käyttäjän vahvistuksen, jos keskeneräisiä toimintoja
  on
- edellisen profiilin session, tietokantakahva tai brokeri ei saa jäädä
  käyttöön vaihdon jälkeen
- backup/restore toimii yhden suljetun profiilin kokonaisuutena
- E2E todistaa vähintään cross-profile isolationin, restartin, epäonnistuneen
  vaihdon palautumisen ja sen, ettei kahta profiilia voi avata samanaikaisesti

Profiilihakemistoa tai tietokantaa ei valita mielivaltaisella rendereristä
tulevalla polulla. Mahdollinen tuonti, luonti ja palautus käyttävät Electron
mainin omistamia native-dialogeja ja validoituja formaatteja.

## Seuraukset

Hyödyt:

- R0:n local-session-, `ActorContext`- ja SQLite-raja pysyy yksiselitteisenä
- varmuuskopioinnin ensimmäinen toteutus voidaan rajata yhteen suljettuun
  yritysprofiiliin
- Electron pysyy infrastructure-kuorena eikä yritysvalinta leviä domainiin
- tuleva profiilituki voidaan lisätä lifecycle- ja storage-adapterien taakse

Rajoitteet:

- samalla Windows-käyttäjällä ei voi R0:ssa ylläpitää useita yrityksiä Ekyssä
- yrityksen vaihtaminen vaatii myöhemmin erillisen profiiliominaisuuden
- profiilin vaihto ei voi olla pelkkä `companyId`-arvon vaihtaminen

## Ei toteuteta tässä päätöksessä

- profiilirekisteriä tai profiilinvalinta-UI:ta
- useita SQLite-tietokantoja tuotantoruntimeen
- samanaikaista multi-company-käyttöä
- cloud tenant- tai membership-mallia
- profiilien välistä synkronointia
- backup/restore-tuotantokoodia

## Liittyvät dokumentit

- `AGENTS.md`
- `docs/architecture/local-backup-and-restore-plan.md`
- `docs/architecture/local-desktop-implementation-plan.md`
- `docs/architecture/local-runtime-trust-and-authorization-plan.md`
- `docs/architecture/security-principles.md`
- `docs/decisions/ADR-0006-local-database-and-query-layer.md`
- `docs/decisions/ADR-0007-local-desktop-shell-and-session-bootstrap.md`
