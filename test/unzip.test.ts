// The ZIP reader (design exports dropped on the start screen) and what Kaity gets from a design ZIP.

import { describe, expect, it } from 'vitest';
import { designContext, designNote, readDesignZip } from '../src/editor/design-zip.js';
import { unzip } from '../src/unzip.js';
import { zip } from '../src/zip.js';

const text = (s: string) => new TextEncoder().encode(s);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

describe('unzip', () => {
  it('reads what zip() writes: stored and deflated files, folders left out', () => {
    const files = [{ path: 'a.txt', bytes: text('hello '.repeat(200)) }, { path: 'img/p.png', bytes: new Uint8Array(PNG) }, { path: 'empty.md', bytes: new Uint8Array() }];
    const r = unzip(zip(files));
    expect(r.files.map((f) => [f.path, Buffer.from(f.bytes).toString('hex')])).toEqual(files.map((f) => [f.path, Buffer.from(f.bytes).toString('hex')]));
    expect(r.skipped).toEqual([]);
  });

  it('refuses what is not a ZIP file', () => {
    expect(() => unzip(text('just text'))).toThrow(/not a ZIP file/);
    expect(() => unzip(new Uint8Array(PNG))).toThrow(/not a ZIP file/);
  });

  it('leaves out unsafe names, damaged files and files over the limits', () => {
    const a = zip([{ path: '../evil.txt', bytes: text('x') }, { path: '/abs.txt', bytes: text('x') }, { path: 'ok.txt', bytes: text('fine') }]);
    expect(unzip(a).files.map((f) => f.path)).toEqual(['ok.txt']);
    expect(unzip(a).skipped).toEqual(['../evil.txt: not a safe file name', '/abs.txt: not a safe file name']);

    // a zip bomb: 20 MB of zeros packs into a few KB, and stops at the size limit
    const bomb = zip([{ path: 'zeros.txt', bytes: new Uint8Array(20 * 1024 * 1024) }]);
    expect(bomb.length).toBeLessThan(100_000);
    expect(unzip(bomb).skipped).toEqual(['zeros.txt: larger than 10 MB']);
    expect(() => unzip(zip([{ path: 'a', bytes: new Uint8Array(6) }, { path: 'b', bytes: new Uint8Array(6) }]), { maxTotal: 10 })).toThrow(/unpacks to more than/);
    expect(() => unzip(zip([{ path: 'a', bytes: text('1') }, { path: 'b', bytes: text('2') }]), { maxFiles: 1 })).toThrow(/more than 1 files/);

    // a changed byte in a file's data: it doesn't inflate, or fails the CRC check
    const z = zip([{ path: 'p.txt', bytes: text('abcdefghij'.repeat(50)) }]);
    z[30 + 'p.txt'.length + 4] ^= 0xff;
    expect(unzip(z).skipped).toEqual([expect.stringMatching(/^p\.txt: damaged/)]);
  });
});

describe('a design ZIP', () => {
  const stitch = zip([
    { path: 'code.html', bytes: text('<html><script src="https://cdn.tailwindcss.com"></script><h1>Paris</h1></html>') },
    { path: 'screen.png', bytes: new Uint8Array(PNG) },
    { path: 'DESIGN.md', bytes: text('# L\'Odyssée\nPrimary: #0F1B29') },
    { path: '__MACOSX/._screen.png', bytes: text('junk') },
    { path: '.DS_Store', bytes: text('junk') },
    { path: 'font.woff2', bytes: text('wOF2') },
  ]);

  it('gives Kaity its pictures and its text files, the spec first, and says what it left out', () => {
    const d = readDesignZip(stitch);
    expect(d.images.map((i) => [i.path, i.mediaType])).toEqual([['screen.png', 'image/png']]);
    expect(d.texts.map((t) => t.path)).toEqual(['DESIGN.md', 'code.html']);
    expect(d.skipped).toEqual(['font.woff2: not a picture or a text file']);
    expect(designNote('stitch.zip', d)).toBe('(Attached: stitch.zip: DESIGN.md, code.html, screen.png)');
    const c = designContext('stitch.zip', d);
    expect(c).toContain('--- DESIGN.md ---\n# L\'Odyssée\nPrimary: #0F1B29');
    expect(c).toContain('<h1>Paris</h1>');
    expect(c).toMatch(/never load anything from other servers/);
  });

  it('keeps to the number of pictures left, and cuts long text', () => {
    const d = readDesignZip(zip([{ path: 'a.png', bytes: new Uint8Array(PNG) }, { path: 'b.png', bytes: new Uint8Array(PNG) }, { path: 'long.md', bytes: text('x'.repeat(70_000)) }]), 1);
    expect(d.images.map((i) => i.path)).toEqual(['a.png']);
    expect(d.skipped).toEqual(['b.png: only 1 pictures go to Kaity']);
    expect(d.texts[0]).toMatchObject({ cut: true });
    expect(d.texts[0].text).toHaveLength(60_000);
    expect(designContext('d.zip', d)).toContain('--- long.md (cut short) ---');
  });
});
