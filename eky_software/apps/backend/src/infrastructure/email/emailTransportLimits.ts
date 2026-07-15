export const emailTransportLimits = Object.freeze({
  maximumAddressCharacters: 254,
  maximumBodyCharacters: 10_000,
  maximumCommandBytes: 512,
  maximumPdfBytes: 10 * 1024 * 1024,
  maximumRecipients: 10,
  maximumReplyBytes: 64 * 1024,
  maximumReplyLineBytes: 1_000,
  maximumSubjectCharacters: 200,
});
