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

Ensimmäinen toteutus sisältää vain sähköpostipolun tarvitsemat permissionit.
Rooli- ja käyttäjähallinta lisätään myöhemmin erillisen päätöksen perusteella.
