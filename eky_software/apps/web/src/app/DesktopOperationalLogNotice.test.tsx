import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DesktopOperationalLogNotice } from './DesktopOperationalLogNotice.js';

const noticeState = vi.hoisted(() => ({ failureObserved: false }));

// These units cover copy and markup only; browser tests own the React lifecycle.
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: vi.fn(),
  useState: () => [noticeState.failureObserved, vi.fn()],
}));

afterEach(() => {
  noticeState.failureObserved = false;
});

describe('DesktopOperationalLogNotice safe copy', () => {
  it('renders no notice or health claim before a failure is observed', () => {
    expect(renderToStaticMarkup(<DesktopOperationalLogNotice />)).toBe('');
  });

  it('renders only the approved non-blocking status without actions or private details', () => {
    noticeState.failureObserved = true;

    const html = renderToStaticMarkup(<DesktopOperationalLogNotice />);

    expect(html).toBe(
      '<p class="message error-message" role="status">' +
      'Lokituksessa havaittiin häiriö. Osa teknisistä tapahtumista voi puuttua.' +
      '</p>',
    );
  });
});
