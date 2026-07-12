# Email Delivery And Secrets Plan

Tämä dokumentti määrittää Eky-projektin sähköpostilähetyksen,
SMTP/Gmail-integraatioiden ja salaisuuksien hallinnan suunnittelulinjan.

Dokumentti on suunnitelma. Se ei lisää SMTP-lähetystä, Gmail OAuthia,
Windows Credential Manager -adapteria, Secret Manager -adapteria,
tietokantatauluja, migraatioita, endpointteja, UI-muutoksia, riippuvuuksia tai
oikeaa sähköpostin lähetystä.

## Nykyinen Toteutustila

Sähköpostipolusta on toteutettu local-MVP:hen:

- hyväksytyn laskun sähköpostiesikatselu current PDF:n perusteella
- käyttäjän muokattavat vastaanottaja-, kopio-, otsikko- ja viestikentät
- backendin dry-run-provider, joka ei lähetä oikeaa sähköpostia
- dry-run-send HTTP- ja API-client-polku
- `invoice_delivery_events`-persistence ja dry-run-tapahtuman auditointi
- Company Settings -moduulin ei-salaiset SMTP-asetukset ja niiden web-UI
- tieto `emailSecretConfigured`, joka ei sisällä salaista arvoa

Nykyinen dry-run ei muuta laskua `sent`-tilaan. Oikeaa SMTP-provideria,
salaisuuden tallennusta tai oikeaa sähköpostilähetystä ei ole vielä toteutettu.

## Julkisen Repositoryn Rajaus

Tämä dokumentti saa olla julkisessa Git-repositoriossa, koska se kuvaa
turvallisuusarkkitehtuuria, moduulirajoja ja kiellettyjä toteutustapoja.

Julkiseen dokumentaatioon saa kirjata esimerkiksi:

- että sähköpostisalaisuudet eivät kuulu frontendiin
- että SMTP-salasanaa ei hashata vaan käsitellään secret store -mallilla
- että DNA webmailia ei automatisoida selainkäyttöliittymän kautta
- että automaattinen lähetys tehdään SMTP/Gmail-providerin kautta backendissä
- että tuotannon oikeat salaisuudet pidetään Gitin ulkopuolella

Julkiseen Git-repositorioon ei saa kirjata:

- oikeita SMTP-salasanoja
- OAuth refresh tokeneita
- API-avaimia
- oikeita asiakkaiden sähköpostiosoitteita testidatana
- oikeita laskuja tai PDF-tiedostoja
- yrityskohtaisia salaisia sähköpostiasetuksia
- `.env`-tiedostoja

SMTP-hostien ja porttien kaltaiset julkiset palvelinasetukset eivät ole
sellaisenaan salaisuuksia, mutta ne kirjataan alustavina ja tarkistetaan vielä
palveluntarjoajan ajantasaisista ohjeista ennen tuotantototeutusta.

## Perusperiaate

Sähköposti toteutetaan toimitusputkenä, ei irrallisena nappina.

Eky saa myöhemmin lähettää laskuja automaattisesti käyttäjän vahvistuksen
jälkeen. Automaattinen lähetys tarkoittaa backendin hallittua
SMTP/Gmail/Microsoft-provideria, ei webmail-käyttöliittymän automatisointia.

Tuleva laskun sähköpostipolku:

```text
ApprovedInvoice
  -> backend varmistaa current PDF:n
    -> backend muodostaa sähköpostin vastaanottajan, otsikon, rungon ja liitteen
      -> EmailDeliveryProvider lähettää tai dry-run simuloi
        -> onnistunut oikea lähetys merkitsee laskun sent-tilaan
```

Jos lähetys epäonnistuu, laskun tila ei muutu `sent`-tilaan.

Frontend ei saa lähettää laskusähköpostia suoraan. Frontend voi näyttää
käyttäjälle lähetysikkunan ja pyytää käyttäjän vahvistuksen, mutta varsinainen
toimituspolku ja tilasiirtymä tehdään backendissä.

## Dry-run Ensimmäisenä Providerina

Dry-run ei ole manuaalinen sivupolku. Se on ensimmäinen provider samaan
lopulliseen lähetysputkeen.

Dry-run:

- ei lähetä oikeaa sähköpostia
- ei tarvitse sähköpostisalaisuuksia
- ei muuta laskun tilaa `sent`-tilaan
- palauttaa käyttäjälle esikatselun

Dry-run-esikatselussa näytetään ainakin:

- vastaanottaja
- otsikko
- viestirunko
- liitteen tiedot
- provider: `dryRun`

Tämä mahdollistaa sähköpostipolun turvallisen testaamisen ennen DNA SMTP-,
Gmail- tai muun oikean lähetysproviderin käyttöönottoa.

## Moduulirajat

Invoicing omistaa:

- laskun lähetyssäännöt
- mitä laskua saa lähettää
- current PDF -vaatimuksen
- laskukohtaisen vastaanottajan, otsikon ja viestin muodostuksen
- `sent`-tilaan siirtymisen
- laskutuksen audit- ja delivery-päätökset

Backend email infrastructure omistaa:

- teknisen sähköpostin lähetyksen
- provider-rajapinnan
- dry-run providerin
- SMTP-providerin myöhemmin
- Gmail-providerin myöhemmin
- Microsoft Graph -providerin myöhemmin, jos sellainen päätetään toteuttaa

Email infrastructure ei saa:

- päättää laskun tilaa
- tuntea laskutusdomainin sisäisiä sääntöjä
- muuttaa laskuja
- hakea invoice-dataa omin päin
- kirjoittaa Invoicingin tietokantatauluihin

Mahdollinen tuleva backend-sijainti:

```text
apps/backend/src/infrastructure/email/
```

Mahdollisia tiedostoja myöhemmin:

```text
emailDeliveryProvider.ts
emailDeliveryTypes.ts
dryRunEmailDeliveryProvider.ts
smtpEmailDeliveryProvider.ts
gmailEmailDeliveryProvider.ts
```

`packages/email` on hyväksyttävä tuleva rakennevaihtoehto, jos sähköpostin
provider-sopimuksia, tyyppejä tai testattavia apuja tarvitsee käyttää useampi
moduuli tai sovelluskerros.

Ensimmäistä toteutusta ei kuitenkaan nosteta automaattisesti
`packages/email`-tasolle vain siksi, että sähköposti kuulostaa yleiseltä.
Paketilla pitää olla tarkka vastuu, kuten:

- sähköpostin tekniset provider-tyypit
- turvallinen send/dry-run input-output -sopimus
- provider-agnostiset email-osoitteen ja viestirakenteen tyypit
- testattavat, ei-liiketoiminnalliset email-apufunktiot

`packages/email` ei saa omistaa laskun tilaa, laskutuksen business-sääntöjä,
invoice-dataa, delivery-auditia tai asiakasdataa. Ne pysyvät Invoicing- ja
muiden omistavien moduulien vastuulla.

Jos ensimmäinen sähköpostitarve on vain backendin sisäinen laskutuspolku,
toteutus saa alkaa `apps/backend/src/infrastructure/email/`-kerroksessa ja
nousta myöhemmin `packages/email`-tasolle, kun jaettu vastuu on todellinen.

## Oma Yritys Ja Sähköpostiasetukset

Sähköpostin lähetysasetusten käyttäjälle näkyvä hallinta kuuluu Oma yritys /
Company Settings -alueelle tai myöhemmin laajempaan Asetukset-kokonaisuuteen.

Oma yritys saa näyttää ja muokata ei-salaisia asetuksia:

- provider: `dryRun | smtp | gmail` myöhemmin
- lähettäjän nimi
- lähettäjän sähköpostiosoite
- reply-to myöhemmin
- SMTP host
- SMTP port
- security: `tls | starttls`
- username
- test recipient override
- dry-run enabled
- tieto siitä, onko salaisuus asetettu: `true | false`

Oma yritys ei saa koskaan näyttää:

- SMTP-salasanaa
- OAuth refresh tokenia
- Secret Managerin salaista arvoa
- Windows Credential Managerista luettua salaista arvoa

UI saa tarjota myöhemmin:

- Aseta/vaihda salasana
- Poista sähköpostiyhteys
- Lähetä testiviesti
- Tarkista asetukset

Sähköpostiasetusten UI-sijainti ei muuta moduulivastuita. Company Settings voi
olla käyttäjälle asetusten näkyvä koti, mutta oikea sähköpostilähetys tapahtuu
backendin hallitun provider-rajapinnan kautta ja laskun tilasäännöt kuuluvat
Invoicing-moduulille.

## Salaisuuden Lifecycle

Sähköpostisalaisuuksilla pitää olla hallittu elinkaari.

Tuettavat tulevat toiminnot:

- salaisuuden asettaminen
- salaisuuden vaihtaminen
- salaisuuden poistaminen
- yhteyden tai asetusten testaus
- tieto siitä, onko providerin vaatima salaisuus asetettu

Jos valittu provider vaatii salaisuuden ja `secretRef` tai vastaava viite
puuttuu, oikea lähetys estetään.

Salaisuuden poistaminen ei saa poistaa ei-salaisia asetuksia, kuten lähettäjän
nimeä, SMTP hostia tai porttia, ellei käyttäjä erikseen tyhjennä niitä.

Yhteyden testaus ei saa lähettää oikealle asiakkaalle. Testaus käyttää
dry-runia tai erillistä test recipient override -osoitetta.

Salaisuuden vaihtaminen ei saa palauttaa vanhaa salaista arvoa frontendille.
UI voi näyttää vain esimerkiksi `configured: true`.

## Salaisuuksien Käsittely

SMTP-salasanaa tai OAuth refresh tokenia ei hashata, koska niitä pitää käyttää
myöhemmin lähetyshetkellä.

Hash sopii käyttäjän kirjautumissalasanan tarkistamiseen, kun salasanaa ei
tarvitse saada takaisin alkuperäisessä muodossa. Sähköposti-integraation
salaisuudet kuuluvat secrets management -malliin, koska providerille pitää
lähetyshetkellä antaa käyttökelpoinen salaisuus.

Sähköpostisalaisuudet eivät saa:

- mennä Git-repositorioon
- mennä frontendille
- näkyä API-vastauksissa
- näkyä lokissa
- tallentua selaimen localStorageen
- tallentua tavalliseen näkyvään tietokantakenttään
- näkyä testifixtureissä oikeina arvoina

Tietokantaan voidaan myöhemmin tallentaa vain esimerkiksi `secretRef`,
`configured: true` tai vastaava ei-salainen viite.

Virhetilanteissa providerin tekninen virhe muunnetaan käyttäjälle turvalliseksi
viestiksi. Salaisuuksia, SMTP-käyttäjätunnuksia, tokenin osia tai providerin
raakoja debug-vastauksia ei näytetä käyttäjälle eikä kirjoiteta lokiin.

## SMTP-Liikenteen Salaus

SMTP-lähetys saa käyttää vain salattua yhteyttä.

Sallitut tulevat mallit:

- portti `587` ja STARTTLS
- portti `465` ja TLS heti yhteyden alusta

SMTP-adapteri ei saa lähettää viestiä, jos TLS- tai STARTTLS-neuvottelu
epäonnistuu.

SMTP-adapteri ei saa hyväksyä virheellistä TLS-sertifikaattia hiljaisesti.

Porttia `25` ei käytetä oletuksena Ekyssä. Sitä ei käytetä laskujen
automaattiseen lähetykseen ilman erillistä myöhempää arkkitehtuuri- ja
turvallisuuspäätöstä.

SMTP TLS/STARTTLS suojaa liikenteen Eky-backendin ja SMTP-palvelimen välillä.
Se ei ole päästä päähän -salaus. Sähköpostipalveluntarjoaja ja vastaanottajan
sähköpostipalvelin voivat normaalin sähköpostitoimituksen osana käsitellä
viestin ja PDF-liitteen.

Jos myöhemmin vaaditaan suojaus, jossa edes sähköpostipalveluntarjoaja ei voi
lukea viestiä tai liitettä, se pitää suunnitella erikseen esimerkiksi PGP- tai
S/MIME-tyyppisenä päästä päähän -salauksena. Tämä ei kuulu MVP-laskutuksen
sähköpostipolkuun.

SMTP-adapterin tulevissa testeissä tarkistetaan vähintään:

- lähetys ei onnistu ilman TLS/STARTTLS-suojausta
- STARTTLS-virhe estää lähetyksen
- virheellinen sertifikaatti estää lähetyksen
- SMTP-salasana ei päädy lokiin
- viestin runko tai PDF-sisältö ei päädy lokiin
- dry-run ei tarvitse salaisuuksia

## Local Windows -Malli

Paikallisen Windows-version suositeltu salaisuusmalli:

- Eky ajetaan paikallisesti käyttäjän koneella
- backend kuuntelee vain `localhost` / `127.0.0.1`
- SMTP-salaisuus tallennetaan myöhemmin Windows Credential Manageriin tai
  vastaavaan käyttöjärjestelmän secret storeen
- tietokantaan tallennetaan vain `secretRef` tai tieto `configured: true`
- backend hakee salaisuuden lähetyshetkellä
- frontend ei koskaan saa salaista arvoa takaisin

Development-vaiheessa voidaan käyttää dry-runia ja tarvittaessa `.env`-tiedostoa
vain kehittäjän omalla koneella. Tuotemaisessa local-asennuksessa suositaan
käyttöjärjestelmän secret storea.

Windows Credential Manager -adapteri voi vaatia myöhemmin erillisen
riippuvuuden tai natiivin integraation. Se arvioidaan
`docs/architecture/dependency-policy.md`-dokumentin mukaan ennen lisäämistä.

## Pilvimalli Myöhemmin

Pilviversion suositeltu malli:

- HTTPS aina
- käyttäjän tunnistus ja käyttöoikeudet backendissä
- Secret Manager / KMS / vastaava palvelu salaisuuksille
- service account -oikeudet least privilege -periaatteella
- salaisuuksia ei tallenneta näkyvänä PostgreSQL/SQLite-tauluihin
- sähköpostilähetys auditoidaan
- test/staging-ympäristössä dry-run tai test recipient override oletuksena
- tuotannossa oikea lähetys vaatii erillisen konfiguraation

Pilviversiossa sähköposti-infrastruktuuri ei saa riippua paikallisen koneen
Windows Credential Managerista. Local- ja cloud-secret-adapterit pidetään
vaihdettavina infrastructure-tason toteutuksina.

## DNA SMTP

DNA-sähköpostitilin automaattinen lähetys toteutetaan myöhemmin SMTP:n kautta,
ei DNA webmail -käyttöliittymää automatisoimalla.

DNA webmail:

- käyttäjä voi avata sen itse manuaalisesti
- Eky ei kirjaudu webmailiin käyttäjän puolesta
- Eky ei automatisoi webmail UI:ta
- Eky ei lue webmailin sisältöä selainautomaatiolla

Kiellettyä:

- webmailin klikkailu ohjelmallisesti
- webmailin scraping
- webmailin iframe- tai selainohjaus laskun lähettämiseksi
- käyttäjän webmail-istunnon kaappaaminen tai hyödyntäminen

DNA SMTP voidaan toteuttaa myöhemmin käyttäjän toimittamien ja ennen
tuotantototeutusta tarkistettujen asetusten perusteella.

Alustava DNA SMTP -linja:

- ensisijainen host: `smtp.dnamail.fi`
- varahost: `smtp.dnainternet.net`
- ensisijainen portti: `587`
- ensisijainen security: `STARTTLS`
- authentication: required
- vaihtoehtoinen portti: `465` ja TLS/SSL heti yhteyden alusta
- username: käyttäjän koko DNA-sähköpostiosoite, esimerkiksi
  `osoite@dnainternet.net`
- password: postilaatikon salasana, joka tallennetaan myöhemmin vain secret
  storeen
- porttia `25` ei käytetä oletuksena; se sallitaan vain erikseen valittuna ja
  perusteltuna poikkeusasetuksena

Eky voi esitäyttää SMTP username -kentän lähettäjän sähköpostiosoitteella.
Kenttä pidetään kuitenkin muokattavana, koska lähettäjän osoite ja SMTP-tilin
kirjautumistunnus eivät ole kaikissa palveluissa sama asia.

Portti `587` STARTTLS:llä ja portti `465` välittömällä TLS-yhteydellä ovat
molemmat hyväksyttäviä, kun salaus on pakollinen, sertifikaatti validoidaan ja
salaamattomaan yhteyteen ei pudota. Eky käyttää alustavana oletuksena porttia
`587` ja STARTTLS-mallia. Portti `465` on tuettu vaihtoehto, jos käytettävä
DNA-tili tai ympäristö toimii sillä luotettavammin.

DNA:n tukisivu listaa lähtevälle postille salatuiksi vaihtoehdoiksi portin
`465` TLS:llä ja portin `587` STARTTLS:llä. Portti `25` on DNA:n ohjeessa
rajattu tilanteisiin, joissa salattu yhteys ei ole lähettävän ohjelmiston
puolesta mahdollinen. Ekyssä salattu yhteys on vaatimus, joten portti `25` ei
ole oletuspolku.

Käyttäjä voi myöhemmin syöttää Oma yritys / Sähköpostiasetukset -näkymässä
tarvittavat SMTP-asetukset ja salaisuuden asettamisen. Salaisuutta ei näytetä
käyttäjälle takaisin. Backend tallentaa tai viittaa siihen turvallisen secret
store -mallin kautta ja käyttää sitä lähetyshetkellä.

Lopulliset DNA-asetukset tarkistetaan vielä ennen tuotantototeutusta DNA:n
ajantasaisista ohjeista ja käytettävän sähköpostitilin asetuksista.

## Gmail

Gmail toteutetaan myöhemmin mieluummin OAuth + Gmail API -mallilla kuin
tallentamalla tavallinen Gmail-salasana.

Gmail-linja:

- käyttäjä kirjautuu Googlen omaan näkymään
- Eky saa rajatun lähetysoikeuden
- refresh token käsitellään salaisuutena
- Gmail ei ole ensimmäinen pakollinen provider
- Gmail-provider toteutetaan myöhemmin erikseen

Gmailin tavallista salasanaa ei tallenneta Ekyyn.

## Tuleva Laskunäkymän Käyttökokemus

Hyväksytyn laskun näkymässä nykyisen manuaalisen "Merkitse lähetetyksi"
-toiminnon rinnalle tai tilalle tulee myöhemmin "Lähetä lasku".

"Lähetä lasku" avaa lähetysikkunan:

- toimitustapa: sähköposti / tulostus / manuaalinen
- vastaanottaja esitäytetään billing recipient/customer email snapshotista
- vastaanottajan sähköpostiosoitetta voi muuttaa käsin joka lähetyksessä
- otsikko generoidaan laskunumerosta ja yrityksen nimestä
- viestirunko generoidaan mallipohjasta
- liitteenä on current PDF
- käyttäjä vahvistaa ennen lähetystä

Dry-run-vaiheessa sama näkymä näyttää esikatselun, mutta ei lähetä mitään eikä
muuta laskua `sent`-tilaan.

## Oikean Lähetyksen Turvallisuusvaatimukset

Oikea SMTP/Gmail-lähetys vaatii vähintään:

- PDF varmistetaan backendissä
- vain current PDF voidaan lähettää
- vastaanottaja näytetään käyttäjälle ennen lähetystä
- tyhjä vastaanottaja estää lähetyksen
- käyttäjän vahvistus vaaditaan
- dev/test-tilassa oikea lähetys estetään oletuksena
- test recipient override voidaan pakottaa
- onnistunut lähetys voi merkitä laskun `sent`-tilaan
- epäonnistunut lähetys ei merkitse laskua `sent`-tilaan
- salaisuudet redaktoidaan lokeista
- providerin teknisiä virheitä ei näytetä käyttäjälle sellaisenaan

Lähetystapahtuma auditoidaan myöhemmin esimerkiksi
`invoice_delivery_events`-mallilla. Audit- tai delivery-loki ei saa tallentaa
sähköpostisalaisuuksia, OAuth-tokenia, SMTP-salasanaa tai tarpeettoman pitkiä
provider-debug-vastauksia.

Delivery event -mallin, send-polun auditoinnin ja uudelleenlähetyksen tarkempi
suunnitelma on dokumentissa
`docs/architecture/invoice-delivery-events-plan.md`.

## Deliverability-tuotantotarkistus

Ennen oikeaa tuotantolähetystä tarkistetaan sähköpostin perillemenoon liittyvät
asiat.

Tarkistettavia asioita:

- lähettäjän domain ja lähettäjän osoitteen oikeellisuus
- SPF
- DKIM
- DMARC
- roskapostiriski
- palveluntarjoajan lähetysrajat
- test recipient override test/staging-ympäristöissä

Näitä ei tarvita dry-run-vaiheessa, mutta oikeaa SMTP/Gmail-tuotantolähetystä
ei pidetä valmiina ennen deliverability-tarkistusta.

## Ei Vielä Toteuteta

Seuraavaan vaiheeseen jäävät:

- SMTP-provideria
- Gmail-provideria
- Windows Credential Manager -adapteria
- Secret Manager -adapteria
- oikeaa sähköpostilähetystä
- `packages/email`-pakettia

SMTP-kirjastoa tai muuta uutta riippuvuutta ei valita ennen erillistä
riippuvuusarviota.

## Seuraava Toteutusjärjestys

1. Määritellään secret store -portti ja salaisuuden lifecycle local Windows
   -ympäristölle.
2. Toteutetaan Windows Credential Manager -adapteri tai muu erikseen
   hyväksytty local secret store -adapteri testeineen.
3. Toteutetaan SMTP-provider ensin testitilassa. TLS/STARTTLS, sertifikaatin
   validointi, timeout ja turvallinen virheenkäsittely ovat pakollisia.
4. Pakotetaan test recipient override ensimmäisissä oikean providerin
   kokeiluissa, jotta viesti ei voi lähteä vahingossa asiakkaalle.
5. Kytketään provider nykyiseen backendin send-polkuun niin, että onnistunut
   lähetys kirjaa delivery eventin ja voi muuttaa laskun `sent`-tilaan.
6. Epäonnistunut lähetys kirjataan turvallisesti eikä se muuta laskun tilaa.

Ensimmäinen oikea SMTP-lähetys saa olla synkroninen. UI näyttää lähetyksen
olevan käynnissä ja estää saman toiminnon uudelleen pyynnön aikana. Backend
käyttää rajattua timeoutia.

Queue-, background worker- tai outbox-rakennetta ei tehdä ensimmäiseen
SMTP-vaiheeseen. Ennen tuotantokäyttöä arvioidaan kuitenkin erikseen tilanne,
jossa provider on lähettänyt viestin mutta delivery eventin tallennus tai
HTTP-vastaus epäonnistuu. Tuleva ratkaisu voi käyttää `pending`/`queued`
-tapahtumaa ja outbox- tai background worker -mallia kaksoislähetysten
estämiseksi.
