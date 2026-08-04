export const backupPasswordPageUrl = createBackupPasswordPageUrl();

function createBackupPasswordPageUrl(): string {
  const html = `<!doctype html>
<html lang="fi">
  <head>
    <meta charset="UTF-8">
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"
    >
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Eky - varmuuskopion salasana</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Arial, sans-serif;
        background: #eef4fb;
        color: #07182d;
      }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 24px; }
      main {
        background: #fff;
        border: 1px solid #c9d9ec;
        border-radius: 6px;
        padding: 22px;
      }
      h1 { font-size: 20px; margin: 0 0 8px; }
      p { color: #46627f; line-height: 1.45; margin: 0 0 18px; }
      label { display: block; font-size: 14px; font-weight: 700; margin: 14px 0 6px; }
      input {
        border: 1px solid #aac3df;
        border-radius: 4px;
        font: inherit;
        padding: 10px 12px;
        width: 100%;
      }
      input:focus { outline: 2px solid #0b5dcc; outline-offset: 1px; }
      .hint { font-size: 13px; margin-top: 8px; }
      .error { color: #b42345; min-height: 20px; margin: 12px 0 0; }
      .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
      button {
        border: 1px solid #9eb9d8;
        border-radius: 4px;
        cursor: pointer;
        font: inherit;
        font-weight: 700;
        padding: 9px 16px;
      }
      button[type="submit"] { background: #075dcc; border-color: #075dcc; color: #fff; }
      button[type="button"] { background: #fff; color: #07182d; }
      button:disabled { cursor: wait; opacity: 0.65; }
      [hidden] { display: none !important; }
    </style>
  </head>
  <body>
    <main>
      <h1 id="title">Varmuuskopion salasana</h1>
      <p id="description"></p>
      <form id="password-form">
        <label for="password">Salasana</label>
        <input
          id="password"
          type="password"
          required
          maxlength="1024"
          autocomplete="current-password"
        >
        <div id="confirmation-group" hidden>
          <label for="confirmation">Salasana uudelleen</label>
          <input
            id="confirmation"
            type="password"
            maxlength="1024"
            autocomplete="new-password"
          >
        </div>
        <p class="hint" id="hint"></p>
        <p class="error" id="error" role="alert" aria-live="polite"></p>
        <div class="actions">
          <button id="cancel" type="button">Peruuta</button>
          <button id="submit" type="submit">Jatka</button>
        </div>
      </form>
    </main>
  </body>
</html>`;

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

