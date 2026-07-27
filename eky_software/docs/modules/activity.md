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
- turvallisen lopputuloksen: onnistui, epäonnistui, epäselvä tai estetty
- projektion sisäisen tapahtumatunnisteen

Projektio ei sisällä nimiä, osoitteita, sähköposteja, puhelinnumeroita,
pankkitietoja, laskurivejä, kenttäarvoja, changed-field-kategorioita, actor-id:tä,
raw audit metadataa, teknisiä lokeja, virhepinoja tai salaisuuksia.

Kaikki haut rajataan backendin vahvistaman `ActorContext.companyId`-arvon
perusteella ja käyttötapaus vaatii erillisen `viewActivity`-oikeuden.

## Kuukausihistoria

Tapahtumat luetaan UTC-kalenterikuukausittain. Julkinen read model tukee
moduulikategoriaa, turvallista lopputulossuodatusta sekä sivunumeroon ja
rajattuun sivukokoon perustuvaa selaamista.

Järjestys on vakaa: `occurredAt DESC` ja tasatilanteessa projektion
tapahtumatunniste `id DESC`. Moduulien readerit suodattavat kuukauden,
yritysrajan ja lopputuloksen ennen rajausta. Activity yhdistää moduulien
projektiot eikä tee N+1-hakuja.

Epäonnistuneesta, epäselvästä tai kesken jääneestä laskun toimituksesta
näytetään vain turvallinen tapahtumatyyppi ja lopputulos. SMTP-virhettä,
vastaanottajaa, viestin sisältöä tai muuta raakaa toimitusmetadataa ei
palauteta Activityyn.
