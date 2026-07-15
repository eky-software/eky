import type { SmtpReply } from './smtpTypes.js';

export interface SmtpCapabilities {
  authenticationMethods: ReadonlySet<'LOGIN' | 'PLAIN'>;
  extensions: ReadonlySet<string>;
}

export function parseSmtpCapabilities(reply: SmtpReply): SmtpCapabilities {
  const authenticationMethods = new Set<'LOGIN' | 'PLAIN'>();
  const extensions = new Set<string>();

  for (const line of reply.lines.slice(1)) {
    const normalizedLine = line.text.trim().toUpperCase();
    const [rawExtension = '', ...rawArguments] = normalizedLine.split(/\s+/);
    const extensionParts = rawExtension.split('=', 2);
    const extension = extensionParts[0] ?? '';
    const inlineArgument = extensionParts[1] ?? '';

    if (extension.length === 0) {
      continue;
    }

    extensions.add(extension);

    if (extension === 'AUTH') {
      const methods = [inlineArgument, ...rawArguments];

      for (const method of methods) {
        if (method === 'PLAIN' || method === 'LOGIN') {
          authenticationMethods.add(method);
        }
      }
    }
  }

  return { authenticationMethods, extensions };
}
