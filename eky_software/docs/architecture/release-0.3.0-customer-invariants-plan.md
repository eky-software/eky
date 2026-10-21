# 0.3.0: Customersin invariantit, E-paketti

## Nykytila ja rajaus

E omistaa roadmapin R09-R11:n toteutuksen ja sen hyväksyntänäytön.
[Roadmap](release-0.3.0-plan.md) omistaa julkaisun työjärjestyksen ja
[M1](release-0.3.0-m1-preparation-plan.md#jatka-tästä) lyhyen jatkamiskohdan.
Lähtö on hyväksytty main `5e338ae74bb48130620c9db514bbe52a2e787782`
([PR #310:n loppuhyväksyntä](https://github.com/eky-software/eky/pull/310#issuecomment-6325552971)).
R09-R11 on toteutettu ja yhdistetty [PR #311:ssä](https://github.com/eky-software/eky/pull/311)
mainiin `d03e9a15a5c04e3d9fe56e81a69fda5e795b8e05`.
PR:n omat portit läpäisivät; mainin erillinen auditointihylkäys ja jäljempänä
rajattu tietoturvahuolto estävät vielä E-Goalin loppuhyväksynnän.
Alla oleva päivätty toteutuscheckpoint säilyy integraatiota edeltävänä näyttönä,
ei koko mainin hyväksyntänä. Korjatun revision omat PR/main-portit vaaditaan.

Customers säilyttää asiakas-master-datan omistajuuden. Laskujen snapshotit,
revisiot, PDF:t ja toimitushistoria kuuluvat Invoicingille. E ei muuta
tietokantamallia, vanhoja migraatioita, riippuvuuksia, testiruntimea tai
salaisuuksien käsittelyä. T/A/B/C/K/D säilyvät hyväksyttyinä.

## E1 / R09: viitatun isännöitsijän tyypinmuutos

Omistajan hyväksymä sääntö 21.10.2026:

- `propertyManager`-asiakkaan tyyppiä ei muuteta toiseksi, jos saman yrityksen
  yksikin aktiivinen tai passiivinen `housingCompany` viittaa siihen
  `managedByCustomerId`-kentällä.
- Muut isännöitsijän tiedot ja tila säilyvät muokattavina, kun tyyppi säilyy.
- Käyttäjä voi nykyisillä asiakaskortin toiminnoilla poistaa taloyhtiön
  suhteen tai siirtää sen toiselle isännöitsijälle ja tehdä tyypinmuutoksen
  tämän jälkeen. Suhteita ei katkaista eikä siirretä automaattisesti.
- Toisen yrityksen viite ei vaikuta päätökseen eikä sen olemassaoloa paljasteta.
- Asiakasrekisterin nykyinen suhde ei muuta historiallista laskun omistajaa,
  vastaanottajaa, snapshotia tai PDF:ää.

Toteutus käyttää nykyisiä `createCustomer`-/`updateCustomer`-käyttötapauksia,
`CustomerRepository`-kirjoitusporttia ja `SqliteCustomerRepository`-adapteria.
Suhteen kelpoisuus ja tyypinmuutoksen sääntö nimetään Customersin domainissa.
SQL sekä nykyisen tallennetun tyypin ja viittausten lukeminen pysyvät adapterissa.

Adapteri varmentaa sekä uuden/muuttuvan isännöitsijäviitteen että tyypinmuutoksen
samassa synkronisessa SQLite-transaktiossa kuin customer- ja audit-kirjoituksen.
Applicationin aiempi luku ei korvaa tätä tarkistusta. Transaktion sisään ei
lisätä `await`-kutsua. Molemmat lomitukset testataan: viite ehtii ensin tai
tyypinmuutos ehtii ensin. Häviävä kirjoitus hylätään ilman osittaista dataa
tai onnistuneen muutoksen auditia. Nykyinen audit-rollback säilyy.

Virhe välitetään nykyisen `CustomerValidationError`- ja HTTP-sopimuksen kautta
kiinteänä turvallisena syynä. Web kertoo suomeksi, että taloyhtiöiden
isännöitsijäsuhteet on ensin muutettava. Viittaavien yritysten nimiä tai
tunnisteita ei lisätä virheeseen tai tekniseen lokiin.

## E2 / R10: täsmällinen asiakasnumerointi

Nykyinen sääntö säilyy: yrityksen suurin kokonaan numeerinen asiakasnumero
plus yksi, vähintään ensimmäinen numero `1001`. Manuaaliset ei-numeeriset
numerot eivät vaikuta automaattiseen laskuriin.

- Kokonaislukuja verrataan ja kasvatetaan täsmällisesti Noden nykyisellä
  `bigint`-tuella, ilman `Number`-muunnosta tai uutta kirjastoa.
- Numero kulkee edelleen merkkijonona domainissa, HTTP:ssä ja tietokannassa.
  Vanhoja numeroita, etunollia tai manuaalisia kirjainnumeroyhdistelmiä ei muuteta.
- Nykyinen 50 merkin raja nimetään domainissa yhteen paikkaan. Automaattisen
  tuloksen pitää täyttää sama raja kuin manuaalisen numeron.
- Jos seuraava numero ei mahdu, luonti hylätään turvallisesti ennen customer-
  ja audit-kirjoitusta. Ei kiertymistä, katkaisua, eksponenttimuotoa tai
  automaattista numeron uudelleenyritystä.
- Yrityskohtainen uniikkius ja nykyinen ristiriidan käsittely säilyvät.

Muutos kohdistuu `customerRules.ts`:n numerointisääntöön ja adapterin
`getNextCustomerNumber`-metodiin. Repository-portin palautustyyppi säilyy.

## E3 / R11: turvallinen suomenkielinen palaute

Customersin lista-, detail-, create- ja update-polut käyttävät tunnettujen
API-virheiden nykyistä yhteistä suomenkielistä käännöstaulua. Tuntematon
teksti saa Customersin turvallisen yleisilmoituksen.

Muutos kohdistuu `CustomerPageView.tsx`:n virhemuunnokseen ja nykyiseen
`i18n/fi.ts`-käännösapuun. Käännöstaulua ei kopioida Customersiin eikä muiden
featureiden nykyistä tuntemattoman virheen käsittelyä muuteta sivuvaikutuksena.
Myös objektin prototyypin nimet käsitellään tuntemattomina avaimina.
Tunnettu tuntihintavirhe ja nykyisten osioiden omat turvalliset virhetilat säilyvät.

## Testit ja valmistumisportit

| Vastuu | Todiste |
| --- | --- |
| E1 domain/application | Viitattu aktiivinen/passiivinen taloyhtiö, viittaamaton tyypinmuutos, muut kentät ja suhteen poistamisen/siirron jälkeinen muutos. |
| E1 SQLite | Kirjoitushetken molemmat lomitukset, create/update-suhteen tuore tarkistus, toisen yrityksen viite, self-reference ja auditin atominen rollback. |
| E2 domain/SQLite/HTTP | `1001`, normaalit luvut, etunollat, kirjainnumerot, `2^53`-reuna, 50 numeroa ja loppuraja, yrityseristys, uniikkius sekä epäonnistumisen muuttumaton kanta ja audit. |
| E3 komponentti/web | Tunnettu käännös, tuntematon teksti/koodi ja prototyyppiavaimet; lista/detail/create/update näyttävät turvallisen palautteen ja lomakkeen tiedot säilyvät. |
| System/web-ketju | Nykyiset eristetyt fixturet; asiakassuhteen esto, korjaus ja uusi tallennus sekä numeroiden pysyvä jälkiluku. `CUS-UI-001`, `CUS-INPUT-001` ja suhde-/vastaanottajapolut säilyvät. |
| Laskuhistoria | Asiakkaan sallittu muutos ei muuta aiemmin hyväksytyn laskun customer-/recipient-snapshotia, revisiota, PDF:ää tai toimitushistoriaa. |
| Diagnostiikka | Nykyinen customer-audit, audit-write-failure ja turvallinen HTTP-lokitus; odotetusta validointiestosta ei keksitä onnistunutta auditia. Uutta loggeria tai tapahtumakehystä ei lisätä. |
| Virhetodisteet | Nykyiset runner-reportterit, system/web-fixturet ja salattu toimitus säilyvät. Odottamaton testivirhe kuuluu olemassa olevaan ketjuun; onnistuneen virhetestin odotettu poikkeus ei ole keräysvirhe. |
| Palautettavuus | Sama puhdas hardened Windows -paketti: backup -> inspect -> restore -> restart -> compare synteettisellä profiililla. Nykyiset formaatti-, sisältö-, omistajuus- ja siivousehdot säilyvät. |
| Integraatio | Kohdetestit checkpointien mukaan, eheän kokonaisuuden workspace-testit/tyypitys/buildit, vaikutusalueen nykyiset portit, riippumaton rajattu katselmus, yksityisyys ja täsmällisen PR-/main-revision normaalit CI- ja riippuvuusportit. |

Suunnitelmaa ja toteutusta katselmoidaan rajatusti. Ajot seurataan nykyisen
[työnkulun](../ai/workflow.md#ci-ajon-seuranta-ja-virhetodisteet) mukaisesti;
ensivirheet ja tuntemattomat historialliset syyt säilyvät erillisinä.
Mahdollinen yksi uusinta noudattaa nykyistä testauspolitiikkaa.
E:n valmistuminen ei hyväksy muita roadmap-paketteja tai koko 0.3.0-julkaisua.

## Rajattu integraatiojatko: Vitest 4.1.12

[PR #311:n lähde](https://github.com/eky-software/eky/pull/311#issuecomment-6327288721)
läpäisi V2:n ja riippuvuustarkistuksen ensimmäisellä suoritusyrityksellä.
Mainin [erillinen auditointi](https://github.com/eky-software/eky/actions/runs/39681721731)
hylkäsi nykyisen `@vitest/mocker@4.1.11`-kehitysriippuvuuden kahden kohtalaisen
haavoittuvuuden vuoksi. Tuotantoauditointi läpäisi; allekirjoitustarkistukseen
ei päästy. [Ensivirheen rajaus](https://github.com/eky-software/eky/pull/311#issuecomment-6327452232)
säilyy erillään asiakaskorjauksista ja toimintatestien tuloksista.

Omistaja hyväksyi rajatun Vitest `4.1.11 -> 4.1.12` -päivityksen ja saman
version seitsemän `@vitest`-apupakettia. Muutos omistetaan tässä jatkossa,
ei uutena roadmap-pakettina. Vain juuren kehitystyökalun täsmäversio ja sen
lukitus muuttuvat; uusia pakettinimiä tai browser-/coverage-/UI-plugineja
ei lisätä. Node, pnpm, Vite, Electron, SQLite, business-koodi ja testiehdot
säilyvät. Yli vuorokauden vanha korjaus ei tarvitse varoaikapoikkeusta.

Tiedotteet koskevat julkisen mocker-pluginin rekisteröintipolkua
([lähdekoodin muodostus](https://github.com/advisories/GHSA-qxg6-89mg-rqv8),
[Windows-polkujen käsittely](https://github.com/advisories/GHSA-xp26-3454-mjgp)).
Paketti kuuluu nykyiseen Node-testirunneriin; tarkistuksessa ei löytynyt
kyseisen julkisen pluginin käyttöönottoa EKYn konfiguraatiosta.
Pakettiosumaa ei siis väitetä todistetuksi sovelluksen hyökkäyspoluksi,
mutta pakollista auditointia ei ohiteta.

Todennus: nykyisen lukituksen auditointihylkäys ennen päivitystä, korjatun
lukituksen tuotanto-/kokonaisauditointi ja rekisteriallekirjoitukset,
nykyisen Vitest-virheraportoinnin ja salatun toimituksen todellinen ketju,
normaali työtilan testikierros/tyypitys/buildit sekä rajattu riippumaton
katselmus. Sen jälkeen korjatun puhtaan revision normaalit PR-portit ja
uuden mainin omat portit. Aiemmat toimintatestien hylkäykset käsitellään
erikseen eikä päivitystä väitetä niiden korjaukseksi ilman näyttöä.

Integraatiota edeltävä työkaluhuollon checkpoint 22.10.2026:
nykyisen version auditointihylkäys toistui ennen muutosta; korjatun
lukituksen tuotanto- ja kokonaisauditointi sekä rekisteriallekirjoitukset
läpäisivät. Nykyiset 182 virheraportointi-/salausregressiota läpäisivät,
mukaan lukien todellisen Vitest-virheen löytyminen puretusta paketista.
Normaali koko työtilan testikierros, tyypitys ja buildit läpäisivät.
Rajattu riippumaton katselmus ei jättänyt avoimia havaintoja.
Nämä eivät korvaa korjatun revision vielä vaadittavia PR/main-portteja
eivätkä sulje vanhan mainin erillistä legacy-testihylkäystä.

## Toteutuksen checkpoint 22.10.2026

- Customersin nykyinen SQLite-kirjoitustransaktio tarkistaa tallennetun tyypin
  ja viitteet uudelleen. Aktiivinen ja passiivinen suhde, molemmat kirjoitusten
  lomitukset, vanhentunut application-luku, suhteen siirto, yrityseristys,
  self-reference sekä numeroristiriidan muuttumaton data ja audit on todennettu.
- Tarkka numerointi ja loppuraja on todennettu domainissa, SQLite-adapterissa
  sekä todellisen HTTP-ketjun ja uudelleenkäynnistyksen yli.
- Viisi selainpolkua todentavat suhde-eston ja korjauksen sekä neljän
  API-virhepolun turvallisen palautteen. Tunnettu tuntihintavirhe säilyy.
  Ensimmäisen selainajon väärä detail-tekstiodotus korjattiin testissä;
  nykyistä erillistä turvallista ilmoitusta tai tuotantokoodia ei muutettu
  tämän hylkäyksen vuoksi. Alkuperäinen hylkäys säilyy erillisenä.
- Laskuhistorian ketju todentaa asiakkaan muokkauksen ja restartin yli
  muuttumattomat laskutiedot, revision, dokumentti- ja toimitustapahtumat
  sekä täsmälleen samat PDF-tavut. Testi ei käytä oikeaa SMTP:tä.
- Nykyinen customer-audit säilyy transaktion osana. Odotettu validointihylkäys
  kulkee nykyisen turvallisen HTTP 400 / `http.invalidBody` -lokituksen kautta;
  se ei luo onnistuneen muutoksen auditia eikä uutta Activity-tapahtumaa.
  Teknisen lokin ja Activityn nykyistä eroa ei muuteta.
- Koko työtilan normaali testikierros, työtilan tyypitys sekä viimeisten
  backend-testitäydennysten tyypitys läpäisivät. Vaikutusalueen domain-,
  SQLite-, system- ja web-regressiot läpäisivät. Testit käyttävät nykyisiä
  fixtureitä ja virhetodisteiden ketjua; uutta testialustaa ei ole tehty.
- Riippumaton rajattu katselmus ei jättänyt avoimia toteutushavaintoja.
  Paketin, PR:n ja mainin hyväksyntää ei päätellä näistä paikallisista tuloksista.

Lopullinen integraation readback kirjataan E:n PR:n hyväksyntäyhteenvetoon:
täsmällinen lähderevisio, PR-/main-portit ja mahdolliset avoimet havainnot
erotellaan. Tämän päivätyn checkpointin merkitys ei muutu jälkikäteen.

## Lukureitti

- [Customers](../modules/customers.md) ja [moduulin AGENTS](../../apps/backend/src/modules/customers/AGENTS.md)
- [Asiakaskortiston UI](customer-ui-ux-plan.md) ja [koontinäkymä](customer-overview-plan.md)
- [Moduulirajat](module-boundaries.md), [integraatiomatriisi](module-integration-matrix.md) ja [tietokantavastuu](../decisions/ADR-0006-local-database-and-query-layer.md)
- [Virheet](error-handling-principles.md), [audit](observability-and-audit-plan.md) ja [turvallisuus](security-principles.md)
- [Testaus](../ai/testing-rules.md), [testinkirjoittajan pikaopas](../ai/e2e-test-authoring-guide.md) ja [R0-matriisi](r0-e2e-test-matrix.md#customers)
