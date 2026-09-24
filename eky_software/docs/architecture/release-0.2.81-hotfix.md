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

Tila: paikallinen allekirjoittamaton pilottipaketti valmis. Omistaja paatti
toimittaa taman rajatun korjauksen omaan kokeiluun ja siirtaa GitHubin
laajemman testiharnessin selvityksen myohemmaksi. Tama on vain taman
pilottitoimituksen poikkeus, ei yleinen julkaisuporttien muutos tai tayden
CI-hyvaksynnan ilmoitus.

Korjauksen kohdetestit (24), koko workspacen testit ja typecheck seka
installerin yksikkotestit (94) ovat lapaisseet. Lopullinen pilotti on
rakennettu kerran puhtaasta version kayttoonottavasta revisiosta
`9699f4e0efd0a82984d155b4d46b0b401ebb17e3`. Sen hardened Windows backup ->
inspect -> restore -> restart -> compare lapaisi synteettisella profiililla
release-candidate-tilassa. Payload-inventaario sailyi muuttumattomana
tarkistuksen ja MSI-rakennuksen yli. MSI:n rakenne, julkaisuidentiteetti,
manifesti, SHA-256 ja toimituskopion samat tavut on tarkistettu.

GitHubin riippuvuusauditointi lapaisi. Tayden installer-hyvaksyntaharnessin
ajossa yksi muuttumaton supervisor-sopimustesti epaonnistui odottaessaan
lapsiprosessin valmiusmerkintaa. Laajojen CI-ajojen jatko keskeytettiin
omistajan paatoksella. Korjausta ei ole yhdistetty mainiin; normaali
PR/main-hyvaksynta ja molemmat exact-byte clean-consumerit jaavat avoimiksi.
Taman MSI:n asennettua paivitysta versioista `0.2.6` tai `0.2.7` ei ole
todennettu. Paketin kaynnistystesti ei yksin korvaa sita.

Hyvaksytty `0.2.8`-bundle on tarkistettu muuttumattomaksi. Uusi kolmen
tiedoston bundle sisaltaa `Eky-0.2.81-x64.msi`-tiedoston, sen manifestin ja
tarkistussumman. MSI:n SHA-256 on
`0386a5d4860644752733c88213cb43d42cdc71c1c83b54ec8e3fda65c3276af4`.
Kyseessa on paikallinen build ilman GitHub-artifact-ID:ta; toimituksen
johdosta ei ole ajettu automaattista asennusta. Julkaistuja tavuita ei
korvata saman version uudelleenrakennuksella.

Varmuuskopioiden saatavuus ja kohdelaitteen turvallisuusehdot ovat erillisia
kayttoonoton ehtoja. Asennus tai uudelleenasennus ei poista business-dataa;
automaattista profiilin nollausta ei tehda.

## Viitteet

- [Versiointi](release-versioning-policy.md)
- [Palautuksen turvallisuus](local-backup-and-restore-plan.md#cross-company-raja)
- [Installer-hyvaksynta](windows-installer-acceptance-harness-v2.md)
