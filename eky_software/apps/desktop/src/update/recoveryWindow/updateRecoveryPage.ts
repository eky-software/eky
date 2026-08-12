export const updateRecoveryPageUrl = createUpdateRecoveryPageUrl();

function createUpdateRecoveryPageUrl(): string {
  const html = `<!doctype html>
<html lang="fi">
  <head>
    <meta charset="UTF-8">
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"
    >
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Eky - palautustila</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Arial, sans-serif;
        background: #eef4fb;
        color: #07182d;
      }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 28px; }
      main {
        background: #fff;
        border: 1px solid #c9d9ec;
        border-radius: 6px;
        padding: 26px;
      }
      .eyebrow { color: #075dcc; font-size: 12px; font-weight: 700; margin: 0 0 8px; }
      h1 { font-size: 22px; margin: 0 0 10px; }
      p { color: #46627f; line-height: 1.5; margin: 0 0 18px; }
      dl {
        border-block: 1px solid #d5e1ef;
        display: grid;
        grid-template-columns: 160px minmax(0, 1fr);
        margin: 22px 0;
        padding: 16px 0;
        row-gap: 10px;
      }
      dt { color: #46627f; font-weight: 700; }
      dd { margin: 0; overflow-wrap: anywhere; }
      .actions { display: flex; flex-wrap: wrap; gap: 10px; }
      button {
        background: #fff;
        border: 1px solid #9eb9d8;
        border-radius: 4px;
        color: #07182d;
        cursor: pointer;
        font: inherit;
        font-weight: 700;
        padding: 10px 16px;
      }
      button.primary { background: #075dcc; border-color: #075dcc; color: #fff; }
      button.danger { border-color: #b42345; color: #9d1535; }
      button:disabled { cursor: wait; opacity: 0.65; }
      .status { min-height: 24px; margin: 18px 0 0; }
      [hidden] { display: none !important; }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">TURVALLINEN PALAUTUSTILA</p>
      <h1>Eky vaatii tarkistuksen</h1>
      <p>
        Yritystietoja ei avata tässä tilassa. Älä poista tai muokkaa Eky-tiedostoja käsin.
        Luo tarvittaessa tukipaketti ja toimita se vain luotetulle tukihenkilölle.
      </p>
      <dl>
        <dt>Virhekoodi</dt><dd id="error-code"></dd>
        <dt>Sovellusversio</dt><dd id="app-version"></dd>
        <dt>Build</dt><dd id="build-revision"></dd>
      </dl>
      <div class="actions">
        <button id="support-bundle" type="button">Luo tukipaketti</button>
        <button id="open-logs" type="button">Avaa lokikansio</button>
        <button id="select-rollback" class="primary" type="button" hidden>
          Valitse palautuspaketti
        </button>
        <button id="close" class="danger" type="button">Sulje Eky</button>
      </div>
      <p id="status" class="status" role="status" aria-live="polite"></p>
    </main>
  </body>
</html>`;

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
