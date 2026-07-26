# Activity-moduuli

## Tarkoitus

Activity tarjoaa käyttäjälle turvallisen, vain lukuun tarkoitetun
tapahtumanäkymän tärkeimmistä liiketoimintamuutoksista.

## Omistajuus

Activity omistaa vain tapahtumien yhdistämisen ja julkisen read modelin. Se ei
omista audit-kirjoituksia, audit-tauluja eikä liiketoimintadataa.

Customers, Company Settings ja Invoicing omistavat omat audit-tapahtumansa ja
tarjoavat Activitylle kapeat, yritysrajatut reader-portit. Activity ei importtaa
niiden SQLite-adaptereita, repositoryja tai HTTP-koodia.

## Turvallinen projektio

Ensimmäinen projektio sisältää vain:

- vakaan tapahtumatyypin
- moduulin
- UTC-aikaleiman
- valinnaisen asiakasnumeron tai laskunumeron
- projektion sisäisen tapahtumatunnisteen

Projektio ei sisällä nimiä, osoitteita, sähköposteja, puhelinnumeroita,
pankkitietoja, laskurivejä, kenttäarvoja, changed-field-kategorioita, actor-id:tä,
raw audit metadataa, teknisiä lokeja, virhepinoja tai salaisuuksia.

Kaikki haut rajataan backendin vahvistaman `ActorContext.companyId`-arvon
perusteella ja käyttötapaus vaatii erillisen `viewActivity`-oikeuden.
