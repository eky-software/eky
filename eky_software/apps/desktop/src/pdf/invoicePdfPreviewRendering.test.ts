import { describe, expect, it } from 'vitest';

import { hasVisiblePdfPreview } from './invoicePdfPreviewRendering.js';

describe('invoice PDF preview rendering', () => {
  it('accepts a sufficiently large bitmap with visible color variation', () => {
    const bitmap = createSolidBitmap(240, 240, 255);
    bitmap[0] = 20;

    expect(
      hasVisiblePdfPreview({ bitmap, height: 240, width: 240 }),
    ).toBe(true);
  });

  it('rejects blank, truncated, and implausibly small captures', () => {
    expect(
      hasVisiblePdfPreview({
        bitmap: createSolidBitmap(240, 240, 255),
        height: 240,
        width: 240,
      }),
    ).toBe(false);
    expect(
      hasVisiblePdfPreview({
        bitmap: new Uint8Array(16),
        height: 240,
        width: 240,
      }),
    ).toBe(false);
    expect(
      hasVisiblePdfPreview({
        bitmap: createSolidBitmap(100, 100, 255),
        height: 100,
        width: 100,
      }),
    ).toBe(false);
  });
});

function createSolidBitmap(
  width: number,
  height: number,
  channelValue: number,
): Uint8Array {
  const bitmap = new Uint8Array(width * height * 4);
  bitmap.fill(channelValue);

  return bitmap;
}
