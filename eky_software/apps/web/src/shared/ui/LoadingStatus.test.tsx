import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LoadingMark, LoadingStatus } from './LoadingStatus.js';
import styles from './LoadingStatus.module.css';

describe('LoadingStatus', () => {
  it('renders a polite atomic status with the existing message class by default', () => {
    const html = renderToStaticMarkup(<LoadingStatus>Ladataan.</LoadingStatus>);

    expect(html).toContain(`<p class="${styles.status} message"`);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain(
      `<span aria-hidden="true" class="${styles.spinner}"></span>`,
    );
    expect(html).toContain(`<span class="${styles.text}">Ladataan.</span>`);
    expect(html).not.toContain('aria-busy');
    expect(html).not.toContain('role="alert"');
  });

  it('renders feature-owned ReactNode content in the text span', () => {
    const html = renderToStaticMarkup(
      <LoadingStatus active>
        <strong>Ladataan</strong>
      </LoadingStatus>,
    );

    expect(html).toContain(
      `<span class="${styles.text}"><strong>Ladataan</strong></span>`,
    );
  });

  it('uses the caller class instead of the default message class', () => {
    const html = renderToStaticMarkup(
      <LoadingStatus className="reserved-status">Tallennetaan.</LoadingStatus>,
    );

    expect(html).toContain(`class="${styles.status} reserved-status"`);
    expect(html).not.toContain(' message');
  });

  it('uses the default class for an optional CSS-module class', () => {
    const html = renderToStaticMarkup(
      <LoadingStatus className={undefined}>Ladataan.</LoadingStatus>,
    );

    expect(html).toContain(`class="${styles.status} message"`);
    expect(html).not.toContain('undefined');
  });

  it('escapes text and caller attributes without rendering raw HTML or controls', () => {
    const html = renderToStaticMarkup(
      <LoadingStatus className={'status" data-unsafe="true'}>
        {'<button onclick="unsafe()">&</button>'}
      </LoadingStatus>,
    );

    expect(html).toContain('status&quot; data-unsafe=&quot;true');
    expect(html).toContain(
      '&lt;button onclick=&quot;unsafe()&quot;&gt;&amp;&lt;/button&gt;',
    );
    expect(html).not.toContain(' data-unsafe="true"');
    expect(html).not.toMatch(/<(?:button|input|select|textarea|a|progress)\b/);
    expect(html).not.toMatch(/(?:tabindex|aria-busy|aria-valuenow)=/);
  });

  it('keeps only an empty live region when inactive', () => {
    const html = renderToStaticMarkup(
      <LoadingStatus active={false}>
        <strong>Tallennetaan.</strong>
      </LoadingStatus>,
    );

    expect(html).toBe(
      `<p class="${styles.status} message" role="status" aria-live="polite" aria-atomic="true"></p>`,
    );
    expect(html).not.toContain('<span');
    expect(html).not.toContain('Tallennetaan.');
    expect(html).not.toContain('<strong');
    expect(html).not.toContain('aria-busy');
  });

  it('reserves the same decorative mark slot in busy and idle buttons', () => {
    const active = renderToStaticMarkup(<LoadingMark active />);
    const inactive = renderToStaticMarkup(<LoadingMark active={false} />);

    expect(active).toBe(`<span aria-hidden="true" class="${styles.spinner}"></span>`);
    expect(inactive).toContain(`${styles.spinner} ${styles.inactiveSpinner}`);
    expect(inactive).toContain('aria-hidden="true"');
    expect(active + inactive).not.toContain('role=');
    expect(active + inactive).not.toContain('tabindex');
  });
});
