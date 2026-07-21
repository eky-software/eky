import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MessageBanner } from './MessageBanner.js';

describe('MessageBanner', () => {
  it('renders errors as accessible alerts with the existing error classes', () => {
    const html = renderToStaticMarkup(
      <MessageBanner variant="error">Tallennus epäonnistui.</MessageBanner>,
    );

    expect(html).toContain('class="message error-message"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Tallennus epäonnistui.');
  });

  it('renders success and info messages as status updates', () => {
    const successHtml = renderToStaticMarkup(
      <MessageBanner variant="success">Tallennettu.</MessageBanner>,
    );
    const infoHtml = renderToStaticMarkup(
      <MessageBanner variant="info">
        <strong>Ladataan</strong>
      </MessageBanner>,
    );

    expect(successHtml).toContain('class="message success-message"');
    expect(successHtml).toContain('role="status"');
    expect(infoHtml).toContain('class="message"');
    expect(infoHtml).toContain('role="status"');
    expect(infoHtml).toContain('<strong>Ladataan</strong>');
  });
});
