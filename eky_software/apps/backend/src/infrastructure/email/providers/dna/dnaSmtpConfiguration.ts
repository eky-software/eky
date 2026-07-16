import type { SmtpSessionTimeouts } from '../../smtp/smtpSession.js';

export const dnaSmtpConnectionProfile = Object.freeze({
  connectionTimeoutMilliseconds: 10_000,
  host: 'smtp.dnamail.fi',
  idleTimeoutMilliseconds: 20_000,
  minVersion: 'TLSv1.2' as const,
  port: 465,
  servername: 'smtp.dnamail.fi',
});

export const dnaSmtpSessionTimeouts: Readonly<SmtpSessionTimeouts> =
  Object.freeze({
    authenticationMilliseconds: 10_000,
    commandMilliseconds: 10_000,
    dataMilliseconds: 30_000,
    greetingMilliseconds: 10_000,
    totalMilliseconds: 60_000,
  });
