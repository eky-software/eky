# Laskutuksen ja työnohjauspolun rajat

Tämä dokumentti määrittelee laskutuksen, kohteiden, työmääräysten, työ- ja materiaalikirjausten sekä myöhemmän mobiilityönkulun väliset rajat.

Tavoitteena on varmistaa, että laskutus toimii itsenäisesti, mutta voi myöhemmin hyödyntää kenttätyöstä syntyvää hyväksyttyä aineistoa.

Tämä ei ole laskutusmoduulin tietokanta- tai toteutussuunnitelma.

## Laskutus Toimii Itsenäisesti

Invoicing-moduulin pitää pystyä luomaan lasku suoraan asiakkaalle.

Manuaalinen lasku ei edellytä:

- kohdetta
- työmääräystä
- tuntikirjausta
- materiaalikirjausta
- mobiilisovellusta
- synkronointia

Work Orders tai mobiilityönkulku eivät saa olla laskutusmoduulin käynnistymisen tai käyttämisen edellytys.

Ensimmäinen laskutuspolku voi siksi olla perinteinen laskunkirjoitus:

```text
asiakas
  -> käsin lisätyt laskurivit
    -> laskuluonnos
      -> tarkistus ja hyväksyntä
```

## Sites On Valinnainen Tarkennus

Sites-moduuli omistaa kohteet.

Asiakkaalla voi myöhemmin olla useita kohteita.

Kohde voi liittyä:

- työmääräykseen
- laskuun
- laskuriviin tai laskun kuvaukseen myöhemmin erikseen päätettävällä tavalla

Lasku voidaan kuitenkin tehdä myös ilman kohdetta.

Kohteen puuttuminen ei saa estää manuaalista laskutusta.

## Work Orders On Valinnainen Työnkulku

Work Orders on toiminnanohjauksen ja kenttätyön moduuli.

Työmääräys voi kuvata:

- mitä tehdään
- missä tehdään
- kuka tekee
- milloin tehdään
- mikä työn tila on

Työmääräykseen voidaan myöhemmin liittää tunti- ja materiaalikirjauksia sekä kommentteja.

Hyväksytyistä kirjauksista voidaan myöhemmin muodostaa laskuehdotus tai laskuluonnoksen lähtöaineisto.

Työmääräys ei kuitenkaan ole laskutuksen edellytys. Invoicing ei saa riippua Work Orders -moduulin sisäisestä toteutuksesta.

## Mobiilityönkulku Myöhemmin

Työmääräys voidaan myöhemmin välittää työntekijän mobiilisovellukseen.

Työntekijä voi myöhemmin kirjata mobiilissa:

- tunnit
- materiaalit
- kommentit
- kuvat
- työn tilan

Kentältä tuleva aineisto ei siirry automaattisesti lopulliseksi laskuksi.

Suunniteltu hallittu virta:

```text
työmääräys
  -> mobiilikirjaukset
    -> synkronointi backendille
      -> tarkistus tai hyväksyntä
        -> laskuehdotus
          -> toimiston tarkistus
            -> laskuluonnos tai lasku
```

Mobiilikäyttöliittymän teknologia on erillinen tekninen päätös. Nykyinen alustava suunta on kuvattu dokumentissa `docs/architecture/tech-decisions.md`. Mahdollinen Kotlin-, React Native- tai muu toteutus ei saa muuttaa domain- ja application-kerrosten moduulirajoja.

## Moduulien Omistajuus Ja Keskustelu

Moduulit omistavat oman datansa:

- Customers omistaa asiakkaan perustiedot ja asiakaskohtaiset asetukset.
- Sites omistaa kohteet.
- Work Orders omistaa työmääräykset.
- Work Entries omistaa tunti- ja työaikakirjaukset.
- Material Entries omistaa materiaalikirjaukset.
- Invoicing omistaa laskuluonnokset, laskut, laskurivit ja laskutuksen snapshot-tiedot.
- Customer Overview voi näyttää koosteen, mutta ei omista muiden moduulien dataa.

Moduulien välinen keskustelu tapahtuu hallitusti:

- application servicejen kautta
- porttien ja rajapintojen kautta
- API-sopimusten kautta
- myöhemmin tarvittaessa tapahtumien kautta

Moduuli ei saa:

- kirjoittaa suoraan toisen moduulin tauluihin
- importata toisen moduulin infrastructure- tai repository-adapteria
- ohittaa toisen moduulin validointia, käyttöoikeuksia tai domain-sääntöjä
- käyttää Customer Overview -näkymää kirjoittavana oikopolkuna

## Laskun Perusmalli Suunnittelutasolla

Laskun mahdollinen myöhempi lähdemalli:

- `customerId` on pakollinen.
- `siteId` on valinnainen.
- `sourceType` kertoo laskun tai laskuehdotuksen alkuperän.
- `sourceId` on valinnainen lähdeviittaus.
- laskurivit sisältävät laskutushetken snapshot-tiedot.

Esimerkkilähteet:

```text
Manual invoice:
  sourceType = manual
  sourceId = null

Work orderista muodostettu laskuehdotus:
  sourceType = workOrder
  sourceId = workOrderId
```

Tämä malli on vasta rajausperiaate. Se ei vielä päätä tietokantatauluja, API-sopimuksia, enumien lopullista muotoa tai sitä, voiko yhdellä laskulla myöhemmin olla useita lähteitä.

## Snapshot-Periaate

Laskulle ja laskuriveille tallennetaan laskutushetken tiedot.

Snapshot voi sisältää esimerkiksi:

- oman yrityksen lähettäjätiedot
- asiakkaan nimen
- asiakkaan laskutusosoitteen
- kohteen tunnistetiedot, jos kohdetta käytetään
- käytetyn tuntihinnan
- rivin kuvauksen
- rivin määrän
- rivin yksikön
- rivin yksikköhinnan
- ALV-tiedot
- rivin summan

Vanha lasku ei saa muuttua, vaikka myöhemmin muuttuvat:

- asiakaskortti
- oman yrityksen tiedot
- kohde
- työmääräys
- tunti- tai materiaalikirjaus
- oletustuntihinta
- asiakaskohtainen tuntihinta

Invoicing omistaa laskulle tallennetut snapshot-arvot.

## Offline, Cloud Ja Firebase

Tämä rajaus noudattaa dokumentin `docs/decisions/ADR-0003-technical-foundation.md` käyttötiloja:

- offline local mode
- cloud connected mode
- multi-device mode

Manuaalisen laskutuksen ja moduulien domain/application-logiikan pitää toimia paikallisessa mallissa ilman pakollista pilviyhteyttä.

Firebase, pilvisynkronointi ja mobiilisynkronointi kuuluvat myöhempiin infrastructure-, adapter- ja sync-kerroksiin.

Domain- ja application-kerrokset eivät saa riippua suoraan:

- Firebasesta
- mobiilikehyksestä
- synkronointikirjastosta
- SQLite- tai PostgreSQL-toteutuksesta

Synkronointi ei saa ohittaa backendin käyttöoikeus-, yritysrajaus-, validointi- tai domain-sääntöjä.

## Rajaus

Tässä dokumentissa ei suunnitella vielä:

- laskutuksen tietokantaskeemaa
- laskunumerointia
- ALV-laskennan toteutusta
- laskun tilasiirtymien lopullisia sääntöjä
- PDF-generointia
- sähköposti- tai verkkolaskulähetystä
- Sites-moduulin toteutusta
- Work Orders -moduulin toteutusta
- Work Entries- tai Material Entries -toteutusta
- mobiilisovelluksen toteutusta
- pilvisynkronoinnin toteutusta

Näistä tehdään myöhemmin omat rajatut suunnitelmat ja päätökset.

## Liittyvät Dokumentit

- `AGENTS.md`
- `docs/decisions/ADR-0003-technical-foundation.md`
- `docs/architecture/module-boundaries.md`
- `docs/architecture/dependency-policy.md`
- `docs/architecture/customer-overview-plan.md`
- `docs/architecture/local-cloud-sync.md`
- `docs/modules/customers.md`
- `docs/modules/company-settings.md`
- `docs/modules/invoicing.md`
- `docs/modules/work-orders.md`
- `docs/product/workflows.md`
