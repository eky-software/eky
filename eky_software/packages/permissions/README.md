# Permissions package

Tämä paketti sisältää käyttöoikeuksiin liittyvät tyypit ja tarkistukset.

Vastuut:

- rajatut permission-tyypit
- turvallinen, tyypitetty authorization-virhe
- deny-by-default `requirePermission`-tarkistus
- frontendin käyttökokemusta tukevat tarkistukset
- backendin käyttöoikeustarkistusten yhteinen logiikka, jos soveltuu

Backend tekee lopulliset käyttöoikeuspäätökset.

Käyttöoikeuksien oletusmalli on deny by default.

Nykyinen toteutus sisältää toimintokohtaisia permissioneja muun muassa
yritysasetuksille, laskutusasetuksille, numerointisarjan hallitulle vaihdolle,
laskujen korjauksille ja maksuille, sähköpostipolulle, Activitylle,
diagnostiikalle ja tukipaketille. Local ownerin oikeudet luetellaan erikseen
backendin local identity -adapterissa; uuden permission-arvon lisääminen tähän
pakettiin ei anna oikeutta automaattisesti.

Rooli- ja käyttäjähallinta lisätään myöhemmin erillisen päätöksen perusteella.
