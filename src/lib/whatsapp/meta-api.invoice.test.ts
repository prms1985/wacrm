import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadInvoiceMedia } from './meta-api';
afterEach(() => vi.unstubAllGlobals());
describe('official invoice upload', () => {
  it('uploads bytes as multipart media with bearer auth rather than a public link', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: '456' }), { status: 200 })
      );
    vi.stubGlobal('fetch', fetcher);
    await expect(
      uploadInvoiceMedia({
        phoneNumberId: '123',
        accessToken: 'fake',
        bytes: new TextEncoder().encode('%PDF-1.7'),
        filename: 'bill.pdf',
      })
    ).resolves.toEqual({ id: '456' });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toMatch(/\/123\/media$/);
    expect(init.headers).toEqual({ Authorization: 'Bearer fake' });
    expect(init.body.get('messaging_product')).toBe('whatsapp');
    expect(init.body.get('file').name).toBe('bill.pdf');
  });
  it('rejects an invalid upload response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    );
    await expect(
      uploadInvoiceMedia({
        phoneNumberId: '123',
        accessToken: 'fake',
        bytes: new Uint8Array(),
        filename: 'bill.pdf',
      })
    ).rejects.toThrow('media ID');
  });
});

vi.mock('@/lib/managed/runtime', () => ({
  reserveOutboundAttempt: async () => {},
}));
