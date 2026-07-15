export interface InvoiceMimeMessageInput {
  body: string;
  cc?: string;
  fromAddress: string;
  fromName: string;
  pdfContent: Uint8Array;
  pdfFileName: string;
  subject: string;
  to: string;
}

export interface InvoiceMimeMessageOptions {
  messageId?: string;
  now?: Date;
}
