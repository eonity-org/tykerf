// What a request to Kaity may carry from the composer's Attach (src/editor/attachments.ts): pictures and PDFs as they
// are, a design ZIP's pictures and text as reference; anything else refused with a sentence. (A PDF reaching the model
// as a document is checked end to end in test/shell-new.test.ts.)

import { describe, expect, it } from 'vitest';
import { readAttachments } from '../src/editor/attachments.js';
import { zip } from '../src/zip.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF');
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

describe('files attached to a request', () => {
  it('take pictures and PDFs as they are, checked by their bytes, not their names', () => {
    const r = readAttachments([{ name: 'cv.pdf', type: 'application/pdf', data: b64(PDF) }, { name: 'shot.png', type: 'image/png', data: b64(PNG) }]);
    expect(r.files.map((f) => [f.name, f.mediaType])).toEqual([['cv.pdf', 'application/pdf'], ['shot.png', 'image/png']]);
    expect(r.context).toBe('');
    // a picture called .pdf is a picture
    expect(readAttachments([{ name: 'odd.pdf', type: 'application/pdf', data: b64(PNG) }]).files[0].mediaType).toBe('image/png');
    // the older form, pictures only
    expect(readAttachments(undefined, [{ mediaType: 'image/png', data: b64(PNG) }]).files).toHaveLength(1);
  });

  it('take a design ZIP: its pictures go along, its text files as reference', () => {
    const z = zip([{ path: 'design/page.png', bytes: new Uint8Array(PNG) }, { path: 'design/spec.md', bytes: new TextEncoder().encode('# Colours\nTeal') }]);
    const r = readAttachments([{ name: 'design.zip', type: 'application/zip', data: b64(z) }]);
    expect(r.files.map((f) => f.name)).toEqual(['design/page.png']);
    expect(r.context).toContain('--- design/spec.md ---\n# Colours\nTeal');
    expect(r.note).toBe('(Attached: design.zip: design/spec.md, design/page.png)');
  });

  it('refuse what Kaity can\'t read, and more than five files', () => {
    expect(() => readAttachments([{ name: 'notes.docx', data: b64(new TextEncoder().encode('PK? no')) }])).toThrow(/notes\.docx/);
    expect(() => readAttachments([{ name: 'a.txt', data: b64(new TextEncoder().encode('hello')) }])).toThrow(/Kaity reads PDFs, pictures \(PNG, JPEG, GIF, WebP\) and a design as a ZIP file/);
    expect(() => readAttachments([{ name: 'empty.pdf', data: '' }])).toThrow(/empty\.pdf is empty/);
    expect(() => readAttachments(Array.from({ length: 6 }, (_, i) => ({ name: `${i}.png`, data: b64(PNG) })))).toThrow(/at most 5 files/);
  });
});
