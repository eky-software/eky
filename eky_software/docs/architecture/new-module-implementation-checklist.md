# Uuden Moduulin Toteutuschecklist

Tätä checklistiä käytetään, kun Ekyyn aloitetaan uusi Customers-, Sites-, Work
Orders-, Inventory-, Reporting- tai muu liiketoimintamoduuli. Se täydentää
arkkitehtuuri-, moduuliraja-, riippuvuus-, turvallisuus- ja testausohjeita eikä
korvaa niitä.

## Ennen Toteutusta

- [ ] Määrittele moduulin omistama data ja liiketoimintavastuu
  `docs/modules/`-dokumenttiin.
- [ ] Rajaa, mitä moduuli ei omista ja mitä tietoja se saa vain lukea muilta
  moduuleilta.
- [ ] Määrittele domain-tyypit, tilat ja invariantit ilman UI-, HTTP-, SQL-,
  Electron- tai integraatioriippuvuuksia.
- [ ] Suunnittele application service yksi käyttötapaus per tiedosto.
- [ ] Määrittele kapeat portit kaikille tietokanta-, tiedosto-, viesti- ja
  cross-module-riippuvuuksille.
- [ ] Tarkista kohdekansion `AGENTS.md`-tarve ja päivitä dokumentaation
  pakollinen lukulista, jos uusi vastuu sitä edellyttää.
- [ ] Varmista ennen asennusta projektin omistajan nimenomainen hyväksyntä
  jokaiselle uudelle riippuvuudelle sekä `package.json`- tai lockfile-muutokselle.

## Moduulikohtainen AGENTS.md

Jokaisen liiketoimintamoduulin juurella pitää normaalisti olla oma
`AGENTS.md`. Se tarkentaa juuri kyseisen moduulin työtä, mutta ei kopioi juuri-
`AGENTS.md`:n yleisiä sääntöjä eikä kumoa niitä.

Moduulikohtainen ohje määrittelee tiiviisti vähintään:

- moduulin omistaman ja sen ulkopuolelle rajatun datan
- pakolliset moduuli- ja arkkitehtuuridokumentit
- sallitut kerrokset ja niiden riippuvuussuunnat
- `ActorContext`- ja `companyId`-luottamusrajan
- sallitut moduulien väliset luku- ja kirjoitussopimukset
- muutokseen suhteutetut pakolliset testit
- moduulille olennaiset kielletyt riippuvuussuunnat

Pieni tekninen tai jaettu infrastruktuurikokonaisuus ei tarvitse omaa
`AGENTS.md`:ää vain kansiorakenteen yhdenmukaisuuden vuoksi. Poikkeuksen pitää
olla aidosti rajattu eikä se saa omistaa liiketoimintadataa tai muodostaa uutta
moduulirajaa.

## Nykyiset Toteutusreferenssit

Nykyiset moduulit ovat erikokoisia esimerkkejä, eivät yksi kopioitava
template-puu:

- **Customers** näyttää pienen master-data-moduulin, jossa muutama domain- ja
  application-vastuu, yksi repository-portti, yksi SQLite-adapteri ja yksi
  HTTP-kokonaisuus riittävät.
- **Company Settings** näyttää keskikokoisen asetusten ja salaisuuden
  elinkaaren moduulin, jossa tavallinen master data, backend-only secret portit,
  auditointi ja valinnaiset reitit tarvitsevat omat rajansa.
- **Invoicing** näyttää laajan liiketoimintamoduulin, jossa laskenta,
  transaktiot, snapshotit, dokumentit ja toimitusadapterit perustelevat useita
  pieniä portteja ja vastuukohtaisia tiedostoja.

Kaikissa kolmessa `apps/backend/src/composition/` kokoaa moduulin konkreettiset
adapterit ja reitit. Moduulien välille annetaan vain kuluttajan tarvitsema kapea
lukusopimus. Repositorya, audit writeria, secret storea tai muuta vapaasti
käytettävää riippuvuusrekisteriä ei palauteta.

Nykytilan yksityiskohtainen arvio ja hyväksytyt poikkeukset ovat dokumentissa
`docs/architecture/current-module-conformance-audit.md`.

## Backend Ja Data

- [ ] Toteuta infrastructure-adapterit porttien taakse; älä paljasta
  framework-, SQLite-, storage- tai provider-tyyppejä application/domainiin.
- [ ] Rajaa yksi infrastructure-adapteri omistamaan yksi koherentti repository-,
  persistence- tai read model -vastuu.
- [ ] Anna adapterin toteuttaa useita portteja vain, jos portit kuvaavat samaa
  koherenttia kyvykkyyttä sekä samaa transaktio- tai elinkaarirajaa.
- [ ] Toteuta toisistaan riippumattomat detail-, list-, context-, grouping-,
  reporting- ja projection-read modelit erillisinä adaptereina.
- [ ] Älä luo yleistä `Sqlite<Module>Reader`- tai
  `Sqlite<Module>Repository`-luokkaa vain composition-wiringin vähentämiseksi.
- [ ] Kytke konkreettiset adapterit nimetyssä composition rootissa ilman
  service locatoria tai request-kohtaista globaalia tilaa.
- [ ] Muodosta adapterit composition rootissa erikseen ja anna käyttötapaukselle
  vain sen tarvitsema portti.
- [ ] Jos olemassa oleva adapteri on saamassa toisen tai kolmannen itsenäisen
  portin, pysähdy ja arvioi vastuun jako ennen toteutusta.
- [ ] Muodosta `ActorContext` vain backendin vahvistamasta identiteetistä.
- [ ] Ota `companyId` aina vahvistetusta backend-kontekstista, ei request bodysta,
  query-parametrista tai rendererin ilmoittamana totuutena.
- [ ] Lisää backend-permission käyttötapaukselle ja pidä päätös deny by default.
- [ ] Repository omistaa atomisen tietokantatransaktion rajan ja kirjoitusten
  järjestyksen; application service omistaa käyttötapauksen.
- [ ] Käytä parametrisoitua SQL:ää ja yritysrajausta jokaisessa tenant-dataan
  kohdistuvassa luku- ja kirjoitusoperaatiossa.
- [ ] Älä muuta julkaistua migraatiota; tee skeemamuutos uutena migraationa
  erillisen päätöksen ja testien kanssa.

## Moduulien Välinen Yhteistyö

- [ ] Moduuli ei importtaa toisen moduulin infrastructurea, repository-
  adapteria, HTTP-handleria tai sisäistä UI-komponenttia.
- [ ] Cross-module-luku tehdään omistavan moduulin tarjoaman kapean reader-portin
  tai application-sopimuksen kautta.
- [ ] Cross-module-kirjoitus kulkee aina omistavan moduulin application servicen
  kautta ja noudattaa sen permission-, validointi- ja audit-sääntöjä.
- [ ] Jaettu tekninen työkalu irrotetaan vasta 2-3 riippumattoman aidon
  käyttötapauksen jälkeen.
- [ ] Jaettu työkalu ei sisällä yhden moduulin domain-sääntöä eikä muutu
  `utils`, `helpers` tai `common` -kaatopaikaksi.

## API Ja Frontend

- [ ] HTTP-handler validoi ulkoisen syötteen tyypin, muodon, pituuden, rajat ja
  käyttötapauksen vaatimat turvallisuusehdot.
- [ ] Handler delegoi liiketoiminnan application serviceen eikä laske tai
  päätä domain-asioita itse.
- [ ] API-client kuvaa HTTP-sopimusta, ei backendin sisäisiä tai tietokannan
  tyyppejä.
- [ ] Frontend käyttää API-clientiä; React-komponentti ei tee raakaa fetchiä
  eikä kutsu tietokantaa, Firebasea tai Electronia suoraan.
- [ ] Feature käyttää julkista entrypointia ja omistaa oman näkymätilansa,
  lomakkeensa, hookkinsa ja featurekohtaiset CSS Module -tyylinsä.
- [ ] Käyttäjälle näkyvät tekstit ovat nykyisessä i18n-rakenteessa ja virheet
  ovat turvallisia: response bodya, stack tracea tai sisäisiä tunnisteita ei
  renderöidä sellaisenaan.

## Testit Ja Valmistuminen

### Observability ja auditointi

- [ ] Määrittele moduulin omistama business event catalog.
- [ ] Määrittele operational event catalog.
- [ ] Määrittele security event catalog.
- [ ] Nimeä jokaisen tapahtuman omistava moduuli tai infrastruktuurivastuu.
- [ ] Nimeä kriittiset audit-eventit ja niiden transaction ownership.
- [ ] Määrittele jokaiselle eventille sallitut ja kielletyt kentät ilman
  arbitrary metadataa.
- [ ] Luokittele event-kenttien henkilötieto- ja pseudonyymisisältö.
- [ ] Valitse retention tarkoituksen, ei vain tietolähteen perusteella.
- [ ] Päätä Activity-projektio tai dokumentoi poissulku.
- [ ] Päätä Diagnostics-projektio tai dokumentoi poissulku.
- [ ] Päätä tukipakettisisällytys tai dokumentoi poissulku.
- [ ] Päätä incident-index-kelpoisuus tai dokumentoi poissulku.
- [ ] Päätä erikseen business audit- ja operational log -virheen vaikutus
  käyttötapaukseen.
- [ ] Lisää redaction-, control character-, henkilötieto- ja
  salaisuustestit.
- [ ] Lisää onnistuvien, estettyjen ja rikkoutuvien polkujen yksikkö-,
  integraatio- ja E2E-testit.

R0-observability on yhteinen tuotantoperusta. Moduuli ei luo omaa
`LoggerManager`-palvelua, arbitrary metadata -sopimusta, event-kuorta,
retention-järjestelmää tai tukipakettiformaattia. Business audit, technical
log ja tukipaketti ovat eri vastuita.

- [ ] Lisää domain-invarianttien ja application-käyttötapausten positiiviset ja
  negatiiviset testit.
- [ ] Testaa tenant-/company-rajaus, permission-deny ja tuntemattoman resurssin
  geneerinen turvallinen virhe.
- [ ] Testaa repositoryn rollback, atomisuus, guardit ja osittaisen kirjoituksen
  estyminen oikealla testitietokannalla.
- [ ] Testaa väärät tyypit, rajat, pitkät arvot, tyhjät arvot ja muu
  luottamusrajan ulkopuolinen syöte riskin mukaan.
- [ ] Testaa julkinen HTTP- ja API-client-sopimus sekä käyttäjän olennainen
  näkymäpolku.
- [ ] Pidä yksikkö- ja komponenttitestit toteutuksen vieressä; tee erillinen
  E2E-alue vasta usean kerroksen käyttäjäpoluille.
- [ ] Päivitä `r0-e2e-test-matrix.md`: vähintään onnistuva käyttäjäpolku,
  permission-/tenant-esto ja failure-/recovery-polku.
- [ ] Lisää cross-module E2E -skenaario, jos moduuli lukee tai komentaa toista
  moduulia sen julkisen portin kautta.
- [ ] Kirjaa skenaariolle Activity-, Diagnostics-, incident-index- ja support
  bundle -sisällytys tai poissulku.
- [ ] Päivitä packaged-smoke- tai Electron development -raja, jos moduuli lisää
  desktop-capabilityn, uuden IPC-metodin tai uuden privileged main -toiminnon.
- [ ] Älä lisää moduuliin E2E-reset-, seed- tai fault HTTP -reittejä.
- [ ] Aja kohdepaketin testit, workspace-testit, typecheck, tarvittavat buildit
  ja `git diff --check`.
- [ ] Tarkista moduulirajat, importit, entrypointit, Electron-allowlistit,
  dokumenttilinkit, Git-status sekä se, ettei mukaan tullut salaisuuksia,
  henkilötietoa tai build-artifakteja.

## Liittyvät Ohjeet

- `docs/architecture/base-architecture.md`
- `docs/architecture/module-boundaries.md`
- `docs/architecture/dependency-policy.md`
- `docs/architecture/security-principles.md`
- `docs/architecture/codebase-cleanup-roadmap.md`
- `docs/architecture/current-module-conformance-audit.md`
- `docs/ai/testing-rules.md`
- `docs/ai/review-checklist.md`
