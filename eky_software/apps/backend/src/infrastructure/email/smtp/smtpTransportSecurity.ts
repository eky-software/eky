import { isIP } from 'node:net';

export type SmtpTlsVersion = 'TLSv1.2' | 'TLSv1.3';
export type SmtpRemoteFamily = 'IPv4' | 'IPv6';

export interface SmtpTransportSecuritySummary {
  cipherName: string;
  peerCertificateFingerprint256: string;
  remoteAddress: string;
  remoteFamily: SmtpRemoteFamily;
  smtpProfile: 'dnaSmtp';
  targetPort: 465;
  tlsVersion: SmtpTlsVersion;
}

interface SmtpTlsSocketMetadataSource {
  getCipher(): { standardName: string };
  getPeerCertificate(): { fingerprint256?: string };
  getProtocol(): string | null;
  remoteAddress: string | undefined;
  remoteFamily: string | undefined;
}

const allowedCipherNames = new Set([
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',
  'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384',
  'TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256',
  'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
  'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
  'TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256',
]);
const fingerprint256Pattern =
  /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export function tryReadSmtpTransportSecuritySummary(
  socket: SmtpTlsSocketMetadataSource,
  input: {
    smtpProfile: 'dnaSmtp';
    targetPort: 465;
  },
): SmtpTransportSecuritySummary | undefined {
  try {
    const tlsVersion = socket.getProtocol();
    const cipher = socket.getCipher();
    const peerCertificate = socket.getPeerCertificate();
    const remoteAddress = socket.remoteAddress;
    const remoteAddressVersion =
      remoteAddress === undefined ? 0 : isIP(remoteAddress);
    const remoteFamily = socket.remoteFamily;

    if (
      (tlsVersion !== 'TLSv1.2' && tlsVersion !== 'TLSv1.3') ||
      !allowedCipherNames.has(cipher.standardName) ||
      typeof peerCertificate.fingerprint256 !== 'string' ||
      !fingerprint256Pattern.test(peerCertificate.fingerprint256) ||
      remoteAddress === undefined ||
      remoteAddressVersion === 0 ||
      (remoteAddressVersion === 4 && remoteFamily !== 'IPv4') ||
      (remoteAddressVersion === 6 && remoteFamily !== 'IPv6')
    ) {
      return undefined;
    }

    const validatedRemoteFamily: SmtpRemoteFamily =
      remoteAddressVersion === 4 ? 'IPv4' : 'IPv6';

    return Object.freeze({
      cipherName: cipher.standardName,
      peerCertificateFingerprint256: peerCertificate.fingerprint256,
      remoteAddress,
      remoteFamily: validatedRemoteFamily,
      smtpProfile: input.smtpProfile,
      targetPort: input.targetPort,
      tlsVersion,
    });
  } catch {
    return undefined;
  }
}
