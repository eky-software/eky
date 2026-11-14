# 0.3.0: M1:n nykytila ja sopimusten lukureitti

Tämä tiedosto omistaa yhden aktiivisen jatkamiskohdan ja hyväksyntänäytön.
[Roadmap](release-0.3.0-plan.md) omistaa sisällön ja järjestyksen;
omistavat vastuuohjeet tekniset ja liiketoimintasopimukset. Aiemmat
ajoselostukset löytyvät historiasta, eivät tästä työjonosta.

## Jatka tästä

**14.11.2026: W7.5 A-E on toteutettu, integraatiohyväksyntä on kesken.**
Työhaara on `codex/w7-5-deletion-feedback`, PR [#330](https://github.com/eky-software/eky/pull/330),
edellisen PR-kierroksen head `4ed57149`. Hyväksytty lähtö on main
`9657fdc1` ja PR #327/#328. Säilytä paikalliset testiodotuskorjaukset.
[Täysi W7.5-sopimus](local-company-workspace-plan.md#w75-toteutussuunnitelma)
ja hyväksytyt tuontijournalin/sidontatallentimen rajaukset säilyvät.
Hyväksyttyjä paketteja ei avata ilman regressiota.

[V2-ajo 43538585776](https://github.com/eky-software/eky/actions/runs/43538585776)
päättyi hylättynä: 36 onnistui, kolme hylkäsi ja seitsemän ohitettiin.
Ohituksista kuusi oli tarkoituksella valitsematonta diagnostiikkatyötä;
core-verifyn riippuvuusesto ei ole hyväksyttyä kattavuutta. Koontihylkäys
on seuraus kahdesta alkuperäisaineistosta osoitetusta testiodotuspuutteesta.
Todellinen checkout molemmissa hylänneissä töissä oli
`a3f97afb5a6d1b2690894dbfff9b07196a025ba7`, ei PR-head.
[Erillinen riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/43538585530)
läpäisi. Windowsin Electron-, paketti-, workspace- ja installer/legacy-portit
läpäisivät. PR ei ole mergevalmis.

Rajattu nykyinen korjaus:
- Systemin startup-sopimustesti odotti vanhaa v2-snapshotia, vaikka nykyinen
  tuottaja palauttaa v3:n ja `mainStartup`-kentän. Vain testiodotus korjattiin;
  legacy-v2:n tiukka luku ja väärien yhdistelmäkenttien hylkäys todennetaan.
  Koko nykyinen 23 testin tiedosto läpäisi.
- Desktopin T1-kytkentätestin vanha yhteinen Linux-label odotti yhä latestia.
  `verify` vaatii nyt sovitun 24.04:n, `test-packages` säilyttää latestin.
  Neljä kielteistä drift-kontrollia lisättiin. Koko 244 testin tiedosto ja
  normaali Node-loppuvaihe läpäisivät (590 läpäisyä, 12 alustakohtaista ohitusta).
  Joukot ovat päällekkäisiä. E2E-tyypitys läpäisi.
- Koko desktop-Vitest-vaihe (486 tiedostoa, 12 559 läpäisyä, neljä ohitusta)
  ja sama 23 kohteen rooliketju läpäisivät jo tässä CI-kierroksessa.
  Hylännyt Node-koonti säilyy hylättynä; myöhempi kohdeajo ei hyväksy sitä.
  Molempien ensihylkäysten salatut alkuperäiset, lähdesidonnat ja tavut
  varmennettiin. Tuotantokoodi, parserit, turvavartijat ja aikarajat eivät muutu.

[Kolmen Linux-kuluttajan ympäristörajaus](e2e-test-environment.md#linux-ci),
eksplisiittiset permissions/auth-buildit ja ajokytkentätiedoston erillinen
ajo säilyvät. Niiden lähdekatselmus, puhdas normaali E2E-komento
(86 + 789 + 515 testiä) ja 429 CI-sopimustestiä läpäisivät.
Vanhan luettelointitimeoutin tarkkaa syytä ei silti väitetä korjatuksi.
Kahden uuden testikorjauksen riippumaton katselmus ei löytänyt korjattavaa.

Säilyvä toiminnallinen näyttö: koko desktop, web/backend/HTTP, stress ja
täysi soak sekä oikeat Electronin poisto-/tukivientipolut läpäisivät.
Puhdas lähde `03f97967` rakennettiin kerran: hardened smoke ja kaikki viisi
paketoitua palautus/poistotapausta läpäisivät samoilla tavuilla.
Myöhempi checkpoint ei muuta paketin build-identiteettiä.
Koko A-E:n riippumaton koodikatselmus on tehty; muuttuneet korjaukset
katselmoidaan erikseen. [Aiemmat kierrokset ja avoimet havainnot](release-0.3.0-integration-history.md#m1-checkpoint-20261114-pr330-4ed)
säilyvät historiassa.

Seuraavaksi:
1. Julkaise osoitetut katselmoidut testikorjaukset ja ohjeet normaalisti
   samaan PR:ään; säilytä päättyneen kierroksen virheet ja lähdesidonnat.
2. Vaadi uuden jäädytetyn headin kaikki normaalit portit sekä auditointi.
3. Vasta hyväksyttyjen porttien jälkeen normaali suojattu merge ja uuden
   main-revision omat tarkistukset. Ei uusintasilmukkaa tai turva-/aikarajojen
   lievennystä; W7.5 tai koko 0.3.0 ei ole vielä hyväksytty.

`DESK-DELETE-RECOVERY-001`: 150 sekunnin kokonaisraja, nimetty 100 sekunnin
tulosodotus; globaali 10 sekunnin oletus ei muutu. Aiemmat timeoutit,
tuntemattomat syyt ja siivousepävarmuudet säilyvät avoimina.
Poiston tiukka vartija ei saa periytyä kevyestä luentavartijasta.

## Voimassa olevat sopimukset

Valitse tehtävän koskettama omistaja [ohjehakemistosta](../README.md).
Taulukko on reitti, ei lähteiden sääntöjen korvike tai käsky lukea kaikki
aihealueet joka tehtävässä.

| Aihe | Omistava lähde |
| --- | --- |
| SQLiten schema, migraatiohistoria ja avaamisen luottamus | [Tietokantatoteutus](local-database-implementation-plan.md); työtilakutsujalle [työtilasuunnitelma](local-company-workspace-plan.md). |
| Eristetty varmuuskopion tarkistus ja rajattu historiankäsittely | [Backup ja palautus](local-backup-and-restore-plan.md), [artifact-katalogi](local-backup-artifact-inventory.md), tarkistusajurin toimitukselle [desktop-riippuvuudet](local-desktop-dependency-review.md). |
| Palautuksen, journalin ja prosessien omistajuus | [Backup ja palautus](local-backup-and-restore-plan.md), [työtilat](local-company-workspace-plan.md), päivitykselle [asennin ja update](windows-installer-and-update-plan.md). |
| Laskurevisio, PDF ja toimitushistoria | [Hyväksyntä ja numerointi](invoice-approval-numbering-plan.md), [print-data](invoice-print-data-foundation-plan.md), [toimitustapahtumat](invoice-delivery-events-plan.md) ja [niiden persistence](sqlite-invoice-delivery-event-persistence-plan.md). |
| Näkymän omistajuus, tallennuspalaute ja diagnostiikka | [Laskutus-UI](invoicing-ui-roadmap.md), [Company Settings](../modules/company-settings.md), [tapahtumakatalogi](r0-observability-event-catalog.md) ja [virheperiaatteet](error-handling-principles.md). |
| Testiperusta, ensivirhe ja pakettien hyväksyntä | [Testaus](../ai/testing-rules.md), [E2E-ympäristö](e2e-test-environment.md), [Windows-harness](windows-installer-acceptance-harness-v2.md), [salattu aineisto](ci-encrypted-evidence.md). |
| Julkaisun sisältö, versiointi ja seuraavat päätökset | [Roadmap](release-0.3.0-plan.md), [versiointi](release-versioning-policy.md), [riippuvuudet](dependency-policy.md). |

## Hyväksyntähistoria

- [Integraatioiden historia](release-0.3.0-integration-history.md): A/B/C/K:n
  integraatiohavainnot, erilliset epäonnistumiset ja rajatut jatkopäätökset.
- [Varmuuskopion tarkistuksen historia](release-0.3.0-profile-validation-history.md):
  K:n schema-, resurssi-, journal- ja katalogikokeet sekä hylätyt vaihtoehdot.
- [Laskurevisioiden historia](release-0.3.0-invoice-revisions-history.md):
  B-P1/P2/P3 ja B3-B5:n päätökset, spesifikaatiot ja revisionmukainen näyttö.
- [M0/T/M1:n historia](release-0.3.0-m1-history.md): aiempi valmistelu,
  testiperustan hyväksyntä ja roadmapin päivätyt tilannekuvat.

MSI:n aiemman sulkemispyynnön estäjä, alkuperäisen käännösvirheen puuttuva
tuloste, API-katkoksen syy ja ilmoituskeruun satunnainen hylkäys säilyvät
niiden omissa historiallisissa rajauksissa. Myöhempi läpäisy tai parempi
keräys ei jälkikäteen todista niiden syytä. Käytetty kertakoelupa ei uusiudu
historian siirrossa, eikä epävarmaa aineistoa poisteta tämän työn perusteella.

<details>
<summary>Aiemmat osiot ja pysyvät historialinkit</summary>

<p><a id="030-m1--valmistelu"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l1">0.3.0 M1 -valmistelu (historia)</a></p>
<p><a href="release-0.3.0-integration-history.md#m1-source-preparation-l3">Jatka tästä (historia)</a></p>
<p><a id="päivätty-näyttö-ja-sopimukset"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l76">Päivätty näyttö ja sopimukset (historia)</a></p>
<p><a id="yhteisen-virhekeräyksen-windows-kohdetodennus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l340">Yhteisen virhekeräyksen Windows-kohdetodennus (historia)</a></p>
<p><a id="virhekeräyksen-normaalin-pr-kierroksen-jatko"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l360">Virhekeräyksen normaalin PR-kierroksen jatko (historia)</a></p>
<p><a id="kn-nykyinen-pr-checkpoint-ja-valmistelukoe"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l500">K:n nykyinen PR-checkpoint ja valmistelukoe (historia)</a></p>
<p><a id="kn-ensimmäisen-pr-kierroksen-jatko"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l793">K:n ensimmäisen PR-kierroksen jatko (historia)</a></p>
<p><a id="kn-normaalin-kierroksen-resurssitestit"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l890">K:n normaalin kierroksen resurssitestit (historia)</a></p>
<p><a id="kn-kokonaiskytkennän-tarkistus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l958">K:n kokonaiskytkennän tarkistus (historia)</a></p>
<p><a id="kn-integraatiotestien-checkpoint"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l1034">K:n integraatiotestien checkpoint (historia)</a></p>
<p><a id="laskuhistorian-ennakkorajan-päätös"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l1095">Laskuhistorian ennakkorajan päätös (historia)</a></p>
<p><a id="katalogin-muistivirheen-syyketju"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l1146">Katalogin muistivirheen syyketju (historia)</a></p>
<p><a id="historian-eristetyn-ajon-kohdenäyttö"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l1165">Historian eristetyn ajon kohdenäyttö (historia)</a></p>
<p><a id="laskuhistorian-inkrementaalisen-luennan-suunnitelma"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l1198">Laskuhistorian inkrementaalisen luennan suunnitelma (historia)</a></p>
<p><a id="historian-luennan-toteutussopimus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l1287">Historian luennan toteutussopimus (historia)</a></p>
<p><a id="paketoinnin-budjettipäätös"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l1490">Paketoinnin budjettipäätös (historia)</a></p>
<p><a id="suuren-katalogin-palautusraja"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l1510">Suuren katalogin palautusraja (historia)</a></p>
<p><a id="tarkistuskohtien-jatkosuunnittelu"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l1615">Tarkistuskohtien jatkosuunnittelu (historia)</a></p>
<p><a id="hyväksyntäjournalin-viimeiset-lukuvälit"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l1735">Hyväksyntäjournalin viimeiset lukuvälit (historia)</a></p>
<p><a id="tiedostoluettelon-rajatun-lukuerän-ehdotus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l1782">Tiedostoluettelon rajatun lukuerän ehdotus (historia)</a></p>
<p><a id="pdf-luvun-ja-cold-journalin-tuotantokytkentä"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l1926">PDF-luvun ja cold-journalin tuotantokytkentä (historia)</a></p>
<p><a id="linux-tarkistuksen-ajopolun-päätös"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l1976">Linux-tarkistuksen ajopolun päätös (historia)</a></p>
<p><a id="candidate-tarkistuksen-avausportti"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2020">Candidate-tarkistuksen avausportti (historia)</a></p>
<p><a id="natiivin-muistivirheen-luokittelukorjaus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2061">Natiivin muistivirheen luokittelukorjaus (historia)</a></p>
<p><a id="aktiivivalidoinnin-kutsujakohtainen-omistajuus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2100">Aktiivivalidoinnin kutsujakohtainen omistajuus (historia)</a></p>
<p><a id="ensimmäisen-käynnistyksen-ja-c-kutsun-kytkentä"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2206">Ensimmäisen käynnistyksen ja C-kutsun kytkentä (historia)</a></p>
<p><a id="journalin-valinta--ja-sisältötarkistuksen-rajattu-koe"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2272">Journalin valinta- ja sisältötarkistuksen rajattu koe (historia)</a></p>
<p><a id="k-paketin-valmistelu-ja-hyväksyntärajat"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2395">K-paketin valmistelu ja hyväksyntärajat (historia)</a></p>
<p><a id="v2e-erillisen-tarkistuskopion-koe"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2496">V2e: erillisen tarkistuskopion koe (historia)</a></p>
<p><a id="v2f-kutsujien-aineiston-säilytys"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2558">V2f: kutsujien aineiston säilytys (historia)</a></p>
<p><a id="v2g-tarkistuskopio-todellisessa-utility-prosessissa"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2597">V2g: tarkistuskopio todellisessa utility-prosessissa (historia)</a></p>
<p><a id="v2h-wal-kuluttajaregressio-ja-kytkentäpäätös"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2648">V2h: WAL-kuluttajaregressio ja kytkentäpäätös (historia)</a></p>
<p><a id="v2i-tarkistuskopion-tuotantokuluttaja"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2692">V2i: tarkistuskopion tuotantokuluttaja (historia)</a></p>
<p><a id="v2j-ylemmän-virheketjun-ensisyyn-säilyminen"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2751">V2j: ylemmän virheketjun ensisyyn säilyminen (historia)</a></p>
<p><a id="v2k-workspace-varmuuskopion-turvallinen-lukuketju"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2786">V2k: workspace-varmuuskopion turvallinen lukuketju (historia)</a></p>
<p><a id="v2l-backup--ja-palautuskuluttajien-sisäinen-ensisyy"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2835">V2l: backup- ja palautuskuluttajien sisäinen ensisyy (historia)</a></p>
<p><a id="v2m-portable-backupin-turvallinen-lukuketju"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2864">V2m: portable-backupin turvallinen lukuketju (historia)</a></p>
<p><a id="v2n-palautuskuluttajien-turvallinen-ensisyy"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2910">V2n: palautuskuluttajien turvallinen ensisyy (historia)</a></p>
<p><a id="hyväksynnän-loppuvaiheen-syytieto"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2952">Hyväksynnän loppuvaiheen syytieto (historia)</a></p>
<p><a id="v2o-palautustapahtumien-lukijoiden-sopimustarkistus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3005">V2o: palautustapahtumien lukijoiden sopimustarkistus (historia)</a></p>
<p><a id="v2p-tuonnin-todellinen-mainipc-lukuketju"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3044">V2p: tuonnin todellinen main/IPC-lukuketju (historia)</a></p>
<p><a id="v2q-korvauksen-todellinen-mainipc-lukuketju"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3095">V2q: korvauksen todellinen main/IPC-lukuketju (historia)</a></p>
<p><a id="v2r-pysyvät-workspace-schema-hylkäystestit"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3147">V2r: pysyvät workspace-schema-hylkäystestit (historia)</a></p>
<p><a id="v2s-tarkistusajurin-erillinen-toimitus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3189">V2s: Tarkistusajurin erillinen toimitus (historia)</a></p>
<p><a id="v2t-inventaarion-suljettu-virhepolku"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3233">V2t: Inventaarion suljettu virhepolku (historia)</a></p>
<p><a id="v2u-omistetun-paikallisen-työtilan-kaatumispalautus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3281">V2u: Omistetun paikallisen työtilan kaatumispalautus (historia)</a></p>
<p><a id="v2v-eristetyn-tarkistuksen-prosessiraja"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3329">V2v: Eristetyn tarkistuksen prosessiraja (historia)</a></p>
<p><a id="v2w-luotettu-konteksti-ja-tarkistuksen-koostaminen"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3386">V2w: Luotettu konteksti ja tarkistuksen koostaminen (historia)</a></p>
<p><a id="v2x-kevyt-broker-v10-konteksti"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3427">V2x: Kevyt broker-v10-konteksti (historia)</a></p>
<p><a id="v2y-omistettu-inspect-kuluttaja"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3463">V2y: Omistettu Inspect-kuluttaja (historia)</a></p>
<p><a id="v2z-portablen-main-kuluttajaportti"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3507">V2z: Portablen main-kuluttajaportti (historia)</a></p>
<p><a id="v2aa-palautuspisteen-lähdevaraus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3564">V2aa: Palautuspisteen lähdevaraus (historia)</a></p>
<p><a id="v2ab-valmistellun-palautuksen-omistajuuden-siirto"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3602">V2ab: Valmistellun palautuksen omistajuuden siirto (historia)</a></p>
<p><a id="v2ac-snapshotin-hyväksyntäkäytännön-sidonta"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3636">V2ac: Snapshotin hyväksyntäkäytännön sidonta (historia)</a></p>
<p><a id="v2ad-palautuspisteen-tallennuksen-native-kytkentä"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3703">V2ad: Palautuspisteen tallennuksen native-kytkentä (historia)</a></p>
<p><a id="v2ae-odottavan-palautusstagingin-native-omistajuus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3739">V2ae: Odottavan palautusstagingin native-omistajuus (historia)</a></p>
<p><a id="v2af-tarkistusajurin-alustakohtainen-todennus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3777">V2af: Tarkistusajurin alustakohtainen todennus (historia)</a></p>
<p><a id="v2ag-snapshot-muodostajan-eristetty-tarkistusketju"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3812">V2ag: Snapshot-muodostajan eristetty tarkistusketju (historia)</a></p>
<p><a id="v2ah-electron-testiruntimen-tarkistusajuritoimitus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3849">V2ah: Electron-testiruntimen tarkistusajuritoimitus (historia)</a></p>
<p><a id="v2ai-palautuksen-suljettu-kirjoitussuoja"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3907">V2ai: Palautuksen suljettu kirjoitussuoja (historia)</a></p>
<p><a id="v2aj-palautuksen-nimetty-backend-pysäytys"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3959">V2aj: Palautuksen nimetty backend-pysäytys (historia)</a></p>
<p><a id="v2ak-native-stagingin-durable-handoff"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4010">V2ak: Native-stagingin durable-handoff (historia)</a></p>
<p><a id="v2al-kylmäpalautuksen-vaihekohtainen-tiedostotarkistus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4064">V2al: Kylmäpalautuksen vaihekohtainen tiedostotarkistus (historia)</a></p>
<p><a id="v2am-kylmäpalautuksen-muuttamaton-journal-valinta"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4111">V2am: Kylmäpalautuksen muuttamaton journal-valinta (historia)</a></p>
<p><a id="v2an-kylmäpalautuksen-tuore-forward-omistajuus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4144">V2an: Kylmäpalautuksen tuore forward-omistajuus (historia)</a></p>
<p><a id="v2ao-kylmäpalautuksen-vaihekohtainen-sisältöydin"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4194">V2ao: Kylmäpalautuksen vaihekohtainen sisältöydin (historia)</a></p>
<p><a id="v2ap-kylmäsisällön-nimetty-prosessiraja"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4237">V2ap: Kylmäsisällön nimetty prosessiraja (historia)</a></p>
<p><a id="v2aq-kylmäsisältöportin-omistettu-tarkistuskopio"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4273">V2aq: Kylmäsisältöportin omistettu tarkistuskopio (historia)</a></p>
<p><a id="v2ar-valittujen-pdf-tiedostojen-sidonta"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4334">V2ar: Valittujen PDF-tiedostojen sidonta (historia)</a></p>
<p><a id="v2as-startupin-tuore-sisältövaltuus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4400">V2as: Startupin tuore sisältövaltuus (historia)</a></p>
<p><a id="v2at-loppuvaiheen-journal-sidonta"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4455">V2at: Loppuvaiheen journal-sidonta (historia)</a></p>
<p><a id="v2au-keskeytyneen-rollbackin-slot-valinta"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4505">V2au: Keskeytyneen rollbackin slot-valinta (historia)</a></p>
<p><a id="v2av-alkuperäissisällön-tarkistussopimus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4547">V2av: Alkuperäissisällön tarkistussopimus (historia)</a></p>
<p><a id="v2aw-rollbackin-loppusiivouksen-säilytys"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4694">V2aw: Rollbackin loppusiivouksen säilytys (historia)</a></p>
<p><a id="v2ax-backendin-jälkeisen-terminal-valtuuden-päätösrajat"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4729">V2ax: Backendin jälkeisen terminal-valtuuden päätösrajat (historia)</a></p>
<p><a id="v2az-hyväksynnän-pysyvyys-ja-alkuperäiskannan-poissaolo"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4765">V2az: Hyväksynnän pysyvyys ja alkuperäiskannan poissaolo (historia)</a></p>
<p><a id="v2ba-terminal-inventaario-ja-nimetty-siivous"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4809">V2ba: Terminal-inventaario ja nimetty siivous (historia)</a></p>
<p><a id="v2bb-live-terminalin-tuore-valtuus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4846">V2bb: Live-terminalin tuore valtuus (historia)</a></p>
<p><a id="v2be-cn-business-valmistumisen-journal-sidonta"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4893">V2be: C:n business-valmistumisen journal-sidonta (historia)</a></p>
<p><a id="v2bh-journalittoman-cn-historiallinen-käynnistysadmissio"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4950">V2bh: Journalittoman C:n historiallinen käynnistysadmissio (historia)</a></p>
<p><a id="v2bi-cn-palautuksen-rajattu-w6-valmistelu"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l5019">V2bi: C:n palautuksen rajattu W6-valmistelu (historia)</a></p>
<p><a id="v2bj-aktiiviprofiilin-eristetyn-tarkistuksen-valmistelu"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l5070">V2bj: Aktiiviprofiilin eristetyn tarkistuksen valmistelu (historia)</a></p>
<p><a id="v2bg-aktivoinnin-täsmällinen-journal-ja-valtuus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l5115">V2bg: Aktivoinnin täsmällinen journal ja valtuus (historia)</a></p>
<p><a id="v2bf-journalittoman-cn-valinnan-jatkuminen"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l5180">V2bf: Journalittoman C:n valinnan jatkuminen (historia)</a></p>
<p><a id="v2bd-tarkistusvirheen-jälkeinen-rollback-valtuus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l5223">V2bd: Tarkistusvirheen jälkeinen rollback-valtuus (historia)</a></p>
<p><a id="v2bc-cn-alkuperäisketjun-terminal"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l5275">V2bc: C:n alkuperäisketjun terminal (historia)</a></p>
<p><a id="v2ay-cn-palautuskutsujan-sisäinen-ensisyy"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l5340">V2ay: C:n palautuskutsujan sisäinen ensisyy (historia)</a></p>
<p><a id="muut-avoimet-k-päätökset"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l5377">Muut avoimet K-päätökset (historia)</a></p>
<p><a id="k-p2n-tarkistusajurin-toimitusehdotus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l5431">K-P2:n tarkistusajurin toimitusehdotus (historia)</a></p>
<p><a id="kn-toteutussopimus-rakenne-ennen-sisältöä"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l5517">K:n toteutussopimus: rakenne ennen sisältöä (historia)</a></p>
<p><a id="kn-toteutussopimus-eristetty-tarkistus-ja-siivous"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l5608">K:n toteutussopimus: eristetty tarkistus ja siivous (historia)</a></p>
<p><a id="kn-tiedostovastuut-ja-turvallinen-palaute"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l5671">K:n tiedostovastuut ja turvallinen palaute (historia)</a></p>
<p><a id="kn-toteutusjärjestys-ja-hyväksyntä"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l5702">K:n toteutusjärjestys ja hyväksyntä (historia)</a></p>
<p><a id="cn-ensimmäisen-pr-kierroksen-rajattu-korjaus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l5766">C:n ensimmäisen PR-kierroksen rajattu korjaus (historia)</a></p>
<p><a id="cn-prosessijärjestysfixturen-täsmennys"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l5811">C:n prosessijärjestysfixturen täsmennys (historia)</a></p>
<p><a id="c-paketin-valmistelu-ja-hyväksyntärajat"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l5845">C-paketin valmistelu ja hyväksyntärajat (historia)</a></p>
<p><a id="cn-toteutuspalat-ja-todennus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l5883">C:n toteutuspalat ja todennus (historia)</a></p>
<p><a id="cn-avoimet-sopimusrajat-ennen-toteutusta"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l5943">C:n avoimet sopimusrajat ennen toteutusta (historia)</a></p>
<p><a id="cn-rajattu-toteutusehdotus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l5995">C:n rajattu toteutusehdotus (historia)</a></p>
<p><a id="r18-prosessivarauksen-ja-journal-v2n-sopimusehdotus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l6295">R18: prosessivarauksen ja journal V2:n sopimusehdotus (historia)</a></p>
<p><a id="b3-b5n-integraatiohistoria"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l6874">B3-B5:n integraatiohistoria (historia)</a></p>
<p><a id="b3-b5n-normaalin-integraatiokierroksen-testisopimukset"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l6880">B3-B5:n normaalin integraatiokierroksen testisopimukset (historia)</a></p>
<p><a id="b3-b5n-ensimmäisen-pr-kierroksen-rajatut-korjaukset"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l6921">B3-B5:n ensimmäisen PR-kierroksen rajatut korjaukset (historia)</a></p>
<p><a id="legacy-testin-038039-migraatiotodisteen-korjausehdotus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l7269">Legacy-testin 038–039-migraatiotodisteen korjausehdotus (historia)</a></p>
<p><a id="b3-b5n-aikana-havaittu-riippuvuuspäivitys"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l7466">B3-B5:n aikana havaittu riippuvuuspäivitys (historia)</a></p>
<p><a id="b1b2-mainin-electron-sulkuhavainto"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l7520">B1/B2-mainin Electron-sulkuhavainto (historia)</a></p>
<p><a id="a3r06-hyväksyntävalmiuden-vastaussidonta"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l7628">A3/R06: hyväksyntävalmiuden vastaussidonta (historia)</a></p>
<p><a id="b0-laskun-sisältö-ja-toimitus"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l7671">B0: laskun sisältö ja toimitus (historia)</a></p>
<p><a id="lähdepohja-ja-nykyiset-puutteet"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l7679">Lähdepohja ja nykyiset puutteet (historia)</a></p>
<p><a id="rajattu-ratkaisusuunta"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l7708">Rajattu ratkaisusuunta (historia)</a></p>
<p><a id="päätökset-ennen-bn-toteutusta"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l7762">Päätökset ennen B:n toteutusta (historia)</a></p>
<p><a id="b-p2-toimitusversioiden-historia"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l7785">B-P2: toimitusversioiden historia (historia)</a></p>
<p><a id="b-p3-turvallisen-uudelleenlähetyksen-vaihtoehto"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l7855">B-P3: turvallisen uudelleenlähetyksen vaihtoehto (historia)</a></p>
<p><a id="b3b4-tietomalli-portit-ja-migraatiojärjestys"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l7966">B3/B4: tietomalli, portit ja migraatiojärjestys (historia)</a></p>
<p><a id="toteutuspalat-ja-hyväksyntänäyttö"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8060">Toteutuspalat ja hyväksyntänäyttö (historia)</a></p>
<p><a id="palaute-diagnostiikka-ja-palautettavuus"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8111">Palaute, diagnostiikka ja palautettavuus (historia)</a></p>
<p><a id="b0n-jatkamiskohta"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8144">B0:n jatkamiskohta (historia)</a></p>
<p><a id="b1b2-rajattu-toteutus"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8175">B1/B2: rajattu toteutus (historia)</a></p>
<p><a id="b3-b5-toteutusvalmistelu"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8239">B3-B5: toteutusvalmistelu (historia)</a></p>
<p><a id="alv-lukupolun-tarkennus"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8251">ALV-lukupolun tarkennus (historia)</a></p>
<p><a id="omistava-toteutuskartta"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8315">Omistava toteutuskartta (historia)</a></p>
<p><a id="tietomallin-katselmointiehdotus"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8339">Tietomallin katselmointiehdotus (historia)</a></p>
<p><a id="snapshotin-julkaisu-ja-legacy-kopion-sql-ehdotus"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8426">Snapshotin julkaisu ja legacy-kopion SQL-ehdotus (historia)</a></p>
<p><a id="b4-historian-käyttöpolun-checkpoint"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8839">B4-historian käyttöpolun checkpoint (historia)</a></p>
<p><a id="b4-legacy-uudelleenlähetyksen-checkpoint"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8878">B4-legacy-uudelleenlähetyksen checkpoint (historia)</a></p>
<p><a id="b5-katalogin-ja-palautuksen-checkpoint"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8913">B5-katalogin ja palautuksen checkpoint (historia)</a></p>
<p><a id="b5-katselmuksen-jatkokorjaukset"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l9020">B5-katselmuksen jatkokorjaukset (historia)</a></p>
<p><a id="b4-reopened-editorin-jatkotodennus"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l9093">B4-reopened-editorin jatkotodennus (historia)</a></p>
<p><a id="säilytetyn-dokumentin-täsmäluku-ja-vahvistuksen-järjestys"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l9373">Säilytetyn dokumentin täsmäluku ja vahvistuksen järjestys (historia)</a></p>
<p><a id="dokumentti--ja-tapahtumasidoksen-sql-osakoe"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l9622">Dokumentti- ja tapahtumasidoksen SQL-osakoe (historia)</a></p>
<p><a id="porttien-katselmointiehdotus"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l9688">Porttien katselmointiehdotus (historia)</a></p>
<p><a id="migraation-järjestyksen-näyttö-ja-jatko"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l9912">Migraation järjestyksen näyttö ja jatko (historia)</a></p>
<p><a id="valmistelun-porttien-tila"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l10056">Valmistelun porttien tila (historia)</a></p>
<p><a id="a1r01-toteutus-ja-hyväksyntä"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10096">A1/R01: toteutus ja hyväksyntä (historia)</a></p>
<p><a id="a2r05-tallennuksen-omistajuus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10137">A2/R05: tallennuksen omistajuus (historia)</a></p>
<p><a id="oma-yritys-rajattu-tallennuskorjaus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10215">Oma yritys: rajattu tallennuskorjaus (historia)</a></p>
<p><a id="msi-politiikkakokeen-virheaineisto"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10312">MSI-politiikkakokeen virheaineisto (historia)</a></p>
<p><a id="pnpm-bootstrapin-tietoturvahuolto"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10353">Pnpm-bootstrapin tietoturvahuolto (historia)</a></p>
<p><a id="pnpm-huollon-pr-porttien-rajatut-esteet"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10408">Pnpm-huollon PR-porttien rajatut esteet (historia)</a></p>
<p><a id="riskiperusteinen-jatko-1102026"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10489">Riskiperusteinen jatko 1.10.2026 (historia)</a></p>
<p><a id="normaalin-kierroksen-tulos-ja-rajatut-korjaukset"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10491">Normaalin kierroksen tulos ja rajatut korjaukset (historia)</a></p>
<p><a id="nykyisen-työn-rajaus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10558">Nykyisen työn rajaus (historia)</a></p>
<p><a id="salatun-tutkimusaineiston-välitavoite"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10564">Salatun tutkimusaineiston välitavoite (historia)</a></p>
<p><a id="salatun-toimituksen-hyväksyntä"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10700">Salatun toimituksen hyväksyntä (historia)</a></p>
<p><a id="seuraava-etenemispäätös"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10724">Seuraava etenemispäätös (historia)</a></p>
<p><a id="aiemman-timeout-tutkimuksen-rajaus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10748">Aiemman timeout-tutkimuksen rajaus (historia)</a></p>
<p><a id="lähtönäyttö-ja-uusinnan-raja"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10782">Lähtönäyttö ja uusinnan raja (historia)</a></p>
<p><a id="rajatun-uusinnan-tulos"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10829">Rajatun uusinnan tulos (historia)</a></p>
<p><a id="hyväksytty-katkaisukoe"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10900">Hyväksytty katkaisukoe (historia)</a></p>
<p><a id="katkaisukokeen-tulos"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10943">Katkaisukokeen tulos (historia)</a></p>
<p><a id="hyväksytty-workspace-success-havaintokoe"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10982">Hyväksytty workspace-success-havaintokoe (historia)</a></p>
<p><a id="workspace-success-havaintokokeen-tulos"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11023">Workspace-success-havaintokokeen tulos (historia)</a></p>
<p><a id="tutkimuspaketin-päätösraportti"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11058">Tutkimuspaketin päätösraportti (historia)</a></p>
<p><a id="yksityisen-vientiaineiston-säilytysehdotus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11120">Yksityisen vientiaineiston säilytysehdotus (historia)</a></p>
<p><a id="yksityisen-kertakokeen-valmisteluhylkäys"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11277">Yksityisen kertakokeen valmisteluhylkäys (historia)</a></p>
<p><a id="korjatun-yksityisen-kertakokeen-päätösraportti"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11319">Korjatun yksityisen kertakokeen päätösraportti (historia)</a></p>
<p><a id="playwright-ensivirheen-jatkoehdotus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11360">Playwright-ensivirheen jatkoehdotus (historia)</a></p>
<p><a id="virhetiedon-ja-electron-päivityksen-rajattu-jatko"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11380">Virhetiedon ja Electron-päivityksen rajattu jatko (historia)</a></p>
<p><a id="rajattu-ongelmalista"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11395">Rajattu ongelmalista (historia)</a></p>
<p><a id="v1n-ensimmäinen-toteutuscheckpoint"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11437">V1:n ensimmäinen toteutuscheckpoint (historia)</a></p>
<p><a id="v1bn-toteutus-ja-todennus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11455">V1b:n toteutus ja todennus (historia)</a></p>
<p><a id="v1bn-järjestysregressio"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11502">V1b:n järjestysregressio (historia)</a></p>
<p><a id="v2n-nykyinen-hyväksyntächeckpoint"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11526">V2:n nykyinen hyväksyntächeckpoint (historia)</a></p>
<p><a id="normaalin-pr-kierroksen-valmisteluhylkäys"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11633">Normaalin PR-kierroksen valmisteluhylkäys (historia)</a></p>
<p><a id="valmiuskyselyhavainnon-todennus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11675">Valmiuskyselyhavainnon todennus (historia)</a></p>
<p><a id="v2n-ensimmäisen-pr-ajon-rajatut-esteet"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11698">V2:n ensimmäisen PR-ajon rajatut esteet (historia)</a></p>
<p><a id="asennuskorjauksen-päätös"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11791">Asennuskorjauksen päätös (historia)</a></p>
<p><a id="pakettivälimuistin-testivalmistelun-rajaus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11986">Pakettivälimuistin testivalmistelun rajaus (historia)</a></p>
<p><a id="ohje-ja-historia"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l12009">Ohje ja historia (historia)</a></p>
<p><a id="lukureitit"></a><a href="release-0.3.0-m1-history.md#m1-source-preparation-l12091">Lukureitit (historia)</a></p>
<p><a id="rajattu-toteutusjärjestys"></a><a href="release-0.3.0-m1-history.md#m1-source-preparation-l12112">Rajattu toteutusjärjestys (historia)</a></p>
<p><a id="skannaushavaintojen-vaikutus-jatkoon"></a><a href="release-0.3.0-m1-history.md#m1-source-preparation-l12133">Skannaushavaintojen vaikutus jatkoon (historia)</a></p>
<p><a id="valmistumisportti-pala-kerrallaan"></a><a href="release-0.3.0-m1-history.md#m1-source-preparation-l12156">Valmistumisportti pala kerrallaan (historia)</a></p>
<p><a id="päätösjono-ja-valmistelun-lopetus"></a><a href="release-0.3.0-m1-history.md#m1-source-preparation-l12172">Päätösjono ja valmistelun lopetus (historia)</a></p>

</details>

<details>
<summary>12.11.2026 siirretyn jatkamiskohdan otsikot</summary>

<p><a id="aiempi-w75-näyttö"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261112-aiempi-w75-näyttö">Aiempi W7.5-näyttö (siirretty)</a></p>
<p><a id="edeltävä-viimeistelyselvitys"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261112-edeltävä-viimeistelyselvitys">Edeltävä viimeistelyselvitys (siirretty)</a></p>
<p><a id="aiemmat-lähtötilan-checkpointit"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261112-aiemmat-lähtötilan-checkpointit">Aiemmat lähtötilan checkpointit (siirretty)</a></p>
<p><a id="keräyskorjauksen-ja-odotusvian-aiempi-näyttö"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261112-keräyskorjauksen-ja-odotusvian-aiempi-näyttö">Keräyskorjauksen ja odotusvian aiempi näyttö (siirretty)</a></p>
<p><a id="w74n-keskeneräinen-toteutus"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261112-w74n-keskeneräinen-toteutus">W7.4:n keskeneräinen toteutus (siirretty)</a></p>
<p><a id="m4--käyttäjäkokemuksen-valmistelu"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261112-m4--käyttäjäkokemuksen-valmistelu">M4 / Käyttäjäkokemuksen valmistelu (siirretty)</a></p>
<p><a id="koottu-toteutusjärjestys"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261112-koottu-toteutusjärjestys">Koottu toteutusjärjestys (siirretty)</a></p>
<p><a id="m41-odotustilojen-toteutussopimus"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261112-m41-odotustilojen-toteutussopimus">M4.1: Odotustilojen toteutussopimus (siirretty)</a></p>
<p><a id="m42-varmuuskopion-tiedostonimisopimus"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261112-m42-varmuuskopion-tiedostonimisopimus">M4.2: Varmuuskopion tiedostonimisopimus (siirretty)</a></p>
<p><a id="i--ci-politiikan-ja-ajantasaisten-sopimusten-valmistelu"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261112-i--ci-politiikan-ja-ajantasaisten-sopimusten-valmistelu">I / CI-politiikan ja ajantasaisten sopimusten valmistelu (siirretty)</a></p>
<p><a id="in-säilytettävä-ci-sopimus"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261112-in-säilytettävä-ci-sopimus">I:n säilytettävä CI-sopimus (siirretty)</a></p>
<p><a id="i-p1-r30n-hyväksytty-pienin-muutos"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261112-i-p1-r30n-hyväksytty-pienin-muutos">I-P1: R30:n hyväksytty pienin muutos (siirretty)</a></p>
<p><a id="in-toteutus--ja-todistusjärjestys"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261112-in-toteutus--ja-todistusjärjestys">I:n toteutus- ja todistusjärjestys (siirretty)</a></p>
<p><a id="h--diagnostiikan-saatavuuden-ja-oikeellisuuden-suunnitelma"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261112-h--diagnostiikan-saatavuuden-ja-oikeellisuuden-suunnitelma">H / Diagnostiikan saatavuuden ja oikeellisuuden suunnitelma (siirretty)</a></p>
<p><a id="hn-omistajat-ja-etenemisjärjestys"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261112-hn-omistajat-ja-etenemisjärjestys">hn-omistajat-ja-etenemisjärjestys (siirretty)</a></p>
<p><a id="h-p1-hyväksytty-lukutilan-suunta"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261112-h-p1-hyväksytty-lukutilan-suunta">h-p1-hyväksytty-lukutilan-suunta (siirretty)</a></p>
<p><a id="h-p2-hyväksytty-writer-häiriön-palaute"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261112-h-p2-hyväksytty-writer-häiriön-palaute">h-p2-hyväksytty-writer-häiriön-palaute (siirretty)</a></p>
<p><a id="hn-pr-integraation-rajattu-jatko"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261112-hn-pr-integraation-rajattu-jatko">hn-pr-integraation-rajattu-jatko (siirretty)</a></p>
<p><a id="hn-säilyvät-rajat-ja-valmistumisportti"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261112-hn-säilyvät-rajat-ja-valmistumisportti">hn-säilyvät-rajat-ja-valmistumisportti (siirretty)</a></p>
<p><a id="g--diagnostiikan-tapahtumaketjun-suunnitelma"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261112-g--diagnostiikan-tapahtumaketjun-suunnitelma">G / Diagnostiikan tapahtumaketjun suunnitelma (siirretty)</a></p>
<p><a id="g-p1-hyväksytty-projektiorajaus"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261112-g-p1-hyväksytty-projektiorajaus">G-P1: Hyväksytty projektiorajaus (siirretty)</a></p>
<p><a id="g-p2-hyväksytty-workspace-virheen-omistajuus"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261112-g-p2-hyväksytty-workspace-virheen-omistajuus">G-P2: Hyväksytty workspace-virheen omistajuus (siirretty)</a></p>
<p><a id="gn-tiedostot-ja-toteutusjärjestys"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261112-gn-tiedostot-ja-toteutusjärjestys">G:n tiedostot ja toteutusjärjestys (siirretty)</a></p>
<p><a id="f--frameworkin-virheketjun-rajattu-suunnitelma"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261112-f--frameworkin-virheketjun-rajattu-suunnitelma">F / Frameworkin virheketjun rajattu suunnitelma (siirretty)</a></p>
<p><a id="edeltävien-integraatioiden-historia"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261112-edeltävien-integraatioiden-historia">Edeltävien integraatioiden historia (siirretty)</a></p>

</details>

<details>
<summary>13.11.2026 siirretyn jatkamiskohdan otsikot</summary>

<p><a id="nykyinen-näyttö-ja-avoin-este"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261113">Nykyinen näyttö ja avoin este (siirretty)</a></p>
<p><a id="w75-bottleneck-investigation-20261112"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261113">Julkaisunjälkeinen vianrajaus (siirretty)</a></p>
<p><a id="julkaisunjälkeisen-vianrajauksen-tulos"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261113">Julkaisunjälkeisen vianrajauksen tulos (siirretty)</a></p>
<p><a id="seuraava-integraatiovaihe"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261113">Seuraava integraatiovaihe (siirretty)</a></p>
<p><a id="jäljellä-ennen-w75n-sulkemista"></a><a href="release-0.3.0-integration-history.md#m1-checkpoint-20261113">Jäljellä ennen W7.5:n sulkemista (siirretty)</a></p>

</details>
