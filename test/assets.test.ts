import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES, imageOrigin, imageType, pageImages, recordEdit, saveImage, trashUnusedAssets, unusedAssets } from '../src/assets.js';
import { MemoryStore } from '../src/store.js';
import { Workspace } from '../src/workspace.js';

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));

const PNG = bytes([0x89], 'PNG\r\n\x1a\n', [0, 0, 0, 13]);
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const GIF = bytes('GIF89a', [1, 0, 1, 0]);
const WEBP = bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 ');
const AVIF = bytes([0, 0, 0, 28], 'ftypavif', [0, 0, 0, 0]);

const page = () => new Workspace(new MemoryStore('memory:assets', { 'layout.slice': 'a b V' }));

describe('images added to a page', () => {
  it('are recognised by their bytes', () => {
    expect([PNG, JPEG, GIF, WEBP, AVIF].map(imageType)).toEqual(['png', 'jpg', 'gif', 'webp', 'avif']);
    expect(imageType(bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(imageType(bytes('<!doctype html><script>alert(1)</script>'))).toBeNull();
    expect(imageType(new Uint8Array())).toBeNull();
  });

  it('are named by their content and written once', () => {
    const ws = page();
    const path = saveImage(ws, PNG);
    expect(path).toMatch(/^assets\/img-[0-9a-f]{12}\.png$/);
    expect(saveImage(ws, PNG)).toBe(path);
    expect(saveImage(ws, JPEG)).not.toBe(path);
    expect(ws.store.readBytes(path)).toEqual(PNG);
    expect(pageImages(ws).sort()).toEqual([path, saveImage(ws, JPEG)].sort());
    expect(ws.history()).toEqual([]); // the box change that uses it is the undo step
  });

  it('refuse SVG, HTML, empty and oversized files', () => {
    const ws = page();
    expect(() => saveImage(ws, bytes('<svg></svg>'))).toThrow(/only PNG, JPEG/);
    expect(() => saveImage(ws, bytes('<html></html>'))).toThrow(/only PNG, JPEG/);
    expect(() => saveImage(ws, new Uint8Array())).toThrow(/empty/);
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(PNG);
    expect(() => saveImage(ws, big)).toThrow(/larger than/);
    expect(ws.assets()).toEqual([]);
  });
});

describe('edited images', () => {
  it('remember their original, so a crop can be undone later', () => {
    const ws = page();
    const original = saveImage(ws, PNG), crop = saveImage(ws, JPEG);
    const edit = { from: original, crop: { x: 10, y: 0, w: 100, h: 50 }, quarter: 1, max: 1600 };
    recordEdit(ws, crop, edit);
    expect(imageOrigin(ws, crop)).toEqual(edit);
    expect(imageOrigin(ws, original)).toBeNull();
    expect(imageOrigin(ws, '__proto__')).toBeNull();
    ws.store.remove(original); // the original is gone: nothing to go back to
    expect(imageOrigin(ws, crop)).toBeNull();
  });

  it('refuse records that point outside the page or make no sense', () => {
    const ws = page();
    const a = saveImage(ws, PNG);
    const ok = { from: a, crop: { x: 0, y: 0, w: 1, h: 1 }, quarter: 0, max: 0 };
    expect(() => recordEdit(ws, a, { ...ok, from: '../secret.png' })).toThrow(/not an image of this page/);
    expect(() => recordEdit(ws, a, { ...ok, from: 'assets/missing.png' })).toThrow(/not an image of this page/);
    expect(() => recordEdit(ws, a, { ...ok, crop: { x: 0, y: 0, w: 0, h: 1 } })).toThrow(/bad crop/);
    expect(() => recordEdit(ws, a, { ...ok, quarter: 5 })).toThrow(/bad image edit/);
  });
});

describe('files nothing uses', () => {
  it('finds files no box, head, undo step or paste buffer uses, keeps the originals of used crops, and moves the rest to .trash', () => {
    const ws = new Workspace(new MemoryStore('memory:unused'));
    ws.store.write('layout.slice', 'a b c H3@page\n');
    for (const f of ['used.png', 'orig.png', 'crop.png', 'old.png', 'undo.png', 'buffer.png', 'head.woff2', 'stray.png']) ws.store.write(`assets/${f}`, new Uint8Array([1, 2, 3]));
    ws.setContent('a', '<img src="assets/used.png"><img src="assets/crop.png">', 'user');
    recordEdit(ws, 'assets/crop.png', { from: 'assets/orig.png', crop: { x: 0, y: 0, w: 1, h: 1 }, quarter: 0, max: 0 });
    recordEdit(ws, 'assets/old.png', { from: 'assets/orig.png', crop: { x: 0, y: 0, w: 1, h: 1 }, quarter: 0, max: 0 });
    ws.setContent('b', '<img src="assets/undo.png">', 'user');
    ws.setContent('b', '<p>no picture now</p>', 'user'); // undo can bring undo.png back
    ws.store.write('.tykerf/buffer.json', JSON.stringify([{ code: '<img src="assets/buffer.png">' }]));
    ws.setHead('<style>@font-face{font-family:X;src:url("assets/head.woff2")}</style>', 'user');
    expect(unusedAssets(ws).map((f) => f.file).sort()).toEqual(['old.png', 'stray.png']);
    const r = trashUnusedAssets(ws);
    expect(r.files).toBe(2);
    expect(ws.assets().sort()).toEqual(['buffer.png', 'crop.png', 'head.woff2', 'orig.png', 'undo.png', 'used.png']);
    expect(ws.store.exists(`${r.trash}/old.png`)).toBe(true);
    expect(ws.store.read('.images.json')).not.toContain('old.png');
    expect(unusedAssets(ws)).toEqual([]);
  });
});
