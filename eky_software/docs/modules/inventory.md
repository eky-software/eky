# Inventory-moduuli

Tämä dokumentti kuvaa varastonhallinnan alustavan suunnan.

Inventory ei ole ensimmäisen MVP:n päämoduuli.

## Tarkoitus

Inventory-moduuli voi myöhemmin hallita tuotteita, materiaaleja, saldoja ja varastopaikkoja.

## Moduuli omistaa

Mahdollisesti myöhemmin:

- tuotteet
- tuotekoodit
- materiaalit
- saldot
- varastopaikat
- ostot
- varaukset
- inventoinnit

## Moduuli ei omista

- työmaalle kirjattuja materiaalitapahtumia, jos ne kuuluvat Material Entries -logiikkaan
- laskuja
- asiakkaan perustietoja
- työmääräyksiä

## Tärkeitä käsitteitä

- Product
- InventoryItem
- StockLevel
- StockLocation
- Purchase
- Reservation

## Ero materiaalikirjauksiin

Inventory tarkoittaa varaston hallintaa.

MaterialEntry tarkoittaa työmaalle tai työlle kirjattua käytettyä materiaalia.

Kaikki materiaalikirjaukset eivät välttämättä vähennä varastoa ensimmäisessä versiossa.

## Turvallisuus

Varastosaldot ja ostohinnat voivat olla liiketoimintakriittisiä tietoja.

Käyttöoikeudet määritellään ennen toteutusta.

## Avoimet kysymykset

- tarvitaanko varastonhallintaa ensimmäisessä versiossa?
- riittääkö aluksi vapaa materiaalikirjaus?
- tarvitaanko tuotekoodit?
- hallitaanko ostohintoja?
- vaikuttaako materiaalikirjaus saldoon?
- tarvitaanko inventointia?