# R0 E2E -testimatriisi

Tämä on Eky R0:n pysyvä riskiperusteinen järjestelmätestimatriisi. Matriisi ei
väitä alemman tason testiä E2E-todisteeksi.

## Tilat

- `covered-existing`: skenaariolla on nykyinen unit-, integraatio- tai
  packaged-smoke-todiste, mutta uusi Playwright E2E puuttuu
- `implemented-e2e`: skenaario on toteutettu matriisissa nimetyllä E2E-tasolla
- `planned`: testitapaus ja tavoite on päätetty, toteutus puuttuu
- `not-applicable`: perusteltu poissulku
- `blocked-by-decision`: vaatii omistajan päätöksen ennen toteutusta
- `failed-finding`: vakaa E2E-regressio todentaa avoimen product-löydöksen;
  tuotantokorjausta ei tehdä testicheckpointissa ilman omistajan päätöstä

## Yhteiset odotukset

Jokainen alla oleva rivi perii nämä odotukset, ellei rivillä sanota muuta:

- UI näyttää turvallisen suomenkielisen tuloksen eikä raakaa virhettä.
- HTTP ei palauta stackia, SQL:ää, tiedostopolkua, tokenia tai sisäistä
  toteutusta.
- Torjuttu tai epäonnistunut toiminto ei jätä osittaista tietokantatilaa.
- Pakollinen business audit syntyy vain omistavan moduulin säännön mukaan ja
  samassa transaktiossa kuin kriittinen muutos.
- Operational/security-event käyttää allowlistattuja kenttiä.
- Tukipakettiin otetaan vain dokumentoitu turvallinen tekninen projektio.
- Salaisuus, runtime-session, sähköpostirunko, IBAN, osoite, nimi, raw payload
  ja tarpeeton henkilö- tai yritystunniste eivät vuoda.
- Seuraava validi pyyntö onnistuu torjunnan tai hallitun virheen jälkeen.

`Lähtö/toiminto/fault`-sarake nimeää lähtötilan, toiminnon ja mahdollisen
faultin. `Odotus` sisältää UI- ja HTTP-tuloksen. `Tila ja havainnot` sisältää
tietokannan, auditin, operational/security-eventin ja tukipaketin päätöksen.

## System

| ID | Riski ja tasot | Lähtö / toiminto / fault | Odotus | Tila ja havainnot | Erityinen vuotokielto | Tila |
|---|---|---|---|---|---|---|
| SYS-BOOT-001 | P0; system, packaged-smoke | Tyhjä eristetty runtime; käynnistä backend ja web; ei faultia | `/health` 200 ja web latautuu | Kanta syntyy testirootiin; ei business auditia; turvallinen startup-event | Production userData ja oikeat polut | covered-existing |
| SYS-ISOLATION-001 | P0; system, security | E2E-config; käynnistä kaikilla testipoluilla | Käynnistys onnistuu vain loopbackissa | Kaikki kirjoitukset testirootin alla; poissulku tukipaketista production-poluille | AppData, oikea logs-root, SMTP-secret | implemented-e2e |
| WEB-CONFIG-001 | P0; system, security | E2E Vite -profiili; validoi runtime-config ja backend-proxy | Vain loopback-backend ja validi session hyväksytään | Session lisätään vain Node-proxyssa; renderer ei saa sessionia | Runtime-session, production `.env` ja ulkoinen backend | implemented-e2e |
| WEB-NETWORK-001 | P0; system, security | Selainraja; arvioi sallitut ja estetyt protokollat sekä originit | Vain eristetyt loopback-originit ja dokumentoidut ei-verkkoprotokollat sallitaan | Estetty kohde jää turvalliseksi testihavainnoksi; ei ulkoista sivuvaikutusta | Ulkoinen URL, query tai credential | implemented-e2e |
| WEB-BOOT-001 | P0; web-e2e | Tyhjä eristetty runtime; käynnistä backend ja Vite, avaa customer workspace | Web latautuu session-proxyn läpi ja näyttää tyhjän tilan | Kanta ja Vite-cache ovat testirootissa; prosessitulosteessa ei ole sessionia | Runtime-session, production-polut ja ulkoinen verkko | implemented-e2e |
| SYS-OUTBOUND-001 | P0; web-e2e, security | Web auki; yritä non-loopback-pyyntöä | Pyyntö estyy ja testi epäonnistuu | Ei ulkoista sivuvaikutusta; turvallinen testihavainto | Ulkoinen payload tai credential | planned |
| SYS-RESTART-001 | P0; system, recovery | Tallennettu synteettinen data; hallittu restart | Sama data näkyy, vanha session 401/403 | Kanta ja audit säilyvät; runtimeInstanceId vaihtuu | Vanha session ja paikalliset polut | implemented-e2e |
| DB-SQLITE-UPGRADE-001 | P0; system, critical, recovery | Tuore kanta; asiakas, asetukset, lasku, PDF, toimitus, maksu, hyvitys ja numerointisarjan vaihto; hallittu restart | Koko elinkaari toimii ennen restartia ja snapshotit avautuvat sen jälkeen | Kaikki migraatiot, integrity- ja foreign-key-tarkistukset sekä kriittiset persistence-rivit säilyvät | Testikannan polku tai synteettisen datan tarpeeton sisältö | implemented-e2e |
| DB-LOCK-001 | P0; system, fault, recovery | Asiakaspäivitys; hallittu SQLite exclusive lock | Turvallinen virhe, backend säilyy terveenä ja uusi päivitys onnistuu lockin vapauttamisen jälkeen | Epäonnistunut kirjoitus ei muuta asiakasta; prosessi ei kaadu | SQL, tietokantapolku ja raw driver error | implemented-e2e |
| RUNTIME-EXIT-001 | P0; system, recovery | Hallittu backend-stop ja käynnistys samalla vapautetulla loopback-portilla | Vanha prosessi päättyy ja uusi runtime vastaa terveenä | Portti vapautuu; session ei näy prosessitulosteessa; ei orphania | Runtime-session ja paikalliset polut | implemented-e2e |
| ENDURANCE-BASELINE-001 | P1; system, web-e2e, endurance | 20 backend-kierrosta, 100 customer- ja draft-kierrosta, 50 web-siirtymää ja 25 PDF:ää | Kaikki operaatiot onnistuvat ja mittausraportti syntyy | RSS-, SQLite-, dokumentti- ja lokikoot mitataan; testin hallitsemia prosesseja lopussa 0 | Oikea data, ulkoinen verkko ja oikea SMTP | implemented-e2e |

## Customers

| ID | Riski ja tasot | Lähtö / toiminto / fault | Odotus | Tila ja havainnot | Erityinen vuotokielto | Tila |
|---|---|---|---|---|---|---|
| CUS-UI-001 | P0; web-e2e | Tyhjä yritys; luo, muokkaa ja hae numerolla sekä osoitteella; refresh | Lomake, lista ja refresh näyttävät tallennetut tiedot | Yksi asiakas ja odotetut auditit; Activity näyttää turvalliset kategoriat | Nimi, osoite tai arvot auditiin/lokiin | implemented-e2e |
| CUS-API-001 | P0; integration, system | Tyhjä yritys; create/update/list julkisella API:lla | Sopimuksen mukaiset 2xx-vastaukset | Company-scoped customer ja atomiset auditit | Toisen yrityksen tiedot | implemented-e2e |
| CUS-TENANT-001 | P0; integration, system, security | Yritykset A ja B; A käyttää B:n customerId:tä | Geneerinen 404/tyhjä listaus sopimuksen mukaan | Ei kirjoitusta eikä väärän tenantin auditia | Resurssin olemassaolo B:ssä | covered-existing |
| CUS-INPUT-001 | P1; integration, system, web-e2e, security | Tyhjä yritys; rajat, Unicode ja hostile markup sekä system-tason unknown/mass fields | Rajat ylittävä syöte torjutaan, sallittu teksti renderöidään tekstinä ja serveri säilyy terveenä | Vain validit customer- ja audit-rivit syntyvät; Activity ja lokit eivät sisällä arvoja | Raw syöte ja injected log line | implemented-e2e |
| CUS-OVERVIEW-001 | P0; web-e2e | Tyhjä yritys; luo asiakas koko työalueen lomakkeella | Tallennus avaa uuden asiakkaan lukutilaisen asiakaskortin | Yksi customer ja created-audit; read-näkymässä ei muokattavia kenttiä | Tekniset virheet tai tarpeeton master data | implemented-e2e |
| CUS-OVERVIEW-002 | P0; web-e2e | Olemassa oleva asiakas; overview, edit, save, cancel ja paluu listaan | Oikea tila ja tallennetut arvot näkyvät; peruuttaminen ei muuta tietoa | Listan haku, suodatin ja lajittelu säilyvät | Lomakkeen hylätty välitila | implemented-e2e |
| CUS-OVERVIEW-003 | P0; integration, web-e2e, cross-module | Asiakkaalla luonnos, approved, sent, credited ja cancelled | Vain asiakkaan omistamat laskut näkyvät oikeissa ryhmissä | Laskut haetaan companyId + customerId -rajalla; billing recipient ei muuta omistusta | Toisen asiakkaan tai yrityksen laskut | implemented-e2e |
| CUS-OVERVIEW-004 | P0; integration, security | Tuntematon tai toisen yrityksen customerId/invoiceId | Geneerinen 404 tai tyhjä listaus sopimuksen mukaan | Tenant-testit kattavat detail-, history- ja invoice-readit | Resurssin olemassaolo toisessa yrityksessä | covered-existing |
| CUS-OVERVIEW-005 | P0; web-e2e, security | Asiakkaan created/updated-activity | Vain allowlistatut suomenkieliset kategoriat näkyvät | Ei kenttäarvoja customer activity -osiossa | Nimi, osoite, sähköposti, puhelin, Y-tunnus, kommentti tai IBAN | implemented-e2e |
| CUS-OVERVIEW-006 | P0; web-e2e, cross-module | Avaa asiakkaan luonnos ja hyväksytty lasku laskutuksessa | App-taso vaihtaa moduulin ja avaa oikean resurssin kertakäyttöpyynnöllä | Customers ei omista eikä importtaa Invoicingin sisäistä UI-statea | Raaka URL, companyId tai tarpeeton invoice-data navigointipyynnössä | implemented-e2e |
| CUS-OVERVIEW-007 | P0; web-e2e, cross-module | Asiakkaalla maksamaton sent, maksettu ja credited+paid | Lähetetyt, Maksetut ja Hyvitetyt ovat toisensa poissulkevia; lasku avautuu Invoicingissa | Backend-sivutus ja companyId + customerId -raja säilyvät | Maksu- tai laskudatan kopiointi Customersiin | implemented-e2e |
| CUS-OVERVIEW-008 | P1; web-e2e, recovery | Company Settingsin oletustuntihinnan luku epäonnistuu asiakaskortilla | Rajattu hinnoitteluvirhe; asiakkaan tiedot, laskut, historia ja paluunavigointi säilyvät | Puuttuva oletus ja latausvirhe erotetaan | Tekninen backend-virhe | implemented-e2e |
| CUS-OVERVIEW-009 | P0; web-e2e, cross-module | Asiakkaalla vähintään 6 maksettua laskua | Oletuksena näkyy 5; kategoriakohtainen sivutus, sivukoko ja lajittelu toimivat; maksupäivä näkyy asiakaskortilla ja Laskutuksessa | Invoicingin server-side queryt ja Customersin draft-sivutus noudattavat samaa rajattua kontrollia | Toisen asiakkaan laskut, customerName-lajittelu tai tyhjä maksettu-päivä | implemented-e2e |
| CUS-REL-001 | P0; web-e2e, accessibility | Isännöitsijällä kaksi taloyhtiötä; avaa ja sulje suhderyhmä näppäimistöllä | Disclosure näyttää lukumäärän ja toimii Enter- sekä Space-näppäimillä | Asiakaskortin avaava toiminto säilyy erillisenä; ryhmän tila on saavutettava | Asiakassuhteen muuttaminen tai tekninen tunniste UI:ssa | implemented-e2e |
| CUS-REL-002 | P0; web-e2e | Avaa isännöitsijän kortti ja valitse hallinnoitu taloyhtiö | Hallinnoitujen taloyhtiöiden määrä ja nimet näkyvät; valinta avaa oikean kortin | Haku, suodatin, lajittelu ja disclosure-tila säilyvät listalle palattaessa | Toisen yrityksen taloyhtiöt | implemented-e2e |
| CUS-REL-003 | P0; web-e2e | Avaa taloyhtiön kortti ja siirry nykyisen isännöitsijän kortille | Oikea isännöitsijäkortti avautuu app-tason callbackilla | Customers omistaa nykyisen suhteen; näkymä ei rakenna omaa routeria | Raaka URL tai toisen featuren sisäinen state | implemented-e2e |
| CUS-RECIPIENT-001 | P0; web-e2e, cross-module | Taloyhtiö on juridinen asiakas ja isännöitsijä laskun vastaanottaja; lisäksi isännöitsijällä oma lasku | Taloyhtiön lasku näkyy taloyhtiön omissa laskuissa ja isännöitsijän erillisessä vastaanottajaosiossa, ei isännöitsijän omissa laskuissa | Server-side `customerId`- ja `billingRecipientCustomerId`-projektiot sekä snapshot-asiakas säilyvät erillisinä | Laskun siirtyminen vastaanottajan omistukseen tai client-side laajasuodatus | implemented-e2e |
| CUS-RECIPIENT-002 | P0; system, security, cross-module | Toisen yrityksen juridinen asiakas, vastaanottaja sekä approved/sent-laskut | Listat ovat tyhjiä ja detail-pyynnöt palauttavat geneerisen 404:n | Kaikki read modelit rajataan vahvistetulla `companyId`-arvolla | Toisen yrityksen asiakkaan tai laskun olemassaolo | implemented-e2e |
| CUS-INVOICE-001 | P0; web-e2e, critical, cross-module | Aktiivinen asiakas; aloita lasku asiakaskortilta ja anna kelvollinen rivi | Invoicing avautuu asiakas valittuna ja autosave tallentaa luonnoksen oikealle asiakkaalle | Customers välittää vain customerId:n app-navigationille; request ei sisällä companyId:tä | Palvelimen omistamat kentät tai toisen asiakkaan valinta | implemented-e2e |
| CUS-INVOICE-002 | P0; web-e2e, security | Passiivinen asiakas | Laskun luontitoimintoa ei tarjota ja asiakaskortti säilyy käytettävänä | Ei draftia eikä moduulisiirtymää | Piilotetun toiminnon käyttäminen authorization-korvikkeena | implemented-e2e |

## Company Settings

| ID | Riski ja tasot | Lähtö / toiminto / fault | Odotus | Tila ja havainnot | Erityinen vuotokielto | Tila |
|---|---|---|---|---|---|---|
| COMPANY-UI-001 | P0; web-e2e | Synteettiset asetukset; muuta yhteys-, pankki- ja ei-salaisia sähköpostitietoja | Tallennus onnistuu ja refresh säilyttää arvot | Master data muuttuu; auditissa vain changed category | Vanhat/uudet arvot auditissa | implemented-e2e |
| COMPANY-AUDIT-001 | P0; integration, system | Nykyiset asetukset; muuta pankki- ja sähköpostiasetuksia | 2xx ja turvallinen Activity | Arvot kannassa; auditissa vain sallitut kategoriat; tukipaketin poissulku säilyy integraatiotestien todistamana | IBAN, sender email, SMTP username | implemented-e2e |
| COMPANY-SECRET-001 | P0; integration, electron-e2e, security | Ei testisalaisuutta; aseta, tarkista status, poista ja restart | Renderer näkee vain boolean-tilan | Salaisuus vain safeStorage-testialueella; salattu blob säilyy restartissa ja kaikki slotit poistuvat | Secret, hash, pituus, ref tai plaintext | implemented-e2e |

## Invoicing

| ID | Riski ja tasot | Lähtö / toiminto / fault | Odotus | Tila ja havainnot | Erityinen vuotokielto | Tila |
|---|---|---|---|---|---|---|
| INV-LIFECYCLE-001 | P0; web-e2e | Asiakas ja asetukset; draft, rivit, autosave, refresh, approve, PDF ja fake delivery | Näkymä etenee Lähetettyihin | Yksi invoice, numero, PDF, delivery-event ja Activity-ketju | PDF-bytes, email body tai recipient lokiin | implemented-e2e |
| INV-REAPPROVAL-001 | P0; web-e2e, critical | Draft hyväksytään, avataan uudelleen, riviä muutetaan ja hyväksytään uudelleen | Sama lasku ja numero avautuvat päivitetyllä sisällöllä | Snapshot ja current PDF vaihtuvat; audit säilyttää siirtymien järjestyksen; numeroa ei kuluteta uudelleen | Vanhan snapshotin tai PDF:n sekoittuminen uuteen | implemented-e2e |
| INV-COPY-001 | P0; web-e2e, critical | Sent invoice kopioidaan luonnokseksi ja kopio hyväksytään | Uusi lasku saa uuden id:n ja numeron | Lähdelaskun status, PDF ja delivery-historia eivät muutu | Lähdelaskun identiteetin tai toimitushistorian kopioituminen | implemented-e2e |
| INV-MANUAL-DELIVERY-001 | P0; web-e2e, critical | Approved invoice; luo PDF ja merkitse käsin toimitetuksi | Lasku näkyy sent-tilassa myös refreshin jälkeen | Yksi manual delivery event ja audit; current PDF säilyy | Vastaanottaja- tai PDF-data auditissa | implemented-e2e |
| INV-RESEND-001 | P0; web-e2e, critical | Onnistuneesti toimitettu lasku lähetetään uudelleen | Sama lasku, numero ja PDF säilyvät | Uusi delivery event syntyy ilman uutta invoicea tai dokumenttia | Viestirunko, recipient tai SMTP-salaisuus | implemented-e2e |
| INV-SNAPSHOT-001 | P0; integration, web-e2e | Hyväksy lasku; muuta master dataa | Hyväksytty näkymä/PDF säilyy alkuperäisenä | Snapshot ei muutu; master audit erillinen | Uuden master datan sekoittuminen snapshotiin | implemented-e2e |
| INV-REVERSE-001 | P0; integration, web-e2e | Yritysasiakas Y-tunnuksella; valitse reverse charge ja vahvista | Netto=brutto, myyjän ALV=0, oikea PDF-merkintä | Treatment ja snapshot tallentuvat; approval audit | Normaali ALV-erittely reverse chargessa | implemented-e2e |
| INV-REVERSE-CREDIT-001 | P0; web-e2e, critical | Reverse-charge-lasku toimitetaan ja hyvitetään | Hyvityslasku säilyttää käännetyn verovelvollisuuden merkinnät | Netto=brutto, ALV 0 ja normaali ALV-erittely puuttuu myös credit-snapshotista ja PDF:stä | Normaali ALV-data reverse-charge-hyvityksessä | implemented-e2e |
| INV-CANCEL-001 | P0; integration, web-e2e | Approved ja toimittamaton; kaksivaiheinen peruutus | Cancelled näkyy, delivery estyy, PDF avautuu | Status cancelled ja yksi audit; ei delivery-eventiä | Uusi toimitusyritys | implemented-e2e |
| INV-CREDIT-001 | P0; integration, web-e2e | Sent invoice; osahyvitys, hyväksyntä ja PDF | Ryhmä ja jäljellä oleva määrä oikein, ylihyvitys estyy | Credit snapshot/numero/audit atomisesti | Alkuperäisen muuttaminen tai ylihyvitys | implemented-e2e |
| INV-MULTICREDIT-001 | P0; web-e2e, critical | Sent invoice hyvitetään kahdella peräkkäisellä hyvityslaskulla ja yritetään kolmatta | Kumulatiivinen tila on full ja kolmas hyvitys torjutaan | Tasan kaksi credit invoicea, ei aktiivista credit draftia; lista ryhmittelee lähteen ja hyväksytyt hyvitykset oikein | Ylihyvitys tai ylimääräinen draft | implemented-e2e |
| INV-PAYMENT-CREDIT-001 | P0; web-e2e, critical | Sent invoice merkitään maksetuksi, osahyvitetään ja hyvitetään loppuun | Maksuhistoria säilyy täydestä hyvityksestä huolimatta | Payment-projektio ja append-only event säilyvät; credit capacity päätyy nollaan | Maksutapahtuman katoaminen tai muuttaminen | implemented-e2e |
| INV-DOUBLECLICK-001 | P0; integration, web-e2e | Valid approve/send; kaksoiskomento | Yksi onnistuva vaikutus | Ei kahta numeroa tai succeeded-eventiä | Kaksoistoimitus | implemented-e2e |
| INV-REFRESH-001 | P0; web-e2e, recovery | Draft-, approved- ja sent-näkymä; selainrefresh | Oikea persisted näkymä palautuu jokaisessa tilassa | Ei ylimääräistä invoicea, numeroa, PDF:ää tai delivery-eventiä | Runtime-session ja tekniset tunnisteet | implemented-e2e |
| INV-DRAFT-DELETE-RESTART-001 | P0; system, recovery, critical | Autosaved draft poistetaan ja backend käynnistetään uudelleen | Lista pysyy tyhjänä ja detail palauttaa geneerisen 404:n | Draft ja sen audit puuttuvat myös restartin jälkeen; diagnostics pysyy terveenä | Poistetun draftin id diagnostiikassa tai virheessä | implemented-e2e |
| INV-NUMBERING-SERIES-001 | P0; system, critical, security | Käytetty sarja; esikatsele ja aktivoi uusi sarja täsmällisellä vahvistuksella | Uusi sarja aktivoituu ja seuraava lasku käyttää sitä | Vanha lasku, numero, viite ja sarjasnapshot säilyvät; aktivointi ei varaa numeroa | Tekninen series key, actor tai muutossyy responseen/Activityyn | implemented-e2e |
| INV-NUMBERING-SERIES-002 | P0; system, critical | Aktivoi uusi sarja ja hyväksy standardi- sekä hyvityslasku | Molemmat uudet laskut käyttävät aktiivista sarjaa | Vanha lasku ja sarja säilyvät; uudet numerot ovat uniikkeja | Tekninen series key julkiseen responseen | implemented-e2e |
| INV-NUMBERING-SERIES-003 | P0; integration, system, security | Puuttuva session, väärä vahvistus, forged companyId tai stale revision | Turvallinen 400/401/409 | Ei asetusta, eventtiä, pointer- tai sequence-muutosta | Tenant, request body, reason note tai tekninen avain | implemented-e2e |
| INV-NUMBERING-SERIES-004 | P0; system, fault, recovery | Settings-, active pointer- tai event-write fault aktivointitransaktiossa | Turvallinen 500 ja backend pysyy terveenä | Uusi settings, pointer ja event rollbackaavat jokaisessa vaiheessa; vanha sarja ja sequence säilyvät | SQL, trigger tai raw driver error | implemented-e2e |
| INV-NUMBERING-SERIES-005 | P0; system, concurrency, critical | Sarjan aktivointi ja hyväksynnät rinnakkain sekä kaksi kilpailevaa aktivointia | Hyväksynnät kuuluvat kokonaan vanhaan tai uuteen sarjaan ja vain yksi kilpaileva aktivointi onnistuu | Numerot ovat uniikkeja; aktivoinnin jälkeinen hyväksyntä käyttää varmasti uutta sarjaa; aktivointi ei kuluta numeroa | Tekninen sarja-avain julkiseen responseen | implemented-e2e |
| INV-NUMBERING-SERIES-006 | P0; system, critical | Vanhan sarjan lasku avataan transition jälkeen uudelleen muokattavaksi ja hyväksytään | Sama lasku, numero, viite ja sarjasnapshot säilyvät | Reapproval ei lue aktiivista uutta sarjaa eikä kuluta sequencea | Uuden sarjan sekoittuminen vanhaan laskuun | implemented-e2e |
| INV-NUMBERING-SERIES-007 | P0; system, critical | Vanhan sarjan lähetetty lasku kopioidaan transition jälkeen luonnokseksi ja hyväksytään | Kopio saa uuden laskuidentiteetin ja aktiivisen uuden sarjan | Lähdelasku säilyy muuttumattomana; uusi sarja etenee kerran | Lähdelaskun numeron tai sarjan kopioituminen | implemented-e2e |
| INV-NUMBERING-SERIES-UI-001 | P0; web-e2e, critical | Käytetty sarja; esikatselu, syy, kaksivaiheinen vahvistus ja aktivointi | Uusi sarja aktivoituu ja onnistumisviesti näkyy | Vanha lasku säilyy; aktivointi ei kuluta sequencea; tekninen sarja-avain ei näy UI:ssa | Series key, actor tai reason note näkyvään historiaan | implemented-e2e |
| INV-NUMBERING-SERIES-DESKTOP-001 | P0; electron-e2e, critical | Sama UI-polku Electronin local-sessionin kautta | Aktivointi onnistuu suojatun desktop-transportin läpi | Sama persistence-invariantti kuin webissä; renderer ei päätä companya, actoria tai series keytä | Runtime-session tai tekninen sarja-avain rendererille | implemented-e2e |
| INV-RACE-001 | P0; integration, system, security | Sama draft; kaksi rinnakkaista approve-pyyntöä | Yksi onnistuu tai dokumentoitu idempotentti tulos | Yksi numero, invoice ja audit | Sekvenssin tuplakulutus | covered-existing |
| INV-AUTH-001 | P0; integration, system, security | Prepared send; expired/reused/mismatched token, invoice, hash tai recipient | Turvallinen 4xx ilman provider-kutsua | Ei eventtiä/finalisointia eikä muutosta | Authorization fingerprint tai session | covered-existing |
| INV-PDF-FAIL-001 | P0; system, web-e2e, fault | Approved invoice; PDF-write fault | Turvallinen virhe, ei sent-tilaa | Ei osittaista metadataa; diagnostics ja turvallinen support-havainto | Filesystem-polku tai PDF-bytes | implemented-e2e |
| INV-SMTP-AUTH-001 | P1; system, web-e2e, fault | Prepared send; fake authentication failure | Turvallinen provider-virhe | Failed event, invoice ei sent; turvallinen retry-semantics | Username tai password | implemented-e2e |
| INV-SMTP-TLS-001 | P0; system, web-e2e, fault, security | Prepared send; fake TLS failure | Lähetys estyy, ei fallbackia | Failed/none event sopimuksen mukaan; invoice ei sent | Sertifikaattiraaka-arvo tai secret | implemented-e2e |
| INV-SMTP-REJECT-001 | P1; system, web-e2e, fault | Prepared send; fake DATA rejection | Turvallinen failed-tulos | outcome failed, sideEffectState none | SMTP-dialogi tai viestin sisältö | implemented-e2e |
| INV-SMTP-UNKNOWN-001 | P0; system, web-e2e, fault, recovery | Prepared send; fake outcomeUnknown final acceptance | Uusi toimitus estyy ratkaisuun asti | Unknown event, invoicea ei varmasti merkitä sent; Activity/Diagnostics eriytetty | Viestin sisältö tai credentials | implemented-e2e |
| DB-ROLLBACK-001 | P0; system, web-e2e, fault, recovery | Draft approval; deterministinen kirjoitusvirhe transaktion keskellä | Turvallinen virhe ja seuraava hyväksyntä onnistuu faultin vapauttamisen jälkeen | Draft, snapshot, numero, sekvenssi, PDF-metadata ja audit palautuvat atomisesti | SQL, tietokantapolku ja raw driver error | implemented-e2e |
| INV-PAYMENT-001 | P0; integration, web-e2e, critical | Sent standard invoice; merkitse maksetuksi | Maksutila, päivä, backendin laskema summa, event ja Activity oikein | Delivery-status ja snapshot säilyvät | Summa, actor tai pankkitieto Activityssa/lokissa | implemented-e2e |
| INV-PAYMENT-002 | P0; integration, web-e2e, critical | Maksettu lasku; poista maksumerkintä | Nykytila unpaid ja append-only-historia säilyy | Yksi revert-event; sent-status säilyy | Poistetun historian häviäminen | implemented-e2e |
| INV-PAYMENT-003 | P0; integration, system, security | Väärä tenant, puuttuva permission, approved/cancelled/credit/full-credit | Turvallinen 403/404/409 ilman sivuvaikutuksia | System-E2E todistaa session-, geneerisen 404- ja tilarajat; tenant- ja permission-rajat ovat integration-tasolla; ei projection- tai event-kirjoitusta | Toisen tenantin resurssin olemassaolo | implemented-e2e |
| INV-PAYMENT-004 | P0; integration, web-e2e, cross-module | Osittain hyvitetty sent-lasku; merkitse maksetuksi | Backend käyttää jäljellä olevaa summaa ja asiakaskortin Maksetut-osio päivittyy | Snapshot ja credit capacity säilyvät | Clientin lähettämä summa | implemented-e2e |
| INV-PAYMENT-005 | P0; integration, web-e2e, critical | Sama mark-paid kahdesti tai rinnakkain | Yksi nykytila ja yksi mark-event | Sama päivä idempotentti; eri päivä konflikti | Kaksoistapahtuma | implemented-e2e |
| INV-PAYMENT-006 | P0; integration, system, web-e2e, fault | Event-write failure kesken mark-paid-transaktion | Nykytilaprojektio palautuu ja seuraava validi toiminto onnistuu | Atominen rollback | SQL- tai raw driver error | implemented-e2e |

## Observability

| ID | Riski ja tasot | Lähtö / toiminto / fault | Odotus | Tila ja havainnot | Erityinen vuotokielto | Tila |
|---|---|---|---|---|---|---|
| OBS-ACTIVITY-001 | P0; integration, web-e2e | Tee business-muutos; avaa Activity | Oikea turvallinen tapahtuma ja järjestys | Omistavan moduulin audit vastaa read modelia | Kenttäarvot, actor id, customer name | implemented-e2e |
| OBS-DIAGNOSTICS-001 | P0; integration, web-e2e | Fake failure; avaa Diagnostics oikeudella | Turvallinen technical event ja build-context | Ei business-muutosta; support-sisällytys katalogin mukaan | Business sisältö, raw stack/path | implemented-e2e |
| OBS-LOGGER-001 | P0; integration, system, web-e2e, fault | Business-operaatio; operational writer fault | Sovittu business-tulos säilyy | Pakollinen audit säilyy; recursion estyy; safe fallback | Raw error ja payload | implemented-e2e |
| OBS-JSONL-001 | P1; integration, system, fault, recovery | Validit rivit + katkennut loppurivi | Diagnostics ohittaa rikkinäisen | Muut eventit säilyvät; support ilmoittaa truncationin | Rikkinäinen raw line | implemented-e2e |
| OBS-SUPPORT-001 | P0; integration, electron-e2e, fault | Synteettiset eventit; luo `.json.gz` | Inspect hyväksyy ja checksumit täsmäävät | Manifest/projektiot oikein; ei business audit -muutosta | Kielletty data ja AppData-polut | covered-existing |
| OBS-SUPPORT-LIMIT-001 | P1; integration, system, fault | Lähteet lähellä 25 MiB; luo paketti | Valid paketti ja rehellinen truncation | Uusimmat turvalliset eventit säilyvät | Raja-arvon yli vuotava lähde | covered-existing |

## Security

| ID | Riski ja tasot | Lähtö / toiminto / fault | Odotus | Tila ja havainnot | Erityinen vuotokielto | Tila |
|---|---|---|---|---|---|---|
| SEC-SESSION-001 | P0; integration, system, security | Puuttuva, väärä tai toisen runtimen session | Turvallinen 401/403 | Ei DB/audit-muutosta; rajattu security-event | Session-arvo tai header | implemented-e2e |
| SEC-TENANT-001 | P0; integration, system, security | A yrittää B:n customer/invoicea ja forged companyId:tä | Geneerinen vastaus | Ei väärän tenantin luku-/kirjoitus- tai audit-vaikutusta | B:n resurssin olemassaolo/data | covered-existing |
| SEC-MASS-001 | P0; integration, system, security | Lisää companyId/status/invoiceNumber/sentAt/actorUserId/unknown fields | 400 eikä kenttiä hyväksytä | Ei tallennusta/auditia; safe validation-event tarvittaessa | Torjutut arvot lokiin | implemented-e2e |
| SEC-PROTOTYPE-001 | P1; system, security | `__proto__`, `constructor`, `prototype` syötteissä | 4xx, backend terve | Object.prototype ei muutu; ei tallennusta | Raw corpus | implemented-e2e |
| SEC-INJECTION-001 | P0; integration, system, security | SQL/HTML/script/SVG/CRLF-korpus sallittuihin ja kiellettyihin kenttiin | Teksti torjutaan tai käsitellään tekstinä | Parametrisoitu SQL; ei uutta logiriviä; support-projektion osuus säilyy alempien testien todistamana | Raw payload ja suoritettava markup | implemented-e2e |
| SEC-PATH-001 | P0; integration, system, security | Traversal, encoded traversal, Windows/Unix absolute path ja `file://` | 4xx/404 turvallisesti | Ei kirjoitusta testirootin ulkopuolelle | Resolved local path | implemented-e2e |
| SEC-SIZE-001 | P1; integration, system, security | Raja, raja+1, pitkä Unicode, iso array ja rajattu ylikokoinen body | Rajattu 4xx/413, backend-prosessi ja uusi yhteys terveitä | Ei tallennusta/auditia; mahdollinen safe size-event | Koko raw body | implemented-e2e |
| SEC-METHOD-001 | P1; integration, system, security | Väärä method/content-type, puuttuva content-type, unknown query | Method ja query torjutaan; non-empty JSON-body vaatii `application/json`-media typen ja virheellinen tai puuttuva media type torjutaan 415-vastauksella | Route-regressiot ja system-E2E kattavat required-, optional- ja forbidden-body-sopimukset ilman expected failureja | Request body/header dump | implemented-e2e |
| SEC-XSS-001 | P0; web-e2e, security | Turvalliseen tekstikenttään markup-korpus; renderöi ja tee PDF | Teksti näkyy tekstinä, ei popupia/egressiä | Tallennus vain validoituna; PDF ei suorita sisältöä | DOM-execution tai external request | implemented-e2e |

## Desktop

| ID | Riski ja tasot | Lähtö / toiminto / fault | Odotus | Tila ja havainnot | Erityinen vuotokielto | Tila |
|---|---|---|---|---|---|---|
| DESK-BRIDGE-001 | P0; integration, electron-e2e, security | Development shell; tarkista preload surface | Vain dokumentoidut metodit; Node/process/require/fs puuttuvat | Ei business-muutosta; security-event vain rikkomuksesta | Raw IPC ja runtime-session | implemented-e2e |
| DESK-NAV-001 | P0; integration, electron-e2e, security | Yritä external navigation/window.open/webview | Kaikki estyvät | Deduplikoitu turvallinen security-event | Pitkä/raw URL tai query-secret | implemented-e2e |
| DESK-PERMISSION-001 | P1; integration, electron-e2e, security | Permission check/request | Estyy ilman kohinaa | Ei OS-oikeutta; deduplikoitu event | Raw URL tai device detail | implemented-e2e |
| DESK-PDF-001 | P0; integration, electron-e2e | Approved PDF; avaa invoiceId:llä ja sulje | Suojattu ikkuna renderöi PDF:n | Ei DB-muutosta; ikkuna poistuu rekisteristä | URL, path, session tai header rendererille | implemented-e2e |
| ARCHIVE-PDF-FAILURE-001 | P0; integration, electron-e2e, fault | Arkistointi käytössä; poista valittu kohde ennen manuaalista toimitusta | Toimitus onnistuu ja lasku on `sent`; arkistotask jää pending-tilaan | Queue/delivery-rajat säilyvät eikä paikallista kopiota synny | Polku, invoice/document/delivery id, laskunumero tai raw error lokiin | implemented-e2e |
| ARCHIVE-PDF-RECOVERY-001 | P0; integration, electron-e2e, recovery | Luo edellisen skenaarion pending-task; palauta kohde ja käynnistä desktop uudelleen | Manuaalinen retry tyhjentää journalin ja tallentaa täsmällisen `%PDF-`-tiedoston | Sama runtime-owned config/journal palautuu; business-tila ei muutu retryssä | Session, polku tai PDF-data rendererille | implemented-e2e |
| ARCHIVE-PDF-CONFLICT-001 | P0; integration, electron-e2e, recovery | Kohteessa on saman niminen eri sisältöinen PDF ennen toimitusta | Tiedostoa ei korvata; task jää conflict-tilaan eikä restart kasvata attempt-määrää | Konfliktibytes säilyvät muuttumattomina; ei automaattista overwrite/renamea | Polku, tiiviste, laskunumero tai PDF-data lokiin | implemented-e2e |
| DESK-SECRET-001 | P0; integration, electron-e2e, security | Synteettinen secret; set/status/remove/restart | Renderer näkee vain tilan | Testialueen salattu blob säilyy restartissa ja poistuu slotteineen | Secret, hash, length tai ref | implemented-e2e |
| DESK-SUPPORT-001 | P0; packaged-smoke, electron-e2e | Synteettiset logit; stubattu save dialog | `.json.gz` syntyy ja inspect hyväksyy myös legacy-päätteen | Checksumit/projektiot oikein | Salaisuus, PII ja production path | implemented-e2e |
| DESK-LOGFOLDER-001 | P1; integration, electron-e2e | Stubbaa openPath; paina avauskomentoa | Main avaa vain testilokijuuren | Ei DB/auditia; renderer ei lähetä polkua | Filesystem path rendererille | implemented-e2e |
| DESK-RESTART-001 | P0; packaged-smoke, electron-e2e, recovery | Hallittu shutdown ja restart samalla testidatalla | Data säilyy, UI palautuu | Backend sammuu; runtimeInstanceId vaihtuu; vanha session torjutaan | Vanha runtime-session | implemented-e2e |
| DESK-BACKEND-EXIT-001 | P0; electron-e2e, fault, recovery | Utility-backend lopetetaan odottamatta | Sovellus sulkeutuu hallitusti ja uusi runtime käynnistyy | Turvallinen unexpected-exit-event; backend palautuu terveeksi | Stack, paikallinen polku ja session | implemented-e2e |
| DESK-BOOTFAIL-001 | P0; electron-e2e, fault | Development bootstrap fault | Turvallinen viesti ja hallittu exit | Ei osittaista runtimea; turvallinen startup failure-event | Stack ja paikallinen polku | implemented-e2e |
| DESK-RUNTIME-002 | P0; electron-e2e, dependency | Käynnistä tarkasti lukittu desktop-runtime | Electron, Node, Chromium, V8 ja N-API vastaavat hyväksyttyä yhteensopivuusmatriisia | Electron 43.2.0, Node 24.18.0, Chromium 150.0.7871.129, V8 15.0.1240245-electron.0 ja N-API 10 | Paikalliset polut ja ympäristömuuttujat | implemented-e2e |
| DESK-ENDURANCE-001 | P1; electron-e2e, endurance | 200 moduulisiirtymää, 50 laskuavausta, 100 PDF-sykliä, 20 tukipakettia, 30 secret-sykliä ja 20 restartia | Työkuorma valmistuu ja synteettinen mittausraportti syntyy | Lopussa yksi ikkuna, hallittu prosessimäärä, terve backend ja ei secret-jäämää | Oikea data, salaisuus, session ja production-polut | implemented-e2e |
| DESK-SOAK-001 | P1; electron-e2e, endurance | Manuaalinen 30 minuutin toistuva UI-, PDF-, secret-, support- ja restart-kuorma | Työkuorma säilyy terveenä ja raportoi prosessi-, muisti- ja tiedostomittarit | Electron 42.8.0- ja 43.2.0-baselinet valmiit; uusin ajo: 3 250 kierrosta, 325 restartia, 650 tukipakettia, lopussa 5 prosessia, 1 ikkuna ja terve backend | Oikea data, salaisuus, session ja production-polut | implemented-e2e |

## Definition of Done

Kun uusi moduuli tai merkittävä ominaisuus lisätään:

1. tämä matriisi päivitetään
2. vähintään yksi onnistuva käyttäjäpolku lisätään
3. vähintään yksi permission- tai tenant-esto lisätään
4. vähintään yksi failure- tai recovery-polku lisätään
5. cross-module-polku lisätään, jos moduuli käyttää toista moduulia
6. Activity-, Diagnostics-, incident-index- ja support bundle -päätökset
   päivitetään
7. packaged-turvaraja päivitetään, jos Electron-capability muuttuu

Invariantti todistetaan kattavasti alimmalla sopivalla testitasolla. E2E antaa
vain edustavan koko järjestelmän todisteen eikä korvaa unit- tai
integraatiotestejä. Tapaukset johdetaan invariansseista, luottamusrajoista,
sivuvaikutuksista, tilakoneista ja todellisista rikkoutumistavoista; määrää ei
kasvateta satunnaisilla variaatioilla.
