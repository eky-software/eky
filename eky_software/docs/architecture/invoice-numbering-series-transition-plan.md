# Hallittu Laskunumerosarjan Vaihto

Tämä dokumentti suunnittelee korkean riskin poikkeuspolun, jolla yritys voi
ottaa uuden laskunumerosarjan käyttöön käytetyn sarjan rinnalle.

Tämä ei ole numeroinnin resetointi tai käytetyn sarjan lukituksen avaaminen.
Vanhaa sarjaa, sen asetuksia, sekvenssejä tai sillä hyväksyttyjä laskuja ei
muuteta eikä poisteta.

Dokumentin lähtöcommit on `e1ed183`.

## Tila Ja Päätösportti

Checkpoint A eli nykytilan auditointi ja arkkitehtuurisuunnitelma on tehty.

Persistence-, domain-, approval-, HTTP-, API-client- ja UI-toteutusta ei
aloiteta ennen näkyvien laskunumeroiden nimiavaruudesta tehtävää projektin
omistajan päätöstä.

Nykyinen `seriesKey` on tekninen tunniste. Se tallennetaan hyväksytylle
laskulle, mutta se ei näy laskunumerossa. Nykyinen näkyvä laskunumero
muodostetaan vain seuraavista:

- `mode`
- laskun päiväyksestä johdettu vuosi tarvittaessa
- `sequencePadding`
- `sequenceNumber`

Tämän vuoksi uusi tekninen `seriesKey` ei yksin estä uuden sarjan näkyviä
laskunumeroita törmäämästä vanhoihin numeroihin.

Ennen Checkpoint B:tä pitää valita yksi seuraavista:

1. Laskunumeroon lisätään näkyvä sarjatunniste. Tunnisteen muoto, laskulla
   näkyvä esitys ja vaikutus suomalaiseen viitenumeroon päätetään erikseen.
   Nykyinen viitenumeropolku hyväksyy vain numeerisen laskunumeron, joten
   tekstimuotoista prefixiä ei saa lisätä hiljaisesti.
2. Näkyvä laskunumero pidetään ennallaan ja uusi sarja vaatii todistetusti
   törmäyksettömän `firstSequenceNumber`-arvon. Turvallisen säännön pitää
   kattaa myös tulevat saman sarjan numerot, eri numerointimallit,
   tilikausirajat ja taannehtivasti päivätyt laskut. Pelkkä ensimmäisen
   ehdokasnumeron tarkistus ei riitä.

Jos kumpaakaan vaihtoehtoa ei voida todistaa turvalliseksi, ominaisuutta ei
toteuteta.

## Tavoite

Hallittu poikkeuspolku mahdollistaa uuden sarjan käyttöönoton esimerkiksi
pakottavan kirjanpidollisen tai organisatorisen muutoksen vuoksi.

Onnistuneen vaihdon jälkeen:

- vanha sarja säilyy read-only-historiana
- vanhat laskut säilyttävät laskunumeronsa ja sarjasnapshotinsa
- uusi standardi- tai hyvityslasku käyttää aktiivista sarjaa
- sarjan aktivointi ei varaa eikä kuluta laskunumeroa
- jokainen hyväksytty lasku kuuluu yksiselitteisesti yhteen sarjaan
- vaihdosta jää append-only-audit-tapahtuma

## Ei Tavoitteena

Tässä kokonaisuudessa ei:

- nollata numerointia
- avata käytettyä asetusriviä muokattavaksi
- poisteta vanhaa sarjaa tai sekvenssejä
- muuteta vanhoja laskuja tai niiden snapshotteja
- anneta käyttäjän muokata laskunumeroa suoraan
- varata numeroa asetusten esikatselussa tai aktivoinnissa
- ratkaista usean offline-laitteen hajautettua hyväksyntää
- lisätä uutta riippuvuutta

## Nykytilan Auditointi

### Asetukset Ja Sekvenssit

`invoice_numbering_settings` sisältää useita rivejä teknisen
`(company_id, series_key)`-avaimen perusteella. Nykyinen application- ja
HTTP-polku käyttää kuitenkin vain `defaultInvoiceNumberSeriesKey`-arvoa.

`invoice_number_sequences` erottaa etenemän avaimella:

```text
company_id + series_key + sequence_scope
```

Nykyinen asetusten päivityspolku estää käytetyn `default`-sarjan asetusten
muuttamisen, kun sarjalle on syntynyt sequence-rivi. Samalla adapteri käyttää
asetuksille upsertia. Tätä upsert-polkuakaan ei saa käyttää uuden sarjan
aktivointiin.

### Laskunumero Ja Uniikkius

`invoices`-taulussa on tietokantatason rajoite:

```text
UNIQUE (company_id, invoice_number)
```

Rajoite estää duplikaatin tallentumisen yrityksen sisällä, mutta se ei yksin
tee sarjan aktivoinnista turvallista. Ilman ennakkosääntöä törmäys voisi tulla
vasta myöhemmässä hyväksynnässä ja estää laskun hyväksymisen yllättäen.

Hyväksytylle laskulle tallennetaan jo:

- `series_key`
- `sequence_scope`
- `sequence_number`
- `numbering_mode`
- näkyvä `invoice_number`

Nämä historialliset arvot säilytetään.

### Standardi- Ja Hyvityslaskun Hyväksyntä

Standardilaskun ja hyvityslaskun HTTP-reitit antavat tällä hetkellä
hyväksyntäpalvelulle kovakoodatun `defaultInvoiceNumberSeriesKey`-arvon.

Repositoryt tekevät numeron varauksen, snapshotin, laskurivit,
audit-tapahtuman ja luonnoksen lukituksen SQLite-transaktiossa. Hyvityslasku
käyttää samaa numerointiperiaatetta omassa hyväksyntätransaktiossaan.

Tavallinen uudelleenhyväksyntä säilyttää jo hyväksytyn laskun identiteetin ja
sen alkuperäisen numerointisnapshotin. Reapproval ei saa myöhemminkään lukea
uutta aktiivista sarjaa tai kuluttaa siitä numeroa.

### Activity Ja Audit

Nykyiset numerointiasetusten muutokset kirjataan
`invoice_settings_audit_events`-polkuun. Sarjan vaihto tarvitsee oman
append-only-tapahtuman, koska kyse ei ole tavallisesta asetuspäivityksestä.

Activity saa näyttää turvallisen yhteenvedon:

```text
Uusi laskunumerosarja otettu käyttöön
```

Activity ei näytä teknisiä revision-arvoja, sisäisiä virheitä tai vapaamuotoista
muutossyytä. Muutossyy säilyy rajatussa audit-tiedossa vain perustellun
tarpeen mukaisesti.

### Company Settings UI

Oma yritys -näkymässä nykyinen numerointilomake lukittuu, kun numerointia on
käytetty. Tämä turvallinen oletus säilyy.

Uusi sarja toteutetaan erillisenä korkean kitkan poikkeustoimintona.
Nykyistä lomaketta ei avata uudelleen eikä lukitusta kierretä.

### Permissionit Ja Luottamusraja

Nykyinen asetusten hallinta käyttää `manageInvoiceSettings`-oikeutta.
Sarjan vaihto vaatii uuden, tarkemman oikeuden:

```text
manageInvoiceNumberingSeries
```

Backend tarkistaa oikeuden deny-by-default-periaatteella. `companyId`,
`actorUserId` ja aktiivisen yrityksen konteksti tulevat vain backendin
vahvistamasta `ActorContext`-kontekstista.

Request ei saa päättää:

- `companyId`-arvoa
- `actorUserId`-arvoa
- tapahtuma-aikaa
- seuraavan sarjan teknistä `seriesKey`-arvoa
- aktiivisen sarjan pointeria suoraan
- audit-tapahtuman tunnistetta

## Pysyvä Tietomalli

Uusi migraatio lisää taulut muuttamatta vanhoja migraatioita.

### `invoice_numbering_active_series`

Suunnitellut kentät:

- `company_id` primary key
- `active_series_key`
- `revision`
- `updated_at`
- `updated_by`
- foreign key `(company_id, active_series_key)` ->
  `invoice_numbering_settings`

`revision` on positiivinen kokonaisluku. Sitä käytetään optimistic
concurrency -tarkistukseen.

Yrityksellä on enintään yksi aktiivinen sarja. Nykyisille yrityksille
backfill asettaa aktiiviseksi `default`-sarjan vain, jos vastaava asetusrivi
on olemassa. Backfill ei luo sequence-riviä eikä muuta laskuja.

Uudella yrityksellä ensimmäisen numerointiasetuksen tallennus luo
`default`-asetusrivin ja aktiivisen pointerin samassa transaktiossa. Tätä
ensimmäistä käyttöönottoa ei käsitellä käytetyn sarjan vaihtona eikä se vaadi
poikkeuspolun vahvistusta. Hyväksyntä estyy hallitusti, jos aktiivista
pointeria tai sen osoittamaa asetusriviä ei löydy.

### `invoice_numbering_series_events`

Suunnitellut kentät:

- `id`
- `company_id`
- `actor_user_id`
- `previous_series_key`
- `next_series_key`
- `reason`
- `occurred_at`

Taulu on append-only. SQLite-migraatio lisää triggerit, jotka estävät
`UPDATE`- ja `DELETE`-operaatiot.

`reason`:

- on pakollinen
- trimmataan ja pituus rajataan
- ei saa sisältää salaisuutta
- ei näy tavallisessa Activityssa
- ei toisteta virhevastauksissa tai operational-lokeissa

### Asetusrivien Muuttumattomuus

Uuden sarjan asetusrivi luodaan uutena rivinä ja se on aktivoinnista alkaen
muuttumaton.

Nykyisen `default`-sarjan yhteensopivuussääntö säilyy:

- ennen ensimmäistä käytettyä numeroa nykyistä asetusriviä voidaan muokata
  nykyisen sovelluspalvelun kautta
- ensimmäisen sequence-rivin jälkeen asetuksia ei voi muuttaa
- uutta sarjaa ei koskaan luoda nykyisen asetusrivin upsertina

Tietokantatason muuttumattomuuden tarkka trigger-malli määritetään
Checkpoint B:ssä niin, ettei se riko käyttämättömän alkuasetuksen nykyistä
sopimusta.

## Application-Palvelu

Uusi käyttötapaus on:

```text
activateInvoiceNumberingSeries
```

Syöte sisältää vähintään:

- uudet numerointiasetukset
- muutossyyn
- UI:n viimeksi lukeman aktiivisen sarjan avaimen
- UI:n viimeksi lukeman revision
- täsmällisen vahvistusarvon
- backendin vahvistaman `ActorContext`-kontekstin

Tekninen `nextSeriesKey` generoidaan backendissä. Käyttäjä ei kirjoita sitä.

Vahvistusarvo ei ole boolean. Backend vaatii kiinteän, i18n-avaimen kautta
UI:ssa näytettävän tekstin täsmällisen arvon. Lopullinen suomenkielinen
vahvistusteksti lukitaan ennen Checkpoint D:tä. Oletustoiminto on aina
`Peruuta`.

## Aktivointitransaktio

Aktivointi tehdään yhdessä SQLite write -transaktiossa. Toteutuksessa
arvioidaan `BEGIN IMMEDIATE` / better-sqlite3:n immediate-transaction, jotta
kaksi paikallista kirjoittajaa eivät voi molemmat hyväksyä samaa revisionia.

Järjestys:

1. tarkista `manageInvoiceNumberingSeries`
2. validoi backendin vahvistama yritys ja actor
3. lue aktiivinen sarja ja revision
4. torju stale `currentActiveSeriesKey` tai revision
5. validoi uudet asetukset, syy ja vahvistusteksti
6. generoi uusi tekninen `seriesKey`
7. lisää uusi asetusrivi
8. varmista valitun nimiavaruussäännön mukainen näkyvien numeroiden
   törmäyksettömyys
9. päivitä aktiivisen sarjan pointer ja kasvata revisionia
10. lisää append-only series event
11. commit

Minkä tahansa vaiheen virhe peruu kaikki kirjoitukset.

Aktivointi ei:

- lisää `invoice_number_sequences`-riviä
- muuta vanhaa sequence-riviä
- varaa näkyvää laskunumeroa
- luo laskua

## Approval-Transaktioiden Muutos

Checkpoint C poistaa standardi- ja hyvityslaskujen kovakoodatun
`default`-sarjan.

Molemmissa poluissa aktiivinen pointer:

- luetaan approval-repositoryn saman write-transaktion sisällä
- ratkaistaan ennen asetusten ja sekvenssin lukemista
- sidotaan numeron varaukseen ja laskusnapshotin kirjoitukseen

Sarjan aktivointi ja laskun hyväksyntä järjestyvät transaktioiden mukaan.
Yksittäinen hyväksyntä käyttää kokonaan joko vanhaa tai uutta sarjaa. Se ei
saa lukea pointeria yhdessä transaktiossa ja varata numeroa toisessa.

Reapproval:

- säilyttää alkuperäisen `seriesKey`-arvon
- säilyttää alkuperäisen laskunumeron ja viitenumeron
- ei lue aktiivista pointeria numeron muodostamista varten
- ei kuluta aktiivisen sarjan sekvenssiä

## HTTP- Ja API-Sopimus

Tarkat endpointit päätetään Checkpoint D:ssä. Sopimuksen pitää erottaa:

- aktiivisen sarjan ja historian read model
- uuden sarjan aktivointikomento

Aktivointipyyntö käyttää nykyistä JSON body -sopimusta:

- non-empty body vaatii `application/json`
- tuntemattomat kentät torjutaan
- body luetaan kerran
- pituudet ja kokonaislukurajat tarkistetaan
- teknisiä sisäisiä arvoja ei hyväksytä requestista

Väärä yritys, puuttuva oikeus, stale revision ja väärä vahvistus torjutaan
ennen kirjoituksia. Virhe ei paljasta toisen yrityksen sarjoja.

## Käyttöliittymä

Sijainti:

```text
Oma yritys -> Laskunumerointi
```

Kun numerointia ei ole käytetty, nykyinen tavallinen asetusten tallennus
säilyy.

Kun numerointia on käytetty, näkymä näyttää:

- nykyisen aktiivisen sarjan read-only-tiedot
- käyttöönottoajan
- aikaisemmat sarjat read-only-historiana
- erillisen `Ota uusi numerosarja käyttöön` -komennon

Toiminto ei käytä tekstejä `resetoi`, `avaa lukitus` tai `muokkaa käytettyä
sarjaa`.

### Vaihe 1

Käyttäjä antaa:

- uudet asetukset
- muutossyyn

UI näyttää:

- seuraavan laskunumeron esikatselun
- varoituksen siitä, että vanha sarja ja laskut säilyvät
- varoituksen siitä, ettei aktivointia peruta poistamalla historiaa

Esikatselu ei varaa numeroa.

### Vaihe 2

UI näyttää vanhan ja uuden sarjan rinnakkain sekä pyytää käyttäjää
kirjoittamaan täsmällisen vahvistustekstin.

Vahvistus:

- ei ole valmiiksi täytetty
- ei ole pelkkä checkbox
- ei hyväksy välilyönneillä tai kirjainkoolla poikkeavaa arvoa hiljaisesti
- tarkistetaan uudelleen backendissä
- käyttää oletuspainikkeena `Peruuta`
- estyy lähetyksen ajaksi kaksoisklikkauksen välttämiseksi

Onnistumisen jälkeen UI hakee aktiivisen sarjan ja historian uudelleen
backendiltä. UI ei päättele onnistumista paikallisesti.

UI ei tarjoa vanhalle sarjalle:

- muokkausta
- poistamista
- uudelleenaktivointia
- sekvenssin nollaamista

## Adapteri- Ja Moduulirajat

Invoicing omistaa sarjan aktivoinnin, pointerin, historian ja approval-polun.
Company Settings vain esittää Invoicingin omistaman asetuskäyttöliittymän.

Uusi transition persistence toteutetaan omalla koherentilla adapterillaan.
Nykyistä `SqliteInvoiceNumberingRepository`-adapteria ei kasvateta yleiseksi
numeroinnin manageriksi vain composition-wiringin vähentämiseksi.

Approval-repositoryt saavat aktiivisen sarjan lukemiseen vain niiden oman
transaktion sisäisen, tarkasti nimetyn persistence-vastuun. Activity lukee
turvallista Invoicingin projectionia oman porttinsa kautta.

## Turvallisuus Ja Tietojen Minimointi

- Toiminto on deny by default.
- Backend muodostaa tenant- ja actor-kontekstin.
- Sarja-avaimet validoidaan teknisinä tunnisteina.
- Vapaa muutossyy ei vaikuta SQL:ään, tiedostopolkuun tai laskunumeroon.
- SQL on parametrisoitua.
- Vahvistus ei korvaa permission-, revision- tai collision-tarkistusta.
- Virheet eivät toista muutossyytä tai request bodya.
- Operational-lokiin ei kirjoiteta syytä, laskunumeroita tai asiakastietoja.
- Audit-tapahtuma ei sisällä laskurivejä, summia tai henkilötietoja.
- Vanhan yrityksen sarjojen olemassaoloa ei paljasteta 404/409-eroilla.

## Testimatriisi

### Domain Ja Application

- uusi sarja validoituu
- väärä vahvistus torjutaan
- puuttuva permission torjutaan ennen repositorya
- stale revision torjutaan
- tyhjä tai liian pitkä syy torjutaan
- teknistä series keytä ei voi antaa requestista

### Persistence

- vanha settings- ja sequence-data säilyy byte-for-byte
- aktivointi lisää uuden settings-rivin, pointerin ja eventin atomisesti
- aktivointi ei lisää sequence-riviä
- eventin update/delete estyy
- audit- tai pointer-vika rollbackaa koko aktivoinnin
- väärä tenant ei lue eikä kirjoita dataa

### Approval Ja Rinnakkaisuus

- kaksi approvalia ennen vaihtoa
- sarjan vaihto ja approval samaan aikaan
- kaksi approvalia vaihdon jälkeen
- kaksi sarjanvaihtoa samalla revisionilla
- stale revision
- näkyvän numeron collision
- vanha sarja ei aktivoidu uudelleen
- standardi- ja hyvityslasku käyttävät aktiivista sarjaa
- reapproval säilyttää alkuperäisen sarjan

### HTTP, API-Client Ja UI

- wrong tenant
- missing permission
- invalid JSON ja media type
- unknown fields
- väärä confirmation
- kaksivaiheinen vahvistus
- oletustoiminto on Peruuta
- vanhat sarjat ovat read-only
- käyttöliittymä ei varaa numeroa esikatselussa
- teknisiä arvoja tai stack tracea ei näytetä

### E2E

- `INV-NUMBERING-SERIES-001`: uusi sarja aktivoituu ja vanha säilyy
- `INV-NUMBERING-SERIES-002`: uusi hyväksyntä käyttää uutta sarjaa ja vanha
  lasku säilyttää vanhan sarjan
- `INV-NUMBERING-SERIES-003 @security`: tenant, permission, revision ja
  confirmation
- `INV-NUMBERING-SERIES-004 @fault`: transaktion keskivaiheen rollback
- `INV-NUMBERING-SERIES-005 @concurrency`: sarjanvaihto ja approvalit eivät
  tuota duplikaatteja tai epäselvää sarjajäsenyyttä

## Checkpointit

### A: Arkkitehtuurisuunnitelma

- nykytila auditoitu
- pysyvä malli ja turvallisuusrajat kuvattu
- näkyvän laskunumeron päätösportti avoinna

### B: Persistence Ja Domain

Tehdään vasta nimiavaruuspäätöksen jälkeen:

- uusi migraatio
- domain-malli
- transition-portti ja erillinen SQLite-adapteri
- permission
- application service

### C: Approval Ja Rinnakkaisuus

- aktiivinen pointer approval-transaktioihin
- standardi- ja hyvityslaskut
- reapproval-regressiot
- SQLite-rinnakkaisuustestit

### D: HTTP, API Ja UI

- read model ja aktivointikomento
- API-client
- kaksivaiheinen Classic-UI
- Activity-projection

### E: Testit Ja Release-Portti

- koko laskutuksen raha- ja korjausmatriisi
- security-, fault- ja concurrency-E2E
- backend-, api-client-, web- ja desktop-buildit
- Windows package ja packaged smoke

## Avoin Omistajapäätös

Ennen Checkpoint B:tä projektin omistaja päättää:

1. lisätäänkö näkyvä, viitenumeron kanssa yhteensopivaksi erikseen
   suunniteltava sarjatunniste
2. vai rajoitetaanko sarjanvaihto collision-free
   `firstSequenceNumber` -jatkopoluksi

Koodia ei toteuteta tämän päätöksen ohi.
