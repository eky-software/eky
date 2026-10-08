import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseLegacyPackagedSmokeIdentity, verifyPackagedLegacyInvoice } from './packagedLegacyProfileSmoke.js';

const pdf = Buffer.from('%PDF- synthetic original bytes');
const identity = { formatVersion: 1, invoiceId: 'invoice-1', invoiceNumber: '20260001',
  eventId: 'legacy-event', pdfSha256: createHash('sha256').update(pdf).digest('hex'), profileId: 'a'.repeat(64) };

describe('packaged legacy identity and content verification', () => {
  const roots: string[] = [];
  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  });

  it('accepts only the synthetic identifiers and hashes, never paths or credentials', () => {
    expect(parseLegacyPackagedSmokeIdentity(identity)).toEqual(identity);
    for (const invalid of [null, { ...identity, password: 'not allowed' },
      { ...identity, invoiceId: '../other' }, { ...identity, eventId: 'another-event' },
      { ...identity, invoiceNumber: 'not-a-number' }, { ...identity, pdfSha256: 'invalid' },
      { ...identity, profileId: 'invalid' }, { ...identity, formatVersion: 2 }]) {
      expect(() => parseLegacyPackagedSmokeIdentity(invalid)).toThrow('DESKTOP_SMOKE_LEGACY_IDENTITY_INVALID');
    }
  });

  for (const failure of ['none', 'invoice', 'event', 'mode', 'pdf', 'http'] as const) {
    it(`checks invoice, immutable historical mode and original PDF (${failure})`, async () => {
      const root = await mkdtemp(join(tmpdir(), 'eky-legacy-smoke-contract-'));
      roots.push(root);
      await mkdir(join(root, 'legacy-input'));
      await writeFile(join(root, 'legacy-input/identity.json'), JSON.stringify(identity));
      const requests: string[] = [];
      vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
        requests.push(url);
        expect(init.headers).toEqual({ 'x-eky-local-session': 'synthetic-session' });
        const path = new URL(url).pathname;
        if (failure === 'http') return new Response('', { status: 500 });
        if (path.endsWith('/pdf')) return new Response(failure === 'pdf' ? '%PDF- other bytes' : pdf);
        if (path.endsWith('/delivery-events')) return Response.json({ events: [{
          id: failure === 'event' ? 'other-event' : identity.eventId, status: 'succeeded',
          documentSource: 'legacyOriginal', sendMode: failure === 'mode' ? 'customer' : 'legacyUnknown',
        }] });
        return Response.json({ invoice: { id: identity.invoiceId, invoiceNumber: identity.invoiceNumber,
          status: failure === 'invoice' ? 'approved' : 'sent' } });
      }));
      const result = verifyPackagedLegacyInvoice({ smokeRoot: root, backendPort: 12345,
        runtimeSessionSecret: 'synthetic-session' });
      if (failure === 'none') {
        await expect(result).resolves.toBeUndefined();
        expect(requests).toEqual(['http://127.0.0.1:12345/invoices/invoice-1',
          'http://127.0.0.1:12345/invoices/invoice-1/delivery-events',
          'http://127.0.0.1:12345/invoices/invoice-1/delivery-events/legacy-event/pdf']);
      } else {
        await expect(result).rejects.toThrow(failure === 'http' ? 'DESKTOP_SMOKE_LEGACY_READ_FAILED'
          : failure === 'pdf' ? 'DESKTOP_SMOKE_LEGACY_PDF_FAILED' : 'DESKTOP_SMOKE_LEGACY_CONTENT_FAILED');
      }
    });
  }
});
