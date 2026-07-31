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
- Customers- ja Company Settings -päivityksissä valinnaiset, moduulin
  allowlistasta luetut turvalliset muutoskategoriat

Projektio ei sisällä nimiä, osoitteita, sähköposteja, puhelinnumeroita,
pankkitietoja, laskurivejä, kenttänimiä tai -arvoja, actor-id:tä, raw audit
metadataa, teknisiä lokeja, virhepinoja tai salaisuuksia.

Customersin sallitut kategoriat ovat `identity`, `contact`, `billing`,
`pricing` ja `status`. Company Settingsin sallitut kategoriat ovat `identity`,
`address`, `contact`, `banking`, `invoicingDefaults` ja
`emailConfiguration`. UI näyttää enintään kolme ryhmää ja käyttää sitä
laajemmalle muutokselle yleistä tekstiä. Tuntematon, kahdentunut tai väärän
moduulin kategoria torjutaan.

Kaikki haut rajataan backendin vahvistaman `ActorContext.companyId`-arvon
perusteella ja käyttötapaus vaatii erillisen `viewActivity`-oikeuden.

## Kuukausihistoria

Tapahtuma-aikaleimat säilyvät UTC:ssa, mutta käyttäjän valitsema kuukausi on
`Europe/Helsinki`-aikavyöhykkeen kalenterikuukausi. Kuukauden paikalliset
00.00-rajat muunnetaan backendissä UTC-hakuväliksi. Web käyttää samaa
aikavyöhykettä oletuskuukauden valintaan eikä kummankaan prosessin järjestelmän
paikallinen aikavyöhyke määrää tulosta. Julkinen read model tukee
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

Invoicingin projektio sisältää myös ALV-kantojen, laskunumeroinnin ja
maksuasetusten muutokset ilman asetusten arvoja tai teknistä tunnistetta.
Manuaalisesta laskun maksumerkinnästä ja sen poistamisesta projektio näyttää
vain laskunumeron, tapahtuma-ajan ja turvallisen toiminnon. Maksupäivää,
euromäärää, maksulähdettä, actor-tunnistetta, pankkitietoa tai asiakastietoa ei
palauteta Activityyn.
Company Settingsin projektio yhdistää yrityksen master data -muutokset ja
sähköpostisalaisuuden valmiit lifecycle-tapahtumat. Salaisuutta, sen pituutta,
hashia, viitettä tai failure detail -tietoa ei palauteta Activityyn.
