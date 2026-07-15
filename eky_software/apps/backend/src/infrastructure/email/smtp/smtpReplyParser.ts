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
    this.buffer += Buffer.from(chunk).toString('latin1');
    this.assertBufferedDataIsBoundedAndCanonical();

    const replies: SmtpReply[] = [];
    let lineEnd = this.buffer.indexOf('\r\n');

    while (lineEnd >= 0) {
      const line = this.buffer.slice(0, lineEnd);
      this.buffer = this.buffer.slice(lineEnd + 2);
      replies.push(...this.consumeLine(line));
      this.assertBufferedDataIsBoundedAndCanonical();
      lineEnd = this.buffer.indexOf('\r\n');
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

  private assertBufferedDataIsBoundedAndCanonical(): void {
    if (
      Buffer.byteLength(this.buffer, 'latin1') > this.maximumReplyLineBytes + 2 ||
      this.buffer.includes('\0')
    ) {
      throw protocolError();
    }

    for (let index = 0; index < this.buffer.length; index += 1) {
      const character = this.buffer[index];

      if (character === '\n' && this.buffer[index - 1] !== '\r') {
        throw protocolError();
      }

      if (
        character === '\r' &&
        index < this.buffer.length - 1 &&
        this.buffer[index + 1] !== '\n'
      ) {
        throw protocolError();
      }
    }
  }
}

function protocolError(): SmtpTransportError {
  return new SmtpTransportError('SMTP_PROTOCOL_ERROR', 'reply');
}
