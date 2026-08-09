# Käyttäjät, roolit ja oikeudet

## Tila

Ekyssä ei ole vielä monen ihmiskäyttäjän tunnuksia, roolien hallintaa,
yritysjäsenyyksiä tai mobiilikirjautumista. Nykyinen paikallinen toteutus ja
tuleva käyttäjämalli erotetaan tässä dokumentissa toisistaan, jotta
suunnittelurooleja ei tulkita valmiiksi turvallisuusmalliksi.

## Nykyinen toteutus: local-owner

Paketoitu Eky Desktop muodostaa paikallisesta, profiiliin sidotusta
identiteetistä vahvistetun `ActorContext`-kontekstin. Nykyinen actor on
`local-owner`. Renderer ei saa runtime-sessionia eikä päätä `actorId`- tai
`companyId`-arvoa.

Local-owner saa tällä hetkellä backendissä kaikki toteutetut permissionit:

- `manageCompanySettings`
- `manageInvoiceSettings`
- `manageInvoiceNumberingSeries`
- `manageInvoiceCorrections`
- `manageInvoicePayments`
- `manageCompanyEmailSettings`
- `manageCompanyEmailSecret`
- `sendInvoices`
- `viewActivity`
- `viewDiagnostics`
- `createSupportBundle`.

Suljetun permission-unionin auktoritatiivinen lähde on
`packages/permissions/src/permission.ts`. Dokumentti ei saa korvata sitä.
Backend tekee lopullisen deny-by-default-tarkistuksen. Frontend saa vain
peilata toimintojen käytettävyyttä.

Nykyinen permission-platform on toteutettu, mutta se ei vielä ole käyttäjä-
tai roolihallinta. Local-ownerin täydet oikeudet ovat yhden hallitun
paikalliskoneen bootstrap-ratkaisu.

## Tulevan identity-vaiheen käsitteet

Seuraavat ovat konseptuaalisia käsitteitä, eivät vielä tauluja, API-sopimuksia
tai lukittuja permission-nimiä:

- **User:** autentikoitu ihmisen digitaalinen identiteetti. Sama henkilö voi
  tulevaisuudessa kuulua useaan yritykseen.
- **Employee / Worker:** business-henkilö tai työntekijä, johon tunti-, työ-
  ja materiaalikirjaukset voivat liittyä. Employee ei automaattisesti ole
  kirjautuva User eikä User automaattisesti Employee.
- **Company Membership:** Userin ja yrityksen välinen jäsenyys. Se rajaa,
  missä yrityskontekstissa roolit ja oikeudet ovat voimassa.
- **Role:** yritysjäsenyyteen liitetty hallittava permission-joukko. Rooli on
  ylläpidon apurakenne, ei backend-tarkistuksen korvaaja.
- **Permission:** backendin tarkistama tarkkarajainen kyvykkyys. Tulevat nimet
  päätetään moduulien käyttötapausten yhteydessä, ei tässä dokumentissa.
- **AI actor:** erikseen tunnistettu ei-ihmistoimija, jolla on oma rajattu
  membership/permission-konteksti, audit trail ja vahvistuspolitiikka. Se ei
  esiinny ihmiskäyttäjänä eikä ohita application-palveluja.

## Konseptuaaliset tulevat roolit

Mahdollisia käyttäjäkokemuksen roolipohjia ovat Owner, Admin, Office,
Manager, Worker, Accountant ja Viewer. Ne ovat keskustelun lähtökohtia, eivät
vielä teknisiä enum-arvoja tai oikeuslupauksia.

- **Owner:** yrityksen korkein hallinnollinen vastuu.
- **Admin:** käyttäjien ja valittujen asetusten hallinta.
- **Office:** asiakas-, laskutus- ja toimistotyö.
- **Manager:** työmääräykset ja hyväksyttävät kirjaukset.
- **Worker:** omat mobiilityöt, tunnit ja materiaalit.
- **Accountant:** taloushallinnon rajatut luku- ja integraatiotoiminnot.
- **Viewer:** tarkasti rajattu read-only-käyttö.

Rooli ei saa yksin ratkaista business-sääntöä, yritysrajausta tai resurssin
omistajuutta. Backend tarkistaa aina ActorContextin, membershipin,
permissionin ja käyttötapauksen omat ehdot.

## Pysyvä readiness gate

Toista ihmiskäyttäjää, mobiilikirjautumista, cloud membershipiä, etänä
tehtävää business-kirjoitusta tai kirjoittavaa AI-agenttia ei toteuteta ennen
projektin omistajan hyväksymää Users / Identity / Memberships / Roles /
Permissions -vaihetta.

Vaiheen pitää määrittää vähintään:

- identity provider ja kirjautumisen luottamusraja
- Userin ja Employee/Workerin erillinen elinkaari
- yritysjäsenyys ja aktiivinen yrityskonteksti
- roolien ja permissionien omistajuus sekä deny-by-default
- kutsu-, poistumis-, deaktivointi- ja recovery-polut
- tenant-rajat jokaisessa backendin read/write-käyttötapauksessa
- permission- ja membership-muutosten business/security audit
- sessionin mitätöinti ja laitteen katoamistilanne
- mobiilin offline-komentojen tunnistus, replay-suoja ja synkronointi
- AI actorin rajat, hyväksyntä ja jäljitettävyys.

Installeri ei luo käyttäjiä, työntekijöitä tai rooleja. Se asentaa vain
binaarit. Paikallisen ensimmäisen profiilin local-owner bootstrap kuuluu
sovelluksen first-start/runtime-vastuulle.

## Avoimet päätökset

- voiko sama User kuulua useaan yritykseen ja miten aktiivinen membership
  valitaan
- voiko Employee toimia ilman User-tiliä
- mitkä business-toiminnot vaativat neljän silmän hyväksynnän
- milloin owner voi delegoida laskun hyväksynnän ja lähetyksen
- miten pilvi- ja local-sessionit sovitetaan samaan ActorContext-porttiin
- miten kirjoittava AI actor erotetaan automaatiosta, joka vain ehdottaa.
