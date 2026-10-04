import { emailTransportLimits } from '../emailTransportLimits.js';
import { SmtpTransportError } from './smtpErrors.js';
import type { SmtpReply, SmtpReplyLine } from './smtpTypes.js';

interface SmtpReplyParserOptions {
  maximumReplyBytes?: number;
  maximumReplyLineBytes?: number;
}

export class SmtpReplyParser {
  private buffer = '';
  private currentCode: number | undefined;
  private currentLines: SmtpReplyLine[] = [];
  private currentReplyBytes = 0;
  private readonly maximumReplyBytes: number;
  private readonly maximumReplyLineBytes: number;

  constructor(options: SmtpReplyParserOptions = {}) {
    this.maximumReplyBytes =
      options.maximumReplyBytes ?? emailTransportLimits.maximumReplyBytes;
    this.maximumReplyLineBytes =
      options.maximumReplyLineBytes ?? emailTransportLimits.maximumReplyLineBytes;
  }

  push(chunk: Uint8Array): SmtpReply[] {
    const replies: SmtpReply[] = [];

    // Bound the current line and reply, not an arbitrary TLS chunk.
    for (const byte of chunk) {
      const character = String.fromCharCode(byte);
      const afterCarriageReturn = this.buffer.endsWith('\r');
      if (
        character === '\0' ||
        (afterCarriageReturn && character !== '\n') ||
        (character === '\n' && !afterCarriageReturn)
      ) {
        throw protocolError();
      }

      if (character === '\n') {
        replies.push(...this.consumeLine(this.buffer.slice(0, -1)));
        this.buffer = '';
        continue;
      }

      const nextLength = this.buffer.length + 1;
      const lineLimit =
        this.maximumReplyLineBytes + (character === '\r' ? 1 : 0);
      if (
        nextLength > lineLimit ||
        this.currentReplyBytes + nextLength > this.maximumReplyBytes
      ) {
        throw protocolError();
      }
      this.buffer += character;
    }

    return replies;
  }

  finish(): void {
    if (this.buffer.length > 0 || this.currentCode !== undefined) {
      throw protocolError();
    }
  }

  private consumeLine(line: string): SmtpReply[] {
    const lineBytes = Buffer.byteLength(line, 'latin1');

    if (
      lineBytes > this.maximumReplyLineBytes ||
      /[\u0000\r\n]/.test(line)
    ) {
      throw protocolError();
    }

    const match = /^([2-5][0-9]{2})([ -])(.*)$/.exec(line);

    if (match === null) {
      throw protocolError();
    }

    const code = Number(match[1]);
    const separator = match[2] as '-' | ' ';
    const parsedLine: SmtpReplyLine = {
      code,
      separator,
      text: match[3] ?? '',
    };

    if (this.currentCode !== undefined && code !== this.currentCode) {
      throw protocolError();
    }

    this.currentCode ??= code;
    this.currentLines.push(parsedLine);
    this.currentReplyBytes += lineBytes + 2;

    if (this.currentReplyBytes > this.maximumReplyBytes) {
      throw protocolError();
    }

    if (separator === '-') {
      return [];
    }

    const reply: SmtpReply = {
      code,
      lines: this.currentLines,
    };
    this.currentCode = undefined;
    this.currentLines = [];
    this.currentReplyBytes = 0;

    return [reply];
  }
}

function protocolError(): SmtpTransportError {
  return new SmtpTransportError('SMTP_PROTOCOL_ERROR', 'reply');
}
