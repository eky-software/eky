# 0.2.81: rajattu palautuksen kaynnistyskorjaus

## Rajaus

Omistajan hyvaksyma valijulkaisu sisaltaa vain palautuksen kaynnistys- ja
virhepolkujen korjauksen seka uuden julkaisuidentiteetin. Seka sovellusversio
etta MSI-tuoteversio ovat `0.2.81`. Nykyinen kolmiosainen numerointi,
versiovertailu, downgrade-torjunta ja saman version uudelleenkayttokielto
sailyvat muuttumattomina.

Aiemmin `0.2.9`:lle suunnitellut ominaisuudet eivat kuulu tahan julkaisuun.
Niiden jatkosuunnitelmat sailyvat, mutta seuraavan julkaistavan version tulee
olla `0.2.81`:ta suurempi. Tama korjaus ei muuta sahkopostisalaisuuksien
mallia, tietokantaschemaa, backup-formaattia tai yritysten hallinnan UI:ta.

## Korjattu kayttaytyminen

- Palautuksen lykatyn hyvaksyntavaiheen vastuu alkaa heti validoinnin jalkeen,
  ennen myohempia health- ja session-tarkistuksia.
- Jos tarkistus epaonnistuu, aiemmat profiilitavut palautetaan vasta
  backendin onnistuneen sulkemisen jalkeen.
- Jos sulkeminen epaonnistuu, palautumiseen tarvittava journal ja aineisto
  sailyvat. Yritysosoitinta ei vaihdeta eika uutta runtimea kaynnisteta.
- Yrityksen lineage-tarkistus sailyy. Vanhaa journalitonta profiilin ja
  rekisterin ristiriitaa ei korjata arvaamalla tunnisteita tai poistamalla
  profiilia. Tama julkaisu ei lupaa automaattista korjausta sellaiseen tilaan.

Korjauksen kayttaytymistestit ovat `desktopRestoreStartup.test.ts` ja
`profileRestoreStartupRecovery.test.ts`. Ne kayttavat synteettista aineistoa;
paketoitu Windows-hyvaksynta todentaa erikseen oikean runtime-ketjun.

## Julkaisuportti

Tila: valmistelussa, ei viela toimitettavaa hyvaksyttya MSI-pakettia.

Paikalliset korjauksen kohdetestit (24), desktopin regressiosarja,
desktop-typecheck ja installerin yksikkotestit (94) ovat lapaisseet.
Kehityspaketin build ja hardened Windows backup -> inspect -> restore ->
restart -> compare ovat lapaisseet synteettisella profiililla. Tama on
kehityspaketin naytto, ei puhtaan release candidaten hyvaksymistodiste.

Ennen toimitusta vaaditaan nykyisen korjausrevision kohde- ja regressiotestit,
typecheck, tarvittavat buildit, hardened Windows backup -> inspect -> restore
-> restart -> compare seka normaalit PR-, main- ja riippuvuusturvan portit.
Lopullinen release candidate rakennetaan kerran puhtaasta version
kayttoonottavasta revisiosta. Molemmat clean-consumerit testaavat samat
MSI-tavut; bundle muodostetaan niista ilman paikallista rebuildia.

Hyvaksytty `0.2.8`-bundle sailyy muuttumattomana. Uuden bundlen hyvaksynta,
release-ajo, build-revisio, artifact-ID ja SHA-256 kirjataan vasta
todentamisen jalkeen. Dirty-kehityspaketti tai aikaisemman version vihrea
ajo ei korvaa uuden julkaisun hyvaksymista.

Varmuuskopioiden saatavuus ja kohdelaitteen turvallisuusehdot ovat erillisia
kayttoonoton ehtoja. Asennus tai uudelleenasennus ei poista business-dataa;
automaattista profiilin nollausta ei tehda.

## Viitteet

- [Versiointi](release-versioning-policy.md)
- [Palautuksen turvallisuus](local-backup-and-restore-plan.md#cross-company-raja)
- [Installer-hyvaksynta](windows-installer-acceptance-harness-v2.md)
