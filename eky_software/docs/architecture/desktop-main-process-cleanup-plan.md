# Desktop Main Process Cleanup Plan

Tämä dokumentti kuvaa Electron main processin nykyiset vastuut ja
muuttumattomat turvallisuusrajat ennen käyttäytymisen säilyttävää
rakenteellista jakoa. Auditoinnin baseline on commit `b2e0f0e`.

Dokumentti ei muuta preloadia, IPC-kanavia, custom protocolia, safeStoragea,
backend-runtimea, paketointia tai sovelluksen käyttäytymistä.

## Nykyiset Vastuut

`apps/desktop/src/main/index.ts` omistaa auditointihetkellä:

- `eky`-schemen privileged-rekisteröinnin ennen `app.ready`-tilaa
- smoke-tokenin validoinnin ja eristetyn smoke-`userData`-hakemiston
- single instance -lukon
- Electronin lifecycle-tapahtumat
- runtime-sessionin luonnin
- paketoidun backend child processin käynnistyksen ja valvonnan
- backendin tiedosto-, SQLite-, migration-, storage- ja smoke-polut
- safeStorage-protectorin, salatun secret-tiedoston ja yksityisen
  `MessageChannelMain`-brokerin koostamisen
- `eky://app`-custom protocolin rekisteröinnin
- oletussession permission-pyyntöjen kiellon
- turvallisen pääikkunan luonnin, navigointirajan ja lataamisen
- PDF-preview-controllerin koostamisen
- SMTP-testin ja laskun sähköpostin main-process-vahvistusdialogit
- turvalliset käyttäjävirhedialogit ja renderer-fokuksen palautuksen
- packaged smoken health-, SQLite-, PDF-, preload-, delete transport-,
  secret lifecycle- ja PDF-preview-tarkistukset
- hallitun shutdown-järjestyksen

Nämä vastuut kuuluvat desktop-infrastruktuuriin, mutta niiden ei tarvitse
kaikkien sijaita Electronin entrypointissa.

## Muuttumattomat Turvallisuusrajat

### Main Process Ja Renderer

- `safeStorage`-rajapintaa käyttää vain Electron main process
- renderer ei saa secret broker -porttia eikä salaisuuden lukutoimintoa
- preloadin julkinen sopimus ei laajene
- renderer saa PDF-esikatselua varten välittää vain validoitavan laskutunnisteen
- `nodeIntegration` ja `nodeIntegrationInWorker` pysyvät pois käytöstä
- `contextIsolation`, `sandbox` ja `webSecurity` pysyvät käytössä
- webview ja kaikki rendererin `window.open`-yritykset estetään
- renderer ei saa raakaa IPC-, filesystem-, shell- tai process-rajapintaa

### Ikkunat Ja Navigointi

- pääikkunan asetukset muodostetaan edelleen nykyisellä
  `createSecureWindowOptions`-funktiolla
- pääikkuna lataa vain `eky://app/index.html`-osoitteen
- navigointi sallitaan vain `eky://app`-originissa
- PDF-preview käyttää nykyistä sandboxattua child-window-politiikkaa
- PDF-preview hyväksyy vain main processin muodostaman tarkan lasku-PDF:n
  `eky://app/invoices/{invoiceId}/pdf`-osoitteen
- PDF-previewin pop-upit, webviewt, poikkeava navigointi ja Node-oikeudet
  pysyvät estettyinä
- yhtä aikaa avoimien PDF-preview-ikkunoiden nykyinen raja säilyy

### Backend Ja Runtime Session

- backend kuuntelee vain loopback-osoitetta ja satunnaista porttia
- runtime-session on uusi 256-bittinen salaisuus jokaiselle käynnistykselle
- sessionia ei välitetä rendererille, URL:iin, komentoriville tai lokiin
- custom protocol lisää session-headerin vain Electron main processissa
- protocol endpoint -allowlist säilyy eksplisiittisenä eikä yleisty
- backendin `ActorContext` ja permission-rajat säilyvät muuttumattomina

### Salaisuudet

- safeStorage-salaus ja sen saatavuustarkistus säilyvät fail-closed-mallina
- salattu blob säilyy Electronin `userData/runtime/secrets`-alueella
- secret broker käyttää edelleen vain yksityistä main/backend-
  `MessageChannelMain`-kanavaa
- renderer, SQLite, API-response ja lokit eivät saa SMTP-salasanaa
- smoke käyttää vain synteettistä salaisuutta ja tarkistaa, ettei se päädy
  salattuun tiedostoon selväkielisenä

### Permissionit Ja Vahvistukset

- `setPermissionRequestHandler` kieltää kaikki permission-pyynnöt
- `setPermissionCheckHandler` palauttaa aina `false`
- laskun sähköpostin ja SMTP-testin vahvistus tapahtuu main processin
  omistamassa dialogissa
- dialogien tekstit, nappijärjestys, `defaultId`, `cancelId`, `noLink`,
  resend-käyttäytyminen ja owner-window säilyvät
- dialogin sulkemisen jälkeen pääikkunan ja rendererin fokus palautetaan

## Packaged Smoke -Baseline

Paketoitu smoke käyttää validoitua 32-merkkistä heksatokenia ja eristettyä
väliaikaista `userData`-hakemistoa. Smoke todentaa:

1. backendin health-vastauksen
2. paikallisen SQLite-tiedoston syntymisen
3. synteettisen PDF-tiedoston otsakkeen
4. vain nimetyn preload-PDF-sillan
5. DELETE-transportin custom protocolin kautta
6. SMTP-salaisuuden HTTP set/has/remove-lifecyclen
7. salaisuustiedoston, `.next`- ja `.backup`-slotien poistumisen
8. hyväksytyn laskun PDF-previewin renderöinnin ja ikkunaturvan
9. turvallisen result-tiedoston onnistumis- tai virhekoodin

Smoken pitää säilyä paketoidun Windows-artifactin tarkistuksena. Sitä ei
korvata pelkillä yksikkötesteillä.

## Tavoitejako

`packagedSmoke.ts` omistaa smoke-tokenin, smoke-polut, result-tiedoston ja
paketoidut assertiot.

`applicationWindow.ts` omistaa turvallisen pääikkunan luonnin, rajoitukset ja
`eky://app/index.html`-latauksen. Varsinaiset kovennusasetukset säilyvät
`windowSecurity.ts`-tiedostossa.

`invoiceDeliveryConfirmation.ts` omistaa main-process-dialogien esityksen ja
fokuksen palautuksen. Vahvistusdataparsinta säilyy nykyisissä rajatuissa
confirmation-tiedostoissa.

`desktopComposition.ts` omistaa runtime-sessionin, polut, secret brokerin,
backendin, protocolin, permissionit, ikkunat, PDF-controllerin sekä smoke- ja
normaalikäynnistyksen koostamisen. Se palauttaa vain nimetyn lifecycle-handlen:

- `applicationWindow`
- `focusApplicationWindow`
- `shutdown`

`index.ts` jää Electron-lifecycle-entrypointiksi. Se rekisteröi schemen oikeaan
aikaan, valitsee smoke-profiilin, hallitsee single instance -lukon,
`app.whenReady`-käynnistyksen, aktivoinnin, toisen instanssin, ennen sulkemista
tehtävän shutdownin, kaikkien ikkunoiden sulkeutumisen ja ylimmän tason
turvallisen virhekäsittelyn.

## Shutdown-Invariantti

Hallitun shutdownin järjestys säilyy:

1. PDF-preview-controller dispose
2. backend child process stop
3. secret broker close
4. Electron app quit lifecycle-entrypointissa

Auditoinnissa ei löytynyt aktiivista Electron-luottamusraja- tai
turvallisuusvirhettä. Rakenteellinen jako ei saa muuttaa preload-, IPC-,
protocol-, safeStorage-, fuse-, sandbox- tai package-sopimusta.
