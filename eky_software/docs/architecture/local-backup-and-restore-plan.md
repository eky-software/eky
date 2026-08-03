# Eky Local Backup/Restore -suunnitelma

## Tila

Suunnitteluperusta. Backup/Restore-tuotantokoodia ei ole vielä toteutettu.

Dokumentoitu ja testattu palautuspolku on yhden hallitun oikeaa dataa
käyttävän R0-asennuksen release gate. Toteutus tehdään erillisinä rajattuina
vaiheina ennen oikean asiakas- tai laskutusdatan käyttöönottoa.

## Tavoite ja rajaus

Ensimmäinen Backup/Restore koskee ADR-0008:n mukaista yhtä suljettua
paikallista yritysprofiilia:

- yksi profiili
- yksi SQLite-tietokanta
- yksi yritys
- yksi business-artifact-juuri

Backup ei ole tukipaketti, toimitettujen laskujen valinnainen PDF-
arkistokansio, pilvisynkronointi tai yleinen tiedostojen pakkaustoiminto.

## Auktoritatiivinen sisältö

Ensimmäisen backupin pitää sisältää vähintään:

- SQLite-tietokannan transaktionaalisesti eheä snapshot
- tietokannan schema- ja migration-identiteetti
- hyväksyttyjen laskujen current PDF:t ja muut sellaiset sisäisen document
  storagen artifactit, joita ei voida luotettavasti muodostaa uudelleen
- manifesti, joka sitoo profiilin, version, luontiajan ja artifactit yhteen
- jokaisen backup-osion koko ja SHA-256-checksum
- restore-yhteensopivuuteen tarvittava sovellus- ja formaattiversio

Lopullinen inclusion-lista muodostetaan omistavilta moduuleilta. Uusi moduuli
ei saa olettaa kuuluvansa backupiin vain siksi, että sen tiedosto sijaitsee
userData-hakemiston alla.

## Backupista pois jätettävä sisältö

Ensimmäiseen backupiin ei sisällytetä:

- runtime-sessionia, autentikointiotsakkeita tai muistissa olevia tokeneita
- SMTP-salasanaa, Electron `safeStorage` -blobia tai muuta kone- ja
  Windows-käyttäjäkohtaista salaisuutta
- operational/security-lokeja, incident-indeksiä tai tukipaketteja
- käyttäjän valitseman ulkoisen lasku-PDF-arkistokansion kopioita
- konekohtaisia absoluuttisia polkuja tai natiivien dialogien historiaa
- välimuisteja, temp-tiedostoja, retry-journalin keskeneräisiä kopioita tai
  E2E/smoke-dataa
- Electron-binaareja, sovelluspakettia, asenninta tai riippuvuuksia
- pilvisalaisuuksia tai tulevan cloud identityn tokeneita

Salaisuudet palautetaan erillisellä turvallisella käyttöönotolla. Backupin
palautus ei saa siirtää SMTP-salasanaa toiselle koneelle tai Windows-
käyttäjälle huomaamatta.

## Backupin muodostaminen

Backup tehdään vain hallitussa profiilin tilassa. Toteutusvaiheessa valitaan
jompikumpi turvallisesti todennettu malli:

1. backend ja SQLite-yhteys suljetaan ennen snapshotia, tai
2. käytetään SQLite-ajurin dokumentoitua backup-API:a ja todistetaan
   konsistentti snapshot testeillä.

Elävää SQLite-tiedostoa ja sen WAL/SHM-tiedostoja ei kopioida ad hoc
tiedostokopiointina.

Muodostus:

1. Electron main pyytää käyttäjältä kohteen native Save-dialogilla.
2. Renderer ei anna tiedostopolkua, formaattia tai salausparametreja.
3. Runtime jäädyttää backupiin vaikuttavat kirjoitukset hallitusti.
4. Tietokantasnapshot ja artifactit luetaan vain tunnetuista profiilijuurista.
5. Manifesti ja checksumit muodostetaan rajatuista osioista.
6. Artifacti kirjoitetaan yksityiseen väliaikaistiedostoon.
7. Tiedosto synkronoidaan ja finalisoidaan ilman olemassa olevan backupin
   hiljaista ylikirjoitusta.
8. Temp ja osittaiset tiedostot poistetaan virheessä.
9. Käyttäjälle näytetään turvallinen onnistumis- tai virheviesti ilman
   paikallisen rakenteen, salaisuuden tai SQL-virheen vuotoa.

Backup ei merkitse laskua toimitetuksi eikä muuta business dataa.

## Palautus

Restore ei kirjoita suoraan aktiivisen profiilin päälle.

Turvallinen perusmalli:

1. käyttäjä valitsee backup-artifactin Electron mainin native-dialogilla
2. main tarkistaa regular file/no symlink -rajan ja tiedostokokorajan
3. formaatti, manifesti, versiot, polut, checksummat ja kaikki osiot
   validoidaan ennen ensimmäistä business-kirjoitusta
4. sisältö puretaan uuteen yksityiseen staging-profiiliin
5. SQLite integrity, foreign keys ja migraatioyhteensopivuus tarkistetaan
6. document storage -artifactien checksumit ja viittaukset tarkistetaan
7. aktiivinen runtime suljetaan ADR-0008:n lifecycle-säännöllä
8. vasta täysin validoitu staging-profiili vaihdetaan käyttöön
9. edellinen profiili säilytetään rajattuna rollback-kopiona, kunnes uusi
   profiili on käynnistynyt ja health-check on onnistunut
10. rollback-kopio poistetaan vain dokumentoidun retention- ja
    käyttäjävahvistusmallin mukaisesti

Restore ei saa:

- purkaa absoluuttista polkua tai `..`-traversalia
- seurata symlinkkiä tai reparse-pointia ulos staging-juuresta
- vaihtaa `companyId`:tä rendererin arvon perusteella
- käynnistää backupista palautettua sessionia tai salaisuutta
- osittain korvata aktiivista profiilia validation- tai migration-virheessä
- avata kahta profiilia samanaikaisesti

## `.ekybackup` ja salauspäätös

Suositeltu käyttäjälle näkyvä pääte on tulevaisuudessa `.ekybackup`.
Ensimmäisen oikeaa dataa sisältävän backup-artifactin pitää lähtökohtaisesti
olla salattu, koska se sisältää asiakas- ja laskutusdataa.

Salaus ei kuitenkaan ole tässä dokumentissa hyväksytty toteutuspäätös.
Ennen koodausta tehdään erillinen security- ja dependency-gate, jossa
päätetään vähintään:

- säiliöformaatti ja versionointi
- käytettävä autentikoitu salaus
- avaimen muodostus ja KDF-parametrit
- käyttäjän salasanan tai muun avainmateriaalin lifecycle
- unohtuneen salasanan ja palautusavaimen politiikka
- muistissa olevan selväkielisen datan minimointi
- brute-force-, tamper- ja downgrade-suojaus
- tarvitaanko uusi riippuvuus ja onko se erikseen hyväksyttävissä

Tiedostopääte ei tee artifactista salattua. `.ekybackup`-päätettä ei käytetä
salaamattomasta tuotantobackupista tavalla, joka antaisi käyttäjälle väärän
turvallisuuskuvan.

## Testausportti

Ennen R0-käyttöönottoa testataan vähintään:

- tyhjä ja edustava vanha tietokanta
- WAL-tila ja käynnissä olevien kirjoitusten esto
- migration-versioiden upgrade ja downgrade-esto
- checksum-, truncation-, wrong-version- ja tamper-virheet
- puuttuva, ylimääräinen ja väärään profiiliin kuuluva artifacti
- traversal, absoluuttinen polku, symlink ja reparse-point
- täysi levy, read-only-kohde ja keskeytys jokaisessa finalisointivaiheessa
- restart kesken backupin ja restoren
- staging-, rollback- ja temp-jäämien hallittu siivous
- onnistunut backup -> uusi eristetty runtime -> restore -> business- ja
  document-datan vertailu
- SMTP-salaisuuden, sessionin, lokien, tukipakettien ja ulkoisen PDF-arkiston
  poissulku
- cross-profile-esto, kun tuleva multi-profile-tuki joskus toteutetaan
- Windows package, packaged smoke ja rajattu recovery-E2E

Testit käyttävät vain synteettistä dataa. Varmuuskopiota ei pidetä toimivana
ennen kuin palautus on automaattisesti todennettu.

## Post-pilot-roadmap

Seuraavat asiat arvioidaan vasta ensimmäisen hallitun pilotin ja R0
Backup/Restore-polun jälkeen:

1. **Useat paikalliset yritysprofiilit.** ADR-0008:n mukainen yksi aktiivinen
   profiili kerrallaan, hallittu backend/SQLite/session-sulku ja erillinen
   cross-profile isolation -testimatriisi.
2. **Virtuaaliviivakoodi.** Invoicing muodostaa hyväksytyn laskun
   snapshot-datasta virallisen suomalaisen virtuaaliviivakoodin tiedot.
   Formaatti ja validointi tarkistetaan ajantasaisesta pankkialan lähteestä
   ennen toteutusta.
3. **Graafinen viivakoodi PDF:ään.** PDF-renderer esittää saman validoidun
   virtuaaliviivakoodin koneellisesti luettavana symbolina. Renderer ei
   muodosta maksudataa itse. Mahdollinen viivakoodiriippuvuus vaatii erillisen
   hyväksynnän.

Viivakoodi ei muuta hyväksytyn laskun snapshot-sääntöä. PDF ja mahdollinen
kopio käyttävät samaa laskulla pysyvästi tallennettua maksudataa.

## Liittyvät dokumentit

- `AGENTS.md`
- `docs/architecture/local-desktop-implementation-plan.md`
- `docs/architecture/local-invoice-pdf-archive-plan.md`
- `docs/architecture/security-principles.md`
- `docs/architecture/support-bundle-plan.md`
- `docs/decisions/ADR-0006-local-database-and-query-layer.md`
- `docs/decisions/ADR-0008-local-desktop-company-workspaces.md`
