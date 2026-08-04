export const backupContainerMagic = Buffer.from('EKYBKP01', 'ascii');
export const backupContainerVersion = 1;
export const backupContainerHeaderLength = 64;
export const backupCipherProfileId = 1;
export const backupKdfProfileId = 1;
export const backupSaltLength = 16;
export const backupNonceLength = 12;
export const backupAuthenticationTagLength = 16;

export const backupPayloadMagic = Buffer.from('EKYPAY01', 'ascii');
export const backupPayloadVersion = 1;
export const backupPayloadHeaderLength = 16;
export const backupEntryHeaderLength = 48;

export const backupManifestMagic = Buffer.from('EKYMNF01', 'ascii');
export const backupManifestVersion = 1;
