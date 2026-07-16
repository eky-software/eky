const bytesPerPixel = 4;
const minimumPreviewDimension = 200;
const minimumSampledColorRange = 24;
const maximumSampleCount = 40_000;

interface PdfPreviewBitmap {
  bitmap: Uint8Array;
  height: number;
  width: number;
}

export function hasVisiblePdfPreview(input: PdfPreviewBitmap): boolean {
  if (
    !Number.isSafeInteger(input.width) ||
    !Number.isSafeInteger(input.height) ||
    input.width < minimumPreviewDimension ||
    input.height < minimumPreviewDimension
  ) {
    return false;
  }

  const pixelCount = input.width * input.height;
  const requiredBytes = pixelCount * bytesPerPixel;

  if (
    !Number.isSafeInteger(requiredBytes) ||
    input.bitmap.length < requiredBytes
  ) {
    return false;
  }

  const sampleStepPixels = Math.max(
    1,
    Math.floor(pixelCount / maximumSampleCount),
  );
  const sampleStepBytes = sampleStepPixels * bytesPerPixel;
  let minimumChannelValue = 255;
  let maximumChannelValue = 0;

  for (let offset = 0; offset + 2 < requiredBytes; offset += sampleStepBytes) {
    minimumChannelValue = Math.min(
      minimumChannelValue,
      input.bitmap[offset] ?? 255,
      input.bitmap[offset + 1] ?? 255,
      input.bitmap[offset + 2] ?? 255,
    );
    maximumChannelValue = Math.max(
      maximumChannelValue,
      input.bitmap[offset] ?? 0,
      input.bitmap[offset + 1] ?? 0,
      input.bitmap[offset + 2] ?? 0,
    );

    if (maximumChannelValue - minimumChannelValue >= minimumSampledColorRange) {
      return true;
    }
  }

  return false;
}
