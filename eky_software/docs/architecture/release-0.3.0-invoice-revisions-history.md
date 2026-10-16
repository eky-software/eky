# 0.3.0: laskurevisioiden historia

<a id="m1-unit-preparation-7671-10095"></a>

> Historical source: `eky_software/docs/architecture/release-0.3.0-m1-preparation-plan.md:7671-10095` (original and provenance retained privately).
> Original source-unit checksums are retained privately. Historical pending states are not current authority.

<a id="m1-source-preparation-l7671"></a>

## B0: laskun sisältö ja toimitus

**Valmistelu 4.10.2026; B-P1 hyväksytty, B-P2:n historiasuunta valittu ja
B-P3:n rajattu legacy-uudelleenlähetys hyväksytty.** Tämä on nykyisen
roadmapin B-paketin tarkennus, ei uusi roadmap tai uusi tietoturvaskannaus.
Lähtörevisio on sivun alun hyväksytty main. Alla olevat testit ovat
vaatimuksia, eivät tämän valmistelun aikana ajettuja tai läpäistyjä testejä.

<a id="m1-source-preparation-l7679"></a>

### Lähdepohja ja nykyiset puutteet

Alkuperäisen katselmuksen R02/R08/R12/R13 sekä keskeytetyn Deep Scanin
S030-03/04/05:n tallennetut havainnot ja korjausehdotukset on luettu uudelleen.
Seitsemän skannerihavaintoinstanssia koskee näitä kolmea S030-ryhmää;
ryhmittely ei muuta alkuperäisiä vakavuuksia tai validoinnin rajoja.
Skannaus on edelleen `canceled`; suljettua loppuraporttia tai hyväksyttyä
korjauspakettia ei ole. Alkuperäisten instanssien vastaavuus ja yksityiskohtainen
näyttö säilytetään yksityisessä lähdeaineistossa, ei tämän sivun kopiona.

Nykyisen lähteen staattinen vertailu tukee korjausjonon säilyttämistä:
katselmuksen lähtörevisiosta hyväksyttyyn mainiin Invoicingin ja SMTP:n
tuotantototeutukset eivät ole muuttuneet. Tämä ei ole uusi runtime-toisto.
Vanhojen tutkimusprobejen odottama virhekäyttäytyminen ei ole korjauksen näyttö.

| Havainto | Nykyinen vastuukohta ja puute | Sulkemisen ehto |
| --- | --- | --- |
| R02 / S030-03 | `sendApprovedInvoiceEmailSmtp.ts`, `sqliteInvoiceApprovalRepository.ts` ja `sqliteInvoiceDeliveryEventRepository.ts`: providerin odotuksen aikana snapshot voidaan avata ja hyväksyä uudelleen samalla lasku-ID:llä. Lopullinen kuittaus ei sido sisältörevisiota; unresolved-eventin dokumenttiviite voi kadota reopenissa. | Atominen varaus ja loppukuittaus täsmälleen samalle laskurevisiolle ja dokumentille; reopen ei tuhoa keskeneräisen tai epävarman ulkoisen toimituksen todistetta, myös restartin jälkeen. |
| S030-04 | `generateApprovedInvoicePdfDocument.ts` ja dokumenttirepository/storage: välimuistin nopea polku ei tarkista snapshot-revisiota, julkaisu on ehdoton ja eri kirjoittajat käyttävät samaa tiedostopolkua. | Ehdollinen julkaisu ja uudelleenkäyttö; myöhäinen renderöinti tai sen siivous ei korvaa tai poista nykyistä PDF:ää. |
| S030-05 | Sama SMTP-käyttötapaus ja correction-repository: kelpoisuus tarkistetaan ennen asynkronista PDF-vaihetta, attempted-tallennus ei ratkaise peruutuskilpaa samassa transaktiossa. | Jos cancel tai reopen voittaa, provider-kutsuja on nolla. Jos varaus voittaa, sisällön tuhoava muutos estyy. Asiakas- ja testilähetys todistetaan erikseen. |
| R08 | `calculateCreditInvoiceDraft.ts`: alkuperäinen ALV-kapasiteetti summataan riveittäin, vaikka standardilaskenta pyöristää ALV-ryhmittäin. | Nykyinen ryhmäpyöristys ja kumulatiivinen hyvitys antavat samat auktoritatiiviset rajat; oikea täysi hyvitys sallitaan ja ylihyvitys estyy. |
| R12 | `smtpSession.ts`: QUITin aikabudjetin laskenta voi heittää lopullisen DATA-250-kuittauksen jälkeen ennen best-effort-catchia. | Jo vahvistettu SMTP-hyväksyntä säilyy, vaikka QUITin valmistelu tai sulku epäonnistuu. DB-commit ja vastaanottajan postilaatikkoon saapuminen eivät ole sama todiste. |
| R13 | `smtpReplyParser.ts`: yhden rivin raja kohdistuu ennen rivien erottelua usean rivin yhteiseen chunkkiin. | Samat vastaustavut tuottavat saman tuloksen pilkkomisesta riippumatta; rivi-, kokonais-, EOF- ja muistirajat säilyvät. |

Nykyinen luotettu actor/company, permission, native-vahvistus, kertakäyttöinen
valmistelutunniste ja vastaanottajasidonta säilyvät. Havainnot eivät osoita
internetistä avointa palvelua tai yritysrajan ohitusta. UI:n painike-esto
tukee käyttökokemusta, mutta ei korvaa backendin päätöstä.

<a id="m1-source-preparation-l7708"></a>

### Rajattu ratkaisusuunta

Suositus on täydentää Invoicingin nykyisiä pieniä portteja ja transaktioita.
Application ohjaa käyttötapausta, domain määrittää sallitut siirtymät ja
SQLite-adapteri omistaa atomisuuden. SMTP-adapteri tietää protokollan, ei
laskun tilaa; PDF-renderer ei omista revision julkaisupäätöstä. Ei uutta
yleistä manageria, globaalia lukkoa, työjonoa, palvelua tai testikehystä.
Nykyiset kirjastot riittävät suunniteltuun työhön.

1. **Yhtenäinen snapshot-identiteetti.** Hyväksynnässä syntyy pysyvä
   sisältörevisio; uudelleenhyväksyntä vaihtaa sen. Laskunumero ja lasku-ID
   säilyvät. Revisio ja snapshot luetaan yhtenä eheänä kokonaisuutena,
   eivät erillisinä lukuina joiden väliin voi tulla muutos. `updatedAt`
   tai PDF-tavujen hash ei yksin ole snapshot-identiteetti.
2. **Omistettu PDF.** Renderöinti saa kyseisen snapshotin ja revision.
   Tavut kirjoitetaan operaatiokohtaiseen, runtime-juuresta johdettuun
   itsenäiseen tiedostoon ilman nykyisen artifactin ylikirjoitusta. Metadata
   julkaistaan vain, jos revisio ja tilan kelpoisuus ovat yhä samat.
   Kahdesta saman revision kirjoittajasta yksi voittaa; häviäjä siivoaa vain
   todistetusti oman julkaisemattoman tiedostonsa. Katalogoitua, toimitukseen
   sidottua tai omistajuudeltaan epävarmaa tiedostoa ei poisteta.
   Myös cache-lukuvirheen metadatan mitätöinti tarkistaa atomisesti odotetun
   document-ID:n, revision ja toimitussidonnan; laskukohtainen ehdoton poisto
   ei ole sallittu fallback. Toimitustodisteen lukuvirhe raportoidaan
   eheys-/selvitystarpeena, eikä todistetta hävitetä regeneroinnin tieltä.
3. **Atominen varaus.** PDF:n lukemisen ja native-vahvistuksen jälkeen
   repository tarkistaa samassa lyhyessä transaktiossa companyn, laskun
   tilan/revision, dokumentin ID:n/hash-arvon/koon ja estävät toimitukset sekä
   tallentaa attempted-varauksen. Tarkistus käyttää vahvistetun valmistelun
   samoja arvoja. Sekä reopen että cancel käyttävät samaa pysyvää päätösrajaa;
   jos ne ehtivät ensin, vanha valmistelu ei oikeuta provider-kutsuun.
4. **Verkko ja kuittaus.** SMTP suoritetaan transaktion ulkopuolella.
   Loppukuittaus tarkistaa varauksen identiteetin ja tilan ja päivittää
   delivery-eventin, mahdollisen `sent`-tilan ja auditin atomisesti.
   Myöhäinen tai toistettu kuittaus ei kohdistu toiseen revisioon eikä luo
   toista toimitusta. Asiakkaalle lähettäminen ja itselle testaaminen
   erotetaan pysyvässä metadatassa; testilähetys ei merkitse laskua lähetetyksi.
5. **Epävarmuus säilyy.** Prosessin kaatuminen tai restart ei vapauta
   unresolved-varausta. Lopullinen SMTP-hyväksyntä ja DB-committivirhe
   erotetaan: lähettämistä ei uusita automaattisesti eikä tulosta nimetä
   varmasti epäonnistuneeksi. Vähintään attempted ja sen alkuperäinen
   revision/document-sidonta säilyvät, jos outcomeUnknown-kirjauskin epäonnistuu.
   Lukkoa ei vapauteta kellon, UI:n tai muistissa olevan tokenin perusteella.

Muuttuvan koodin ensisijaiset omistajat ovat
`apps/backend/src/modules/invoicing/{domain,application,ports,infrastructure}`,
`apps/backend/src/infrastructure/email/smtp` sekä nykyinen
`apps/backend/src/composition/invoicingComposition.ts`.
Tietomallin hyväksytyt lisäykset kuuluvat `apps/backend/src/database`-alueeseen.
API-client, web-feature ja desktopin native-vahvistus muuttuvat vain, jos
täsmällinen sidonta tai turvallinen palaute vaatii niiden sopimuksen muutosta.
Uusi moduuli käyttää jatkossakin tavallisia kapeita portteja, ei B:n sisäistä
prosessi- tai tallennusmekanismia.

<a id="m1-source-preparation-l7762"></a>

### Päätökset ennen B:n toteutusta

Omistajan 4.10.2026 päätökset korvaavat tämän valmistelun aikaisemmat
ehdotukset pysyvästä testilähetyksen jälkeisestä muokkausestosta ja vanhan
SMTP-historian yleisestä uudelleenlähetysestosta. Hyväksytty tavoite,
valittu suunnittelusuunta ja vielä avoin toteutusratkaisu erotetaan alla.

| Päätös | Omistajan päätös | Vaikutus ja jäljellä oleva valmistelu |
| --- | --- | --- |
| B-P1: pysyvä revisiosidonta | **Hyväksytty:** laskun, PDF:n ja toimituksen yhteinen pysyvä revisiosidonta sekä sen rajatut migraatiot ja testit. | Tarkat kentät, constraintit ja migraation järjestys katselmoidaan ennen toteutusta. Laskunumerointi, moduulirajat ja riippuvuudet säilyvät. Ei julkaistun SQL-migraation muokkausta tai koko DB:n uudelleenrakennusta. |
| B-P2: toimituksen jälkeen korjaaminen | **Suunnittelusuunta valittu:** onnistuneen itselle tehdyn SMTP-testilähetyksen jälkeen muokkaamisen pitää säilyä. Suunnitellaan muuttumaton toimitusversioiden historia. Pysyvää muokkausestoa ei valittu. | Säilytetään toimitetun revision snapshot, rivit ja PDF sekä niiden tapahtumaviitteet. Alla oleva tietomalli-, katalogi- ja käyttösopimus on jatkosuunnitelma, ei valmis toteutus. Keskeneräisen tai epävarman toimituksen esto sekä asiakkaalle toimitetun laskun nykyinen `sent`-sääntö säilyvät. |
| B-P3: vanha data | **Hyväksytty selvityksen jälkeen:** jo lähetetyn laskun säilyneen, tarkistetun legacy-PDF:n erikseen vahvistettu uusi lähetys alla kuvatuin rajauksin. | Ei regenerointia tai takautuvaa sisältövarmuuden väitettä. Puuttuva tai ristiriitainen aineisto ja ratkaisematon lähetys estävät tämän polun. Alkuperäiset rivit ja PDF:t säilyvät. Yleistä vanhan SMTP-historian muokkausestoa ei tällä hyväksytä eikä epäselvää vanhaa testimoodia arvata. |

**B-P2:n säilyvät rajat:** dry-run ei ole ulkoinen SMTP-toimitus, eikä sille lisätä
uutta pysyvää muokkausestoa tämän päätöksen perusteella. Nykyisiä cancelin
muita estoja ei samalla lievennetä. Todistetusti ennen ulkoista hyväksyntää
epäonnistunut uusi toimitus ei yksin lukitse laskua pysyvästi; virheluokituksen
pitää osoittaa tämä. Onnistunut asiakaslähetys noudattaa nykyistä `sent`-
sääntöä. Valmistelun hylkäys ja onnistunut esikatselu eivät ole toimituksia.
Epävarman toimituksen manuaalinen selvitys-/vapautuskäyttöliittymä ei sisälly
automaattisesti B:hen: ilman erikseen hyväksyttyä evidenssin säilyttävää
sovituspolkua tila pysyy estettynä ja käyttäjälle kerrotaan tarkistustarve.

<a id="m1-source-preparation-l7785"></a>

### B-P2: toimitusversioiden historia

**Hyväksytty suunnittelusuunta; koko käyttökulun toteutus ja hyväksyntä
ovat vielä kesken.** Lähtörevision `sqliteInvoiceApprovalRepository.ts`
korvasi uudelleenhyväksynnässä saman laskun snapshotin ja rivit;
reopen poisti dokumenttimetadatan ja vanha delivery-event saattoi menettää
viitteensä. Työpuun kohdetodennettu reopen säilyttää historian; sen
käyttöpolun rajaus ja näyttö ovat alla B4-checkpointissa.
Historiaa ei siksi toteuteta pelkkänä
uutena revisiosarakkeena nykyisissä riveissä. Säilytämme laskun liiketoiminnallisen
identiteetin mutta erotamme sen muuttumattomasta hyväksytystä sisällöstä.

Suositeltu rajattu malli on Invoicingin oma relaatiopohjainen
revisiokohtainen snapshot ja rivit sekä laskun nykyisen revision viite.
Nykyiset lasku-/rivitaulut voivat säilyä vaiheistetusti nykytilan lukumallina;
niitä ja revision sisältöä ei muodosteta eri laskentalogiikoilla eikä muuteta
erillisissä transaktioissa. Koko laskutusmoduulin repository-uudistus tai
yleinen versiointikehys ei kuulu tähän. Tarkka skeema ja lukijoiden siirto
katselmoidaan B3:n tiedostokohtaisessa valmistelussa.

- Hyväksyntä ja uudelleenhyväksyntä muodostavat yhden validoidun snapshotin,
  pysyvän revision ja rivit samassa transaktiossa nykyisen numeroinnin,
  laskun nykytilan ja auditin kanssa. Saman laskun uusi revisio ei ole uusi
  lasku eikä kuluta uutta laskunumeroa. Historiaan sidottuja rivitunnisteita
  ei tulkita myöhemmän revision riveiksi; myös hyvityksen lähderiviviitteet
  ja palautuksen yritys-/laskurajat testataan.
- Snapshot omistaa laskun sisältöarvot, rivit ja hyväksytyt rahasummat,
  ei jatkuvasti muuttuvaa maksu-, toimitus- tai peruutustilaa. Nykyinen
  `ApprovedInvoiceView` sisältää näitä dynaamisia kenttiä: koko API-vastausta
  ei tallenneta sellaisenaan uudeksi auktoritatiiviseksi historiamalliksi.
  Laskenta tehdään kerran hyväksynnässä, ei uudelleen historian lukemisessa.
- PDF:n metadata ja itsenäiset tavut kuuluvat samaan revisioon.
  Reopen irrottaa nykyisen esikatselun, mutta ei poista säilytettävää versiota,
  sen PDF:ää tai tapahtumaviitteitä. Uusi hyväksyntä julkaisee uuden current-
  viitteen; historia ei ole vaihtoehtoinen current-PDF-välimuisti.
- Ennen ulkoista provider-kutsua attempted-varaus sitoo muuttumattomasti
  yrityksen, laskun, revision, dokumentin ja toimitusmoodin. Kaikki ulkoiseen
  varaukseen sidotut versiot säilyvät myös epävarman tai epäonnistuneen
  yrityksen jälkeen. B ei lisää historian automaattista poistoa tai retention-
  siivousta; julkaisemattoman operaatiotiedoston siivous on eri asia.
- Onnistunut itselle lähetys sallii reopenin, kun lasku on muuten siihen
  kelvollinen eikä estävää toimitusta ole. Vanha versio jää historiaan.
  Uudelleenhyväksynnän jälkeen tavallinen asiakkaalle lähetys käyttää vain
  nykyistä hyväksyttyä revisiota ja uutta native-vahvistusta. Vanhan version
  katselu tai vanha vahvistustunniste ei valtuuta sen lähettämiseen asiakkaalle.
- Keskeneräinen `attempted` tai `outcomeUnknown` estää edelleen sisällön
  muuttamisen, peruutuksen ja uuden ulkoisen lähetyksen. Historia ei ratkaise
  epävarmaa SMTP-toimitusta. Onnistuneen asiakaslähetyksen jälkeen nykyinen
  `sent`-sääntö pysyy: sisältöä ei korjata samannumeroisella uudella revisiolla.
- Toimitushistorian luku saa näyttää tapahtumaan sidotun alkuperäisen PDF:n
  erillään nykyisestä versiosta. Tavalliset listat, saatavat, maksuseuranta,
  hyvityskatot ja raportit laskevat edelleen laskun vain kerran. Historialla
  ei ole omaa laskunumerointia, maksutilaa tai myyntisaatavaa.
- Invoicingin snapshot-/catalog-portit luettelevat myös historialliset
  auktoritatiiviset PDF:t. Backup/restore tarkistaa revision, laskun,
  dokumentin ja delivery-eventin viiteketjun sekä kaikki nykyiset tiedosto-
  invariantit. Historia ei saa jäädä valinnaiseen PDF-arkistoon, lokiin,
  pelkkään audit-tapahtumaan tai backupista puuttuvaan kansioon.

Vaihtoehtojen rajaus: pelkkä PDF/hash-historia olisi pienempi mutta ei
säilyttäisi korvattuja laskurivejä tai palautettavaa sisältösnapshotia.
Versionoitu tiukasti validoitu snapshot-payload on mahdollinen adapterin
tallennusvaihtoehto, mutta se tarvitsee oman formaatti- ja migraatiosopimuksen;
raakaa API-JSONia ei käytetä oikotienä. Relaatiomalli seuraa nykyistä
tietomalliperiaatetta. Se lisää schema-/mapper- ja varmuuskopiointityötä sekä
levytilaa, mutta pitää vastuun Invoicingissa. Kasvun ja pitkän historian
lukemisen kustannukset todennetaan synteettisellä aineistolla; mittaustuloksia
ei ole vielä. Rajattu tapahtumakohtainen PDF-katselu kuuluu suunnitteluun,
laaja versiovertailu, palautus vanhaan versioon tai massauudelleenlähetys ei.

<a id="m1-source-preparation-l7855"></a>

### B-P3: turvallisen uudelleenlähetyksen vaihtoehto

**Omistajan hyväksymä rajaus 4.10.2026, ei vielä toteutettu.** Vanhan tiedon kohdalla
erotamme kaksi väitettä: säilynyt PDF vastaa nyt tarkistettua metadataa, tai
PDF todistetusti vastaa aiemmin toimitettua laskurevisiota. Nykyinen
`delivery_event.document_id -> invoice_documents -> tiedosto` voi tukea
ensimmäistä väitettä, mutta ei yksin todista toista. Laskukohtainen polku on
voinut ylikirjoittua; R02 on voinut muuttaa snapshotia lähetyksen aikana ja
R12 on voinut merkitä jo hyväksytyn toimituksen epäonnistuneeksi. Historiallinen
`sent` tai `succeeded` ei korjaa tätä puuttuvaa revisiotodistetta.

Lähdeluvussa tarkentui myös nykyisen `getApprovedInvoicePdfDocument.ts`-
polun raja: se palauttaa luetut tavut vertaamatta niiden SHA-256:ta tai kokoa
metadataan. Valmistelutunniste sitoo metadatan, ei itsestään varmennettuja
tavuja. B3:n tarkistus koskee siksi sekä uutta että legacy-haaraa. Havainto
on lähdeperusteinen täsmennys S030-04:n sisältösidontaan, ei tässä ajettu koe
tai uusi skannerin havainto.

Hyväksytty vaihtoehto on rajattu **säilyneen legacy-PDF:n uusi vahvistettu lähetys** jo
`sent`-tilassa olevalle laskulle. Se ei esitä vanhaa historiaa varmennetuksi,
muuta laskun sisältöä tai avaa sitä uudelleen muokattavaksi. Käyttäjä tarkistaa
lähetettävän dokumentin ja saa näkyviin historiallisen sisältösidonnan rajan.
Tämä säilyttää käyttökelpoisen uudelleenlähetyspolun ehjälle aineistolle,
mutta jättää katkenneet ja ristiriitaiset tapaukset erilliseen selvitykseen.

1. Backend tunnistaa vanhan aineiston migraatiossa säilytetystä alkuperästä,
   ei UI:n antamasta legacy-lipusta. `sendInvoices`, luotettu company/actor,
   laskun kelpoisuus ja estävät toimitukset tarkistetaan normaalisti.
   Vain säilyneen tapahtuma-/dokumenttiketjun yksiselitteinen ehdokas kelpaa
   tähän rajattuun vaihtoehtoon. Null-viitettä ei liitetä jälkikäteen nykyiseen
   PDF:ään eikä vanhaa testimoodia päätellä vastaanottajaosoitteesta.
2. Luetaan rajatun storagen tavut, tarkistetaan tyyppi, containment, koko ja
   todellinen SHA-256 sekä dokumentin yritys-/laskusidos. Ei ensure-PDF-
   regenerointia, metadatan poistavaa fallbackia eikä nykyisestä snapshotista
   tuotettua korvaavaa liitettä. Puuttuva tai ristiriitainen tiedosto pysäyttää
   toiminnon säilyttäen nykyisen aineiston.
3. Tarkistetut tavut kiinnitetään uuden operaation itsenäiseen, muuttumattomaan
   dokumenttiin. Alkuperäinen metadata, tiedosto ja historialliset tapahtumat
   säilyvät. Uusi dokumentti on Invoicingin katalogissa ennen provider-kutsua,
   ei pelkkä muistipuskuri tai temp-tiedosto. Tämän dokumentin provenance
   erottaa vanhasta aineistosta säilytetyt tavut uudesta varmennetusta
   laskurevisiosta; nykyistä snapshotia ei nimetä sen historialliseksi lähteeksi.
4. PDF-esikatselu, kertavaltuutus ja native-vahvistus kohdistuvat juuri tähän
   dokumenttiin ja uuden lähetyksen vastaanottajaan/viestikenttiin. Näkyvä
   merkitys on säilyneen dokumentin uusi lähetys, ei vanhan sisällön varma
   toisto. Send tarkistaa sidonnan sekä luettujen tavujen hashin/koon uudelleen
   ja antaa providerille saman tarkistetun puskurin, ei polusta myöhemmin
   uudelleen haettavia tavuja. Muuttunut vahvistuskohde hylätään.
5. Varaus ja lopputulos kirjataan uutena toimitusyrityksenä samaa atomista
   omistavaa toimitusporttia käyttäen. Uuden yrityksen artifact-sidos on
   täsmällinen, vaikka vanhan tapahtuman revisio jää tuntemattomaksi. Laskun
   snapshot, numero, maksu- ja `sent`-tila sekä vanhat tapahtumat eivät muutu.
   Ei automaattista uusintaa tai uuden asiakaslaskun luomista.

Tämä vaihtoehto tarvitsee eksplisiittisen tyypitetyn eron varmennetun uuden
revision ja säilyneen legacy-artifactin välille. Yleinen nullable revision
ohittava polku ei ole hyväksyttävä. Katalogi ja restore-validator tarkistavat
variantin omat viitteet; vanhan aineiston rajaus ei löysennä uuden revision
varmennusta. Käyttäjän vahvistus ei ohita hash-virhettä, yritysrajaa,
ratkaisematonta toimitusta tai tunnettua sisältöristiriitaa.

| Vanhan aineiston tila | Hyväksytyn rajauksen mukainen käsittely |
| --- | --- |
| Hyväksytty lasku ilman ulkoisen SMTP-toimituksen historiaa | Hallittu siirtyminen nykyisestä snapshotista uuteen varmennettuun revisioon ennen uutta lähetystä. Ei väitettä vanhan cache-PDF:n vastaavuudesta. |
| Jo `sent`, yksiselitteinen säilynyt tapahtuma-/PDF-ketju, tavut vastaavat metadataa eikä avointa epävarmuutta tai tunnettua ristiriitaa | Yllä kuvattu eksplisiittinen legacy-artifactin uusi lähetys. Historiallinen revisio jää ilmoitetusti varmentamatta. |
| Null-viite, usea ristiriitainen ehdokas, puuttuva PDF, hash-/kokovirhe, tunnettu R02-poikkeama tai väärä yritys-/laskusidos | Ei tätä lähetyspolkua eikä regenerointia; alkuperäinen aineisto säilytetään erillistä selvitystä varten. |
| `attempted`, `outcomeUnknown` tai selvittämätön R12:een sopiva vanha `failed` | Ei automaattista vapautusta tai uusintaa. Pelkkä `failed` ei todista toimittamattomuutta; tarvittava sovituspäätös on erillinen. |
| Vanha `approved` ja SMTP-historia, jonka asiakas-/testimoodia ei voida todentaa | **Omistajan hyväksymä rajattu selvitysesto 6.10.2026:** lasku ja historia säilyvät luettavina, mutta reopen, uusi lähetys ja lähetetyksi merkitseminen estetään selkeällä selvitysohjeella. Ei päätellä testimoodia vastaanottajasta tai ajasta eikä sovelleta uuden B-P2:n muokkauslupaa takautuvasti. Esto ei koske uusia laskurevisioita tai yllä hyväksyttyä ehjän vanhan `sent`-laskun resend-politiikkaa. |

Selvityseston HTTP-sopimus on `409` ja turvallinen koodi
`INVOICE_LEGACY_DELIVERY_REVIEW_REQUIRED`. Käyttöliittymä valitsee oman
vakioidun ohjetekstinsä täsmällisestä status-/koodiparista, ei backendin
raakaviestistä. Tavanomainen konfliktipalaute säilyy muille virheille.
Esto tarkistetaan ennen valmistelun sivuvaikutuksia sekä uudelleen omistavan
kirjoitustransaktion sisällä. Se ei tarjoa automaattista vapautusta,
historiatietojen poistoa tai uutta sovitus-/hallintakäyttöliittymää.

Tekninen tapahtuma on nykyinen `invoiceDelivery.prepareBlocked`: sama
turvallinen koodi, `stage=prepare`, `retryable=false`, `sideEffectState=none`.
Se ei ole SMTP-providerin epäonnistuminen. Diagnostics ja tukipaketin
varoitusprojektio lukevat tapahtuman; tavallinen business-selvitysvaroitus
ei kuulu nykyisen politiikan pitkän ajan error/security-incident-indeksiin
eikä muuta business-auditia tai Activityä. Lokitusvirhe ei korvaa estoa.

Migraation säilyvät rajat:

- Uudet ja uudelleenhyväksytyt laskut saavat uuden pysyvän revision; vanhan
  rivin metadatamerkintä ei väitä jälkikäteen todistettua toimitushistoriaa.
- Vanha hyväksytty lasku ilman ulkoisen SMTP-toimituksen historiaa voidaan
  siirtää uuteen sidontaan generoimalla PDF nykyisestä snapshotista hallitusti
  ennen uutta lähetystä. Se ei muuta laskunumeroa tai laskun rahasummia.
  Vanhaa cache-PDF:ää ei merkitä oikeaksi vain siksi, että sen byte-hash täsmää.
  Korvaus vaatii todennetun palautumiskopion ja ehjän uuden artifactin;
  mitään PDF:ää ei ylikirjoiteta migraation sivuvaikutuksena.
- Vanha ulkoinen toimitushistoria ja PDF säilyvät muuttamattomina.
  Yllä oleva resend-vaihtoehto ei luo puuttuvia vanhoja revisioita, korjaa
  vanhoja tapahtumia tai estä lukemista. Aikaisempi blanket-esto ei ole
  hyväksytty toteutussuunta. Sen sijaan yllä rajattu uusi legacy-haara on
  hyväksytty. Sen jäljelle jäävä riski on, ettei vanhan
  toimituksen sisältöä voida todistaa edes ehjän nykyisen PDF:n avulla.
- Vanhan historian luku ei heikennä backupin hash-, tyyppi-, containment-,
  identiteetti- tai puuttuvan artifactin tarkistuksia. Jos nykyistä
  backup-formaattia ei voida käyttää uuden catalogin kanssa, formaattimuutos
  palautuu päätökseen ennen koodausta. Tässä ei hyväksytä K-paketin ratkaisua.

R08:n nykyinen ryhmäpyöristys ja kumulatiivinen laskentasääntö säilyvät.
Uusia verosääntöjä tai historiallisten hyvitysten korjausajoa ei ehdoteta.
Jos snapshotin summat ovat keskenään ristiriitaiset, niitä ei kirjoiteta
hiljaisesti uusiksi. R12/R13 säilyttävät nykyiset SMTP-aika-, koko- ja
protokollarajat; ei uusia yhteysyrityksiä tai rajojen kasvattamista.

<a id="m1-source-preparation-l7966"></a>

### B3/B4: tietomalli, portit ja migraatiojärjestys

**Suunnittelusopimus, ei toteutusnäyttö.** Omistajuus säilyy Invoicingissa.
Alla olevat relaatiot kuvaavat rajatun toteutuksen vastuut; tarkka DDL,
kenttäkohtainen snapshot-mapper ja muutosdiff katselmoidaan ennen käyttöönottoa.
Uutta yleistä historiamoduulia tai repository-kehystä ei perusteta.

| Tallennettava kokonaisuus | Omistettu sisältö ja ehto |
| --- | --- |
| Laskun muuttumaton sisältörevisio ja sen rivit | Yritys-, lasku- ja revisioidentiteetti, hyväksynnän sisältösnapshot ja lasketut rahasummat. Snapshot erotetaan elävästä maksu-/toimitus-/peruutustilasta. Julkaistua sisältöä ei päivitetä paikallaan. |
| Nykyisen revision viite | Yksi laskukohtainen viite; komposiittinen yritys-/laskuraja estää vieraan revision valinnan. Viitteen, nykytilan projektion ja auditin kirjoitus kuuluu samaan hyväksyntätransaktioon. Reopened-tilassa vanha hyväksyntärevisio on historiaa, ei kelvollinen nykyinen lähetyskohde. |
| Dokumentti ja sen sisältösidonta | Säilytetään `invoice_documents` dokumentti-identiteetin omistajana. Nykyinen yhden PDF:n laskukohtainen unique-raja korvataan revisiokohtaisella ehdolla. Uudella dokumentilla on oma storage-polku ja joko varmennetun revision sidos tai eksplisiittinen säilytetyn legacy-artifactin alkuperä. Pelkkä puuttuva revisio ei valitse legacy-haaraa. |
| Toimituksen pysyvä varaus ja lopputulos | Yritys/lasku, dokumentti, sidontavariantti ja customer/test-moodi tallentuvat ennen ulkoista kutsua. Uusi tiukka sidos ja alkuperäinen legacy-tapahtuma erotetaan; vanhoja null-viitteitä tai tuntemattomia moodeja ei täydennetä arvaamalla. |

Nykyisten `invoices`-/rivitietojen säilyttäminen lukuprojektiona ei tarkoita
kahta kirjoittajaa. Hyväksyntä muodostaa yhden validoidun sisältöolion, josta
omistava adapteri kirjoittaa sekä revision että nykyisen projektion saman
transaktion sisällä. Historian luku käyttää revisiota; listat, saatavat ja
maksut käyttävät laskun nykytilaa. Hyvityksen lähderiviviitteet eivät saa
alkaa osoittaa uuden revision eri riveihin. Näiden lukijoiden ja kirjoittajien
tarkka luettelo kuuluu B3:n ensimmäiseen diff-katselmukseen.

Nykyisten porttien rajatut muutokset:

- `InvoiceApprovalRepository`: revision julkaisu sekä reopenin/cancelin
  estot samassa transaktiossa toimitusvarauksen kanssa. Reopen ei enää
  palauta säilytettävän historian tiedostoja poistettavaksi.
- `InvoiceDocumentRepository` ja storage: revisiokohtainen haku, ehdollinen
  julkaisu/mitätöinti ja itsenäisten tavujen kirjoitus. Laskukohtainen
  `deleteDocumentsForInvoice` ei jää uuden historian ohittavaksi poistopoluksi.
- Toimitusrepository ja finalizer: sama varauksen identiteetti kulkee prepare
  -> reserve -> provider -> complete. Asiakaslähetyksen onnistuminen ja
  testilähetyksen onnistuminen säilyvät eri lopputoimina; testi ei käytä
  asiakkaan `sent`-päivitystä. Myös failed/unknown-kuittaus kohdistuu vain
  alkuperäiseen varaukseen. Nykyisen manuaalisen toimituksen atominen
  event/tila/audit-kirjoitus ja unresolved-esto säilyvät.
- Historialuku tarvitsee yritysrajatun laskuidentiteetin myös reopened-
  tilassa. Nykyinen `listInvoiceDeliveryEvents` tarkistaa
  `ApprovedInvoiceReader`-lukijalla vain approved/sent/cancelled-laskut;
  sitä ei laajenneta globaalisti keskeneräisten laskujen lähetyskelpoisuudeksi.
  Rajattu historian lukija ja tapahtumaan sidottu PDF-luku pitävät omat
  permission- ja yritysrajansa. Nykyinen toimitushistorian `sendInvoices`-
  tarkistus ei poistu. PDF-luku ei generoi puuttuvaa historiallista PDF:ää.

Backup-yhteensopivuuden tarkistus tukee **nykyisen salatun containerin,
manifestin ja `snapshot-catalog-v1.json`-esityksen säilyttämistä**. Tiedoston
looginen nimi johdetaan document-ID:stä, ei invoice-ID:stä; useita saman
laskun PDF:iä voidaan siten luetteloida muuttamatta envelopea. Dokumenttityyppi
säilyy `approved_invoice_pdf`: revision tai legacy-alkuperän ero kuuluu
SQLite-sidontaan, ei uudeksi katalogin dokumenttityypiksi.

Katalogin tarkat kentät ja rajat säilyvät. Invoicingin
`SqliteInvoiceBackupArtifactCatalog` tarkistaa oman moduulinsa uuden
viiteketjun ja luettelee kaikki auktoritatiiviset dokumentit, ei vain current-
PDF:ää. `validateProfileArtifactCatalog` ja aktiivisen profiilin validointi
käyttävät tätä omistavaa sopimusta; yleinen backup-kerros ei kopioi moduulin
SQL:ää. Tarkistus erottaa varmennetun revision, alkuperäisen legacy-rivin ja
siitä uuden vahvistuksen yhteydessä säilytetyn artifactin. Tiukkoja parser-
avaimia tai katalogin formaattiversiota ei muuteta tämän suunnan perusteella.
Uudet sarakkeet ovat DB-skeemamuutos, eivät salausformaatin muutos.

Migraation ja palautuksen järjestys:

1. Varmennetaan lähtöskeema ja nykyinen pre-migration-palautuspiste.
   Lisätään vain uusia järjestysnumeroituja migraatioita; julkaistujen SQL-
   tiedostojen tavut, migraatioketju ja hyväksytty metadataa edeltävä ankkuri
   säilyvät. Tarkka seuraava numero varmistetaan toteutuspreflightissa.
2. Luodaan sisältöhistoria ja tiukat sidonnat omistavan migraatiomallin
   mukaisesti. Säilytetään alkuperäiset ID:t, snapshot-arvot, tapahtumat ja
   null-viitteet. Tarvittava `invoice_documents`-taulun rajattu muutos
   ei saa toteuttaa `ON DELETE SET NULL` -sivuvaikutusta vanhoille toimituksille.
   Foreign key -tarkistus ja tapahtumaviitteiden täsmävertailu vaaditaan.
3. Migraatio ei tee PDF-renderöintiä, tiedosto- tai verkkotoimia eikä lisää
   dokumenttiriviä ilman olemassa olevia tavuja. Vanhasta nykytilasta kopioitu
   sisältö merkitään alkuperältään erotettavaksi: se ei todista vanhan PDF:n
   vastaavuutta tai vanhan lähetyksen sisältöä. Uusi legacy-kopio syntyy vasta
   hyväksytyssä prepare-polussa, ei SQL-migraation sivuvaikutuksena.
4. Backupin staging validoidaan ensin sen tunnetun historiallisen skeeman
   mukaan. Migroinnin jälkeinen tarkistus vertaa alkuperäistä katalogia myös
   uuteen DB:hen; siksi vanhat document-ID:t, polut, hashit ja koot eivät
   vaihdu migraatiossa. Uuden skeeman puuttuva sidos on virhe, ei lupa pudota
   historialliseen validatoriin. Yksi omistava skeemakohtainen tarkistus
   palvelee katalogia, restorea ja aktiivisen profiilin validointia.
5. Ennen hyväksyntää todennetaan vanha backup -> migrate -> materialize ->
   restart sekä uusi moniversioinen backup -> inspect -> restore -> restart
   -> compare. Katkos ei jätä puolta historiaa käyttöön. Paluu käyttää
   palautuspistettä, ei reverse-migraatiota tai vanhaa binaaria uuden DB:n päällä.

Tämä ei ole todennettu formaattimuunnos: lopullinen näyttö tulee B5:ssä.
Jos toteutus tarvitsee uusia serialisoituja katalogikenttiä, dokumenttityypin,
muuttuvia vanhoja polkuja, suurempia rajoja tai uutta yhteensopivuuspoikkeusta,
se palautuu erilliseen päätökseen. Muistissa olevat tokenit, lokit tai
valinnainen PDF-arkisto eivät korvaa pysyvää sidontaa tai backup-sisältöä.

<a id="m1-source-preparation-l8060"></a>

### Toteutuspalat ja hyväksyntänäyttö

| Järjestys | Omistettu muutos | Vaadittu näyttö |
| --- | --- | --- |
| B1: SMTP | R13:n riviparseri, sitten R12:n DATA-kuittaus ja niiden provider-kytkentä. | Samat tavut yhtenä chunkkina, riveittäin, tavuittain ja jokaisessa kahden osan katkaisukohdassa; CR/LF-, rivi-/kokonaisrajan ja keskeneräisen syötteen vastakontrollit. Lopullinen 250 ennen deadlinea ja QUITin alussa kulunut aika, synkroninen heitto ja Promise-hylkäys. Kielteinen tai kadonnut DATA-kuittaus ei muutu onnistumiseksi; yksi DATA, bounded cleanup ja puskurien nollaus. |
| B2: hyvitys | R08:n alkuperäisen ALV-kapasiteetin laskenta nykyisestä snapshotista samalla net/gross-ryhmäperiaatteella kuin laskulla. | Pienet rivit ja pyöristyseron molemmat suunnat, useat ALV-ryhmät, alennukset, täysi hyvitys ja osahyvitysten viimeiset sentit. Määrä-/summaylitys, väärä kanta ja safe-integer-rajat. Oikean standardilaskennan snapshot -> hyvitysluonnos -> atominen hyväksyntä ja rollback-/yritysrajat. |
| B3: revisio ja PDF | B-P1:n hyväksytty revisiosidonta ja B-P2:n toimitushistorian valmisteltu tietomalli; revision omistama PDF, ehdollinen julkaisu/uudelleenkäyttö ja cache-mitätöinti. B-P3:n legacy-haara vain sen hyväksytyn sopimuksen mukaan. | Renderöinnin ja reopen/reapprove/cancelin molemmat järjestykset. Kaksi kirjoittajaa, julkaisuvirhe, omistetun tiedoston siivous, nykyisen PDF:n säilyminen ja restart. Vanha cache-luku odottaa uuden revision/PDF:n julkaisun yli ja epäonnistuu: uuden dokumentin metadata, tavut ja toimitussidonta säilyvät. Todellinen hash/koko tarkistetaan luetuista lähetys- ja esikatselutavuista, ei vain metadatasta. |
| B4: toimituksen elinkaari | B-P2:n historian säilyttävä reopen, atominen varaus, täsmällinen finalizer ja epävarman tilan säilyminen; hyväksytyn B-P3:n rajattu resend ilman takautuvaa historian muuttamista. | Fake-providerin hallitut välivaiheet: cancel/reopen ennen varausta ja varauksen jälkeen, vanha native-token, rinnakkaiset yritykset, customer/test/dry-run, lopullisen 250:n jälkeen epäonnistuva DB-kirjoitus ja toistettu kuittaus. Restart ennen ja jälkeen providerin; ei automaattista uudelleenlähetystä tai väärän revision `sent`-merkintää. |
| B5: kokonaisuuden hyväksyntä | Tuotannon composition, käyttäjäpolut, palautettavuus ja ohjeet. | Synteettinen approve -> PDF -> native-vahvistus -> fake SMTP -> delivery/sent-jälkiluku, estot ja turvalliset ilmoitukset. Hardened Windows backup -> inspect -> restore -> restart -> compare myös usealla saman laskun versiolla, legacy-artifactilla ja alkuperäisillä PDF-tavuilla; historian migraatio- ja katkeamiskohdat sekä uuden jäädytetyn revision normaalit PR/main-portit. |

B1 ja B2 ovat itsenäisiä korjauspaloja. B3 ja B4 suunnitellaan yhtenä
eheänä sopimuksena ja toteutetaan sisäisesti pieninä muutoksina: puolitettua
revisiosidontaa ei julkaista valmiina korjauksena. SQL-transaktioon ei tehdä
verkko- tai tiedosto-`await`-kutsua. Jokainen pala alkaa tuoreella preflightilla;
tarkka tiedostolista, migraatiojärjestys ja omistavien ohjeiden täsmennykset
lukitaan ennen sen toteutusta. B1/B2 ei sulje S030-03/04/05:a.

B-P2/P3:n lisättyjen polkujen hyväksyntätapaukset:

- Testi-SMTP onnistuu revisiolle A -> reopen -> muutos -> reapprove B ->
  asiakaslähetys B. A:n snapshot, rivit ja tapahtuma säilyvät sisältövertailussa
  ja PDF byte-vertailussa; lasku-ID ja numero eivät vaihdu. A:n vanha token hylätään ja
  asiakaslähetys merkitsee vain B:n nykyisen laskun `sent`-tilaan.
- Maksut, saatavat, listat ja hyvityskatot eivät monistu versiomäärän mukana.
  Tilapäivitys ei muuta historiallista sisältöä. Historiallinen PDF-luku
  noudattaa samoja permission-/yritysrajoja kuin nykyisen laskun luku.
  Toimitustapahtuma ja sen säilynyt PDF ovat luettavissa myös reopenin
  aikana; tämä ei tee luonnoksesta tai vanhasta versiosta lähetyskelpoista.
- Hyväksytty legacy-resend lähettää täsmälleen tarkistetut säilyneet tavut
  ja jättää laskun nykyisen snapshotin ja alkuperäisen historian ennalleen.
  Katkennut viite, hash-virhe, puuttuva tiedosto ja tunnettu R02/R12-ristiriita
  hylätään ilman regenerointia tai provider-kutsua. UI ei voi nimetä uutta
  laskua legacyksi. Uuden historian puutteellinen revision kenttä ei putoa
  legacy-haaraan.
- Prepare/send-vaihdos, native-peruutus, vanha/käytetty token ja lopullisen
  SMTP-hyväksynnän jälkeen epäonnistuva finalizer säilyttävät oikean artifactin
  ja toimitusyrityksen sidonnan. Valmistelussa kaatuneen kopioinnin oma julkaisematon tiedosto
  voidaan siivota; katalogoitua tai varattua historiaa ei hävitetä.
- Migraatio ja palautus kattavat vanhan current-PDF:n, usean revision,
  legacy-variantin, katkenneen toimitusviitteen ja uuden unresolved-varauksen.
  Vanhan formaatin sallittu null-viite ei löysennä uuden sidonnan vaatimuksia.
  Varmennetut lukijat erottavat vanhan datan yhteensopivuuden uudesta
  viitevirheestä. Katkaistu migraatio ei jätä puoliksi siirrettyä historiaa.

Nykyiset unit-/repository-/fake-provider-testit todistavat järjestykset
ilman kiinteitä unia. Edustavat oikean HTTP-/UI-/native-rajan ketjut lisätään
nykyisiin kolmeen E2E-fixtureen ja [R0-matriisiin](r0-e2e-test-matrix.md#invoicing).
Ei oikeaa sähköpostipalvelinta, käyttäjädataa tai uutta prosessihallintaa.
Hash, metadata ja pysyvä business-tila tarkistetaan, ei vain UI-viesti.
Testin ajokytkentä ja todellinen läpäisy todistetaan erikseen.

<a id="m1-source-preparation-l8111"></a>

### Palaute, diagnostiikka ja palautettavuus

- Tunnettu ristiriita kertoo turvallisesti, että lasku muuttui tai toimitus
  on selvitettävä. API-clientin strict-sopimus, suomenkielinen UI ja busy-tila
  vastaavat samaa tulosta. Vanha esikatselu tai vahvistus ei valtuuta muuttunutta
  kohdetta. Virheviesti ei paljasta polkuja, tarpeettomia vastaanottajatietoja
  tai raw-provider-virhettä; vahvistuksen tarkoituksellinen vastaanottajan
  tarkistaminen säilyy.
- Toimitustapahtuma ja business-audit säilyttävät oman auktoritatiivisen
  sisältönsä transaktion kanssa. Tekniseen lokiin lisätään vain tarvittava
  sallittu vaihe/syy; lasku-, dokumentti- tai vastaanottajatiedot eivät tule
  diagnostiikkaan tai tukipakettiin. Jokaisen uuden tapahtuman Activity-,
  Diagnostics-, tukipaketti- ja incident-sopivuus päätetään erikseen ja oikea
  writer -> reader -> projektio -kytkentä testataan. Ei uutta loggeria.
- Muuttuvat snapshot-, catalog- ja restore-invariantit päivitetään Invoicingin
  ohjeeseen, backup-artifact-inventaarioon ja moduulien integraatiomatriisiin
  toteutuksen mukana. Julkaisematon temp-PDF ei ole auktoritatiivinen backup;
  toimitustodisteeksi säilytettävä PDF ei saa jäädä orvoksi catalogin ulkopuolelle.
- Uusi schema vaatii uusia migraatioita sekä nykyisen pre-migration-
  palautuspisteen. Epäonnistuminen palautuu nykyisellä profile-recoveryllä,
  ei reverse-SQL:llä. Vanhaa binaaria ei avata uuden scheman päälle.
  Installer-päivitys ja rollback säilyttävät omat hyväksyntäporttinsa.
- Paikallinen palautuspiste ei peru jo lähtenyttä sähköpostia. Palautuksessa
  säilyvä epävarmuus ja ulkoinen sivuvaikutus kerrotaan recovery-ohjeessa;
  B ei lupaa SMTP:n exactly-once-toimitusta tai vanhan backupin tietävän
  myöhempien lähetysten tilaa.

Ensivirheiden säilytys ja yksi hallittu uusinta noudattavat nykyistä
[testauskäytäntöä](../ai/testing-rules.md#ensivirhe-uusinta-ja-rajattu-poikkeus).
Tunnettu sisältö-/yritysraja-/toimitusvirhe ei muutu hyväksytyksi uusinnalla.
Salattu tutkimusaineisto ja turvallinen julkinen raportti säilyvät erillisinä;
testialustaa, aikarajoja tai hyväksyntäehtoja ei muuteta B:n takia.

<a id="m1-source-preparation-l8144"></a>

### B0:n jatkamiskohta

Valmistelussa tehtiin lähdevertailu, rajattu SMTP-/hyvityssopimusten tarkistus
ja riippumaton suunnitelmakatselmus. Katselmuksen PDF-cache-metadatan
mitätöintihavainto täsmennettiin sopimukseen ja B3:n testitapaukseen;
täsmennys tarkistettiin uudelleen. Muuttuneiden ohjeiden linkit, ankkurit,
diff-hygienia ja julkaistavan lisäyksen yksityisyys tarkistettiin.
Sovellus- tai CI-testejä ei ajettu eikä tuotantosopimuksia muutettu.
Päätösten jatkovalmistelussa legacy-resendin lähdeketju tarkistettiin erikseen.
Riippumaton B-P2:n suunnitelmakatselmus ei löytänyt suunnittelusuunnan estävää
puutetta; skeeman, lukumallin ja palautuksen toteutusnäyttö jää B3-B5:een.
Omistaja hyväksyi B-P1:n revisiosidonnan ja migraatiot, valitsi B-P2:n
muokkaamisen säilyttävän historian suunnitteluun sekä hyväksyi selvityksen
jälkeen B-P3:n rajatun legacy-uudelleenlähetyksen ilmoitettuine
sisältövarmuuden rajoineen. Näitä kolmea päätöstä ei kysytä uudelleen
muuttumattomalle rajaukselle. Aikaisempaa pysyvää testilähetyksen muokkausestoa
tai yleistä legacy-estomallia ei toteuteta. B3/B4:n schema-/portti-/katalogityö
noudattaa yllä täsmennettyjä omistajuuksia ja migraatiojärjestystä;
toteutuksen diff ja sen testinäyttö katselmoidaan erikseen.
Erillinen backup-lähdetarkistus tuki nykyisen containerin, manifestin ja
katalogiesityksen säilyttämistä. B3/B4:n täsmennetyn sopimuksen riippumaton
katselmus ei löytänyt estävää ristiriitaa. Viitteiden täsmäsäilytys,
varianttien tiukkuus, historialuvun oikeudet ja vanhan/uuden backupin
palautus ovat silti toteutuksen todentamisportteja, eivät tässä läpäistyjä
testejä. Kuuden suunnitteludokumentin lukureitit ja 216 suhteellista
linkkiä/ankkuria tarkistettiin; sovelluskoodia, migraatioita ja CI:tä ei ajettu.
Toteutus alkaa omistajan hyväksymästä palasta; B:n koko valmistuminen vaatii
kaikkien kuuden havaintorivin sopimukset ja B5:n näytön. B0:n hyväksyntä ei
merkitse haavoittuvuuksia korjatuiksi, uutta Deep Scania tehdyksi tai B:tä
valmiiksi. Koko ohjelman katselmus ja myöhempi Deep Scan pysyvät M5:ssä.

<a id="m1-source-preparation-l8175"></a>

### B1/B2: rajattu toteutus

**Omistajan hyväksymä rajaus 4.10.2026; toteutus, katselmus ja integraatio
hyväksytty PR #297:n mainissa 5.10.2026.**
[Rajattu Electron-sulku- ja keräysjatko](release-0.3.0-integration-history.md#m1-source-preparation-l7520)
on myös hyväksytty, eikä B1/B2:ta toteuteta uudelleen.
Tämän toteutuksen lähtökohtana oli PR #294:n main. B0:n kuusi
suunnitteludokumenttia säilyvät suunnittelupohjana, eivät toteutusnäyttönä.

- B1/R13: käsitellään SMTP-vastaus riveinä ja vastauksina riippumatta
  verkkolohkojen rajoista. CRLF-, rivikoko-, vastauskoko- ja tilarajat säilyvät.
- B1/R12: lopullisen DATA-250:n jälkeen QUITin aikarajan laskenta,
  synkroninen virhe, hylätty Promise tai sulkuvirhe eivät kumoa hyväksyntää.
  Sulkuvirhe ei myöskään peitä alkuperäistä hylkäystä tai epäselvää lopputulosta.
  Ei automaattista uudelleenlähetystä tai uutta aikarajaa.
- B2/R08: alkuperäisen laskun ALV-kapasiteetti noudattaa saman laskun
  hyväksyttyä net/gross-ryhmäpyöristystä. Kumulatiiviset katot, ylitysten
  estot ja muuttumattoman hyväksytyn aineiston rajat säilyvät.

Tavallinen käyttäjäpolku, laskun identiteetti ja numerointi eivät muutu.
Ei riippuvuutta, migraatiota, historiallisten summien korjausajoa tai
versiopäivitystä. B3/B4:n revisiohistoria, legacy-resend ja backup-muutokset
eivät kuulu tähän rajaukseen; S030-03/04/05 jäävät avoimiksi.

Hyväksyntä edellyttää yllä B1/B2-taulukossa nimettyjä regressioita, todellista
provider-/repository-kytkentää, diagnostiikka- ja audit-vaikutusarviota,
riippumatonta katselmusta sekä uuden jäädytetyn revision nykyisiä PR/main-
portteja. Paikallinen läpäisy ei vielä sulje integraatiota. Virheiden
turvalliset koodit, nykyinen tapahtumien lukuketju ja ensimmäinen
epäonnistuminen säilytetään; uutta yleistä lokitusjärjestelmää ei lisätä.

Toteutuksen checkpoint ennen integraatiota:

- SMTP:n parseri-, session-, provider- ja connection-kytkennän regressiot
  läpäisivät. Mukana ovat jokainen kaksiosainen lohkoraja, tavukohtainen
  syöte, keskeneräisen liian pitkän syötteen välitön hylkäys sekä oikean
  connection-ajastimen läpi päättyvä vastaamaton QUIT. Testit eivät lähetä
  oikeaa sähköpostia.
- Hyvityksen 36 domain-/SQLite-testiä läpäisivät. Näyttö kattaa oikean
  standardilaskennan, tallennetun hyväksytyn snapshotin, hyvitysluonnoksen,
  atomisen hyväksynnän sekä audit-rollbackin ja yritysrajauksen.
- Työtilan testit, tyyppitarkistus ja backend-build läpäisivät checkpointissa.
  Kahdeksaa ennestään ohitettua testiä ei lasketa läpäisyiksi. Katselmuksen
  kaksi myöhempää testitäydennystä ja backendin tyyppitarkistus läpäisivät
  erikseen; lopullisen revision CI on edelleen oma porttinsa.
- Tuotantodiffin riippumaton B1/B2-katselmus ei löytänyt korjattavaa.
  Turvalliset virhekoodit ja providerin nykyinen onnistumis-/virheketju
  säilyvät. Lopullisen DATA-hyväksynnän jälkeinen sulku ei tuota väärää
  lähetysvirhettä. Hyvityksen nykyinen atominen audit säilyy.
- Käyttäjän lomakkeet, API-sopimukset, permissionit, yritysrajaus ja
  numerointisäännöt eivät muutu. Uutta pysyvää artifactia, backup-formaattia,
  migraatiota tai diagnostiikkatapahtumaa ei lisätä. Nykyiset palautus- ja
  paketointiportit säilyvät normaaleina integraation vaatimuksina.

Ensivirheiden aineisto säilytetään. Kaksi uusien testien fixture-/raja-arvon
virhettä korjattiin testikoodissa; tuotannon rajoja ei lievennetty niiden
läpäisemiseksi. Lopullinen integraationäyttö sidotaan PR:n lähteeseen,
testattuun merge-checkoutiin ja mainin omiin tarkistuksiin.

**Erillinen jatkohavainto, ei B2:n korjausväite:** hyväksytyn laskun raaka
ALV-lukuprojektio ja sovelluskerroksen normalisointi eivät ole sama sopimus.
Tavallisen laskun ja osahyvityksen vaikutus on tarkennettu alla B3:n
valmistelussa. B2:n hyväksyntä ei sulje tätä havaintoa.

<a id="m1-source-preparation-l8239"></a>

### B3-B5: toteutusvalmistelu

**Aloitettu 5.10.2026 hyväksytystä mainista; tekninen toteutusehdotus on
katselmoitu ja numeroitu migraatio on työpuussa, ei vielä korjauksen hyväksyntä.**
Yksi alla nimetty vanhan aineiston toimintapäätös on edelleen avoin.
Omistajan hyväksymä jatko kattaa yllä olevan
B0/B-P1/B-P2/B-P3-sopimuksen. Valmistelu ei avaa uutta testialustatyötä tai
muuta vanhan skannauksen `canceled`-tilaa. Alkuperäiset seitsemän B:hen
kuuluvaa skannerihavaintoa korjausehdotuksineen on luettu säilyneestä
aineistosta; alkuperäistä R02-katselmusta ja nykyisiä toteutuspolkuja
verrataan niihin. Staattista havaintoa ei nimetä uudeksi runtime-toistoksi.

<a id="m1-source-preparation-l8251"></a>

#### ALV-lukupolun tarkennus

Kaksi rajattua synteettistä lähtötilan koetta erottavat seuraavat tapaukset.
Ne ovat virheen/lukupolun toiston näyttöä, eivät korjauksen läpäisyjä.

- `approvedInvoiceReadModelMapping.ts` summaa tallennetut riviverot.
  Tavallisen laskun auktoritatiivinen loppusumma on ryhmäpyöristetty, joten
  raaka erittely voi poiketa siitä. `getApprovedInvoice.ts` ja uuden PDF:n
  `generateApprovedInvoicePdfDocument.ts` kuitenkin käyttävät
  `withCalculatedApprovedInvoiceVatBreakdown`-normalisointia. Koe vahvisti
  tavallisen laskun sovellusvastauksen ja PDF-renderöijän syötteen oikeaksi.
  Pelkkä raaka lukija ei siten todista tavallisen käyttöliittymän tai PDF:n
  näkyvää pyöristysvirhettä.
- Sama normalisointi pyöristää myös osahyvityksen uudelleen tavallisen
  laskun säännöllä. Nykyinen hyväksytty hyvityslaskenta on kumulatiivinen:
  viimeisen osahyvityksen erittelyn pitää säilyttää sille kohdistetut sentit.
  Koe toisti sovellusvastauksen ja uuden PDF-renderöijän syötteen
  ristiriidan, vaikka tallennettu laskutason loppusumma pysyy oikeana.
  Se käytti olemassa olevaa laskentaa ja oikeita application-polkuja;
  hyvityksen koko hyväksyntätransaktio, HTTP/UI ja lopullinen PDF eivät
  vielä olleet tämän kokeen todennuskohteita.

Jatkokoe käytti oikeaa standardilaskun hyväksyntää, tallennettua sent-
snapshotia, hyvitysluonnoksen muodostusta ja kahta hyvityshyväksyntää.
Net/gross-senttirajat kahdella ALV-kannalla toistivat erittelyn poikkeaman
sekä `getApprovedInvoice`-vastauksessa että uuden PDF:n renderer-syötteessä.
Tallennetut hyvityssummat kuluttivat alkuperäisen laskun kapasiteetin oikein,
eikä alkuperäislasku muuttunut. Samojen ketjujen virheettömät kontrollit
läpäisivät. Tämä täydentää oikean hyväksyntäketjun näyttöä, mutta ei vielä
todista korjausta, HTTP/UI-kytkentää tai lopullisen PDF:n sisältöä.

Rajattu korjaussopimus: tavallinen lasku käyttää nykyistä net/gross-
ryhmäpyöristystä, hyvitys valmiiksi kumulatiivisesti laskettuja rivejä ja
rakennusalan käännetty ALV tyhjää erittelyä. Näyttö ja uusi revisiosnapshot
eivät saa käyttää eri laskentasääntöjä. Uuteen snapshotiin tallennetaan
hyväksynnässä saatu erittely yhdessä loppusummien kanssa; historiaa ei
normalisoida joka lukukerralla uudelleen. Historiallisia summia tai
säilyneitä PDF:iä ei kirjoiteta hiljaisesti uusiksi. Ristiriitaista vanhaa
sisältöä ei nosteta varmennetuksi uudeksi revisioksi.

**Rajattu laskentakorjaus työpuussa:** `invoiceViewTotals.ts` valitsee
hyvitykselle saman `calculateCreditInvoiceDraft.ts`:n `sumCreditTotals`-
funktion kuin hyväksyntälaskenta. Nykyinen rivien lukuarvovalidointi on
jaettu `calculateInvoiceTotals.ts`:stä muuttamatta sen ehtoja; erittelyä
summattaessa säilyvät kokonaislukurajat ja saman ALV-kannan syöttötilan
yhtenäisyys. Tavallisen laskun ryhmäpyöristys ja käännetyn ALV:n tyhjä
erittely eivät muutu. Pysyviä rivejä, loppusummia tai PDF:iä ei päivitetä.

Oikean hyväksyntäketjun kuusi osahyvityksen rajatapausta hylkäsivät vanhan
lukupolun; net/gross-kontrollit, täyshyvitys, vapaa hyvitysrivi ja käännetty
ALV säilyivät toimivina. Korjauksen jälkeen laskutusmoduulin 793 testiä ja
backendin tyyppitarkistus läpäisivät. Näyttö sisältää virheellisten
lukuarvojen, ylitysten, puuttuvan ALV-kannan ja vanhan PDF:n säilymisen
regressiot sekä oikean SQLite-hyväksyntäketjun application- ja PDF-syötteen.
Laajempi backend-ajo läpäisi 1 473 testiä; viisi nykyistä alustakohtaista
testiä jäi ajon ulkopuolelle eikä ohitusehtoja muutettu. Rajattu riippumaton
suunnitelma- ja koodikatselmus eivät jättäneet avoimia korjaushavaintoja.
PDF-näyttö koskee rendererin syötettä, ei uuden ketjun lopullisen PDF:n
sisältötarkistusta. Mark-sent- ja dry-run-polkujen nykyiset testit läpäisivät,
mutta niiden omat uudet senttirajaregressiot eivät kuulu tähän näyttöön.
Vanha säilynyt PDF voi edelleen sisältää aiemman erittelyn; sitä ei korjata
tämän muutoksen sivuvaikutuksena. Tämä ei ole uuden revisioskeeman,
HTTP/UI-ketjun tai koko B3-B5:n hyväksyntä; PR/main-portit ovat vielä avoinna.

<a id="m1-source-preparation-l8315"></a>

#### Omistava toteutuskartta

Polut alla ovat `apps/backend/src/modules/invoicing`-alueen sisällä, ellei
toisin mainita. Taulukko nimeää nykyiset omistajat, ei uusia yleispalveluja.

| Vastuu | Nykyinen omistaja ja rajattu jatko |
| --- | --- |
| Standardihyväksyntä ja uudelleenhyväksyntä | `infrastructure/sqliteInvoiceApprovalRepository.ts`, `invoiceApprovalPersistenceRows.ts`, `sqliteInvoiceApprovalStatements.ts`: yksi validoitu sisältö, revision/rivien/erittelyn julkaisu samaan numerointi-/audit-transaktioon. |
| Hyvityshyväksyntä | `infrastructure/sqliteInvoiceCreditApprovalRepository.ts`: käytä `calculateCreditInvoiceDraft`- tai reverse-charge-laskennan valmiita rivejä ja erittelyä; ei uutta laskentaa tallennuksen tai lukemisen yhteydessä. |
| Nykyisen sisällön luku | `infrastructure/sqliteApprovedInvoiceReader.ts`, `approvedInvoiceReadModelMapping.ts` ja `domain/invoiceViewTotals.ts`: erota sisältö dynaamisesta maksu-/peruutusprojektiosta ja säilytä tavallisen laskun sekä hyvityksen eri pyöristyssopimukset. |
| PDF | `application/generateApprovedInvoicePdfDocument.ts`, `getApprovedInvoicePdfDocument.ts`, `ports/invoiceDocumentRepository.ts`, `infrastructure/sqliteInvoiceDocumentRepository.ts` ja `localInvoiceDocumentStorage.ts`: revision tarkistus, ehdollinen julkaisu/mitätöinti ja vain oman julkaisemattoman tiedoston siivous. |
| Toimitus ja peruutus | Nykyiset prepare/send-käyttötapaukset, `sqliteInvoiceDeliveryEventRepository.ts` ja sen queries/statements sekä `sqliteInvoiceCorrectionRepository.ts`: sama atominen varausraja ja tarkka finalizer; manuaalinen toimitus, dry-run ja testimoodi tarkistetaan erikseen. |
| Pysyvyys ja palautus | `apps/backend/src/database/schema.ts`, `039_add_invoice_content_revisions.sql` ja `infrastructure/sqliteInvoiceBackupArtifactCatalog.ts`: eksplisiittiset variantit, vanhojen viitteiden täsmäsäilytys ja sama omistava tarkistus katalogissa sekä palautuksessa. Migraatiot 001–038 säilyvät muuttumattomina; uusi 039 on työpuussa, katalogin sovitus ja palautustodistus ovat vielä avoinna. |

Snapshotin kenttäluettelon lähtö on nykyinen `InvoiceTable` ja
`InvoiceLineTable`, ei koko `ApprovedInvoiceView`-API-vastaus. Sisältöön
kuuluvat laskun identiteetti-/numerointisnapshot, asiakas-/myyjä-/vastaanottaja-
snapshotit, päivämäärät, maksuehdot, sisältötekstit, verokäsittely,
suoritusjakso, hyväksyntäaika, rivit ja auktoritatiivinen ALV-erittely sekä
summat. Laskun elävä `status`, `updated_at`, `cancelled_*`,
`cancellation_reason`, `payment_state`, `paid_*` ja `payment_*` eivät kuulu
muuttumattomaan sisältöön. Hyvityksen viittaus ja sen lähderivit sidotaan
alkuperäiseen sisältöön, ei myöhemmin korvattavaan nykytilan riviin.

<a id="m1-source-preparation-l8339"></a>

#### Tietomallin katselmointiehdotus

Alla on V1:n katselmoitu tekninen sopimus. Sen numeroitu 039-toteutus ja
versionoidut constraint-testit on nyt erikseen katselmoitu ja kohdetodennettu
alla kuvatulla näytöllä. **Yhtenäinen sovellusketju ja julkaisu eivät vielä
ole hyväksyttyjä**; migraatiota ei toimiteta ennen kirjoittajien sovitusta
ja palautustodistusta.
Kaikki taulut kuuluvat Invoicingiin. Ei uusia business-moduuleja,
yleiskäyttöistä historia-/lukituspalvelua tai backup-formaatin muutosta.

| Taulu / muutos | Avain, sisältö ja eheysraja |
| --- | --- |
| `invoice_content_revisions` | Opaque `id`; `company_id`, `invoice_id`; `origin` = `approval`, `legacySnapshot` tai `validatedLegacySnapshot`. Unique `(company_id, invoice_id, id)` ja komposiittinen FK saman yrityksen laskuun. Sisältö alla nimetyistä snapshot-kentistä; alkuperä ei ole UI:n antama valinta. Julkaistua revisiota ei päivitetä tai poisteta. |
| `invoice_revision_lines` | PK `(revision_id, line_id)`; unique `(revision_id, line_order)` sekä yritys-/lasku-/revisio-FK. Kaikki nykyisen `InvoiceLineTable`-snapshotin kentät, alkuperäinen `id` nimellä `line_id`. Lisäksi nullable `source_revision_id`, joka lähderivillisellä hyvityksellä sidotaan saman yrityksen hyvitetyn laskun muuttumattomaan lähderiviin. |
| `invoice_revision_vat_breakdown` | PK `(revision_id, vat_rate_basis_points)` sekä yritys-/lasku-/revisio-FK; `net_cents`, `vat_cents`, `gross_cents`. Uudessa hyväksynnässä erittely tulee jo lasketusta tuloksesta. `legacySnapshot` ei saa SQL-migraatiossa keksittyä erittelyä; sen saatavuus erotetaan alkuperällä. Käännetyn ALV:n erittely on tarkoituksellisesti tyhjä. |
| `invoice_current_revisions` | PK `(company_id, invoice_id)` ja `revision_id` komposiittisella FK:lla. Erillinen pieni osoitintaulu välttää koko nykyisen `invoices`-viiteverkon uudelleenluomisen. Hyväksynnän projektiot ja audit sekä osoitin vaihtuvat yhdessä; reopen poistaa vain nykyosoittimen, ei historiaa. |
| `invoice_documents` | Nykyiset kentät/ID:t säilyvät. Lisätään `binding_kind` = `revision`, `legacyOriginal` tai `preservedLegacy`, `revision_id` ja `source_document_id`. Variantin nullability on suljettu CHECK: revision vaatii revision ja kieltää legacy-lähteen; legacyOriginal kieltää molemmat; preservedLegacy vaatii legacy-lähteen ja kieltää revision. Kaikki uudet sidokset ovat komposiittisesti yritys-/laskurajattuja. |
| `invoice_delivery_events` | Nykyiset kentät/ID:t säilyvät. Lisätään pysyvä `send_mode` = `customer`, `smtpTest`, `dryRun`, `manual` tai `legacyUnknown`; `binding_kind`, `revision_id` ja varauksen dokumenttihash/koko. Uusi tapahtuma vaatii dokumentin ja varianttinsa täsmäsidonnan. Vain migroitu legacyOriginal sallii alkuperäisen puuttuvan dokumenttiviitteen ja legacyUnknown-moodin. |

Komposiitti-FK:iden vanhempien avaimet luodaan ennen riippuvia inserttejä:
`invoices(company_id, id)`, revision `(company_id, invoice_id, id)`,
revision rivin `(company_id, invoice_id, revision_id, line_id)` ja
dokumentin `(company_id, invoice_id, id)` ovat eksplisiittisiä UNIQUE-avaimia.
Pelkkä globaali `id`-PK ei riitä SQLiteen monisarakkeisen FK:n vanhemmaksi.
Dokumentin varianttia/revisiota sisältäville täsmäviitteille määritetään
vastaavat omat unique-avaimet. Nullable revision ei saa poistaa erillistä
ei-nullable yritys-/lasku-/dokumenttiviitettä. Tämä oli rajatun riippumattoman
skeemakatselmuksen täsmennys; lopullinen SQL tarkistetaan vielä erikseen.

Nykyinen `invoice_lines.id` voi tulla samasta luonnosrivistä uudelleenhyväksyntään.
Siksi historian PK ei saa olla pelkkä nykyinen line-ID. Nykyistä source-line-
FK:ta ja hyvitysten kapasiteettilukijaa ei poisteta tai kohdisteta uuteen
nykytilan riviin. Uusi lähdesidos tarkistetaan erikseen revision kautta;
vapaan hyvitysrivin lähde-ID ja lähderevisio ovat molemmat null.

Vanhan sent-standardilaskun hyvityksen lähde voi olla eksplisiittinen
`legacySnapshot` säilyneestä nykytilasta. Nykyinen yritys-/standard-/sent-
kelpoisuus, aikaisemmat kohdistukset ja kumulatiivinen laskenta säilyvät.
Tämä ei nosta lähdettä varmennetuksi toimitusrevisioksi, varmista vanhaa
PDF:ää, salli uudelleenlähetystä tai ratkaise tuntematonta SMTP-moodia.
Dokumentin julkaisuun vaadittavaa alkuperärajausta ei siis kopioida
hyvityksen lähdekelpoisuudeksi. Lähderevision ja sen rivin täsmäsidos sekä
nykyinen laskentavalidointi todistetaan täydessä snapshot-testissä.

Snapshot-mapper on nimetty, eksplisiittinen kenttäluettelo. SQL:n `SELECT *`
tai koko API-olion serialisointi ei määrittele julkaistun sisällön sopimusta.
Nykyisen `InvoiceTable`-tyypin säilytettävät kenttäryhmät ovat:

- `source_draft_id`, `invoice_kind`, `credited_invoice_id`, `invoice_number`,
  `reference_number`, `reference_number_type`, `series_key`, `sequence_scope`,
  `sequence_number`, `numbering_mode`, `customer_id`, `billing_recipient_customer_id`.
- Kaikki nykyiset `customer_*_snapshot`, `company_*_snapshot` ja
  `billing_recipient_*_snapshot`-kentät. Ne kopioidaan hyväksynnän jo
  muodostamasta oliosta, ei uudella master-data-haulla revision kirjoituksessa.
- `invoice_date`, `due_date`, `payment_term_days`, `reminder_period_days`,
  `late_payment_interest_basis_points`, `price_input_mode`, `subject`,
  `order_number`, `note`, `delivery_address_text`, `refund_iban_snapshot`.
- `tax_treatment`, `tax_treatment_label_snapshot`, `tax_legal_basis_snapshot`,
  `performance_date`, `performance_period_start`, `performance_period_end`,
  `total_net_cents`, `total_vat_cents`, `total_gross_cents`, `created_at`, `approved_at`.
- Hyvityksen `credited_invoice_number_snapshot` ja
  `credited_invoice_date_snapshot` sekä `credited_revision_id` otetaan
  samasta tarkistetusta lähderevisiosta. Historia ei tee myöhempää elävää
  lähdelaskuliitosta PDF:ään. Legacy-kopio merkitsee vain migraatiossa
  säilyneen nykytilan; sillä ei todisteta aiempaa lähetyssisältöä.

ID- ja enumerointikentät, nullable-parit, positiiviset järjestysnumerot,
safe-integer-rahat ja määrärajat tarkistetaan sekä omistavassa mapperissa
että soveltuvissa DB-ehdoissa. Uuden normaalisti verollisen revision
ALV-ryhmien summan on vastattava loppusummia. Käännetyllä ALV:lla erittely
on tyhjä; sen sijaan vaaditaan nollavero ja yhtä suuret net-/gross-summat.
Standardin riviverojen summa ei kuitenkaan ole uusi vaatimus:
sen hyväksytty ryhmäpyöristys säilyy. Muuttumattoman sisällön kirjoitus
keskitetään rajattuun Invoicingin persistence-helperiin; maksu-, listaus- ja
toimitustilan kirjoittajat eivät saa sitä muuttaa.

Kenttäkatselmuksen mukaan nykyinen `InvoiceTable` jakautuu kahteen
identiteettikenttään, 64 sisältökenttään ja yllä nimettyihin 11 elävään
tilakenttään. Kaikki 18 `InvoiceLineTable`-kenttää säilytetään, myös
API-näkymästä puuttuva rivin `created_at`. Mapperin eksplisiittiselle
luettelolle lisätään kattavuustesti, jotta uusi tietokantakenttä ei jää
huomaamatta luokittelematta. Tietokannan null-viitteitä ei korvata API:n
tyhjillä merkkijonoilla. Uudelleenhyväksyntä säilyttää alkuperäisen laskun
`created_at`-ajan, mutta julkaisee uuden hyväksyntäajan ja rivisnapshotin.
Nykyinen reopen/reapprove koskee standardilaskua; tämä työ ei lisää
hyvityslaskulle uutta uudelleenhyväksyntäpolkua.

<a id="m1-source-preparation-l8426"></a>

##### Snapshotin julkaisu ja legacy-kopion SQL-ehdotus

Täyden kenttäjoukon eristetty ehdotus käyttää **header-last-julkaisua**:
rivit ja ALV-erittely lisätään ensin, muuttumaton revision otsikkorivi
viimeisenä ja current-osoitin tämän jälkeen saman nykyisen
hyväksyntätransaktion sisällä. Lapsitaulujen tarkat yritys-/lasku-/revisio-
viitteet ovat paikallisesti `DEFERRABLE INITIALLY DEFERRED`. Ilman otsikkoa
keskeneräinen kokoelma ei voi sitoutua. Otsikon lisäyksessä tarkistetaan
lähderevisio, rivien verokäsittely ja alkuperän mukainen erittelyn valmius.
Otsikon olemassaolo estää myös myöhemmän uuden rivin tai ALV-ryhmän
lisäämisen, ei vain vanhan rivin päivitystä tai poistoa. Erillistä seal-
tilakenttää, yleistä julkaisupalvelua tai uutta globaalia pragmaa ei lisätä.

Uudet muuttumattomat snapshot-taulut sekä uudelleen muodostettavat
dokumentti-/tapahtumataulut määritellään `WITHOUT ROWID`. Tämä sulkee
piilotetun rowid-avaimen kautta tehtävän korvauskäskyn reitin. Se ei korvaa
eksplisiittisten PK-/UNIQUE-ristiriitojen lisäyssuojia. Kielteiset kokeet
toistivat piilotetun rowid-korvauksen sekä riveille ja ALV-ryhmille että
dokumentti- ja tapahtumahistorialle ennen tarkennusta. Nullable-parien
CHECK ei saa hyväksyä osittaista sidosta SQL:n UNKNOWN-tuloksen vuoksi.
Adapterit eivät käytä historian kirjoitukseen REPLACE-käskyjä.

Legacy-kopio nimeää kaikki 64 sisältökenttää ja 18 rivikenttää
eksplisiittisesti. Kenttäkattavuuskoe vertaa luetteloa nykyiseen skeemaan.
Kopio säilyttää alkuperäiset arvot ja nullit, myös rivien aikaleimat;
vanhaa ALV-erittelyä ei lasketa oletuksena uudelleen. Ehdotuksen
`vat_breakdown_state` erottaa `unavailable`-legacy-tiedon uuden revision
`authoritative`-erittelystä. Käännetyn ALV:n tunnetusti tyhjä erittely
kuuluu jälkimmäiseen, ei puuttuvaan tietoon.

Migraation väliaikainen lasku -> opaque revision-ID -kartta poistetaan
samassa transaktiossa. Standardilaskujen otsikot julkaistaan ennen
riippuvia hyvityksiä. Lähdenumero ja -päivämäärä sidotaan samaan yritykseen,
lähdelaskuun ja -revisioon; lähderivillisen hyvityksen kaikki rivit käyttävät
juuri otsikon lähderevisiota. Vanhan rivin puuttuva vanhempi keskeyttää
migraation eikä saa pudota huomaamatta sisäliitoksen ulkopuolelle.
`reopened_for_edit` ei saa current-osoitinta. Vanhan sisällön kopio ei
muuta laskua lähetyskelpoiseksi tai todista aikaisempaa toimitussisältöä.

Ehdotuksen kokeet kattavat täsmäsäilymisen, idempotentin migraatiokutsun,
kokonaisen migraation rollbackin myös metadatakirjoituksen virheessä,
orvoksi jäävän kokoelman commit-hylkäyksen, jälkikäteen lisättävät rivit,
korvauskäskyt, yritys-/lähderevisiorajat sekä normaalin ryhmäpyöristyksen
ja käännetyn ALV:n säilymisen. Suora SQL-koe ei korvaa omistavan mapperin
nykyistä laskentavalidointia, numerointi-/audit-transaktiota, lähetysvarausta,
todellisia PDF-tavuja tai B5:n palautustodistusta. Täydellinen snapshot-DDL
ja aiempi dokumentti-/tapahtumaehdotus ajettiin tässä yhdessä ennen
numeroitua toteutusta. Teknisen kokonaisuuden myöhempi katselmus ei
korvaa alla nimetyn tuotantomigraation omaa näyttöä.

Yhdistetty tarkennettu ehdotus läpäisi 102 kohdetestiä: 43 täyden snapshotin
ja 59 dokumentti-/tapahtumasidoksen testiä. Ei-tyhjä vanha dokumentti- ja
lähetyshistoria säilyi, ja uuden dokumentin/tapahtuman sisältösidos pysyi
vanhassa revisiossa current-osoittimen vaihdon jälkeen. Rajattu riippumaton
SQL-katselmus tarkensi käännetyn ALV:n nykyisten täsmätekstien ja net-
syöttötilan säilyttämistä sekä yritysrajatestin eristystä. Korjattu
yritysrajatesti käyttää olemassa olevaa vieraan yrityksen lähdettä ja
yhtenäistä lähdetuplea, jotta muu ristiriita ei peitä yritysrajan hylkäystä.
Näyttö ei ole oikean lähetysvarauksen, lopullisen mapperin tai koko V1:n
hyväksyntä. Kohdetesteissä ei käytetty oikeaa SMTP:tä tai käyttäjädataa.

**Numeroidun toteutuksen checkpoint:** työpuun
`039_add_invoice_content_revisions.sql` toteuttaa yllä olevan snapshotin,
legacy-kopion sekä dokumentti-/tapahtumasidosten muutoksen nykyisen
migraatiorunnerin transaktiossa. `schema.ts` nimeää sisällön eksplisiittisesti
ja vaatii uudet dokumentti-/tapahtumakentät. Nykyisen migraatiorunnerin ja
39 tiedoston manifestin 17 testiä läpäisivät; vanhan 038-prefiksin pääte
säilyy erikseen tarkistettuna.

Numeroidun SQL-tiedoston 111 regressiota ja nykyisen käynnistystilan
6 tarkistusta läpäisivät yhdessä 117/117. Kuusi rajattua testitiedostoa
käyttää oikeita muuttumattomia 001–038-tiedostoja ja uutta 039:ää nykyisen
runnerin kautta, ei valmistelun yksityistä SQL-ehdotusta. Näyttö kattaa
vanhojen kenttien ja viitteiden täsmäsäilymisen, idempotenssin, virheen
rollbackin, sisältö-/yritys-/lähderevisiorajat, muuttumattomuuden sekä
dokumentti-/tapahtumasidokset. Levyllä olevan synteettisen kannan
sulkeminen ja avaaminen uudelleen säilytti myös moniversioisen sisällön
ja sen suojat. Uuden lähetystapahtuman muutosyritykset kohdistetaan
nimenomaan uuteen riviin, jotta vanhan historian suoja ei peitä niiden
todistusta. Rajattu riippumaton SQL-/tyyppikatselmus ei löytänyt
korjattavaa. Tämä ei vielä ole sovelluksen hyväksyntä-, PDF-, lähetys-
tai paketoidun palautuspolun näyttö.

Nykyiset PDF- ja lähetystapahtuman kirjoittajat sekä yksi niiden vanha
testirivi eivät vielä tuota vaadittuja sidontakenttiä. Backendin
tyyppitarkistus hylkää tämän keskeneräisen sovituksen. Kenttiä ei tehdä
valinnaisiksi eikä legacy-alkuperää keksitä vanhalle kirjoittajalle.
Tyypityksessä jäi vain kolme näihin vanhoihin kirjoittajiin/testiriviin
kohdistuvaa virhettä, ei uusien migraatio- tai hyväksyntätestien virheitä.
Omistavien kirjoitus-/lukupolkujen ja vanhojen fixtureiden yhtenäinen
sovitus on vielä kesken; koko backend-sarjan aiempi läpäisy ei koske tätä
migraatiota sisältävää välitilaa.
Työpuun välitila ei ole itsenäinen julkaisu- tai merge-ehdokas.

**Tavallisen hyväksynnän kirjoituscheckpoint:**
`invoiceContentRevisionPersistenceRows.ts` mapittaa sisältö- ja rivikentät
eksplisiittisesti. `publishInvoiceApprovalRevision.ts` käyttää jo laskettua
ALV-erittelyä muuttamatta sen pyöristystä. `SqliteInvoiceApprovalRepository`
kutsuu kirjoittajaa nykyisen IMMEDIATE-transaktion sisällä sekä uudessa
hyväksynnässä että uudelleenhyväksynnässä. Rivit ja ALV-erittely kirjoitetaan
ennen kokoelman sulkevaa otsaketta, nykyrevisio vasta sen jälkeen.
Auditointi ja luonnoksen hyväksyntäsidos kuuluvat samaan transaktioon.

13 kohdetestiä läpäisivät ensimmäisellä ajolla oikealla 001–039-ketjulla.
Näyttö kattaa 64 sisältökentän ja kaikkien rivikenttien säilymisen,
elävien tila-/maksukenttien poissulun, nullit ja aikaleimat, net/gross-
ryhmäpyöristyksen, käännetyn ALV:n sekä yritysrajan ja tuplahyväksynnän.
Kuusi pakotettua virhettä todistivat uuden hyväksynnän ja uudelleenhyväksynnän
rollbackin revision, auditin ja luonnossidoksen kohdalla. PDF:ttömässä
uudelleenhyväksynnässä vanha revisio ja laskunumero säilyivät, uusi sisältö
sai uuden revision ja nykyrevisio-osoitin siirtyi siihen. Tiedostokannan
uudelleenavaus säilytti sitoutuneen sisällön; rinnakkainen yhteys ei saanut
kirjoituslukkoa snapshotin lukemisen aikana.

Rajattu riippumaton tuotantokatselmus ei löytänyt korjattavaa. Tämä näyttö
ei kata hyvityksen kirjoittajaa, jonka erillinen näyttö on alla, eikä vielä
revision palauttamista sisäiselle PDF-kutsujalle, revision lukijaa,
PDF-/SMTP-historian säilyttävää reopenia, katalogia tai B5:n paketoitua
palautusta. Nykyisen hyväksynnän julkista vastausta ei ole laajennettu
teknisellä revision tunnisteella.

**Hyvityksen revisiosidonnan kirjoituscheckpoint:**
`readCreditInvoiceRevisionSource.ts` tarkistaa nykyisen yritys-/standard-/
sent-kelpoisuuden mutta lukee sisällön ja rivit muuttumattomasta
nykyrevisiosta. `SqliteInvoiceCreditApprovalRepository` säilyttää nykyisen
kumulatiivisen laskennan ja aiempien kohdistusten lukijan. Se julkaisee
hyvityksen revision samalla rajatulla kirjoittajalla samassa IMMEDIATE-
transaktiossa numeron, laskun, rivien, auditin ja luonnoslinkin kanssa.
Hyvityksen lähdelasku, lähderevisio, numero ja päiväys ovat samaa tuplea;
lähderivit sidotaan sen revision rivitunnisteisiin. Vapaalla rivillä
lähde-ID ja lähderevisio ovat null. Eläviä maksu-/tilakenttiä ei kopioida
sisältösnapshotiin. Puuttuva tai ristiriitainen lähderevisio hylätään,
eikä elävää sisältöä käytetä fallbackina.

24 uutta testiä ja kaikki 23 aiempaa hyvityshyväksynnän testiä läpäisivät
yhdessä 47/47. Ensiajon kaksi hylkäystä olivat uusien kielteisten testien
lähtöaineiston CHECK-ristiriitoja ennen varsinaista kutsua; aineiston
korjauksen jälkeen kaikki tapaukset suoritettiin. Testejä tai tietokannan
ehtoja ei poistettu. Näyttö kattaa täydet sisältö-/rivikentät, modernin ja
oikealla 038→039-ketjulla muodostetun legacy-lähteen, saman line-ID:n eri
revision, net/gross-ryhmäpyöristyksen, käännetyn ALV:n, yritys-/lasku-/
revisiorajat sekä revision, auditin ja luonnoslinkin virheiden rollbackin.
Lähteen elävän sisällön muuttaminen luonnoksen jälkeen ei muuttanut
hyvityksen käyttämää snapshotia. Duplikaatti- ja kapasiteettirajat säilyivät;
legacy-toimitushistoriaa tai sen alkuperää ei muutettu.

Nykyisen application-/HTTP-ketjun 19 sopimustestiä läpäisivät erikseen;
niiden porttikorvikkeet eivät todista koko uutta ajonaikaista ketjua.
Rajattu riippumaton tuotantokatselmus ei löytänyt korjattavaa. Lopullisessa
tyypityksessä säilyivät vain yllä nimetyt kolme PDF-/tapahtumakirjoittajien
puutetta, ei uusia hyvityskoodin tai sen testien virheitä. Täsmärevision
lukijan ja hyväksynnän sisäisen paluuarvon myöhempi näyttö on alla;
varsinainen PDF-kytkentä on vielä avoinna.
Osittaista sovitusta ei julkaista eikä puuttuvaa migraatiota kierretä
vanhan kirjoitustavan fallbackilla.

**Täsmärevision lukijan checkpoint:**
`InvoiceContentRevision` ja sen kapea reader-portti erottavat tallennetun
sisällön elävästä laskunäkymästä. SQLite-adapteri lukee pointerin, otsakkeen,
rivit, ALV-erittelyn ja hyvityksen lähdesidokset samassa lukutransaktiossa.
Yritys-/lasku-/revisioavain on täsmällinen; vanhan revision tilalle ei valita
uusinta. Puuttuva scoped-kohde palauttaa undefined, rikkinäinen ei-null-viite
tai sisältö turvallisen `InvoiceContentRevisionIntegrityError`-virheen.
Lukija ei kirjoita, laske summia uudelleen tai käytä elävää master dataa.
Legacy-snapshotin unavailable-erittely säilyy nullina, ei tyhjänä
authoritative-erittelynä.

97/97 kohdetestiä läpäisivät ensimmäisellä ajolla. Ne kattavat kaikki 64
sisältökenttää ja 18 alkuperäistä rivikenttää, lisätyt lähderevisiosidokset,
nullit, net/gross-ryhmäpyöristyksen, käännetyn ALV:n, legacy-summien säilymisen,
yritys-/lasku-/revisiorajat, rikkinäiset viitteet ja arvorajat. Vanha sisältö
säilyi uudelleenhyväksynnän ja oikean tiedostokannan uudelleenavauksen yli;
palautetun olion muokkaus ei muuttanut kantaa tai seuraavaa lukua.
Reopen-testin pointerin poisto on lukijasopimuksen testijärjestely, ei vielä
todiste tulevasta PDF-/SMTP-historian säilyttävästä reopen-käyttöpolusta.

Rajattu riippumaton tuotantokatselmus ei löytänyt korjattavaa. Lopullinen
tyyppitarkistus hylkää edelleen yllä nimetyt kolme vanhaa dokumentti-/
tapahtumakirjoittajien kohtaa, ei uusia lukijan tai sen testien virheitä.
Portti on vielä sisäinen perusta: oikeat PDF-/HTTP-/diagnostiikkakytkennät,
backup-katalogi ja B5:n palautusnäyttö ovat avoinna. Lukija ei itsessään
myönnä katselu- tai lähetysoikeutta eikä luo uutta audit- tai lokijärjestelmää.

**Hyväksynnän sisäisen revisioavaimen checkpoint:**
tavallinen hyväksyntä, uudelleenhyväksyntä ja hyvityshyväksyntä palauttavat
samassa transaktiossa julkaistun revision yritys-/lasku-/revisioavaimen.
Uudelleenhyväksyntä palauttaa alkuperäisen lasku-ID:n, ei kutsun uuden
laskun ID-ehdokasta. Aiempi paluuarvo säilyy sidottuna vanhaan revisioon.
Application välittää avaimen sisäisesti; HTTP-adapterin eksplisiittinen
kenttälista säilyttää vanhan julkisen vastauksen ilman avainta tai muita
sisäisiä lisäkenttiä. Asiakas ei saa valita revisiota hyväksyntäpyynnössä.

Seitsemän application-/HTTP-/SQLite-testitiedoston 132 kohdetestiä
läpäisivät ensimmäisellä ajolla. Näyttö sisältää oikean hyväksynnän ja
uudelleenhyväksynnän avaimen, nykyiset rollback- ja numerointitarkistukset,
hyvityksen lähdesidonnan sekä vastauksen tietovuotosuojan ja syötteen eston.
Koko backendin tyypitys ei vielä läpäise: samat kolme keskeneräistä
dokumentti-/tapahtumakirjoittajien kohtaa säilyvät, uusia tämän palan
tyypitysvirheitä ei löytynyt. Oikea hyväksynnän PDF-hook, ehdollinen
dokumenttijulkaisu, toimitusketju ja B5 eivät kuulu tämän osatodisteen
hyväksyntään. Ei uutta HTTP-pintaa, audit-tapahtumaa, riippuvuutta tai
muutosta käyttöoikeuksiin, numerointiin, laskentaan tai testivaatimuksiin.
Rajattu riippumaton tämän palan tuotantokatselmus ei löytänyt korjattavaa;
se ei hyväksy vielä avoinna olevaa PDF-/toimituskytkentää.

**PDF-sisällön checkpoint:** `ApprovedInvoicePdfContent` rajaa rendererin
nykyisiin snapshot-/rivi-/summakenttiin ilman elävää status-, maksu- tai
peruutustilaa. `toInvoiceRevisionPdfContent` muuntaa lukijan validoiman
authoritative-revision eksplisiittisesti, kopioi alirakenteet ja säilyttää
tallennetut summat sekä hyvityksen lähdenumeron ja -päivän. Muunnos ei
laske ALV:tä uudelleen, hae master dataa tai myönnä julkaisuvaltuutta.
Kelvollinen legacySnapshot/unavailable tuottaa erillisen
`InvoiceRevisionPdfContentUnavailableError`-virheen; sitä ei nimetä
rikkinäiseksi historiaksi eikä korvata tyhjällä erittelyllä. Aidosti
ristiriitainen lähdevariantti on eheysvirhe.

Rendererin ja piirto-osioiden muutos koskee vain tyyppejä. Ulkoasu, tekstit,
muotoilu ja byte-paluu säilyvät. Muuntimen 24, oikean revision-rendererin
5 ja nykyisen rendererin 10 testiä läpäisivät. Uusi PDF-todiste tarkistaa
oikean rendererin tekstikutsut ja syntyvän PDF-rakenteen, ei vielä
tallennettua dokumenttia, koko käyttöpolkua tai visuaalista katselmusta.
Ensimmäinen yhdistetty tyypitys löysi kahden vanhan testifixturen
kontekstuaalisen tyyppipuutteen. Ne korjattiin nimetyillä tyypitetyillä
arvoilla muuttamatta dataa tai odotuksia. Uudet tyypitysvirheet poistuivat;
kolme aiempaa dokumentti-/tapahtumakirjoittajien kohtaa ovat edelleen auki.

Hyväksyntäavaimen ja PDF-sisällön yhdistetyt 171 kohdetestiä läpäisivät.
PDF-sisällön, muuntimen ja rendererin tyyppirajan riippumaton katselmus ei
löytänyt korjattavaa. Se ei ole tallennusketjun tai visuaalisen PDF:n hyväksyntä.
Seuraava työ on nykyisen generaattorin, revisiolukijan, PDF-hookin ja
ehdollisen tiedosto-/metadatajulkaisun yhtenäinen kytkentä. Pelkkä kapeampi
renderer-tyyppi ei poista vanhan generoijan race-/cache-/poistoriskejä.
Reopen, lähetyshistoria, backup-katalogi ja B5:n palautustodistus pysyvät
avoimina; osittaista toteutusta ei julkaista.

**Dokumenttijulkaisun rajattu toteutus:** dokumentin sisäinen tyyppi erottaa
revision, säilytetyn legacy-kopion ja vain luettavan alkuperäisen legacy-
rivin. `InvoiceDocumentRepository` tarjoaa tarkan revision ja dokumentti-ID:n
luvut sekä kaksi erillistä ehdollista julkaisuoperaatiota. Vanhat yleinen
tallennus ja laskukohtainen massapoisto on poistettu tästä portista ja sen
SQLite-adapterista; käyttöpolkujen ja fake-porttien yhtenäinen sovitus on
vielä kesken eikä työpuun tyypitys läpäise.

Revision julkaisu tarkistaa samassa `immediate`-transaktiossa yritys-/lasku-
rajan, nykyrevision, sallitun alkuperän sekä approved/sent-tilan. Tarkistus
edeltää myös aiemman dokumentin palautusta. Säilytetty kopio vaatii sent-tilan,
täsmällisen legacyOriginal-lähteen sekä samat hash/koko-arvot; nykyinen kaikkia
providereita koskeva attempted/outcomeUnknown-esto säilyy. Kumpikaan operaatio
ei korvaa tai poista historiaa. Ne eivät yksin myönnä SMTP-lupaa tai ratkaise
legacy-tapahtumaketjun yksiselitteisyyttä, vanhaa failed/R12-havaintoa tai
silloin avointa approved/SMTP-päätöstä (hyväksytty rajaus yllä 6.10.2026).

Uuden ehdokkaan suhteellinen tiedostopolku kuuluu sen omaan dokumentti-ID:hen.
Omistava tiedostopolitiikka keskittää polun muodostuksen ja nykyisen 10 MiB:n
rajan; uuden metadatan hash, koko ja polku tarkistetaan. Tämä metadatatarkistus
ei vielä todista tiedoston olemassaoloa, exclusive-kirjoitusta tai todellisten
tavujen vastaavuutta. Alla oleva tiedostotallennuksen checkpoint todentaa
näitä erikseen; varsinainen generaattorikytkentä on vielä kesken.

Julkaisuadapterin 42, säilytetyn legacy-dokumentin 23 ja polkusäännön 9
testiä läpäisivät. Näyttö kattaa tarkat sidokset, vanhentuneen julkaisun
eston, nykykelpoisuuden tarkistuksen ennen aiemman voittajan palautusta,
rollbackin, kahden tietokantayhteyden lukituksen sekä tiedostokannan
uudelleenavauksen. Legacy-testin tietokantakopio ei korvaa sovelluksen
backup-/palautus- tai native-todistusta. Todellisia PDF-tavuja ei tässä
adapterikokeessa kirjoiteta tai lueta.

PDF-metadatan molemmat HTTP-vastaukset palauttavat eksplisiittisesti vain
aiemmat julkiset kentät; sisäinen sidos tai ylimääräiset kentät eivät vuoda
vastaukseen. Reittien 10 testiä ja edellä mainitut 74 testiä läpäisivät
yhdessä, yhteensä 84/84. Rajatut repository- ja HTTP-katselmukset eivät
löytäneet korjattavaa. Tyypitys hylkää edelleen vanhat generaattori-/
lukijakutsut ja niiden testikorvikkeet sekä keskeneräisen tapahtumakirjoittajan;
uudet adapteri-, HTTP- ja testitiedostot eivät lisänneet tyypitysvirheitä.
Tämä ei ole koko B3/B4-ketjun hyväksyntä.

**Tiedostotallennuksen rajattu checkpoint:** `InvoiceDocumentStorage`
korvaa vapaan polun write/read/delete-operaatiot kahdella nimetyn vastuun
operaatiolla. `writeCandidate` muodostaa oman dokumentti-ID-polun, kopioi
kutsujan tavut ennen ensimmäistä odotusta ja kirjoittaa exclusive-tilassa.
Paluuarvossa ovat varmennetut polku/koko/tiiviste sekä vain tämän ehdokkaan
`discard`-sulku. Sovellus saa kutsua sitä vain todetusti julkaisemattomalle
ehdokkaalle, ei julkaistulle dokumentille tai epävarman julkaisun jälkeen.
`readVerifiedDocument` lukee metadataa vastaan enimmäiskoon rajaaman
yhden puskurin: tavallinen yksilinkkinen tiedosto, polun sisältävyys,
PDF-tunniste, koko ja SHA-256 vaaditaan. Tarkistus ei ole PDF-parseri tai
allekirjoitus eikä anna toimitusvaltuutta.

Polku- ja tavutarkistukset pysyvät Invoicingin infrastructure-kerroksessa;
portti ei tunne Node-tiedostokahvoja. Siivoussulku tarkistaa oman alkuperäisen
tiedostoidentiteetin ja tavut, eikä tarjoa mielivaltaisen polun poistoa.
Epävarma tai osittainen kirjoitus säilytetään, sitä ei arvata poistettavaksi.
Tiedostotallennuksen 73 kohdetestiä läpäisivät: exclusive-törmäys,
erilliset kirjoittajat, toistettu ja samanaikainen siivous, korvattu tiedosto,
caller-puskurin eristys, tarkka legacy-polku, kokorajat, virheelliset tavut,
symboliset linkit, junctionit, hardlinkit ja hallitut identiteetin vaihdot.
Ensiajon kaksi testijärjestelypuutetta korjattiin muuttamatta tuotantokoodia,
aikarajoja tai hyväksyntäehtoja; alkuperäinen tulos säilytettiin.
Rajattu riippumaton tuotantokatselmus ei löytänyt korjattavaa. Uudessa
tallennuksessa tai sen testeissä ei ole tyyppivirheitä. Backendin tyypitys
hylkää edelleen vanhat sovittamattomat kutsujat ja tapahtumakirjoittajan;
tämä ei ole koko sovelluksen, toimituspolun tai palautuksen hyväksyntä.
Generaattorin jatkokytkentä kuvataan seuraavassa checkpointissa. Lukijoiden
ja reopenin vanhat kutsut sovitetaan tämän jälkeen;
keskeneräistä työpuuta ei julkaista. Katalogi- ja native-palautustodistus
kuuluvat edelleen B5:een.

**Generaattorin ja hyväksyntäkoukkujen rajattu checkpoint:**
`generateInvoiceRevisionPdfDocument` käyttää tarkkaa revisioavainta,
muuttumatonta sisältöä ja tallennusportin todellista tavunäyttöä. Tavallisen
laskun ja hyvityksen production-composition välittävät juuri hyväksytyn
revision; myöhäinen työ ei vaihda kohteekseen uudempaa revisiota.
Manuaalisen generoinnin nykyavaimen valinta käyttää samaa täsmäpolkua.
Ehdollinen julkaisu joko omistaa oman ehdokkaan, palauttaa varmennetun
voittajan tai hylkää vanhentuneen työn. Vain oma varmasti julkaisematon
ehdokas siivotaan; heitetty julkaisupoikkeus säilyttää epävarman aineiston.

Välimuistin tarkistus ei käytä kirjoittavaa julkaisua: uusi kapea
`findCurrentDocumentForRevision` lukee samassa lukutransaktiossa kelpoisuuden
ja dokumentin. Historiallinen `findDocumentForRevision` säilyy erillisenä.
Puuttuvaa tai rikkinäistä PDF:ää ei regeneroida. Julkaisuristiriita palautuu
POST-reitiltä turvallisena 409-virheenä; sisäinen siivoustieto ei tule
HTTP-vastaukseen. Ensisijainen ristiriita ja mahdollinen ehdokkaan
siivousvirhe kirjautuvat nykyisen turvallisen PDF-virheen eri vaiheina.
Jo onnistunut laskuhyväksyntä ei peruunnu PDF-virheeseen.

Generaattorin 50 yksikkötestiä, tietokanta-/tiedosto-/hyvitys-/HTTP-polkujen
91 testiä, oikean hyväksyntä-/PDF-/lokitus-compositionin 7 testiä sekä
nykyisten diagnostiikka-/tukipaketti-/incident-lukijoiden 58 testiä läpäisivät
myös yhdistetyssä lopputarkistuksessa, yhteensä 206/206.
Testijärjestelyjen tavupuskurivertailu, vastauskenttä,
kaksinkertainen lähdeluonnos ja puuttuva nykyinen hyvitysoikeus korjattiin;
ensitulokset säilytettiin eikä tuotannon ehtoja lievennetty.
Riippumaton rajattu tuotantokatselmus ei löytänyt korjattavaa.
Tämän checkpointin tyypitys hylkäsi vielä vanhat PDF-lukijat, reopen-kutsujat,
niiden korvikkeet ja tapahtumakirjoittajan. Lukijoiden jatko kuvataan alla;
tämä ei ole koko B3/B4:n, toimitusten, B5:n tai julkaisun hyväksyntä.

**Nykyisen PDF:n lukuketjun rajattu checkpoint:**
`InvoiceDocumentPreviewReader` valitsee vain yritys-/laskurajatun nykyisen
esikatseludokumentin. Täsmädokumentin `readStoredInvoiceDocument` tarkistaa
metadatan identiteetin ja tallennusportin todelliset tavut; se ei valitse
uusinta versiota eikä anna lähetysvaltuutta. GET ja metadata käyttävät samaa
ketjua ja tarkistavat valinnan uudelleen tavulukemisen jälkeen. Vaihtunut
valinta tuottaa 409:n ilman automaattista uudelleenhakua. Puuttuva valinta
on 404, mutta rikkinäinen valittu viite tai PDF on erillinen eheysvirhe.
Lukeminen ei generoi, korjaa, poista eikä julkaise mitään.

`approved`, `sent` ja `cancelled` säilyttävät esikatselun; reopened-laskun
nykyesikatselu irrotetaan. Eksplisiittinen `legacySnapshot/unavailable`
voi näyttää alkuperäisen legacy-PDF:n ilman jälkikäteistä revisioväitettä.
Säilytettyä toimituskopiota ei valita alkuperäisen sijasta. Uuden revision
puuttuva PDF ei palaudu vanhaan revisioon tai legacy-alkuperäiseen.
Saman dokumentti-ID:n jälkitarkistus perustuu metadatan ja sidoksen
muuttumattomiin SQL-suojiin. Historiallinen tarkka luku ei vaadi nykyistä
kelpoisuutta; tapahtumavalinnan backend-kytkentä on kuvattu seuraavassa
checkpointissa, UI-/native-kytkentä on edelleen jatkotyötä.

Eheysvirhe kytkettiin olemassa olevaan `invoicePdf.storageFailed`-eventtiin
koodilla `INVOICE_PDF_INTEGRITY_FAILED`, vaiheella `read` ja ilman
sivuvaikutusta. Todellinen composition -> lokitiedosto -> Diagnostics ->
tukipaketin lukija / incident-yhteenveto on kohdetodennettu. Projektioissa
ei ole yritys-, lasku- tai dokumenttitunnisteita, PDF-tavuja, tiivisteitä,
polkuja tai raakavirhettä. Lokittajan virhe ei korvaa alkuperäistä virhettä.
Business Activityyn ei tehdä tapahtumaa pelkästä teknisestä lukemisesta.

Nykyisen ja legacy-PDF:n luku, rikkoutunut nykyosoitin, yritysraja,
muuttunut valinta, metadatan ja tiedostojen säilyminen sekä tietokannan
uudelleenavaus läpäisivät oikean SQLite-/tiedostokokeen. Generoinnin,
hyväksyntäkoukkujen, HTTP:n ja diagnostiikan kanssa lopputulos on 269/269.
Uuden testin tavupuskuriodotus ja unionin tyypitys korjattiin; ensitulokset
säilytettiin eikä tarkistusvaatimuksia lievennetty. Riippumaton rajattu
lukuketjun, sen testien ja diagnostiikkakytkennän katselmus ei löytänyt
korjattavaa tai olennaista testivajetta. Koko backendin
tyypitys ei vielä läpäise: kuusi virhettä on vanhassa reopen-kutsuketjussa
ja toimitustapahtuman kirjoittajassa/fixturessa. Tämä checkpoint ei sulje
B3/B4:ää, native-palautusnäyttöä eikä integraatiota.

**Tapahtumaan sidotun PDF-historian backend-checkpoint:**
`InvoiceDeliveryEventReader.findEventDocument` lukee tapahtuman ja tarkan
dokumenttisidoksen samassa SQLite-lukutransaktiossa. Dokumentin nykyinen
metadatan ja lähdeviitteen validointi on yhteinen täsmädokumenttiluvun kanssa.
Revision, sidontatyypin, tallennetun koon tai tiivisteen ristiriita torjutaan
ennen tiedoston lukemista. `legacyMissingDocument` on vain alkuperäisen
legacy-tapahtuman null-viite; katkennut ei-null-viite on eheysvirhe.
Luku ei muuta tapahtumaa, valitse nykyistä PDF:ää tai anna lähetysvaltuutta.

`getInvoiceDeliveryEventPdf` vaatii nykyisen `sendInvoices`-oikeuden ja käyttää
backendin vahvistamaa yrityskontekstia. GET
`/invoices/:id/delivery-events/:eventId/pdf` palauttaa tarkistetut tavut,
puuttuva tapahtuma 404:n, historiallinen null 409:n ja rikkinäinen sidos tai
tiedosto turvallisen 500:n. Vastaus ei palauta tallennuspolkua, raakavirhettä
tai sisäistä metadataa; PDF-vastaus on `no-store`. Historiallinen lukupolku
säilyttää alkuperän eikä väitä vanhan SMTP-toimituksen sisältöä varmaksi.
`listInvoiceDeliveryEvents` käyttää yritysrajattua laskuidentiteettiä myös
reopened-tilassa; yleisen approved-lukijan kelpoisuutta ei laajennettu.

Kohdetodisteet kattavat oikean SQLite-/tiedostopolun, legacy-migraation,
muuttumattomat vanhat sidokset, eri tavuisen uuden PDF:n julkaisun kesken
lukemisen, yritys-/lasku-/tapahtumarajan, tietokannan uudelleenavauksen sekä
todellisen HTTP/composition -> loki -> Diagnostics/tukilukijat-ketjun.
Yhdistetty lopputarkistus läpäisi 359/359 testiä. Riippumaton katselmus ei
löytänyt tuotantovikaa; sen havaitsema eri tavujen kilpailutestin puute
täydennettiin ennen loppuajoa. Uusien fixtureiden kaksi tyypitysvirhettä
korjattiin ja ensitulokset säilytettiin. Jäljellä ovat samat kuusi
keskeneräisen reopen-/tapahtumakirjoittajan tyypitysvirhettä.

Tämä aiempi checkpoint todisti historian backend-lukuosan. Silloin avoimia
varaus- ja reopen-osia tarkentaa alempi checkpoint; client/UI/native-luvun
nykyinen näyttö on seuraavassa osassa. Katalogi-/backup-/restart-ketju on
edelleen avoin. [Testimatriisin historiatapaukset](r0-e2e-test-matrix.md#invoicing)
eivät muutu kokonaan hyväksytyiksi alemman tason näytön perusteella.

<a id="m1-source-preparation-l8839"></a>

### B4-historian käyttöpolun checkpoint

Historian turvallinen projektio erottaa tallennetun lähetysmoodin ja PDF:n
alkuperän. Ristiriitaiset yhdistelmät hylätään; alkuperäiselle legacy-nullille
ei näytetä avauspainiketta. Client, web ja desktop avaavat vain tapahtumaan
sidotun GET-kohteen. Luku ei regeneroi, lähetä tai anna lähetysvaltuutta.
Native-kutsun epäonnistuminen ei siirry selaimen varapolulle.

Testi-/dry-run-toimituksen jälkeen historia päivittyy myös muuttumattomassa
laskutilassa. Laskun ja historian luku sidotaan näkymän valintaan ja
pyyntösukupolveen: myöhäinen vastaus ei korvaa uutta valintaa. Todennetut
vanhan detail-vastauksen sekä StrictMode-aloituksen puutteet korjattiin.
Onnistunut kirjoitus päivittää yhteisen listan, vaikka valinta olisi jo
vaihtunut; vain valintakohtainen vastaus ohitetaan.

Kaksi oikean selaimen testiä todentaa itselle-testin historian, muokkauksen
jälkeiset uudet PDF-tavut, vanhan tapahtuman samat tavut, popupin virheen,
vanhentuneen laskuvastauksen sekä asiakaskortista avaamisen. Erillinen
development-Electron-koe todentaa renderer/main/backend-ketjun, historiallisen
PDF-ikkunan eristyksen ja sulkemisen. Sen aineisto valmistellaan API:n ja
synteettisen SMTP-providerin avulla; se ei ole aidon SMTP:n, legacy-ketjun
tai paketoidun palautuksen todistus. Ensimmäisen native-kokeen testiapuri
tunnisti vain nykyisen PDF:n URL:n, vaikka historiallinen PDF renderöityi.
Apuri käyttää nyt tuotannon kolmea täsmällistä PDF-kohdetta havaintoon ja
sulkemiseen; sallintaa tai aikarajoja ei laajennettu.

Lopullinen kohdenäyttö: laskutus/composition 1 795, koko web 939, desktopin
PDF/protokolla/testiapuri 160 ja clientin kohdesarja 80 testiä läpäisivät.
Selain- ja Electron-kokeet läpäisivät nimettyjen korjausten jälkeen ilman
uusintoja. Kapean ja työpöytänäkymän asettelu tarkistettiin kuvista ja
leveysväitteillä; taulukon vieritys pysyy omassa alueessaan. Riippumaton
rajattu katselmus valmistui. Ensihylkäykset säilyvät omana näyttönään.

Reopened-editorin historia käyttää nyt backendin vahvistamaa yhteyttä
luonnoksesta laskuidentiteettiin; sitä ei päätellä ID:n muodosta tai
käyttöliittymän muistista. Alla oleva jatkotodennus kattaa myös editorin.
Legacy-resendin native-polku on todennettu alla; B5, paketoitu palautus ja
PR/main-portit ovat avoinna.

<a id="m1-source-preparation-l8878"></a>

### B4-legacy-uudelleenlähetyksen checkpoint

Synteettinen 038-profiili sisältää vanhan sent-laskun, alkuperäisen PDF:n ja
SMTP-tapahtuman ilman arvattua lähetysmoodia tai revisiota. Development-
Electronin oikea startup ajaa 039-migraation. Käyttäjä avaa laskun,
valmistelee säilytetyn liitteen, tarkistaa sen native-PDF-ikkunassa ja
hyväksyy tai peruuttaa erillisen vahvistuksen. Vain SMTP-provider ja
käyttöjärjestelmän dialogivastaus ovat testisovittimia.

`DESK-LEGACY-RESEND-001/002` läpäisivät ilman uusintaa: hyväksyntä tekee
yhden lähetyksen ja tapahtuman täsmälleen valittuun säilytettyyn dokumenttiin;
peruutus ei lähetä eikä muuta historiaa. Molemmat polut säilyttävät laskun,
alkuperäisen tapahtuman ja PDF-tavut restartin yli. Tapahtuman pysyvä
dokumentti-/alkuperäsidonta tarkistetaan erikseen vain lukevalla kyselyllä;
public history -projektioon ei lisätä tätä varten kenttiä.

Koe paljasti tuotannon palautepuutteen: desktopin oma turvallinen virhe
käytti `message`-kenttää yhteisen clientin vaatiman `error`-kentän sijasta.
Native-peruutus palauttaa nyt nykyisen HTTP-virhesopimuksen mukaisen viestin.
Tokenia ei luovuteta peruutuksessa eikä raakaa poikkeusta välitetä UI:hin.
Backendin vastaukset kulkevat edelleen muuttumattomina.

Rajatut protokollatestit (34), tietokannan valmistelun sulkutestit (2),
legacy-/lifecycle-sopimustestit (44), koko työpuun tyypitys ja kanoninen
Electron-valmistelu läpäisivät. Myös normaalirevision kaksi native-
vahvistustestiä läpäisivät virhevastauksen korjauksen jälkeen.
Riippumaton katselmus valmistui. Testin
valmistelu sulkee tietokannan virheessä ja säilyttää juuren sekä suljetun
valmisteluvaiheen nykyisessä lifecycle-liitteessä. Ensimmäiset testiaineiston,
projektion ja virhepalautteen hylkäykset säilyvät erillään korjausnäytöstä.

Seuraava työ on B5:n katalogi-, vanhan backupin migraatio- ja hardened
packaged backup/restore/restart/compare -näyttö. Tämä checkpoint ei hyväksy
koko B3/B4/B5-kokonaisuutta tai korvaa vaadittuja PR/main-portteja.

<a id="m1-source-preparation-l8913"></a>

### B5-katalogin ja palautuksen checkpoint

B5:n katalogin valinta ja palautuksen kytkentä ovat työpuussa toteutettuja,
eivät enää pelkkä valmisteluehdotus. Katalogin skeema valitaan tarkistetusta
sovelletusta migraatiohistoriasta. Puuttuva sarake tai SQL-virhe ei salli
legacy-fallbackia. Invoicing tarkistaa myös PDF:tä vailla olevien revisioiden
sekä current/source/document/event-viitteiden eheyden ja luetteloi kaikki
säilytettävät PDF:t. Catalog-v1 ja portable-container säilyvät ennallaan.

Snapshot-katalogi kootaan laiskasti myös ennen migraatioita ja tyhjälle
kannalle. Valinta tehdään maintenance-rajan sisällä samalla ratkaistulla
migraatiohakemistolla kuin runner, myös oletushakemistoa käytettäessä.
Sisäiset tarkistetut migraationimet eivät vuoda strict-startup-viestiin tai
backup-manifestiin. Aktiivisen profiilin historiatarkistus edeltää katalogia.

Workspace candidate tarkistaa lähteen alkuperäisen katalogin ja PDF-tavut
ennen forward-migraatiota. Migraation jälkeen verrataan edelleen samaan
katalogiin ennen yhdenkään PDF:n materiaalistamista. Synteettinen ei-tyhjä
038-profiili on todennettu sekä metadatan kanssa että hyväksytyllä kiinteällä
metadataa vailla olevalla legacy-ankkurilla. Tietokannan uudelleenavaus
säilyttää laskut, rivit, alkuperäiset dokumenttisidokset ja PDF-tavut.

Rajattu nykyinen näyttö:

- Backendin laaja regressio läpäisi 2 730 testiä; viisi alustakohtaista
  ohitusta erotetaan läpäisyistä. Myöhempi oletushakemistokytkennän
  seitsemän testin regressio läpäisi erikseen.
- Workspace-tuonnin ja korvauksen viisi system-API-testiä läpäisivät.
  Testiapurit välittävät tarkistetun skeeman eksplisiittisesti.
- Candidate-operaation sarja läpäisi 30 testiä, yksi alustakohtainen ohitus.
  Se kattaa väärän katalogimäärän, rakenteeltaan kelvollisen väärän source-
  tai restore-viitteen sekä muuttuneen/puuttuvan PDF:n ennen ja jälkeen
  migraation. Kahden PDF:n ehjä kontrolli läpäisee; jälkimmäisen PDF:n virhe
  jättää kohteen tyhjäksi ja tietokannan muuttumattomaksi.
- Katalogin tuotantokytkentä ja rajatut testit on katselmoitu erikseen.
  Ensihylkäykset säilyvät erillään korjauksen jälkeen saadusta näytöstä.

Nykyiseen PDF-smoke-valmisteluun lisätty moniversioinen ketju on todennettu
hardened Windows -kehityspaketilla: saman laskun ensimmäinen PDF ja
verkoton dry-run-tapahtuma, muokkaus ja uudelleenhyväksyntä sekä toinen PDF.
Laskuidentiteetti ja numero säilyivät, PDF:t erosivat ja vanhan tapahtuman
PDF vastasi alkuperäistä. Backup -> inspect -> restore -> restart -> compare
läpäisi nykyisen kannan ja kaikkien katalogiartifaktien tarkan vertailun.
Valmistelun ja palautustilan 13 kohdetestiä sekä desktop-tyypitys läpäisivät.
Tämä ei ole oikean SMTP:n eikä vanhan 038-aineiston paketoitu todiste.

Paketoinnin alkuperäinen sovellusosan kokohylkäys säilytetään erillisenä
ensituloksena. Omistajan hyväksymä vain tämän osan 2,25 MiB:n kokobudjetti
on kuvattu [paketointisopimuksessa](windows-installer-and-update-plan.md#production-profile-and-packaging-cleanliness--checkpoint).
Inventaarion 43 ja paketointiketjun/virhetodisteiden 18 testiä läpäisivät.
Riippumaton rajattu katselmus ei löytänyt korjattavaa; uusi kehityspaketointi
läpäisi sisältöinventaarion ja nykyiset runtime-/kovennustarkistukset.

**Avoin hyväksyntä:** puhtaan revision uusi pakettisisällön baseline,
release-todennus, paketoidun legacy-testin CI-ajokytkentä,
koko B3-B5:n loppukatselmus ja uuden revision PR/main-portit.
Kehityspaketin läpäisy ei korvaa puhtaan releasekandidaatin näyttöä.

Legacy-paketointikokeen syötteelle on erillinen valmis sopimustodiste:
E2E:n olemassa oleva synteettinen 038-laskuprofiili kirjoitetaan nykyisellä
snapshot/container-ketjulla salatuksi varmuuskopioksi. Autentikointi ja
purku todistavat, ettei kantaa ole migroitu valmistelussa, ja että vanha
lähetysmerkintä sekä alkuperäisen PDF:n tavut ovat mukana. Kaksi uutta
valmistelijan ja kolme aiempaa profiilifixturen testiä sekä E2E-tyypitys
läpäisivät. Myös nykyisen workspace-tuonnin ja korvauksen viisi
system-testiä läpäisivät saman apurin nykyisellä oletuksella. Rajattu
riippumaton katselmus ei löytänyt muutoksesta korjattavaa. Väärä salasana
ja puuttuva E2E-merkki hylätään; tavallinen
backup-apuri vaatii edelleen nykyisen skeeman ilman erillistä historiallista
valintaa. Tämä ei käynnistä eikä hyväksy paketoitua legacy-palautusta.

Paketoitu jatko käyttää nykyistä workspace-managementin migraatio- ja
palautusketjua. Pelkkä backupin staging ei migroi kantaa, eikä uuden
työtilan tuonti yksin korvaa saman lineagen korvaus-/palautusnäyttöä.
Koefixturen suljetun lähdekannan valmistelu käyttää vain kolmea itsenäistä
tiedostokopiota uudessa packaged-smoke-juuressa: kanta, alkuperäinen PDF ja
salattu varmuuskopio. Kolme valmistelun sopimustestiä ja viisi aiempaa
legacy-fixturen testiä läpäisivät. Kohdekannan migraatio ei muuta lähteen
038-skeemaa; käytetty tai linkitetty kohde ei ylikirjoitu. Valmistelu ei
kirjoita workspace-rekisteriä käsin tai anna desktopille SQLite-ajurin
omistajuutta. Valmistelutesti yksin ei ole paketoidun palautuksen näyttö.
Uudelleenkäynnistys on todellinen prosessiraja: palautuksen tulosta ei
päätellä relaunch-pyynnön jälkeisestä muistissa olevasta onnistumisesta.

**Paketoitu legacy-jatko:** erillinen nykyistä smoke-ajuria käyttävä koe
läpäisi hardened Windows -kehityspaketilla. Aito 038-backup tarkistettiin ja
palautettiin saman lineagen workspace-management-ketjulla. Seuraava prosessi
vaati oikean replacement-journalin, vertasi suljetun kannan tavut ennen
backendia ja varmisti laskun, alkuperäisen tapahtuman sekä PDF:n. Nykyinen
sessionvaihdon, palautuksessa poistuvan muutoksen, synteettisen salaisuuden
ja toisen backupin tarkistus säilyi. Molemmat 120 sekunnin vaiherajat säilyivät.
Tavallinen moniversioinen smoke läpäisi samalla paketilla erikseen.

Riippumaton katselmus löysi testin sisältövertailun puutteen: migroidun
kannan hash ei yksin todista vanhan liiketoimintasisällön säilymistä. Korjattu
testi vertaa kaikkia alkuperäisiä lasku-, laskurivi-, dokumentti- ja
toimitustapahtumakenttiä ennen hash-sidontaa. Ehjä migraatio ja muuttuneen
historia-aikaleiman hylkäys todennettiin regressiolla; tarkennettu paketoitu
palautus läpäisi. Runtime-/vaihesopimuksen 19, ajurin virhetodisteiden 17
ja inventaarion 43 testiä läpäisivät. Ensimmäinen uuden helperin
nimilistahylkäys säilyy: vain kyseinen tarkka helper sallittiin, ei yleistä
smoke-tiedostojen poikkeusta. Tyypitys sekä ajokytkennän ja turvallisen
raportoinnin 106 sopimustestiä läpäisivät. Riippumaton jatkokatselmus
vahvisti vertailupuutteen korjauksen eikä löytänyt uusia puutteita.
[Ajotapa ja vertailun rajat](e2e-test-environment.md)
eivät muuta tätä kehityspaketin näyttöä puhtaan revision hyväksynnäksi.

<a id="m1-source-preparation-l9020"></a>

### B5-katselmuksen jatkokorjaukset

**Loppukatselmuksen arkistohavainto:** valinnaisen desktop-arkiston lataaja
käytti nykyistä PDF:ää myös `preservedLegacy`-toimituksen tehtävälle, jolloin
eri dokumenttitunniste esti ehjän kopion arkistoinnin. Korjaus sitoo sekä
metadatan että tavujen haun toimitustapahtumaan nykyisen yritys- ja
oikeusrajatun historian lukupalvelulla. Arkistotehtävän tunniste-, koko- ja
tiivistevaatimukset säilyvät; ei fallbackia nykyiseen PDF:ään tai regenerointia.
Toimitus ja auktoritatiivinen PDF eivät peruunnu arkistovirheen vuoksi.
Backendin 37 ja desktop-arkiston 51 regressiota sekä koko työtilan tyypitys
läpäisivät. Viisi development-Electron-koetta todensi legacy-lähetyksen
oikean arkistokopion ja peruutuksen sekä arkiston virhe-, palautumis- ja
konfliktipolut. Riippumaton jatkokatselmus ei löytänyt jäljellä olevia
olennaisia puutteita. Puhtaan revision paketointi ja PR/main ovat yhä avoinna.

Legacy-palautuskoe on kytketty nykyiseen paketoidun sovelluksen CI-jobiin.
Jobin tuloskoonti vaatii sen onnistumisen; ohitus, peruutus tai hylkäys ei
hyväksy porttia. Rajattu salattu keräys sisältää sen olemassa olevat raportit,
ei testikantoja tai backup-sisältöä. Ajokytkennän 141 sopimustestiä läpäisivät.

Nykyisen PDF:n esikatselu ei enää käytä saman lasku-URL:n vanhaa ikkunaa
uudelleenhyväksynnän jälkeen. Täsmällisen historiallisesti sidotun PDF:n
ikkunan uudelleenkäyttö säilyy. Muutosta todentavat 149 kohdetestiä sekä
nykyisen ja historiallisen PDF:n kaksi development-Electron-koetta.
Historian odottamaton lukuvirhe palauttaa turvallisen 500-vastauksen ilman
raakaa stderr-tulostetta; 47 kohdetestiä ja koko työtilan tyypitys läpäisivät.
Näiden kahden puutteen riippumaton jatkokatselmus on suljettu.

**Kohdetodennettu korjaus:** katselmus löysi puuttuvan B-P3-siirtymän vanhalle
hyväksytylle laskulle, jolla ei ole SMTP-historiaa. Kaksi HTTP-regressiota
toisti ensimmäisen toimitusvalmistelun hylkäyksen. Rajattu toteutus käyttää
uutta moduulinsisäistä `InvoiceLegacyRevisionPromoter`-porttia: tarkka vanha
avain, hyväksytty tila, SMTP-/unresolved-estot, snapshotin ja nykyprojektion
vastaavuus sekä hyväksytyn laskentasäännön mukaiset summat tarkistetaan
samassa transaktiossa. Uusi `validatedLegacySnapshot` ja current-osoitin
julkaistaan atomisesti. Vanhaa revisiota, PDF:ää, summia, laskunumeroa,
maksuja tai toimitushistoriaa ei muuteta. Tietomalli tai migraatiot eivät
laajene. Toimitus käyttää palautettua täsmäavainta, ei uusinta vapaata lukua.
Rajatut 268 testiä ja laajan backend-sarjan 2 835 testiä läpäisivät;
jälkimmäisen viisi olemassa olevaa alustakohtaista ohitusta säilyivät.
Riippumaton katselmus löysi PDF-polun valtuutuspuutteen ja liian aikaisen
sähköpostiesikatselun laskennan. Molemmat korjattiin ja jatkokatselmus
suljettiin. Legacy-siirtymä vaatii PDF-wrapperissakin saman yrityksen
luotetun kontekstin ja `sendInvoices`-oikeuden; tavallinen varmennetun
revision PDF-polku säilyy. Rikkoutunut riviaritmetiikka hylätään ennen
esikatselulaskentaa turvallisesti ja nykyinen Diagnostics/tukipaketti/
incident-ketju on todennettu. Tyypityksen uuden testin puuttuva argumentti
korjattiin, minkä jälkeen backendin tyypitys läpäisi. Tämä ei vielä ole
puhtaan revision paketoitu palautus- tai PR/main-hyväksyntä.

Lisäksi suora SMTP-testin prepare/send ilman edeltävää PDF-esikatselua
todentaa revisiosiirtymän, providerille annettujen tavujen vastaavuuden
tapahtuma-PDF:ään ja muokkaamiseen palaamisen molemmat revisiot säilyttäen.
Kolmen composition-tiedoston 62 testiä läpäisivät. Testin ensimmäinen
tavukopion virhe säilyy havaintona: testisovittimen jaettu puskuri korvattiin
itsenäisellä kopiolla, tuotannon salaisuuksia sisältävien puskurien
nollauskäytäntöä muuttamatta. Riippumaton lisäkatselmus ei löytänyt puutteita.
Tämä on fake-providerilla tehty backend-näyttö, ei oikea SMTP/native-koe.

Koko työtilan regressioajossa erillinen workspace-adoption rollback-testi
ylitti nykyisen aikarajansa. Yksi rajattu saman lähteen uusinta läpäisi,
mutta syy jäi avoimeksi. Alkuperäinen hylkäys säilyy eikä koko sarjaa tai
mergevalmiutta merkitä vihreäksi sen perusteella. Backendin ja webin
erilliset laajat ajot läpäisivät.

**Omistajan rajattu etenemispäätös 6.10.2026:** loppukatselmus, puhtaan
revision paketointi ja yksi normaali PR/CI-kierros saadaan tehdä alkuperäisen
workspace-adoption timeoutin jäädessä avoimeksi. Päätös ei muuta vanhaa
ajoa läpäistyksi, todista juurisyytä tai salli yleisiä lisäuusintoja.
Nykyiset palautus-, eheys-, siivous- ja main-portit vaaditaan edelleen;
uusi hylkäys käsitellään ennen mergeä. Puhtaan revision paketointi,
vaaditut PR/main-portit ja koko B3-B5:n loppuhyväksyntä ovat avoinna.

<a id="m1-source-preparation-l9093"></a>

### B4-reopened-editorin jatkotodennus


**Rajattu lukusopimus:** GET
`/invoice-drafts/:id/delivery-history` vaatii nykyisen `sendInvoices`-oikeuden
ja backendin vahvistaman yrityskontekstin. Erillinen laskutusmoduulin
lukijaportti tarkistaa yhdessä lukutransaktiossa muokattavan tavallisen
luonnoksen ja sen yritysrajatun `source_draft_id`-yhteyden. Tavallinen
luonnos ilman laskuidentiteettiä palauttaa null-identiteetin ja tyhjän
historian; ristiriitainen olemassa oleva sidos on turvallinen eheysvirhe,
ei tyhjä onnistuminen. Hyvitysluonnos ja ei-muokattava tai puuttuva kohde
eivät kuulu tähän polkuun. Luonnoksen kirjoitus-DTO, numerointi,
lähetyskelpoisuus ja tietomalli eivät muutu. Client validoi projektion ja
editori avaa vain sen palauttamaan laskuidentiteettiin sidotun tapahtuman
PDF:n. Näkymästä poistuminen tai luonnoksen vaihtaminen mitätöi vanhan
lukuvastauksen.

**Editorin jatkotodennus:** 39 application-, SQLite- ja composition-testiä
todentaa lukusopimuksen, permission-/yritysrajat, virheellisen sidoksen,
kirjoittamattomuuden sekä operational-lokista Diagnosticsiin ja tukipaketin
incident-projektioon kulkevan turvallisen virheen. Koko webin 947 ja
API-clientin 314 testiä sekä koko työtilan tyypitys läpäisivät. Kaksi
selainpolkua ja yksi development-Electron-polku todentavat vanhan PDF:n
avaamisen myös editorista. Selainpolku avaa luonnoksen uudelleen listalta;
Electron-polku muokkaa ja hyväksyy sen käyttöliittymän kautta ennen vanhan
PDF:n uutta avaamista. Laskuidentiteetti, numero, alkuperäiset PDF-tavut ja
toimitushistoria säilyvät. Native-ikkunan eristys ja sulku tarkistetaan.
Rajattu sopimus-, toteutus- ja turvallisuuskatselmus valmistui. Lopullinen
laskutuksen ja composition-kytkentöjen regressiosarja läpäisi 1 834 testiä.

Native-kokeen ensimmäinen jatko käytti taustalla API-hyväksyntää jo avatun
käyttöliittymän ohi ja odotti listan päivittyvän. Testi käyttää nyt normaalia
UI-muokkausta ja hyväksyntää; se ei lisää tuotantoon pollingia tai muuta
testien aikarajoja. Myös kahden apurin erilaisten palautusmuotojen vertailu
rajattiin tarkkoihin yhteisiin identiteettikenttiin. Ensivirheet säilyvät;
läpäisy ei sulje vanhoja erillisiä CI-timeout-havaintoja.

**B4:n varaus-, loppukuittaus- ja reopen-checkpoint:**
`reserveEmailDelivery` tarkistaa nykykelpoisuuden, täsmädokumentin ja
revision tai säilytetyn legacy-kopion sidoksen sekä kaikki saman laskun
ratkaisemattomat toimitukset samassa `IMMEDIATE`-transaktiossa. Onnistunut
varaus tallentaa `attempted`-tilan ennen mahdollista verkkokutsua.
Yleinen save-portti ei enää hyväksy SMTP-kirjausta varauksen ohitse.
Legacy-uudelleenlähetyksen adapteri ei generoi PDF:ää tai muuta alkuperäisen
tapahtuman provenanssia. Käyttötapauksen/native-vahvistuksen kytkentä on
vielä tekemättä, joten adapterinäyttö ei yksin hyväksy lähettämistä.

Loppukuittaus vaatii saman varauksen, moodin, revision/dokumentin sekä
tallennetun hashin ja koon. Sama päättynyt kuittaus on idempotentti;
eri lopputulos tai sidonta on konflikti. Vain onnistunut asiakaslähetys
merkitsee laskun `sent`-tilaan. Itselle-testin onnistuminen ei lukitse
muokkausta, eikä vanhan saman kuittauksen toisto muuta uutta revisiota.
Tapahtuman varausaika säilyy, ja kuittauksen event-/tila-/audit-kirjoitus
palautuu kokonaan, jos transaktio epäonnistuu.

Reopen irrottaa vain nykyisen revision osoittimen ja vapauttaa luonnoksen
samassa `IMMEDIATE`-transaktiossa tilan ja auditin kanssa. Revision snapshot,
PDF-metatiedot, tiedostot ja toimitustapahtumat säilyvät. `attempted` ja
`outcomeUnknown` estävät reopenin sekä myös suoran uudelleenhyväksynnän:
jälkimmäinen tarkistus suojaa aiemmassa versiossa jo avatun laskun
migroitua historiaa, vaikka current-osoitin puuttuu. HTTP palauttaa
turvallisen 409:n ilman raakavirhettä tai uusia tunnisteita. Nykyinen
auditointi säilyy; hylkäys ei kirjoita onnistumisen tapahtumaa.

Uudet varaus-/loppukuittaustestit läpäisivät ensin 36/36. Reopenin ja
olemassa olevien hyväksyntä-/HTTP-testien rajattu jatko läpäisi 169/169.
Lukituskilvan lisätarkistuksen, PDF-/historialuvun, hyvitysten ja revisioluvun
yhdistetty loppuajo läpäisi 650/650 testiä 36 tiedostossa ilman uusintoja.
Näyttö sisältää kaksi erillistä tietokantayhteyttä, kummatkin operaatioiden
järjestykset, todellisen kirjoituslukon, tietokannan uudelleenavauksen,
migroidun unresolved-historian, audit-rollbackin ja todellisen composition/
HTTP-polun vanhoilla sekä uusilla eri PDF-tavuilla. Tämä ei vielä ole koko
SMTP-/UI-/native-ketjun tai paketoidun palautuksen hyväksyntä.

Riippumattomat rajatut varaus-/kuittaus- ja reopen-katselmukset eivät
löytäneet korjattavaa tuotantokoodista. Reopen-katselmuksen nimeämä
uudelleenkäynnistyksen testivaje täydennettiin suoralla reopen-eston sekä
migroidun historian uudelleenhyväksyntäeston kokeella tietokannan
uudelleenavauksen jälkeen. Sama 650 testin sarja läpäisi täydennyksen jälkeen.

Vanhojen testiaineistojen migraatio-/sidonta-/revisio-odotukset ja uuden
synteettisen tiivisteen pituus korjattiin, ensitulokset säilytettiin.
Tuotannon eheysvaatimuksia tai aikarajoja ei lievennetty. Tämän aiemman
checkpointin backend-tyypityksessä oli 54 diagnostiikkaa yhdeksässä sovittamattomassa
vanhassa toimituskutsujan, tapahtumakirjoittajan tai testin tiedostossa;
uusi reopen-/adapteriketju ei lisää jäljellä olevia tyypitysvirheitä.
Silloinen seuraava työ oli näiden SMTP-, manual- ja dry-run-käyttöpolkujen
yhtenäinen siirto, valmistelu/token ja cancel-kilpailun koko ketjun todennus.
Vanhan approved + tuntemattoman päättyneen SMTP-moodin toimintapäätös oli
tässä checkpointissa avoin; unresolved-esto ei ratkaise tai arvaa sitä.
Omistajan myöhempi rajattu selvitysesto on kirjattu yllä B-P3-taulukkoon.

**B4:n SMTP-käyttötapausten checkpoint:** asiakas- ja itselle-testilähetys
käyttävät yhteistä `loadInvoiceEmailDeliveryDocument`-apua. Se lukee juuri
generoinnin valitseman dokumentin, tarkistaa muuttumattoman revision ja
metatietojen vastaavuuden sekä käyttää tallennusportin varmentamia todellisia
tavuja. Se ei valitse esikatselun uusinta dokumenttia eikä anna yksin
lähetysoikeutta. `invoice-email-send-v3` sitoo valtuutuksen myös revision tai
säilytetyn alkuperän avaimeen. Prepare tyhjentää väliaikaiset tavut eikä
varaa toimitusta; molemmat moodit hylkäävät pysyvän unresolved-historian.

Send varaa täsmäkohteen atomisesti ennen provider-kutsua ja käyttää juuri
saman tarkistetun puskurin. Loppukuittaus saa varauksesta palautetun kohteen
ja moodin. Tyypittämätön provider-virhe tai epäonnistunut loppukuittauksen
tallennus säilyttää epävarmuuden: pysyvää `attempted`-tapahtumaa ei poisteta,
jos edes `outcomeUnknown`-päivitys ei onnistu. Muistiin jäävän attempt-storen
vaihtuminen ei näin salli uutta lähetystä. Lopuksi puskuri tyhjennetään.

Asiakaslähetyksen vastaus lukee nykyisen laskun vasta durablen onnistumisen
jälkeen; resend-tieto tulee varaushetken tilasta. Tämän lukuvaiheen virhe
palauttaa turvallisen `INVOICE_DELIVERY_COMMITTED_READ_FAILED`-koodin, ei
lähetyksen failed-tulosta. Attempt säilyy onnistuneena, tapahtuma ja laskun
`sent`-tila säilyvät. Olemassa oleva `invoiceDelivery.finalizationFailed`
erottaa vaiheen `read`, tilan `committed` ja `retryable=false`; virhekulku
on kytketty myös Diagnosticsin, tukipaketin ja incident-indeksin lukijoihin.
Webin erityinen palaute on nyt kytketty API-clientin säilyttämään 409-
vastauksen täsmälliseen virhekoodiin. Se kertoo onnistuneesta lähetyksestä
ja ohjaa avaamaan laskun sekä tarkistamaan historian ilman uutta lähetystä.
Tuntemattomasta, väärän tyyppisestä tai eri statuksen vastauksesta ei päätellä
onnistumista; raakavirhettä ei näytetä. Desktopin nykyinen protokolla säilyttää
saman koodin eikä vahvista tai lähetä uudelleen. Diagnostiikan kirjoitus ei
saa peittää tulosta.

Regressio toisti ensin aiemman virheellisen kehotuksen valmistella lähetys
uudelleen. Korjauksen 38 hook-/lomake-/sivutestiä ja desktop-protokollan
21 kohdetestiä läpäisivät. Selaimen `INV-SMTP-COMMITTED-READ-UI-001`
läpäisi oikean lomakkeen ja API-clientin kautta: yksi fake-SMTP-toimitus
pysyi onnistuneena ja jälkilukuvirhe näkyi ilman uutta lähetystä. Tämä
selainkoe sovittaa vain onnistuneen HTTP-vastauksen kyseiseksi virheeksi;
varsinainen backend-lukuhäiriö sekä Diagnostics-/tukipaketti-/incident-
ketju todennetaan erillisessä composition-testissä. Näitä ei väitetä yhdeksi
paketoiduksi virheinjektiokokeeksi. Tietomalli, toimituksen transaktio,
native-valtuutus ja hyväksyntärajat eivät muuttuneet palautekorjauksessa.
Todellisen SMTP-compositionin 17 testiä ja koko webin 911 testiä
151 tiedostossa sekä lopullinen työtilan tyypitys ja web-build läpäisivät
tämän jälkeen. Buildin aiempi suuren chunkin varoitus säilyy, eikä sen
rajaa muutettu. Riippumaton palautekorjauksen ja
uusien testien katselmus ei löytänyt korjattavia puutteita.

Kohdetodennus kattaa alemman tason valtuutus- ja tavusidoksen, molemmat
SMTP-moodit, todellisen HTTP/composition-/SQLite-/tiedostoketjun,
reopenin voiton ennen varausta, providerin aikana estetyn reopenin ja
loppukuittauksen tallennusvirheen jälkeisen uuden sovellusinstanssin eston.
Provider on synteettinen: todellista SMTP-yhteyttä ei avata. Buildin ja
E2E-runtimen TypeScript-juurista suljetaan `*.fixture.ts` pois, mutta ne
säilyvät tavallisen tyypityksen piirissä; tätä rajaa testataan nykyisellä
TypeScriptillä ilman uutta riippuvuutta.

Riippumaton katselmus löysi PDF:n tarkistuksen aikaisen reopen-kilvan
virheluokituspuutteen. Neljä uutta molempien moodien prepare/send-tapausta
toisti geneerisen 500-vastauksen ennen korjausta. Nyt reitit palauttavat
turvallisen 409:n eikä asiakaslähetys kirjaa PDF-omistajan jo raportoimaa
konfliktia SMTP-providerin virheeksi. Varausta tai provider-kutsua ei synny.
Katselmuksen jälkeen yhdistetty 181 testin sarja 15 tiedostossa läpäisi
ilman uusintoja tai ohituksia. Tämä rajattu application-/adapteri-/HTTP-
näyttö ei korvaa koko backendin tyypitystä tai UI-/native-/palautusportteja.

Tämän SMTP-checkpointin hetkellä backendin tyypitys ei vielä läpäissyt: jäljellä oli 26 diagnostiikkaa viidessä
manual-/dry-run-tapahtumakirjoittajan tai vanhan repository-testin tiedostossa.
Niiden sovitus ja cancel-todistus kuvataan seuraavassa checkpointissa.
Vanhan approved + tuntemattoman päättyneen SMTP-moodin päätös oli silloin
avoin; yllä oleva 6.10.2026 hyväksyntä ratkaisee tämän päätösaukon.

**B4:n manual-/dry-run- ja cancel-checkpoint:** yleinen tapahtumakirjoittaja
on tyypitetty vain revision PDF:ään sidotuille dry-run-tuloksille. Adapteri
tarkistaa saman sopimuksen myös ajonaikaisesti ja kirjoittaa vasta
current-revision, tarkan dokumentin, tiivisteen ja koon tarkistuksen jälkeen.
SMTP ei voi käyttää tätä porttia varauksen ohitukseen. Manual/print käyttää
omaa `IMMEDIATE`-finalizeria: tapahtuma, sent-tila ja audit ovat atomisia;
`completed` ja `alreadySent` erotetaan, eikä jälkimmäinen luo arkistointia.

Manual ja dry-run prepare/send ottavat revision ennen laskun näkymän lukua
ja vertaavat sitä muodostettuun PDF:ään. Kohdetesti toistaa oikean
composition-/SQLite-/HTTP-ketjun väliin tulevan reopen/uudelleenhyväksynnän:
vanhaa laskunäkymää ei yhdistetä uuteen PDF:ään, vaan palautetaan turvallinen
409. Molempien yhtä aikaa approved-tilan lukeneiden manual-pyyntöjen testi
todistaa yhden tapahtuman ja juuri siihen liittyvän arkistointipyynnön.

Cancelin tuotantokoodia tai peruutussääntöä ei muutettu. Molempien
SMTP-moodien varaus/peruutusjärjestykset, eri tietokantayhteydet,
kirjoituslukko ja päätöksen säilyminen tietokannan uudelleenavauksessa on
todennettu. Oikea composition torjuu ennen varausta voittaneen peruutuksen
ennen provideria ja estää peruutuksen providerin aikana. Vanhan peruutustestin
aineisto muodostetaan nyt aidon 038 -> 039 -migraation kautta; suojia ei
poisteta vanhojen rivien lisäämiseksi. Vanhan repository-testin 24 testiryhmää
säilyvät uuden porttisopimuksen 58 tapauksena, myös legacy-unresolved-estot.

Rajattu 23 tiedoston sarja läpäisi 330/330 testiä. Laajempi regressio paljasti
Activity-lukijan vanhasta fixturestä kaksi 039-sidoksen puutetta; aineisto
siirrettiin todellisen 038 -> 039 -migraation läpi muuttamatta Activityn
tuotantokoodia tai odotettua read modelia. Composition-testi varmentaa
manuaalisen toimituksen sallitut historiakentät ja dry-runin tarkoituksellisen
poissulun. Riippumattoman katselmuksen jälkeen täydennettiin myös dry-runin
provider-odotuksen aikainen cancel/reopen/uudelleenhyväksyntä: myöhäinen
tulos hylätään ilman uutta tapahtumaa tai arkistointia.

Lopullinen laskutusmoduulin ja kolmen toimitus-/reopen-compositionin sarja
läpäisi 1 472/1 472 testiä 122 tiedostossa ilman ohituksia tai uusintoja.
Backendin koko tyypitys läpäisi uudelleen. Riippumaton rajattu lähdekatselmus
ja testitäydennysten tarkistus valmistuivat ilman korjattavia löydöksiä.
Tämä ei ole koko backendin, UI:n, native-runtimen tai palautusketjun
hyväksyntä eikä vielä sulje B4:ää tai V3:n hyväksyntäportteja.
Seuraavaksi kytketään legacy-vahvistus, client/UI/native sekä katalogi ja
palautus. Uusia riippuvuuksia, audit-/diagnostiikkatunnuksia tai
moduulien välisiä portteja ei lisätty tässä palassa. Sisäistä revisioavainta
ei julkaista vanhan HTTP-vastauksen uutena kenttänä.

**B-P3:n lähde- ja säilytyspala työpuussa; kohdetodennettu ja katselmoitu.** Invoicingin
erillinen lukijaportti valitsee `sent`/`legacySnapshot`-laskun yksiselitteisen
alkuperäisen dokumentin ja mahdollisen säilytetyn kopion. Sama historian
kelpoisuusehto tarkistetaan myös kopion julkaisun `IMMEDIATE`-transaktiossa
ja lähetysvarauksessa; olemassa oleva kopio ei ohita ehtoa. Valinnan jälkeen
application lukee varmennetut tavut ja julkaisee itsenäisen kopion nykyisillä
storage-/repository-porteilla ilman renderer- tai provider-kutsua.
Epäselvä julkaisun commit-tulos säilyttää ehdokkaan; vain varmasti hävinnyt
oma ehdokas voidaan siivota. Rajatut testit kattavat väärän kohteen, puuttuvan
ja epäselvän historian, estävät toimitukset, valmistelukilvan ja tiedostovirheen.
Tämä pala ei vielä avaa HTTP-/native-lähetyspolkua. Tässä checkpointissa
avoimeksi jääneet tunnetun R02-jälkitilan todennus ja approved + tuntematon
SMTP -päätös on käsitelty alla 6.10.2026 jatkossa; kokonaisketju jää kesken.

Ensimmäinen rajattu sarja läpäisi 91 testiä. Laajemman ajon kaksi
testijärjestelypuutetta korjattiin muuttamatta tuotannon suojaehtoja:
tietokantafixture kuuluu infrastructureen ja uuden kopion julkaisutesti
tarvitsee yksiselitteisen historian; puuttuvan vanhan viitteen lukutestit
säilyivät. Lisäksi todennettiin useita samaan alkuperäiseen viittaavia
tapahtumia ja säilytetyn kopion käyttö tietokannan uudelleenavauksen jälkeen.
Lopullinen laskutusmoduulin ja viiden compositionin sarja läpäisi
1 525/1 525 testiä 126 tiedostossa, ja backendin koko tyypitys läpäisi.
Riippumaton ehdokaskatselmus valmistui ilman korjattavia löydöksiä. Nämä eivät hyväksy HTTP-/UI-/
native-ketjua tai B5:n katalogi-/paketoitua palautusporttia. Valmistelun
sisäinen kopiointi ei luo toimitus- tai business-audit-tapahtumaa; vasta
varsinainen toimitus käyttää nykyistä tapahtumaporttia. Uutta loggeria,
riippuvuutta tai moduulien välistä porttia ei lisätty.

**B-P3:n selvitysesto ja tunnetun jälkitilan todennus, 6.10.2026.** Omistajan
hyväksymä rajaus on yllä [legacy-taulukossa](release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l7855).
Backendin alku- ja transaktiotarkistus torjuvat epäselvän vanhan approved-
laskun muokkaus-/lähetyspolut. Kahdeksan HTTP-toimintoa palauttaa turvallisen
409-koodin ennen PDF-, sähköpostiasetus-, valtuutus- tai provider-toimintoja.
Laskun, tapahtumien ja alkuperäisen PDF:n luku säilyy. Sama turvallinen syy
kulkee oikean loggerin läpi Diagnosticsiin ja tukipakettiin; sen varoitus
ei kuulu pitkän ajan incident-indeksiin. UI:n virhemäppäys käyttää vain
sovittua status-/koodiparia ja säilyttää muiden virheiden nykyiset palautteet.

Alkuperäisessä R02-ketjussa dokumenttimetadatan poisto jätti vanhalle
tapahtumalle `ON DELETE SET NULL` -viitteen. Myöhäinen success saattoi
koskea jo vaihtunutta snapshotia; epävarma lopputulos säilyi toisena
jälkitilana. Uusi regressio rakentaa nämä tunnetut pysyvät jälkitilat
038-skeemaan, käyttää todellista 039-migraatiota ja todistaa eston valinnassa,
kopion julkaisussa ja varauksessa. Myöhempi ehjä dokumentti/tapahtuma ei
korjaa vanhaa null-viitettä. Varauksella on kokeessa muuten kelvollinen
kohdedokumentti; puuttuva kohde ei yksin selitä hylkäystä. Ehjän saman
lähteen toistuvat sent-tapahtumat sallitaan kontrollina. Tämä ei ole vanhan
runtime-virheen uusi toisto eikä todista kaiken historiallisen PDF-sisällön
vastaavuutta. Uutta yleistä ristiriitalippua tai audit-aikaheuristiikkaa ei lisätty.

Rajattu sarja läpäisi 58 testiä. Laajempi laskutuksen ja compositionien
regressio läpäisi 1 587/1 587 testiä 130 tiedostossa ja backendin tyypitys
läpäisi. UI:n hook-/virhepalautesarja läpäisi 268/268 testiä 26 tiedostossa
ja webin tyypitys läpäisi. Tämä ei ole koko käyttöliittymän E2E-hyväksyntä.
Ensimmäisen koeaineiston puutteet ja väärät oletukset erotettiin
tuotantosopimuksesta; ensimmäinen hylkäys säilytettiin.

Riippumaton katselmus löysi UI-kytkennästä kaksi ennenaikaista PDF-pyyntöä:
manuaalinen lähetetyksi merkintä ja sähköpostin valmistelu saattoivat
pysähtyä PDF-virheeseen ennen selvityseston palautetta. Oikeiden sivun
callbackien testi toisti molemmat puutteet. Erilliset edeltävät PDF-pyynnöt
poistettiin; nykyiset backend-käyttötapaukset omistavat jo kelpoisuuden ja
PDF:n varmistamisen. Vain onnistumisen jälkeen päivitetään UI:n metadata
ilman uutta valmistelun odotusehtoa. Rajattu virhe- ja onnistumispolun
testi sekä sen jälkeinen laskutuksen web-sarja läpäisivät: 586/586 testiä
78 tiedostossa, webin tyypitys läpäisi uudelleen. Sama katselmoija vahvisti
löydön korjauksen ilman uusia löydöksiä. Tämä sivukytkennän todennus ei
ole selaimen tai paketoidun Electronin täysi E2E-testi.

Koko legacy-lähetyksen vahvistus/native-kytkentä, katalogi ja paketoitu
palautus sekä PR/main-portit ovat edelleen tekemättä. Uusia riippuvuuksia,
skeemamuutoksia tai hyväksyntäehtojen lievennyksiä ei lisätty tässä palassa.

<a id="m1-source-preparation-l9373"></a>

##### Säilytetyn dokumentin täsmäluku ja vahvistuksen järjestys

**Rajattu lukupala työpuussa 6.10.2026.**
`readPreservedLegacyInvoiceDocument` lukee vain jo valmistellun,
eksplisiittisellä dokumentti-ID:llä nimetyn säilytetyn kopion. Se tarkistaa
lähetysoikeuden ja luotetun yritys-/laskurajan, lähteen ja kopion todelliset
tavut sekä historian kelpoisuuden uudelleen tiedostoluvun jälkeen.
Lukuri ei saa julkaisu-, generointi- tai poistamisporttia. Puuttuva kopio,
eri dokumentti tai muuttunut aineisto hylätään; uutta PDF:ää ei tehdä
varavaihtoehdoksi. Valmistelu ja luku käyttävät samoja kapeita metadatan
eheystarkistuksia. Tämä alkuperäinen lukupala ei vielä sisältänyt
HTTP-/native-kytkentää eikä lähetysvaltuutusta. Kytkennän nykytila on alla.

Uuden täsmälukijan 18 testiä sekä valmistelun, lähdevalinnan ja R02-
migraatiotapausten yhdistetty 56 testin ajo läpäisivät. Tämän jälkeen
laskutuksen ja compositionien 1 605 testiä 131 tiedostossa sekä backendin
tyypitys läpäisivät. Näyttö koskee backendin osaa, ei vielä koko vahvistuksen
toteutusta tai paketoitua palautusta. Rajattu riippumaton lähdekatselmus
ei löytänyt korjattavia ohituksia tai valmistelun käyttäytymisregressioita.

Kytkentä jatkuu hyväksytyn B-P3:n sisällä seuraavassa järjestyksessä:

1. Dokumentin valmistelu säilyttää tarkistetun kopion ja palauttaa täsmäkohteen
   sekä eksplisiittisen `preservedLegacy`-alkuperän, mutta ei vielä SMTP:n
   kertalupaa. Backend valitsee alkuperän; renderer ei saa päättää sitä.
2. Esikatselu lukee juuri nimetyn kopion. Nykyinen pelkällä lasku-ID:llä
   valittu PDF ja samalla avaimella uudelleenkäytetty esikatseluikkuna eivät
   kelpaa tämän kohdesidonnan todisteeksi. Kapea täsmälukureitti ja mainin
   esikatselukohde on vietävä olemassa olevaan allowlistiin ja controlleriin.
3. SMTP-prepare tarkistaa esikatselukohteen uudelleen. Callerilta saatu
   dokumenttitunniste on vertailuehto, ei lähetysoikeus tai luotettu alkuperä.
   Vasta tämän jälkeen syntyy nykyinen 60 sekunnin kertalupa ja mainin
   erillinen vahvistus näyttää säilyneen dokumentin historiallisen rajan,
   todellisen vastaanottajan ja viestin. Aikarajaa ei kasvateta eikä
   vanhentunutta lupaa uusita automaattisesti.
4. Send lukee saman kopion uudelleen, vertaa nykyistä fingerprint-sidontaa
   ja käyttää nykyistä atomista varausta. Vahvistuksen tai preview-lukemisen
   onnistuminen ei ohita välissä syntynyttä estävää toimitusta.

Response- ja request-parserien, API-clientin eksplisiittisen serialisoinnin
sekä native-vahvistuksen on kannettava sama täsmäkohde. Puuttuva tai
tuntematon alkuperä ei saa pudota tavalliseen resend-haaraan. Native-portti
on todennettava myös puuttuvan callbackin tapauksessa; pelkkä uuden reitin
allowlistaus ei osoita vahvistuksen toteutumista. Itselle tehtävä SMTP-testi
pysyy vain varmennetun revision polkuna. Nämä eivät lisää uutta lähetysmoodia,
pidennä tokenin elinaikaa tai avaa automaattista uudelleenlähetystä.

Nykyinen sähköpostilomakkeen avaaminen kulkee
`prepareApprovedInvoiceEmailDryRun`-käyttötapauksen kautta myös ennen
asiakas-SMTP:tä. **Esivalmistelun kytkentä on nyt työpuussa:** tavallinen
haara säilyttää revision PDF:n varmistamisen. Kelvollisen vanhan `sent`-
laskun haara käyttää samaa säilytetyn kopion valmistelua kuin B-P3:n
lukupohja, eikä regeneroi dokumenttia. Backend valitsee haaran. Vastauksen
pakollinen `documentTarget` sisältää vain `kind`-arvon (`revision` tai
`preservedLegacy`) ja liitteen kanssa saman `documentId`:n. API-client
validoi ne eksplisiittisesti; puuttuvaa tai tuntematonta varianttia ei arvata.
Sisäisiä polkuja, tiivisteitä tai lähderevisiota ei lisätä tähän DTO:hon.

Vanhan PDF:n viestipohja on neutraali: snapshotin rahasummia, eräpäivää,
viitettä tai maksutietoja ei esitetä varmennetuksi PDF-sisällöksi. Kopio
pysyy katalogissa ja lukuoperaation tilapäiset tavupuskurit tyhjennetään myös
lomakkeen valmistelun epäonnistuessa. Alkuperäisiä dokumentteja, laskua tai
toimitushistoriaa ei muuteta. Eheysvirhe käyttää nykyistä
`invoicePdf.storageFailed`-tapahtumaa; valmistelussa `sideEffectState=unknown`
ei lupaa, ettei kopiota ehtinyt syntyä. Diagnostiikan kirjoitusvirhe ei
korvaa varsinaista eheysvirhettä.

Rajatussa katselmuksessa löytyi julkaisukonfliktin jälkeisen
ehdokastiedoston siivousvirheen puuttuva diagnoosi. Kolme regressiota
toistivat puutteen ennen korjausta. Korjaus kirjaa nykyiseen
`invoicePdf.storageFailed`-tapahtumaan `INVOICE_PDF_CLEANUP_FAILED`-syyn,
`cleanup`-vaiheen ja epävarman sivuvaikutuksen. Alkuperäinen konflikti ja
historiallinen aineisto säilyvät myös loggerin epäonnistuessa. Korjauksen
33 kohdetestiä läpäisivät; mukana on oikea Diagnostics-/tukipaketti-/
incident-lukuketju eikä pelkkä kirjoittimen mock-tarkistus. Sopimus on
[nykyisessä tapahtumakatalogissa](r0-observability-event-catalog.md#laskudokumentit-ja-toimitus).

Lopullinen tämän palan laskutus-/composition-regressio läpäisi 1 621 testiä
132 tiedostossa. API-clientin koko 188 testin sarja ja webin 14 kohdetestiä
läpäisivät. Koko työtilan tyypitys läpäisi uuden DTO:n kanssa.
Client-regression ensimmäinen hylkäys johtui virheolion lisätietoja
koskevasta väärästä testiodotuksesta, ei parserin hyväksymästä väärästä
vastauksesta; odotus korjattiin muuttamatta tuotannon validointia.
Tämä ei ole vielä selaimen/native-polun tai paketoidun palautuksen todiste.
Backendin tyypitys läpäisi myös siivousdiagnoosin lopullisen korjauksen
jälkeen. Sama riippumaton katselmoija vahvisti siivouslöydön korjauksen;
rajatussa jatkokatselmuksessa ei ollut uusia löydöksiä.

Tämä on lomakkeen esivalmistelu, ei lähetysvaltuutus. Se ei luo SMTP-
kertalupaa, toimitusyritystä eikä avaa `preservedLegacy`-varianttia itselle-
testin tai dry-run-sendin varaukseen.

**Täsmäesikatselun backend-/desktop-rajat työpuussa 6.10.2026.**
`GET /invoices/:id/preserved-documents/:documentId/pdf` käyttää yllä olevaa
kirjoittamatonta lukijaa oikeassa compositionissa. Reitti hylkää query-
ohitukset ja palauttaa vain tarkistetut PDF-tavut turvallisilla kiinteillä
otsakkeilla; tilapäiset storage-puskurit tyhjennetään. API-client muodostaa
vain tämän reitin osoitteen, ei anna luku- tai lähetysoikeutta.

Desktopin olemassa oleva `openInvoicePdf(invoiceId, target?)` hyväksyy
valinnaisen tarkan `{ kind: 'preservedLegacy', documentId }`-kohteen.
Main tarkistaa lähettäjän, kentät ja tunnisteet, muodostaa URL:n itse sekä
käyttää sitä ikkunan täsmäavaimena. Tavallinen PDF, saman laskun eri
dokumentti ja eri laskun dokumentti eivät jaa esikatseluikkunan identiteettiä.
GET-allowlist, pääprosessin session, sandbox, navigointi- ja permission-
rajat säilyvät. Valinnainen kohde ei tuo uutta IPC-capabilityä. Kohteen
puuttuminen säilyttää aiemman toiminnon; virheellinen kohde hylätään.

Backendin 57 kohdetestiä, API-clientin kaikki 191 testiä sekä desktopin
87 kohdetestiä läpäisivät. Laajempi laskutus-/composition-sarja läpäisi
1 664 testiä 135 tiedostossa. Testit kattavat oikean backend-compositionin,
muuttuneen tiedoston ja IO:n aikana peruutetun laskun, oletuspolun säilymisen,
väärän kohteen sekä preloadin ja protokollan kytkennät. Electronin native-
rajat on näissä testeissä korvattu testisovittimilla; kyse ei ole oikean
Electron-ikkunan tai paketoidun palautuksen hyväksynnästä. Ensimmäisen
desktop-ajon uuden testin CTS-latausvirhe korjattiin suorittamalla preloadin
nykyisellä TypeScript-kääntäjällä tuotettu CommonJS eristetyssä testissä,
ei muuttamalla tuotantopreloadia tai testiehtoihin tehtävällä poikkeuksella.

Riippumaton katselmus löysi uuden lukurajan kaksi puutetta, jotka toistettiin
ennen korjausta: backend hyväksyi tunnisteiden välilyöntinormalisoinnin, ja
odottamaton reader-poikkeama päätyi kehyksen raakaan stderr-käsittelyyn.
Täsmälukija hylkää nyt normalisoinnin olemassa olevan tunnistepituusrajan
sisällä. HTTP-raja palauttaa odottamattomasta poikkeamasta geneerisen 500-
vastauksen ilman raakavirheen välitystä. Nykyinen HTTP-middleware kirjaa
`HTTP_REQUEST_FAILED`-luokan; tuntematonta virhettä ei nimetä perusteetta
PDF:n eheysvirheeksi. Korjausten 69 kohdetestiä läpäisivät. Kyse ei ollut
todennetusta yritysrajan ohituksesta eikä uudesta lokituskehyksestä.
Korjausten jälkeinen laskutus-/composition-/HTTP-lokitusregressio läpäisi
1 676 testiä 136 tiedostossa. Oikea lokikirjoitin sekä Diagnosticsin,
tukipaketin ja incident-indeksin lukijat säilyttivät turvallisen virheluokan
ilman raakapoikkeamaa tai polkuja. Koko työtilan tyypitys ja desktop-build
läpäisivät; backendin tyypitys läpäisi myös viimeisten tuotantokorjausten
jälkeen. Rakennettu preload pysyy yhtenä CommonJS-tiedostona, jonka ainoa
runtime-import on Electron.
Sama riippumaton katselmoija vahvisti molemmat tuotantokorjaukset ja
vuotosuojatestin Windows-escape-tarkennuksen ilman uusia löydöksiä.
Lopulliset 18 composition-lukurajatestiä läpäisivät myös testitarkennuksen
jälkeen. Tämä rajattu katselmus ei ole koko B3-B5:n loppukatselmus.

**Lomakkeen täsmäesikatselu työpuussa 6.10.2026.** Säilytetty liite avataan
sähköpostilomakkeen omasta toiminnosta backendin palauttamalla lasku- ja
dokumenttikohteella. `openPreservedInvoicePdf` ei saa generointiporttia:
desktop käyttää nykyistä kohdekohtaista capabilityä, selain vain täsmä-GET-
osoitetta. Native-virhe ei vaihda selainpolkuun. Estetty popup ja avausvirhe
saavat kiinteän palautteen; keskeneräinen avaus estää kaksoiskutsun. Palaute
sidotaan liitteeseen, joten vanhan avauksen valmistuminen ei muuta uuden
liitteen tilaa. Selaimen onnistunut avaus tarkoittaa navigoinnin käynnistystä,
ei PDF-vastauksen eheyden tai onnistumisen vahvistusta.

Riippumaton katselmus löysi nykyisestä valmisteluhookista vanhentuneen
vastauksen puutteen. Vanha liite palautui sekä 409/500-valmisteluvirheen
jälkeen että samalle laskulle palattaessa myöhäisestä vastauksesta. Kaikki
kolme tilannetta toistettiin ennen korjausta. Uusi valmistelu tyhjentää
aiemman esikatselun; clear/unmount mitätöi pyyntösukupolven. Vanha vastaus
ei palauta kohdetta, virhettä, pending-tilaa tai onnistumista callerille.
Sama katselmoija vahvisti lähdekorjauksen ilman uusia löydöksiä.

Webin 885 testiä 150 tiedostossa, web-build ja koko työtilan tyypitys
läpäisivät. Seitsemän esikatselun selaintapausta läpäisivät kohdeajoissa.
Vanhan pyynnön catch/finally-haaran valmistuminen todistetaan lisäksi
kolmessa yksikkötapauksessa odottamalla sen koko komentolupausta uudemman
pyynnön pysyessä pidätettynä. Pelkkä HTTP-vastauksen valmistuminen ei ole
riittävä todiste hookin tilakirjoitusten päättymisestä. Rajattu riippumaton
jatkokatselmus hyväksyi tämän näyttörajan. Ensimmäisten uusien testien
kaksi valitsinvirhettä korjattiin säilyneestä DOM-näytöstä; aikarajoja tai
hyväksyntäehtoja ei muutettu eikä hylättyjä ajoja nimetty läpäisyiksi.
Selainkokeet käyttävät nykyistä eristettyä web-fixtureä sekä
eksplisiittistä preserved-preflight-testisovitinta. Native-callback korvataan
testissä, ja popupin osoite todistetaan synteettisellä vastauksella, ei PDF-
renderöinnillä. Tavallisen laskun `INV-LIFECYCLE-001` läpäisi myös korjauksen
jälkeen. Varsinainen legacy-lähteen valinta ja PDF-tavut on todennettu yllä
backendissä; tämä osanäyttö ei yhdistä niitä vielä oikeaksi Electron-poluksi.
Uusi avauspainike tarkistettiin myös kapeassa näkymässä; koko nykyistä
työpöytälomaketta ei tämän perusteella nimetä mobiilikäyttöliittymäksi.

Popupin paikallinen virhe ei tuota business-auditia tai uutta lokityyppiä.
Backendin lukuvirheet käyttävät yllä todennettua nykyistä HTTP-diagnostiikkaa.
Esikatselu ei muuta toimitushistoriaa eikä anna lähetysvaltuutusta.
Tätä seurannut SMTP-kohdesidonta on kuvattu alla. Historian käyttöliittymä
ja B5:n katalogi-/palautushyväksyntä ovat edelleen avoinna.

**Asiakas-SMTP:n kohdesidonta työpuussa 6.10.2026.** Prepare ja send vaativat
saman esikatselun `documentTarget`-kohteen. Tunniste on normalisoimaton
1–100 merkin ASCII-resource-id; kohteessa sallitaan vain `kind` ja
`documentId`. Backend valitsee alkuperän pysyvästä revisiosta ja laskun
tilasta. Legacy-haara lukee jo olemassa olevan säilytetyn kopion ja lähteen
uudelleen; SMTP-valmistelu ei luo puuttuvaa kopiota tai regeneroi PDF:ää.
Tavallinen lähetys tarkistaa esikatselun dokumentin ja nykyrevision.
Fingerprint, nykyinen 60 sekunnin kertalupa, atominen varaus ja täsmäkuittaus
säilyvät. Välissä syntynyt estävä toimitus estää provider-kutsun.

API-client serialisoi vain nimetyt kentät ja validoi vastauksen variantin
sekä liitteen saman ID:n. Lomake säilyttää lähetetyn kohteen valmistelun
ajan; eri laskuun tai dokumenttiin viittaava vastaus ei käynnistä sendiä.
Säilytettyä liitettä ei voi käyttää itselle-SMTP-testissä tai dry-run-sendissä.
Desktop estää asiakasvalmistelun ennen backend-kutsua, jos native-vahvistaja
puuttuu. Main vertaa vastauksen kohdetta alkuperäiseen pyyntöön eikä luovuta
kertalupaa rendererille ennen hyväksyntää. Säilytetyn PDF:n vahvistus kertoo
vanhan sisällön todentamisen rajan ja näyttää todellisen vastaanottajan,
viestin sekä liitteen. Peruutus, poikkeama tai väärä kohde ei palauta tokenia.

Laskutuksen ja compositionien 1 747 testiä 137 tiedostossa, API-clientin
266 testiä, webin 50 kohdetestiä ja desktopin 72 kohdetestiä läpäisivät.
Koko työtilan tyypitys läpäisi. Ensimmäisen tyyppiajon uusi testifixture
korjattiin vertaamaan tallennusportin oikeaa tiedostoevidenssiä; tuotannon
eheysvaatimusta ei muutettu. Oikea legacy-composition todentaa tavut,
varauksen, historiallisen aineiston säilymisen ja olemassa olevan
Diagnostics-/tukipaketti-/incident-lukuketjun ilman raakasisällön vuotoa.
Rajattu riippumaton lähdekatselmus ei löytänyt uusia korjattavia puutteita.
Native-kohdetestit käyttävät Electron-sovitinta. Niiden jälkeiset kaksi
development-Electron-koetta läpäisivät oikean protokollan, mainin vahvistuksen
ja backendin kautta: hyväksyntä säilytti toimitustapahtumassa täsmälleen
alkuperäiset PDF-tavut, peruutus ei luovuttanut tokenia eikä luonut toimitusta.
Vain OS-dialogi ja SMTP-provider ovat näissä nykyisiä testisovittimia.
Tämä todistaa normaalirevision ketjun, ei vielä legacy-kokonaispolkua tai
paketoitua palautusta. Koko B3–B5:n PR-/main-portit ja loppukatselmus
säilyvät erillisinä.

Viiden selainpolun kohdeajo läpäisi: tavallinen laskun elinkaari,
peruminen, epävarman SMTP-tuloksen jälkeinen esto sekä kaksi täsmäkohteen
lomakekoetta. Jälkimmäiset käyttävät eksplisiittisiä prepare/send-
testisovittimia, eivät oikeaa legacy-SMTP- tai native-vahvistusta.
Ensimmäinen ajo hylkäsi uuden perumistestin valmistelukutsun ylimääräisen
JSON-rungon. Testi sovitettiin reitin olemassa olevaan rungottomaan
sopimukseen; tuotannon validointia, aikarajoja tai uusintaehtoja ei muutettu.

Koko web-sarja läpäisi tämän jälkeen 900 testiä 151 tiedostossa. E2E:n
JSON-runkojen sopimustesti, web-/desktop-buildit sekä uusien Electron-testien
tyypitys läpäisivät. Riippumaton loppukatselmus kattoi myös kaksi
Electron-testiä ilman uusia löydöksiä. Jälkilukuvirheen käyttäjäpalaute on
tämän jälkeen kohdetodennettu yllä kuvatusti. Historian käyttöliittymä ja
B5:n palautustodennus ovat seuraavat avoimet osat.

Dokumentin nykyinen unique `(company_id, invoice_id, document_type)` korvataan
revision unique-ehdolla. Alkuperäiselle legacy-riville säilyy oma partial-unique;
säilytetty legacy-kopio on yksilöity lähdedokumenttiin eikä joka prepare tee
uutta identtistä PDF:ää. Uusi storage-polku sisältää dokumentti-ID:n eikä
koskaan jaa vanhan tai toisen revision tiedostoa. Uuden polun törmäys myös
legacy-riviin torjutaan. Vanhat polut pysyvät sellaisinaan migraatiossa.

Uusien SMTP-tapahtumien partial-unique `(company_id, invoice_id)` estää
kahden `attempted`/`outcomeUnknown`-varauksen rinnakkaisuuden. Vanhoja useita
epäselviä tapahtumia ei poisteta indeksin luomiseksi: varaus tarkistaa myös
legacy-estot saman kirjoitustransaktion sisällä. `legacyUnknown` ei ole
uuden lähetyksen sallittu moodi. Nykyinen cancelin kaikkia providereita
koskeva onnistuneen/epäselvän toimituksen esto säilyy; B-P2:n rajattu
itselle-testin muokkauslupa koskee reopenia, ei uutta cancel-sääntöä.

<a id="m1-source-preparation-l9622"></a>

##### Dokumentti- ja tapahtumasidoksen SQL-osakoe

Eristetty valmistelukoe käytti oikeaa nykyistä migraatiorunneria,
muuttumattomia migraatioita 001–038 ja ehdotettua dokumentti-/tapahtuma-DDL:ää.
Revision vanhempi oli tässä vain avainfixture: koe ei vielä toteuttanut
täydellistä sisältösnapshotia, historiallisten rivien lähdesidosta tai
hyväksynnän julkaisua. Tämä aiempi osakoe ei ole numeroidun migraation näyttö.

Täsmennetty viiteavainketju on seuraava; jokaisella vanhemman sarakejoukolla
on vastaava eksplisiittinen UNIQUE-avain:

- Dokumentin yritys/lasku sidotaan `invoices(company_id, id)`-avaimeen ja
  revision variantti lisäksi revision `(company_id, invoice_id, id)`-avaimeen.
- Tapahtuman `(company_id, invoice_id, document_id, binding_kind)` viittaa
  dokumentin samaan identiteettiin ja varianttiin. Tämä ehto pysyy voimassa
  myös preservedLegacy-variantissa, vaikka `revision_id` on null.
- Revision tapahtuma sidotaan lisäksi dokumentin
  `(company_id, invoice_id, id, revision_id)`-avaimeen. Uuden tapahtuman
  hash/koko sidotaan dokumentin `(company_id, invoice_id, id, sha256, size_bytes)`-
  avaimeen. Variantin CHECK vaatii nämä arvot; nullable-FK ei korvaa sitä.
- Säilytetyn legacy-kopion lähde sidotaan saman yrityksen/laskun alkuperäiseen
  dokumenttiin ja samoihin hash/koko-arvoihin. Lähteen legacyOriginal-variantti
  tarkistetaan erikseen. Kopio ei voi olla uuden kopion lähde.

Migraatio kopioi legacyOriginal/legacyUnknown-rivit ennen uusien lisäysten
suojien käyttöönottoa. Ajonaikainen kirjoitus ei saa luoda lisää tämän
provenanssin rivejä. Migroidun legacy-tapahtuman kaikki kentät, myös
lopputulos ja virhetieto, jäädytetään. Yleinen completion-operaatio ei saa
muuttaa vanhaa epäselvää lähetystä jälkikäteen epäonnistuneeksi tai
onnistuneeksi. Tämä ei ratkaise vanhan laskun tulevaa lähetyskelpoisuutta.
Julkaistun dokumentin sekä uuden tapahtuman identiteetin,
sidoksen, moodin ja alkuperäisten viestikenttien muutos/poisto torjutaan.
Pelkkä UPDATE/DELETE-trigger ei riitä: koe toisti `INSERT OR REPLACE`- ja
`UPDATE OR REPLACE`-käskyjen kautta syntyvän historian korvautumisen.
Ehdotuksen lisäys- ja päivityssuojat tarkistavat myös kilpailevat PK- ja
partial-unique-avaimet ennen korvausta. Adaptereissa ei käytetä REPLACEa
historian kirjoituksiin. Suojat eivät perustu muutokseen yhteyden
`recursive_triggers`-asetuksessa.

Korjatun ehdotuksen 57 rajattua koetta läpäisivät. Näyttö kattaa alkuperäisten
arvojen/nullien ja katalogin säilymisen, toistuvan migraatiokutsun,
viite-/variantti-/hash-/koko-/yritysrajat, revision oman PDF:n yksilöinnin,
uudet rinnakkaiset epäselvät SMTP-varaukset, historiarivien korvausyritykset
sekä metadatakirjoituksen epäonnistumisen täydellisen rollbackin.
Legacy-ankkuroinnin erillinen sitoutuminen todistettiin erikseen:
epäonnistunut uusi business-migraatio ei jää osittain voimaan.
Jo valmiiksi väärään laskuun viittaava vanha dokumenttisidos hylkäsi koko
siirron muuttamatta alkuperäistä; sitä ei korjattu nullittamalla. Säilymistä
testattiin myös ei-tyhjillä vanhoilla lopputuloskentillä ja kaikilla
nykyisillä provider-arvoilla. Legacy-kopion väärä hash/koko testattiin
erikseen ilman samanaikaista duplicate-source-ristiriitaa. Uusi
manuaalivariantti sallii vain nykyisen callerin manual/print-menetelmät ja
manual-providerin; vanhoja muita arvoja ei muuteta tämän rajauksen vuoksi.
Rajattu riippumaton kenttä-/portti- ja SQL-katselmus tarkensi legacy-
lopputuloksen jäädyttämisen, manuaalivariantin rajauksen ja kielteisten
kokeiden eristyksen. Näiden korjausten jälkiluku ei jättänyt avoimia
korjaushavaintoja tähän osaan; se ei ole koko V1:n katselmushyväksyntä.

Tämä on **DDL-ehdotuksen osatodiste**, ei valmis migraatio tai lähetysoikeus.
Uusien unresolved-rivien unique ei yksin estä vanhan legacy-historian
ohittamista: runtime-varauksen on edelleen tarkistettava kaikki legacy-estot,
status ja nykyrevisio samassa kirjoitustransaktiossa. SQL:n polkuvertailu ei
korvaa tiedostojärjestelmän containment-/tyyppi-/alias-/tavutarkistusta.
Lopullisen DDL:n testit tulevat versionhallintaan sen toteutuksen mukana;
valmistelukoe ei korvaa niitä tai B5:n palautustodistusta.

<a id="m1-source-preparation-l9688"></a>

#### Porttien katselmointiehdotus

`InvoiceContentRevision` on muuttumaton sisältö, ei laajennettu elävä
`ApprovedInvoiceView`. `InvoiceDocumentBinding` erottaa tyypitettynä
`revision`- ja `preservedLegacy`-variantin. `legacyOriginal` on vain vanhan
aineiston luku-/migraatiotyyppi, ei uuden provider-kutsun varausvaihtoehto.
`InvoiceDeliveryReservation` sisältää pysyvän event-ID:n, company/invoice-
rajan, moodin, bindingin ja tarkistetun dokumentin hashin/koon. HTTP tai
renderer ei voi valita provenanssia tai luotettua company-kontekstia.

Tarkennettu sisäinen tyypitysehdotus sitoo myös sallitun moodin varianttiin.
Tässä `scope` tulee backendin luotetusta kontekstista, ei request-bodysta;
tyyppi ei itsessään korvaa oikeus-, sisältö- tai varaustarkistusta:

```ts
type InvoiceScope = Readonly<{ companyId: string; invoiceId: string }>;
type RevisionKey = InvoiceScope & Readonly<{ revisionId: string }>;
type RevisionBinding = Readonly<{
  kind: 'revision'; revisionId: string; sourceDocumentId?: never;
}>;
type PreservedLegacyBinding = Readonly<{
  kind: 'preservedLegacy'; sourceDocumentId: string; revisionId?: never;
}>;
type DocumentEvidence = Readonly<{
  documentId: string; sha256: string; sizeBytes: number;
}>;
type RevisionTarget = InvoiceScope & DocumentEvidence & RevisionBinding;
type PreservedLegacyTarget = InvoiceScope & DocumentEvidence & PreservedLegacyBinding;
type InvoiceDeliveryReservation =
  | Readonly<{ eventId: string; mode: 'customer'; target: RevisionTarget | PreservedLegacyTarget }>
  | Readonly<{ eventId: string; mode: 'smtpTest'; target: RevisionTarget }>;

type ReservedEmailFields = Readonly<{
  recipientEmail: string;
  ccEmail: string;
  subject: string;
  bodyPreview: string;
  createdAt: string;
  createdBy: string;
}>;
type ReserveEmailDeliveryInput = InvoiceDeliveryReservation & ReservedEmailFields;
type ReserveEmailDeliveryResult =
  | Readonly<{
      outcome: 'reserved';
      reservation: InvoiceDeliveryReservation;
      invoiceStatusAtReservation: 'approved' | 'sent';
    }>
  | Readonly<{ outcome: 'conflict' }>;
type EmailCompletionResult = Readonly<{
  outcome: 'completed' | 'alreadyCompleted';
}>;
type EmailSuccess = Readonly<{
  status: 'succeeded'; providerMessageId: string | null;
}>;
type EmailUnsuccessfulOutcome = Readonly<{
  status: 'failed' | 'outcomeUnknown';
  safeErrorMessage: string | null;
  technicalErrorCode: string | null;
}>;
type CustomerEmailCompletionInput = Readonly<{
  reservation: Extract<InvoiceDeliveryReservation, { mode: 'customer' }>;
  result: EmailSuccess;
}>;
type OtherEmailCompletionInput =
  | Readonly<{
      reservation: Extract<InvoiceDeliveryReservation, { mode: 'smtpTest' }>;
      result: EmailSuccess;
    }>
  | Readonly<{
      reservation: InvoiceDeliveryReservation;
      result: EmailUnsuccessfulOutcome;
    }>;
```

`ReservedEmailFields` säilyttää vain nykyisen tapahtuman viestikentät:
täyttä bodya, salaisuutta tai kertavaltuutuksen tokenia ei lisätä tauluun.
Application muodostaa nykyisten sääntöjen mukaisen bodyPreviewn. Asiakas-
lähetyksessä tallennetaan todelliset to/cc-arvot, itselle tehtävässä testissä
pakotettu testivastaanottaja ja tyhjä cc. Fingerprint sitoo edelleen koko
viestin, lähettäjän, aiotun vastaanottajan ja testin todellisen vastaanottajan.
Status varaushetkellä on adapterin lukema tulos, ei callerin päätös tai uusi
historiakenttä. Provider saa alkuperäisen vahvistetun viestin ja jo tarkistetut
PDF-tavut, ei tapahtuman lyhennettyä bodyPreviewta.

LegacyOriginal ei kuulu kumpaankaan varaukseen. Revision PDF:n julkaisu
ottaa vain `RevisionKey`-kohteen ja revision oman ehdokkaan; säilytetyn
legacy-kopion julkaisu on erillinen kapea operaatio, joka vaatii tarkan
lähdedokumentin. Molemmat palauttavat published/existing/conflict-tuloksen,
mutta tuloksen dokumenttityyppi vastaa kyseistä operaatiota. Saman
generointimetodin ei pidä hyväksyä kumpaakin varianttia valinnaisin kenttin.

`getCurrentRevision(scope)` ja `getRevision(key)` palauttavat sisällön sen
alkuperän erottelevana tyyppinä. Legacy-snapshotin saatavuudeltaan tuntematon
ALV-erittely ei ole sama kuin käännetyn ALV:n tunnetusti tyhjä erittely.
Hyväksyntäadapterin sisäinen paluuarvo välittää juuri julkaistun revision
PDF-hookille; hook ei lue myöhemmin määrittelemätöntä uusinta versiota.

Varaus ottaa tarkistetun kohteen ja nykyiset vastaanottaja-/viestikentät,
palauttaa reserved/reservation tai conflict ja muodostaa pysyvän attempted-
rivin ennen verkkoa. Onnistunut asiakaslähetys käyttää nykyistä
`InvoiceEmailDeliveryFinalizer`-vastuuta; testi- ja virhetulokset nykyistä
tapahtuman completion-vastuuta. Molemmat ehdollistetaan samaan varaukseen.
Sama terminal-kuittaus on idempotentti, eri kuittaus ristiriita; pelkkä
event-ID ei riitä. Aikatieto ei saa tehdä toistetusta samasta kuittauksesta
uutta toimitusta. Mahdollista erillistä completion-aikaleimaa ei lisätä
vahingossa vain rajapintaluonnoksen vuoksi.

Kuittauksen idempotenssi tarkoittaa pysyvien sivuvaikutusten toistamattomuutta,
ei myöhemmän laskunäkymän väittämistä alkuperäiseksi HTTP-vastaukseksi.
Finalizerin `alreadyCompleted` ei laske `wasResend`-arvoa uudelleen nyt
sent-tilassa olevasta laskusta eikä muuta `updated_at`-aikaa. Ensimmäisen
lähetyksen application-vastaus saa resend-tiedon juuri tehdyn varauksen
`invoiceStatusAtReservation`-arvosta ja ajantasaisen näkymän nykyiseltä
lukijalta. Saman kuittauksen tunnistaminen vertaa pysyvää event-ID:tä,
company/invoice-rajaa, moodia, koko dokumenttisidosta ja normalisoituja
lopputuloskenttiä; ristiriita käyttää nykyistä `InvoiceDeliveryConflictError`-
virhettä. `created_at` on varauksessa tallennettu nykyinen toimitusaika:
kuittaus ei ota uutta callerin `sentAt`-arvoa eikä luo toista tapahtumaa.
Kuittauksen toisto ei anna lupaa providerin uudelleenkutsuun. Restartin
jälkeen ratkaisematon varaus estää uuden lähetyksen; automaattista
lopputuloksen selvittämistä tai SMTP:n exactly-once-lupausta ei lisätä.

Historian `findEventDocument(scope, eventId)` erottaa document-,
legacyMissingDocument- ja ei-tapahtumaa-tuloksen. Historiallinen null on
sallittu vain omassa variantissaan. Ei-null-viitteen kadonnut tai väärä
dokumentti on eheysvirhe, ei lupa latest-fallbackiin tai regenerointiin.

| Omistava portti / adapteri | Tarkennettava operaatio ja käyttäjät |
| --- | --- |
| Uusi kapea `InvoiceContentRevisionReader` | Nykyinen tarkistettu sisältö hyväksyntä-/PDF-/prepare-poluille sekä erillinen tapahtuman sisältö historian lukuun. Ei muuta `ApprovedInvoiceReader`-lukijan yleistä statuskelpoisuutta. |
| Nykyiset approval-/credit-approval-adapterit | Julkaise yksi valmiiksi laskettu snapshot, rivit ja erittely samassa numerointi/projektio/audit-transaktiossa. Reapprove säilyttää lasku-ID:n ja numeron mutta julkaisee uuden revision. Legacy-siirtymä on erillinen alkuperästä ehdollinen kirjoitus, ei jokaisen luvun fallback. |
| `InvoiceDocumentRepository` | `findDocumentForRevision`, yritys-/laskurajattu tarkka ID-luku sekä `publishDocumentIfCurrent` odotetulla revision-ID:llä. Julkaisu palauttaa published/existing/conflict; olemassa olevan voittajan tiedostoa ei poisteta hävinneen kirjoittajan siivouksessa. Laskukohtainen massapoisto poistuu näiltä poluilta. |
| `InvoiceDocumentStorage` | Omalla uudella ID-polulla exclusive-kirjoitus; rajattu luku palauttaa yhden puskurin. PDF/containment/tyyppi/hash/koko tarkistetaan ennen käyttöä. Provider käyttää samaa puskuria, ei myöhempää uutta polkulukua. |
| `InvoiceDeliveryEventRepository` | Atominen `reserveEmailDelivery`: current-revisio/status, tarkka dokumenttisidos ja persistent unresolved/legacy-estot tarkistetaan `immediate`-transaktiossa ennen provideria. Hylkäys ei käynnistä verkkoa. Nykyinen yleinen `saveDeliveryEvent` ei saa jäädä SMTP:n ohituspoluksi. |
| Nykyinen email-finalizer ja tapahtuman completion | Kaikki lopputulokset ehdollistetaan saman varauksen ID:hen, moodiin ja bindingiin. Customer-success muuttaa vain sidotun nykyisen laskun sent-tilaan; smtpTest-success ei muuta tilaa. Terminal-kuittauksen toisto ei lisää tapahtumaa tai auditia; eri sisältöinen kuittaus torjutaan. |
| Nykyinen manual-finalizer / dry-run | Manuaalisen event/tila/audit-transaktion unresolved-esto säilyy ja saa tarkan revision/document-bindingin. Dry-run kirjataan omalla moodillaan eikä sitä tulkita ulkoiseksi SMTP-varaukseksi tai toimitusvarmuudeksi. Sen jo hyväksytty tilakäyttäytyminen säilyy. |
| `InvoiceDeliveryEventReader` ja historian PDF-käyttötapaus | Yritysrajattu laskuidentiteetin olemassaolo myös reopened-tilassa, tapahtuma -> tarkka katalogoitu dokumentti. Permissionit säilyvät. Historian luku ei palauta lähetysvaltuutta eikä generoi puuttuvaa PDF:ää. |

Toteutuksen tiedostorajaus ja sopimuksen sulkeminen:

- `domain/invoiceContentRevision.ts` määrittää eksplisiittisen muuttumattoman
  sisältötyypin yllä olevan kenttälistan mukaan. Domain ei importoi
  `database/schema.ts`:ää eikä kopioi koko API-vastausta. `legacySnapshot`
  erottaa unavailable-erittelyn authoritative-variantista; vain jälkimmäisen
  `approval`/`validatedLegacySnapshot` kelpaa uuden revision PDF-lähteeksi.
- `ports/invoiceContentRevisionReader.ts` sisältää
  `getCurrentRevision(InvoiceScope)` ja `getRevision(RevisionKey)`:
  `Promise<InvoiceContentRevision | undefined>`. Ei löydettyä kohdetta
  tarkoittaa vain olematonta scoped-avainta; rikkinäinen ei-null-viite tai
  virheellinen sisältö on eheysvirhe, ei undefined tai fallback.
- `domain/invoiceDocumentBinding.ts` omistaa yllä olevat suljetut bindingit;
  `ports/invoiceDocumentRepository.ts` omistaa revision ja preservedLegacy-
  julkaisujen erilliset input-/result-tyypit. Kummassakin tulos on
  published/document, existing/document tai conflict; palautuvan dokumentin
  variantti vastaa kutsua. `findDocumentForRevision(RevisionKey)` ja
  `findDocumentById(InvoiceScope & { documentId: string })` eivät muuta
  kelpoisuutta. Application tarkistaa nykyrevision erikseen ennen käyttöä.
- Julkaisun ehdokas sisältää omalla exclusive-polulla kirjoitetun tiedoston
  metadatan, ei callerin antamaa yhteistä storagePathia. Nykyinen
  `InvoiceDocumentStorage` säilyy tiedostovastuuna; exclusive-kirjoitus ja
  metadataa vastaan varmennettu rajattu luku ovat sen nimetyt operaatiot.
  Vain lukijan palauttama tarkistettu puskuri menee providerille.
- `ports/invoiceDeliveryEventRepository.ts` saa
  `reserveEmailDelivery(ReserveEmailDeliveryInput): Promise<ReserveEmailDeliveryResult>`
  ja `completeDeliveryEvent(OtherEmailCompletionInput): Promise<EmailCompletionResult>`.
  `ports/invoiceEmailDeliveryFinalizer.ts` saa
  `completeSuccessfulEmailDelivery(CustomerEmailCompletionInput): Promise<EmailCompletionResult>`.
  Nykyinen `SqliteInvoiceDeliveryEventRepository` toteuttaa nämä vastuut;
  uusi yleinen varaus-/historiapalvelu ei ole tarpeen.
- `recordInvoiceDeliveryEvent`/`saveDeliveryEvent` rajataan nykyisistä
  callereista vain erikseen tyypitettyyn dry-run-kirjaukseen. SMTP kulkee
  aina varausoperaation kautta, manual sen oman atomisen finalizerin kautta.
  Dry-run ei muuta laskun tilaa eikä esitä oikeaa SMTP-toimitusta.
  Uuden SMTP:n ja legacyUnknownin luonti yleisellä save-portilla torjutaan
  myös runtime-adapterissa, ei vain TypeScriptillä.
- Approval-/credit-approval-portit palauttavat uuden revision avaimen vain
  backendin sisäisessä tuloksessa PDF-hookille; julkinen strict-vastaus
  säilyy erillisessä mapperissa. Reopenin
  `removedDocumentStoragePaths`-paluuarvo ja sitä seuraava julkaistujen PDF:ien
  poistokierros poistuvat korvatuista callereista. Uusi current-osoitin ei
  anna oikeutta muuttaa vanhaa revisiota tai dokumenttia.

Tämän sopimuksen kohdetodisteet tehdään varsinaisten porttien toteutuksessa:
väärän moodin/variantin tyypityshylkäys, samanaikainen reopen/cancel/reserve,
väärä company/revisio/dokumentti/hash/koko, legacy-unresolved uusien
varausten edellä, viiveellinen vanhan revision PDF-julkaisu ja vain oman
ehdokkaan siivous. Finalizer testataan molemmissa moodeissa sekä kaikissa
lopputuloksissa: sama kuittaus on no-op, eri kuittaus hylätään ja onnistunut
testilähetys ei tee sent-siirtymää. Myös uudelleenlähetyksen resend-palaute,
viestin pysyvät kentät ja providerille menevät todelliset tavut todennetaan.
Pelkkä tyyppitarkistus tai SQL-ehdotuksen koe ei ole tämä runtime-näyttö.

Rajattu tyyppikoe tarkisti tämän dokumentin varsinaisen TypeScript-lohkon:
kuusi sallittua varausta/kuittausta hyväksyttiin ja neljä kiellettyä
moodi-/binding-yhdistelmää hylättiin. Kielteiset kontrollit poistamalla
odotettu virhemerkintä tuottivat kukin todellisen tyyppivirheen. Tämä on
luonnoksen tyypitysnäyttö, ei runtime-valtuus tai vielä tuotantoon kytketty
porttitoteutus.

Julkaistu dokumenttirivi on säilytettävää aineistoa. Epäonnistunut cache-luku
ei enää poista sitä eikä regeneroi päälle. Reopen mitätöi vain nykyisen
revision käyttökelpoisuuden. Julkaisemattoman hävinneen ehdokkaan siivous
rajoittuu sen omaan polkuun. Olemassa olevan dokumentin korruptio ilmoitetaan
turvallisesti ja säilytetään tutkittavaksi; tämä ei lisää automaattista
historiallisten PDF:ien korjaajaa.

Valmistelutunnisteen fingerprintiin kuuluvat revision/bindingin identiteetti,
dokumentti ja todellisista tavuista varmennettu hash/koko sekä nykyiset
vastaanottaja-/viestikentät. Native-vahvistus esittää juuri tämän kohteen.
Send ei vaihda valmistelun jälkeen uuteen current-PDF:ään automaattisesti.
In-memory-kertatunniste säilyy valtuusrajana, mutta sen katoaminen restartissa
ei vapauta pysyvää attempted/outcomeUnknown-varausta. DB-transaktioon ei
tule `await`-verkko- tai tiedostotoimintoa.

Nykyisten lukijoiden säilyvät vastuut: `getApprovedInvoice`,
`copyApprovedInvoiceToDraft`, credit-draftin create/get/update, approved-
summary-, sent-group-, payment- ja credit-context-lukijat saavat edelleen
yhden laskuidentiteetin nykytilan. Versioita ei liitetä listoihin tai
saataviin monistavalla liitoksella. `prepareApprovedInvoiceEmailSmtp`,
`prepareApprovedInvoiceEmailSmtpTest`, niiden send-polut, dry-run, manual-
delivery sekä approval/credit-approvalin PDF-kytkentä siirtyvät samaan
tarkkaan sisältösopimukseen. PDF metadata/download ja toimitetun arkistokopion
tehtävä käyttävät oikeaa document-ID:tä, eivät uutta laskukohtaista latest-hakua.

<a id="m1-source-preparation-l9912"></a>

#### Migraation järjestyksen näyttö ja jatko

Rajattu synteettinen koe käytti nykyistä `runMigrations`-runneria sekä
kopioituja muuttamattomia historiallisia migraatioita ja yhtä lisättyä
koemigraatiota. Nykyiset dokumentti- ja tapahtumataulut kopioitiin uusiin
tauluihin. Vanha tapahtumataulu pudotettiin ennen vanhaa dokumenttitaulua,
minkä jälkeen uudet taulut nimettiin ja indeksit palautettiin. Dokumenttien
ja tapahtumien kaikki arvot, myös alkuperäinen null-viite, sekä nykyisen
omistavan katalogin tulos säilyivät. `foreign_key_check` oli puhdas ja
runnerin toinen kutsu ei tehnyt uutta migraatiota.

Viisi pakotettua virhekohtaa (luonti, kopiointi, vanhan lapsen poisto,
vanhan vanhemman poisto ja uudelleennimeäminen) palauttivat alkuperäisen
skeeman, rivit ja migraatiometadatan. Vastakontrolli toisti parent-first-
poiston `SET NULL` -haitan ja perui sen transaktiolla. **Tämä todistaa
korvausjärjestystä, ei vielä yllä ehdotetun uuden skeeman kaikkia ehtoja.**

Riippumaton lähdekatselmus varmisti rajatun FK-verkon: vain toimitustapahtumat
viittaavat dokumentteihin, eikä toimitustapahtumatauluun ole muista tauluista
FK:ta. Invoices-/invoice_lines-tauluja ei tarvitse korvata tämän siirron vuoksi.
Uusi metadata ja migraatiorivi kuuluvat kyseisen migraation transaktioon.
Sen sijaan nykyinen legacy-metadatan ankkurointi tapahtuu ennen sitä omassa
transaktiossaan ja voi jäädä voimaan myöhemmän migraation epäonnistuessa.
Tämä hyväksytty valmisteluvaihe ei ole osittain julkaistu business-migraatio;
sen erillinen rollback-tapaus ja uuden metadatakirjoituksen virhe testataan
varsinaisen SQL:n kanssa. Kiinteä 038-legacy-ankkuri säilyy muuttumattomana.

Varsinainen uusi numeroitu migraatio tekee samaan transaktioon revision
rakenteet, vanhan nykytilan eksplisiittisen legacy-kopion, tarvittavan
current-osoittimen ja doc/event-sidonnat. `reopened_for_edit` ei saa
lähetyskelpoista current-osoitinta. Vanhat tapahtumat saavat legacyOriginal/
legacyUnknown-provenanssin ilman document-ID:n, statuksen tai moodin arvailua.
Migraation ei tarvitse päätellä käyttäjän tarkoittamaa SMTP-käyttötapaa.
LegacySnapshotin hallittu nostaminen tarkistetuksi uudeksi sisältörevisioksi
edellyttää yllä hyväksyttyä ei-ulkoista-historiaa-politiikkaa ja nykyisten
summien yhteensopivuustarkistusta. Vanhaa PDF:ää ei sidota siihen.

Uuden dokumentti-FK:n delete-toiminto on `RESTRICT`, ei `SET NULL`.
Migraatio säilyttää vanhat sallitut nullit, mutta ei salli uuden sidotun
historian hiljaista katkaisemista. Uuden skeeman constraint-, variantti-,
foreign-company-, immutability-, credit-source- ja atomisen hyväksynnän
rollback-testit tehdään varsinaiselle SQL:lle. Ne eivät korvaudu tällä
taulunsiirtokokeella. Nykyisiä numeroituja SQL-tiedostoja ei editoida.

Katalogivalidointi valitsee tunnetun ennen B3:a olevan skeeman tai uuden
skeeman luotetusta migraatioprefixistä; puuttuva uusi sarake ei valitse
legacy-fallbackia. `SqliteInvoiceBackupArtifactCatalog` omistaa varianttien
viiteketjut ja listaa myös vanhat revisiot/legacy-kopiot. Ennen ja jälkeen
forward-migraation vaaditaan sama alkuperäinen katalogi. Uuden aineiston
palautus tarkistaa lisäksi history/current/source/doc/event-sidokset.
Backup-artifact-inventaario, Invoicingin moduuliohje, integraatiomatriisi ja
palautusohje päivitetään toteutuksessa; tämän suunnitelman ehdotusta ei vielä
merkitä niissä toteutuneeksi.

Versionvalinnan tarkennettu kytkentä, polut `apps/backend/src`-juuresta:

| Nykyinen lukukohta | B3/B5:ssa vaadittu välitys |
| --- | --- |
| `runtime/profileSnapshot/inspectSqliteProfileDatabase.ts` | Palauta jo tarkistetusta `MigrationHistoryInspection`-tuloksesta myös käytössä oleva tunnettu migraatioprefixi. `restoreCompatible` säilyttää nykyisen tarkan 038-legacy-ankkurin; virhe ei anna yleistä legacy-fallbackia. |
| `runtime/profileSnapshot/validateProfileSnapshot.ts` → `validateProfileArtifactCatalog.ts` | Välitä juuri tarkistetun staging-tietokannan prefixiin perustuva katalogitila. Ennen forward-migraatiota vanha katalogi validoidaan vanhalla sopimuksella; nykyisen sovelluksen pakettiversio ei yksin valitse uuden skeeman kyselyä. |
| `runtime/workspaceCandidate/runWorkspaceCandidateOperation.ts` | `migrateBackup` tarkistaa lähteen katalogin ja PDF:t lähdehistorian valitsemalla sopimuksella **ennen** `runMigrations`-kutsua. Containerin autentikointi ja purku eivät korvaa tätä. `validateAndMaterialize` käyttää tuoreesti vahvistettua, pending-migraatiotonta nykytilaa ja vertaa samaan alkuperäiseen katalogiin ennen materiaalistamista. `validateHistoricalPublished`/`historicalReadiness` säilyttää oman historiapolitiikkansa. |
| `runtime/profileSnapshot/validateActiveProfile.ts` | Callback palauttaa tarkistetun historian ennen katalogin valintaa; valinta ja palautettu chain kuuluvat samaan tarkastukseen. Eheän historiallisen prefixin pending-migraatio ei yksin hylkää eheyden tarkistusta. Normaalin business-runtimen nolla-pending-portti pysyy erillisenä migraatioiden jälkeen. |
| `http/app.ts`-snapshot-kokoaminen ja `composition/invoicingComposition.ts` | Snapshot-palvelut rekisteröidään jo ennen migraatiota, myös tyhjälle kannalle: portin kokoaminen on laiska, ja katalogitila valitaan `listAuthoritativeArtifacts()`-kutsussa luotetusta silloisesta historiasta maintenance-rajan sisällä. Normaali Invoicing-composition saa tilan vasta migraation jälkeisestä nykytilatarkistuksesta. Käytä samaa ratkaistua migrationsDirectorya kuin runner, myös kun optiona ei annettu hakemistoa. |
| `http/app.ts`-`beforeMigrations` ja desktopin `runtime/backendMessages.ts` | Sisäisesti rikastettu historiatulos **ei** mene sellaisenaan nykyiseen strict-viestiin. Eksplisiittinen projektio säilyttää neljä nykyistä kenttää: appliedMigrationCount, migrationChainIdentity, pendingMigrationCount ja profileState. Desktop-protokollaa ei laajenneta tällä valmistelulla. |
| `runtime/profileSnapshot/createConsistentProfileSnapshot.ts` → `stageProfileBusinessArtifacts.ts` | Nykyinen producer käyttää samaa yllä laiskasti koottua katalogiporttia. Snapshot-/broker-metadatan tai catalog-v1:n laajennus ei ole tarpeen. |

Invoicingin katalogiadapteri omistaa kaksi nimettyä skeemahaaraa ja niiden
SQL:n. Valinta ei tunnustele puuttuvia sarakkeita eikä käsittele SQL-virhettä
vanhan skeeman merkkinä. Uuden haaran tarkastus kattaa myös revision ja sen
sisällön viitesuhteet, vaikka kyseisellä revisiolla ei vielä olisi PDF:ää;
pelkkä dokumenttirivien läpikäynti ei todista koko historian eheyttä.
Sisäinen välitys käyttää nykyistä `MigrationHistoryInspection`-tulosta,
jossa ovat `readonly appliedMigrationNames` ja `migrationChainIdentity`.
`inspectSqliteProfileDatabase` palauttaa ne ja nykyisen `profileId`:n;
startup-tarkistus palauttaa nykyisen tuloksen sekä tarkistetut nimet
backendin sisäisenä `InspectedMigrationStartupState`-tyyppinä. Ulospäin
lähetettävä `MigrationStartupInspection` säilyy ennallaan. Tyhjällä kannalla
nimiluettelo on tyhjä, eikä siitä voi valita käyttökelpoista katalogia.

Pelkkä eheä pre-B3-prefix ei riitä. Nykyisen legacy-katalogin SQL vaatii
`018_create_invoice_documents.sql`:n, ja näissä profiilin backup/restore-
callereissa vaadittu identiteetti syntyy vasta
`025_create_local_runtime_identity.sql`:ssä. Profiilin tarkistus edellyttää
tämän nimetyn migraation sisältymistä vahvistettuun prefixiin sekä nykyisen
identiteettirivin validointia ennen katalogivalintaa. Jatkuva prefix takaa
samalla dokumentti-/tapahtumataulujen edeltävät migraatiot. Tämä nimeää
nykyisen aidosti migroidun profiilin edellytyksen, ei uutta lupausta kaikkien
025–038-julkaisujen backup-tuesta. Tyhjää tai tätä aikaisempaa historiaa ei
arvata legacy-katalogiksi. Metadataa sisältävälle historialle ei aseteta
uutta 038-minimiä metadataa vailla olevan erillisen poikkeuksen perusteella.

Invoicing-infrastruktuurin yksi nimetty valitsin
`selectInvoiceBackupArtifactCatalogSchema(history)` palauttaa
`'legacyDocuments' | 'revisionHistory'`. Uusi haara valitaan nimeltä
lukitun B3-tuotantomigraation esiintymisestä **tarkistetussa applied-prefixissä**,
ei manifestin viimeisestä tiedostosta tai pelkästä migraatiomäärästä.
Tuotantomigraation nimi keskitetään samaan omistavaan toteutukseen sen
lukitsemisen yhteydessä. Katalogin konstruktori,
`validateProfileArtifactCatalog` ja `InvoicingCompositionOptions` saavat
eksplisiittisen `schema`-arvon; optional/default-legacy-haaraa ei ole.
`CurrentActiveProfileValidationService` saa `readMigrationHistory`-callbackin, jota
kutsutaan kerran ennen katalogin SQL:ää ja jonka chain palautetaan tuloksessa.

Valittu katalogiskeema ja callerin historiapolitiikka eivät ole sama asia.
Nykyinen `inspectMigrationStartupState` voi hyväksyä eheän prefixin, jolla
on pending-migraatioita, myös `exactCurrentManifest`-nimisellä politiikalla.
Normaalin aktiivisen runtimen nolla-pending-portti säilyy erillisenä.
`validateActiveProfile` ei lisää tätä käynnistysporttia ennen migraatioita
rekisteröityyn eheyden tarkistukseen: business-rollback tarvitsee vanhan
profiilin validoinnin ennen binary rollbackia. Kutsuja vaatii oman
odotetun chain-identiteetin eikä validointi yksin avaa business-runtimea.
Historiallinen readiness säilyttää oman hyväksytyn pending-ehtonsa: joskus
myös revisionHistory-kanta voi olla historiallinen suhteessa myöhempään
manifestiin. Metadataa vailla oleva legacy-poikkeus säilyy vain nykyisessä
restoreCompatible-polussa kiinteän 038-ankkurin kautta; olemassa olevan
metadatan virhe ei koskaan valitse poikkeusta.

Versionvalinnan toteutustestit lukitaan seuraavasti:

- Tarkistettu vanha prefix nykyisine profiiliedellytyksineen, tyhjän ja
  liian aikaisen prefixin hylkäys, kiinteä 038-restore-poikkeus, sovellettu B3 ja
  B3 myöhempien pending-migraatioiden kanssa; puuttuva keskimmäinen,
  tuntematon tuleva tai väärän checksummin historia hylätään.
- Uuden historian puuttuva uusi sarake hylätään ilman fallbackia. Vanhan
  historian uuden näköiset sarakkeet eivät nosta sitä uuteen sopimukseen.
- Aktiivisen tarkistuksen callback suoritetaan kerran ennen katalogia;
  sen virhe estää katalogihaun ja palautuva chain on samasta tarkastuksesta.
- Workspace-tuonnin väärä lähdekatalogi estää migraation. Sama alkuperäinen
  katalogi vaaditaan migraation jälkeen; muutettu tai puuttuva dokumentti
  hylätään ennen materiaalistamista.
- Oikea composition: tyhjän kannan rekisteröinti, vanha pre-migration-
  snapshot, migraation jälkeinen snapshot, oletushakemiston käynnistys sekä
  ennallaan säilynyt nelikenttäinen desktop-viesti.
- Uuden katalogin tarkistus kattaa myös PDF:tä vailla olevan rikkinäisen
  revision, väärät company/current/source/doc/event-sidokset ja kaikki
  säilytettävät vanhat PDF:t. Koko ketju todennetaan B5:n paketoidussa
  backup -> inspect -> restore -> restart -> compare -ajossa.

Rajattu riippumaton katalogin lähdekatselmus löysi yllä täsmennetyt
pre-migration-, laiskan rekisteröinnin ja strict-viestin rajat. Ne ovat
toteutuksen ehtoja, eivät tässä jo tehtyjä korjauksia tai läpäistyjä testejä.
Tämä ei muuta catalog-v1:n avaimia, portable-containeria, rajoja tai
palautuksen no-merge-periaatetta eikä lisää yleistä migraatiopalvelua.

<a id="m1-source-preparation-l10056"></a>

#### Valmistelun porttien tila

Päivitetty 6.10.2026: valmistelun aiempi approved/SMTP-päätöseste on
ratkaistu. Alla olevat osat eivät korvaa B3/B4:n tai B5:n kokonaisnäyttöä.

1. ALV-lukupolun rajattu korjaus on toteutettu ja kohdetodennettu yllä
   kuvatulla näytöllä. Uuden revisiosnapshotin tallennus ja koko toimituksen
   HTTP/UI/PDF-ketju todistetaan varsinaisessa B3/B4-toteutuksessa; nykyinen
   korjaus ei sulje niitä tai historiallisten PDF:ien ristiriitoja.
2. Kenttä-/DDL-/constraint-ehdotus ja migraation järjestys on valmisteltu.
   Erityinen portti on lähtöketjun `invoice_documents`-unique-rajan muutos
   säilyttäen toimitusviitteet: vanha FK käyttää `ON DELETE SET NULL`,
   joten taulun uudelleenluontia ei käsitellä tavallisena huoltosiirtona.
   Täysi eristetty snapshot-/dokumentti-/tapahtumaehdotus sisältää nyt
   myös kentät ja hyvityksen lähderevision ehdot; sen 102 läpäisyä olivat
   valmistelun näyttöä. Numeroitu 039 on nyt erikseen katselmoitu ja
   kohdetodennettu yllä kuvatulla 117/117-sarjalla. Tavallisen hyväksynnän
   revisiokirjoituksen 13 kohdetestiä läpäisivät. Myöhempien kirjoittajien,
   hyvityksen, PDF:n ja toimitusporttien osanäyttö on kirjattu yllä oleviin
   checkpointteihin. Koko käyttöliittymä-/native-/palautusketjun näyttöä
   ei merkitä niiden perusteella valmiiksi.
3. Revision, dokumentin, toimitusvarauksen ja kuittauksen tyyppisopimukset,
   luku-/kirjoituspolut sekä katalogin luotettu versionvalinta on nimetty
   yllä. Historialuku ei laajenna tavallisen lähetyksen kelpoisuutta.
   Katalogi-/backup-formaattirajat ja nykyinen desktop-viesti säilyvät.
4. B-P3-taulukon vanha `approved` + tuntematon SMTP-moodi ratkaistiin
   omistajan hyväksymällä rajatulla selvitysestolla 6.10.2026. Nykyinen
   metadata ei edelleenkään oikeuta arvaamaan testin ja asiakaslähetyksen
   eroa tai vapauttamaan epävarmaa historiaa automaattisesti.
5. Riippumaton valmistelun kokonaiskatselmus ei löytänyt uutta estävää
   integraatioristiriitaa. Katalogin erillinen lähdekatselmus johti yllä
   kuvattuihin täsmennyksiin. Migraation ja Invoicing-perustan toteutus
   säilyttää vanhan tiedon. Rajattu selvitysesto on nyt hyväksytty;
   automaattista vapautuspäätöstä ei hyväksytty. Valmistelun aiempaa
   päätösestettä ei avata uudelleen pelkän vanhan checkpointin perusteella.
   Tuotantomigraation ja kirjoittajien rajattu näyttö on kirjattu yllä.
   Koko B3/B4-ketjun testit sekä B5:n
   packaged-palautustodistus ja uuden revision PR/main-portit ovat vielä
   tekemättä. Osittaista migraatio–caller-yhdistelmää ei julkaista käyttäjälle.
