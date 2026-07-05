export interface InvoiceDocumentStorage {
  deleteFile(storagePath: string): Promise<void>;
  readFile(storagePath: string): Promise<Uint8Array>;
  writeFile(storagePath: string, content: Uint8Array): Promise<void>;
}
